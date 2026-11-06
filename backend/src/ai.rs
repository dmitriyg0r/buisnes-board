//! Генерация процесса и документации моделью ChatGPT (тот же вход, что и у Codex CLI).
//! Вызов идёт на недокументированный адрес `chatgpt.com/backend-api/codex/responses`:
//! формат может измениться без предупреждения.

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::integrations::access_token;
use crate::AppState;

const CODEX_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const MAX_PROMPT: usize = 4000;
const MAX_CONTEXT: usize = 60_000;
const MAX_NODES: usize = 60;
const MAX_FLOWS: usize = 120;
const MAX_SECTIONS: usize = 30;
/// Защита от бесконечного ответа: столько текста модель написать не должна.
const MAX_ANSWER: usize = 400_000;
/// Генерация длинная: общий лимит клиента (10 с) здесь не подходит.
const CALL_TIMEOUT: Duration = Duration::from_secs(180);

const INSTRUCTIONS: &str = r#"Ты бизнес-аналитик и ведёшь диалог с пользователем в чате на доске бизнес-процессов. Ты можешь отвечать на вопросы о процессах и материалах на доске, строить модель бизнес-процесса и писать к ней регламент. Всё на русском языке.

Верни ТОЛЬКО один JSON-объект, без пояснений и без markdown-обёртки. Ключи строго в таком порядке:
{
  "reply": "ответ пользователю: 1-4 предложения",
  "process": {
    "title": "название процесса",
    "nodes": [ { "id": "n1", "type": "start|task|gateway|end", "name": "текст" } ],
    "flows": [ { "from": "n1", "to": "n2", "label": "необязательная подпись ветки" } ]
  },
  "document": {
    "title": "название регламента",
    "sections": [ { "title": "§ 1. Название пункта", "markdown": "текст пункта в Markdown", "steps": ["n2"] } ]
  }
}

Правила диалога:
- reply есть всегда: это то, что пользователь прочитает в чате. Если построил процесс, скажи, что получилось (ключевые шаги, развилки) и что стоит уточнить. Если это вопрос или уточнение, ответь по делу.
- process и document добавляй, только когда пользователь просит построить процесс или описывает процесс для моделирования. На вопросы, благодарности и уточнения отвечай одним reply, без process и document.
- document добавляй только вместе с process.
- Если данных не хватает для хорошего процесса, не строй его: в reply задай 1-3 конкретных вопроса.
- Существующие процессы и документы на доске менять ты не умеешь. Если просят доработать существующий, построй новую версию как новый процесс с названием вроде «Название (версия 2)» и скажи об этом в reply.
- Не повторяй уже построенное, если об этом не просили.

Правила модели процесса:
- id узлов: латиница, цифры, «_» и «-», уникальные (n1, n2, ...).
- Ровно один узел типа start и хотя бы один end. Каждый узел достижим от start, из каждого узла (кроме end) есть выход.
- task называй глаголом действия («Проверить заявку»). gateway: развилка или слияние; у каждой исходящей ветки gateway задай label («Да», «Нет», условие).
- Не больше 40 узлов; не делай лишней детализации.

Правила документа:
- Заголовки пунктов нумеруй: «§ 1. Цель», «§ 2. Участники», «§ 3. Порядок выполнения» и т. д. Подпункты: «§ 3.1. ...».
- Пункт про шаги процесса описывает их по порядку; в steps перечисли id узлов (task или gateway), которые этот пункт описывает. Остальные пункты оставь с пустым steps.
- В markdown не повторяй заголовок пункта и не используй заголовки уровня выше третьего.
- Опирайся только на описание пользователя и материалы с доски; не выдумывай нормативные ссылки, сроки и роли, которых там нет. Если данных не хватает, напиши в пункте, что именно нужно уточнить."#;

fn model_id(m: &str) -> Option<&'static str> {
    match m {
        "6.1-sol" => Some("gpt-6.1-sol"),
        "6.1-terra" => Some("gpt-6.1-terra"),
        _ => None,
    }
}

#[derive(Deserialize)]
pub struct GenerateReq {
    prompt: String,
    model: String,
    /// сжатое описание того, что уже есть на доске (собирает клиент)
    context: Option<String>,
    /// предыдущие реплики чата: так модель понимает уточнения вроде «а теперь добавь отказ»
    history: Option<Vec<Turn>>,
}

#[derive(Deserialize)]
pub struct Turn {
    role: String,
    text: String,
}

const MAX_TURNS: usize = 12;
const MAX_TURN_CHARS: usize = 1500;

/// Собирает текст запроса: диалог, новое сообщение и описание доски.
fn build_input(prompt: &str, context: &str, history: &[Turn]) -> String {
    let mut out = String::new();
    // берём последние реплики: давняя часть разговора модели не нужна, а лимит контекста общий
    let skip = history.len().saturating_sub(MAX_TURNS);
    let turns: Vec<String> = history
        .iter()
        .skip(skip)
        .filter_map(|t| {
            let who = match t.role.as_str() {
                "user" => "Пользователь",
                "assistant" => "ИИ",
                _ => return None,
            };
            let text: String = t.text.trim().chars().take(MAX_TURN_CHARS).collect();
            (!text.is_empty()).then(|| format!("{who}: {text}"))
        })
        .collect();
    if !turns.is_empty() {
        out.push_str("Предыдущий диалог:\n");
        out.push_str(&turns.join("\n"));
        out.push_str("\n\n");
    }
    out.push_str("Новое сообщение пользователя:\n");
    out.push_str(prompt);
    if !context.trim().is_empty() {
        out.push_str("\n\nЧто уже есть на доске:\n");
        out.push_str(context);
    }
    out
}

type Tx = Sender<Result<Bytes, Infallible>>;

/// Одно событие потока: JSON в одной строке. false, если клиент ушёл (закрыл вкладку или нажал «Отмена»).
async fn emit(tx: &Tx, v: Value) -> bool {
    let mut line = v.to_string();
    line.push('\n');
    tx.send(Ok(Bytes::from(line))).await.is_ok()
}

/// Текст ошибки для события потока.
fn message(e: AppError) -> String {
    match e {
        AppError::Upstream(m) | AppError::BadRequest(m) | AppError::Unavailable(m) | AppError::Forbidden(m) => m,
        _ => "внутренняя ошибка".into(),
    }
}

/// Ответ идёт потоком (NDJSON): `start`, затем `delta` с кусочками текста модели по мере их появления,
/// в конце `result` с проверенным процессом и документом или `error`. Клиент рисует черновик на доске по ходу дела.
pub async fn generate(State(s): State<AppState>, user: AuthUser, Json(b): Json<GenerateReq>) -> AppResult<Response> {
    let prompt = b.prompt.trim();
    if prompt.is_empty() || prompt.chars().count() > MAX_PROMPT {
        return Err(AppError::BadRequest(format!("запрос должен быть от 1 до {MAX_PROMPT} символов")));
    }
    let context = b.context.unwrap_or_default();
    if context.len() > MAX_CONTEXT * 4 {
        return Err(AppError::BadRequest("слишком много материалов на доске для одного запроса".into()));
    }
    let context: String = context.chars().take(MAX_CONTEXT).collect();
    let Some(model) = model_id(&b.model) else {
        return Err(AppError::BadRequest("неизвестная модель".into()));
    };
    // не подключён ChatGPT и подобное: обычная ошибка до начала потока
    access_token(&s, user.id, false).await?;

    // одна генерация на человека: токен и лимиты ChatGPT общие
    if !s.ai_busy.lock().map_err(|_| AppError::Internal)?.insert(user.id) {
        return Err(AppError::BadRequest("предыдущая генерация ещё идёт: дождитесь результата".into()));
    }
    let input = build_input(prompt, &context, b.history.as_deref().unwrap_or(&[]));

    let (tx, rx) = tokio::sync::mpsc::channel(64);
    let uid = user.id;
    tokio::spawn(async move {
        emit(&tx, json!({ "type": "start" })).await;
        let done = match stream_codex(&s, uid, model, &input, &tx).await {
            Ok(text) => finish(&text),
            Err(m) => Err(m),
        };
        match done {
            Ok(data) => emit(&tx, json!({ "type": "result", "data": data })).await,
            Err(m) => emit(&tx, json!({ "type": "error", "message": m })).await,
        };
        if let Ok(mut busy) = s.ai_busy.lock() {
            busy.remove(&uid);
        }
    });

    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("application/x-ndjson")),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            // nginx не должен копить поток: клиент должен получать куски сразу
            (header::HeaderName::from_static("x-accel-buffering"), HeaderValue::from_static("no")),
        ],
        Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)),
    )
        .into_response())
}

fn finish(text: &str) -> Result<Value, String> {
    let v = extract_json(text).ok_or_else(|| "модель вернула ответ не в том формате, попробуйте ещё раз".to_string())?;
    normalize(&v).map_err(|why| {
        tracing::warn!("ответ модели отклонён: {why}");
        format!("модель построила некорректный процесс ({why}), попробуйте ещё раз")
    })
}

/// Читает поток событий Responses API и пересылает клиенту кусочки текста. Возвращает весь текст ответа.
async fn stream_codex(s: &AppState, user: Uuid, model: &str, input: &str, tx: &Tx) -> Result<String, String> {
    let body = json!({
        "model": model,
        "store": false,
        "stream": true,
        "instructions": INSTRUCTIONS,
        "input": [ { "type": "message", "role": "user", "content": [ { "type": "input_text", "text": input } ] } ],
    });
    // два захода: при отказе 401 один раз принудительно обновляем токен
    for attempt in 0..2 {
        let (token, account) = access_token(s, user, attempt == 1).await.map_err(message)?;
        let mut res = s
            .http
            .post(CODEX_URL)
            .timeout(CALL_TIMEOUT)
            .bearer_auth(token)
            .header("chatgpt-account-id", account)
            .header("originator", "buisnes-board")
            .header("OpenAI-Beta", "responses=experimental")
            .header("accept", "text/event-stream")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("запрос к модели не удался: {}", if e.is_timeout() { "таймаут" } else { "сеть" });
                "не удалось связаться с OpenAI, попробуйте позже".to_string()
            })?;
        let status = res.status().as_u16();
        match status {
            200..=299 => {
                let mut sse = Sse::default();
                // байты копим до конца строки: многобайтовая буква может прийти разорванной между кусками
                let mut buf: Vec<u8> = Vec::new();
                loop {
                    match res.chunk().await {
                        Ok(Some(c)) => buf.extend_from_slice(&c),
                        Ok(None) => break,
                        Err(_) => return Err("ответ модели оборвался, попробуйте ещё раз".into()),
                    }
                    while let Some(nl) = buf.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = buf.drain(..=nl).collect();
                        if let Some(d) = sse.feed(&String::from_utf8_lossy(&line)) {
                            if sse.text.len() > MAX_ANSWER {
                                return Err("модель написала слишком длинный ответ".into());
                            }
                            // клиент ушёл (отмена): закрываем соединение с моделью и не тратим лимит
                            if !emit(tx, json!({ "type": "delta", "text": d })).await {
                                return Err("отменено".into());
                            }
                        }
                    }
                }
                if !buf.is_empty() {
                    sse.feed(&String::from_utf8_lossy(&buf));
                }
                return sse.finish();
            }
            401 if attempt == 0 => continue,
            401 => return Err("ChatGPT отклонил доступ: подключите его заново в настройках".into()),
            403 => return Err("OpenAI недоступен из региона сервера или доступ запрещён".into()),
            429 => return Err("лимит ChatGPT исчерпан, попробуйте позже".into()),
            _ => {
                tracing::warn!("модель ответила HTTP {status}");
                return Err("OpenAI ответил ошибкой, попробуйте позже".into());
            }
        }
    }
    Err("внутренняя ошибка".into())
}

/// Разбор потока событий Responses API построчно.
#[derive(Default)]
struct Sse {
    text: String,
    done_text: Option<String>,
    failure: Option<String>,
}

impl Sse {
    /// Принимает одну строку потока; для события с куском текста возвращает этот кусок.
    fn feed(&mut self, line: &str) -> Option<String> {
        let data = line.trim().strip_prefix("data:")?.trim();
        if data.is_empty() || data == "[DONE]" {
            return None;
        }
        let ev: Value = serde_json::from_str(data).ok()?;
        match ev["type"].as_str().unwrap_or("") {
            "response.output_text.delta" => {
                let d = ev["delta"].as_str()?;
                self.text.push_str(d);
                return Some(d.to_owned());
            }
            "response.output_text.done" => self.done_text = ev["text"].as_str().map(str::to_owned),
            "response.failed" => self.failure = ev["response"]["error"]["message"].as_str().map(str::to_owned).or(Some("модель не смогла ответить".into())),
            "error" => self.failure = ev["message"].as_str().map(str::to_owned).or(Some("модель не смогла ответить".into())),
            _ => {}
        }
        None
    }

    fn finish(self) -> Result<String, String> {
        let text = if self.text.trim().is_empty() { self.done_text.unwrap_or_default() } else { self.text };
        if text.trim().is_empty() {
            return Err(self.failure.map_or_else(|| "модель вернула пустой ответ, попробуйте ещё раз".into(), |m| format!("модель не смогла ответить: {m}")));
        }
        Ok(text)
    }
}

/// Достаёт JSON-объект из ответа, даже если модель обернула его в ```json или добавила пояснение.
fn extract_json(text: &str) -> Option<Value> {
    let (a, b) = (text.find('{')?, text.rfind('}')?);
    if b <= a {
        return None;
    }
    serde_json::from_str(&text[a..=b]).ok()
}

fn clip(v: &Value, max: usize) -> String {
    v.as_str().unwrap_or("").trim().chars().take(max).collect()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Проверяет и чистит ответ модели: клиент получает только то, что точно сможет показать и нарисовать.
/// Реплика есть всегда; процесс и документ необязательны (на вопрос модель отвечает одной репликой).
fn normalize(v: &Value) -> Result<Value, String> {
    let reply = clip(&v["reply"], 2000);
    if v["process"].is_null() {
        if reply.is_empty() {
            return Err("пустой ответ".into());
        }
        return Ok(json!({ "reply": reply }));
    }

    let p = &v["process"];
    let nodes_in = p["nodes"].as_array().ok_or("нет списка шагов")?;
    let flows_in = p["flows"].as_array().ok_or("нет списка переходов")?;
    if nodes_in.is_empty() || nodes_in.len() > MAX_NODES {
        return Err(format!("шагов должно быть от 1 до {MAX_NODES}"));
    }
    if flows_in.len() > MAX_FLOWS {
        return Err("слишком много переходов".into());
    }

    let mut ids = HashSet::new();
    let mut nodes = Vec::new();
    for n in nodes_in {
        let id = clip(&n["id"], 40);
        let kind = n["type"].as_str().unwrap_or("");
        if !valid_id(&id) || !ids.insert(id.clone()) {
            return Err("повторяющийся или некорректный идентификатор шага".into());
        }
        if !matches!(kind, "start" | "task" | "gateway" | "end") {
            return Err(format!("неизвестный тип шага «{kind}»"));
        }
        nodes.push(json!({ "id": id, "type": kind, "name": clip(&n["name"], 200) }));
    }
    let count = |k: &str| nodes.iter().filter(|n| n["type"] == k).count();
    if count("start") != 1 {
        return Err("должно быть ровно одно начало".into());
    }
    if count("end") == 0 {
        return Err("нет завершающего шага".into());
    }

    let mut flows = Vec::new();
    for f in flows_in {
        let (from, to) = (clip(&f["from"], 40), clip(&f["to"], 40));
        if !ids.contains(&from) || !ids.contains(&to) || from == to {
            return Err("переход ссылается на несуществующий шаг".into());
        }
        let mut o = Map::new();
        o.insert("from".into(), from.into());
        o.insert("to".into(), to.into());
        let label = clip(&f["label"], 120);
        if !label.is_empty() {
            o.insert("label".into(), label.into());
        }
        flows.push(Value::Object(o));
    }
    let ptitle = clip(&p["title"], 200);
    let mut out = Map::new();
    out.insert("reply".into(), reply.into());
    out.insert("process".into(), json!({ "title": if ptitle.is_empty() { "Процесс".to_owned() } else { ptitle }, "nodes": nodes, "flows": flows }));

    // документ необязателен: без него остаётся одна схема
    let doc = &v["document"];
    if !doc.is_null() {
        let secs_in = doc["sections"].as_array().ok_or("нет пунктов документа")?;
        if secs_in.is_empty() || secs_in.len() > MAX_SECTIONS {
            return Err(format!("пунктов должно быть от 1 до {MAX_SECTIONS}"));
        }
        let mut sections = Vec::new();
        for sec in secs_in {
            let title = clip(&sec["title"], 200);
            if title.is_empty() {
                return Err("у пункта нет заголовка".into());
            }
            let markdown: String = sec["markdown"].as_str().unwrap_or("").trim().chars().take(8000).collect();
            // ссылки на несуществующие шаги молча отбрасываем
            let steps: Vec<Value> = sec["steps"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| ids.contains(*x)).map(Value::from).collect())
                .unwrap_or_default();
            sections.push(json!({ "title": title, "markdown": markdown, "steps": steps }));
        }
        let dtitle = clip(&doc["title"], 200);
        out.insert("document".into(), json!({ "title": if dtitle.is_empty() { "Регламент".to_owned() } else { dtitle }, "sections": sections }));
    }
    Ok(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> Value {
        json!({
            "process": { "title": "Согласование", "nodes": [
                { "id": "n1", "type": "start", "name": "Старт" },
                { "id": "n2", "type": "task", "name": "Проверить заявку" },
                { "id": "n3", "type": "end", "name": "Конец" } ],
              "flows": [ { "from": "n1", "to": "n2" }, { "from": "n2", "to": "n3", "label": "Да" } ] },
            "document": { "title": "Регламент", "sections": [
                { "title": "§ 1. Цель", "markdown": "Текст", "steps": [] },
                { "title": "§ 2. Порядок", "markdown": "Шаги", "steps": ["n2", "нет-такого"] } ] }
        })
    }

    #[test]
    fn extracts_json_from_fenced_answer() {
        let t = format!("Вот результат:\n```json\n{}\n```\nГотово", good());
        assert!(extract_json(&t).is_some());
        assert!(extract_json("никакого json").is_none());
    }

    #[test]
    fn normalizes_and_drops_unknown_steps() {
        let n = normalize(&good()).unwrap();
        assert_eq!(n["document"]["sections"][1]["steps"], json!(["n2"]));
        assert_eq!(n["process"]["flows"][1]["label"], "Да");
    }

    #[test]
    fn rejects_broken_graphs() {
        let mut v = good();
        v["process"]["flows"][0]["to"] = "zzz".into();
        assert!(normalize(&v).is_err(), "переход в несуществующий шаг");

        let mut v = good();
        v["process"]["nodes"][2]["id"] = "n2".into();
        assert!(normalize(&v).is_err(), "повторяющийся id");

        let mut v = good();
        v["process"]["nodes"][0]["type"] = "task".into();
        assert!(normalize(&v).is_err(), "нет начала");

        let mut v = good();
        v["process"]["nodes"][1]["type"] = "script".into();
        assert!(normalize(&v).is_err(), "неизвестный тип");
    }

    fn run_sse(raw: &str) -> (Vec<String>, Result<String, String>) {
        let mut sse = Sse::default();
        let deltas = raw.lines().filter_map(|l| sse.feed(l)).collect();
        (deltas, sse.finish())
    }

    #[test]
    fn parses_sse_stream_and_yields_deltas() {
        let raw = "event: x\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"a\\\"\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\":1}\"}\n\ndata: {\"type\":\"response.completed\"}\n\ndata: [DONE]\n";
        let (deltas, res) = run_sse(raw);
        assert_eq!(deltas, vec!["{\"a\"", ":1}"]);
        assert_eq!(res.unwrap(), "{\"a\":1}");
        let (_, failed) = run_sse("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"плохо\"}}}\n");
        assert!(failed.unwrap_err().contains("плохо"));
        assert!(run_sse("").1.is_err());
    }

    #[test]
    fn falls_back_to_done_text() {
        let (deltas, res) = run_sse("data: {\"type\":\"response.output_text.done\",\"text\":\"готово\"}\n");
        assert!(deltas.is_empty());
        assert_eq!(res.unwrap(), "готово");
    }

    #[test]
    fn reply_only_answer_is_valid() {
        let n = normalize(&json!({ "reply": "Пока не хватает данных: кто согласует?" })).unwrap();
        assert_eq!(n["reply"], "Пока не хватает данных: кто согласует?");
        assert!(n.get("process").is_none() && n.get("document").is_none());
        assert!(normalize(&json!({})).is_err(), "ни реплики, ни процесса");
        assert!(normalize(&json!({ "reply": "  " })).is_err());
    }

    #[test]
    fn document_is_optional_with_process() {
        let mut v = good();
        v["reply"] = "Построил схему".into();
        v.as_object_mut().unwrap().remove("document");
        let n = normalize(&v).unwrap();
        assert_eq!(n["reply"], "Построил схему");
        assert!(n.get("document").is_none());
        assert_eq!(n["process"]["nodes"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn builds_input_with_history_and_board() {
        let h = vec![
            Turn { role: "user".into(), text: "Построй процесс отпуска".into() },
            Turn { role: "assistant".into(), text: "Построил.".into() },
            Turn { role: "system".into(), text: "игнорируется".into() },
            Turn { role: "user".into(), text: "   ".into() },
        ];
        let s = build_input("Добавь отказ", "Процесс «Отпуск»", &h);
        assert!(s.starts_with("Предыдущий диалог:\nПользователь: Построй процесс отпуска\nИИ: Построил.\n\n"));
        assert!(!s.contains("игнорируется"));
        assert!(s.contains("Новое сообщение пользователя:\nДобавь отказ"));
        assert!(s.ends_with("Что уже есть на доске:\nПроцесс «Отпуск»"));
        assert_eq!(build_input("Привет", "", &[]), "Новое сообщение пользователя:\nПривет");
    }

    #[test]
    fn history_is_trimmed_to_last_turns() {
        let h: Vec<Turn> = (0..30).map(|i| Turn { role: "user".into(), text: format!("реплика {i}") }).collect();
        let s = build_input("x", "", &h);
        assert!(s.contains("реплика 29") && s.contains("реплика 18"));
        assert!(!s.contains("реплика 17"));
    }

    #[test]
    fn only_known_models() {
        assert_eq!(model_id("6.1-sol"), Some("gpt-6.1-sol"));
        assert_eq!(model_id("6.1-terra"), Some("gpt-6.1-terra"));
        assert_eq!(model_id("gpt-4"), None);
    }
}

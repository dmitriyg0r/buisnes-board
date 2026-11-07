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

const INSTRUCTIONS: &str = r#"Ты бизнес-аналитик и помощник на доске бизнес-процессов: ведёшь диалог в чате и выполняешь действия на доске. Всё на русском языке.

Верни ТОЛЬКО один JSON-объект, без пояснений и без markdown-обёртки. Ключи строго в таком порядке, добавляй только те, что нужны:
{
  "reply": "ответ пользователю: 1-4 предложения",
  "processes": [
    { "key": "p1", "title": "название процесса",
      "nodes": [ { "id": "n1", "type": "start|task|gateway|end", "name": "текст" } ],
      "flows": [ { "from": "n1", "to": "n2", "label": "необязательная подпись ветки" } ] }
  ],
  "documents": [
    { "title": "название документа", "process": "p1", "markdown": "свободный текст документа",
      "sections": [ { "title": "§ 1. Название пункта", "markdown": "текст пункта", "steps": ["n2"] } ] }
  ],
  "updates": [ { "id": "id с доски", "title": "новое название", "append": "текст, который дописать в конец документа" } ]
}

Что ты умеешь:
- Создавать процессы (до 5) и документы (до 20) в любом количестве и с любым содержимым, в том числе пустые документы или документы с названием из одного номера. Просьбу создать документы выполняй буквально: столько, сколько просили, и с теми названиями, какие просили. Не добавляй им текст и пункты, если об этом не просили (тогда в документе только title).
- Создавать регламент к процессу: в документе укажи "process" (key процесса из этого же ответа) и пункты в "sections", а в "steps" пунктов перечисли id узлов этого процесса. Для обычного документа без привязки к процессу используй только "markdown" или вообще ничего.
- Переименовывать существующие процессы и документы и дописывать текст в конец существующего документа: через "updates"; id бери из описания доски в квадратных скобках «[id: ...]». Пользователь может отменить любое твоё действие, поэтому не переспрашивай по пустякам.
- Отвечать на вопросы без действий: тогда только "reply".
- Ты не умеешь: заменять текст существующего документа целиком, менять схему существующего процесса, двигать карточки, удалять, читать содержимое PDF и DOCX (видны только названия). Скажи об этом в "reply". Если просят доработать существующий процесс, построй новую версию как новый процесс с названием вроде «Название (версия 2)» и скажи об этом.

Правила диалога:
- "reply" есть всегда: это то, что пользователь прочитает в чате. Коротко скажи, что сделал.
- Действия добавляй, только когда о них просят. На вопросы, благодарности и уточнения отвечай одним "reply".
- Для моделирования процесса данных должно хватать: если не хватает, не строй его, а в "reply" задай 1-3 конкретных вопроса. Простые просьбы (создать документы, переименовать) выполняй сразу.
- Не повторяй уже построенное, если об этом не просили.

Правила модели процесса:
- id узлов: латиница, цифры, «_» и «-», уникальные внутри процесса (n1, n2, ...). key процессов: p1, p2, ...
- Ровно один узел типа start и хотя бы один end. Каждый узел достижим от start, из каждого узла (кроме end) есть выход.
- task называй глаголом действия («Проверить заявку»). gateway: развилка или слияние; у каждой исходящей ветки gateway задай label («Да», «Нет», условие).
- Не больше 40 узлов в процессе; не делай лишней детализации.

Правила регламента:
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
    /// проект, на доске которого идёт генерация: его участники видят черновик в реальном времени
    project_id: Option<Uuid>,
}

/// Пересылает кусочки ответа модели остальным участникам проекта (SSE-поток проекта).
/// Кусочки копятся и уходят не чаще раза в 100 мс, чтобы не засорять канал.
struct Relay {
    room: Option<(AppState, Uuid, Uuid, String)>,
    buf: String,
    last: std::time::Instant,
}

impl Relay {
    fn new(room: Option<(AppState, Uuid, Uuid, String)>) -> Self {
        Relay { room, buf: String::new(), last: std::time::Instant::now() }
    }
    fn send(&self, kind: &str, text: &str) {
        if let Some((s, project, user, name)) = &self.room {
            crate::routes::presence::publish(
                s,
                *project,
                crate::routes::presence::Ev::new(json!({ "t": "ai", "k": kind, "u": user, "n": name, "d": text }), Some(*user)),
            );
        }
    }
    fn push(&mut self, d: &str) {
        if self.room.is_none() {
            return;
        }
        self.buf.push_str(d);
        if self.last.elapsed() >= Duration::from_millis(100) {
            self.flush();
        }
    }
    fn flush(&mut self) {
        if !self.buf.is_empty() {
            let text = std::mem::take(&mut self.buf);
            self.send("delta", &text);
        }
        self.last = std::time::Instant::now();
    }
    fn finish(&mut self) {
        self.flush();
        self.send("end", "");
    }
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
    // участник проекта: чужой проект выглядит как несуществующий
    let room = match b.project_id {
        Some(pid) => {
            crate::routes::ensure_project(&s.db, pid, user.id).await?;
            let name = crate::routes::presence::display_name(&s, user.id).await?;
            Some((s.clone(), pid, user.id, name))
        }
        None => None,
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
        let mut relay = Relay::new(room);
        relay.send("start", "");
        let done = match stream_codex(&s, uid, model, &input, &tx, &mut relay).await {
            Ok(text) => finish(&text),
            Err(m) => Err(m),
        };
        relay.finish();
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
async fn stream_codex(s: &AppState, user: Uuid, model: &str, input: &str, tx: &Tx, relay: &mut Relay) -> Result<String, String> {
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
                            relay.push(&d);
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

const MAX_PROCESSES: usize = 5;
const MAX_DOCS: usize = 20;
const MAX_UPDATES: usize = 20;

/// Проверяет один процесс. Возвращает его очищенный вид и множество id шагов (для привязки пунктов документов).
fn normalize_process(p: &Value) -> Result<(Value, HashSet<String>), String> {
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
    let title = clip(&p["title"], 200);
    Ok((json!({ "title": if title.is_empty() { "Процесс".to_owned() } else { title }, "nodes": nodes, "flows": flows }), ids))
}

/// Проверяет и чистит ответ модели: клиент получает только то, что точно сможет показать и применить.
/// Реплика есть всегда; процессы, документы и правки необязательны (на вопрос модель отвечает одной репликой).
/// Старый формат с одним `process` и одним `document` тоже понимаем.
fn normalize(v: &Value) -> Result<Value, String> {
    let reply = clip(&v["reply"], 2000);

    let procs_in: Vec<Value> = match v["processes"].as_array() {
        Some(a) => a.clone(),
        None if !v["process"].is_null() => vec![v["process"].clone()],
        None => vec![],
    };
    let docs_in: Vec<Value> = match v["documents"].as_array() {
        Some(a) => a.clone(),
        None if !v["document"].is_null() => {
            let mut d = v["document"].clone();
            if d["process"].is_null() && !procs_in.is_empty() {
                d["process"] = Value::from("p1");
            }
            vec![d]
        }
        None => vec![],
    };
    if procs_in.len() > MAX_PROCESSES {
        return Err(format!("процессов не больше {MAX_PROCESSES}"));
    }
    if docs_in.len() > MAX_DOCS {
        return Err(format!("документов не больше {MAX_DOCS}"));
    }

    let mut processes = Vec::new();
    let mut by_key: std::collections::HashMap<String, HashSet<String>> = std::collections::HashMap::new();
    for (i, p) in procs_in.iter().enumerate() {
        let (mut clean, ids) = normalize_process(p)?;
        let mut key = clip(&p["key"], 40);
        if !valid_id(&key) || by_key.contains_key(&key) {
            key = format!("p{}", i + 1);
        }
        clean["key"] = Value::from(key.clone());
        by_key.insert(key, ids);
        processes.push(clean);
    }

    let mut documents = Vec::new();
    for d in &docs_in {
        let title = clip(&d["title"], 200);
        // привязка к процессу только по ключу из этого же ответа
        let key = clip(&d["process"], 40);
        let ids = by_key.get(&key);
        let mut sections = Vec::new();
        let secs_in: &[Value] = d["sections"].as_array().map_or(&[], |a| a.as_slice());
        if secs_in.len() > MAX_SECTIONS {
            return Err(format!("пунктов не больше {MAX_SECTIONS}"));
        }
        for sec in secs_in {
            let st = clip(&sec["title"], 200);
            if st.is_empty() {
                return Err("у пункта нет заголовка".into());
            }
            let markdown: String = sec["markdown"].as_str().unwrap_or("").trim().chars().take(8000).collect();
            // ссылки на несуществующие шаги молча отбрасываем
            let steps: Vec<Value> = match ids {
                Some(ids) => sec["steps"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| ids.contains(*x)).map(Value::from).collect()).unwrap_or_default(),
                None => vec![],
            };
            sections.push(json!({ "title": st, "markdown": markdown, "steps": steps }));
        }
        let mut o = Map::new();
        o.insert("title".into(), if title.is_empty() { "Документ".to_owned() } else { title }.into());
        if ids.is_some() {
            o.insert("process".into(), key.into());
        }
        let body: String = d["markdown"].as_str().unwrap_or("").trim().chars().take(8000).collect();
        if !body.is_empty() {
            o.insert("markdown".into(), body.into());
        }
        o.insert("sections".into(), Value::Array(sections));
        documents.push(Value::Object(o));
    }

    // правки существующих объектов: переименование и дописывание; существование id проверяет клиент
    let mut updates = Vec::new();
    for u in v["updates"].as_array().map_or(&[][..], |a| a.as_slice()).iter().take(MAX_UPDATES) {
        let id = clip(&u["id"], 40);
        let title = clip(&u["title"], 200);
        let append: String = u["append"].as_str().unwrap_or("").trim().chars().take(8000).collect();
        if !valid_id(&id) || (title.is_empty() && append.is_empty()) {
            continue;
        }
        let mut o = Map::new();
        o.insert("id".into(), id.into());
        if !title.is_empty() {
            o.insert("title".into(), title.into());
        }
        if !append.is_empty() {
            o.insert("append".into(), append.into());
        }
        updates.push(Value::Object(o));
    }

    if processes.is_empty() && documents.is_empty() && updates.is_empty() && reply.is_empty() {
        return Err("пустой ответ".into());
    }
    let mut out = Map::new();
    out.insert("reply".into(), reply.into());
    if !processes.is_empty() {
        out.insert("processes".into(), Value::Array(processes));
    }
    if !documents.is_empty() {
        out.insert("documents".into(), Value::Array(documents));
    }
    if !updates.is_empty() {
        out.insert("updates".into(), Value::Array(updates));
    }
    Ok(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;


    /// Черновик ИИ уходит участникам проекта пачками: начало, текст, конец; автору события не возвращаются (фильтр в потоке).
    #[tokio::test]
    async fn relay_sends_start_text_end() {
        use crate::routes::presence::Ev;
        let db = sqlx::postgres::PgPoolOptions::new().connect_lazy("postgres://x@127.0.0.1:1/x").unwrap();
        let cfg = crate::Config { cookie_secure: false, allow_registration: true, dummy_hash: String::new(), secrets_key: None, openai_proxy: None };
        let s = crate::AppState {
            db, cfg,
            limiter: Default::default(), http: reqwest::Client::new(), ai_busy: Default::default(),
            rooms: Default::default(), names: Default::default(), codex_flows: Default::default(),
        };
        let (project, user) = (Uuid::new_v4(), Uuid::new_v4());
        let (tx, mut rx) = tokio::sync::broadcast::channel::<Ev>(16);
        s.rooms.lock().unwrap().insert(project, tx);
        let mut relay = Relay::new(Some((s.clone(), project, user, "Анна".into())));
        relay.send("start", "");
        relay.push("{\"rep");
        relay.push("ly\":\"ok\"}");
        relay.finish();
        let mut kinds = Vec::new();
        let mut text = String::new();
        while let Ok(ev) = rx.try_recv() {
            let v: Value = serde_json::from_str(&ev.json).unwrap();
            assert_eq!(v["t"], "ai");
            assert_eq!(v["n"], "Анна");
            assert_eq!(ev.from, Some(user));
            kinds.push(v["k"].as_str().unwrap().to_string());
            if v["k"] == "delta" { text.push_str(v["d"].as_str().unwrap()); }
        }
        assert_eq!(kinds.first().map(String::as_str), Some("start"));
        assert_eq!(kinds.last().map(String::as_str), Some("end"));
        assert_eq!(text, "{\"reply\":\"ok\"}");
    }

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
        assert_eq!(n["documents"][0]["sections"][1]["steps"], json!(["n2"]));
        assert_eq!(n["processes"][0]["flows"][1]["label"], "Да");
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
        assert!(n.get("processes").is_none() && n.get("documents").is_none() && n.get("updates").is_none());
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
        assert!(n.get("documents").is_none());
        assert_eq!(n["processes"][0]["nodes"].as_array().unwrap().len(), 3);
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
    fn standalone_documents_need_no_process_or_sections() {
        let docs: Vec<Value> = (1..=10).map(|i| json!({ "title": i.to_string() })).collect();
        let n = normalize(&json!({ "reply": "Создал 10 документов", "documents": docs })).unwrap();
        let d = n["documents"].as_array().unwrap();
        assert_eq!(d.len(), 10);
        assert_eq!(d[9]["title"], "10");
        assert_eq!(d[0]["sections"], json!([]));
        assert!(d[0].get("process").is_none() && d[0].get("markdown").is_none());
        assert!(n.get("processes").is_none());
    }

    #[test]
    fn too_many_documents_rejected() {
        let docs: Vec<Value> = (0..21).map(|i| json!({ "title": format!("д{i}") })).collect();
        assert!(normalize(&json!({ "documents": docs })).is_err());
    }

    #[test]
    fn several_processes_and_steps_bind_to_their_own_process() {
        let p = |t: &str, id: &str| json!({ "title": t, "nodes": [
            { "id": "s", "type": "start", "name": "" }, { "id": id, "type": "task", "name": "Шаг" }, { "id": "e", "type": "end", "name": "" } ],
            "flows": [ { "from": "s", "to": id }, { "from": id, "to": "e" } ] });
        let mut p1 = p("Первый", "a1");
        p1["key"] = "p1".into();
        let mut p2 = p("Второй", "b1");
        p2["key"] = "p2".into();
        let v = json!({ "reply": "ok", "processes": [p1, p2], "documents": [
            { "title": "Рег 2", "process": "p2", "sections": [ { "title": "§ 1", "markdown": "x", "steps": ["b1", "a1"] } ] },
            { "title": "Без процесса", "process": "нет-такого", "sections": [ { "title": "§ 1", "markdown": "x", "steps": ["b1"] } ] } ] });
        let n = normalize(&v).unwrap();
        assert_eq!(n["processes"].as_array().unwrap().len(), 2);
        assert_eq!(n["documents"][0]["process"], "p2");
        // шаг чужого процесса отброшен
        assert_eq!(n["documents"][0]["sections"][0]["steps"], json!(["b1"]));
        // неизвестный процесс: привязки нет, шаги не сохраняются
        assert!(n["documents"][1].get("process").is_none());
        assert_eq!(n["documents"][1]["sections"][0]["steps"], json!([]));
    }

    #[test]
    fn updates_are_cleaned() {
        let v = json!({ "reply": "ok", "updates": [
            { "id": "d1", "title": "  Новое  " }, { "id": "d2", "append": "дописать" },
            { "id": "bad id!", "title": "x" }, { "id": "d3" }, { "title": "без id" } ] });
        let n = normalize(&v).unwrap();
        let u = n["updates"].as_array().unwrap();
        assert_eq!(u.len(), 2);
        assert_eq!(u[0], json!({ "id": "d1", "title": "Новое" }));
        assert_eq!(u[1], json!({ "id": "d2", "append": "дописать" }));
    }

    #[test]
    fn only_known_models() {
        assert_eq!(model_id("6.1-sol"), Some("gpt-6.1-sol"));
        assert_eq!(model_id("6.1-terra"), Some("gpt-6.1-terra"));
        assert_eq!(model_id("gpt-4"), None);
    }
}

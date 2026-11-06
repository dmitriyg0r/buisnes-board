//! Генерация процесса и документации моделью ChatGPT (тот же вход, что и у Codex CLI).
//! Вызов идёт на недокументированный адрес `chatgpt.com/backend-api/codex/responses`:
//! формат может измениться без предупреждения.

use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::time::Duration;
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
/// Генерация длинная: общий лимит клиента (10 с) здесь не подходит.
const CALL_TIMEOUT: Duration = Duration::from_secs(180);

const INSTRUCTIONS: &str = r#"Ты бизнес-аналитик. По описанию пользователя и материалам на доске ты строишь модель бизнес-процесса и пишешь к ней регламент на русском языке.

Верни ТОЛЬКО один JSON-объект, без пояснений и без markdown-обёртки, строго такой формы:
{
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

Правила модели процесса:
- id узлов: латиница, цифры, «_» и «-», уникальные (n1, n2, ...).
- Ровно один узел типа start и хотя бы один end. Каждый узел достижим от start, из каждого узла (кроме end) есть выход.
- task называй глаголом действия («Проверить заявку»). gateway — развилка или слияние; у каждой исходящей ветки gateway задай label («Да», «Нет», условие).
- Не больше 40 узлов; не делай лишней детализации.

Правила документа:
- Заголовки пунктов нумеруй: «§ 1. Цель», «§ 2. Участники», «§ 3. Порядок выполнения» и т. д. Подпункты — «§ 3.1. ...».
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
}

pub async fn generate(State(s): State<AppState>, user: AuthUser, Json(b): Json<GenerateReq>) -> AppResult<Json<Value>> {
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

    // одна генерация на человека: токен и лимиты ChatGPT общие
    if !s.ai_busy.lock().map_err(|_| AppError::Internal)?.insert(user.id) {
        return Err(AppError::BadRequest("предыдущая генерация ещё идёт: дождитесь результата".into()));
    }
    let input = if context.trim().is_empty() {
        format!("Задача пользователя:\n{prompt}")
    } else {
        format!("Задача пользователя:\n{prompt}\n\nЧто уже есть на доске:\n{context}")
    };
    let res = run(&s, user.id, model, &input).await;
    if let Ok(mut busy) = s.ai_busy.lock() {
        busy.remove(&user.id);
    }
    Ok(Json(res?))
}

async fn run(s: &AppState, user: Uuid, model: &str, input: &str) -> AppResult<Value> {
    let text = call_codex(s, user, model, input).await?;
    let v = extract_json(&text).ok_or_else(|| AppError::Upstream("модель вернула ответ не в том формате, попробуйте ещё раз".into()))?;
    normalize(&v).map_err(|why| {
        tracing::warn!("ответ модели отклонён: {why}");
        AppError::Upstream(format!("модель построила некорректный процесс ({why}), попробуйте ещё раз"))
    })
}

async fn call_codex(s: &AppState, user: Uuid, model: &str, input: &str) -> AppResult<String> {
    let body = json!({
        "model": model,
        "store": false,
        "stream": true,
        "instructions": INSTRUCTIONS,
        "input": [ { "type": "message", "role": "user", "content": [ { "type": "input_text", "text": input } ] } ],
    });
    // два захода: при отказе 401 один раз принудительно обновляем токен
    for attempt in 0..2 {
        let (token, account) = access_token(s, user, attempt == 1).await?;
        let res = s
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
                AppError::Upstream("не удалось связаться с OpenAI, попробуйте позже".into())
            })?;
        let status = res.status().as_u16();
        match status {
            200..=299 => {
                let raw = res.text().await.map_err(|_| AppError::Upstream("ответ модели оборвался, попробуйте ещё раз".into()))?;
                return parse_sse(&raw).map_err(AppError::Upstream);
            }
            401 if attempt == 0 => continue,
            401 => return Err(AppError::Upstream("ChatGPT отклонил доступ: подключите его заново в настройках".into())),
            403 => return Err(AppError::Upstream("OpenAI недоступен из региона сервера или доступ запрещён".into())),
            429 => return Err(AppError::Upstream("лимит ChatGPT исчерпан, попробуйте позже".into())),
            _ => {
                tracing::warn!("модель ответила HTTP {status}");
                return Err(AppError::Upstream("OpenAI ответил ошибкой, попробуйте позже".into()));
            }
        }
    }
    Err(AppError::Internal)
}

/// Собирает текст ответа из потока событий Responses API.
fn parse_sse(raw: &str) -> Result<String, String> {
    let mut text = String::new();
    let mut done_text: Option<String> = None;
    let mut failure: Option<String> = None;
    for line in raw.lines() {
        let Some(data) = line.strip_prefix("data:") else { continue };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(ev) = serde_json::from_str::<Value>(data) else { continue };
        match ev["type"].as_str().unwrap_or("") {
            "response.output_text.delta" => {
                if let Some(d) = ev["delta"].as_str() {
                    text.push_str(d);
                }
            }
            "response.output_text.done" => {
                if let Some(t) = ev["text"].as_str() {
                    done_text = Some(t.to_owned());
                }
            }
            "response.failed" => {
                failure = ev["response"]["error"]["message"].as_str().map(str::to_owned).or(Some("модель не смогла ответить".into()));
            }
            "error" => failure = ev["message"].as_str().map(str::to_owned).or(Some("модель не смогла ответить".into())),
            _ => {}
        }
    }
    if text.trim().is_empty() {
        text = done_text.unwrap_or_default();
    }
    if text.trim().is_empty() {
        return Err(failure.map_or_else(|| "модель вернула пустой ответ, попробуйте ещё раз".into(), |m| format!("модель не смогла ответить: {m}")));
    }
    Ok(text)
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

/// Проверяет и чистит ответ модели: клиент получает только то, что точно сможет нарисовать.
fn normalize(v: &Value) -> Result<Value, String> {
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

    let doc = &v["document"];
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
            .map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| ids.contains(*x)).map(|x| Value::from(x)).collect())
            .unwrap_or_default();
        sections.push(json!({ "title": title, "markdown": markdown, "steps": steps }));
    }

    let ptitle = clip(&p["title"], 200);
    let dtitle = clip(&doc["title"], 200);
    Ok(json!({
        "process": { "title": if ptitle.is_empty() { "Процесс".to_owned() } else { ptitle }, "nodes": nodes, "flows": flows },
        "document": { "title": if dtitle.is_empty() { "Регламент".to_owned() } else { dtitle }, "sections": sections },
    }))
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

    #[test]
    fn parses_sse_stream() {
        let raw = "event: x\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"a\\\"\"}\n\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\":1}\"}\n\ndata: {\"type\":\"response.completed\"}\n\ndata: [DONE]\n";
        assert_eq!(parse_sse(raw).unwrap(), "{\"a\":1}");
        let failed = "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"плохо\"}}}\n";
        assert!(parse_sse(failed).unwrap_err().contains("плохо"));
        assert!(parse_sse("").is_err());
    }

    #[test]
    fn only_known_models() {
        assert_eq!(model_id("6.1-sol"), Some("gpt-6.1-sol"));
        assert_eq!(model_id("6.1-terra"), Some("gpt-6.1-terra"));
        assert_eq!(model_id("gpt-4"), None);
    }
}

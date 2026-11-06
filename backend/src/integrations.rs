use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    AeadCore, Aes256Gcm, Key, Nonce,
};
use axum::{extract::State, http::StatusCode, Json};
use base64::Engine;
use std::time::{Duration, Instant};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::AppState;

const CODEX: &str = "codex";

// Вход через ChatGPT повторяет device-code вход Codex CLI и использует его OAuth-клиент.
// У OpenAI это не документированный API для сторонних сервисов: адреса и параметры могут измениться.
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE: &str = "https://auth.openai.com";
const VERIFY_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT: &str = "https://auth.openai.com/deviceauth/callback";
const FLOW_TTL: Duration = Duration::from_secs(15 * 60);
const KIND_CHATGPT: &str = "chatgpt";

/// Разбирает SECRETS_KEY: 64 шестнадцатеричных символа (32 байта).
pub fn parse_secrets_key(s: &str) -> Result<[u8; 32], String> {
    let s = s.trim();
    if s.len() != 64 || !s.is_ascii() {
        return Err("SECRETS_KEY должен содержать 64 шестнадцатеричных символа (openssl rand -hex 32)".into());
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|_| "SECRETS_KEY содержит не шестнадцатеричные символы".to_string())?;
    }
    Ok(out)
}

fn cipher(s: &AppState) -> AppResult<Aes256Gcm> {
    let key = s.cfg.secrets_key.ok_or_else(|| AppError::Unavailable("на сервере не задан SECRETS_KEY: подключение сервисов недоступно".into()))?;
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key)))
}

/// nonce (12 байт) + шифртекст; идентификатор пользователя входит в аутентифицируемые данные,
/// поэтому строку нельзя подсунуть другому пользователю.
fn encrypt(c: &Aes256Gcm, user: Uuid, plain: &str) -> AppResult<Vec<u8>> {
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = c
        .encrypt(&nonce, Payload { msg: plain.as_bytes(), aad: user.as_bytes() })
        .map_err(|_| AppError::Internal)?;
    let mut out = nonce.to_vec();
    out.extend(ct);
    Ok(out)
}

fn decrypt(c: &Aes256Gcm, user: Uuid, data: &[u8]) -> AppResult<String> {
    if data.len() < 13 {
        return Err(AppError::Internal);
    }
    let (n, ct) = data.split_at(12);
    let plain = c
        .decrypt(Nonce::from_slice(n), Payload { msg: ct, aad: user.as_bytes() })
        .map_err(|_| AppError::Internal)?;
    String::from_utf8(plain).map_err(|_| AppError::Internal)
}

/// Начатый вход: код показан пользователю, ждём подтверждения на стороне OpenAI.
pub struct DeviceFlow {
    device_auth_id: String,
    user_code: String,
    started: Instant,
    interval: Duration,
    last_poll: Option<Instant>,
}

/// Токены ChatGPT; хранятся только в зашифрованном виде.
#[derive(Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    /// unix-время истечения access_token, секунды
    expires_at: i64,
    account_id: Option<String>,
}

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: Option<i64>,
}

fn upstream_down() -> AppError {
    AppError::Upstream("не удалось связаться с OpenAI, попробуйте позже".into())
}

/// Содержимое (payload) JWT без проверки подписи: токен получен напрямую от OpenAI по TLS,
/// из него читаем только идентификатор аккаунта и почту для подписи в интерфейсе.
fn jwt_claims(token: &str) -> Option<Value> {
    let part = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(part.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn account_id(access_token: &str) -> Option<String> {
    let c = jwt_claims(access_token)?;
    c.pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")
        .or_else(|| c.get("https://api.openai.com/auth").and_then(|a| a.get("chatgpt_account_id")))
        .or_else(|| c.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
        .map(str::to_owned)
}

fn hint_for(id_token: Option<&str>, account: Option<&str>) -> String {
    let email = id_token.and_then(jwt_claims).and_then(|c| c.get("email").and_then(|v| v.as_str()).map(str::to_owned));
    let h = email.or_else(|| account.map(|a| format!("…{}", &a[a.len().saturating_sub(4)..])));
    h.filter(|h| h.len() <= 120).unwrap_or_else(|| "ChatGPT".into())
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Запрос к /oauth/token (обмен кода или обновление). Тела ответов и токены не логируются.
async fn token_request(s: &AppState, form: &[(&str, &str)]) -> AppResult<TokenResp> {
    let res = s.http.post(format!("{AUTH_BASE}/oauth/token")).form(form).send().await.map_err(|_| upstream_down())?;
    match res.status().as_u16() {
        200..=299 => res.json::<TokenResp>().await.map_err(|_| AppError::Upstream("OpenAI вернул неожиданный ответ".into())),
        400 | 401 | 403 => Err(AppError::BadRequest("OpenAI отклонил вход: подключите ChatGPT заново".into())),
        429 => Err(AppError::Upstream("OpenAI временно ограничил запросы, попробуйте позже".into())),
        _ => Err(AppError::Upstream("OpenAI ответил ошибкой, попробуйте позже".into())),
    }
}

#[derive(Serialize)]
pub struct Status {
    connected: bool,
    hint: Option<String>,
    updated_at: Option<DateTime<Utc>>,
    /// false, если на сервере нет SECRETS_KEY и подключить сервис нельзя
    available: bool,
    /// true для старого подключения по API-ключу: его нужно заменить входом через ChatGPT
    legacy: bool,
}

async fn status(s: &AppState, user: Uuid) -> AppResult<Status> {
    let row: Option<(String, DateTime<Utc>, String)> =
        sqlx::query_as("SELECT key_hint, updated_at, kind FROM integrations WHERE user_id = $1 AND provider = $2")
            .bind(user)
            .bind(CODEX)
            .fetch_optional(&s.db)
            .await?;
    Ok(Status {
        connected: row.is_some(),
        legacy: row.as_ref().is_some_and(|r| r.2 != KIND_CHATGPT),
        hint: row.as_ref().map(|r| r.0.clone()),
        updated_at: row.map(|r| r.1),
        available: s.cfg.secrets_key.is_some(),
    })
}

pub async fn get_codex(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Status>> {
    Ok(Json(status(&s, user.id).await?))
}

async fn save(s: &AppState, c: &Aes256Gcm, user: Uuid, t: &Tokens, hint: Option<&str>) -> AppResult<()> {
    let plain = serde_json::to_string(t).map_err(|_| AppError::Internal)?;
    let enc = encrypt(c, user, &plain)?;
    // подпись (hint) при обновлении токенов не меняется
    sqlx::query(
        "INSERT INTO integrations (user_id, provider, secret_enc, key_hint, kind) VALUES ($1, $2, $3, COALESCE($4, 'ChatGPT'), $5) \
         ON CONFLICT (user_id, provider) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, kind = EXCLUDED.kind, updated_at = now(), \
         key_hint = COALESCE($4, integrations.key_hint)",
    )
    .bind(user)
    .bind(CODEX)
    .bind(enc)
    .bind(hint)
    .bind(KIND_CHATGPT)
    .execute(&s.db)
    .await?;
    Ok(())
}

/// Шаг 1: получаем у OpenAI одноразовый код, который пользователь вводит на странице OpenAI.
pub async fn start_device(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    cipher(&s)?;
    let res = s
        .http
        .post(format!("{AUTH_BASE}/api/accounts/deviceauth/usercode"))
        .json(&json!({ "client_id": CLIENT_ID }))
        .send()
        .await
        .map_err(|_| upstream_down())?;
    match res.status().as_u16() {
        200..=299 => {}
        404 => {
            return Err(AppError::BadRequest(
                "вход по коду выключен: включите его в настройках безопасности ChatGPT (или в разрешениях рабочего пространства)".into(),
            ))
        }
        429 => return Err(AppError::Upstream("OpenAI временно ограничил запросы, попробуйте позже".into())),
        _ => return Err(AppError::Upstream("OpenAI ответил ошибкой, попробуйте позже".into())),
    }
    let v: Value = res.json().await.map_err(|_| AppError::Upstream("OpenAI вернул неожиданный ответ".into()))?;
    let (Some(id), Some(code)) = (v["device_auth_id"].as_str(), v["user_code"].as_str()) else {
        return Err(AppError::Upstream("OpenAI вернул неожиданный ответ".into()));
    };
    // interval приходит строкой ("5"), на всякий случай понимаем и число
    let secs = v["interval"].as_u64().or_else(|| v["interval"].as_str().and_then(|x| x.parse().ok())).unwrap_or(5).clamp(3, 30);

    s.codex_flows.lock().map_err(|_| AppError::Internal)?.insert(
        user.id,
        DeviceFlow { device_auth_id: id.to_owned(), user_code: code.to_owned(), started: Instant::now(), interval: Duration::from_secs(secs), last_poll: None },
    );
    Ok(Json(json!({
        "user_code": code,
        "verification_url": VERIFY_URL,
        "interval": secs,
        "expires_in": FLOW_TTL.as_secs(),
    })))
}

/// Шаг 2: клиент опрашивает, пока пользователь не подтвердит код на стороне OpenAI.
pub async fn poll_device(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let c = cipher(&s)?;
    let (id, code) = {
        let mut flows = s.codex_flows.lock().map_err(|_| AppError::Internal)?;
        let Some(f) = flows.get_mut(&user.id) else {
            return Err(AppError::BadRequest("вход не начат или код истёк: начните заново".into()));
        };
        if f.started.elapsed() > FLOW_TTL {
            flows.remove(&user.id);
            return Err(AppError::BadRequest("код истёк: начните заново".into()));
        }
        if f.last_poll.is_some_and(|l| l.elapsed() < f.interval) {
            return Ok(Json(json!({ "state": "pending" })));
        }
        f.last_poll = Some(Instant::now());
        (f.device_auth_id.clone(), f.user_code.clone())
    };

    let res = s
        .http
        .post(format!("{AUTH_BASE}/api/accounts/deviceauth/token"))
        .json(&json!({ "device_auth_id": id, "user_code": code }))
        .send()
        .await
        .map_err(|_| upstream_down())?;
    let status_code = res.status().as_u16();
    if !(200..=299).contains(&status_code) {
        let body: Value = res.json().await.unwrap_or(Value::Null);
        let err = body["error"].as_str().or_else(|| body["error"]["code"].as_str()).unwrap_or("");
        if status_code == 403 || status_code == 404 || err == "deviceauth_authorization_pending" {
            return Ok(Json(json!({ "state": "pending" })));
        }
        if err == "slow_down" {
            if let Some(f) = s.codex_flows.lock().map_err(|_| AppError::Internal)?.get_mut(&user.id) {
                f.interval += Duration::from_secs(5);
            }
            return Ok(Json(json!({ "state": "pending" })));
        }
        s.codex_flows.lock().map_err(|_| AppError::Internal)?.remove(&user.id);
        return Err(AppError::BadRequest("вход отклонён или код истёк: начните заново".into()));
    }
    let v: Value = res.json().await.map_err(|_| AppError::Upstream("OpenAI вернул неожиданный ответ".into()))?;
    let (Some(auth_code), Some(verifier)) = (v["authorization_code"].as_str(), v["code_verifier"].as_str()) else {
        return Err(AppError::Upstream("OpenAI вернул неожиданный ответ".into()));
    };

    let t = token_request(
        &s,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", auth_code),
            ("code_verifier", verifier),
            ("redirect_uri", DEVICE_REDIRECT),
        ],
    )
    .await?;
    let Some(refresh) = t.refresh_token.clone() else {
        return Err(AppError::Upstream("OpenAI не выдал токен обновления".into()));
    };
    let account = account_id(&t.access_token);
    let hint = hint_for(t.id_token.as_deref(), account.as_deref());
    let tokens = Tokens { access_token: t.access_token, refresh_token: refresh, expires_at: now_secs() + t.expires_in.unwrap_or(3600), account_id: account };
    save(&s, &c, user.id, &tokens, Some(&hint)).await?;
    s.codex_flows.lock().map_err(|_| AppError::Internal)?.remove(&user.id);
    Ok(Json(json!({ "state": "connected", "status": status(&s, user.id).await? })))
}

/// Проверка подключения: принудительно обновляем токен. Если OpenAI отозвал доступ, скажем об этом.
pub async fn check_codex(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let c = cipher(&s)?;
    let row: Option<(Vec<u8>, String)> = sqlx::query_as("SELECT secret_enc, kind FROM integrations WHERE user_id = $1 AND provider = $2")
        .bind(user.id)
        .bind(CODEX)
        .fetch_optional(&s.db)
        .await?;
    let (enc, kind) = row.ok_or(AppError::NotFound)?;
    if kind != KIND_CHATGPT {
        return Err(AppError::BadRequest("старое подключение по ключу не проверяется: подключите ChatGPT".into()));
    }
    let old: Tokens = serde_json::from_str(&decrypt(&c, user.id, &enc)?).map_err(|_| AppError::Internal)?;
    let t = token_request(&s, &[("grant_type", "refresh_token"), ("refresh_token", &old.refresh_token), ("client_id", CLIENT_ID)]).await?;
    let account = account_id(&t.access_token).or(old.account_id);
    let tokens = Tokens {
        refresh_token: t.refresh_token.unwrap_or(old.refresh_token),
        expires_at: now_secs() + t.expires_in.unwrap_or(3600),
        access_token: t.access_token,
        account_id: account,
    };
    save(&s, &c, user.id, &tokens, None).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_codex(State(s): State<AppState>, user: AuthUser) -> AppResult<StatusCode> {
    s.codex_flows.lock().map_err(|_| AppError::Internal)?.remove(&user.id);
    sqlx::query("DELETE FROM integrations WHERE user_id = $1 AND provider = $2")
        .bind(user.id)
        .bind(CODEX)
        .execute(&s.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cipher_for_test() -> Aes256Gcm {
        let key = parse_secrets_key(&"ab".repeat(32)).unwrap();
        Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key))
    }

    #[test]
    fn roundtrip() {
        let c = cipher_for_test();
        let user = Uuid::new_v4();
        let enc = encrypt(&c, user, "sk-secret-value").unwrap();
        assert!(!enc.windows(15).any(|w| w == b"sk-secret-value"), "секрет не должен лежать открытым текстом");
        assert_eq!(decrypt(&c, user, &enc).unwrap(), "sk-secret-value");
    }

    #[test]
    fn other_user_cannot_decrypt() {
        let c = cipher_for_test();
        let enc = encrypt(&c, Uuid::new_v4(), "sk-secret-value").unwrap();
        assert!(decrypt(&c, Uuid::new_v4(), &enc).is_err());
    }

    #[test]
    fn tampering_is_detected() {
        let c = cipher_for_test();
        let user = Uuid::new_v4();
        let mut enc = encrypt(&c, user, "sk-secret-value").unwrap();
        let last = enc.len() - 1;
        enc[last] ^= 1;
        assert!(decrypt(&c, user, &enc).is_err());
    }

    #[test]
    fn key_parsing() {
        assert!(parse_secrets_key("short").is_err());
        assert!(parse_secrets_key(&"zz".repeat(32)).is_err());
        assert!(parse_secrets_key(&"0f".repeat(32)).is_ok());
    }

    fn fake_jwt(payload: &str) -> String {
        let e = |b: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b);
        format!("{}.{}.sig", e(b"{}"), e(payload.as_bytes()))
    }

    #[test]
    fn account_id_from_nested_claim() {
        let t = fake_jwt(r#"{"https://api.openai.com/auth":{"chatgpt_account_id":"acc-1234"}}"#);
        assert_eq!(account_id(&t).as_deref(), Some("acc-1234"));
        assert_eq!(account_id("not-a-jwt"), None);
    }

    #[test]
    fn hint_prefers_email() {
        let t = fake_jwt(r#"{"email":"a@b.ru"}"#);
        assert_eq!(hint_for(Some(&t), Some("acc-1234")), "a@b.ru");
        assert_eq!(hint_for(None, Some("acc-1234")), "…1234");
        assert_eq!(hint_for(None, None), "ChatGPT");
    }
}

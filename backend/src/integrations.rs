use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    AeadCore, Aes256Gcm, Key, Nonce,
};
use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::AppState;

const CODEX: &str = "codex";

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

/// Проверяет ключ запросом списка моделей. Сам ключ нигде не логируется.
async fn verify(s: &AppState, key: &str) -> AppResult<()> {
    let res = s
        .http
        .get("https://api.openai.com/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|_| AppError::Upstream("не удалось связаться с OpenAI, попробуйте позже".into()))?;
    match res.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(AppError::BadRequest("OpenAI не принял ключ: проверьте, что он скопирован целиком и не отозван".into())),
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
}

async fn status(s: &AppState, user: Uuid) -> AppResult<Status> {
    let row: Option<(String, DateTime<Utc>)> =
        sqlx::query_as("SELECT key_hint, updated_at FROM integrations WHERE user_id = $1 AND provider = $2")
            .bind(user)
            .bind(CODEX)
            .fetch_optional(&s.db)
            .await?;
    Ok(Status {
        connected: row.is_some(),
        hint: row.as_ref().map(|r| r.0.clone()),
        updated_at: row.map(|r| r.1),
        available: s.cfg.secrets_key.is_some(),
    })
}

pub async fn get_codex(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Status>> {
    Ok(Json(status(&s, user.id).await?))
}

#[derive(Deserialize)]
pub struct PutCodex {
    api_key: String,
}

pub async fn put_codex(State(s): State<AppState>, user: AuthUser, Json(b): Json<PutCodex>) -> AppResult<Json<Status>> {
    let c = cipher(&s)?;
    let key = b.api_key.trim();
    if key.len() < 20 || key.len() > 300 || !key.starts_with("sk-") || key.chars().any(|ch| ch.is_whitespace() || ch.is_control()) {
        return Err(AppError::BadRequest("ключ OpenAI начинается с «sk-» и не содержит пробелов".into()));
    }
    verify(&s, key).await?;

    let hint = format!("…{}", &key[key.len() - 4..]);
    sqlx::query(
        "INSERT INTO integrations (user_id, provider, secret_enc, key_hint) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (user_id, provider) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, key_hint = EXCLUDED.key_hint, updated_at = now()",
    )
    .bind(user.id)
    .bind(CODEX)
    .bind(encrypt(&c, user.id, key)?)
    .bind(hint)
    .execute(&s.db)
    .await?;
    Ok(Json(status(&s, user.id).await?))
}

/// Повторная проверка сохранённого ключа.
pub async fn check_codex(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let c = cipher(&s)?;
    let enc: Option<Vec<u8>> = sqlx::query_scalar("SELECT secret_enc FROM integrations WHERE user_id = $1 AND provider = $2")
        .bind(user.id)
        .bind(CODEX)
        .fetch_optional(&s.db)
        .await?;
    let key = decrypt(&c, user.id, &enc.ok_or(AppError::NotFound)?)?;
    verify(&s, &key).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_codex(State(s): State<AppState>, user: AuthUser) -> AppResult<StatusCode> {
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
}

use std::time::{Duration, Instant};

use argon2::{
    password_hash::{rand_core::{OsRng, RngCore}, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    async_trait,
    extract::{FromRequestParts, State},
    http::{header, request::Parts, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::AppState;

const COOKIE: &str = "bb_session";
const SESSION_DAYS: i64 = 30;
const MAX_FAILS: u32 = 10;
const FAIL_WINDOW: Duration = Duration::from_secs(10 * 60);
pub const ROLES: [&str; 3] = ["Бизнес-аналитик", "Методолог", "Владелец процесса"];

#[derive(Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

/// Текущий пользователь. Любой маршрут, принимающий этот параметр, требует входа.
pub struct AuthUser {
    pub id: Uuid,
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let token = cookie_token(&parts.headers).ok_or(AppError::Unauthorized)?;
        let id: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()")
            .bind(hash_token(&token))
            .fetch_optional(&state.db)
            .await?;
        id.map(|id| AuthUser { id }).ok_or(AppError::Unauthorized)
    }
}

fn cookie_token(h: &HeaderMap) -> Option<String> {
    let raw = h.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .filter_map(|p| p.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string())
        .filter(|v| !v.is_empty())
}

fn hash_token(t: &str) -> String {
    format!("{:x}", Sha256::digest(t.as_bytes()))
}

fn new_token() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn hash_password(pw: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(pw.as_bytes(), &salt).map(|h| h.to_string()).map_err(|_| AppError::Internal)
}

fn verify_password(pw: &str, hash: &str) -> bool {
    PasswordHash::new(hash).map_or(false, |h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
}

fn session_cookie(token: &str, max_age: i64, secure: bool) -> HeaderValue {
    let s = format!(
        "{COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{}",
        if secure { "; Secure" } else { "" }
    );
    HeaderValue::from_str(&s).expect("cookie")
}

async fn start_session(s: &AppState, user_id: Uuid) -> AppResult<HeaderValue> {
    let token = new_token();
    sqlx::query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))")
        .bind(hash_token(&token))
        .bind(user_id)
        .bind(SESSION_DAYS as i32)
        .execute(&s.db)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE expires_at < now()").execute(&s.db).await?;
    Ok(session_cookie(&token, SESSION_DAYS * 86400, s.cfg.cookie_secure))
}

fn clean_email(e: &str) -> AppResult<String> {
    let e = e.trim().to_lowercase();
    let ok = e.len() <= 254 && e.split_once('@').map_or(false, |(l, d)| !l.is_empty() && d.contains('.') && !d.starts_with('.') && !d.ends_with('.'));
    if ok {
        Ok(e)
    } else {
        Err(AppError::BadRequest("введите корректную почту".into()))
    }
}

fn clean_name(n: &str) -> AppResult<String> {
    let n = n.trim();
    if n.is_empty() || n.chars().count() > 100 {
        return Err(AppError::BadRequest("имя: от 1 до 100 символов".into()));
    }
    Ok(n.to_string())
}

fn check_role(r: &str) -> AppResult<()> {
    if ROLES.contains(&r) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("роль должна быть одной из: {}", ROLES.join(", "))))
    }
}

/* ----- ограничение числа неудачных попыток входа ----- */

fn check_limit(s: &AppState, key: &str) -> AppResult<()> {
    let mut m = s.limiter.lock().map_err(|_| AppError::Internal)?;
    if let Some((n, since)) = m.get(key) {
        if since.elapsed() > FAIL_WINDOW {
            m.remove(key);
        } else if *n >= MAX_FAILS {
            return Err(AppError::TooManyRequests);
        }
    }
    Ok(())
}

fn note_failure(s: &AppState, key: &str) {
    if let Ok(mut m) = s.limiter.lock() {
        let e = m.entry(key.to_string()).or_insert((0, Instant::now()));
        e.0 += 1;
    }
}

fn clear_failures(s: &AppState, key: &str) {
    if let Ok(mut m) = s.limiter.lock() {
        m.remove(key);
    }
}

/* ----- маршруты ----- */

#[derive(Deserialize)]
pub struct Register {
    email: String,
    password: String,
    name: String,
    role: Option<String>,
}

pub async fn register(State(s): State<AppState>, Json(b): Json<Register>) -> AppResult<Response> {
    if !s.cfg.allow_registration {
        return Err(AppError::Forbidden("регистрация отключена".into()));
    }
    let email = clean_email(&b.email)?;
    let name = clean_name(&b.name)?;
    let role = b.role.unwrap_or_else(|| ROLES[0].to_string());
    check_role(&role)?;
    if b.password.chars().count() < 8 || b.password.len() > 128 {
        return Err(AppError::BadRequest("пароль: от 8 до 128 символов".into()));
    }
    let pw = b.password;
    let hash = tokio::task::spawn_blocking(move || hash_password(&pw)).await.map_err(|_| AppError::Internal)??;

    let mut tx = s.db.begin().await?;
    let first: bool = sqlx::query_scalar("SELECT NOT EXISTS (SELECT 1 FROM users)").fetch_one(&mut *tx).await?;
    let inserted = sqlx::query_as::<_, User>(
        "INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at",
    )
    .bind(&email)
    .bind(&name)
    .bind(&role)
    .bind(&hash)
    .fetch_one(&mut *tx)
    .await;
    let user = match inserted {
        Ok(u) => u,
        Err(sqlx::Error::Database(d)) if d.is_unique_violation() => {
            return Err(AppError::Conflict(serde_json::json!({ "error": "эта почта уже зарегистрирована" })))
        }
        Err(e) => return Err(e.into()),
    };
    if first {
        // данные, созданные до появления входа, достаются первому пользователю
        sqlx::query("UPDATE projects SET owner_id = $1 WHERE owner_id IS NULL").bind(user.id).execute(&mut *tx).await?;
        sqlx::query("UPDATE app_settings SET key = $2 WHERE key = 'default'")
            .bind(user.id)
            .bind(format!("user:{}", user.id))
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let cookie = start_session(&s, user.id).await?;
    Ok((StatusCode::CREATED, [(header::SET_COOKIE, cookie)], Json(user)).into_response())
}

#[derive(Deserialize)]
pub struct Login {
    email: String,
    password: String,
}

pub async fn login(State(s): State<AppState>, Json(b): Json<Login>) -> AppResult<Response> {
    let email = b.email.trim().to_lowercase();
    check_limit(&s, &email)?;

    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT id, password_hash FROM users WHERE lower(email) = $1")
        .bind(&email)
        .fetch_optional(&s.db)
        .await?;

    // Для неизвестной почты проверяем пароль против заглушки, чтобы время ответа не выдавало, есть ли такой пользователь.
    let (hash, id) = match &row {
        Some((id, h)) => (h.clone(), Some(*id)),
        None => (s.cfg.dummy_hash.clone(), None),
    };
    let pw = b.password;
    let ok = tokio::task::spawn_blocking(move || verify_password(&pw, &hash)).await.map_err(|_| AppError::Internal)?;

    let Some(id) = id.filter(|_| ok) else {
        note_failure(&s, &email);
        return Err(AppError::BadCredentials);
    };
    clear_failures(&s, &email);

    let user = sqlx::query_as::<_, User>("SELECT id, email, name, role, created_at FROM users WHERE id = $1")
        .bind(id)
        .fetch_one(&s.db)
        .await?;
    let cookie = start_session(&s, id).await?;
    Ok(([(header::SET_COOKIE, cookie)], Json(user)).into_response())
}

pub async fn logout(State(s): State<AppState>, headers: HeaderMap) -> AppResult<Response> {
    if let Some(t) = cookie_token(&headers) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1").bind(hash_token(&t)).execute(&s.db).await?;
    }
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, session_cookie("", 0, s.cfg.cookie_secure))]).into_response())
}

pub async fn me(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<User>> {
    let u = sqlx::query_as::<_, User>("SELECT id, email, name, role, created_at FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&s.db)
        .await?
        .ok_or(AppError::Unauthorized)?;
    Ok(Json(u))
}

#[derive(Deserialize)]
pub struct PatchMe {
    name: Option<String>,
    role: Option<String>,
}

pub async fn update_me(State(s): State<AppState>, user: AuthUser, Json(b): Json<PatchMe>) -> AppResult<Json<User>> {
    let name = b.name.as_deref().map(clean_name).transpose()?;
    if let Some(r) = &b.role {
        check_role(r)?;
    }
    let u = sqlx::query_as::<_, User>(
        "UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role) WHERE id = $1 \
         RETURNING id, email, name, role, created_at",
    )
    .bind(user.id)
    .bind(name)
    .bind(b.role)
    .fetch_one(&s.db)
    .await?;
    Ok(Json(u))
}

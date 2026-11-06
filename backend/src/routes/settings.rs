use axum::{extract::State, Json};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::AppState;

fn key(user: &AuthUser) -> String {
    format!("user:{}", user.id)
}

pub async fn get(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    let data: Option<Value> = sqlx::query_scalar("SELECT data FROM app_settings WHERE key = $1")
        .bind(key(&user))
        .fetch_optional(&s.db)
        .await?;
    Ok(Json(data.unwrap_or_else(|| json!({}))))
}

pub async fn put(State(s): State<AppState>, user: AuthUser, Json(data): Json<Value>) -> AppResult<Json<Value>> {
    if !data.is_object() {
        return Err(AppError::BadRequest("настройки должны быть JSON-объектом".into()));
    }
    sqlx::query(
        "INSERT INTO app_settings (key, data) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
    )
    .bind(key(&user))
    .bind(&data)
    .execute(&s.db)
    .await?;
    Ok(Json(data))
}

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use super::ensure_project;
use crate::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct ModelDoc {
    pub data: Value,
    pub version: i64,
    pub updated_at: DateTime<Utc>,
}

pub async fn get(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<ModelDoc>> {
    ensure_project(&s.db, id, user.id).await?;
    sqlx::query_as::<_, ModelDoc>("SELECT data, version, updated_at FROM project_models WHERE project_id = $1")
        .bind(id)
        .fetch_optional(&s.db)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

#[derive(Deserialize)]
pub struct PutModel {
    data: Value,
    /// версия, которую клиент видел последней
    version: i64,
}

fn validate(data: &Value) -> AppResult<()> {
    let ok = data.get("links").map_or(false, Value::is_array) && data.get("meta").map_or(false, Value::is_object);
    if ok {
        Ok(())
    } else {
        Err(AppError::BadRequest("модель должна содержать links (массив) и meta (объект)".into()))
    }
}

pub async fn put(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<PutModel>) -> AppResult<Json<ModelDoc>> {
    ensure_project(&s.db, id, user.id).await?;
    validate(&b.data)?;
    let updated = sqlx::query_as::<_, ModelDoc>(
        "UPDATE project_models SET data = $2, version = version + 1, updated_at = now() \
         WHERE project_id = $1 AND version = $3 RETURNING data, version, updated_at",
    )
    .bind(id)
    .bind(&b.data)
    .bind(b.version)
    .fetch_optional(&s.db)
    .await?;

    if let Some(doc) = updated {
        // в списке проектов «изменён» считается по последней правке модели
        sqlx::query("UPDATE projects SET updated_at = now() WHERE id = $1").bind(id).execute(&s.db).await?;
        return Ok(Json(doc));
    }

    // Строка не обновилась: либо проекта нет, либо версия устарела.
    let current: Option<i64> = sqlx::query_scalar("SELECT version FROM project_models WHERE project_id = $1")
        .bind(id)
        .fetch_optional(&s.db)
        .await?;
    match current {
        None => Err(AppError::NotFound),
        Some(v) => Err(AppError::Conflict(json!({
            "error": "модель уже изменена в другом месте",
            "current_version": v
        }))),
    }
}

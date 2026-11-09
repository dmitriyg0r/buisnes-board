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
    if data.get("models").is_some_and(|models| !models.is_array()) {
        return Err(AppError::BadRequest("models должен быть массивом".into()));
    }
    if let Some(models) = data.get("models").and_then(Value::as_array) {
        let mut ids = std::collections::HashSet::new();
        for model in models {
            let id = model.get("id").and_then(Value::as_str).filter(|v| !v.is_empty());
            if id.is_none() || !ids.insert(id.unwrap())
                || model.get("title").and_then(Value::as_str).is_none()
                || model.get("notation").and_then(Value::as_str).filter(|v| !v.is_empty()).is_none()
                || model.get("source").and_then(Value::as_str).is_none() {
                return Err(AppError::BadRequest("Некорректная независимая модель или повторный ID".into()));
            }
        }
    }
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
         WHERE project_id = $1 AND version = $3 \
         AND ($2::jsonb ? 'models' OR NOT (data ? 'models') OR data->'models' = '[]'::jsonb) RETURNING data, version, updated_at",
    )
    .bind(id)
    .bind(&b.data)
    .bind(b.version)
    .fetch_optional(&s.db)
    .await?;

    if let Some(doc) = updated {
        // в списке проектов «изменён» считается по последней правке модели
        sqlx::query("UPDATE projects SET updated_at = now() WHERE id = $1").bind(id).execute(&s.db).await?;
        super::presence::publish(&s, id, super::presence::Ev::new(json!({ "t": "model", "v": doc.version }), Some(user.id)));
        return Ok(Json(doc));
    }

    // Строка не обновилась: либо проекта нет, либо версия устарела.
    let current: Option<(i64, Value)> = sqlx::query_as("SELECT version, data FROM project_models WHERE project_id = $1")
        .bind(id)
        .fetch_optional(&s.db)
        .await?;
    match current {
        None => Err(AppError::NotFound),
        Some((v, data)) if v == b.version && b.data.get("models").is_none() && data.get("models").is_some_and(|models| models != &json!([])) => Err(AppError::BadRequest("Клиент не поддерживает независимые модели. Обновите приложение перед сохранением".into())),
        Some((v, _)) => Err(AppError::Conflict(json!({
            "error": "модель уже изменена в другом месте",
            "current_version": v
        }))),
    }
}

/// Лёгкий опрос: клиент узнаёт, изменилась ли модель, не скачивая её целиком.
pub async fn version(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    ensure_project(&s.db, id, user.id).await?;
    let v: Option<i64> = sqlx::query_scalar("SELECT version FROM project_models WHERE project_id = $1")
        .bind(id)
        .fetch_optional(&s.db)
        .await?;
    v.map(|v| Json(json!({ "version": v }))).ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_models_must_be_an_array_when_present() {
        assert!(validate(&json!({"links": [], "meta": {}, "models": []})).is_ok());
        assert!(validate(&json!({"links": [], "meta": {}})).is_ok());
        assert!(validate(&json!({"links": [], "meta": {}, "models": [{"id":"m", "title":"T", "notation":"future", "source":"x"}]})).is_ok());
        assert!(validate(&json!({"links": [], "meta": {}, "models": [{"id":"m"}]})).is_err());
        assert!(validate(&json!({"links": [], "meta": {}, "models": null})).is_err());
        assert!(validate(&json!({"links": [], "meta": {}, "models": {}})).is_err());
    }
}

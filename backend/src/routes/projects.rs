use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

const COLS: &str = "id, name, created_at, updated_at";

fn clean_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 200 {
        return Err(AppError::BadRequest("название проекта: от 1 до 200 символов".into()));
    }
    Ok(n.to_string())
}

pub async fn list(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Project>>> {
    let rows = sqlx::query_as::<_, Project>(&format!("SELECT {COLS} FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC"))
        .bind(user.id)
        .fetch_all(&s.db)
        .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewProject {
    name: Option<String>,
}

pub async fn create(State(s): State<AppState>, user: AuthUser, Json(b): Json<NewProject>) -> AppResult<(StatusCode, Json<Project>)> {
    let name = clean_name(b.name.as_deref().unwrap_or("Новый проект"))?;
    let mut tx = s.db.begin().await?;
    let p = sqlx::query_as::<_, Project>(&format!("INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING {COLS}"))
        .bind(name)
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO project_models (project_id, data) VALUES ($1, $2)")
        .bind(p.id)
        .bind(json!({ "links": [], "cardLinks": [], "processes": [], "docs": [], "sources": [], "meta": {} }))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(p)))
}

pub async fn get(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Project>> {
    sqlx::query_as::<_, Project>(&format!("SELECT {COLS} FROM projects WHERE id = $1 AND owner_id = $2"))
        .bind(id)
        .bind(user.id)
        .fetch_optional(&s.db)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

#[derive(Deserialize)]
pub struct PatchProject {
    name: Option<String>,
}

pub async fn update(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<PatchProject>) -> AppResult<Json<Project>> {
    let name = b.name.as_deref().map(clean_name).transpose()?;
    sqlx::query_as::<_, Project>(&format!(
        "UPDATE projects SET name = COALESCE($2, name), updated_at = now() \
         WHERE id = $1 AND owner_id = $3 RETURNING {COLS}"
    ))
    .bind(id)
    .bind(name)
    .bind(user.id)
    .fetch_optional(&s.db)
    .await?
    .map(Json)
    .ok_or(AppError::NotFound)
}

pub async fn delete(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let r = sqlx::query("DELETE FROM projects WHERE id = $1 AND owner_id = $2").bind(id).bind(user.id).execute(&s.db).await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

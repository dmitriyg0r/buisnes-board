use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use super::{ensure_project, member_sql};
use crate::AppState;

const STATUSES: [&str; 5] = ["open", "asked", "answered", "fixed", "closed"];
const COLS: &str = "id, project_id, ref_key, title, status, data, created_at, updated_at";

#[derive(Serialize, sqlx::FromRow)]
pub struct Issue {
    pub id: Uuid,
    pub project_id: Uuid,
    #[serde(rename = "ref")]
    pub ref_key: Option<String>,
    pub title: String,
    pub status: String,
    pub data: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn check_status(s: &str) -> AppResult<()> {
    if STATUSES.contains(&s) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!("статус должен быть одним из: {}", STATUSES.join(", "))))
    }
}

fn check_title(t: &str) -> AppResult<String> {
    let t = t.trim();
    if t.is_empty() || t.chars().count() > 500 {
        return Err(AppError::BadRequest("заголовок замечания: от 1 до 500 символов".into()));
    }
    Ok(t.to_string())
}

pub async fn list(State(s): State<AppState>, user: AuthUser, Path(project): Path<Uuid>) -> AppResult<Json<Vec<Issue>>> {
    ensure_project(&s.db, project, user.id).await?;
    let rows = sqlx::query_as::<_, Issue>(&format!("SELECT {COLS} FROM issues WHERE project_id = $1 ORDER BY created_at"))
        .bind(project)
        .fetch_all(&s.db)
        .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct NewIssue {
    #[serde(rename = "ref")]
    ref_key: Option<String>,
    title: String,
    status: Option<String>,
    data: Option<Value>,
}

pub async fn create(State(s): State<AppState>, user: AuthUser, Path(project): Path<Uuid>, Json(b): Json<NewIssue>) -> AppResult<(StatusCode, Json<Issue>)> {
    ensure_project(&s.db, project, user.id).await?;
    let title = check_title(&b.title)?;
    let status = b.status.unwrap_or_else(|| "open".into());
    check_status(&status)?;
    let res = sqlx::query_as::<_, Issue>(&format!(
        "INSERT INTO issues (project_id, ref_key, title, status, data) VALUES ($1, $5, $2, $3, $4) RETURNING {COLS}"
    ))
    .bind(project)
    .bind(title)
    .bind(status)
    .bind(b.data.unwrap_or_else(|| json!({})))
    .bind(b.ref_key)
    .fetch_one(&s.db)
    .await;

    match res {
        Ok(issue) => Ok((StatusCode::CREATED, Json(issue))),
        Err(sqlx::Error::Database(d)) if d.is_foreign_key_violation() => Err(AppError::NotFound),
        Err(sqlx::Error::Database(d)) if d.is_unique_violation() => {
            Err(AppError::Conflict(json!({ "error": "замечание с таким ref уже есть" })))
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(Deserialize)]
pub struct PatchIssue {
    title: Option<String>,
    status: Option<String>,
    data: Option<Value>,
}

pub async fn update(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<PatchIssue>) -> AppResult<Json<Issue>> {
    let title = b.title.as_deref().map(check_title).transpose()?;
    if let Some(st) = &b.status {
        check_status(st)?;
    }
    sqlx::query_as::<_, Issue>(&format!(
        "UPDATE issues SET title = COALESCE($2, title), status = COALESCE($3, status), \
         data = COALESCE($4, data), updated_at = now() \
         WHERE id = $1 AND project_id IN (SELECT p.id FROM projects p WHERE {}) RETURNING {COLS}",
        member_sql("$5")
    ))
    .bind(id)
    .bind(title)
    .bind(b.status)
    .bind(b.data)
    .bind(user.id)
    .fetch_optional(&s.db)
    .await?
    .map(Json)
    .ok_or(AppError::NotFound)
}

pub async fn delete(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let r = sqlx::query(&format!("DELETE FROM issues WHERE id = $1 AND project_id IN (SELECT p.id FROM projects p WHERE {})", member_sql("$2")))
        .bind(id)
        .bind(user.id)
        .execute(&s.db)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_all(State(s): State<AppState>, user: AuthUser, Path(project): Path<Uuid>) -> AppResult<StatusCode> {
    ensure_project(&s.db, project, user.id).await?;
    sqlx::query("DELETE FROM issues WHERE project_id = $1").bind(project).execute(&s.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Создаёт или обновляет замечание по ключу клиента. Так сохраняется статус автозамечания.
pub async fn upsert_ref(
    State(s): State<AppState>,
    user: AuthUser,
    Path((project, key)): Path<(Uuid, String)>,
    Json(b): Json<PatchIssue>,
) -> AppResult<Json<Issue>> {
    ensure_project(&s.db, project, user.id).await?;
    if key.is_empty() || key.chars().count() > 200 {
        return Err(AppError::BadRequest("ref: от 1 до 200 символов".into()));
    }
    let title_given = b.title.is_some();
    let title = check_title(b.title.as_deref().unwrap_or(&key))?;
    if let Some(st) = &b.status {
        check_status(st)?;
    }
    let res = sqlx::query_as::<_, Issue>(&format!(
        "INSERT INTO issues (project_id, ref_key, title, status, data) \
         VALUES ($1, $2, $3, COALESCE($4::text, 'open'), COALESCE($5::jsonb, '{{}}'::jsonb)) \
         ON CONFLICT (project_id, ref_key) WHERE ref_key IS NOT NULL DO UPDATE SET \
           title = CASE WHEN $6::bool THEN EXCLUDED.title ELSE issues.title END, \
           status = COALESCE($4::text, issues.status), \
           data = COALESCE($5::jsonb, issues.data), updated_at = now() \
         RETURNING {COLS}"
    ))
    .bind(project)
    .bind(&key)
    .bind(title)
    .bind(b.status)
    .bind(b.data)
    .bind(title_given)
    .fetch_one(&s.db)
    .await;

    match res {
        Ok(issue) => Ok(Json(issue)),
        Err(sqlx::Error::Database(d)) if d.is_foreign_key_violation() => Err(AppError::NotFound),
        Err(e) => Err(e.into()),
    }
}

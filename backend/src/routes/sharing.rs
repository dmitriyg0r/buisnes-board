//! Общий доступ к проекту по ссылке. Управляет доступом только владелец.
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::{ensure_project_owner, member_sql};
use crate::auth::{check_limit, hash_token, new_token, note_failure, AuthUser};
use crate::error::{AppError, AppResult};
use crate::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct Member {
    pub user_id: Uuid,
    pub name: String,
    pub email: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

/// Состояние доступа. Сам токен сервер не хранит, поэтому показать ссылку повторно нельзя.
pub async fn get(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    ensure_project_owner(&s.db, id, user.id).await?;
    let enabled: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM project_invites WHERE project_id = $1)")
        .bind(id)
        .fetch_one(&s.db)
        .await?;
    let members = sqlx::query_as::<_, Member>(
        "SELECT u.id AS user_id, u.name, u.email, m.role, m.joined_at FROM project_members m \
         JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY m.joined_at",
    )
    .bind(id)
    .fetch_all(&s.db)
    .await?;
    Ok(Json(json!({ "enabled": enabled, "members": members })))
}

/// Включает доступ по ссылке или перевыпускает её: прежний токен перестаёт работать.
pub async fn enable(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    ensure_project_owner(&s.db, id, user.id).await?;
    let token = new_token();
    sqlx::query(
        "INSERT INTO project_invites (project_id, token_hash) VALUES ($1, $2) \
         ON CONFLICT (project_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()",
    )
    .bind(id)
    .bind(hash_token(&token))
    .execute(&s.db)
    .await?;
    Ok(Json(json!({ "token": token })))
}

pub async fn disable(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    ensure_project_owner(&s.db, id, user.id).await?;
    sqlx::query("DELETE FROM project_invites WHERE project_id = $1").bind(id).execute(&s.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Владелец удаляет участника; участник может удалить сам себя («покинуть проект»).
pub async fn remove_member(State(s): State<AppState>, user: AuthUser, Path((id, member)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    if member != user.id {
        ensure_project_owner(&s.db, id, user.id).await?;
    }
    let r = sqlx::query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2")
        .bind(id)
        .bind(member)
        .execute(&s.db)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct Join {
    token: String,
}

/// Присоединиться может только вошедший пользователь (AuthUser). Неверная, выключенная и
/// перевыпущенная ссылки неразличимы: везде одинаковый 404.
pub async fn join(State(s): State<AppState>, user: AuthUser, Json(b): Json<Join>) -> AppResult<Json<Value>> {
    let key = format!("join:{}", user.id);
    check_limit(&s, &key)?;
    let token = b.token.trim();
    if token.is_empty() || token.len() > 128 {
        note_failure(&s, &key);
        return Err(AppError::NotFound);
    }
    let project: Option<(Uuid, String, Uuid)> = sqlx::query_as(
        "SELECT p.id, p.name, p.owner_id FROM project_invites i JOIN projects p ON p.id = i.project_id WHERE i.token_hash = $1",
    )
    .bind(hash_token(token))
    .fetch_optional(&s.db)
    .await?;
    let Some((id, name, owner)) = project else {
        note_failure(&s, &key);
        return Err(AppError::NotFound);
    };
    if owner != user.id {
        sqlx::query("INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(id)
            .bind(user.id)
            .execute(&s.db)
            .await?;
    }
    Ok(Json(json!({ "project_id": id, "name": name })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Shared {
    pub id: Uuid,
    pub name: String,
    pub owner_name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Проекты, к которым пользователь присоединился. Расположение в базах владельца не раскрывается.
pub async fn list_shared(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Shared>>> {
    let sql = format!(
        "SELECT p.id, p.name, u.name AS owner_name, p.created_at, p.updated_at FROM projects p \
         JOIN users u ON u.id = p.owner_id \
         WHERE p.owner_id <> $1 AND {} ORDER BY p.updated_at DESC",
        member_sql("$1")
    );
    Ok(Json(sqlx::query_as::<_, Shared>(&sql).bind(user.id).fetch_all(&s.db).await?))
}

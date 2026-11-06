use axum::{extract::{Path, State}, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{auth::AuthUser, error::{AppError, AppResult}, AppState};

#[derive(Serialize, sqlx::FromRow)]
pub struct Workspace {
    id: Uuid,
    name: String,
    is_default: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
#[derive(Serialize, sqlx::FromRow)]
pub struct Folder {
    id: Uuid,
    workspace_id: Uuid,
    parent_id: Option<Uuid>,
    name: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
#[derive(Deserialize)]
pub struct Name { name: String }
fn clean_name(name: &str) -> AppResult<&str> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::BadRequest("название: от 1 до 200 символов".into()));
    }
    Ok(name)
}
const WCOLS: &str = "id, name, is_default, created_at, updated_at";
const FCOLS: &str = "id, workspace_id, parent_id, name, created_at, updated_at";

pub async fn list(State(s): State<AppState>, user: AuthUser) -> AppResult<Json<Vec<Workspace>>> {
    Ok(Json(sqlx::query_as(&format!("SELECT {WCOLS} FROM workspaces WHERE owner_id = $1 ORDER BY is_default DESC, created_at, id"))
        .bind(user.id).fetch_all(&s.db).await?))
}
pub async fn create(State(s): State<AppState>, user: AuthUser, Json(b): Json<Name>) -> AppResult<(StatusCode, Json<Workspace>)> {
    let row = sqlx::query_as(&format!("INSERT INTO workspaces (owner_id, name) VALUES ($1, $2) RETURNING {WCOLS}"))
        .bind(user.id).bind(clean_name(&b.name)?).fetch_one(&s.db).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
pub async fn update(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<Name>) -> AppResult<Json<Workspace>> {
    let row = sqlx::query_as(&format!("UPDATE workspaces SET name = $3, updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING {WCOLS}"))
        .bind(id).bind(user.id).bind(clean_name(&b.name)?).fetch_optional(&s.db).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}
pub async fn delete(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let row: Option<bool> = sqlx::query_scalar("DELETE FROM workspaces WHERE id = $1 AND owner_id = $2 AND NOT is_default RETURNING true")
        .bind(id).bind(user.id).fetch_optional(&s.db).await?;
    if row.is_some() { return Ok(StatusCode::NO_CONTENT); }
    let default: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $2 AND is_default)")
        .bind(id).bind(user.id).fetch_one(&s.db).await?;
    if default { return Err(AppError::BadRequest("нельзя удалить базу по умолчанию".into())); }
    Err(AppError::NotFound)
}

pub async fn list_folders(State(s): State<AppState>, user: AuthUser, Path(workspace): Path<Uuid>) -> AppResult<Json<Vec<Folder>>> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $2)")
        .bind(workspace).bind(user.id).fetch_one(&s.db).await?;
    if !exists { return Err(AppError::NotFound); }
    Ok(Json(sqlx::query_as(&format!("SELECT {FCOLS} FROM folders WHERE workspace_id = $1 ORDER BY created_at, id"))
        .bind(workspace).fetch_all(&s.db).await?))
}
#[derive(Deserialize)]
pub struct NewFolder { workspace_id: Uuid, parent_id: Option<Uuid>, name: String }
pub async fn create_folder(State(s): State<AppState>, user: AuthUser, Json(b): Json<NewFolder>) -> AppResult<(StatusCode, Json<Folder>)> {
    let row = sqlx::query_as(&format!("INSERT INTO folders (workspace_id, parent_id, name) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $4) AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM folders WHERE id = $2 AND workspace_id = $1)) RETURNING {FCOLS}"))
        .bind(b.workspace_id).bind(b.parent_id).bind(clean_name(&b.name)?).bind(user.id)
        .fetch_optional(&s.db).await?.ok_or(AppError::NotFound)?;
    Ok((StatusCode::CREATED, Json(row)))
}
pub async fn update_folder(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<Name>) -> AppResult<Json<Folder>> {
    let row = sqlx::query_as(&format!("UPDATE folders SET name = $3, updated_at = now() WHERE id = $1 AND EXISTS (SELECT 1 FROM workspaces WHERE id = workspace_id AND owner_id = $2) RETURNING {FCOLS}"))
        .bind(id).bind(user.id).bind(clean_name(&b.name)?).fetch_optional(&s.db).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}
pub async fn delete_folder(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let r = sqlx::query("DELETE FROM folders WHERE id = $1 AND EXISTS (SELECT 1 FROM workspaces WHERE id = workspace_id AND owner_id = $2)")
        .bind(id).bind(user.id).execute(&s.db).await?;
    if r.rows_affected() == 0 { return Err(AppError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct MoveFolder { workspace_id: Uuid, parent_id: Option<Uuid> }
pub async fn move_folder(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<MoveFolder>) -> AppResult<Json<Folder>> {
    let mut tx = s.db.begin().await?;
    // Перемещения одного владельца выполняются последовательно, чтобы исключить гонку с циклами.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))").bind(user.id).execute(&mut *tx).await?;
    let source: Option<Uuid> = sqlx::query_scalar("SELECT f.workspace_id FROM folders f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = $1 AND w.owner_id = $2 FOR UPDATE OF f")
        .bind(id).bind(user.id).fetch_optional(&mut *tx).await?;
    let source = source.ok_or(AppError::NotFound)?;
    let target: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $2) AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM folders WHERE id = $3 AND workspace_id = $1))")
        .bind(b.workspace_id).bind(user.id).bind(b.parent_id).fetch_one(&mut *tx).await?;
    if !target { return Err(AppError::NotFound); }
    let cycle: bool = sqlx::query_scalar("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.workspace_id = $2) SELECT EXISTS (SELECT 1 FROM tree WHERE id = $3)")
        .bind(id).bind(source).bind(b.parent_id).fetch_one(&mut *tx).await?;
    if cycle { return Err(AppError::BadRequest("нельзя переместить папку внутрь самой себя".into())); }
    sqlx::query("SET CONSTRAINTS folders_parent_fk, projects_folder_workspace_fk, projects_workspace_owner_fk, files_folder_workspace_fk DEFERRED").execute(&mut *tx).await?;
    sqlx::query("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.workspace_id = $2) UPDATE files SET workspace_id = $3, updated_at = now() WHERE folder_id IN (SELECT id FROM tree) AND workspace_id = $2")
        .bind(id).bind(source).bind(b.workspace_id).execute(&mut *tx).await?;
    sqlx::query("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.workspace_id = $2) UPDATE projects SET workspace_id = $3, updated_at = now() WHERE folder_id IN (SELECT id FROM tree) AND workspace_id = $2 AND owner_id = $4")
        .bind(id).bind(source).bind(b.workspace_id).bind(user.id).execute(&mut *tx).await?;
    sqlx::query("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.workspace_id = $2) UPDATE folders SET workspace_id = $3, parent_id = CASE WHEN id = $1 THEN $4 ELSE parent_id END, updated_at = now() WHERE id IN (SELECT id FROM tree)")
        .bind(id).bind(source).bind(b.workspace_id).bind(b.parent_id).execute(&mut *tx).await?;
    let row = sqlx::query_as(&format!("SELECT {FCOLS} FROM folders WHERE id = $1")).bind(id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(row))
}

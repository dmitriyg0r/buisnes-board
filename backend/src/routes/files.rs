use axum::{
    body::{to_bytes, Body},
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::AuthUser, error::{AppError, AppResult}, AppState};

/// Максимальный размер одного файла — 10 МиБ.
pub const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;
const COLS: &str = "id, workspace_id, folder_id, name, octet_length(content)::bigint AS size, created_at, updated_at";

#[derive(Serialize, sqlx::FromRow)]
pub struct FileInfo {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub folder_id: Option<Uuid>,
    pub name: String,
    pub size: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct Location {
    pub workspace_id: Uuid,
    pub folder_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct UploadParams {
    pub workspace_id: Uuid,
    pub folder_id: Option<Uuid>,
    pub name: String,
}

fn clean_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.chars().count() > 255
        || name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\'))
    {
        return Err(AppError::BadRequest("некорректное имя файла".into()));
    }
    Ok(name.to_owned())
}

// Проверяем владельца и принадлежность папки базе; чужие идентификаторы не раскрываем.
async fn check_location(s: &AppState, user: Uuid, location: &Location) -> AppResult<()> {
    let ok: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = $1 AND w.owner_id = $2 \
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM folders f WHERE f.id = $3 AND f.workspace_id = w.id)))",
    ).bind(location.workspace_id).bind(user).bind(location.folder_id).fetch_one(&s.db).await?;
    if ok { Ok(()) } else { Err(AppError::NotFound) }
}

pub async fn list(State(s): State<AppState>, user: AuthUser, Query(location): Query<Location>) -> AppResult<Json<Vec<FileInfo>>> {
    check_location(&s, user.id, &location).await?;
    let rows = sqlx::query_as::<_, FileInfo>(&format!(
        "SELECT {COLS} FROM files WHERE workspace_id = $1 AND folder_id IS NOT DISTINCT FROM $2 \
         AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = files.workspace_id AND w.owner_id = $3) ORDER BY name, id"
    )).bind(location.workspace_id).bind(location.folder_id).bind(user.id).fetch_all(&s.db).await?;
    Ok(Json(rows))
}

/// Метаданные всех файлов базы для дерева навигации, без содержимого файлов.
pub async fn list_workspace(State(s): State<AppState>, user: AuthUser, Path(workspace_id): Path<Uuid>) -> AppResult<Json<Vec<FileInfo>>> {
    check_location(&s, user.id, &Location { workspace_id, folder_id: None }).await?;
    let rows = sqlx::query_as::<_, FileInfo>(&format!(
        "SELECT {COLS} FROM files WHERE workspace_id = $1 \
         AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = files.workspace_id AND w.owner_id = $2) ORDER BY name, id"
    )).bind(workspace_id).bind(user.id).fetch_all(&s.db).await?;
    Ok(Json(rows))
}

// Тело запроса — байты файла, а не multipart. Лимит применяется при чтении потока.
pub async fn upload(State(s): State<AppState>, user: AuthUser, Query(params): Query<UploadParams>, body: Body) -> Result<(StatusCode, Json<FileInfo>), Response> {
    let name = clean_name(&params.name).map_err(IntoResponse::into_response)?;
    let location = Location { workspace_id: params.workspace_id, folder_id: params.folder_id };
    check_location(&s, user.id, &location).await.map_err(IntoResponse::into_response)?;
    let bytes = to_bytes(body, MAX_FILE_SIZE).await.map_err(|_| (StatusCode::PAYLOAD_TOO_LARGE, "файл превышает 10 МиБ").into_response())?;
    let row = sqlx::query_as::<_, FileInfo>(&format!(
        "INSERT INTO files (workspace_id, folder_id, name, content) \
         SELECT w.id, $2, $3, $4 FROM workspaces w WHERE w.id = $1 AND w.owner_id = $5 \
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM folders f WHERE f.id = $2 AND f.workspace_id = w.id)) RETURNING {COLS}"
    )).bind(location.workspace_id).bind(location.folder_id).bind(name).bind(bytes.as_ref()).bind(user.id)
        .fetch_optional(&s.db).await.map_err(|e| AppError::from(e).into_response())?
        .ok_or_else(|| AppError::NotFound.into_response())?;
    Ok((StatusCode::CREATED, Json(row)))
}

// Только attachment и application/octet-stream: загруженный HTML не исполняется на домене приложения.
pub async fn download(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Response> {
    let row: Option<(String, Vec<u8>)> = sqlx::query_as(
        "SELECT f.name, f.content FROM files f JOIN workspaces w ON w.id = f.workspace_id WHERE f.id = $1 AND w.owner_id = $2"
    ).bind(id).bind(user.id).fetch_optional(&s.db).await?;
    let (name, content) = row.ok_or(AppError::NotFound)?;
    let encoded: String = name.as_bytes().iter().map(|b| {
        if b.is_ascii_alphanumeric() || matches!(*b, b'-' | b'.' | b'_' | b'~') { (*b as char).to_string() } else { format!("%{b:02X}") }
    }).collect();
    let disposition = HeaderValue::from_str(&format!("attachment; filename=\"download\"; filename*=UTF-8''{encoded}"))
        .map_err(|_| AppError::Internal)?;
    Ok(([(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream")),
        (header::CONTENT_DISPOSITION, disposition),
        (header::CACHE_CONTROL, HeaderValue::from_static("private, no-store"))], content).into_response())
}

pub async fn copy(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(location): Json<Location>) -> AppResult<(StatusCode, Json<FileInfo>)> {
    check_location(&s, user.id, &location).await?;
    let row = sqlx::query_as::<_, FileInfo>(&format!(
        "INSERT INTO files (workspace_id, folder_id, name, content) \
         SELECT $2, $3, f.name, f.content FROM files f JOIN workspaces source ON source.id = f.workspace_id \
         JOIN workspaces dest ON dest.id = $2 AND dest.owner_id = $4 \
         WHERE f.id = $1 AND source.owner_id = $4 \
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM folders d WHERE d.id = $3 AND d.workspace_id = dest.id)) RETURNING {COLS}"
    )).bind(id).bind(location.workspace_id).bind(location.folder_id).bind(user.id).fetch_optional(&s.db).await?.ok_or(AppError::NotFound)?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn move_file(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(location): Json<Location>) -> AppResult<Json<FileInfo>> {
    check_location(&s, user.id, &location).await?;
    let row = sqlx::query_as::<_, FileInfo>(&format!(
        "UPDATE files SET workspace_id = $2, folder_id = $3, updated_at = now() WHERE id = $1 \
         AND EXISTS (SELECT 1 FROM workspaces source WHERE source.id = files.workspace_id AND source.owner_id = $4) \
         AND EXISTS (SELECT 1 FROM workspaces dest WHERE dest.id = $2 AND dest.owner_id = $4 \
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM folders d WHERE d.id = $3 AND d.workspace_id = dest.id))) RETURNING {COLS}"
    )).bind(id).bind(location.workspace_id).bind(location.folder_id).bind(user.id).fetch_optional(&s.db).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

#[derive(Deserialize)]
pub struct RenameFile { name: String }

pub async fn rename(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(body): Json<RenameFile>) -> AppResult<Json<FileInfo>> {
    let row = sqlx::query_as::<_, FileInfo>(&format!(
        "UPDATE files SET name = $3, updated_at = now() WHERE id = $1 \
         AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = files.workspace_id AND w.owner_id = $2) RETURNING {COLS}"
    )).bind(id).bind(user.id).bind(clean_name(&body.name)?).fetch_optional(&s.db).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let result = sqlx::query("DELETE FROM files WHERE id = $1 AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = files.workspace_id AND w.owner_id = $2)")
        .bind(id).bind(user.id).execute(&s.db).await?;
    if result.rows_affected() == 0 { return Err(AppError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::clean_name;

    #[test]
    fn filename_validation() {
        assert_eq!(clean_name("  документ.pdf  ").unwrap(), "документ.pdf");
        for name in ["", "..", ".", "a/b", "a\\b", "a\n.txt", "\0"] {
            assert!(clean_name(name).is_err(), "{name:?}");
        }
        assert!(clean_name(&"a".repeat(256)).is_err());
    }
}

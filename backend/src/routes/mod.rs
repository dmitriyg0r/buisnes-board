pub mod files;
pub mod issues;
pub mod model;
pub mod projects;
pub mod settings;
pub mod workspaces;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Проект должен принадлежать пользователю; чужой проект выглядит как несуществующий.
pub async fn ensure_project(db: &PgPool, id: Uuid, owner: Uuid) -> AppResult<()> {
    let ok: Option<i32> = sqlx::query_scalar("SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner)
        .fetch_optional(db)
        .await?;
    ok.map(|_| ()).ok_or(AppError::NotFound)
}

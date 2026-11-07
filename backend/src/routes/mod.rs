pub mod export;
pub mod files;
pub mod issues;
pub mod model;
pub mod presence;
pub mod projects;
pub mod settings;
pub mod sharing;
pub mod workspaces;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Доступ к проекту: владелец или участник. Чужой проект выглядит как несуществующий.
/// SQL-условие для запросов по таблице `projects` (алиас `p`): параметр `$n` — id пользователя.
pub fn member_sql(user_param: &str) -> String {
    format!("(p.owner_id = {user_param} OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = {user_param}))")
}

pub async fn ensure_project(db: &PgPool, id: Uuid, user: Uuid) -> AppResult<()> {
    let sql = format!("SELECT 1 FROM projects p WHERE p.id = $1 AND {}", member_sql("$2"));
    let ok: Option<i32> = sqlx::query_scalar(&sql).bind(id).bind(user).fetch_optional(db).await?;
    ok.map(|_| ()).ok_or(AppError::NotFound)
}

/// Действия владельца: переименование, перемещение, удаление, управление доступом.
pub async fn ensure_project_owner(db: &PgPool, id: Uuid, user: Uuid) -> AppResult<()> {
    let ok: Option<i32> = sqlx::query_scalar("SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(user)
        .fetch_optional(db)
        .await?;
    ok.map(|_| ()).ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Явный запуск: cargo test project_access -- --ignored. Все данные откатываются.
    #[tokio::test]
    #[ignore]
    async fn project_access() {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL не задан");
        let pool = PgPool::connect(&url).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let (owner, member, stranger) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        for id in [owner, member, stranger] {
            sqlx::query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, 'Тест', 'тест', 'x')")
                .bind(id).bind(format!("{id}@example.test")).execute(&mut *tx).await.unwrap();
        }
        let ws = Uuid::new_v4();
        let project = Uuid::new_v4();
        sqlx::query("INSERT INTO workspaces (id, owner_id, name) VALUES ($1, $2, 'База')").bind(ws).bind(owner).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO projects (id, workspace_id, owner_id, name) VALUES ($1, $2, $3, 'П')").bind(project).bind(ws).bind(owner).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)").bind(project).bind(member).execute(&mut *tx).await.unwrap();
        let sql = format!("SELECT EXISTS (SELECT 1 FROM projects p WHERE p.id = $1 AND {})", member_sql("$2"));
        for (user, expected) in [(owner, true), (member, true), (stranger, false)] {
            let got: bool = sqlx::query_scalar(&sql).bind(project).bind(user).fetch_one(&mut *tx).await.unwrap();
            assert_eq!(got, expected);
        }
        // участник не владелец; база проекта ему не принадлежит
        let owns: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2)").bind(project).bind(member).fetch_one(&mut *tx).await.unwrap();
        assert!(!owns);
        let ws_access: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $2)").bind(ws).bind(member).fetch_one(&mut *tx).await.unwrap();
        assert!(!ws_access);
        // после удаления участника доступ пропадает
        sqlx::query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2").bind(project).bind(member).execute(&mut *tx).await.unwrap();
        let got: bool = sqlx::query_scalar(&sql).bind(project).bind(member).fetch_one(&mut *tx).await.unwrap();
        assert!(!got);
        tx.rollback().await.unwrap();
    }
}

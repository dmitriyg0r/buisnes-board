use axum::{
    extract::{Path, State},
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::Value;
use uuid::Uuid;

use crate::{auth::AuthUser, error::{AppError, AppResult}, AppState};

// Один запрос даёт согласованный снимок базы даже при одновременном редактировании.
// Состав полей задан явно, чтобы новые служебные поля не попали в экспорт.
const EXPORT_SQL: &str = r#"
SELECT jsonb_build_object(
    'format', 'buisnes-board-workspace', 'version', 1,
    'workspace', jsonb_build_object(
        'id', w.id, 'name', w.name, 'is_default', w.is_default,
        'created_at', w.created_at, 'updated_at', w.updated_at
    ),
    'folders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', f.id, 'workspace_id', f.workspace_id, 'parent_id', f.parent_id,
            'name', f.name, 'created_at', f.created_at, 'updated_at', f.updated_at
        ) ORDER BY f.created_at, f.id) FROM folders f WHERE f.workspace_id = w.id
    ), '[]'::jsonb),
    'projects', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'workspace_id', p.workspace_id, 'folder_id', p.folder_id,
            'name', p.name, 'created_at', p.created_at, 'updated_at', p.updated_at,
            'model', (SELECT jsonb_build_object('data', m.data, 'version', m.version,
                'updated_at', m.updated_at) FROM project_models m WHERE m.project_id = p.id),
            'issues', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'project_id', i.project_id, 'ref', i.ref_key,
                'title', i.title, 'status', i.status, 'data', i.data,
                'created_at', i.created_at, 'updated_at', i.updated_at
            ) ORDER BY i.created_at, i.id) FROM issues i WHERE i.project_id = p.id), '[]'::jsonb)
        ) ORDER BY p.created_at, p.id) FROM projects p
        WHERE p.workspace_id = w.id AND p.owner_id = $2
    ), '[]'::jsonb),
    'files', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', f.id, 'workspace_id', f.workspace_id, 'folder_id', f.folder_id,
            'name', f.name, 'size', octet_length(f.content),
            'content_base64', replace(encode(f.content, 'base64'), E'\n', ''),
            'created_at', f.created_at, 'updated_at', f.updated_at
        ) ORDER BY f.created_at, f.id) FROM files f WHERE f.workspace_id = w.id
    ), '[]'::jsonb)
) FROM workspaces w WHERE w.id = $1 AND w.owner_id = $2
"#;

pub async fn workspace(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>) -> AppResult<Response> {
    let data: Option<Value> = sqlx::query_scalar(EXPORT_SQL)
        .bind(id).bind(user.id).fetch_optional(&s.db).await?;
    let data = data.ok_or(AppError::NotFound)?;
    let filename = HeaderValue::from_str(&format!("attachment; filename=\"workspace-{id}.json\""))
        .map_err(|_| AppError::Internal)?;
    Ok(([
        (header::CONTENT_DISPOSITION, filename),
        (header::CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
    ], Json(data)).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[tokio::test]
    async fn export_requires_login() {
        let db = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://localhost/unused").unwrap();
        let cfg = crate::Config {
            cookie_secure: false, allow_registration: false,
            dummy_hash: String::new(), secrets_key: None,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, crate::app(db, cfg, None)).await.unwrap();
        });
        let response = reqwest::get(format!("http://{addr}/api/workspaces/{}/export", Uuid::new_v4()))
            .await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
        server.abort();
    }

    // Явный запуск: cargo test export_snapshot -- --ignored. Все данные откатываются.
    #[tokio::test]
    #[ignore]
    async fn export_snapshot() {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL не задан");
        let pool = PgPool::connect(&url).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let user = Uuid::new_v4();
        let other = Uuid::new_v4();
        let workspace = Uuid::new_v4();
        let hidden_workspace = Uuid::new_v4();
        let folder = Uuid::new_v4();
        let project = Uuid::new_v4();
        let file = Uuid::new_v4();
        for id in [user, other] {
            sqlx::query("INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, 'Тест', 'тест', 'секрет')")
                .bind(id).bind(format!("{id}@example.test")).execute(&mut *tx).await.unwrap();
        }
        for (id, owner) in [(workspace, user), (hidden_workspace, other)] {
            sqlx::query("INSERT INTO workspaces (id, owner_id, name) VALUES ($1, $2, 'База')")
                .bind(id).bind(owner).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("INSERT INTO folders (id, workspace_id, name) VALUES ($1, $2, 'Папка')")
            .bind(folder).bind(workspace).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO projects (id, workspace_id, owner_id, folder_id, name) VALUES ($1, $2, $3, $4, 'Проект')")
            .bind(project).bind(workspace).bind(user).bind(folder).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO project_models (project_id, data, version) VALUES ($1, $2, 7)")
            .bind(project).bind(serde_json::json!({"links": [], "meta": {"ключ": "значение"}}))
            .execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO issues (project_id, title, data) VALUES ($1, 'Замечание', '{\"x\":1}')")
            .bind(project).execute(&mut *tx).await.unwrap();
        let bytes: Vec<u8> = (0..=255).collect();
        sqlx::query("INSERT INTO files (id, workspace_id, folder_id, name, content) VALUES ($1, $2, $3, 'файл.bin', $4)")
            .bind(file).bind(workspace).bind(folder).bind(&bytes).execute(&mut *tx).await.unwrap();
        let data: Value = sqlx::query_scalar(EXPORT_SQL).bind(workspace).bind(user).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(data["workspace"]["id"], workspace.to_string());
        assert_eq!(data["folders"][0]["id"], folder.to_string());
        assert_eq!(data["projects"][0]["folder_id"], folder.to_string());
        assert_eq!(data["projects"][0]["model"]["version"], 7);
        assert_eq!(data["projects"][0]["model"]["data"]["meta"]["ключ"], "значение");
        assert_eq!(data["projects"][0]["issues"][0]["title"], "Замечание");
        assert_eq!(data["files"][0]["id"], file.to_string());
        let encoded = data["files"][0]["content_base64"].as_str().unwrap();
        assert!(!encoded.contains('\n'));
        let decoded: Vec<u8> = sqlx::query_scalar("SELECT decode($1, 'base64')")
            .bind(encoded).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(decoded, bytes);
        assert!(!data.to_string().contains("секрет"));
        let чужая: Option<Value> = sqlx::query_scalar(EXPORT_SQL).bind(workspace).bind(other).fetch_optional(&mut *tx).await.unwrap();
        assert!(чужая.is_none());
        let другая: Value = sqlx::query_scalar(EXPORT_SQL).bind(hidden_workspace).bind(other).fetch_one(&mut *tx).await.unwrap();
        assert_eq!(другая["folders"], serde_json::json!([]));
        assert_eq!(другая["projects"], serde_json::json!([]));
        assert_eq!(другая["files"], serde_json::json!([]));
        tx.rollback().await.unwrap();
    }
}

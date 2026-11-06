mod auth;
mod error;
mod integrations;
mod routes;

use axum::{
    http::{header, HeaderName, HeaderValue},
    routing::{get, patch, post, put},
    Json, Router,
};
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Instant,
};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

#[derive(Clone)]
pub struct Config {
    pub cookie_secure: bool,
    pub allow_registration: bool,
    /// хеш-заглушка: нужна, чтобы вход с неизвестной почтой тратил столько же времени, сколько обычный
    pub dummy_hash: String,
    /// ключ шифрования секретов пользователей; без него подключение сервисов отключено
    pub secrets_key: Option<[u8; 32]>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cfg: Config,
    /// неудачные попытки входа по почте: (число, время первой)
    pub limiter: Arc<Mutex<HashMap<String, (u32, Instant)>>>,
    pub http: reqwest::Client,
}

pub fn app(db: PgPool, cfg: Config, frontend: Option<String>) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me).patch(auth::update_me))
        .route(
            "/integrations/codex",
            get(integrations::get_codex).put(integrations::put_codex).delete(integrations::delete_codex),
        )
        .route("/integrations/codex/check", post(integrations::check_codex))
        .route("/projects", get(routes::projects::list).post(routes::projects::create))
        .route(
            "/projects/:id",
            get(routes::projects::get).patch(routes::projects::update).delete(routes::projects::delete),
        )
        .route("/projects/:id/model", get(routes::model::get).put(routes::model::put))
        .route(
            "/projects/:id/issues",
            get(routes::issues::list).post(routes::issues::create).delete(routes::issues::delete_all),
        )
        .route("/projects/:id/issues/by-ref/:key", put(routes::issues::upsert_ref))
        .route("/issues/:id", patch(routes::issues::update).delete(routes::issues::delete))
        .route("/settings", get(routes::settings::get).put(routes::settings::put))
        // неизвестные пути API не должны отдавать index.html
        .fallback(|| async { error::AppError::NotFound });

    // Фронтенд обращается через прокси Vite; CORS нужен только для прямых запросов с localhost.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let o = origin.as_bytes();
            o.starts_with(b"http://localhost") || o.starts_with(b"http://127.0.0.1")
        }))
        .allow_methods(Any)
        .allow_headers(Any);

    let mut router = Router::new().nest("/api", api);
    // Собранный фронтенд отдаётся тем же сервером; неизвестные пути ведут на index.html (одностраничное приложение).
    if let Some(dir) = frontend {
        let index = ServeFile::new(format!("{dir}/index.html"));
        router = router.fallback_service(ServeDir::new(&dir).fallback(index));
    }

    let hdr = |name: &'static str, value: &'static str| {
        SetResponseHeaderLayer::if_not_present(HeaderName::from_static(name), HeaderValue::from_static(value))
    };
    router
        .layer(TraceLayer::new_for_http())
        .layer(hdr("x-content-type-options", "nosniff"))
        .layer(hdr("x-frame-options", "DENY"))
        .layer(hdr("referrer-policy", "same-origin"))
        .layer(SetResponseHeaderLayer::if_not_present(header::CACHE_CONTROL, HeaderValue::from_static("no-cache")))
        .layer(cors)
        .with_state(AppState {
            db,
            cfg,
            limiter: Arc::new(Mutex::new(HashMap::new())),
            http: reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().expect("http client"),
        })
}

async fn health(axum::extract::State(s): axum::extract::State<AppState>) -> Json<serde_json::Value> {
    let db_ok = sqlx::query("SELECT 1").execute(&s.db).await.is_ok();
    Json(json!({ "status": if db_ok { "ok" } else { "degraded" }, "db": db_ok }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "bb_backend=debug,tower_http=info".into()),
        )
        .init();

    let url = std::env::var("DATABASE_URL").map_err(|_| "переменная DATABASE_URL не задана (см. backend/.env.example)")?;
    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());

    let pool = PgPoolOptions::new().max_connections(5).connect(&url).await?;
    sqlx::migrate!().run(&pool).await?;
    tracing::info!("миграции применены");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("сервер слушает http://{addr}");
    let flag = |k: &str, default: bool| std::env::var(k).map_or(default, |v| matches!(v.as_str(), "1" | "true" | "yes"));
    let cfg = Config {
        cookie_secure: flag("COOKIE_SECURE", false),
        allow_registration: flag("ALLOW_REGISTRATION", true),
        secrets_key: match std::env::var("SECRETS_KEY").ok().filter(|v| !v.trim().is_empty()) {
            Some(v) => Some(integrations::parse_secrets_key(&v)?),
            None => {
                tracing::warn!("SECRETS_KEY не задан: подключение внешних сервисов отключено");
                None
            }
        },
        dummy_hash: auth::hash_password("неизвестный-пользователь").map_err(|_| "не удалось подготовить хеш")?,
    };
    let frontend = std::env::var("FRONTEND_DIR").ok().filter(|d| !d.is_empty());
    if let Some(d) = &frontend {
        tracing::info!("фронтенд отдаётся из {d}");
    }
    axum::serve(listener, app(pool, cfg, frontend))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

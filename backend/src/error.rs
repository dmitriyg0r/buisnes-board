use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

#[derive(Debug)]
pub enum AppError {
    NotFound,
    Unauthorized,
    BadCredentials,
    Forbidden(String),
    TooManyRequests,
    /// внешний сервис не ответил или ответил ошибкой
    Upstream(String),
    /// функция не настроена на сервере
    Unavailable(String),
    Internal,
    BadRequest(String),
    /// Тело ответа 409 целиком: клиенту нужна текущая версия.
    Conflict(Value),
    Db(sqlx::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Db(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            AppError::NotFound => (StatusCode::NOT_FOUND, json!({ "error": "не найдено" })),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, json!({ "error": "нужно войти" })),
            AppError::BadCredentials => (StatusCode::UNAUTHORIZED, json!({ "error": "неверная почта или пароль" })),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, json!({ "error": m })),
            AppError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                json!({ "error": "слишком много попыток, попробуйте позже" }),
            ),
            AppError::Upstream(m) => (StatusCode::BAD_GATEWAY, json!({ "error": m })),
            AppError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, json!({ "error": m })),
            AppError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "внутренняя ошибка" })),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, json!({ "error": m })),
            AppError::Conflict(v) => (StatusCode::CONFLICT, v),
            AppError::Db(e) => {
                tracing::error!(error = ?e, "ошибка базы данных");
                (StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": "внутренняя ошибка" }))
            }
        };
        (status, Json(body)).into_response()
    }
}

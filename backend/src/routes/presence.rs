//! Присутствие и живые обновления: курсоры участников и сигнал «модель изменилась».
//! Всё живёт в памяти: поток событий (SSE) на проект плюс POST для позиции курсора.
use std::{convert::Infallible, time::{Duration, Instant}};

use axum::{
    extract::{Path, State},
    http::{HeaderName, HeaderValue, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use uuid::Uuid;

use super::ensure_project;
use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::AppState;

#[derive(Clone, Debug)]
pub struct Ev {
    pub json: String,
    /// автор события: ему оно не возвращается
    pub from: Option<Uuid>,
    /// событие закрывает поток этого пользователя (доступ отозван)
    pub kick: Option<Uuid>,
}

impl Ev {
    pub fn new(v: Value, from: Option<Uuid>) -> Self {
        Ev { json: v.to_string(), from, kick: None }
    }
    pub fn kick(user: Uuid) -> Self {
        Ev { json: json!({ "t": "left", "u": user }).to_string(), from: None, kick: Some(user) }
    }
}

const NAME_TTL: Duration = Duration::from_secs(60);

fn sender(s: &AppState, project: Uuid) -> AppResult<broadcast::Sender<Ev>> {
    let mut rooms = s.rooms.lock().map_err(|_| AppError::Internal)?;
    // пустые комнаты убираем, чтобы карта не росла
    rooms.retain(|_, tx| tx.receiver_count() > 0);
    Ok(rooms.entry(project).or_insert_with(|| broadcast::channel(256).0).clone())
}

/// Рассылает событие, если в комнате кто-то есть.
pub fn publish(s: &AppState, project: Uuid, ev: Ev) {
    if let Ok(rooms) = s.rooms.lock() {
        if let Some(tx) = rooms.get(&project) {
            let _ = tx.send(ev);
        }
    }
}

pub async fn stream(
    State(s): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<([(HeaderName, HeaderValue); 1], Sse<impl Stream<Item = Result<Event, Infallible>>>)> {
    ensure_project(&s.db, id, user.id).await?;
    let rx = sender(&s, id)?.subscribe();
    let me = user.id;
    let events = BroadcastStream::new(rx)
        // собственные события автору не возвращаем
        .filter(move |r| !matches!(r, Ok(ev) if ev.from == Some(me)))
        .map_while(move |r| match r {
        Ok(ev) if ev.kick == Some(me) => None,
        Ok(ev) => Some(Ok(Event::default().data(ev.json))),
        // получатель отстал: пропускаем, клиент догонит опросом версии
        Err(_) => Some(Ok(Event::default().comment("lag"))),
    });
    Ok((
        [(HeaderName::from_static("x-accel-buffering"), HeaderValue::from_static("no"))],
        Sse::new(events).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))),
    ))
}

#[derive(Deserialize)]
pub struct Cursor {
    x: Option<f64>,
    y: Option<f64>,
}

async fn display_name(s: &AppState, id: Uuid) -> AppResult<String> {
    if let Some((n, at)) = s.names.lock().map_err(|_| AppError::Internal)?.get(&id) {
        if at.elapsed() < NAME_TTL {
            return Ok(n.clone());
        }
    }
    let name: String = sqlx::query_scalar("SELECT name FROM users WHERE id = $1").bind(id).fetch_one(&s.db).await?;
    s.names.lock().map_err(|_| AppError::Internal)?.insert(id, (name.clone(), Instant::now()));
    Ok(name)
}

/// Позиция курсора в координатах доски; пустые x/y — курсор убран (ушёл с доски).
pub async fn cursor(State(s): State<AppState>, user: AuthUser, Path(id): Path<Uuid>, Json(b): Json<Cursor>) -> AppResult<StatusCode> {
    ensure_project(&s.db, id, user.id).await?;
    let name = display_name(&s, user.id).await?;
    let ok = |v: f64| v.is_finite() && v.abs() < 1e7;
    let (x, y) = match (b.x, b.y) {
        (Some(x), Some(y)) if ok(x) && ok(y) => (Some(x), Some(y)),
        (None, None) => (None, None),
        _ => return Err(AppError::BadRequest("некорректные координаты".into())),
    };
    publish(&s, id, Ev::new(json!({ "t": "cursor", "u": user.id, "n": name, "x": x, "y": y }), Some(user.id)));
    Ok(StatusCode::NO_CONTENT)
}

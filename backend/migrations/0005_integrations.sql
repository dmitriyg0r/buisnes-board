-- Подключённые внешние сервисы пользователя. Секрет хранится только в зашифрованном виде
-- (AES-256-GCM, ключ SECRETS_KEY лежит в окружении сервера, а не в базе).
CREATE TABLE integrations (
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    text        NOT NULL,
    secret_enc  bytea       NOT NULL,
    key_hint    text        NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider)
);

CREATE TABLE users (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text        NOT NULL,
    name           text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    role           text        NOT NULL,
    password_hash  text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

-- В cookie лежит случайный токен, в базе — только его SHA-256.
CREATE TABLE sessions (
    token_hash  text PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Проекты принадлежат пользователю. NULL бывает только у данных, созданных до появления входа:
-- их забирает первый зарегистрированный пользователь.
ALTER TABLE projects ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX projects_owner_idx ON projects (owner_id);

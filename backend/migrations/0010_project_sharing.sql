-- Совместный доступ к проекту: владелец остаётся в projects.owner_id, остальные участники — здесь.
CREATE TABLE project_members (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
    joined_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

-- Ссылка-приглашение: один активный токен на проект. В базе только SHA-256 токена.
CREATE TABLE project_invites (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

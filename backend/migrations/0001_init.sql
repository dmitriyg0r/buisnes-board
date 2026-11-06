-- Проекты
CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    demo        boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- BPMN-модель проекта: узлы, переходы, связи шаг ↔ пункт и атрибуты одним документом.
-- version нужен для оптимистичной блокировки: запись принимается, только если клиент
-- видел актуальную версию.
CREATE TABLE project_models (
    project_id  uuid        PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    data        jsonb       NOT NULL,
    version     bigint      NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Замечания, созданные вручную. Автозамечания по покрытию считаются на клиенте.
CREATE TABLE issues (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       text        NOT NULL CHECK (length(btrim(title)) > 0),
    status      text        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'asked', 'answered', 'fixed', 'closed')),
    data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issues_project_idx ON issues (project_id, created_at);

-- Настройки профиля. Пока без входа пользователей — одна запись с ключом 'default'.
CREATE TABLE app_settings (
    key         text PRIMARY KEY,
    data        jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

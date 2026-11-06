-- Личная база по умолчанию и вложенные папки.
CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, owner_id)
);
CREATE UNIQUE INDEX workspaces_default_owner_idx ON workspaces(owner_id) WHERE is_default;
CREATE TABLE folders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id uuid,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    CONSTRAINT folders_parent_fk FOREIGN KEY (parent_id, workspace_id) REFERENCES folders(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    CHECK (id <> parent_id)
);
CREATE INDEX folders_workspace_parent_idx ON folders(workspace_id, parent_id);
ALTER TABLE projects ADD COLUMN workspace_id uuid;
ALTER TABLE projects ADD COLUMN folder_id uuid;
INSERT INTO workspaces (owner_id, name, is_default)
SELECT id, 'Моя база', true FROM users;
UPDATE projects p SET workspace_id = w.id FROM workspaces w WHERE p.owner_id = w.owner_id AND w.is_default;
ALTER TABLE projects ADD CONSTRAINT projects_workspace_owner_fk FOREIGN KEY (workspace_id, owner_id) REFERENCES workspaces(id, owner_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE projects ADD CONSTRAINT projects_folder_workspace_fk FOREIGN KEY (folder_id, workspace_id) REFERENCES folders(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE projects ADD CONSTRAINT projects_location_check CHECK ((owner_id IS NULL AND workspace_id IS NULL AND folder_id IS NULL) OR (owner_id IS NOT NULL AND workspace_id IS NOT NULL));
CREATE INDEX projects_workspace_folder_idx ON projects(workspace_id, folder_id);

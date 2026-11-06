-- Содержимое файлов хранится в базе вместе с метаданными.
CREATE TABLE files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    folder_id uuid,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
    content bytea NOT NULL CHECK (octet_length(content) <= 10485760),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT files_folder_workspace_fk FOREIGN KEY (folder_id, workspace_id)
        REFERENCES folders(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX files_workspace_folder_idx ON files(workspace_id, folder_id);

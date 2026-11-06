-- Тип подключения: раньше пользователь вставлял API-ключ ('api_key'),
-- теперь Codex подключается входом через ChatGPT ('chatgpt', в секрете — JSON с токенами).
ALTER TABLE integrations ADD COLUMN kind text NOT NULL DEFAULT 'api_key';

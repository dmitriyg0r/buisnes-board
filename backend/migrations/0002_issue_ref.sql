-- Ключ замечания на стороне клиента: «i1» у ручных замечаний, «auto-node-…» у автозамечаний,
-- для которых в базе хранится только статус.
ALTER TABLE issues ADD COLUMN ref_key text;
CREATE UNIQUE INDEX issues_project_ref_idx ON issues (project_id, ref_key) WHERE ref_key IS NOT NULL;

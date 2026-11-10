-- 013 Antigravity engine: 'antigravity' joins AGENT_PROVIDERS and LOCAL_ENGINES (packages/contracts).
-- Both tables are rebuilt to widen their CHECK (runner: rebuildsTables).

CREATE TABLE agents_rebuilt (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  role           TEXT    NOT NULL
                         CHECK (role IN ('manager', 'pm', 'dev', 'qc', 'designer', 'writer', 'analyst', 'support')),
  provider       TEXT    NOT NULL CHECK (provider IN ('claude_code', 'codex', 'antigravity', 'custom_api')),
  connection_id  TEXT    REFERENCES provider_connections (id) ON DELETE RESTRICT,
  model          TEXT,
  access_level   TEXT    NOT NULL DEFAULT 'read_only'
                         CHECK (access_level IN ('read_only', 'edit_workspace')),
  network_access INTEGER NOT NULL DEFAULT 0 CHECK (network_access IN (0, 1)),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  CHECK (provider <> 'custom_api' OR connection_id IS NOT NULL)
);
INSERT INTO agents_rebuilt
  (id, name, role, provider, connection_id, model, access_level, network_access, enabled)
  SELECT id, name, role, provider, connection_id, model, access_level, network_access, enabled
  FROM agents;
DROP TABLE agents;
ALTER TABLE agents_rebuilt RENAME TO agents;
CREATE INDEX idx_agents_connection ON agents (connection_id);

CREATE TABLE local_engine_settings_rebuilt (
  engine                   TEXT    PRIMARY KEY CHECK (engine IN ('claude_code', 'codex', 'antigravity')),
  default_model            TEXT,
  block_dangerous_commands INTEGER NOT NULL DEFAULT 1 CHECK (block_dangerous_commands IN (0, 1)),
  allow_network            INTEGER NOT NULL DEFAULT 0 CHECK (allow_network IN (0, 1)),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO local_engine_settings_rebuilt SELECT * FROM local_engine_settings;
DROP TABLE local_engine_settings;
ALTER TABLE local_engine_settings_rebuilt RENAME TO local_engine_settings;
INSERT INTO local_engine_settings (engine) VALUES ('antigravity');

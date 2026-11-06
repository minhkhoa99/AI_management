-- 004 engine settings (phase 2)
--
-- 1. Machine-wide settings per local engine (LOCAL_ENGINES in packages/contracts). Permissions
--    of each run come from the agent (access_level, network_access); these settings are a
--    ceiling: allow_network = 0 means no agent on that engine gets network access.
--    Safe defaults: dangerous commands blocked, network off.
-- 2. provider_connections.key_hint keeps the last 4 characters of the API key for display,
--    so listing connections never needs to decrypt keys.

CREATE TABLE local_engine_settings (
  engine                   TEXT    PRIMARY KEY CHECK (engine IN ('claude_code', 'codex')),
  default_model            TEXT,
  block_dangerous_commands INTEGER NOT NULL DEFAULT 1 CHECK (block_dangerous_commands IN (0, 1)),
  allow_network            INTEGER NOT NULL DEFAULT 0 CHECK (allow_network IN (0, 1)),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO local_engine_settings (engine) VALUES ('claude_code'), ('codex');

ALTER TABLE provider_connections ADD COLUMN key_hint TEXT;

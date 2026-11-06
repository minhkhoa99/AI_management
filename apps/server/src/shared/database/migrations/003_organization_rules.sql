-- 003 organization rules (phase 1)
--
-- 1. agents.role becomes a fixed enumeration (AGENT_ROLES in packages/contracts). The agents
--    table is rebuilt to add the CHECK (runner: rebuildsTables). Existing values are matched
--    case-insensitively; anything else yields NULL and aborts the migration (no guessing).
-- 2. One head per department: at most one position without reports_to_position_id.
-- 3. Department names are unique, ignoring ASCII case.

CREATE TABLE agents_rebuilt (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  role           TEXT    NOT NULL
                         CHECK (role IN ('manager', 'pm', 'dev', 'qc', 'designer', 'writer', 'analyst', 'support')),
  provider       TEXT    NOT NULL CHECK (provider IN ('claude_code', 'codex', 'custom_api')),
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
  SELECT id, name,
         CASE WHEN lower(role) IN ('manager', 'pm', 'dev', 'qc', 'designer', 'writer', 'analyst', 'support')
              THEN lower(role) END,
         provider, connection_id, model, access_level, network_access, enabled
  FROM agents;
DROP TABLE agents;
ALTER TABLE agents_rebuilt RENAME TO agents;
CREATE INDEX idx_agents_connection ON agents (connection_id);

CREATE UNIQUE INDEX uq_positions_one_head_per_department
  ON positions (department_id) WHERE reports_to_position_id IS NULL;

CREATE UNIQUE INDEX uq_departments_name ON departments (name COLLATE NOCASE);

-- 002 constrain enumerations
--
-- Adds CHECK constraints for every enumerated column. Allowed values are defined once in
-- packages/contracts/src/enumerations.ts; keep both lists identical (enumerations.test.ts
-- inserts every contract value and one invalid value per column).
--
-- SQLite cannot add CHECK constraints to an existing table, so the affected tables are rebuilt
-- (create *_rebuilt, copy rows, drop old, rename). The runner turns foreign keys off around this
-- migration (rebuildsTables) and runs PRAGMA foreign_key_check before commit.
--
-- Schema changes besides the CHECKs:
--   agents.permission_mode  -> agents.access_level (NOT NULL, default 'read_only')
--   agents.network_access   new INTEGER 0/1 (NOT NULL, default 0)
--   agents.provider         'custom' renamed to 'custom_api'
--   tasks.priority          TEXT -> INTEGER 1 (high) | 2 (medium) | 3 (low)
--   workflow_steps.gate, on_fail become NOT NULL
-- Old values with no defined mapping are not guessed: the copy yields NULL and the NOT NULL /
-- CHECK constraints abort the migration.

-- departments: team_mode -------------------------------------------------------------------
CREATE TABLE departments_rebuilt (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  team_mode  TEXT    NOT NULL DEFAULT 'orchestrator'
                     CHECK (team_mode IN ('orchestrator', 'claude_code_teams', 'codex_subagents')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO departments_rebuilt (id, name, color, enabled, team_mode, created_at)
  SELECT id, name, color, enabled, team_mode, created_at FROM departments;
DROP TABLE departments;
ALTER TABLE departments_rebuilt RENAME TO departments;

-- agents: provider, access_level, network_access --------------------------------------------
CREATE TABLE agents_rebuilt (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  role           TEXT    NOT NULL,
  provider       TEXT    NOT NULL CHECK (provider IN ('claude_code', 'codex', 'custom_api')),
  connection_id  TEXT    REFERENCES provider_connections (id) ON DELETE RESTRICT,
  model          TEXT,
  access_level   TEXT    NOT NULL DEFAULT 'read_only'
                         CHECK (access_level IN ('read_only', 'edit_workspace')),
  network_access INTEGER NOT NULL DEFAULT 0 CHECK (network_access IN (0, 1)),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  CHECK (provider <> 'custom_api' OR connection_id IS NOT NULL)
);
INSERT INTO agents_rebuilt (id, name, role, provider, connection_id, model, access_level, enabled)
  SELECT id, name, role,
         CASE provider WHEN 'custom' THEN 'custom_api' ELSE provider END,
         connection_id, model,
         COALESCE(permission_mode, 'read_only'),
         enabled
  FROM agents;
DROP TABLE agents;
ALTER TABLE agents_rebuilt RENAME TO agents;
CREATE INDEX idx_agents_connection ON agents (connection_id);

-- workflow_steps: gate, on_fail, retry / return-to-step rules ------------------------------
CREATE TABLE workflow_steps_rebuilt (
  id                  TEXT    PRIMARY KEY,
  workflow_id         TEXT    NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  position            INTEGER NOT NULL CHECK (position >= 0),
  name                TEXT    NOT NULL,
  owner_role          TEXT    NOT NULL,
  gate                TEXT    NOT NULL
                              CHECK (gate IN ('auto', 'tests_pass', 'qc_pass', 'lead_approval', 'user_approval')),
  on_fail             TEXT    NOT NULL CHECK (on_fail IN ('retry', 'return_to_step', 'stop')),
  fail_target_step_id TEXT    REFERENCES workflow_steps (id) ON DELETE SET NULL,
  max_retries         INTEGER NOT NULL DEFAULT 0 CHECK (max_retries >= 0),
  required_output     TEXT,
  UNIQUE (workflow_id, position),
  -- return_to_step needs a target step; every other action must not have one.
  CHECK ((on_fail = 'return_to_step') = (fail_target_step_id IS NOT NULL)),
  -- retry allows 1 to 5 retries (STEP_RETRY_LIMITS).
  CHECK (on_fail <> 'retry' OR max_retries BETWEEN 1 AND 5)
);
INSERT INTO workflow_steps_rebuilt
  (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output)
  SELECT id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output
  FROM workflow_steps;
DROP TABLE workflow_steps;
ALTER TABLE workflow_steps_rebuilt RENAME TO workflow_steps;

-- tasks: priority as INTEGER ------------------------------------------------------------------
CREATE TABLE tasks_rebuilt (
  id                TEXT    PRIMARY KEY,
  department_id     TEXT    NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  workflow_id       TEXT    REFERENCES workflows (id) ON DELETE SET NULL,
  title             TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  criteria          TEXT    NOT NULL DEFAULT '',
  priority          INTEGER NOT NULL CHECK (priority IN (1, 2, 3)),
  assignee_agent_id TEXT    REFERENCES agents (id) ON DELETE SET NULL,
  current_step_id   TEXT    REFERENCES workflow_steps (id) ON DELETE SET NULL,
  status            TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN (
                      'queued', 'running', 'waiting_children', 'waiting_approval',
                      'succeeded', 'failed', 'cancelling', 'cancelled')),
  working_dir       TEXT,
  session_ref       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO tasks_rebuilt
  (id, department_id, workflow_id, title, description, criteria, priority, assignee_agent_id,
   current_step_id, status, working_dir, session_ref, created_at, updated_at)
  SELECT id, department_id, workflow_id, title, description, criteria,
         CASE WHEN priority IN ('1', '2', '3') THEN CAST(priority AS INTEGER) END,
         assignee_agent_id, current_step_id, status, working_dir, session_ref, created_at, updated_at
  FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_rebuilt RENAME TO tasks;
CREATE INDEX idx_tasks_department_status ON tasks (department_id, status);
CREATE INDEX idx_tasks_status_created ON tasks (status, created_at);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_agent_id);
CREATE INDEX idx_tasks_workflow ON tasks (workflow_id);

-- provider_connections.format already has CHECK (format IN ('openai', 'anthropic')) since 001.

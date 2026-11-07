-- 008 task execution (phase 3)
--
-- 1. tasks.engine_snapshot_json: agent engine configuration captured when a session starts
--    (provider, connection, model, permissions); a session keeps it even if the agent changes.
-- 2. tasks.step_attempt / engine_failures: retries used on the current step (on_fail = retry)
--    and consecutive retryable engine failures; run_after delays the next try.
-- 3. tasks.worktree_path: the git worktree prepared for the task (removed when it is deleted).
-- 4. tasks.pending_feedback: gate failures, review remarks and approval notes for the next turn.
-- 5. tasks.status_note: why a task waits or failed, shown on the board.
-- 6. task_delegations: who handed the task to whom (manual, automatic, workflow step).
-- 7. approvals.kind (APPROVAL_KINDS), created_at and the decision note.

ALTER TABLE tasks ADD COLUMN engine_snapshot_json TEXT
  CHECK (engine_snapshot_json IS NULL OR json_valid(engine_snapshot_json));
ALTER TABLE tasks ADD COLUMN step_attempt INTEGER NOT NULL DEFAULT 0 CHECK (step_attempt >= 0);
ALTER TABLE tasks ADD COLUMN engine_failures INTEGER NOT NULL DEFAULT 0 CHECK (engine_failures >= 0);
ALTER TABLE tasks ADD COLUMN run_after TEXT;
ALTER TABLE tasks ADD COLUMN worktree_path TEXT;
ALTER TABLE tasks ADD COLUMN pending_feedback TEXT;
ALTER TABLE tasks ADD COLUMN status_note TEXT;

CREATE TABLE task_delegations (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  from_agent_id TEXT REFERENCES agents (id) ON DELETE SET NULL,
  to_agent_id   TEXT REFERENCES agents (id) ON DELETE SET NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('manual', 'automatic', 'workflow_step')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_task_delegations_task ON task_delegations (task_id, created_at);

ALTER TABLE approvals ADD COLUMN kind TEXT NOT NULL DEFAULT 'step_gate'
  CHECK (kind IN ('step_gate', 'sensitive_action'));
ALTER TABLE approvals ADD COLUMN created_at TEXT;
ALTER TABLE approvals ADD COLUMN decision_note TEXT;
UPDATE approvals SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at IS NULL;

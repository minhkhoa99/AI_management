-- 009 task review (phase 4)
--
-- 1. tasks.status gains 'paused' (TASK_STATUSES): a task the user paused; the scheduler skips
--    it until resumed. tasks.base_sha: the commit the task branch started from (diff "so với
--    lúc bắt đầu", file revert). The tasks table is rebuilt for the CHECK (rebuildsTables).
-- 2. checkpoints.step_id / agent_id: which step and agent produced the checkpoint, so a review
--    can send the task back to exactly them.
-- 3. line_comments.status becomes an enumeration (LINE_COMMENT_STATUSES) and gets created_at.

CREATE TABLE tasks_rebuilt (
  id                   TEXT    PRIMARY KEY,
  department_id        TEXT    NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  workflow_id          TEXT    REFERENCES workflows (id) ON DELETE SET NULL,
  title                TEXT    NOT NULL,
  description          TEXT    NOT NULL DEFAULT '',
  criteria             TEXT    NOT NULL DEFAULT '',
  priority             INTEGER NOT NULL CHECK (priority IN (1, 2, 3)),
  assignee_agent_id    TEXT    REFERENCES agents (id) ON DELETE SET NULL,
  current_step_id      TEXT    REFERENCES workflow_steps (id) ON DELETE SET NULL,
  status               TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN (
                         'queued', 'running', 'waiting_children', 'waiting_approval', 'paused',
                         'succeeded', 'failed', 'cancelling', 'cancelled')),
  working_dir          TEXT,
  session_ref          TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sequence_number      INTEGER CHECK (sequence_number IS NULL OR sequence_number > 0),
  test_command         TEXT,
  engine_snapshot_json TEXT    CHECK (engine_snapshot_json IS NULL OR json_valid(engine_snapshot_json)),
  step_attempt         INTEGER NOT NULL DEFAULT 0 CHECK (step_attempt >= 0),
  engine_failures      INTEGER NOT NULL DEFAULT 0 CHECK (engine_failures >= 0),
  run_after            TEXT,
  worktree_path        TEXT,
  pending_feedback     TEXT,
  status_note          TEXT,
  base_sha             TEXT
);
INSERT INTO tasks_rebuilt
  (id, department_id, workflow_id, title, description, criteria, priority, assignee_agent_id,
   current_step_id, status, working_dir, session_ref, created_at, updated_at, sequence_number,
   test_command, engine_snapshot_json, step_attempt, engine_failures, run_after, worktree_path,
   pending_feedback, status_note)
  SELECT id, department_id, workflow_id, title, description, criteria, priority, assignee_agent_id,
         current_step_id, status, working_dir, session_ref, created_at, updated_at, sequence_number,
         test_command, engine_snapshot_json, step_attempt, engine_failures, run_after, worktree_path,
         pending_feedback, status_note
  FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_rebuilt RENAME TO tasks;
CREATE INDEX idx_tasks_department_status ON tasks (department_id, status);
CREATE INDEX idx_tasks_status_created ON tasks (status, created_at);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_agent_id);
CREATE INDEX idx_tasks_workflow ON tasks (workflow_id);
CREATE UNIQUE INDEX uq_tasks_sequence_number ON tasks (sequence_number);

ALTER TABLE checkpoints ADD COLUMN step_id TEXT REFERENCES workflow_steps (id) ON DELETE SET NULL;
ALTER TABLE checkpoints ADD COLUMN agent_id TEXT REFERENCES agents (id) ON DELETE SET NULL;

CREATE TABLE line_comments_rebuilt (
  id            TEXT    PRIMARY KEY,
  checkpoint_id TEXT    NOT NULL REFERENCES checkpoints (id) ON DELETE CASCADE,
  file_path     TEXT    NOT NULL,
  line          INTEGER NOT NULL CHECK (line >= 1),
  body          TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent', 'resolved')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO line_comments_rebuilt (id, checkpoint_id, file_path, line, body, status)
  SELECT id, checkpoint_id, file_path, line, body,
         CASE WHEN status IN ('open', 'sent', 'resolved') THEN status ELSE 'open' END
  FROM line_comments;
DROP TABLE line_comments;
ALTER TABLE line_comments_rebuilt RENAME TO line_comments;
CREATE INDEX idx_line_comments_checkpoint ON line_comments (checkpoint_id);

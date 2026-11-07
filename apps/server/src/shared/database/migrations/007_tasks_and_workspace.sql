-- 007 tasks and workspace (phase 3)
--
-- 1. tasks.sequence_number: short human reference ("T-142"), assigned on creation.
-- 2. tasks.test_command: run in the task worktree for the "tests must pass" gate.
-- 3. allowed_directories: folders the user picked with the system folder dialog; a task can
--    only work inside one of them (paths are stored resolved, symlinks included).
-- 4. workspace_settings: a single row; how many agents may run at the same time.

ALTER TABLE tasks ADD COLUMN sequence_number INTEGER CHECK (sequence_number IS NULL OR sequence_number > 0);
UPDATE tasks SET sequence_number = rowid;
CREATE UNIQUE INDEX uq_tasks_sequence_number ON tasks (sequence_number);

ALTER TABLE tasks ADD COLUMN test_command TEXT;

CREATE TABLE allowed_directories (
  path     TEXT PRIMARY KEY,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE workspace_settings (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  max_parallel_agents INTEGER NOT NULL DEFAULT 2 CHECK (max_parallel_agents BETWEEN 1 AND 8)
);
INSERT INTO workspace_settings (id) VALUES (1);

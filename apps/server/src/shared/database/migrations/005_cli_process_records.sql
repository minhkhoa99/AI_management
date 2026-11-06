-- 005 CLI process records (error policy, docs/IMPLEMENTATION_PLAN.md 5.6)
--
-- Every claude/codex process started for an agent session is recorded while it runs and removed
-- when it exits. Rows left behind mean the server stopped abruptly; at the next start a live
-- process is killed only if its name AND start time still match (PIDs get reused).

CREATE TABLE cli_process_records (
  id                 TEXT    PRIMARY KEY,
  pid                INTEGER NOT NULL CHECK (pid > 0),
  process_name       TEXT    NOT NULL,
  process_started_at TEXT,
  recorded_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

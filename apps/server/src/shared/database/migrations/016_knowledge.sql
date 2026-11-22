-- 016 knowledge (workflow intelligence, part 3)
--
-- Knowledge shared by every department working in the same repository (project_key = the
-- repository root): an index of its code files and import edges, built from the git tree, and
-- lessons learned from feedback. Only adds tables and a column.

-- Repository root of the task's workspace; null until a turn prepares it.
ALTER TABLE tasks ADD COLUMN repository_root TEXT;

CREATE TABLE code_files (
  project_key    TEXT NOT NULL,
  path           TEXT NOT NULL,
  blob_sha       TEXT NOT NULL,
  exported_names TEXT NOT NULL DEFAULT '[]',
  search_terms   TEXT NOT NULL DEFAULT '',
  UNIQUE (project_key, path)
);

CREATE TABLE code_imports (
  project_key TEXT NOT NULL,
  from_path   TEXT NOT NULL,
  to_path     TEXT NOT NULL,
  PRIMARY KEY (project_key, from_path, to_path)
) WITHOUT ROWID;
CREATE INDEX idx_code_imports_target ON code_imports (project_key, to_path);

-- department_id is only the department the lesson came from: deleting it keeps the lesson,
-- which every department of the repository shares.
CREATE TABLE knowledge_lessons (
  id             TEXT    PRIMARY KEY,
  project_key    TEXT    NOT NULL,
  department_id  TEXT    REFERENCES departments (id) ON DELETE SET NULL,
  source         TEXT    NOT NULL CHECK (source IN ('review_feedback', 'qc_feedback', 'user_review', 'agent_failure', 'agent_learning')),
  source_task_id TEXT    REFERENCES tasks (id) ON DELETE SET NULL,
  body           TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 1500),
  body_hash      TEXT    NOT NULL,
  paths_json     TEXT    NOT NULL DEFAULT '[]',
  occurrences    INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_key, body_hash)
);
CREATE INDEX idx_knowledge_lessons_frequency ON knowledge_lessons (project_key, occurrences DESC);

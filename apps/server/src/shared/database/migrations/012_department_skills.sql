-- Skills of a department (instructions an agent follows: written, from a template, uploaded as
-- .md/.zip or imported from GitHub) and which agents of the department may use them.
-- The files live in ~/.aiteam/data/skills/<id>/ with SKILL.md at the root; rows hold metadata.
CREATE TABLE department_skills (
  id            TEXT    PRIMARY KEY,
  department_id TEXT    NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  source_kind   TEXT    NOT NULL CHECK (source_kind IN ('written', 'template', 'markdown', 'zip', 'github')),
  source_url    TEXT,
  file_count    INTEGER NOT NULL DEFAULT 1 CHECK (file_count >= 1),
  total_bytes   INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (department_id, name)
);
CREATE INDEX idx_department_skills_department ON department_skills (department_id);

CREATE TABLE agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES department_skills (id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, skill_id)
);
CREATE INDEX idx_agent_skills_skill ON agent_skills (skill_id);

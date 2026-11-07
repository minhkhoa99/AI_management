-- 006 workflow step owners (phase 3)
--
-- workflow_steps.owner_role becomes a fixed enumeration (STEP_OWNERS in packages/contracts):
-- an agent role, or 'user' for approval steps. A user-owned step can only be passed by the
-- user's approval. The table is rebuilt to add the CHECKs (runner: rebuildsTables); existing
-- values outside the list abort the migration (no guessing).
--
-- fail_target_step_id drops ON DELETE SET NULL: nulling the target of a return_to_step step
-- broke its CHECK whenever a whole workflow (or department) was deleted. The default NO ACTION
-- is checked at the end of the statement, so cascades that remove both steps succeed, while
-- removing a single target step is refused (the repository clears targets first).

CREATE TABLE workflow_steps_rebuilt (
  id                  TEXT    PRIMARY KEY,
  workflow_id         TEXT    NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  position            INTEGER NOT NULL CHECK (position >= 0),
  name                TEXT    NOT NULL,
  owner_role          TEXT    NOT NULL
                              CHECK (owner_role IN ('manager', 'pm', 'dev', 'qc', 'designer', 'writer', 'analyst', 'support', 'user')),
  gate                TEXT    NOT NULL
                              CHECK (gate IN ('auto', 'tests_pass', 'qc_pass', 'lead_approval', 'user_approval')),
  on_fail             TEXT    NOT NULL CHECK (on_fail IN ('retry', 'return_to_step', 'stop')),
  fail_target_step_id TEXT    REFERENCES workflow_steps (id),
  max_retries         INTEGER NOT NULL DEFAULT 0 CHECK (max_retries >= 0),
  required_output     TEXT,
  UNIQUE (workflow_id, position),
  -- return_to_step needs a target step; every other action must not have one.
  CHECK ((on_fail = 'return_to_step') = (fail_target_step_id IS NOT NULL)),
  -- retry allows 1 to 5 retries (STEP_RETRY_LIMITS).
  CHECK (on_fail <> 'retry' OR max_retries BETWEEN 1 AND 5),
  -- the user only approves.
  CHECK (owner_role <> 'user' OR gate = 'user_approval')
);
INSERT INTO workflow_steps_rebuilt
  (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output)
  SELECT id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output
  FROM workflow_steps;
DROP TABLE workflow_steps;
ALTER TABLE workflow_steps_rebuilt RENAME TO workflow_steps;

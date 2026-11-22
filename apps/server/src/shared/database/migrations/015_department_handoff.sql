-- 015 department handoff (workflow intelligence, part 2)
--
-- A workflow step can be owned by another department ('department' in STEP_OWNERS): the task is
-- handed to that department's default workflow and comes back with a verdict. The table is
-- rebuilt as in 006 to add the column and the CHECKs (runner: rebuildsTables).
--
-- handoff_department_id keeps the default NO ACTION: deleting a department that receives
-- handoffs is refused, while deleting the department owning the step cascades through its
-- workflows and succeeds.

CREATE TABLE workflow_steps_rebuilt (
  id                    TEXT    PRIMARY KEY,
  workflow_id           TEXT    NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  position              INTEGER NOT NULL CHECK (position >= 0),
  name                  TEXT    NOT NULL,
  owner_role            TEXT    NOT NULL
                                CHECK (owner_role IN ('manager', 'pm', 'dev', 'qc', 'designer', 'writer', 'analyst', 'support', 'user', 'department')),
  gate                  TEXT    NOT NULL
                                CHECK (gate IN ('auto', 'tests_pass', 'qc_pass', 'lead_approval', 'user_approval')),
  on_fail               TEXT    NOT NULL CHECK (on_fail IN ('retry', 'return_to_step', 'stop')),
  fail_target_step_id   TEXT    REFERENCES workflow_steps (id),
  max_retries           INTEGER NOT NULL DEFAULT 0 CHECK (max_retries >= 0),
  required_output       TEXT,
  handoff_department_id TEXT    REFERENCES departments (id),
  UNIQUE (workflow_id, position),
  -- return_to_step needs a target step; every other action must not have one.
  CHECK ((on_fail = 'return_to_step') = (fail_target_step_id IS NOT NULL)),
  -- retry allows 1 to 5 retries (STEP_RETRY_LIMITS).
  CHECK (on_fail <> 'retry' OR max_retries BETWEEN 1 AND 5),
  -- the user only approves.
  CHECK (owner_role <> 'user' OR gate = 'user_approval'),
  -- a handoff step names its target department; no other step does.
  CHECK ((owner_role = 'department') = (handoff_department_id IS NOT NULL)),
  -- the other department's verdict is the gate: automatic, never retried in place.
  CHECK (owner_role <> 'department' OR (gate = 'auto' AND on_fail <> 'retry'))
);
INSERT INTO workflow_steps_rebuilt
  (id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output)
  SELECT id, workflow_id, position, name, owner_role, gate, on_fail, fail_target_step_id, max_retries, required_output
  FROM workflow_steps;
DROP TABLE workflow_steps;
ALTER TABLE workflow_steps_rebuilt RENAME TO workflow_steps;

-- On the parent task: the child task of the current handoff round (no FK, like parent_task_id).
ALTER TABLE tasks ADD COLUMN handoff_task_id TEXT;

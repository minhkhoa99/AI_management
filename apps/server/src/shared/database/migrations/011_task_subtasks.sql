-- Subtasks: an agent with subordinates splits its step into child tasks (one level deep).
-- No foreign key on purpose: deleting a parent removes its children through TaskRemoval (each
-- child may still be cancelling and owns a worktree), so the row must not block or cascade.
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
CREATE INDEX idx_tasks_parent_task_id ON tasks (parent_task_id);

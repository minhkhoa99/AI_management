-- A superior's review that hit the engine's plan quota waits for the reset: the task goes back in
-- the queue with this flag, and its next turn opens the review again instead of redoing the step.
ALTER TABLE tasks ADD COLUMN review_pending INTEGER NOT NULL DEFAULT 0 CHECK (review_pending IN (0, 1));

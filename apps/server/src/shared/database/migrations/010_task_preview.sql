-- Phase 4 (C): command that starts the app's dev server for the preview tab.
-- Written by the user like the test command; must contain {port}. NULL: no preview.
ALTER TABLE tasks ADD COLUMN preview_command TEXT;

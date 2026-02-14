-- Migration: Add git_access_token to projects table
-- Date: 2026-02-14
-- Purpose: Support Git authentication for Agent auto-commit

ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_access_token VARCHAR(500);

-- Add comment for documentation
COMMENT ON COLUMN projects.git_access_token IS 'Personal access token for Git operations (HTTPS authentication)';

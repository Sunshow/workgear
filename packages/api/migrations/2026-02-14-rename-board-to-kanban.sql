-- Migration: Rename board to kanban
-- Date: 2026-02-14
-- Description: Rename boards table to kanbans and board_columns to kanban_columns

-- Step 1: Rename tables
ALTER TABLE boards RENAME TO kanbans;
ALTER TABLE board_columns RENAME TO kanban_columns;

-- Step 2: Rename column in kanban_columns
ALTER TABLE kanban_columns RENAME COLUMN board_id TO kanban_id;

-- Step 3: Rename constraint
ALTER TABLE kanban_columns RENAME CONSTRAINT board_columns_board_id_position_unique 
  TO kanban_columns_kanban_id_position_unique;

-- Note: Foreign key constraints are automatically updated by PostgreSQL when renaming tables

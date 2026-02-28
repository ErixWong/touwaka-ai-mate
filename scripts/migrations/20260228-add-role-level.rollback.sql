-- Rollback Migration: Remove level field from roles table
-- Date: 2026-02-28
-- Author: Maria

-- Remove index
DROP INDEX IF EXISTS idx_level ON roles;

-- Remove level column
ALTER TABLE roles DROP COLUMN IF EXISTS level;
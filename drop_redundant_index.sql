-- ============================================================================
-- Drop Redundant Index - Simple Method
-- ============================================================================
-- Use this after running simple_fix.sql
-- ============================================================================

USE experienceapi;

-- Method 1: Check first, then drop manually
-- --------------------------------------------
SELECT
    INDEX_NAME,
    COLUMN_NAME,
    NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND INDEX_NAME = 'id';

-- If the above query shows a row with NON_UNIQUE = 1, then run:
DROP INDEX `id` ON transfer;

-- Method 2: Try to drop (ignore error if doesn't exist)
-- --------------------------------------------
-- Just run this and ignore any error message
-- DROP INDEX `id` ON transfer;


-- ============================================================================
-- Verify it's gone
-- ============================================================================

SELECT
    INDEX_NAME,
    COLUMN_NAME
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
ORDER BY INDEX_NAME;

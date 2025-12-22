-- ============================================================================
-- Simple Fix for Duplicate Transfers - MySQL Compatible
-- ============================================================================
-- Run these commands step by step
-- Copy and paste each section into MySQL command line
-- ============================================================================

USE experienceapi;

-- ============================================================================
-- STEP 1: Check Current State
-- ============================================================================

-- See current indexes
SHOW INDEX FROM transfer;

-- Count duplicates
SELECT
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicates
FROM transfer;

-- ============================================================================
-- STEP 2: BACKUP (CRITICAL!)
-- ============================================================================

CREATE TABLE transfer_backup_20251222 AS SELECT * FROM transfer;

SELECT COUNT(*) FROM transfer_backup_20251222;

-- ============================================================================
-- STEP 3: Remove Duplicate Records
-- ============================================================================

-- Delete duplicates, keep oldest record for each transfer ID
DELETE t1 FROM transfer t1
INNER JOIN transfer t2 ON t1.id = t2.id
WHERE t1.created_at > t2.created_at
   OR (t1.created_at = t2.created_at AND t1.redis_key > t2.redis_key);

-- Verify no duplicates remain
SELECT
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as should_be_zero
FROM transfer;

-- ============================================================================
-- STEP 4: Drop Old Primary Key
-- ============================================================================

ALTER TABLE transfer DROP PRIMARY KEY;

-- ============================================================================
-- STEP 5: Add auto_id Column
-- ============================================================================

ALTER TABLE transfer ADD COLUMN auto_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST;

-- ============================================================================
-- STEP 6: Add UNIQUE Constraint on redis_key
-- ============================================================================

ALTER TABLE transfer ADD UNIQUE KEY idx_redis_key_unique (redis_key);

-- ============================================================================
-- STEP 7: Add Index on id Column
-- ============================================================================

ALTER TABLE transfer ADD INDEX idx_transfer_id (id);

-- ============================================================================
-- STEP 8: Drop Redundant Index (if it exists)
-- ============================================================================

-- Check if 'id' index exists as non-unique
SELECT INDEX_NAME
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND INDEX_NAME = 'id'
  AND NON_UNIQUE = 1;

-- If above query returns a row, run this:
-- DROP INDEX `id` ON transfer;

-- ============================================================================
-- STEP 9: Verify Final Schema
-- ============================================================================

DESCRIBE transfer;

SHOW INDEX FROM transfer;

-- ============================================================================
-- STEP 10: Test
-- ============================================================================

-- Test insert (should succeed)
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'transferModel_test_001', 1, UNIX_TIMESTAMP() * 1000);

-- Test duplicate redis_key (should fail with error)
-- INSERT INTO transfer (id, redis_key, direction, created_at)
-- VALUES ('TEST_002', 'transferModel_test_001', -1, UNIX_TIMESTAMP() * 1000);
-- Expected: ERROR 1062 Duplicate entry

-- Test same id with different redis_key (should succeed)
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'transferModel_test_002', -1, UNIX_TIMESTAMP() * 1000);

-- Clean up test data
DELETE FROM transfer WHERE id LIKE 'TEST_%';

-- ============================================================================
-- STEP 11: Update Statistics
-- ============================================================================

ANALYZE TABLE transfer;

-- ============================================================================
-- DONE!
-- ============================================================================

SELECT 'Migration Complete!' as status,
       COUNT(*) as total_records,
       COUNT(DISTINCT id) as unique_transfer_ids
FROM transfer;

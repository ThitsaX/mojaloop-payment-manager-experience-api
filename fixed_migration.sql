-- ============================================================================
-- Fixed Migration Script - Handles Existing auto_id Column
-- ============================================================================
-- This script handles the case where auto_id column already exists
-- Run check_current_schema.sql first to see current state
-- ============================================================================

USE experienceapi;

-- ============================================================================
-- STEP 0: Current State Check
-- ============================================================================

SELECT '=== Checking if auto_id exists ===' as step;

SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    COLUMN_KEY,
    EXTRA
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND COLUMN_NAME = 'auto_id';

-- If the above query returns a row, auto_id EXISTS
-- If it returns empty, auto_id DOES NOT EXIST

-- ============================================================================
-- STEP 1: Backup (CRITICAL!)
-- ============================================================================

SELECT '=== Creating Backup ===' as step;

DROP TABLE IF EXISTS transfer_backup_20251222;
CREATE TABLE transfer_backup_20251222 AS SELECT * FROM transfer;

SELECT COUNT(*) as backup_record_count FROM transfer_backup_20251222;

-- ============================================================================
-- STEP 2: Remove Duplicates
-- ============================================================================

SELECT '=== Removing Duplicate Records ===' as step;

DELETE t1 FROM transfer t1
INNER JOIN transfer t2 ON t1.id = t2.id
WHERE t1.created_at > t2.created_at
   OR (t1.created_at = t2.created_at AND t1.redis_key > t2.redis_key);

SELECT
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicates_remaining
FROM transfer;

-- ============================================================================
-- STEP 3A: If auto_id EXISTS - Remove AUTO_INCREMENT First
-- ============================================================================

SELECT '=== Step 3A: Handling Existing auto_id ===' as step;

-- Check if auto_id has AUTO_INCREMENT
SELECT
    COLUMN_NAME,
    EXTRA
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND COLUMN_NAME = 'auto_id';

-- If auto_id EXISTS and has AUTO_INCREMENT, run this:
-- Modify auto_id to remove AUTO_INCREMENT
ALTER TABLE transfer MODIFY COLUMN auto_id INT UNSIGNED;

-- ============================================================================
-- STEP 3B: Drop Primary Key
-- ============================================================================

SELECT '=== Step 3B: Dropping Primary Key ===' as step;

-- Now we can drop the primary key (no AUTO_INCREMENT columns blocking)
ALTER TABLE transfer DROP PRIMARY KEY;

-- ============================================================================
-- STEP 3C: Drop old auto_id Column (if it exists)
-- ============================================================================

SELECT '=== Step 3C: Dropping Old auto_id ===' as step;

-- Drop the old auto_id column
ALTER TABLE transfer DROP COLUMN auto_id;

-- ============================================================================
-- STEP 4: Add New auto_id with AUTO_INCREMENT and PRIMARY KEY
-- ============================================================================

SELECT '=== Step 4: Adding New auto_id ===' as step;

ALTER TABLE transfer
ADD COLUMN auto_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST;

-- ============================================================================
-- STEP 5: Add UNIQUE Constraint on redis_key
-- ============================================================================

SELECT '=== Step 5: Adding UNIQUE Constraint on redis_key ===' as step;

ALTER TABLE transfer
ADD UNIQUE KEY idx_redis_key_unique (redis_key);

-- ============================================================================
-- STEP 6: Add Index on id Column
-- ============================================================================

SELECT '=== Step 6: Adding Index on id ===' as step;

ALTER TABLE transfer
ADD INDEX idx_transfer_id (id);

-- ============================================================================
-- STEP 7: Verify New Schema
-- ============================================================================

SELECT '=== Step 7: Verifying Schema ===' as step;

DESCRIBE transfer;

SHOW INDEX FROM transfer;

-- ============================================================================
-- STEP 8: Test Insert Operations
-- ============================================================================

SELECT '=== Step 8: Testing ===' as step;

-- Test 1: Insert should succeed
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'transferModel_test_001', 1, UNIX_TIMESTAMP() * 1000);

SELECT 'Test 1: Insert succeeded' as result;

-- Test 2: Duplicate redis_key should FAIL (this is expected and good!)
-- Uncomment to test (will show error - that's correct behavior):
-- INSERT INTO transfer (id, redis_key, direction, created_at)
-- VALUES ('TEST_002', 'transferModel_test_001', -1, UNIX_TIMESTAMP() * 1000);

-- Test 3: Same id with different redis_key should succeed
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'transferModel_test_002', -1, UNIX_TIMESTAMP() * 1000);

SELECT 'Test 3: Same ID different redis_key succeeded' as result;

-- Clean up test data
DELETE FROM transfer WHERE id LIKE 'TEST_%';

SELECT 'Test cleanup complete' as result;

-- ============================================================================
-- STEP 9: Update Table Statistics
-- ============================================================================

SELECT '=== Step 9: Updating Statistics ===' as step;

ANALYZE TABLE transfer;

-- ============================================================================
-- STEP 10: Final Verification
-- ============================================================================

SELECT '=== MIGRATION COMPLETE ===' as step;

SELECT
    'Final Record Count' as metric,
    COUNT(*) as value
FROM transfer
UNION ALL
SELECT
    'Unique Transfer IDs',
    COUNT(DISTINCT id)
FROM transfer
UNION ALL
SELECT
    'Unique Redis Keys',
    COUNT(DISTINCT redis_key)
FROM transfer
UNION ALL
SELECT
    'Duplicates (should be 0)',
    COUNT(*) - COUNT(DISTINCT id)
FROM transfer;

-- ============================================================================
-- SUCCESS!
-- ============================================================================
-- Next steps:
-- 1. Restart Experience API: kubectl rollout restart deployment/orange-experience-api
-- 2. Monitor logs: kubectl logs -f <pod> | grep "error inserting"
-- 3. Test in UI - make a transaction and verify only ONE record appears
-- ============================================================================

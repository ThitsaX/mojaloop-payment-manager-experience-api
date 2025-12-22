-- ============================================================================
-- Manual Fix for Duplicate Transfer Records
-- ============================================================================
-- Run these queries manually if migrations don't run at app startup
-- Execute step-by-step and verify results after each step
-- ============================================================================

USE experienceapi;

-- ============================================================================
-- STEP 1: Check Current State
-- ============================================================================

-- 1.1 Check current schema
SELECT 'Current Schema' as step;
DESCRIBE transfer;

-- 1.2 Check existing indexes
SELECT 'Current Indexes' as step;
SHOW INDEX FROM transfer;

-- 1.3 Count duplicates
SELECT 'Duplicate Count' as step;
SELECT
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicates
FROM transfer;

-- 1.4 Show sample duplicates
SELECT 'Sample Duplicates' as step;
SELECT
    id,
    COUNT(*) as count,
    GROUP_CONCAT(redis_key ORDER BY created_at SEPARATOR ' | ') as redis_keys
FROM transfer
GROUP BY id
HAVING count > 1
LIMIT 10;


-- ============================================================================
-- STEP 2: Backup (Recommended)
-- ============================================================================

-- Create backup table
SELECT 'Creating Backup' as step;
CREATE TABLE transfer_backup_20251222 AS SELECT * FROM transfer;

-- Verify backup
SELECT 'Verify Backup' as step;
SELECT COUNT(*) FROM transfer_backup_20251222;


-- ============================================================================
-- STEP 3: Clean Up Duplicates
-- ============================================================================

SELECT 'Starting Duplicate Cleanup' as step;

-- This query deletes duplicate records, keeping only the oldest one for each transfer ID
-- Uses a subquery to identify records to delete

DELETE t1 FROM transfer t1
INNER JOIN transfer t2 ON t1.id = t2.id
WHERE t1.created_at > t2.created_at
   OR (t1.created_at = t2.created_at AND t1.redis_key > t2.redis_key);

-- Alternative approach if above query is too slow (for very large datasets):
-- Create temporary table with records to keep
/*
CREATE TEMPORARY TABLE transfer_keep AS
SELECT MIN(redis_key) as redis_key
FROM transfer
GROUP BY id;

-- Delete records not in keep list
DELETE FROM transfer
WHERE redis_key NOT IN (SELECT redis_key FROM transfer_keep);

-- Drop temporary table
DROP TEMPORARY TABLE transfer_keep;
*/

-- Verify cleanup
SELECT 'After Cleanup' as step;
SELECT
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicates_remaining
FROM transfer;


-- ============================================================================
-- STEP 4: Fix Schema - Drop Composite Primary Key
-- ============================================================================

SELECT 'Dropping Composite Primary Key' as step;

-- Check current primary key
SELECT CONSTRAINT_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND CONSTRAINT_NAME = 'PRIMARY';

-- Drop composite primary key
ALTER TABLE transfer DROP PRIMARY KEY;


-- ============================================================================
-- STEP 5: Add Auto-Increment Primary Key
-- ============================================================================

SELECT 'Adding Auto-Increment Primary Key' as step;

-- Add auto_id column at the beginning
ALTER TABLE transfer
ADD COLUMN auto_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST;


-- ============================================================================
-- STEP 6: Add UNIQUE Constraint on redis_key
-- ============================================================================

SELECT 'Adding UNIQUE Constraint on redis_key' as step;

-- This prevents future duplicates
ALTER TABLE transfer
ADD UNIQUE KEY idx_redis_key_unique (redis_key);


-- ============================================================================
-- STEP 7: Add Index on 'id' for Fast Lookups
-- ============================================================================

SELECT 'Adding Index on id Column' as step;

ALTER TABLE transfer
ADD INDEX idx_transfer_id (id);


-- ============================================================================
-- STEP 8: Remove Unnecessary Indexes
-- ============================================================================

SELECT 'Removing Unnecessary/Redundant Indexes' as step;

-- Check what indexes exist after our changes
SHOW INDEX FROM transfer;

-- Remove redundant indexes if they exist
-- (These are from previous migrations that may conflict or are redundant)

-- Note: Only drop if these specific indexes exist - check SHOW INDEX output first

-- Drop old composite index if exists (redundant after adding idx_transfer_id)
DROP INDEX IF EXISTS id ON transfer;

-- Drop idx_transfer_created_at if it exists (created_at already has standalone index)
-- DROP INDEX IF EXISTS idx_transfer_created_at ON transfer;

-- Drop idx_transfer_created_success if exists (both columns have standalone indexes)
-- Note: Keep this if queries frequently filter by BOTH created_at AND success together
-- DROP INDEX IF EXISTS idx_transfer_created_success ON transfer;

-- Drop idx_transfer_created_direction if exists (both columns have standalone indexes)
-- Note: Keep this if queries frequently filter by BOTH created_at AND direction together
-- DROP INDEX IF EXISTS idx_transfer_created_direction ON transfer;

-- Drop idx_transfer_direction_success if exists (both columns have standalone indexes)
-- Note: Keep this if queries frequently filter by BOTH direction AND success together
-- DROP INDEX IF EXISTS idx_transfer_direction_success ON transfer;


-- ============================================================================
-- STEP 9: Verify Final Schema
-- ============================================================================

SELECT 'Final Schema Verification' as step;

-- Check table structure
DESCRIBE transfer;

-- Check all indexes
SHOW INDEX FROM transfer;

-- Verify expected indexes exist:
-- 1. PRIMARY on auto_id
-- 2. UNIQUE on redis_key
-- 3. INDEX on id
-- 4. INDEX on created_at (from original migration)
-- 5. INDEX on direction (from original migration)
-- 6. INDEX on success (from original migration)
-- 7. INDEX on redis_key (from performance migration)
-- 8. INDEX on dfsp (from performance migration)
-- 9. Composite indexes (if kept)


-- ============================================================================
-- STEP 10: Test Insert Operations
-- ============================================================================

SELECT 'Testing Insert Operations' as step;

-- Test 1: Insert should succeed
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'transferModel_test_001', 1, UNIX_TIMESTAMP() * 1000);

-- Test 2: Duplicate redis_key should fail
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_002', 'transferModel_test_001', -1, UNIX_TIMESTAMP() * 1000);
-- Expected: ERROR 1062 (23000): Duplicate entry 'transferModel_test_001' for key 'idx_redis_key_unique'

-- Test 3: Same id with different redis_key should succeed
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'transferModel_test_002', -1, UNIX_TIMESTAMP() * 1000);

-- Clean up test data
DELETE FROM transfer WHERE id LIKE 'TEST_%';


-- ============================================================================
-- STEP 11: Performance Check
-- ============================================================================

SELECT 'Performance Check' as step;

-- Check query performance with EXPLAIN
EXPLAIN SELECT * FROM transfer WHERE id = 'some_transfer_id';
-- Should use idx_transfer_id

EXPLAIN SELECT * FROM transfer WHERE redis_key = 'transferModel_xxx';
-- Should use idx_redis_key_unique

EXPLAIN SELECT * FROM transfer
WHERE created_at >= UNIX_TIMESTAMP('2025-12-20') * 1000
  AND created_at < UNIX_TIMESTAMP('2025-12-21') * 1000
ORDER BY created_at DESC LIMIT 50;
-- Should use created_at index


-- ============================================================================
-- STEP 12: Summary
-- ============================================================================

SELECT 'Migration Summary' as step;

SELECT
    'Total Records' as metric,
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
-- NOTES:
-- ============================================================================
-- 1. After running these queries, restart the Experience API service
-- 2. Monitor logs for "Error inserting transfer" messages - these indicate
--    duplicate redis_key attempts (expected if same keys in Redis)
-- 3. If you see many duplicate errors after restart, it means the service is
--    re-syncing already processed data (this is a separate issue with the
--    sync logic using in-memory arrays instead of database checks)
-- 4. To fix the re-sync issue, the application code needs to be updated
--    to check the database before attempting INSERT
-- ============================================================================

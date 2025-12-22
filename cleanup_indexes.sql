-- ============================================================================
-- Index Cleanup and Optimization
-- ============================================================================
-- This script identifies and removes redundant/unnecessary indexes
-- Run after applying the duplicate fix
-- ============================================================================

USE experienceapi;

-- ============================================================================
-- STEP 1: Show ALL Current Indexes
-- ============================================================================

SELECT '=== CURRENT INDEXES ===' as info;

SELECT
    INDEX_NAME,
    COLUMN_NAME,
    NON_UNIQUE,
    SEQ_IN_INDEX,
    INDEX_TYPE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;


-- ============================================================================
-- STEP 2: Analyze Index Usage
-- ============================================================================

SELECT '=== INDEX ANALYSIS ===' as info;

-- Check index sizes
SELECT
    INDEX_NAME,
    ROUND(SUM(STAT_VALUE * @@innodb_page_size) / 1024 / 1024, 2) as size_mb
FROM mysql.innodb_index_stats
WHERE database_name = 'experienceapi'
  AND table_name = 'transfer'
GROUP BY INDEX_NAME
ORDER BY size_mb DESC;


-- ============================================================================
-- STEP 3: Identify Redundant Indexes
-- ============================================================================

SELECT '=== REDUNDANT INDEXES TO REMOVE ===' as info;

-- Composite indexes are REDUNDANT if:
-- 1. Both columns have standalone indexes
-- 2. Queries don't filter by BOTH columns together frequently

-- Example: If you have:
--   - INDEX on created_at
--   - INDEX on success
--   - INDEX on (created_at, success)  ← Redundant UNLESS queries filter by both
-- Then the composite index is only useful for: WHERE created_at = X AND success = Y
-- Not useful for: WHERE created_at = X  (standalone index is used)
-- Not useful for: WHERE success = Y     (standalone index is used)


-- ============================================================================
-- STEP 4: Safe Indexes to Remove (RECOMMENDED)
-- ============================================================================

-- REMOVE: Old composite index on (id, redis_key) - no longer needed with PRIMARY on auto_id
-- Note: Check if this index exists first using SHOW INDEX output from Step 1

-- Method 1: Drop with error handling (MySQL 5.7.4+)
-- DROP INDEX IF EXISTS `id` ON transfer;

-- Method 2: Safe drop for all MySQL versions
SET @drop_index_sql = (
    SELECT IF(
        COUNT(*) > 0,
        'DROP INDEX `id` ON transfer',
        'SELECT "Index id does not exist" as info'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'experienceapi'
      AND TABLE_NAME = 'transfer'
      AND INDEX_NAME = 'id'
      AND COLUMN_NAME != 'id'  -- Exclude if it's idx_transfer_id
);

PREPARE stmt FROM @drop_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- If composite index with different name exists, drop it:
SET @drop_composite_sql = (
    SELECT IF(
        COUNT(*) > 0,
        CONCAT('DROP INDEX `', INDEX_NAME, '` ON transfer'),
        'SELECT "No composite id+redis_key index found" as info'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'experienceapi'
      AND TABLE_NAME = 'transfer'
      AND INDEX_NAME NOT IN ('PRIMARY', 'idx_transfer_id', 'idx_redis_key_unique')
      AND COLUMN_NAME IN ('id', 'redis_key')
    GROUP BY INDEX_NAME
    HAVING COUNT(DISTINCT COLUMN_NAME) = 2
    LIMIT 1
);

PREPARE stmt FROM @drop_composite_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================================
-- STEP 5: Potentially Redundant Composite Indexes
-- ============================================================================

-- DECISION NEEDED: Keep or remove these based on query patterns

-- Option 1: Remove idx_transfer_created_success
-- Remove if queries rarely filter by BOTH created_at AND success together
-- DROP INDEX idx_transfer_created_success ON transfer;
-- Reason: Both created_at and success have standalone indexes

-- Option 2: Remove idx_transfer_created_direction
-- Remove if queries rarely filter by BOTH created_at AND direction together
-- DROP INDEX idx_transfer_created_direction ON transfer;
-- Reason: Both created_at and direction have standalone indexes

-- Option 3: Remove idx_transfer_direction_success
-- Remove if queries rarely filter by BOTH direction AND success together
-- DROP INDEX idx_transfer_direction_success ON transfer;
-- Reason: Both direction and success have standalone indexes


-- ============================================================================
-- STEP 6: Query Pattern Analysis (Before Deciding)
-- ============================================================================

-- Check which indexes are actually USED by common queries

SELECT '=== QUERY PATTERN TESTS ===' as info;

-- Test 1: Queries by created_at only
EXPLAIN SELECT * FROM transfer
WHERE created_at >= UNIX_TIMESTAMP('2025-12-20') * 1000
  AND created_at < UNIX_TIMESTAMP('2025-12-21') * 1000
ORDER BY created_at DESC LIMIT 50;
-- Should use: created_at index (NOT composite)

-- Test 2: Queries by created_at AND success
EXPLAIN SELECT * FROM transfer
WHERE created_at >= UNIX_TIMESTAMP('2025-12-20') * 1000
  AND created_at < UNIX_TIMESTAMP('2025-12-21') * 1000
  AND success = 1
ORDER BY created_at DESC LIMIT 50;
-- Uses: idx_transfer_created_success OR created_at (check which one)

-- Test 3: Queries by created_at AND direction
EXPLAIN SELECT * FROM transfer
WHERE created_at >= UNIX_TIMESTAMP('2025-12-20') * 1000
  AND created_at < UNIX_TIMESTAMP('2025-12-21') * 1000
  AND direction = 1
ORDER BY created_at DESC LIMIT 50;
-- Uses: idx_transfer_created_direction OR created_at (check which one)

-- Test 4: Queries by direction AND success
EXPLAIN SELECT * FROM transfer
WHERE direction = 1
  AND success = 1
LIMIT 50;
-- Uses: idx_transfer_direction_success OR one of the standalone indexes


-- ============================================================================
-- STEP 7: RECOMMENDED INDEX CONFIGURATION
-- ============================================================================

SELECT '=== RECOMMENDED FINAL INDEXES ===' as info;

-- Essential indexes to KEEP:
-- 1. PRIMARY KEY (auto_id)              - Required for row identification
-- 2. UNIQUE (redis_key)                 - Prevents duplicate syncs *** CRITICAL ***
-- 3. INDEX (id)                         - Fast transfer ID lookups
-- 4. INDEX (created_at)                 - Most queries filter by date range
-- 5. INDEX (direction)                  - Queries filter by INBOUND/OUTBOUND
-- 6. INDEX (success)                    - Queries filter by status
-- 7. INDEX (redis_key) [from migration] - Fast JOIN with fx_quote/fx_transfer
-- 8. INDEX (dfsp)                       - Queries filter by DFSP
-- 9. INDEX (batch_id)                   - Queries filter by batch

-- Composite indexes to KEEP (if queries use them):
-- - idx_transfer_created_success   - Keep if filtering by date + status is common
-- - idx_transfer_created_direction - Keep if filtering by date + direction is common

-- Composite indexes to REMOVE (likely redundant):
-- - idx_transfer_direction_success - Rarely filter by direction + success together


-- ============================================================================
-- STEP 8: Execute Cleanup (CONSERVATIVE APPROACH)
-- ============================================================================

SELECT '=== EXECUTING INDEX CLEANUP ===' as info;

-- SAFE TO REMOVE: Old composite index (if it exists)
-- Using safe drop method for all MySQL versions

SET @cleanup_sql = (
    SELECT IF(
        COUNT(*) > 0,
        CONCAT('DROP INDEX `', INDEX_NAME, '` ON transfer'),
        'SELECT "No redundant index to remove" as info'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'experienceapi'
      AND TABLE_NAME = 'transfer'
      AND INDEX_NAME = 'id'
      AND NON_UNIQUE = 1  -- Not the primary key
    LIMIT 1
);

PREPARE stmt FROM @cleanup_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- POTENTIALLY SAFE TO REMOVE: idx_transfer_direction_success
-- Uncomment ONLY if EXPLAIN tests show it's not used

/*
SET @drop_dir_success = (
    SELECT IF(
        COUNT(*) > 0,
        'DROP INDEX idx_transfer_direction_success ON transfer',
        'SELECT "Index idx_transfer_direction_success does not exist" as info'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'experienceapi'
      AND TABLE_NAME = 'transfer'
      AND INDEX_NAME = 'idx_transfer_direction_success'
    LIMIT 1
);

PREPARE stmt FROM @drop_dir_success;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
*/

-- Keep these for now (used by findAllWithFX in Transfer.js:851):
-- - idx_transfer_created_success   (used for status summary queries)
-- - idx_transfer_created_direction (used for direction + date range queries)


-- ============================================================================
-- STEP 9: Verify Final State
-- ============================================================================

SELECT '=== FINAL INDEX CONFIGURATION ===' as info;

SHOW INDEX FROM transfer;

-- Expected indexes:
-- PRIMARY          auto_id                  (auto-increment)
-- idx_redis_key_unique  redis_key           (UNIQUE - prevents duplicates)
-- idx_transfer_id  id                       (fast lookups)
-- created_at       created_at               (date range queries)
-- direction        direction                (INBOUND/OUTBOUND filter)
-- success          success                  (status filter)
-- idx_transfer_redis_key  redis_key         (JOINs with fx tables)
-- idx_transfer_dfsp  dfsp                   (DFSP filter)
-- idx_transfer_batch_id  batch_id           (batch filter)
-- idx_transfer_created_success  (created_at, success)  - composite
-- idx_transfer_created_direction  (created_at, direction)  - composite


-- ============================================================================
-- STEP 10: Calculate Space Saved
-- ============================================================================

SELECT '=== SPACE SAVED ESTIMATE ===' as info;

-- Compare table size before and after
SELECT
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS total_size_mb,
    ROUND((data_length / 1024 / 1024), 2) AS data_size_mb,
    ROUND((index_length / 1024 / 1024), 2) AS index_size_mb,
    table_rows
FROM information_schema.tables
WHERE table_schema = 'experienceapi'
  AND table_name = 'transfer';


-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. Run ANALYZE TABLE after removing indexes to update statistics:
--    ANALYZE TABLE transfer;
--
-- 2. Monitor query performance after removing indexes
--
-- 3. If queries slow down, re-add specific indexes that were removed
--
-- 4. Composite indexes (created_at, success) and (created_at, direction)
--    are LIKELY useful - keep them unless you confirm they're not used
--
-- 5. The UNIQUE index on redis_key is CRITICAL - never remove it!
-- ============================================================================


-- ============================================================================
-- FINAL COMMAND: Update Statistics
-- ============================================================================

ANALYZE TABLE transfer;

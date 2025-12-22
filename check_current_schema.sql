-- ============================================================================
-- Check Current Schema - Diagnostic Script
-- ============================================================================
-- Run this to understand current table structure before fixing
-- ============================================================================

USE experienceapi;

-- ============================================================================
-- Check table structure
-- ============================================================================

SELECT '=== CURRENT COLUMNS ===' as info;
DESCRIBE transfer;

-- ============================================================================
-- Check for auto_increment columns
-- ============================================================================

SELECT '=== AUTO_INCREMENT COLUMNS ===' as info;
SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    COLUMN_KEY,
    EXTRA
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND EXTRA LIKE '%auto_increment%';

-- ============================================================================
-- Check primary key definition
-- ============================================================================

SELECT '=== PRIMARY KEY ===' as info;
SELECT
    CONSTRAINT_NAME,
    COLUMN_NAME,
    ORDINAL_POSITION
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND CONSTRAINT_NAME = 'PRIMARY'
ORDER BY ORDINAL_POSITION;

-- ============================================================================
-- Check all indexes
-- ============================================================================

SELECT '=== ALL INDEXES ===' as info;
SELECT
    INDEX_NAME,
    COLUMN_NAME,
    NON_UNIQUE,
    SEQ_IN_INDEX
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- ============================================================================
-- Check for duplicates
-- ============================================================================

SELECT '=== DUPLICATE CHECK ===' as info;
SELECT
    COUNT(DISTINCT id) as unique_transfer_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicates
FROM transfer;

-- ============================================================================
-- Show sample data structure
-- ============================================================================

SELECT '=== SAMPLE DATA (first 2 rows) ===' as info;
SELECT * FROM transfer LIMIT 2;

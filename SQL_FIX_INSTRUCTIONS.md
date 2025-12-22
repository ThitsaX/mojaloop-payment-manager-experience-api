# SQL Fix Instructions - Quick Guide

## Problem
Duplicate transfer records appearing in UI (same transaction ID shown twice with different directions).

## Solution Files

I've created 4 SQL files for you:

1. **simple_fix.sql** ⭐ RECOMMENDED - Use this one
2. manual_fix_duplicates.sql - Comprehensive version with detailed comments
3. cleanup_indexes.sql - Advanced index optimization (fixed syntax errors)
4. drop_redundant_index.sql - Simple helper to drop one specific index

## Quick Start (Use simple_fix.sql)

### Step 1: Connect to MySQL

```bash
kubectl exec -it experience-api-db-pxc-0 -- mysql -u experienceapiuser -p experienceapi
```

### Step 2: Run Commands

Copy and paste the SQL commands from `simple_fix.sql` **one section at a time**.

**Important:**
- Don't run the entire file at once
- Execute each STEP separately
- Check the output after each step

### Step 3: Execution Order

```sql
-- 1. Check current state
SHOW INDEX FROM transfer;

-- 2. Backup (CRITICAL!)
CREATE TABLE transfer_backup_20251222 AS SELECT * FROM transfer;

-- 3. Remove duplicates
DELETE t1 FROM transfer t1
INNER JOIN transfer t2 ON t1.id = t2.id
WHERE t1.created_at > t2.created_at
   OR (t1.created_at = t2.created_at AND t1.redis_key > t2.redis_key);

-- 4. Drop primary key
ALTER TABLE transfer DROP PRIMARY KEY;

-- 5. Add auto_id
ALTER TABLE transfer ADD COLUMN auto_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST;

-- 6. Add UNIQUE constraint
ALTER TABLE transfer ADD UNIQUE KEY idx_redis_key_unique (redis_key);

-- 7. Add index on id
ALTER TABLE transfer ADD INDEX idx_transfer_id (id);

-- 8. Test
-- (see simple_fix.sql for test commands)

-- 9. Update statistics
ANALYZE TABLE transfer;
```

## What Each File Does

### simple_fix.sql ⭐
- **Use:** Primary fix script
- **When:** First time fixing the issue
- **Safe:** Yes, creates backup first
- **Time:** 2-5 minutes

### manual_fix_duplicates.sql
- **Use:** If you want detailed explanations
- **When:** You want to understand each step
- **Safe:** Yes, comprehensive
- **Time:** 5-10 minutes (includes verification steps)

### cleanup_indexes.sql (FIXED)
- **Use:** After running simple_fix.sql
- **When:** Want to optimize indexes further
- **Safe:** Yes, but optional
- **Time:** 2-3 minutes
- **Note:** Fixed the `DROP INDEX IF EXISTS` syntax errors

### drop_redundant_index.sql
- **Use:** Simple helper to drop 'id' index
- **When:** After the main fix
- **Safe:** Yes
- **Time:** 30 seconds

## Common Errors Fixed

### Error: DROP INDEX IF EXISTS syntax error
**Old (caused error):**
```sql
DROP INDEX IF EXISTS id ON transfer;  -- ❌ Syntax error in some MySQL versions
```

**New (fixed):**
```sql
-- Check first
SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = 'experienceapi'
  AND TABLE_NAME = 'transfer'
  AND INDEX_NAME = 'id';

-- Then drop if exists
DROP INDEX `id` ON transfer;  -- ✅ Works in all versions
```

## Verification After Fix

Run this to confirm success:

```sql
-- Should show 0 duplicates
SELECT
    COUNT(DISTINCT id) as unique_ids,
    COUNT(*) as total_records,
    COUNT(*) - COUNT(DISTINCT id) as duplicates_should_be_zero
FROM transfer;

-- Should show UNIQUE constraint on redis_key
SHOW INDEX FROM transfer WHERE Column_name = 'redis_key';
```

## Expected Results

### Before Fix
```
mysql> SELECT COUNT(DISTINCT id), COUNT(*) FROM transfer;
+---------------------+----------+
| COUNT(DISTINCT id)  | COUNT(*) |
+---------------------+----------+
| 40000               | 80000    |  ← 40,000 duplicates!
+---------------------+----------+
```

### After Fix
```
mysql> SELECT COUNT(DISTINCT id), COUNT(*) FROM transfer;
+---------------------+----------+
| COUNT(DISTINCT id)  | COUNT(*) |
+---------------------+----------+
| 40000               | 40000    |  ← No duplicates!
+---------------------+----------+
```

## Rollback (If Needed)

If something goes wrong:

```sql
-- Drop the modified table
DROP TABLE transfer;

-- Restore from backup
CREATE TABLE transfer AS SELECT * FROM transfer_backup_20251222;

-- Add back original primary key
ALTER TABLE transfer ADD PRIMARY KEY (id, redis_key);
```

## Post-Fix Steps

1. **Restart Experience API**
   ```bash
   kubectl rollout restart deployment/orange-experience-api
   ```

2. **Monitor Logs**
   ```bash
   kubectl logs -f orange-experience-api-<pod> | grep -i "error inserting"
   ```

   You WILL see "Error inserting transfer" messages because of the re-sync issue (this is expected and safe - see my previous explanation).

3. **Verify UI**
   - Make a test transaction
   - Check Payment Manager UI
   - Should only see ONE record per transaction

## Next Steps (Future Improvements)

The fix prevents duplicates, but the service still re-syncs all data on restart. To fix this:

1. Update `src/lib/cacheDatabase/index.js` to check database before INSERT
2. Or implement leader election for sync (from scalability analysis)

Let me know if you want help with either of these!

## Summary

✅ **simple_fix.sql** - Start here
✅ Creates backup automatically
✅ Removes duplicates safely
✅ Adds UNIQUE constraint
✅ Prevents future duplicates

❌ **DON'T** run cleanup_indexes.sql until after simple_fix.sql completes
❌ **DON'T** skip the backup step
❌ **DON'T** run all commands at once - go step by step

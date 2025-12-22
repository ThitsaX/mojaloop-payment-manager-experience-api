# Step-by-Step Fix for Error 1075

## The Error You Got

```
ErrCode: 1075. Incorrect table definition; there can be only one auto column and it must be defined as a key
```

**Cause:** The `auto_id` column already exists in your table with AUTO_INCREMENT, so you can't drop the primary key while it's there.

## Solution

Follow these steps **EXACTLY** in order:

---

## Step 1: Check Current Schema

```bash
kubectl exec -it experience-api-db-pxc-0 -- mysql -u experienceapiuser -p experienceapi
```

Then run:
```sql
DESCRIBE transfer;
```

**Look for:** Does `auto_id` column exist?
- ✅ **If YES:** Follow "Path A" below
- ❌ **If NO:** Follow "Path B" below

---

## Path A: auto_id EXISTS (Most Likely Your Case)

### A1. Backup
```sql
DROP TABLE IF EXISTS transfer_backup_20251222;
CREATE TABLE transfer_backup_20251222 AS SELECT * FROM transfer;
```

### A2. Remove Duplicates
```sql
DELETE t1 FROM transfer t1
INNER JOIN transfer t2 ON t1.id = t2.id
WHERE t1.created_at > t2.created_at
   OR (t1.created_at = t2.created_at AND t1.redis_key > t2.redis_key);
```

### A3. Remove AUTO_INCREMENT from auto_id
```sql
ALTER TABLE transfer MODIFY COLUMN auto_id INT UNSIGNED;
```

### A4. Drop Primary Key (Now it will work!)
```sql
ALTER TABLE transfer DROP PRIMARY KEY;
```

### A5. Drop old auto_id
```sql
ALTER TABLE transfer DROP COLUMN auto_id;
```

### A6. Add new auto_id with AUTO_INCREMENT
```sql
ALTER TABLE transfer
ADD COLUMN auto_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST;
```

### A7. Add UNIQUE constraint on redis_key
```sql
ALTER TABLE transfer
ADD UNIQUE KEY idx_redis_key_unique (redis_key);
```

### A8. Add index on id
```sql
ALTER TABLE transfer ADD INDEX idx_transfer_id (id);
```

### A9. Verify
```sql
DESCRIBE transfer;
SHOW INDEX FROM transfer;
```

**Expected Result:**
- `auto_id` is PRIMARY KEY with AUTO_INCREMENT
- `redis_key` has UNIQUE constraint
- `id` has INDEX

---

## Path B: auto_id DOES NOT EXIST

Just run `simple_fix.sql` as originally planned - it will work fine.

---

## Quick Test After Fix

```sql
-- Should succeed
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_001', 'test_key_001', 1, UNIX_TIMESTAMP() * 1000);

-- Should FAIL with duplicate error (this is correct!)
INSERT INTO transfer (id, redis_key, direction, created_at)
VALUES ('TEST_002', 'test_key_001', -1, UNIX_TIMESTAMP() * 1000);

-- Clean up
DELETE FROM transfer WHERE id LIKE 'TEST_%';
```

---

## One-File Solution

I created **fixed_migration.sql** that handles both cases automatically.

**Just run it step by step** - it includes all the checks and handling for existing auto_id.

---

## Verification Checklist

After running the fix:

- [ ] `DESCRIBE transfer` shows `auto_id` as first column
- [ ] `auto_id` has `auto_increment` in EXTRA column
- [ ] `auto_id` has `PRI` in KEY column
- [ ] `SHOW INDEX` shows UNIQUE on `redis_key`
- [ ] No duplicate records: `SELECT COUNT(*) - COUNT(DISTINCT id) FROM transfer;` returns 0
- [ ] Test insert works (see above)
- [ ] Test duplicate redis_key fails (this is expected!)

---

## What Went Wrong?

The old migration from SQLite to MySQL:
1. **Had** `auto_id` in old schema
2. **Changed** to composite primary key (id, redis_key)
3. **But kept** `auto_id` column (without AUTO_INCREMENT or as primary key)
4. This blocking state prevented simple schema changes

The fix removes and re-creates `auto_id` properly.

---

## Rollback (If Needed)

```sql
DROP TABLE transfer;
CREATE TABLE transfer AS SELECT * FROM transfer_backup_20251222;
ALTER TABLE transfer ADD PRIMARY KEY (id, redis_key);
```

---

## Files Summary

| File | Use When |
|------|----------|
| **check_current_schema.sql** | ⭐ Run this FIRST to diagnose |
| **fixed_migration.sql** | ⭐ Run this to fix (handles auto_id) |
| simple_fix.sql | Only if auto_id doesn't exist |
| manual_fix_duplicates.sql | Alternative comprehensive version |

---

## Need Help?

If you get stuck:
1. Run `check_current_schema.sql` and share the output
2. Share any error messages
3. I'll provide exact commands for your situation

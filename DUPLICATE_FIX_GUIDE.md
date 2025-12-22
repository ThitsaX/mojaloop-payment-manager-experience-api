# Duplicate Transfer Records - Fix Guide

## Problem Summary

**Symptom:** Same transaction appears twice in Payment Manager UI - once as INBOUND and once as OUTBOUND with the same transaction ID.

**Root Cause:** During SQLite → MySQL migration, the primary key was changed from:
- **Old:** Auto-increment ID + UNIQUE constraint on `redis_key`
- **New:** Composite primary key `['id', 'redis_key']` (allows duplicates)

**Impact:** Same transfer synced from multiple Redis keys creates duplicate database records.

---

## Solution Overview

Two new migrations will:
1. **Cleanup duplicates** - Remove existing duplicate records (keeping oldest)
2. **Fix schema** - Add auto-increment primary key + UNIQUE constraint on `redis_key`

---

## Pre-Deployment Checklist

### 1. Backup Database

```bash
# Connect to MySQL pod
kubectl exec -it experience-api-db-pxc-0 -- bash

# Create backup
mysqldump -u experienceapiuser -p experienceapi > /tmp/backup_before_fix_$(date +%Y%m%d_%H%M%S).sql

# Copy backup to local machine
kubectl cp experience-api-db-pxc-0:/tmp/backup_before_fix_*.sql ./backup_before_fix.sql
```

### 2. Check Current Duplicates

```bash
# Connect to MySQL
kubectl exec -it experience-api-db-pxc-0 -- mysql -u experienceapiuser -p experienceapi

# Run this query to see duplicates
SELECT id, COUNT(*) as count,
       GROUP_CONCAT(redis_key) as redis_keys,
       GROUP_CONCAT(direction) as directions
FROM transfer
GROUP BY id
HAVING count > 1
LIMIT 20;

# Count total duplicates
SELECT COUNT(*) as duplicate_transfer_ids
FROM (
    SELECT id
    FROM transfer
    GROUP BY id
    HAVING COUNT(*) > 1
) as dups;
```

### 3. Check Affected Records Example

```sql
-- Replace '01JXN43BRQW7PCQM1XF6MTQRMB' with an actual duplicate ID from above query
SELECT id, redis_key, direction, sender, recipient, amount, currency, created_at
FROM transfer
WHERE id = '01JXN43BRQW7PCQM1XF6MTQRMB'
ORDER BY created_at;
```

---

## Deployment Steps

### Step 1: Update Code

```bash
# Pull latest code with migrations
git pull origin develop/main

# Verify migrations are present
ls -la src/lib/cacheDatabase/migrations/
# Should show:
#   20251222000001_cleanup_duplicate_transfers.js
#   20251222000002_fix_duplicate_transfers.js
```

### Step 2: Build and Deploy

```bash
# Build Docker image
docker build -t your-registry/experience-api:v3.1-duplicate-fix .

# Push to registry
docker push your-registry/experience-api:v3.1-duplicate-fix

# Update Kubernetes deployment
kubectl set image deployment/orange-experience-api \
  experience-api=your-registry/experience-api:v3.1-duplicate-fix
```

### Step 3: Monitor Migration

```bash
# Watch pod logs during startup (migrations run automatically)
kubectl logs -f orange-experience-api-<pod-id> | grep -E "migration|duplicate|cleanup"

# Expected log output:
# Starting duplicate transfer cleanup...
# Found X transfer IDs with duplicates
# Transfer ABC123 has 2 records
#   Keeping: redis_key=transferModel_xyz, direction=1
#   Deleting: redis_key=transferModel_abc, direction=-1
# Duplicate cleanup complete
# Migration complete: Added auto_id primary key and unique constraint on redis_key
```

---

## Verification

### 1. Check Schema Changes

```sql
-- Connect to MySQL
kubectl exec -it experience-api-db-pxc-0 -- mysql -u experienceapiuser -p experienceapi

-- Verify new schema
DESCRIBE transfer;

-- Should show:
-- auto_id (PRI, auto_increment)
-- id (MUL, with index)
-- redis_key (UNI, unique)

-- Check indexes
SHOW INDEX FROM transfer;

-- Should include:
-- PRIMARY on auto_id
-- UNIQUE on redis_key
-- INDEX on id
```

### 2. Verify No Duplicates Remain

```sql
-- Should return 0 rows
SELECT id, COUNT(*) as count
FROM transfer
GROUP BY id
HAVING count > 1;
```

### 3. Check Record Count

```sql
-- Compare counts before and after
SELECT COUNT(*) as total_transfers FROM transfer;

-- If you had duplicates, this number should be LESS than before
```

### 4. Test in UI

1. Make a new test transaction
2. Check Payment Manager UI
3. **Expected:** Only ONE record appears (either INBOUND or OUTBOUND, depending on DFSP role)
4. **Should NOT see:** Two records with same transaction ID

---

## Rollback Procedure (If Needed)

### Option 1: Rollback Migrations

```bash
# Connect to pod
kubectl exec -it orange-experience-api-<pod-id> -- sh

# Rollback last 2 migrations
npx knex migrate:down --knexfile src/lib/cacheDatabase/knexfile.js
npx knex migrate:down --knexfile src/lib/cacheDatabase/knexfile.js

# Restart pod
kubectl rollout restart deployment/orange-experience-api
```

### Option 2: Restore from Backup

```bash
# Copy backup to MySQL pod
kubectl cp ./backup_before_fix.sql experience-api-db-pxc-0:/tmp/

# Connect to MySQL pod
kubectl exec -it experience-api-db-pxc-0 -- bash

# Drop and recreate database
mysql -u root -p -e "DROP DATABASE experienceapi;"
mysql -u root -p -e "CREATE DATABASE experienceapi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "GRANT ALL ON experienceapi.* TO 'experienceapiuser'@'%';"

# Restore backup
mysql -u experienceapiuser -p experienceapi < /tmp/backup_before_fix.sql

# Restart Experience API
kubectl rollout restart deployment/orange-experience-api
```

---

## FAQ

### Q: Will this delete user data?

**A:** The cleanup migration deletes DUPLICATE records only. For each duplicate transfer ID, it keeps the OLDEST record (by created_at) and deletes the others. No unique transactions are lost.

### Q: What if I have 10,000 duplicate transfers?

**A:** The cleanup migration processes all duplicates automatically. It may take 1-5 minutes depending on the number of duplicates. The migration runs during pod startup before the service accepts traffic.

### Q: Will this prevent future duplicates?

**A:** Yes. The UNIQUE constraint on `redis_key` ensures each Redis key can only be synced once. If the sync attempts to insert the same redis_key twice, the second attempt will fail gracefully with a duplicate key error (which is logged but doesn't crash the service).

### Q: Why keep the oldest record instead of newest?

**A:** The oldest record represents when the transfer was first synced, which is typically more accurate. The newer duplicate is usually just a redundant sync of the same data.

### Q: What about fx_quote and fx_transfer tables?

**A:** These tables use composite primary keys that include `redis_key`, so they're less likely to have the same issue. Monitor them separately and create similar fixes if needed.

---

## Post-Deployment Monitoring

### 1. Check Sync Performance

```bash
# Monitor sync logs
kubectl logs -f orange-experience-api-<pod-id> | grep "sync complete"

# Expected: No increase in sync time
```

### 2. Monitor Error Logs

```bash
# Check for duplicate key errors (should be rare now)
kubectl logs orange-experience-api-<pod-id> | grep -i "duplicate\|error inserting"
```

### 3. Monitor Database Size

```sql
-- Check table sizes
SELECT
  table_name,
  ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
  table_rows
FROM information_schema.tables
WHERE table_schema = 'experienceapi';

-- After cleanup, transfer table should be smaller
```

---

## Support

If you encounter issues:

1. **Check logs:** `kubectl logs orange-experience-api-<pod-id>`
2. **Check database:** Connect to MySQL and verify schema
3. **Rollback:** Use rollback procedure above
4. **Contact:** Create GitHub issue with logs and error details

---

## Migration Files

- `20251222000001_cleanup_duplicate_transfers.js` - Removes existing duplicates
- `20251222000002_fix_duplicate_transfers.js` - Fixes schema to prevent future duplicates

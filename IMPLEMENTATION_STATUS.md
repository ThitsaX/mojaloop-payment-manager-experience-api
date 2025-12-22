# Implementation Status - MySQL Database Migration & Sync Optimization

**Project:** mojaloop-payment-manager-experience-api
**Branch:** `adding-mysql-db`
**Last Updated:** 2025-12-18
**Status:** 🟡 In Progress

---

## Project Overview

This is the PM4ML (Payment Manager for Mojaloop) Experience API service - a backend service that provides REST APIs for payment management in the Mojaloop ecosystem.

### Technology Stack
- **Framework:** Koa.js
- **Database (NEW):** MySQL 2 (migrated from SQLite better-sqlite3)
- **Caching:** Redis
- **Query Builder:** Knex.js
- **Language:** JavaScript (Node.js)

---

## Current Implementation Stage

### ✅ Completed

1. **MySQL Database Migration**
   - Migrated from SQLite (`better-sqlite3`) to MySQL (`mysql2`)
   - Updated `src/lib/cacheDatabase/index.js` with MySQL configuration
   - Location: `src/lib/cacheDatabase/index.js:654-673`
   - Configuration includes:
     - Connection pooling
     - UTF-8mb4 charset support
     - UTC timezone
     - Proper connection timeout settings

2. **Configuration Updates**
   - Added MySQL database configuration in `src/config.js`
   - Environment variables added:
     - `DATABASE_HOST`
     - `DATABASE_PORT`
     - `DATABASE_USER`
     - `DATABASE_PASSWORD`
     - `DATABASE_NAME`
     - `DATABASE_CONNECTION_TIMEOUT`
     - Pool configuration (min, max)
   - Cache sync configuration:
     - `CACHE_SYNC_INTERVAL_SECONDS` (default: 30)
     - `CACHE_SYNC_BATCH_SIZE` (default: 100)
     - `CACHE_MAX_INITIAL_SYNC_KEYS` (default: 1000)

3. **Database Schema**
   - Three main tables:
     - `transfer` - Main transfer records (composite PK: `id`, `redis_key`)
     - `fx_quote` - FX quote details
     - `fx_transfer` - FX transfer details
   - Migrations located: `src/lib/cacheDatabase/migrations/`

4. **Sync Mechanism - Current Implementation**
   - **Data Flow:** Redis Cache → MySQL Database (one-way sync)
   - **Frequency:** Every 30 seconds (configurable)
   - **Batch Processing:** 100 keys per batch (configurable)
   - **In-Memory Tracking:**
     - `cachedFulfilledKeys[]` - tracks completed/successful transfers
     - `cachedPendingKeys[]` - tracks all synced keys
   - **Location:** `src/lib/cacheDatabase/index.js:68-652`

---

## Data Sync Architecture (Current)

### How Sync Works

```
┌─────────────────────────────────────────────────────────────────┐
│                   Application Startup                            │
├─────────────────────────────────────────────────────────────────┤
│ 1. Connect to MySQL                                             │
│ 2. Run migrations                                               │
│ 3. Connect to Redis                                             │
│ 4. INITIAL SYNC (limited to 1000 keys)                         │
│    - Scan Redis for patterns: transferModel_*, fxQuote_in_*    │
│    - Filter: skip keys in cachedFulfilledKeys[]                │
│    - Process in batches of 100                                  │
│ 5. Start PERIODIC SYNC (every 30s)                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Periodic Sync Process (Every 30s)                   │
├─────────────────────────────────────────────────────────────────┤
│ For each Redis key:                                             │
│                                                                  │
│  1. Parse JSON data from Redis                                  │
│  2. Transform to DB row format                                  │
│  3. Check: if (key in cachedPendingKeys[]) ?                   │
│     ├─ YES → UPDATE existing record                            │
│     └─ NO  → INSERT new record + add to cachedPendingKeys[]    │
│  4. If transfer successful → add to cachedFulfilledKeys[]      │
│                                                                  │
│  Next sync will skip keys in cachedFulfilledKeys[]             │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files Modified

| File | Changes | Lines |
|------|---------|-------|
| `src/lib/cacheDatabase/index.js` | MySQL config + sync logic | 654-737 |
| `src/config.js` | Database configuration | Added MySQL settings |
| `src/handlers.js` | Database integration | Minor updates |
| `src/index.js` | Database initialization | Added sync config |
| `package.json` | Dependencies | `better-sqlite3` → `mysql2` |

---

## 🔴 Identified Issue: Restart Problem

### The Problem

**Scenario:**
1. System has 3000 keys in Redis
2. All 3000 synced to MySQL ✅
3. Service restarts 🔄
4. **Problem:** In-memory arrays reset!
   - `cachedFulfilledKeys = []` (was 3000 keys)
   - `cachedPendingKeys = []` (was 3000 keys)

**What Happens:**
1. Sync attempts to INSERT all 3000 records again
2. All 3000 INSERTs **fail** (duplicate key constraint)
3. 3000 error messages logged: "Error inserting transfer"
4. No actual duplicates created (prevented by primary key)
5. **Critical Issue:** If Redis data changed (e.g., transfer status updated), UPDATE won't happen because INSERT fails

### Why It Happens

```javascript
// Current logic in src/lib/cacheDatabase/index.js:348-369
const keyIndex = cachedPendingKeys.indexOf(row.redis_key);
if (keyIndex === -1) {
    // Not in array → Try INSERT
    await db('transfer').insert(row);  // ❌ Fails on restart!
    cachedPendingKeys.push(row.redis_key);
} else {
    // In array → UPDATE
    await db('transfer').update(row);
}
```

**Root Cause:** In-memory arrays are **not persistent** across restarts.

### Database Constraint (Prevents Duplicates)

```javascript
// src/lib/cacheDatabase/migrations/20200728112508_create_transfer_table.js:38
table.primary(['id', 'redis_key']);  // Composite primary key
```

This prevents duplicates but also blocks updates when INSERT fails.

---

## 🎯 Planned Solution: Option 2 (Startup Array Population)

### Approach

On application startup, **before** the initial sync runs, populate the in-memory arrays from MySQL:

```javascript
// Query existing records from MySQL
const existingKeys = await db('transfer').select('redis_key');
cachedPendingKeys.push(...existingKeys.map(r => r.redis_key));

// Also populate fulfilled keys (transfers with known success status)
const fulfilledKeys = await db('transfer')
    .select('redis_key')
    .whereNotNull('success');
cachedFulfilledKeys.push(...fulfilledKeys.map(r => r.redis_key));
```

### Why This Solution?

✅ **Pros:**
- Keeps performance benefits of in-memory lookups (no SELECT per key)
- Avoids failed INSERT attempts after restart
- Ensures proper UPDATE behavior for changed transfers
- Minimal code change required
- Works with existing composite primary key

❌ **Cons:**
- Additional startup queries (one-time cost)
- Memory usage for large datasets (though already using arrays)

### Alternative Considered (Option 1 - UPSERT Pattern)

This was the previous implementation that was reverted:

```javascript
const existing = await db('transfer').where({ redis_key: row.redis_key }).first();
if (!existing) {
    await db('transfer').insert(row);
} else {
    await db('transfer').where({ redis_key: row.redis_key }).update(row);
}
```

**Why not chosen:**
- Requires SELECT query for every key (performance impact)
- More database round-trips
- User preferred Option 2

---

## 🔧 Next Implementation Steps

### Step 1: Add Startup Query Function

**Location:** `src/lib/cacheDatabase/index.js` in `createMemoryCache` function

**Implementation:**
```javascript
// After database connection and migrations
// Around line 683 (after: await db.migrate.latest())

// Populate in-memory arrays from existing MySQL data
const existingTransfers = await db('transfer').select('redis_key', 'success');

for (const transfer of existingTransfers) {
    cachedPendingKeys.push(transfer.redis_key);

    // Only add to fulfilled if success status is known (not null)
    if (transfer.success !== null) {
        cachedFulfilledKeys.push(transfer.redis_key);
    }
}

config.logger.log(`Loaded ${cachedPendingKeys.length} existing keys from MySQL`);
config.logger.log(`Found ${cachedFulfilledKeys.length} fulfilled transfers`);

// Also populate FX quotes and transfers if needed
const existingFxQuotes = await db('fx_quote').select('redis_key', 'success');
for (const fx of existingFxQuotes) {
    if (!cachedPendingKeys.includes(fx.redis_key)) {
        cachedPendingKeys.push(fx.redis_key);
    }
    if (fx.success !== null && !cachedFulfilledKeys.includes(fx.redis_key)) {
        cachedFulfilledKeys.push(fx.redis_key);
    }
}
```

### Step 2: Testing

1. **Test Scenario 1: Fresh Start**
   - Clear MySQL database
   - Start service
   - Verify initial sync works

2. **Test Scenario 2: Restart with Existing Data**
   - Populate Redis with 1000 keys
   - Let sync complete
   - Restart service
   - Verify:
     - No "Error inserting" messages
     - Arrays populated correctly
     - No duplicate sync attempts

3. **Test Scenario 3: Data Updates**
   - Sync 100 transfers
   - Update transfer status in Redis
   - Wait for next sync
   - Verify MySQL has updated data

### Step 3: Performance Validation

Monitor:
- Startup time increase (acceptable trade-off)
- Memory usage with populated arrays
- Sync performance (should improve, fewer failed INSERTs)
- Log noise reduction (no more error spam)

---

## Environment Configuration

### Required Environment Variables

```bash
# MySQL Database
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=pm4ml
DATABASE_PASSWORD=your_password
DATABASE_NAME=pm4ml_cache
DATABASE_CONNECTION_TIMEOUT=10000

# Database Pool
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_ACQUIRE_CONNECTION_TIMEOUT=10000

# Cache Sync Settings
CACHE_SYNC_INTERVAL_SECONDS=30
CACHE_SYNC_BATCH_SIZE=100
CACHE_MAX_INITIAL_SYNC_KEYS=1000

# Redis (existing)
CACHE_REDIS_URL=redis://localhost:6379
```

### Example `.env` File

See `.env.example` for complete configuration template.

---

## Files Requiring Attention

### Modified Files (Current Branch)

```
M  .env.example
M  Dockerfile
M  package-lock.json
M  package.json
M  src/config.js
M  src/handlers.js
M  src/index.js
M  src/lib/cacheDatabase/index.js
M  src/lib/cacheDatabase/migrations/20200728112508_create_transfer_table.js
M  src/lib/cacheDatabase/migrations/20240824130400_create_fx_quotes_table.js
M  src/lib/cacheDatabase/migrations/20240824130400_create_fxtransfer_table.js
```

### Key File Locations

- **Main sync logic:** `src/lib/cacheDatabase/index.js`
- **Database config:** `src/config.js`
- **Migrations:** `src/lib/cacheDatabase/migrations/`
- **Models:** `src/lib/model/`

---

## Testing Commands

```bash
# Run unit tests
npm run test:unit

# Run integration tests
npm run test:int

# Check for issues
npm run lint

# Start development server
npm run start:dev
```

---

## Important Notes

1. **In-Memory Arrays Are Volatile**
   - `cachedFulfilledKeys` and `cachedPendingKeys` reset on restart
   - This is the core issue we're addressing

2. **Composite Primary Key Protection**
   - Table has PK on `[id, redis_key]`
   - Prevents duplicate records
   - But also blocks UPDATE when INSERT fails

3. **Sync is One-Way**
   - Redis → MySQL only
   - Redis is source of truth for live data
   - MySQL is for persistence and querying

4. **Progressive Sync Design**
   - Initial sync: limited (1000 keys)
   - Periodic sync: complete
   - Prevents startup delays while ensuring completeness

---

## Questions for Next Session

1. Should we also populate arrays for `fx_quote` and `fx_transfer` tables?
2. What's the acceptable startup delay with array population?
3. Should we add a health check to verify array population?
4. Do we need metrics/logging for array population performance?

---

## Related Documentation

- `CLAUDE.md` - Project overview and development commands
- `MYSQL_SETUP.md` - MySQL setup instructions
- `README.md` - General project documentation

---

## Resume Command for Next Session

```bash
cd C:\Projects\ThitsaWorks\ThitsaX\pm4ml-apps\mojaloop-payment-manager-experience-api
claude --continue
```

Or if you named this session:
```bash
claude --resume mysql-sync-optimization
```

**Tell Claude:** "Let's implement option 2 - populating the arrays from MySQL on startup"

---

**End of Implementation Status Document**

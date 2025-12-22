# MySQL Database Setup Guide

## Overview

As of version 3.x, the PM4ML Experience API uses **MySQL** as the persistent storage layer instead of in-memory SQLite. This change provides:

- **Data Persistence**: Survives service restarts and pod crashes
- **Disaster Recovery**: Data remains available even if Redis goes down
- **High Availability**: Supports MySQL replication and clustering
- **Production Ready**: Industry-standard persistence solution

## Architecture

```
SDK Adapter → Redis (cache) → Experience API → MySQL (persistent storage)
                                    ↓
                              UI / Clients
```

**Data Flow:**
1. SDK Adapter writes transfer data to Redis
2. Experience API syncs data from Redis to MySQL every 30 seconds (configurable)
3. UI queries Experience API, which reads from MySQL
4. If Redis fails, data is preserved in MySQL and can be recovered

## Prerequisites

### For Kubernetes Deployment (Percona XtraDB Cluster)

You're using Percona XtraDB Cluster 8.0.35-27.1, which is MySQL 8.0 compatible with built-in high availability.

**Required:**
- Kubernetes cluster with PersistentVolume support
- Percona XtraDB Cluster deployed (image: `percona/percona-xtradb-cluster:8.0.35-27.1`)
- Database credentials (user, password, database name)
- Network connectivity between Experience API pods and MySQL cluster

### Database Requirements

- MySQL 8.0 or compatible (Percona XtraDB Cluster, MariaDB 10.5+)
- Minimum 2GB RAM allocated to MySQL
- Storage: 10GB minimum (adjust based on transaction volume)
- Network latency: < 10ms recommended for optimal performance

## Environment Variables

Add the following environment variables to your Kubernetes deployment:

```yaml
# Required Configuration
- name: DATABASE_HOST
  value: "your-mysql-service-name"  # e.g., "percona-xtradb-cluster"

- name: DATABASE_PORT
  value: "3306"

- name: DATABASE_USER
  valueFrom:
    secretKeyRef:
      name: mysql-credentials
      key: username

- name: DATABASE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: mysql-credentials
      key: password

- name: DATABASE_NAME
  value: "pm4ml_experience_api"

# Optional - Connection Timeouts (milliseconds)
- name: DATABASE_CONNECTION_TIMEOUT
  value: "10000"  # 10 seconds

- name: DATABASE_ACQUIRE_TIMEOUT
  value: "10000"  # 10 seconds

# Optional - Connection Pool Settings
- name: DATABASE_POOL_MIN
  value: "2"  # Minimum connections in pool

- name: DATABASE_POOL_MAX
  value: "20"  # Maximum connections in pool (adjust based on load)

- name: DATABASE_POOL_ACQUIRE_TIMEOUT
  value: "30000"  # 30 seconds

- name: DATABASE_POOL_IDLE_TIMEOUT
  value: "30000"  # 30 seconds

- name: DATABASE_POOL_CREATE_TIMEOUT
  value: "30000"  # 30 seconds

# Cache Sync Configuration
- name: CACHE_SYNC_INTERVAL_SECONDS
  value: "30"  # How often to sync Redis → MySQL

- name: CACHE_SYNC_BATCH_SIZE
  value: "100"  # Keys per batch

- name: CACHE_MAX_INITIAL_SYNC_KEYS
  value: "1000"  # Limit for initial sync on startup
```

## Kubernetes Secret Example

Create a secret for MySQL credentials:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mysql-credentials
type: Opaque
stringData:
  username: pm4ml_user
  password: your-secure-password-here
```

Apply the secret:
```bash
kubectl apply -f mysql-secret.yaml
```

## Database Setup

### 1. Create Database and User

Connect to your Percona XtraDB Cluster:

```bash
kubectl exec -it percona-xtradb-cluster-0 -- mysql -u root -p
```

Create the database and user:

```sql
-- Create database
CREATE DATABASE pm4ml_experience_api CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user with appropriate permissions
CREATE USER 'pm4ml_user'@'%' IDENTIFIED BY 'your-secure-password-here';

-- Grant privileges
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER
ON pm4ml_experience_api.*
TO 'pm4ml_user'@'%';

-- Flush privileges
FLUSH PRIVILEGES;

-- Verify
SHOW GRANTS FOR 'pm4ml_user'@'%';
```

### 2. Run Database Migrations

Migrations run automatically on service startup, creating the following tables:

- **transfer** - Main transfer records (inbound/outbound)
- **fx_quote** - Foreign exchange quote data
- **fx_transfer** - Foreign exchange transfer data

**Manual Migration (if needed):**

```bash
# SSH into running pod
kubectl exec -it <experience-api-pod-name> -- /bin/sh

# Run migrations using Knex CLI
npx knex migrate:latest --knexfile src/lib/cacheDatabase/knexfile.js
```

### 3. Verify Migrations

Check that tables were created:

```sql
USE pm4ml_experience_api;

SHOW TABLES;
-- Should show: transfer, fx_quote, fx_transfer, knex_migrations, knex_migrations_lock

DESCRIBE transfer;
DESCRIBE fx_quote;
DESCRIBE fx_transfer;
```

## Testing the Setup

### 1. Check Service Health

```bash
# Port-forward to Experience API
kubectl port-forward svc/experience-api 3000:3000

# Check health endpoint
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 123.456,
  "timestamp": 1234567890000,
  "database": "connected"
}
```

If database is disconnected:
```json
{
  "status": "degraded",
  "uptime": 123.456,
  "timestamp": 1234567890000,
  "database": "disconnected",
  "error": "Connection timeout"
}
```

### 2. Check Database Connectivity

```bash
# From inside the pod
kubectl exec -it <experience-api-pod-name> -- /bin/sh

# Test MySQL connection
nc -zv $DATABASE_HOST $DATABASE_PORT

# Or use mysql client if available
mysql -h $DATABASE_HOST -u $DATABASE_USER -p$DATABASE_PASSWORD -e "SELECT 1"
```

### 3. Monitor Sync Process

Check logs for sync activity:

```bash
kubectl logs -f <experience-api-pod-name> | grep -i "sync"
```

Expected log entries:
```
Starting initial sync with safety limits
Processing pattern: transferModel_*
Processing 100 keys for pattern: transferModel_*
MySQL DB sync complete. Processed: 100, Errors: 0
```

### 4. Verify Data Sync

After some transfers are processed:

```sql
-- Connect to MySQL
kubectl exec -it percona-xtradb-cluster-0 -- mysql -u pm4ml_user -p pm4ml_experience_api

-- Check transfer count
SELECT COUNT(*) as transfer_count FROM transfer;

-- View recent transfers
SELECT id, sender, recipient, amount, currency, success, created_at
FROM transfer
ORDER BY created_at DESC
LIMIT 10;

-- Check FX quotes
SELECT COUNT(*) as fx_quote_count FROM fx_quote;

-- Check FX transfers
SELECT COUNT(*) as fx_transfer_count FROM fx_transfer;
```

## Connection Pool Tuning

Adjust pool settings based on your workload:

| Scenario | POOL_MIN | POOL_MAX | Notes |
|----------|----------|----------|-------|
| Low Volume (< 10 TPS) | 2 | 10 | Minimal resource usage |
| Medium Volume (10-50 TPS) | 5 | 20 | Recommended default |
| High Volume (> 50 TPS) | 10 | 50 | Scale with load |
| Multiple Replicas | min × replicas | max × replicas | Consider total connections |

**Important:** Ensure MySQL `max_connections` setting accommodates all pods:
```
max_connections = (POOL_MAX × number_of_pods) + 50 (buffer)
```

## Troubleshooting

### Issue: Connection Timeout on Startup

**Symptoms:**
```
Initial sync failed, service will continue with empty cache
Error: connect ETIMEDOUT
```

**Solutions:**
1. Verify MySQL service is running: `kubectl get pods -l app=percona-xtradb-cluster`
2. Check network connectivity: `kubectl exec <pod> -- nc -zv $DATABASE_HOST 3306`
3. Increase `DATABASE_CONNECTION_TIMEOUT` to 30000 (30 seconds)
4. Check MySQL logs: `kubectl logs percona-xtradb-cluster-0`

### Issue: Too Many Connections

**Symptoms:**
```
Error: ER_TOO_MANY_CONNECTIONS: Too many connections
```

**Solutions:**
1. Reduce `DATABASE_POOL_MAX` per pod
2. Increase MySQL `max_connections`:
   ```sql
   SET GLOBAL max_connections = 500;
   ```
3. Scale down number of Experience API replicas
4. Check for connection leaks in logs

### Issue: Slow Sync Performance

**Symptoms:**
```
MySQL DB sync complete. Processed: 1000, Errors: 0 (took 60 seconds)
```

**Solutions:**
1. Decrease `CACHE_SYNC_BATCH_SIZE` to reduce memory usage (e.g., 50)
2. Increase `CACHE_SYNC_INTERVAL_SECONDS` to reduce frequency (e.g., 60)
3. Add MySQL indexes (already included in migrations)
4. Check MySQL server performance: `SHOW PROCESSLIST;`
5. Consider adding read replicas for query distribution

### Issue: Data Not Syncing

**Symptoms:**
- Health check shows `database: connected`
- But transfer count in MySQL remains 0

**Solutions:**
1. Check Redis connectivity: `kubectl logs <pod> | grep -i redis`
2. Verify Redis contains data: `redis-cli KEYS transferModel_*`
3. Check sync interval: `kubectl logs <pod> | grep "sync complete"`
4. Verify cache sync is not disabled: Check `CACHE_SYNC_INTERVAL_SECONDS > 0`

### Issue: Migration Failures

**Symptoms:**
```
Migration failed: ER_DUP_KEYNAME: Duplicate key name 'PRIMARY'
```

**Solutions:**
1. Drop and recreate database (⚠️ DATA LOSS):
   ```sql
   DROP DATABASE pm4ml_experience_api;
   CREATE DATABASE pm4ml_experience_api CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. Or manually drop tables:
   ```sql
   DROP TABLE IF EXISTS fx_transfer, fx_quote, transfer, knex_migrations, knex_migrations_lock;
   ```
3. Restart pod to re-run migrations

## Backup and Recovery

### Backup Strategy

**Using mysqldump:**
```bash
# Create backup
kubectl exec percona-xtradb-cluster-0 -- \
  mysqldump -u root -p pm4ml_experience_api > backup_$(date +%Y%m%d).sql

# Schedule with CronJob (example)
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: percona/percona-xtradb-cluster:8.0.35-27.1
            command:
            - /bin/sh
            - -c
            - mysqldump -h percona-xtradb-cluster -u backup_user -p$MYSQL_PASSWORD pm4ml_experience_api > /backup/backup_$(date +%Y%m%d).sql
```

**Using Percona XtraBackup:**
Percona XtraDB Cluster includes built-in backup tools. Refer to Percona documentation for cluster-specific backup strategies.

### Recovery Process

**Scenario: Redis and Experience API pods crashed**

1. Verify MySQL data is intact:
   ```sql
   SELECT COUNT(*) FROM transfer;
   ```

2. Restart Experience API:
   ```bash
   kubectl rollout restart deployment/experience-api
   ```

3. Service will reconnect to MySQL and continue operating with persisted data

4. Check health: `curl http://experience-api:3000/health`

**Scenario: Complete data loss**

1. Restore from backup:
   ```bash
   kubectl exec -i percona-xtradb-cluster-0 -- \
     mysql -u root -p pm4ml_experience_api < backup_20250101.sql
   ```

2. Restart Experience API to sync with restored data

## Performance Monitoring

### Key Metrics to Monitor

1. **Connection Pool Utilization:**
   ```sql
   SHOW STATUS LIKE 'Threads_connected';
   SHOW STATUS LIKE 'Max_used_connections';
   ```

2. **Query Performance:**
   ```sql
   -- Enable slow query log
   SET GLOBAL slow_query_log = 'ON';
   SET GLOBAL long_query_time = 1;  -- Log queries > 1 second

   -- View slow queries
   SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;
   ```

3. **Table Sizes:**
   ```sql
   SELECT
     table_name,
     ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
     table_rows
   FROM information_schema.tables
   WHERE table_schema = 'pm4ml_experience_api';
   ```

4. **Index Usage:**
   ```sql
   SELECT * FROM sys.schema_unused_indexes
   WHERE object_schema = 'pm4ml_experience_api';
   ```

## Production Checklist

- [ ] MySQL user created with minimal required permissions
- [ ] Database credentials stored in Kubernetes secrets
- [ ] Connection pool settings tuned for expected load
- [ ] MySQL `max_connections` configured appropriately
- [ ] Backup strategy implemented (daily minimum)
- [ ] Monitoring and alerting configured for:
  - [ ] Database connection failures
  - [ ] High connection pool utilization
  - [ ] Slow queries
  - [ ] Disk space usage
- [ ] Health check endpoint returns 200 OK
- [ ] Sync logs show successful data synchronization
- [ ] Test recovery procedure in staging environment
- [ ] Document rollback procedure

## Migration from SQLite

If you're upgrading from a previous version using in-memory SQLite:

1. **No data migration needed** - Previous data was ephemeral (in-memory only)
2. Install `mysql2` package: `npm install mysql2@^3.11.5`
3. Remove `better-sqlite3` from dependencies (no longer needed)
4. Configure MySQL environment variables
5. Deploy updated version
6. Service will start syncing new data to MySQL automatically

## Support

For issues specific to:
- **Experience API**: Check service logs: `kubectl logs -f <pod-name>`
- **MySQL/Percona**: Check cluster status: `kubectl exec percona-xtradb-cluster-0 -- mysql -u root -p -e "SHOW STATUS LIKE 'wsrep%'"`
- **Performance**: Enable MySQL slow query log and analyze

For questions or issues, create an issue in the repository with:
- Kubernetes version
- MySQL/Percona version
- Experience API version
- Relevant logs from both services
- Environment variable configuration (redact passwords)

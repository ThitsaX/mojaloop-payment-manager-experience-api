/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 *                                                                        *
 *  MIGRATION: Add RANGE partitioning to transfer table                  *
 *                                                                        *
 *  Creates monthly partitions from August 2025 through December 2026    *
 *  This MUST run BEFORE data sync starts to avoid performance issues    *
 *                                                                        *
 *  Compatible with: Percona XtraDB Cluster 8.0.35-27.11 (MySQL 8.0)     *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log(`[Migration] Adding RANGE partitioning to ${TABLE_NAME} table...`);

    // Check if table is already partitioned
    const partitionCheck = await knex.raw(`
        SELECT PARTITION_NAME
        FROM INFORMATION_SCHEMA.PARTITIONS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = '${TABLE_NAME}'
          AND PARTITION_NAME IS NOT NULL
        LIMIT 1
    `);

    if (partitionCheck[0].length > 0) {
        console.log(`[Migration] ✓ Table already partitioned, skipping`);
        return;
    }

    // Add RANGE partitioning
    await knex.raw(`
        ALTER TABLE \`${TABLE_NAME}\`
        PARTITION BY RANGE (\`created_at\`) (
            -- Historical data (everything before August 1, 2025)
            PARTITION p_historical VALUES LESS THAN (1754092800000),  -- 2025-08-01 00:00:00 UTC

            -- August 2025
            PARTITION p202508 VALUES LESS THAN (1756684800000),  -- 2025-09-01 00:00:00 UTC

            -- September 2025
            PARTITION p202509 VALUES LESS THAN (1759363200000),  -- 2025-10-01 00:00:00 UTC

            -- October 2025
            PARTITION p202510 VALUES LESS THAN (1761955200000),  -- 2025-11-01 00:00:00 UTC

            -- November 2025
            PARTITION p202511 VALUES LESS THAN (1764633600000),  -- 2025-12-01 00:00:00 UTC

            -- December 2025
            PARTITION p202512 VALUES LESS THAN (1767225600000),  -- 2026-01-01 00:00:00 UTC

            -- 2026 - Full year (12 months)
            PARTITION p202601 VALUES LESS THAN (1769904000000),  -- 2026-02-01 00:00:00 UTC
            PARTITION p202602 VALUES LESS THAN (1772323200000),  -- 2026-03-01 00:00:00 UTC
            PARTITION p202603 VALUES LESS THAN (1775001600000),  -- 2026-04-01 00:00:00 UTC
            PARTITION p202604 VALUES LESS THAN (1777593600000),  -- 2026-05-01 00:00:00 UTC
            PARTITION p202605 VALUES LESS THAN (1780272000000),  -- 2026-06-01 00:00:00 UTC
            PARTITION p202606 VALUES LESS THAN (1782864000000),  -- 2026-07-01 00:00:00 UTC
            PARTITION p202607 VALUES LESS THAN (1785542400000),  -- 2026-08-01 00:00:00 UTC
            PARTITION p202608 VALUES LESS THAN (1788220800000),  -- 2026-09-01 00:00:00 UTC
            PARTITION p202609 VALUES LESS THAN (1790812800000),  -- 2026-10-01 00:00:00 UTC
            PARTITION p202610 VALUES LESS THAN (1793491200000),  -- 2026-11-01 00:00:00 UTC
            PARTITION p202611 VALUES LESS THAN (1796083200000),  -- 2026-12-01 00:00:00 UTC
            PARTITION p202612 VALUES LESS THAN (1798761600000),  -- 2027-01-01 00:00:00 UTC

            -- Catch-all for future data beyond 2026
            PARTITION pmax VALUES LESS THAN MAXVALUE
        )
    `);

    console.log(`[Migration] ✓ Added 19 partitions (p_historical + p202508-p202612 + p202601-p202612 + pmax)`);
    console.log(`[Migration] Partitioning completed successfully`);
}

async function down(knex) {
    console.log(`[Migration] Removing partitioning from ${TABLE_NAME} table...`);

    // Remove partitioning (converts back to non-partitioned table)
    await knex.raw(`ALTER TABLE \`${TABLE_NAME}\` REMOVE PARTITIONING`);

    console.log(`[Migration] ✓ Partitioning removed`);
}

module.exports = { up, down };

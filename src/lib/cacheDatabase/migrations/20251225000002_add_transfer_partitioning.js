/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log(`[Migration] Adding RANGE partitioning to ${TABLE_NAME} table...`);

    // Define partition boundaries
    const partitions = [
        // Historical data (everything before August 1, 2025)
        {
            name: 'p_historical',
            boundary: new Date(Date.UTC(2025, 7, 1, 0, 0, 0, 0)).getTime(), // Aug 1, 2025
            description: '< 2025-08-01 (Historical data)',
        },
        // August 2025
        {
            name: 'p202508',
            boundary: new Date(Date.UTC(2025, 8, 1, 0, 0, 0, 0)).getTime(), // Sep 1, 2025
            description: '< 2025-09-01 (August 2025)',
        },
        // September 2025
        {
            name: 'p202509',
            boundary: new Date(Date.UTC(2025, 9, 1, 0, 0, 0, 0)).getTime(), // Oct 1, 2025
            description: '< 2025-10-01 (September 2025)',
        },
        // October 2025
        {
            name: 'p202510',
            boundary: new Date(Date.UTC(2025, 10, 1, 0, 0, 0, 0)).getTime(), // Nov 1, 2025
            description: '< 2025-11-01 (October 2025)',
        },
        // November 2025
        {
            name: 'p202511',
            boundary: new Date(Date.UTC(2025, 11, 1, 0, 0, 0, 0)).getTime(), // Dec 1, 2025
            description: '< 2025-12-01 (November 2025)',
        },
        // December 2025
        {
            name: 'p202512',
            boundary: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0)).getTime(), // Jan 1, 2026
            description: '< 2026-01-01 (December 2025)',
        },
        // 2026 - Full year (12 months)
        {
            name: 'p202601',
            boundary: new Date(Date.UTC(2026, 1, 1, 0, 0, 0, 0)).getTime(), // Feb 1, 2026
            description: '< 2026-02-01 (January 2026)',
        },
        {
            name: 'p202602',
            boundary: new Date(Date.UTC(2026, 2, 1, 0, 0, 0, 0)).getTime(), // Mar 1, 2026
            description: '< 2026-03-01 (February 2026)',
        },
        {
            name: 'p202603',
            boundary: new Date(Date.UTC(2026, 3, 1, 0, 0, 0, 0)).getTime(), // Apr 1, 2026
            description: '< 2026-04-01 (March 2026)',
        },
        {
            name: 'p202604',
            boundary: new Date(Date.UTC(2026, 4, 1, 0, 0, 0, 0)).getTime(), // May 1, 2026
            description: '< 2026-05-01 (April 2026)',
        },
        {
            name: 'p202605',
            boundary: new Date(Date.UTC(2026, 5, 1, 0, 0, 0, 0)).getTime(), // Jun 1, 2026
            description: '< 2026-06-01 (May 2026)',
        },
        {
            name: 'p202606',
            boundary: new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0)).getTime(), // Jul 1, 2026
            description: '< 2026-07-01 (June 2026)',
        },
        {
            name: 'p202607',
            boundary: new Date(Date.UTC(2026, 7, 1, 0, 0, 0, 0)).getTime(), // Aug 1, 2026
            description: '< 2026-08-01 (July 2026)',
        },
        {
            name: 'p202608',
            boundary: new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0)).getTime(), // Sep 1, 2026
            description: '< 2026-09-01 (August 2026)',
        },
        {
            name: 'p202609',
            boundary: new Date(Date.UTC(2026, 9, 1, 0, 0, 0, 0)).getTime(), // Oct 1, 2026
            description: '< 2026-10-01 (September 2026)',
        },
        {
            name: 'p202610',
            boundary: new Date(Date.UTC(2026, 10, 1, 0, 0, 0, 0)).getTime(), // Nov 1, 2026
            description: '< 2026-11-01 (October 2026)',
        },
        {
            name: 'p202611',
            boundary: new Date(Date.UTC(2026, 11, 1, 0, 0, 0, 0)).getTime(), // Dec 1, 2026
            description: '< 2026-12-01 (November 2026)',
        },
        {
            name: 'p202612',
            boundary: new Date(Date.UTC(2027, 0, 1, 0, 0, 0, 0)).getTime(), // Jan 1, 2027
            description: '< 2027-01-01 (December 2026)',
        },
    ];

    // Build partition clauses
    const partitionClauses = partitions
        .map((p) => `PARTITION ${p.name} VALUES LESS THAN (${p.boundary})`)
        .join(',\n            ');

    // Add catch-all partition for any data beyond December 2026
    const fullPartitionDef = `${partitionClauses},
            PARTITION pmax VALUES LESS THAN MAXVALUE`;

    // Apply partitioning
    await knex.raw(`
        ALTER TABLE \`${TABLE_NAME}\`
        PARTITION BY RANGE (\`created_at\`) (
            ${fullPartitionDef}
        )
    `);

    console.log(`[Migration] ✓ Added ${partitions.length} monthly partitions + pmax`);
    console.log(`[Migration] Partitions created:`);
    partitions.forEach((p) => {
        console.log(`[Migration]   - ${p.name}: ${p.description}`);
    });
    console.log(`[Migration]   - pmax: >= 2027-01-01 (Future data beyond 2026)`);
    console.log(`[Migration] Partitioning completed successfully`);
    console.log(`[Migration] `);
    console.log(`[Migration] Note: To add more partitions in the future, run:`);
    console.log(`[Migration]   ALTER TABLE transfer REORGANIZE PARTITION pmax INTO (`);
    console.log(`[Migration]     PARTITION p202701 VALUES LESS THAN (timestamp),`);
    console.log(`[Migration]     PARTITION pmax VALUES LESS THAN MAXVALUE`);
    console.log(`[Migration]   );`);
}

async function down(knex) {
    console.log(`[Migration] Removing partitioning from ${TABLE_NAME} table...`);

    // Remove partitioning (converts back to non-partitioned table)
    await knex.raw(`ALTER TABLE \`${TABLE_NAME}\` REMOVE PARTITIONING`);

    console.log(`[Migration] ✓ Partitioning removed, table is now non-partitioned`);
}

module.exports = { up, down };

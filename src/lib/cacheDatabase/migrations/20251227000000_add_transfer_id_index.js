/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 *                                                                        *
 *  MIGRATION: Add index on transfer.id for fast detail lookups          *
 *                                                                        *
 *  Problem: details(id) query scans all partitions (slow with 300k rows)*
 *  Solution: Add dedicated index on id column for O(log n) lookups      *
 *                                                                        *
 *  IMPORTANT: This index is critical for /transfers/:id endpoint         *
 *             performance with partitioned tables                        *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log(`[Migration] Adding index on ${TABLE_NAME}.id for fast detail lookups...`);

    // Check if index already exists
    const indexCheck = await knex.raw(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = '${TABLE_NAME}'
          AND INDEX_NAME = 'idx_transfer_id_detail'
        LIMIT 1
    `);

    if (indexCheck[0].length > 0) {
        console.log(`[Migration] ✓ Index idx_transfer_id_detail already exists, skipping`);
        return;
    }

    // Add index on id column for fast lookups by transfer ID
    // This allows details(id) query to avoid full partition scan
    await knex.schema.table(TABLE_NAME, (table) => {
        table.index('id', 'idx_transfer_id_detail');
    });

    console.log(`[Migration] ✓ Index created: idx_transfer_id_detail`);
    console.log(`[Migration] Expected improvement: O(n) → O(log n) for details(id) queries`);
}

async function down(knex) {
    console.log(`[Migration] Removing idx_transfer_id_detail from ${TABLE_NAME}...`);

    await knex.schema.table(TABLE_NAME, (table) => {
        table.dropIndex('id', 'idx_transfer_id_detail');
    });

    console.log(`[Migration] ✓ Index removed`);
}

module.exports = { up, down };

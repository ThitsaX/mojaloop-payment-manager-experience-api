/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 *                                                                        *
 *  Cleanup duplicate transfer records before fixing schema               *
 *  Run this BEFORE the fix_duplicate_transfers migration                 *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log('Starting duplicate transfer cleanup...');

    // Find all transfer IDs that have duplicates
    const duplicates = await knex(TABLE_NAME)
        .select('id')
        .count('* as count')
        .groupBy('id')
        .having('count', '>', 1);

    console.log(`Found ${duplicates.length} transfer IDs with duplicates`);

    for (const dup of duplicates) {
        const transferId = dup.id;

        // Get all records for this transfer ID, ordered by auto_id/creation
        const records = await knex(TABLE_NAME)
            .where('id', transferId)
            .orderBy('created_at', 'asc')
            .orderBy('redis_key', 'asc');

        if (records.length > 1) {
            console.log(`Transfer ${transferId} has ${records.length} records`);

            // Strategy: Keep the FIRST record (oldest), delete others
            const toKeep = records[0];
            const toDelete = records.slice(1);

            console.log(`  Keeping: redis_key=${toKeep.redis_key}, direction=${toKeep.direction}`);

            for (const record of toDelete) {
                console.log(`  Deleting: redis_key=${record.redis_key}, direction=${record.direction}`);

                await knex(TABLE_NAME)
                    .where({
                        id: record.id,
                        redis_key: record.redis_key
                    })
                    .delete();
            }
        }
    }

    console.log('Duplicate cleanup complete');
}

async function down(knex) {
    // Cannot restore deleted duplicates - this is a one-way cleanup
    console.log('WARNING: Cannot restore deleted duplicate records');
    console.log('This migration is not reversible');
}

module.exports = { up, down };

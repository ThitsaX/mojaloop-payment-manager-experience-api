/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 *                                                                        *
 *  Fix duplicate transfer records caused by composite primary key        *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    // Step 1: Drop the composite primary key
    await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.dropPrimary();
    });

    // Step 2: Add auto-increment primary key
    await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.increments('auto_id').primary().first();
    });

    // Step 3: Add UNIQUE constraint on redis_key to prevent duplicates
    await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.unique('redis_key');
    });

    // Step 4: Add index on 'id' for fast lookups
    await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.index('id', 'idx_transfer_id');
    });

    console.log('Migration complete: Added auto_id primary key and unique constraint on redis_key');
}

async function down(knex) {
    // Reverse the changes
    await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.dropIndex('id', 'idx_transfer_id');
        table.dropUnique('redis_key');
        table.dropColumn('auto_id');
    });

    // Restore composite primary key
    await knex.schema.alterTable(TABLE_NAME, (table) => {
        table.primary(['id', 'redis_key']);
    });

    console.log('Migration rolled back: Restored composite primary key');
}

module.exports = { up, down };

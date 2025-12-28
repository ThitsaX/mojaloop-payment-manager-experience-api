/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 *                                                                        *
 *  MIGRATION: Create sync_state table for cursor-based sync checkpoint  *
 *                                                                        *
 *  Purpose: Store Redis SCAN cursor position to enable resumable sync   *
 *           after pod restarts, eliminating in-memory tracking arrays   *
 *                                                                        *
 *  Benefits:                                                             *
 *  - Eliminates 115+ MB of permanent memory usage (tracking arrays)     *
 *  - Survives pod restarts (cursor persisted in database)               *
 *  - Prevents duplicate processing after restarts                        *
 *  - Allows manual reset for fresh sync to new database                 *
 *                                                                        *
 *  Manual Reset (when migrating to new MySQL database):                 *
 *    DELETE FROM sync_state;                                             *
 *    -- OR --                                                            *
 *    UPDATE sync_state SET last_cursor = '0', total_processed = 0;      *
 **************************************************************************/

const TABLE_NAME = 'sync_state';

async function up(knex) {
    console.log(`[Migration] Creating ${TABLE_NAME} table for cursor-based sync...`);

    // Check if table already exists
    const exists = await knex.schema.hasTable(TABLE_NAME);
    if (exists) {
        console.log(`[Migration] ✓ Table ${TABLE_NAME} already exists, skipping`);
        return;
    }

    await knex.schema.createTable(TABLE_NAME, (table) => {
        table.increments('id').primary();

        // Key pattern being synced (e.g., 'transferModel_*', 'fxQuote_in_*')
        table.string('key_pattern', 255).notNullable().unique();

        // Redis SCAN cursor position (e.g., '0', '1234', '5678')
        // '0' means start/complete, other values are internal Redis positions
        table.string('last_cursor', 255).notNullable().defaultTo('0');

        // Timestamp of last sync for this pattern
        table.timestamp('last_synced_at').defaultTo(knex.fn.now());

        // Total keys processed in current cycle (resets when cursor returns to '0')
        table.integer('total_processed').unsigned().notNullable().defaultTo(0);

        // Metadata: when this record was created
        table.timestamp('created_at').defaultTo(knex.fn.now());

        // Metadata: when this record was last updated
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    console.log(`[Migration] ✓ Table ${TABLE_NAME} created successfully`);
    console.log(`[Migration] Expected memory savings: ~115 MB (eliminates in-memory tracking arrays)`);
}

async function down(knex) {
    console.log(`[Migration] Dropping ${TABLE_NAME} table...`);

    await knex.schema.dropTableIfExists(TABLE_NAME);

    console.log(`[Migration] ✓ Table ${TABLE_NAME} dropped`);
}

module.exports = { up, down };

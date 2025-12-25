/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    await knex.schema.table(TABLE_NAME, (table) => {
        // UNIQUE constraint on redis_key with created_at (required for partitioning)
        // Note: All UNIQUE keys must include the partition key (created_at)
        table.unique(['redis_key', 'created_at'], 'redis_key_UNIQUE');

        // Regular index on redis_key for JOINs with fx_quote/fx_transfer
        table.index('redis_key', 'idx_transfer_redis_key');

        // Indexes for common filters
        table.index('dfsp', 'idx_transfer_dfsp');
        table.index('batch_id', 'idx_transfer_batch_id');

        // Composite indexes for common query patterns
        table.index(['created_at', 'success'], 'idx_transfer_created_success');
        table.index(['created_at', 'direction'], 'idx_transfer_created_direction');
        table.index(['direction', 'success'], 'idx_transfer_direction_success');
    });
}

async function down(knex) {
    await knex.schema.table(TABLE_NAME, (table) => {
        table.dropIndex('direction, success', 'idx_transfer_direction_success');
        table.dropIndex('created_at, direction', 'idx_transfer_created_direction');
        table.dropIndex('created_at, success', 'idx_transfer_created_success');
        table.dropIndex('batch_id', 'idx_transfer_batch_id');
        table.dropIndex('dfsp', 'idx_transfer_dfsp');
        table.dropIndex('redis_key', 'idx_transfer_redis_key');
        table.dropUnique(['redis_key', 'created_at'], 'redis_key_UNIQUE');
    });
}

module.exports = { up, down };

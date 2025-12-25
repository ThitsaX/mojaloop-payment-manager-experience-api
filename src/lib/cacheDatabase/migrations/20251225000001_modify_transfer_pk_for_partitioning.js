/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log(`[Migration] Modifying ${TABLE_NAME} primary key to support partitioning...`);

    // Step 1: Drop existing primary key (id, redis_key)
    await knex.raw(`ALTER TABLE \`${TABLE_NAME}\` DROP PRIMARY KEY`);
    console.log(`[Migration] ✓ Dropped old primary key (id, redis_key)`);

    // Step 2: Add new composite primary key with created_at first
    // Order: (created_at, id, redis_key) - created_at first for partition pruning
    await knex.raw(`
        ALTER TABLE \`${TABLE_NAME}\`
        ADD PRIMARY KEY (\`created_at\`, \`id\`, \`redis_key\`)
    `);
    console.log(`[Migration] ✓ Added new primary key (created_at, id, redis_key)`);
    console.log(`[Migration] Primary key modification completed successfully`);
}

async function down(knex) {
    console.log(`[Migration] Rolling back ${TABLE_NAME} primary key modification...`);

    // Rollback: Restore original primary key
    await knex.raw(`ALTER TABLE \`${TABLE_NAME}\` DROP PRIMARY KEY`);
    await knex.raw(`
        ALTER TABLE \`${TABLE_NAME}\`
        ADD PRIMARY KEY (\`id\`, \`redis_key\`)
    `);
    console.log(`[Migration] ✓ Restored original primary key (id, redis_key)`);
}

module.exports = { up, down };

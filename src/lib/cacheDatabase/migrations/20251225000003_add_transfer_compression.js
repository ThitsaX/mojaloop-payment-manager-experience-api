/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log(`[Migration] Adding compression to ${TABLE_NAME} table...`);

    // Check MySQL version to determine compression syntax
    const versionResult = await knex.raw('SELECT VERSION() as version');
    const version = versionResult[0][0].version;
    const majorVersion = parseInt(version.split('.')[0]);

    console.log(`[Migration] Detected MySQL version: ${version}`);

    if (majorVersion >= 8) {
        // MySQL 8.0+ uses COMPRESSION attribute
        console.log(`[Migration] Using MySQL 8.0+ compression syntax`);
        await knex.raw(`
            ALTER TABLE \`${TABLE_NAME}\`
            COMPRESSION='zlib'
        `);
    } else {
        // MySQL 5.7 uses ROW_FORMAT=COMPRESSED with KEY_BLOCK_SIZE
        console.log(`[Migration] Using MySQL 5.7 compression syntax`);
        await knex.raw(`
            ALTER TABLE \`${TABLE_NAME}\`
            ROW_FORMAT=COMPRESSED,
            KEY_BLOCK_SIZE=8
        `);
    }

    console.log(`[Migration] ✓ Table compression enabled`);
    console.log(`[Migration] Expected storage reduction: 60-80%`);
    console.log(`[Migration] Note: Existing data will be compressed gradually during normal operations`);
    console.log(`[Migration] To force immediate compression, run: OPTIMIZE TABLE ${TABLE_NAME};`);
}

async function down(knex) {
    console.log(`[Migration] Removing compression from ${TABLE_NAME} table...`);

    // Revert to default (uncompressed) format
    await knex.raw(`
        ALTER TABLE \`${TABLE_NAME}\`
        ROW_FORMAT=DYNAMIC
    `);

    console.log(`[Migration] ✓ Table compression removed, using default ROW_FORMAT=DYNAMIC`);
}

module.exports = { up, down };

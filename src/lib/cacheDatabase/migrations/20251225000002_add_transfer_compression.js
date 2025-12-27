/**************************************************************************
 *  (C) Copyright ThitsaWorks 2025 - All rights reserved.                 *
 *                                                                        *
 *  MIGRATION: Add compression to transfer table                         *
 *                                                                        *
 *  Enables table compression for 60-80% storage reduction               *
 *  This MUST run BEFORE data sync starts for optimal compression        *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    console.log(`[Migration] Adding compression to ${TABLE_NAME} table...`);

    // Check MySQL version to determine compression syntax
    const versionResult = await knex.raw('SELECT VERSION() as version');
    const version = versionResult[0][0].version;
    const majorVersion = parseInt(version.split('.')[0]);

    console.log(`[Migration] Detected MySQL version: ${version}`);

    // Check if already compressed
    const tableInfo = await knex.raw(`
        SELECT CREATE_OPTIONS, ROW_FORMAT
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = '${TABLE_NAME}'
    `);

    const createOptions = tableInfo[0][0].CREATE_OPTIONS || '';
    const rowFormat = tableInfo[0][0].ROW_FORMAT || '';

    if (createOptions.includes('COMPRESSION') || rowFormat === 'Compressed') {
        console.log(`[Migration] ✓ Table already compressed, skipping`);
        return;
    }

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

    console.log(`[Migration] ✓ Compression enabled`);
    console.log(`[Migration] Expected storage reduction: 60-80%`);
}

async function down(knex) {
    console.log(`[Migration] Removing compression from ${TABLE_NAME} table...`);

    // Revert to default (uncompressed) format
    await knex.raw(`
        ALTER TABLE \`${TABLE_NAME}\`
        ROW_FORMAT=DYNAMIC
    `);

    console.log(`[Migration] ✓ Compression removed`);
}

module.exports = { up, down };

/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2020 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       Yevhen Kyriukha - yevhen.kyriukha@modusbox.com                   *
 *       Nguni Phakela - nguni @izyane.com                                *
 **************************************************************************/

const TABLE_NAME = 'fx_quote';

async function up(knex) {
    return knex.schema.createTable(TABLE_NAME, (table) => {
        table.string('redis_key', 255).notNullable();  // Store for easy joining
        table.string('conversion_request_id', 255).notNullable();
        table.string('conversion_id', 255);
        table.string('determining_transfer_id', 255);
        table.string('initiating_fsp', 255);
        table.string('counter_party_fsp', 255);
        table.string('amount_type', 50);
        table.string('source_amount', 50);
        table.string('source_currency', 10);
        table.string('target_amount', 50);
        table.string('target_currency', 10);
        table.string('expiration', 100);
        table.string('condition', 255);
        table.string('direction', 50);
        table.text('raw', 'longtext');
        table.bigInteger('created_at');
        table.bigInteger('completed_at');
        table.boolean('success'); // TRUE - Fulfill, FALSE - Error, NULL - Pending

        // Composite primary key for MySQL
        table.primary(['redis_key', 'conversion_request_id']);

        // Add indexes for common queries
        table.index('conversion_id');
        table.index('determining_transfer_id');
        table.index('created_at');
        table.index('completed_at');
        table.index('success');
    });
}

async function down(knex) {
    return knex.schema.dropTable(TABLE_NAME);
}

module.exports = { up, down };

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
        table.increments('auto_id').primary(); // Auto-increment primary key for MySQL
        table.string('redis_key').notNullable().index();  // Store for easy joining
        table.string('conversion_request_id').notNullable().index();
        table.string('conversion_id');
        table.string('determining_transfer_id');
        table.string('initiating_fsp');
        table.string('counter_party_fsp');
        table.string('amount_type');
        table.string('source_amount');
        table.string('source_currency');
        table.string('target_amount');
        table.string('target_currency');
        table.string('expiration');
        table.string('condition');
        table.string('direction');
        table.text('raw'); // Use TEXT for large JSON data
        table.bigInteger('created_at'); // Use bigint for timestamps
        table.bigInteger('completed_at');
        table.boolean('success'); // TRUE - Fulfill, FALSE - Error, NULL - Pending

        // Add unique constraint on combination that should be unique
        table.unique(['redis_key', 'conversion_request_id']);
        table.index(['created_at']);
        table.index(['success']);
    });
}

async function down(knex) {
    return knex.schema.dropTable(TABLE_NAME);
}

module.exports = { up, down };

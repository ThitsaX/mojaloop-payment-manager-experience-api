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
const TABLE_NAME = 'fx_transfer';

async function up(knex) {
    return knex.schema.createTable(TABLE_NAME, (table) => {
        table.increments('auto_id').primary(); // Auto-increment primary key for MySQL
        table.string('redis_key').notNullable().index();  // For easy join
        table.string('commit_request_id').notNullable().index();
        table.string('determining_transfer_id');
        table.string('initiating_fsp');
        table.string('counter_party_fsp');
        table.string('amount_type');
        table.string('source_amount');
        table.string('source_currency');
        table.string('target_amount');
        table.string('target_currency');
        table.text('condition'); // Could be long, use TEXT
        table.bigInteger('expiration'); // Use bigint for timestamps
        table.string('conversion_state');
        table.text('fulfilment'); // Could be long, use TEXT
        table.integer('direction');
        table.bigInteger('created_at'); // Use bigint for timestamps
        table.bigInteger('completed_timestamp'); // Use bigint for timestamps

        // Add unique constraint on combination that should be unique
        table.unique(['redis_key', 'commit_request_id']);
        table.index(['created_at']);
        table.index(['determining_transfer_id']);
    });
}

async function down(knex) {
    return knex.schema.dropTable(TABLE_NAME);
}

module.exports = { down, up };

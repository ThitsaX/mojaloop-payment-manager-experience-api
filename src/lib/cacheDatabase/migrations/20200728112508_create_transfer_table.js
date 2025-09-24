/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2020 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       Yevhen Kyriukha - yevhen.kyriukha@modusbox.com                   *
 **************************************************************************/

const TABLE_NAME = 'transfer';

async function up(knex) {
    return knex.schema.createTable(TABLE_NAME, (table) => {
        table.increments('auto_id').primary(); // Auto-increment primary key for MySQL
        table.string('id').notNullable().index();
        table.string('redis_key').notNullable().unique().index();
        table.boolean('success'); // TRUE - Fulfill, FALSE - Error, NULL - Pending
        table.string('sender');
        table.string('sender_id_type');
        table.string('sender_id_sub_value');
        table.string('sender_id_value');
        table.string('recipient');
        table.string('recipient_id_type');
        table.string('recipient_id_sub_value');
        table.string('recipient_id_value');
        table.string('amount');
        table.string('currency');
        table.integer('direction');
        table.string('batch_id');
        table.string('details');
        table.string('dfsp');
        table.bigInteger('created_at'); // Use bigint for timestamps
        table.bigInteger('completed_at');
        table.text('raw'); // Use TEXT for large JSON data
        table.text('supported_currencies');

        // Add composite index for common queries
        table.index(['id', 'redis_key']);
        table.index(['created_at']);
        table.index(['success']);
    });
}

async function down(knex) {
    return knex.schema.dropTable(TABLE_NAME);
}

module.exports = { down, up };

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
        table.string('id', 255).notNullable();
        table.string('redis_key', 255).notNullable();
        table.boolean('success'); // TRUE - Fulfill, FALSE - Error, NULL - Pending
        table.string('sender', 255);
        table.string('sender_id_type', 100);
        table.string('sender_id_sub_value', 100);
        table.string('sender_id_value', 255);
        table.string('recipient', 255);
        table.string('recipient_id_type', 100);
        table.string('recipient_id_sub_value', 100);
        table.string('recipient_id_value', 255);
        table.string('amount', 50);
        table.string('currency', 10);
        table.integer('direction');
        table.string('batch_id', 255);
        table.text('details');
        table.string('dfsp', 255);
        table.bigInteger('created_at').notNullable(); // Required for partitioning
        table.bigInteger('completed_at');
        table.text('raw', 'longtext');
        table.text('supported_currencies');

        // Composite primary key optimized for RANGE partitioning
        // created_at must be first to enable partition pruning
        table.primary(['created_at', 'id', 'redis_key']);

        // Add indexes for common queries
        table.index('created_at');
        table.index('completed_at');
        table.index('direction');
        table.index('success');
    });
}

async function down(knex) {
    return knex.schema.dropTable(TABLE_NAME);
}

module.exports = { down, up };

const TABLE_NAME = 'transfer';

async function up(knex) {
    return knex.schema.alterTable(TABLE_NAME, (table) => {
        table.string('home_transfer_id', 255).nullable();
    });
}

async function down(knex) {
    return knex.schema.alterTable(TABLE_NAME, (table) => {
        table.dropColumn('home_transfer_id');
    });
}

module.exports = { down, up };

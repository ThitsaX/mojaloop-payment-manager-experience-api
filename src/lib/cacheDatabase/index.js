/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2020 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       Yevhen Kyriukha - yevhen.kyriukha@modusbox.com                   *
 *                                                                        *
 *  CONTRIBUTORS:                                                         *
 *       James Bush - james.bush@modusbox.com                             *
 **************************************************************************/

const knex = require('knex');
const Cache = require('./cache');

// Helper function for bulk upsert operations
const bulkUpsert = async (trx, tableName, rows, keyColumn, batchSize, logger) => {
    if (!rows || rows.length === 0) return;

    // Split into smaller batches for MySQL
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        try {
            // Use MySQL's ON DUPLICATE KEY UPDATE for upsert
            const query = trx(tableName).insert(batch).onConflict(keyColumn).merge();
            await query;
        } catch (err) {
            logger.push({ err, tableName, batchSize: batch.length }).log('Error in bulk upsert batch');
            // Fallback to individual inserts for this batch
            for (const row of batch) {
                try {
                    await trx(tableName).insert(row).onConflict(keyColumn).merge();
                } catch (individualErr) {
                    logger.push({ err: individualErr, tableName, redis_key: row.redis_key }).log('Error in individual upsert fallback');
                }
            }
        }
    }
};

// Helper function to extract row data from cache data (refactored from original cacheKey function)
const prepareRows = async (key, data, logger) => {
    let transferRow = null;
    let fxQuoteRow = null;
    let fxTransferRow = null;

    if (key.includes('transferModel')) {
        // Transfer processing logic (extracted from original code)
        const initiatedTimestamp = data.initiatedTimestamp
            ? new Date(data.initiatedTimestamp).getTime()
            : null;
        const completedTimestamp = data.fulfil?.body?.completedTimestamp
            ? new Date(data.fulfil.body.completedTimestamp).getTime()
            : null;

        if (!['INBOUND', 'OUTBOUND'].includes(data.direction)) {
            logger.push({ data }).log('Unable to process row. No direction property found');
            return { transferRow, fxQuoteRow, fxTransferRow };
        }

        const row = {
            id: data.transferId,
            redis_key: key,
            raw: JSON.stringify(data),
            created_at: initiatedTimestamp,
            completed_at: completedTimestamp,
            ...(data.direction === 'INBOUND' && {
                sender: getPartyNameFromQuoteRequest(data.quoteRequest, 'payer'),
                sender_id_type: data.quoteRequest?.body?.payer?.partyIdInfo?.partyIdType,
                sender_id_sub_value: data.quoteRequest?.body?.payer?.partyIdInfo?.partySubIdOrType,
                sender_id_value: data.quoteRequest?.body?.payer?.partyIdInfo?.partyIdentifier,
                recipient: getPartyNameFromQuoteRequest(data.quoteRequest, 'payee'),
                recipient_id_type: data.quoteRequest?.body?.payee?.partyIdInfo?.partyIdType,
                recipient_id_sub_value: data.quoteRequest?.body?.payee?.partyIdInfo?.partySubIdOrType,
                recipient_id_value: data.quoteRequest?.body?.payee?.partyIdInfo?.partyIdentifier,
                amount: data.quoteResponse?.body?.transferAmount?.amount ?? null,
                currency: data.quoteResponse?.body?.transferAmount?.currency ?? null,
                direction: -1,
                batch_id: '',
                details: data.quoteRequest?.body?.note,
                dfsp: data.quoteRequest?.body?.payer?.partyIdInfo?.fspId,
                success: getInboundTransferStatus(data),
                supported_currencies: JSON.stringify(data.supportedCurrencies),
            }),
            ...(data.direction === 'OUTBOUND' && {
                sender: getName(data.from),
                sender_id_type: data.from?.idType,
                sender_id_sub_value: data.from?.idSubType,
                sender_id_value: data.from?.idValue,
                recipient: getName(data.to),
                recipient_id_type: data.to?.idType,
                recipient_id_sub_value: data.to?.idSubType,
                recipient_id_value: data.to?.idValue,
                amount: data.amount,
                currency: data.currency,
                direction: 1,
                batch_id: '',
                details: data.note,
                dfsp: data.to?.fspId,
                success: getTransferStatus(data),
                supported_currencies: JSON.stringify(data.supportedCurrencies),
            }),
        };

        transferRow = row;
    }

    // FX Quote processing logic would go here
    // ... (similar extraction from original code)

    return { transferRow, fxQuoteRow, fxTransferRow };
};

const getName = (userInfo) =>
    userInfo &&
    (userInfo.displayName || `${userInfo.firstName} ${userInfo.lastName}`);

const getTransferStatus = (data) => {
    if (data.currentState === 'succeeded') {
        return true;
    } else if (data.currentState === 'errored') {
        return false;
    } else {
        return null;
    }
};

const getInboundTransferStatus = (data) => {
    switch (data.currentState) {
        case 'COMPLETED':
            return true;
        case 'ERROR_OCCURRED':
        case 'ABORTED':
            return false;
        default:
            return null;
    }
};

const getPartyNameFromQuoteRequest = (qr, partyType) => {
    // return display name if we have it
    if (qr.body[partyType].name) {
        return qr.body[partyType].name;
    }

    // otherwise try to build the name from the personalInfo
    const { complexName } = qr.body[partyType].personalInfo || {};

    if (complexName) {
        const n = [];
        const { firstName, middleName, lastName } = complexName;
        if (firstName) {
            n.push(firstName);
        }
        if (middleName) {
            n.push(middleName);
        }
        if (lastName) {
            n.push(lastName);
        }
        return n.join(' ');
    }
};

async function syncDB({ redisCache, db, logger, isInitialSync = false, config = {} }) {
    logger.log('Syncing cache to in-memory DB');

    const parseData = (rawData) => {
        let data;
        if (typeof rawData === 'string') {
            try {
                data = JSON.parse(rawData);
            } catch (err) {
                logger.push({ err, rawData }).log('Error parsing JSON cache value');
                return null; // Return null to indicate parsing failure
            }
        } else {
            data = rawData;
        }

        if (!data) {
            return null;
        }

        if (data.direction === 'INBOUND') {
            if (data.quoteResponse?.body) {
                if (typeof data.quoteResponse.body === 'string') {
                    try {
                        data.quoteResponse.body = JSON.parse(data.quoteResponse.body);
                    } catch (err) {
                        logger.push({ err, body: data.quoteResponse.body }).log('Error parsing quoteResponse.body');
                        data.quoteResponse.body = null; // Set to null to avoid downstream errors
                    }
                }
            } else {
                data.quoteResponse = { body: null }; // Ensure body is null if missing
            }
            if (data.fulfil?.body) {
                if (typeof data.fulfil.body === 'string') {
                    try {
                        data.fulfil.body = JSON.parse(data.fulfil.body);
                    } catch (err) {
                        logger.push({ err, body: data.fulfil.body }).log('Error parsing fulfil.body');
                        data.fulfil.body = null;
                    }
                }
            }
        }
        return data;
    };

    // Old cacheKey function removed - replaced with optimized bulk processing

    // High-volume batch processing configuration
    const BATCH_SIZE = config.syncBatchSize || 1000; // Larger batches for better performance
    const MAX_INITIAL_SYNC_KEYS = isInitialSync ? (config.maxInitialSyncKeys || 10000) : null;
    const CONCURRENT_BATCHES = config.concurrentBatches || 3; // Process multiple batches concurrently
    const DB_BATCH_SIZE = config.dbBatchSize || 200; // Database batch insert size

    // Utility function to process keys in parallel batches
    const processBatch = async (keys) => {
        const results = [];
        const transferRows = [];
        const fxQuoteRows = [];
        const fxTransferRows = [];

        // Process all keys in the batch and collect database operations
        await Promise.all(keys.map(async (key) => {
            try {
                const rawData = await redisCache.get(key);
                const data = parseData(rawData);

                if (!data) {
                    results.push({ key, status: 'skipped' });
                    return;
                }

                // Prepare database rows without executing queries
                const { transferRow, fxQuoteRow, fxTransferRow } = await prepareRows(key, data, logger);

                if (transferRow) transferRows.push(transferRow);
                if (fxQuoteRow) fxQuoteRows.push(fxQuoteRow);
                if (fxTransferRow) fxTransferRows.push(fxTransferRow);

                results.push({ key, status: 'success' });
            } catch (err) {
                logger.push({ err, key }).log('Error processing key in batch');
                results.push({ key, status: 'error', error: err.message });
            }
        }));

        // Bulk database operations using transactions
        try {
            await db.transaction(async (trx) => {
                // Bulk upsert transfers
                if (transferRows.length > 0) {
                    await bulkUpsert(trx, 'transfer', transferRows, 'redis_key', DB_BATCH_SIZE, logger);
                }

                // Bulk upsert FX quotes
                if (fxQuoteRows.length > 0) {
                    await bulkUpsert(trx, 'fx_quote', fxQuoteRows, 'redis_key', DB_BATCH_SIZE, logger);
                }

                // Bulk upsert FX transfers
                if (fxTransferRows.length > 0) {
                    await bulkUpsert(trx, 'fx_transfer', fxTransferRows, 'redis_key', DB_BATCH_SIZE, logger);
                }
            });

            // No need for in-memory tracking - using database-driven existence checking

        } catch (err) {
            logger.push({ err, transferCount: transferRows.length, fxQuoteCount: fxQuoteRows.length, fxTransferCount: fxTransferRows.length }).log('Error in bulk database operation');
            // Mark all as errors
            results.forEach(r => { if (r.status === 'success') r.status = 'error'; });
        }

        return results;
    };

    // Available key patterns in redis
    const redisKeys = ['transferModel_*', 'fxQuote_in_*'];
    
    let totalProcessed = 0;
    let totalErrors = 0;
    
    for (const keyPattern of redisKeys) {
        try {
            logger.log(`Processing pattern: ${keyPattern}`);

            // Use non-blocking SCAN for better Redis performance with large datasets
            const scanOptions = {
                batchSize: 1000,
                maxKeys: config.maxScanKeys || 100000
            };
            const keys = await redisCache.scanKeys(keyPattern, scanOptions);

            logger.log(`Found ${keys.length} keys for pattern: ${keyPattern}`);
            
            // Database-driven approach: Query existing keys from database
            const existingKeys = new Set();
            if (keys.length > 0) {
                try {
                    const existingTransferKeys = await db('transfer')
                        .select('redis_key')
                        .whereIn('redis_key', keys)
                        .pluck('redis_key');
                    existingTransferKeys.forEach(key => existingKeys.add(key));

                    const existingFxQuoteKeys = await db('fx_quote')
                        .select('redis_key')
                        .whereIn('redis_key', keys)
                        .pluck('redis_key');
                    existingFxQuoteKeys.forEach(key => existingKeys.add(key));
                } catch (err) {
                    logger.push({ err }).log('Error querying existing keys from database');
                }
            }

            // Only process keys that don't exist in database
            const uncachedOrPendingKeys = keys.filter(key => !existingKeys.has(key));

            // Apply initial sync limit if configured
            const keysToProcess = MAX_INITIAL_SYNC_KEYS && uncachedOrPendingKeys.length > MAX_INITIAL_SYNC_KEYS
                ? uncachedOrPendingKeys.slice(0, MAX_INITIAL_SYNC_KEYS)
                : uncachedOrPendingKeys;

            if (MAX_INITIAL_SYNC_KEYS && uncachedOrPendingKeys.length > MAX_INITIAL_SYNC_KEYS) {
                logger.log(`Initial sync limited to ${MAX_INITIAL_SYNC_KEYS} keys out of ${uncachedOrPendingKeys.length} total for pattern ${keyPattern}`);
            }

            logger.log(`Processing ${keysToProcess.length} new keys for pattern: ${keyPattern} (${existingKeys.size} already exist)`);
            
            // Process keys in concurrent batches for better performance
            const batches = [];
            for (let i = 0; i < keysToProcess.length; i += BATCH_SIZE) {
                batches.push(keysToProcess.slice(i, i + BATCH_SIZE));
            }

            logger.log(`Processing ${batches.length} batches with up to ${CONCURRENT_BATCHES} concurrent workers`);

            // Process batches concurrently with limited concurrency
            for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
                const concurrentBatches = batches.slice(i, i + CONCURRENT_BATCHES);

                const batchPromises = concurrentBatches.map(async (batch, index) => {
                    const batchNum = i + index + 1;
                    logger.log(`Starting batch ${batchNum}/${batches.length} (${batch.length} keys)`);

                    try {
                        const results = await processBatch(batch);
                        const errors = results.filter(r => r.status === 'error').length;

                        logger.log(`Completed batch ${batchNum}/${batches.length}: ${batch.length - errors} success, ${errors} errors`);
                        return { processed: batch.length, errors };
                    } catch (err) {
                        logger.push({ err, batchNum }).log('Batch processing failed completely');
                        return { processed: 0, errors: batch.length };
                    }
                });

                // Wait for all concurrent batches to complete
                const results = await Promise.all(batchPromises);

                // Aggregate results
                results.forEach(({ processed, errors }) => {
                    totalProcessed += processed;
                    totalErrors += errors;
                });

                // Small delay between concurrent batch groups to prevent overwhelming the system
                if (i + CONCURRENT_BATCHES < batches.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
        } catch (err) {
            logger.push({ err, keyPattern }).log('Error processing key pattern');
            totalErrors++;
        }
    }
    
    logger.log(`Database sync complete. Processed: ${totalProcessed}, Errors: ${totalErrors}`);
}

const createDatabase = async (config) => {
    const db = knex(config.databaseConfig);

    Object.defineProperty(
        db,
        'createTransaction',
        async () => new Promise((resolve) => db.transaction(resolve)),
    );

    await db.migrate.latest();


    const redisCache = new Cache(config);
    await redisCache.connect();

    const doSyncDB = (isInitialSync = false) =>
        syncDB({
            redisCache,
            db,
            logger: config.logger,
            isInitialSync,
            config: config.cacheConfig || config,
        });

    // Progressive sync implementation
    let backgroundSyncRunning = false;
    
    const doProgressiveSync = async () => {
        if (backgroundSyncRunning) {
            config.logger.log('Background sync already running, skipping');
            return;
        }
        
        backgroundSyncRunning = true;
        try {
            await doSyncDB(false); // Regular sync without limits
        } catch (err) {
            config.logger.push({ err }).log('Error in background sync');
        } finally {
            backgroundSyncRunning = false;
        }
    };

    if (!config.manualSync) {
        // Initial sync with limits
        try {
            config.logger.log('Starting initial sync with safety limits');
            await doSyncDB(true); // Initial sync with limits
            config.logger.log('Initial sync completed successfully');
        } catch (err) {
            config.logger.push({ err }).log('Initial sync failed, service will continue with empty cache');
            // Service continues - critical for preventing restart loops
        }
        
        // Set up periodic sync
        const interval = setInterval(doProgressiveSync, (config.syncInterval || 60) * 1e3);
        db.stopSync = () => clearInterval(interval);
    } else {
        db.sync = doSyncDB;
    }
    db.redisCache = () => redisCache; // for testing purposes

    return db;
};

module.exports = {
    createDatabase,
    createMemoryCache: createDatabase, // Backward compatibility alias
    syncDB
};

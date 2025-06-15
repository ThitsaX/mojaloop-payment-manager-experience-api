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

const cachedFulfilledKeys = [];
const cachedPendingKeys = [];

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

async function syncDB({ redisCache, db, logger }) {
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

    const cacheKey = async (key) => {
        const rawData = await redisCache.get(key);
        const data = parseData(rawData);

        if (!data) {
            logger.push({ key }).log('Skipping cache key due to invalid data');
            return;
        }

        // If the key is for a transfer
        if (key.includes('transferModel')) {
            // this is all a hack right now as we will eventually NOT use the cache as a source
            // of truth for transfers but rather some sort of dedicated persistence service instead.
            // Therefore we can afford to do some nasty things in order to get working features...
            // for now...
            const initiatedTimestamp = data.initiatedTimestamp
                ? new Date(data.initiatedTimestamp).getTime()
                : null;
            const completedTimestamp = data.fulfil?.body?.completedTimestamp
                ? new Date(data.fulfil.body.completedTimestamp).getTime()
                : null;
            // the cache data model for inbound transfers is lacking some properties that make it easy to extract
            // certain information...therefore we have to find it elsewhere...

            if (!['INBOUND', 'OUTBOUND'].includes(data.direction)) {
                logger.push({ data }).log('Unable to process row. No direction property found');
                return;
            }

            const row = {
                id: data.transferId,
                redis_key: key, // To be used instead of Transfer.cachedKeys
                raw: JSON.stringify(data),
                created_at: initiatedTimestamp,
                completed_at: completedTimestamp,
                ...(data.direction === 'INBOUND' && {
                    sender: getPartyNameFromQuoteRequest(data.quoteRequest, 'payer'),
                    sender_id_type:
                        data.quoteRequest?.body?.payer?.partyIdInfo?.partyIdType,
                    sender_id_sub_value:
                        data.quoteRequest?.body?.payer?.partyIdInfo?.partySubIdOrType,
                    sender_id_value:
                        data.quoteRequest?.body?.payer?.partyIdInfo?.partyIdentifier,
                    recipient: getPartyNameFromQuoteRequest(data.quoteRequest, 'payee'),
                    recipient_id_type:
                        data.quoteRequest?.body?.payee?.partyIdInfo?.partyIdType,
                    recipient_id_sub_value:
                        data.quoteRequest?.body?.payee?.partyIdInfo?.partySubIdOrType,
                    recipient_id_value:
                        data.quoteRequest?.body?.payee?.partyIdInfo?.partyIdentifier,
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
                    batch_id: '', // TODO: Implement
                    details: data.note,
                    dfsp: data.to?.fspId,
                    success: getTransferStatus(data),
                    supported_currencies: JSON.stringify(data.supportedCurrencies),
                }),
            };

            // check if there is a key in the data object named fxQuoteResponse
            // The empty object is initialised for the case in which fxQuoteResponse is empty so we don't have to deal with null errors
            let fx_quote_row = null;
            if (data.fxQuoteRequest) {
                let fxQuoteRequest;

                if (data.fxQuoteRequest.body !== undefined) {
                    fxQuoteRequest = data.fxQuoteRequest.body;
                    if (typeof fxQuoteRequest === 'string') {
                        try {
                            fxQuoteRequest = JSON.parse(fxQuoteRequest);
                        } catch (err) {
                            logger.push({ err, body: fxQuoteRequest }).log('Error parsing fxQuoteRequest.body');
                            fxQuoteRequest = null;
                        }
                    }
                } else {
                    // If body is undefined, use the entire fxQuoteRequest object directly
                    fxQuoteRequest = data.fxQuoteRequest;
                }

                // Check if fxQuoteRequest is a valid object before proceeding
                if (fxQuoteRequest && typeof fxQuoteRequest === 'object') {
                    const requiredFields = ['conversionRequestId', 'conversionTerms'];
                    const missing = requiredFields.filter(field => !fxQuoteRequest[field]);

                    if (missing.length > 0) {
                        logger.push({ key, missingRequiredFxFields: missing }).log('FX quote missing required fields');
                    }

                    try {
                        fx_quote_row = {
                            redis_key: key,
                            conversion_request_id: fxQuoteRequest.conversionRequestId || '',
                            conversion_id: fxQuoteRequest.conversionTerms?.conversionId || '',
                            determining_transfer_id: fxQuoteRequest.conversionTerms?.determiningTransferId || '',
                            initiating_fsp: '',
                            counter_party_fsp: '',
                            amount_type: '',
                            source_amount: fxQuoteRequest.conversionTerms?.sourceAmount?.amount || '',
                            source_currency: fxQuoteRequest.conversionTerms?.sourceAmount?.currency || '',
                            target_amount: '',
                            target_currency: fxQuoteRequest.conversionTerms?.targetAmount?.currency || '',
                            expiration: '',
                            condition: '',
                            direction: data.direction,
                            raw: JSON.stringify(data),
                            created_at: initiatedTimestamp,
                            completed_at: completedTimestamp,
                            success: getTransferStatus(data)
                        };
                    }
                    catch (err) {
                        logger.push({
                            err,
                            key,
                            fxQuoteRequestData: JSON.stringify(fxQuoteRequest)
                        }).log('Error creating fx_quote_row');

                        // Instead of throwing the error, just log it and continue
                        fx_quote_row = null;
                    }
                } else {
                    logger.push({ key, fxQuoteRequest }).log('Invalid fxQuoteRequest data structure');
                    fx_quote_row = null;
                }
            }
            else {
                logger.log('fxQuoteRequest does not exist on', key);
            }

            if (data.fxQuoteResponse && fx_quote_row) {
                try {
                    // Use optional chaining for all nested property access
                    const fxQuoteResponseBody = typeof data.fxQuoteResponse.body === 'string'
                        ? JSON.parse(data.fxQuoteResponse.body)
                        : data.fxQuoteResponse.body;

                    fx_quote_row.conversion_id = fxQuoteResponseBody?.conversionTerms?.conversionId || fx_quote_row.conversion_id;
                    fx_quote_row.initiating_fsp = fxQuoteResponseBody?.conversionTerms?.initiatingFsp || '';
                    fx_quote_row.counter_party_fsp = fxQuoteResponseBody?.conversionTerms?.counterPartyFsp || '';
                    fx_quote_row.amount_type = fxQuoteResponseBody?.conversionTerms?.amountType || '';
                    fx_quote_row.source_amount = fxQuoteResponseBody?.conversionTerms?.sourceAmount?.amount || fx_quote_row.source_amount;
                    fx_quote_row.source_currency = fxQuoteResponseBody?.conversionTerms?.sourceAmount?.currency || fx_quote_row.source_currency;
                    fx_quote_row.target_amount = fxQuoteResponseBody?.conversionTerms?.targetAmount?.amount || '';
                    fx_quote_row.target_currency = fxQuoteResponseBody?.conversionTerms?.targetAmount?.currency || fx_quote_row.target_currency;
                    fx_quote_row.expiration = fxQuoteResponseBody?.conversionTerms?.expiration || '';
                    fx_quote_row.condition = fxQuoteResponseBody?.condition || '';
                } catch (err) {
                    logger.push({ err, body: data.fxQuoteResponse.body }).log('Error processing fxQuoteResponse.body');
                }
            } else {
                // code to handle when fxQuoteResponse key does not exist
                logger.log('fxQuoteResponse does not exist on', key);
            }

            // Check if the fxTransferRequest and fxTransferResponse are present
            let fx_transfer_row = null;
            if (data.fxTransferRequest) {
                try {
                    const fxTransferRequestData = parseData(data.fxTransferRequest.body);
                    if (fxTransferRequestData) {
                        fx_transfer_row = {
                            redis_key: key,
                            commit_request_id: fxTransferRequestData.commitRequestId || '',
                            determining_transfer_id: fxTransferRequestData.determiningTransferId || '',
                            initiating_fsp: fxTransferRequestData.initiatingFsp || '',
                            counter_party_fsp: fxTransferRequestData.counterPartyFsp || '',
                            amount_type: fxTransferRequestData.amountType || '',
                            source_amount: fxTransferRequestData.sourceAmount?.amount || '',
                            source_currency: fxTransferRequestData.sourceAmount?.currency || '',
                            target_amount: fxTransferRequestData.targetAmount?.amount || '',
                            target_currency: fxTransferRequestData.targetAmount?.currency || '',
                            condition: fxTransferRequestData.condition || '',
                            expiration: fxTransferRequestData.expiration || '',
                            conversion_state: '',  // if not fxTransferResponse leave empty
                            fulfilment: '', // if not fxTransferResponse leave empty
                            direction: data.direction,
                            created_at: initiatedTimestamp,
                            completed_timestamp: '',
                        };
                    }
                } catch (err) {
                    logger.push({ err, body: data.fxTransferRequest.body }).log('Error processing fxTransferRequest');
                    fx_transfer_row = null;
                }
            } else {
                // code to handle when fxTransferRequest key does not exist
                logger.log('fxTransferRequest does not exist on', key);
            }

            if (data.fxTransferResponse && fx_transfer_row) {
                try {
                    const fxTransferResponseBody = typeof data.fxTransferResponse.body === 'string'
                        ? JSON.parse(data.fxTransferResponse.body)
                        : data.fxTransferResponse.body;

                    fx_transfer_row.fulfilment = fxTransferResponseBody?.fulfilment || '';
                    fx_transfer_row.conversion_state = fxTransferResponseBody?.conversionState || '';
                    fx_transfer_row.completed_timestamp = fxTransferResponseBody?.completedTimestamp || '';
                } catch (err) {
                    logger.push({ err, body: data.fxTransferResponse.body }).log('Error processing fxTransferResponse');
                }
            }
            else {
                logger.log('fxTransferResponse does not exist on ', key);
            }

            // logger.push({ data }).log('processing cache item');
            // logger.push({ ...row, raw: ''}).log('Row processed');

            const keyIndex = cachedPendingKeys.indexOf(row.redis_key);
            if (keyIndex === -1) {
                try {
                    await db('transfer').insert(row);
                } catch (err) {
                    logger.log('Error inserting transfer', err);
                }
                if (fx_quote_row != undefined && fx_quote_row != null) {
                    try {
                        await db('fx_quote').insert(fx_quote_row);
                    } catch (err) {
                        logger.log('Error inserting fx_quote', err);
                    }
                }
                if (fx_transfer_row != undefined && fx_transfer_row != null) {
                    try {
                        await db('fx_transfer').insert(fx_transfer_row);
                    } catch (err) {
                        logger.log('Error inserting fx_transfer', err);
                    }
                }
                cachedPendingKeys.push(row.redis_key);
            } else {
                try {
                    await db('transfer').where({ redis_key: row.redis_key }).update(row);
                } catch (err) {
                    logger.log('Error updating transfer', err);
                }
                if (fx_quote_row != null && fx_quote_row != undefined) {
                    try {
                        await db('fx_quote').where({ redis_key: fx_quote_row.redis_key }).update(fx_quote_row);
                    } catch (err) {
                        logger.log('Error updating fx_quote', err);
                    }
                }
                if (fx_transfer_row != undefined && fx_transfer_row != null) {
                    try {
                        await db('fx_transfer').where({ redis_key: fx_transfer_row.redis_key }).update(fx_transfer_row);
                    } catch (err) {
                        logger.log('Error updating fx_transfer', err);
                    }
                }
                // cachedPendingKeys.splice(keyIndex, 1);
            }

            if (row.success !== null) {
                cachedFulfilledKeys.push(key);
            }
        }
        // When the redis key starts with fxQuote*
        else {
            // this is all a hack right now as we will eventually NOT use the cache as a source
            // of truth for transfers but rather some sort of dedicated persistence service instead.
            // Therefore we can afford to do some nasty things in order to get working features...
            // for now...

            const initiatedTimestamp = data.initiatedTimestamp
                ? new Date(data.initiatedTimestamp).getTime()
                : null;
            const completedTimestamp = data.fulfil?.body?.completedTimestamp
                ? new Date(data.fulfil.body.completedTimestamp).getTime()
                : null;

            let fxQuoteRow = null;
            if (data.fxQuoteRequest) {
                try {
                    // Safely handle nested properties with default values
                    const fxQuoteRequestBody = typeof data.fxQuoteRequest.body === 'string'
                        ? JSON.parse(data.fxQuoteRequest.body)
                        : data.fxQuoteRequest.body || {};

                    const requiredFields = ['conversionRequestId', 'conversionTerms'];
                    const missing = requiredFields.filter(field => !fxQuoteRequestBody[field]);

                    if (missing.length > 0) {
                        logger.push({ key, missingRequiredFxFields: missing }).log('FX quote missing required fields');
                    }

                    fxQuoteRow = {
                        redis_key: key,
                        conversion_request_id: fxQuoteRequestBody.conversionRequestId || '',
                        conversion_id: fxQuoteRequestBody.conversionTerms?.conversionId || '',
                        determining_transfer_id: fxQuoteRequestBody.conversionTerms?.determiningTransferId || '',
                        initiating_fsp: '',
                        counter_party_fsp: '',
                        amount_type: '',
                        source_amount: fxQuoteRequestBody.conversionTerms?.sourceAmount?.amount || '',
                        source_currency: fxQuoteRequestBody.conversionTerms?.sourceAmount?.currency || '',
                        target_amount: '',
                        target_currency: fxQuoteRequestBody.conversionTerms?.targetAmount?.currency || '',
                        expiration: '',
                        condition: '',
                        direction: data.direction,
                        raw: JSON.stringify(data),
                        created_at: initiatedTimestamp,
                        completed_at: completedTimestamp,
                        success: getInboundTransferStatus(data)
                    };
                } catch (err) {
                    logger.push({ err, body: data.fxQuoteRequest }).log('Error processing fxQuoteRequest');
                    fxQuoteRow = null;
                }
            }
            else {
                logger.log('fxQuoteRequest not present on ', key);
            }

            if (data.fxQuoteResponse && fxQuoteRow) {
                try {
                    let fxQuoteBody = data.fxQuoteResponse.body;
                    if (typeof fxQuoteBody === 'string') {
                        fxQuoteBody = JSON.parse(fxQuoteBody);
                    }

                    fxQuoteRow.conversion_id = fxQuoteBody?.conversionTerms?.conversionId || fxQuoteRow.conversion_id;
                    fxQuoteRow.initiating_fsp = fxQuoteBody?.conversionTerms?.initiatingFsp || '';
                    fxQuoteRow.counter_party_fsp = fxQuoteBody?.conversionTerms?.counterPartyFsp || '';
                    fxQuoteRow.amount_type = fxQuoteBody?.conversionTerms?.amountType || '';
                    fxQuoteRow.source_amount = fxQuoteBody?.conversionTerms?.sourceAmount?.amount || fxQuoteRow.source_amount;
                    fxQuoteRow.source_currency = fxQuoteBody?.conversionTerms?.sourceAmount?.currency || fxQuoteRow.source_currency;
                    fxQuoteRow.target_amount = fxQuoteBody?.conversionTerms?.targetAmount?.amount || '';
                    fxQuoteRow.target_currency = fxQuoteBody?.conversionTerms?.targetAmount?.currency || fxQuoteRow.target_currency;
                    fxQuoteRow.expiration = fxQuoteBody?.conversionTerms?.expiration || '';
                    fxQuoteRow.condition = fxQuoteBody?.condition || '';
                } catch (err) {
                    logger.push({ err, body: data.fxQuoteResponse.body }).log('Error processing fxQuoteResponse.body');
                }
            }
            else {
                logger.log('fxQuoteResponse not present on ', key);
            }

            let fxTransferRow = null;
            if (data.fxPrepare) {
                try {
                    const fxPrepareBody = typeof data.fxPrepare.body === 'string'
                        ? JSON.parse(data.fxPrepare.body)
                        : data.fxPrepare.body || {};

                    fxTransferRow = {
                        redis_key: key,
                        commit_request_id: fxPrepareBody.commitRequestId || '',
                        determining_transfer_id: fxPrepareBody.determiningTransferId || '',
                        initiating_fsp: fxPrepareBody.initiatingFsp || '',
                        counter_party_fsp: fxPrepareBody.counterPartyFsp || '',
                        amount_type: fxPrepareBody.amountType || '',
                        source_amount: fxPrepareBody.sourceAmount?.amount || '',
                        source_currency: fxPrepareBody.sourceAmount?.currency || '',
                        target_amount: fxPrepareBody.targetAmount?.amount || '',
                        target_currency: fxPrepareBody.targetAmount?.currency || '',
                        condition: fxPrepareBody.condition || '',
                        expiration: fxPrepareBody.expiration || '',
                        conversion_state: '', // if no fulfil leave empty
                        fulfilment: '', // if no fulfil leave empty
                        direction: data.direction,
                        created_at: initiatedTimestamp,
                        completed_timestamp: completedTimestamp,
                    };
                } catch (err) {
                    logger.push({ err, body: data.fxPrepare.body }).log('Error processing fxPrepare');
                    fxTransferRow = null;
                }
            }
            else {
                logger.log('fxPrepare not present in ', key);
            }

            if (data.fulfil && fxTransferRow) {
                try {
                    const fulfillBody = typeof data.fulfil.body === 'string'
                        ? JSON.parse(data.fulfil.body)
                        : data.fulfil.body || {};

                    fxTransferRow.fulfilment = fulfillBody.fulfilment || '';
                    fxTransferRow.conversion_state = fulfillBody.conversionState || '';
                } catch (err) {
                    logger.push({ err, body: data.fulfil.body }).log('Error processing fulfil');
                }
            }
            else {
                logger.log('fulfil not present in ', key);
            }

            try {
                if (fxQuoteRow) {
                    const keyIndex = cachedPendingKeys.indexOf(fxQuoteRow.redis_key);
                    if (keyIndex === -1) {
                        if (fxQuoteRow !== undefined && fxQuoteRow !== null) {
                            try {
                                await db('fx_quote').insert(fxQuoteRow);
                            } catch (err) {
                                logger.log('Error inserting fx_quote', err);
                            }
                        }
                        if (fxTransferRow !== undefined && fxTransferRow !== null) {
                            try {
                                await db('fx_transfer').insert(fxTransferRow);
                            } catch (err) {
                                logger.log('Error inserting fx_transfer', err);
                            }
                        }
                        cachedPendingKeys.push(fxQuoteRow.redis_key);
                    }
                    else {
                        if (fxQuoteRow != null && fxQuoteRow != undefined) {
                            try {
                                await db('fx_quote').where({ redis_key: fxQuoteRow.redis_key }).update(fxQuoteRow);
                            } catch (err) {
                                logger.log('Error inserting fx_quote', err);
                            }
                        }
                        if (fxTransferRow != undefined && fxTransferRow != null) {
                            try {
                                await db('fx_transfer').where({ redis_key: fxTransferRow.redis_key }).update(fxTransferRow);
                            } catch (err) {
                                logger.log('Error inserting fx_transfer', err);
                            }
                        }
                    }
                    if (fxQuoteRow.success !== null) {
                        cachedFulfilledKeys.push(key);
                    }
                }
            } catch (err) {
                logger.push({ err, key }).log('Error processing fx data');
            }
        }
        // const sqlRaw = db('transfer').insert(row).toString();
        // db.raw(sqlRaw.replace(/^insert/i, 'insert or ignore')).then(resolve);
    };

    // Available key patterns in redis
    const redisKeys = ['transferModel_*', 'fxQuote_in_*'];
    redisKeys.forEach(async (key) => {
        const keys = await redisCache.keys(key);
        const uncachedOrPendingKeys = keys.filter(
            (x) => cachedFulfilledKeys.indexOf(x) === -1,
        );
        await Promise.all(uncachedOrPendingKeys.map(cacheKey));
    });

    // logger.log('In-memory DB sync complete');
}

const createMemoryCache = async (config) => {
    const knexConfig = {
        client: 'better-sqlite3',
        connection: {
            filename: ':memory:',
        },
        useNullAsDefault: true,
    };

    const db = knex(knexConfig);

    Object.defineProperty(
        db,
        'createTransaction',
        async () => new Promise((resolve) => db.transaction(resolve)),
    );

    await db.migrate.latest({ directory: `${__dirname}/migrations` });


    const redisCache = new Cache(config);
    await redisCache.connect();

    const doSyncDB = () =>
        syncDB({
            redisCache,
            db,
            logger: config.logger,
        });

    if (!config.manualSync) {
        await doSyncDB();
        const interval = setInterval(doSyncDB, (config.syncInterval || 60) * 1e3);
        db.stopSync = () => clearInterval(interval);
    } else {
        db.sync = doSyncDB;
    }
    db.redisCache = () => redisCache; // for testing purposes

    return db;
};

module.exports = {
    createMemoryCache,
    syncDB
};

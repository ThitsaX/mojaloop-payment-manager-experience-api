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

// Now using sync_state table with Redis SCAN cursor for resumable sync.

const withTimeout = (promise, timeoutMs, errorMsg) => {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(errorMsg || `Operation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
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
        case 'COMMITTED':
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

const stringifyTransferData = (data, sanitize = false) => {
    if (!sanitize) {
        return JSON.stringify(data);
    }

    return JSON.stringify(data, (key, value) => {
        // Remove Authorization headers (JWT bearer tokens)
        if (key === 'Authorization' || key === 'authorization') {
            return undefined;
        }

        // Remove signature headers
        if (key === 'fspiop-signature' || key === 'Fspiop-Signature') {
            return undefined;
        }

        // Remove headers (can be very large)
        if (key === 'x-forwarded-client-cert' ||
            key === 'x-envoy-decorator-operation' ||
            key === 'x-envoy-peer-metadata' ||
            key === 'x-envoy-peer-metadata-id') {
            return undefined;
        }

        // Remove other verbose headers
        if (key === 'traceparent' || key === 'user-agent' ||
            key === 'accept-encoding' || key === 'connection' ||
            key === 'x-forwarded-for' || key === 'x-real-ip') {
            return undefined;
        }

        return value;
    });
};

async function syncDB({ redisCache, db, logger, isInitialSync = false, config = {} }) {
    logger.log('Syncing cache to MySQL database');

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

    const cacheKey = async (key, trx) => {
        const rawData = await redisCache.get(key);
        const data = parseData(rawData);

        if (!data) {
            logger.push({ key }).log('Skipping cache key due to invalid data');
            return;
        }

        const dbInstance = trx || db;
        const queryTimeout = config.queryTimeout || 30000;

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
                raw: stringifyTransferData(data, config.sanitizeTransferRawData),
                created_at: initiatedTimestamp,
                completed_at: completedTimestamp,
                home_transfer_id: data.homeTransactionId || null,
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
                    amount: data.quoteResponse?.body?.transferAmount?.amount ?? data.quoteRequest?.body?.amount?.amount ?? null,
                    currency: data.quoteResponse?.body?.transferAmount?.currency ?? data.quoteRequest?.body?.amount?.currency ?? null,
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
                            raw: stringifyTransferData(data, config.sanitizeTransferRawData),
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
            // else {
            //     // fxQuoteRequest is optional - not logging when missing to reduce log noise
            // }

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
            }
            // else {
            //     // fxQuoteResponse is optional - not logging when missing to reduce log noise
            // }

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
            }
            // else {
            //     // fxTransferRequest is optional - not logging when missing to reduce log noise
            // }

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
            // else {
            //     // fxTransferResponse is optional - not logging when missing to reduce log noise
            // }

            // logger.push({ data }).log('processing cache item');
            // logger.push({ ...row, raw: ''}).log('Row processed');

            try {
                // Check if record exists and if state has changed
                const existing = await withTimeout(
                    dbInstance('transfer')
                        .where('id', row.id)
                        .first('success', 'home_transfer_id'),
                    queryTimeout,
                    `SELECT timeout for transfer ${row.id}`
                );

                if (!existing) {
                    // New record - INSERT
                    await withTimeout(
                        dbInstance('transfer').insert(row),
                        queryTimeout,
                        `INSERT timeout for transfer ${row.id}`
                    );
                    logger.debug(`Inserted new transfer ${row.id}`);
                } else if (existing.success !== row.success || existing.home_transfer_id !== row.home_transfer_id) {
                    // Status or homeTransactionId changed - UPDATE everything for consistency
                    await withTimeout(
                        dbInstance('transfer')
                            .where('id', row.id)
                            .update(row),
                        queryTimeout,
                        `UPDATE timeout for transfer ${row.id}`
                    );
                }
                // else: No change, skip (saves unnecessary writes)
            } catch (err) {
                if (err.message.includes('timeout')) {
                    logger.push({ err, redis_key: row.redis_key }).log('Database operation timed out, will retry next sync');
                } else {
                    logger.push({ err, redis_key: row.redis_key }).log('Error processing transfer');
                }
            }

            if (fx_quote_row != undefined && fx_quote_row != null) {
                try {
                    const existingFxQuote = await withTimeout(
                        dbInstance('fx_quote')
                            .where('redis_key', fx_quote_row.redis_key)
                            .where('conversion_request_id', fx_quote_row.conversion_request_id)
                            .first('success'),
                        queryTimeout,
                        `SELECT timeout for fx_quote ${fx_quote_row.conversion_request_id}`
                    );

                    if (!existingFxQuote) {
                        await withTimeout(
                            dbInstance('fx_quote').insert(fx_quote_row),
                            queryTimeout,
                            `INSERT timeout for fx_quote ${fx_quote_row.conversion_request_id}`
                        );
                        logger.debug(`Inserted new fx_quote ${fx_quote_row.conversion_request_id}`);
                    } else if (existingFxQuote.success !== fx_quote_row.success) {
                        await withTimeout(
                            dbInstance('fx_quote')
                                .where('redis_key', fx_quote_row.redis_key)
                                .where('conversion_request_id', fx_quote_row.conversion_request_id)
                                .update(fx_quote_row),
                            queryTimeout,
                            `UPDATE timeout for fx_quote ${fx_quote_row.conversion_request_id}`
                        );
                        logger.debug(`Updated fx_quote ${fx_quote_row.conversion_request_id}`);
                    }
                } catch (err) {
                    if (err.message.includes('timeout')) {
                        logger.push({ err, redis_key: fx_quote_row.redis_key }).log('FX quote operation timed out, will retry next sync');
                    } else {
                        logger.push({ err, redis_key: fx_quote_row.redis_key }).log('Error processing fx_quote');
                    }
                }
            }

            if (fx_transfer_row != undefined && fx_transfer_row != null) {
                try {
                    const existingFxTransfer = await withTimeout(
                        dbInstance('fx_transfer')
                            .where('redis_key', fx_transfer_row.redis_key)
                            .where('commit_request_id', fx_transfer_row.commit_request_id)
                            .first('conversion_state'),
                        queryTimeout,
                        `SELECT timeout for fx_transfer ${fx_transfer_row.commit_request_id}`
                    );

                    if (!existingFxTransfer) {
                        await withTimeout(
                            dbInstance('fx_transfer').insert(fx_transfer_row),
                            queryTimeout,
                            `INSERT timeout for fx_transfer ${fx_transfer_row.commit_request_id}`
                        );
                        logger.debug(`Inserted new fx_transfer ${fx_transfer_row.commit_request_id}`);
                    } else if (existingFxTransfer.conversion_state !== fx_transfer_row.conversion_state) {
                        await withTimeout(
                            dbInstance('fx_transfer')
                                .where('redis_key', fx_transfer_row.redis_key)
                                .where('commit_request_id', fx_transfer_row.commit_request_id)
                                .update(fx_transfer_row),
                            queryTimeout,
                            `UPDATE timeout for fx_transfer ${fx_transfer_row.commit_request_id}`
                        );
                        logger.debug(`Updated fx_transfer ${fx_transfer_row.commit_request_id}`);
                    }
                } catch (err) {
                    if (err.message.includes('timeout')) {
                        logger.push({ err, redis_key: fx_transfer_row.redis_key }).log('FX transfer operation timed out, will retry next sync');
                    } else {
                        logger.push({ err, redis_key: fx_transfer_row.redis_key }).log('Error processing fx_transfer');
                    }
                }
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
                        raw: stringifyTransferData(data, config.sanitizeTransferRawData),
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
                    if (fxQuoteRow !== undefined && fxQuoteRow !== null) {
                        try {
                            const existingFxQuote = await withTimeout(
                                dbInstance('fx_quote')
                                    .where('redis_key', fxQuoteRow.redis_key)
                                    .where('conversion_request_id', fxQuoteRow.conversion_request_id)
                                    .first('success'),
                                queryTimeout,
                                `SELECT timeout for fx_quote ${fxQuoteRow.conversion_request_id}`
                            );

                            if (!existingFxQuote) {
                                await withTimeout(
                                    dbInstance('fx_quote').insert(fxQuoteRow),
                                    queryTimeout,
                                    `INSERT timeout for fx_quote ${fxQuoteRow.conversion_request_id}`
                                );
                                logger.debug(`Inserted new fx_quote ${fxQuoteRow.conversion_request_id}`);
                            } else if (existingFxQuote.success !== fxQuoteRow.success) {
                                await withTimeout(
                                    dbInstance('fx_quote')
                                        .where('redis_key', fxQuoteRow.redis_key)
                                        .where('conversion_request_id', fxQuoteRow.conversion_request_id)
                                        .update(fxQuoteRow),
                                    queryTimeout,
                                    `UPDATE timeout for fx_quote ${fxQuoteRow.conversion_request_id}`
                                );
                                logger.debug(`Updated fx_quote ${fxQuoteRow.conversion_request_id}`);
                            }
                        } catch (err) {
                            if (err.message.includes('timeout')) {
                                logger.push({ err, redis_key: fxQuoteRow.redis_key }).log('FX quote operation timed out, will retry next sync');
                            } else {
                                logger.push({ err, redis_key: fxQuoteRow.redis_key }).log('Error processing fx_quote');
                            }
                        }
                    }

                    if (fxTransferRow !== undefined && fxTransferRow !== null) {
                        try {
                            const existingFxTransfer = await withTimeout(
                                dbInstance('fx_transfer')
                                    .where('redis_key', fxTransferRow.redis_key)
                                    .where('commit_request_id', fxTransferRow.commit_request_id)
                                    .first('conversion_state'),
                                queryTimeout,
                                `SELECT timeout for fx_transfer ${fxTransferRow.commit_request_id}`
                            );

                            if (!existingFxTransfer) {
                                await withTimeout(
                                    dbInstance('fx_transfer').insert(fxTransferRow),
                                    queryTimeout,
                                    `INSERT timeout for fx_transfer ${fxTransferRow.commit_request_id}`
                                );
                                logger.debug(`Inserted new fx_transfer ${fxTransferRow.commit_request_id}`);
                            } else if (existingFxTransfer.conversion_state !== fxTransferRow.conversion_state) {
                                await withTimeout(
                                    dbInstance('fx_transfer')
                                        .where('redis_key', fxTransferRow.redis_key)
                                        .where('commit_request_id', fxTransferRow.commit_request_id)
                                        .update(fxTransferRow),
                                    queryTimeout,
                                    `UPDATE timeout for fx_transfer ${fxTransferRow.commit_request_id}`
                                );
                                logger.debug(`Updated fx_transfer ${fxTransferRow.commit_request_id}`);
                            }
                        } catch (err) {
                            if (err.message.includes('timeout')) {
                                logger.push({ err, redis_key: fxTransferRow.redis_key }).log('FX transfer operation timed out, will retry next sync');
                            } else {
                                logger.push({ err, redis_key: fxTransferRow.redis_key }).log('Error processing fx_transfer');
                            }
                        }
                    }
                }
            } catch (err) {
                logger.push({ err, key }).log('Error processing fx data');
            }
        }
        // const sqlRaw = db('transfer').insert(row).toString();
        // db.raw(sqlRaw.replace(/^insert/i, 'insert or ignore')).then(resolve);
    };

    // Batch processing configuration
    const SCAN_COUNT = config.syncBatchSize || 100; // Number of keys to fetch per SCAN iteration
    const MAX_INITIAL_SYNC_KEYS = isInitialSync ? (config.maxInitialSyncKeys || 1000) : null;
    const BATCH_TIMEOUT_MS = config.batchTimeoutMs || 120000; // 2 minutes default
    const SCAN_TIMEOUT_MS = config.scanTimeoutMs || 30000; // 30 seconds default
    const SAVE_STATE_TIMEOUT_MS = config.saveStateTimeoutMs || 30000; // 30 seconds default

    const processBatch = async (keys) => {
        let trx = null;
        let isCompleted = false;
        let isTimedOut = false;
        let timeoutId = null;

        // Track results minimally - only count, don't store all objects
        let successCount = 0;
        let errorCount = 0;
        const errors = []; // Only store first few errors

        try {
            // Create timeout that will rollback transaction
            timeoutId = setTimeout(async () => {
                isTimedOut = true;
                if (trx && !isCompleted) {
                    logger.log(`Batch timeout after ${BATCH_TIMEOUT_MS}ms - forcing rollback (${successCount}/${keys.length} processed)`);
                    try {
                        await trx.rollback();
                    } catch (rollbackErr) {
                        // Transaction might already be rolled back or connection lost
                        logger.push({ err: rollbackErr }).log('Rollback after timeout failed (may already be rolled back)');
                    }
                }
            }, BATCH_TIMEOUT_MS);

            if (isTimedOut) {
                throw new Error('Batch timed out before starting');
            }

            trx = await db.transaction();

            // Set transaction-level timeout as additional safety
            await trx.raw(`SET SESSION max_execution_time = ${BATCH_TIMEOUT_MS}`);

            for (const key of keys) {
                // Check timeout between each key
                if (isTimedOut) {
                    throw new Error(`Batch timed out while processing (${successCount}/${keys.length} keys done)`);
                }

                try {
                    await cacheKey(key, trx);
                    successCount++;
                } catch (err) {
                    errorCount++;
                    // Store first 10 errors to prevent memory bloat
                    if (errors.length < 10) {
                        errors.push({ key, error: err.message });
                    }
                    logger.push({ err, key }).log('Error processing key in batch');
                }
            }

            // Final timeout check before commit
            if (isTimedOut) {
                throw new Error('Batch timed out before commit');
            }

            await trx.commit();
            isCompleted = true;

        } catch (err) {
            // Only rollback if not already done by timeout handler
            if (trx && !isTimedOut) {
                try {
                    await trx.rollback();
                } catch (rollbackErr) {
                    // Ignore - may already be rolled back
                }
            }
            logger.push({ err }).log('Batch transaction failed, rolled back');
            throw err;

        } finally {
            // Clear timeout to prevent memory leak
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            isCompleted = true;
            trx = null;
        }

        // Return minimal result object
        return {
            total: keys.length,
            success: successCount,
            errors: errorCount,
            errorSamples: errors // Only first 10 errors
        };
    };

    // Helper function to load sync state from database
    const loadSyncState = async (keyPattern) => {
        const state = await db('sync_state')
            .where('key_pattern', keyPattern)
            .first();

        return state || {
            key_pattern: keyPattern,
            last_cursor: '0',
            total_processed: 0
        };
    };

    // Helper function to save sync state to database
    const saveSyncState = async (keyPattern, cursor, totalProcessed) => {
        // Try UPDATE first (row exists most common case)
        const updated = await db('sync_state')
            .where('key_pattern', keyPattern)
            .update({
                last_cursor: cursor,
                total_processed: totalProcessed,
                last_synced_at: db.fn.now(),
                updated_at: db.fn.now()
            });

        // Only INSERT if row doesn't exist
        if (updated === 0) {
            await db('sync_state')
                .insert({
                    key_pattern: keyPattern,
                    last_cursor: cursor,
                    total_processed: totalProcessed,
                    last_synced_at: db.fn.now()
                })
                .onConflict('key_pattern')
                .ignore(); // Ignore if another process inserted meanwhile
        }
    };

    // Available key patterns in redis
    const redisKeys = ['transferModel_*', 'fxQuote_in_*'];

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const keyPattern of redisKeys) {
        try {
            logger.log(`Processing pattern: ${keyPattern}`);

            // Load cursor checkpoint from database
            const syncState = await loadSyncState(keyPattern);
            let cursor = syncState.last_cursor;
            let patternTotalProcessed = syncState.total_processed;

            logger.log(`Resuming from cursor: ${cursor} (${patternTotalProcessed} keys processed in current cycle)`);

            let cycleComplete = false;
            let batchNumber = 0;

            // Use SCAN to iterate through keys
            while (!cycleComplete) {
                batchNumber++;

                // SCAN with timeout protection
                let nextCursor, keys;
                try {
                    [nextCursor, keys] = await withTimeout(
                        redisCache.scan(cursor, keyPattern, SCAN_COUNT),
                        SCAN_TIMEOUT_MS,
                        `Redis SCAN timed out for pattern ${keyPattern} at cursor ${cursor}`
                    );
                } catch (err) {
                    logger.push({ err }).log('Redis SCAN failed, will retry next sync cycle');
                    break; // Exit this pattern, continue with next sync interval
                }

                if (keys.length > 0) {
                    logger.log(`Processing batch ${batchNumber} from cursor ${cursor}: ${keys.length} keys found`);

                    // Process the batch
                    const batchResult = await processBatch(keys);
                    const batchErrors = batchResult.errors;

                    patternTotalProcessed += keys.length;
                    totalProcessed += keys.length;
                    totalErrors += batchErrors;

                    if (batchErrors > 0) {
                        logger.log(`Batch ${batchNumber}: ${batchResult.success}/${batchResult.total} succeeded, ${batchErrors} errors`);
                        if (batchResult.errorSamples.length > 0) {
                            logger.push({ samples: batchResult.errorSamples }).log('Error samples from batch');
                        }
                    }

                    // Save checkpoint with timeout protection
                    try {
                        await withTimeout(
                            saveSyncState(keyPattern, nextCursor, patternTotalProcessed),
                            SAVE_STATE_TIMEOUT_MS,
                            `saveSyncState timed out for pattern ${keyPattern}`
                        );
                    } catch (err) {
                        logger.push({ err }).log('Failed to save sync state, will retry next cycle');
                        break; // Won't continue without saving checkpoint
                    }

                    // Small delay between batches to prevent memory/CPU spikes
                    await new Promise(resolve => setTimeout(resolve, 10));
                } else {
                    logger.log(`Batch ${batchNumber} from cursor ${cursor}: no keys found`);
                }

                // Check if we've completed a full cycle
                if (nextCursor === '0') {
                    cycleComplete = true;
                    logger.log(`Full scan cycle complete for pattern ${keyPattern}. Processed ${patternTotalProcessed} keys total.`);

                    // Reset counter for next cycle with timeout
                    try {
                        await withTimeout(
                            saveSyncState(keyPattern, '0', 0),
                            SAVE_STATE_TIMEOUT_MS,
                            `saveSyncState (reset) timed out for pattern ${keyPattern}`
                        );
                    } catch (err) {
                        logger.push({ err }).log('Failed to reset sync state after cycle complete');
                    }
                } else {
                    cursor = nextCursor;
                }

                // Apply initial sync limit (only on first startup)
                if (MAX_INITIAL_SYNC_KEYS && patternTotalProcessed >= MAX_INITIAL_SYNC_KEYS) {
                    logger.log(`Initial sync limit reached: ${patternTotalProcessed}/${MAX_INITIAL_SYNC_KEYS} keys processed for pattern ${keyPattern}`);
                    logger.log(`Cursor saved at position ${nextCursor} - will resume from here on next sync`);
                    break;
                }
            }

        } catch (err) {
            logger.push({ err, keyPattern }).log('Error processing key pattern');
            totalErrors++;
        }
    }

    logger.log(`MySQL DB sync complete. Processed: ${totalProcessed}, Errors: ${totalErrors}`);
}

const createMemoryCache = async (config) => {
    const knexConfig = {
        client: 'mysql2',
        connection: {
            host: config.databaseConfig.host,
            port: config.databaseConfig.port,
            user: config.databaseConfig.user,
            password: config.databaseConfig.password,
            database: config.databaseConfig.database,
            connectTimeout: config.databaseConfig.connectionTimeout,
            timeout: config.databaseConfig.queryTimeout || 30000,
            timezone: '+00:00',
            charset: 'utf8mb4',
            decimalNumbers: true,
        },
        pool: config.databaseConfig.pool,
        acquireConnectionTimeout: config.databaseConfig.acquireConnectionTimeout,
        useNullAsDefault: false,
    };

    const db = knex(knexConfig);

    Object.defineProperty(
        db,
        'createTransaction',
        async () => new Promise((resolve) => db.transaction(resolve)),
    );

    await db.migrate.latest({ directory: `${__dirname}/migrations` });

    try {
        await db.raw(`SET SESSION max_execution_time = ${config.databaseConfig.queryTimeout || 30000}`);
        await db.raw(`SET SESSION innodb_lock_wait_timeout = ${config.databaseConfig.lockWaitTimeout || 30}`);
        await db.raw('SET SESSION wait_timeout = 600');
        config.logger.log('MySQL session timeouts configured successfully');
    } catch (err) {
        config.logger.push({ err }).log('Warning: Failed to set MySQL session timeouts');
    }

    const redisCache = new Cache(config);
    await redisCache.connect();

    const doSyncDB = (isInitialSync = false) =>
        syncDB({
            redisCache,
            db,
            logger: config.logger,
            isInitialSync,
            config: {
                ...config.cacheConfig,
                sanitizeTransferRawData: config.sanitizeTransferRawData
            },
        });

    // Progressive sync implementation
    let backgroundSyncRunning = false;
    let lastSyncCompletedAt = Date.now();
    const SYNC_TIMEOUT_MS = config.cacheConfig.syncStuckDetectionMs || 300000;
    
    const doProgressiveSync = async () => {
        if (backgroundSyncRunning) {
            const stuckDuration = Date.now() - lastSyncCompletedAt;
            if (stuckDuration > SYNC_TIMEOUT_MS) {
                config.logger.log(`Sync stuck for ${Math.round(stuckDuration/1000)}s, forcing reset`);
                backgroundSyncRunning = false;
            } else {
                config.logger.log('Background sync already running, skipping');
                return;
            }
        }
        
        backgroundSyncRunning = true;
        try {
            await doSyncDB(false);
            lastSyncCompletedAt = Date.now();
        } catch (err) {
            config.logger.push({ err }).log('Error in background sync');
            // Update lastSyncCompletedAt on error to prevent false stuck detection
            lastSyncCompletedAt = Date.now();
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

    // Graceful shutdown steps - stops sync, closes Redis, destroys DB pool
    db.shutdown = async () => {
        config.logger.log('Initiating graceful shutdown of cache database...');

        // Stop periodic sync to prevent new sync cycles
        if (db.stopSync) {
            config.logger.log('Stopping periodic sync...');
            db.stopSync();
        }

        // Wait for current sync to complete (with timeout)
        if (backgroundSyncRunning) {
            config.logger.log('Waiting for current sync to complete (max 30s)...');
            const maxWait = 30000;
            const startWait = Date.now();
            while (backgroundSyncRunning && (Date.now() - startWait) < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (backgroundSyncRunning) {
                config.logger.log('Sync did not complete within timeout, proceeding with shutdown');
            }
        }

        // 3. Close Redis connection
        try {
            config.logger.log('Closing Redis connection...');
            await redisCache.disconnect();
            config.logger.log('Redis connection closed');
        } catch (err) {
            config.logger.push({ err }).log('Error closing Redis connection');
        }

        // 4. Destroy database connection pool
        try {
            config.logger.log('Destroying database connection pool...');
            await db.destroy();
            config.logger.log('Database connection pool destroyed');
        } catch (err) {
            config.logger.push({ err }).log('Error destroying database pool');
        }

        config.logger.log('Graceful shutdown complete');
    };

    return db;
};

module.exports = {
    createMemoryCache,
    syncDB
};

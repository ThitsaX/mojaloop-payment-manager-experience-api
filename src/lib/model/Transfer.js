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
 *       Ujjwal Panwar - ujjwal.panwar@izyane.com                         *
 *       Mwangilwa Zimba - mwangilwa.zimba@izyane.com                         *
 **************************************************************************/

const util = require('util');
const mock = require('./mock');

class Transfer {
    /**
   *
   * @param props {object}
   * @param [props.mockData] {boolean}
   * @param props.logger {object}
   * @param props.managementEndpoint {string}
   */
    constructor(props) {
        this.mockData = props.mockData;
        this.logger = props.logger;
        this._db = props.db;
    }

    static get STATUSES() {
        return {
            null: 'PENDING',
            1: 'SUCCESS',
            0: 'ERROR',
        };
    }

    // Join the fx_transfer, fx_quote and transfer table
    _applyJoin(query) {
        return query
            .leftJoin('fx_quote', 'transfer.redis_key', 'fx_quote.redis_key')
            .leftJoin('fx_transfer', 'fx_quote.redis_key', 'fx_transfer.redis_key')
            .select([
                'transfer.*',
                'fx_quote.source_currency as fx_source_currency',
                'fx_quote.source_amount as fx_source_amount',
                'fx_quote.target_currency as fx_target_currency',
                'fx_quote.target_amount as fx_target_amount',
                'fx_transfer.source_currency as fx_transfer_source_currency',
                'fx_transfer.target_currency as fx_transfer_target_currency',
                'fx_transfer.commit_request_id as fx_commit_request_id',
            ]);
    }

    _convertToApiFormat(transfer) {
        const raw = JSON.parse(transfer.raw);

        return {
            id: transfer.id,
            batchId: transfer.batch_id,
            institution: transfer.dfsp,
            direction: transfer.direction > 0 ? 'OUTBOUND' : 'INBOUND',
            currency: transfer.currency,
            amount: Number(transfer.amount),
            type: 'P2P',
            status: Transfer.STATUSES[transfer.success],
            initiatedTimestamp: new Date(transfer.created_at).toISOString(),
            confirmationNumber: 0, // TODO: Implement
            sender: transfer.sender,
            senderIdType: transfer.sender_id_type,
            senderIdSubValue: transfer.sender_id_sub_value,
            senderIdValue: transfer.sender_id_value,
            recipient: transfer.recipient,
            recipientIdType: transfer.recipient_id_type,
            recipientIdSubValue: transfer.recipient_id_sub_value,
            recipientIdValue: transfer.recipient_id_value,
            homeTransferId: raw.homeTransactionId,
            details: transfer.details,
            errorType:
        transfer.success === 0
            ? Transfer._transferLastErrorToErrorType(raw.lastError)
            : null,
        };
    }

    static _transferLastErrorToErrorType(err) {
        if (err.mojaloopError) {
            return err.mojaloopError.errorInformation.errorDescription;
        }
        return `HTTP ${err.httpStatusCode}`;
    }

    _parseRawTransferRequestBodies(transferRaw) {
    // operate on a copy of incoming object...we dont want side effects
        const raw = JSON.parse(JSON.stringify(transferRaw));

        if (
            raw.getPartiesRequest &&
      typeof raw.getPartiesRequest.body === 'string'
        ) {
            raw.getPartiesRequest.body = JSON.parse(raw.getPartiesRequest.body);
        }
        if (raw.quoteRequest && typeof raw.quoteRequest.body === 'string') {
            raw.quoteRequest.body = JSON.parse(raw.quoteRequest.body);
        }
        if (raw.quoteResponse && typeof raw.quoteResponse.body === 'string') {
            raw.quoteResponse.body = JSON.parse(raw.quoteResponse.body);
        }
        if (raw.fxQuoteResponse && typeof raw.fxQuoteResponse.body === 'string') {
            raw.fxQuoteResponse.body = JSON.parse(raw.fxQuoteResponse.body);
        }
        if (raw.fxQuoteRequest && typeof raw.fxQuoteRequest.body === 'string') {
            raw.fxQuoteRequest.body = JSON.parse(raw.fxQuoteRequest.body);
        }
        if (
            raw.fxTransferRequest &&
      typeof raw.fxTransferRequest.body === 'string'
        ) {
            raw.fxTransferRequest.body = JSON.parse(raw.fxTransferRequest.body);
        }
        if (
            raw.fxTransferResponse &&
      typeof raw.fxTransferResponse.body === 'string'
        ) {
            raw.fxTransferResponse.body = JSON.parse(raw.fxTransferResponse.body);
        }
        if (raw.prepare && typeof raw.prepare.body === 'string') {
            raw.prepare.body = JSON.parse(raw.prepare.body);
        }
        if (raw.fulfil && typeof raw.fulfil.body === 'string') {
            raw.fulfil.body = JSON.parse(raw.fulfil.body);
        }

        return raw;
    }

    _getConversionTermsFromFxQuoteResponse(fxQuoteResponse) {
        if (fxQuoteResponse == undefined) {
            return {
                charges: {
                    totalSourceCurrencyCharges: { amount: '', currency: '' },
                    totalTargetCurrencyCharges: { amount: '', currency: '' },
                },
                expiryDate: '',
                transferAmount: {
                    sourceAmount: {
                        amount: '',
                        currency: '',
                    },
                    targetAmount: {
                        amount: '',
                        currency: '',
                    },
                },
                exchangeRate: '',
            };
        }

        // Get conversionTerms from fxQuoteResponse
        let conversionTerms = fxQuoteResponse.body.conversionTerms;
        // If conversionTerms is string , parse to JSON
        if (
            fxQuoteResponse.body &&
      typeof fxQuoteResponse.body.conversionTerms === 'string'
        )
            conversionTerms = JSON.parse(fxQuoteResponse.body.conversionTerms);

        if (!conversionTerms) return;

        // transferAmount object for response
        const transferAmount = {
            sourceAmount: {
                amount:
          conversionTerms.sourceAmount && conversionTerms.sourceAmount.amount,
                currency:
          conversionTerms.sourceAmount && conversionTerms.sourceAmount.currency,
            },
            targetAmount: {
                amount:
          conversionTerms.targetAmount && conversionTerms.targetAmount.amount,
                currency:
          conversionTerms.targetAmount && conversionTerms.targetAmount.currency,
            },
        };

        const charges = this._calculateTotalChargesFromCharges(
            conversionTerms.charges,
            conversionTerms.sourceAmount.currency,
            conversionTerms.targetAmount.currency
        );
        return {
            charges: charges,
            expiryDate: conversionTerms.expiration,
            transferAmount: transferAmount,
            exchangeRate: this._calculateExchangeRate(
                transferAmount.sourceAmount.amount,
                transferAmount.targetAmount.amount,
                parseFloat(charges.totalSourceCurrencyCharges.amount),
                parseFloat(charges.totalTargetCurrencyCharges.amount)
            ),
        };
    }

    // Calculate the total charges for the source and target currency
    _calculateTotalChargesFromCharges(charges, sourceCurrency, targetCurrency) {
        if (!charges)
            return {
                totalSourceCurrencyCharges: { amount: '', currency: '' },
                totalTargetCurrencyCharges: { amount: '', currency: '' },
            };

        let totalSourceCurrencyCharges = 0;
        let totalTargetCurrencyCharges = 0;

        // Iterate over the charges array to sum the charges for source and target currency
        charges.forEach((charge) => {
            const sourceAmount = charge.sourceAmount
                ? parseFloat(charge.sourceAmount.amount)
                : 0;
            const targetAmount = charge.targetAmount
                ? parseFloat(charge.targetAmount.amount)
                : 0;
            // Sum only when the charge currency is same as source or target currency
            // Also check sourceAmount and targetAmount and present or not null
            if (
                charge.sourceAmount &&
        charge.sourceAmount.currency === sourceCurrency
            )
                totalSourceCurrencyCharges += sourceAmount;
            if (
                charge.targetAmount &&
        charge.targetAmount.currency === targetCurrency
            )
                totalTargetCurrencyCharges += targetAmount;
        });

        return {
            totalSourceCurrencyCharges: {
                amount: totalSourceCurrencyCharges.toString(),
                currency: sourceCurrency,
            },
            totalTargetCurrencyCharges: {
                amount: totalTargetCurrencyCharges.toString(),
                currency: targetCurrency,
            },
        };
    }

    _calculateExchangeRate(sourceAmount, targetAmount, totalSourceCharges, totalTargetCharges) {
        // Condition for when exchangeRate calculation is not possible , also to avoid divide by zero error
        if(!sourceAmount || !targetAmount || ((sourceAmount - totalSourceCharges) === 0))
            return null;
        // If the totalTargetCharges and totalSourceCharges are null because of there being no charges the result should not evaluate to Nan. To avoid that checking if the charge is an empty string and setting it to 0 before the calculations
        if(isNaN(totalTargetCharges))
            totalTargetCharges = 0;
        if(isNaN(totalSourceCharges))
            totalSourceCharges = 0;
        return ((targetAmount - totalTargetCharges)/(sourceAmount - totalSourceCharges)).toFixed(4);
    }

    _convertToApiDetailFormat(transfer) {
        let raw = {};
        try {
            raw = JSON.parse(transfer.raw);
        }catch (e) {
            this.logger.error(`Error at _convertToApiDetailFormat function: ${e}`);
        }

        try {
            raw = this._parseRawTransferRequestBodies(raw);
        }
        catch(e){
            this.logger.error(`Error at _parseRawTransferRequestBodies function: ${e}`);
        }

        return {
            needFx: raw.needFx,
            transferId: transfer.id,
            transferState: Transfer.STATUSES[transfer.success],
            direction: transfer.direction > 0 ? 'OUTBOUND' : 'INBOUND',
            transactionType: raw.transactionType,
            confirmationNumber: 0, // TODO: Implement
            sendAmount: transfer.fx_source_amount
                ? transfer.fx_source_amount
                : transfer.amount,
            sendCurrency: transfer.fx_source_currency
                ? transfer.fx_source_currency
                : transfer.currency,
            dateSubmitted: new Date(transfer.created_at),
            // If needFx is false show default amount and currency else show the fx for receive
            receiveAmount: !raw.needFx
                ? transfer.amount
                : transfer.fx_target_amount
                    ? transfer.fx_target_amount
                    : '',
            receiveCurrency: !raw.needFx
                ? transfer.currency
                : transfer.fx_target_currency
                    ? transfer.fx_target_currency
                    : '',
            conversionAcceptedDate:
        raw.fxTransferResponse &&
        raw.fxTransferResponse.body &&
        raw.fxTransferResponse.body.completedTimestamp,
            senderDetails: {
                idType: transfer.sender_id_type,
                idValue: transfer.sender_id_value,
            },
            recipientDetails: {
                idType: transfer.recipient_id_type,
                idValue: transfer.recipient_id_value,
            },
            recipientCurrencies: JSON.parse(transfer.supported_currencies),
            recipientInstitution:
        raw.quoteRequest &&
        raw.quoteRequest.body &&
        raw.quoteRequest.body.payee &&
        raw.quoteRequest.body.payee.partyIdInfo &&
        raw.quoteRequest.body.payee.partyIdInfo.fspId,
            conversionType: transfer.direction > 0 ? 'Payer DFSP conversion' : '',
            conversionInstitution:
        raw.fxQuoteRequest &&
        raw.fxQuoteRequest.body &&
        raw.fxQuoteRequest.body.conversionTerms &&
        raw.fxQuoteRequest.body.conversionTerms.counterPartyFsp,
            conversionState: raw.fulfil
                ? raw.fulfil.body.transferState
                : raw.fxTransferResponse && raw.fxTransferResponse.body.conversionState,
            initiatedTimestamp: new Date(transfer.created_at),
            transferTerms: {
                transferId: transfer.id,
                quoteAmount: {
                    amount: transfer.amount,
                    currency: transfer.currency,
                },
                quoteAmountType: raw.quoteRequest && raw.quoteRequest.body.amountType,
                transferAmount: {
                    amount:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.transferAmount &&
            raw.quoteResponse.body.transferAmount.amount,
                    currency:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.transferAmount &&
            raw.quoteResponse.body.transferAmount.currency,
                },
                payeeReceiveAmount: {
                    amount:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.payeeReceiveAmount &&
            raw.quoteResponse.body.payeeReceiveAmount.amount,
                    currency:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.payeeReceiveAmount &&
            raw.quoteResponse.body.payeeReceiveAmount.currency,
                },
                payeeDfspFee: {
                    amount:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.payeeFspFee &&
            raw.quoteResponse.body.payeeFspFee.amount,
                    currency:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.payeeFspFee &&
            raw.quoteResponse.body.payeeFspFee.currency,
                },
                payeeDfspCommision: {
                    amount:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.payeeFspCommission &&
            raw.quoteResponse.body.payeeFspCommission.amount,
                    currency:
            raw.quoteResponse &&
            raw.quoteResponse.body &&
            raw.quoteResponse.body.payeeFspCommission &&
            raw.quoteResponse.body.payeeFspCommission.currency,
                },
                expiryDate:
          raw.quoteResponse &&
          raw.quoteResponse.body &&
          raw.quoteResponse.body.expiration,
                conversionTerms: this._getConversionTermsFromFxQuoteResponse(
                    raw.fxQuoteResponse
                ),
            },
            transferParties: {
                transferId: transfer.id,
                transferState: raw.currentState,
                transactionType: raw.transactionType,
                payerParty: this._getPartyFromQuoteRequest(raw.quoteRequest, 'payer'),
                payeeParty: this._getPartyFromQuoteRequest(raw.quoteRequest, 'payee'),
            },
            technicalDetails: {
                schemeTransferId: raw.transferId,
                transactionId:
          raw.quoteRequest &&
          raw.quoteRequest.body &&
          raw.quoteRequest.body.transactionId,
                conversionState: raw.fulfil
                    ? raw.fulfil.body.transferState
                    : raw.fxTransferResponse &&
            raw.fxTransferResponse.body.conversionState,
                conversionId:
          raw.fxQuoteRequest &&
          raw.fxQuoteRequest.body &&
          raw.fxQuoteRequest.body.conversionTerms &&
          raw.fxQuoteRequest.body.conversionTerms.conversionId,
                conversionQuoteId:
          raw.fxQuoteRequest &&
          raw.fxQuoteRequest.body &&
          raw.fxQuoteRequest.body.conversionRequestId,
                quoteId:
          raw.quoteRequest &&
          raw.quoteRequest.body &&
          raw.quoteRequest.body.quoteId,
                commitRequestId: transfer.fx_commit_request_id,
                homeTransferId: raw.homeTransactionId,
                payerParty: this._getPartyFromQuoteRequest(raw.quoteRequest, 'payer'),
                payeeParty: this._getPartyFromQuoteRequest(raw.quoteRequest, 'payee'),
                transferState: raw.currentState,
                getPartiesRequest: {
                    headers: raw.getPartiesRequest && raw.getPartiesRequest.headers,
                    body: raw.getPartiesRequest && raw.getPartiesRequest.body,
                },
                getPartiesResponse: raw.getPartiesResponse,
                quoteRequest: {
                    headers: raw.quoteRequest && raw.quoteRequest.headers,
                    body: raw.quoteRequest && raw.quoteRequest.body,
                },
                quoteResponse: raw.quoteResponse,
                fxQuoteResponse: raw.fxQuoteResponse && raw.fxQuoteResponse.body,
                fxQuoteRequest: {
                    headers: raw.fxQuoteRequest && raw.fxQuoteRequest.headers,
                    body: raw.fxQuoteRequest && raw.fxQuoteRequest.body,
                },
                fxTransferPrepare: {
                    headers: raw.fxTransferRequest && raw.fxTransferRequest.headers,
                    body: raw.fxTransferRequest && raw.fxTransferRequest.body,
                },
                fxTransferFulfilment:
          raw.fxTransferResponse && raw.fxTransferResponse.body,
                transferPrepare: {
                    headers: raw.prepare && raw.prepare.headers,
                    body: raw.prepare && raw.prepare.body,
                },
                transferFulfilment: raw.fulfil,
                lastError: raw.lastError,
            },
        };
    }

    _getPartyFromQuoteRequest(qr, partyType) {
        if (qr == undefined) {
            return {
                idType: '',
                idValue: '',
                idSubType: '',
                displayName: '',
                firstName: '',
                middleName: '',
                lastName: '',
                dateOfBirth: '',
                merchantClassificationCode: '',
                fspId: '',
                extensionList: '',
            };
        }

        const p = qr.body[partyType];

        if (!p) {
            return;
        }

        const result = {
            idType: p.partyIdInfo && p.partyIdInfo.partyIdType,
            idValue: p.partyIdInfo && p.partyIdInfo.partyIdentifier,
            idSubType: p.partyIdInfo && p.partyIdInfo.partySubIdOrType,
            displayName:
        p.name ||
        (p.personalInfo &&
          this._complexNameToDisplayName(p.personalInfo.complexName)),
            firstName:
        p.personalInfo &&
        p.personalInfo.complexName &&
        p.personalInfo.complexName.firstName,
            middleName:
        p.personalInfo &&
        p.personalInfo.complexName &&
        p.personalInfo.complexName.middleName,
            lastName:
        p.personalInfo &&
        p.personalInfo.complexName &&
        p.personalInfo.complexName.lastName,
            dateOfBirth: p.personalInfo && p.personalInfo.dateOfBirth,
            merchantClassificationCode: p.merchantClassificationCode,
            fspId: p.partyIdInfo && p.partyIdInfo.fspId,
            extensionList:
        p.partyIdInfo &&
        p.partyIdInfo.extensionList &&
        p.partyIdInfo.extensionList.extension,
        };

        this.logger.debug(`PartyFromQuoteRequest: ${util.inspect(result)}`);
        return result;
    }

    _complexNameToDisplayName(p) {
        if (!p) {
            return;
        }
        // Since any of the firstName/middleName/lastName can be undefined/null we need to concatenate conditionally and then trim
        return `${p.firstName ? p.firstName : ''}${
            p.middleName ? ' ' + p.middleName : ''
        } ${p.lastName ? p.lastName : ''}`.trim();
    }

    _convertToTransferParty(party) {
        return {
            type: '',
            idType: party.idType,
            idValue: party.idValue,
            idSubType: party.idSubType,
            displayName:
        party.displayName ||
        `${party.firstName ? party.firstName : ''}${
            party.middleName ? ' ' + party.middleName : ''
        } ${party.lastName ? party.lastName : ''}`.trim(),
            firstName: party.firstName,
            middleName: party.middleName,
            lastName: party.lastName,
            dateOfBirth: party.dateOfBirth,
            merchantClassificationCode: party.merchantClassificationCode,
            fspId: party.fspId,
            extensionList: party.extensionList,
        };
    }

    /**
   * @param opts {Object}
   * @param [opts.startTimestamp] {string}
   * @param [opts.endTimestamp] {string}
   * @param [opts.senderIdType] {string}
   * @param [opts.senderIdValue] {string}
   * @param [opts.senderIdSubValue] {string}
   * @param [opts.recipientIdType] {string}
   * @param [opts.recipientIdValue] {string}
   * @param [opts.recipientIdSubValue] {string}
   * @param [opts.direction] {string}
   * @param [opts.institution] {string}
   * @param [opts.batchId] {number}
   * @param [opts.status] {string}
   */
    async findAll(opts) {
        if (this.mockData) {
            return mock.getTransfers(opts);
        }
        const DEFAULT_LIMIT = 100;

        const query = this._db('transfer').whereRaw('true');
        if (opts.id) {
            query.andWhere('id', 'LIKE', `%${opts.id}%`);
        }
        if (opts.startTimestamp) {
            query.andWhere(
                'created_at',
                '>=',
                new Date(opts.startTimestamp).getTime()
            );
        }
        if (opts.endTimestamp) {
            query.andWhere('created_at', '<', new Date(opts.endTimestamp).getTime());
        }
        if (opts.senderIdType) {
            query.andWhere('sender_id_type', 'LIKE', `%${opts.senderIdType}%`);
        }
        if (opts.senderIdValue) {
            query.andWhere('sender_id_value', 'LIKE', `%${opts.senderIdValue}%`);
        }
        if (opts.senderIdSubValue) {
            query.andWhere(
                'sender_id_sub_value',
                'LIKE',
                `%${opts.senderIdSubValue}%`
            );
        }
        if (opts.recipientIdType) {
            query.andWhere('recipient_id_type', 'LIKE', `%${opts.recipientIdType}%`);
        }
        if (opts.recipientIdValue) {
            query.andWhere(
                'recipient_id_value',
                'LIKE',
                `%${opts.recipientIdValue}%`
            );
        }
        if (opts.recipientIdSubValue) {
            query.andWhere(
                'recipient_id_sub_value',
                'LIKE',
                `%${opts.recipientIdSubValue}%`
            );
        }
        if (opts.direction) {
            if (opts.direction === 'INBOUND') {
                query.andWhere('direction', '=', '-1');
            } else if (opts.direction === 'OUTBOUND') {
                query.andWhere('direction', '=', '1');
            }
        }
        if (opts.institution) {
            query.andWhere('dfsp', 'LIKE', `%${opts.institution}%`);
        }
        if (opts.batchId) {
            query.andWhere('batchId', 'LIKE', `%${opts.batchId}%`);
        }
        if (opts.status) {
            if (opts.status === 'PENDING') {
                query.andWhereRaw('success IS NULL');
            } else {
                query.andWhere('success', opts.status === 'SUCCESS');
            }
        }
        if (opts.offset) {
            query.offset(opts.offset);
        }
        query.limit(opts.limit || DEFAULT_LIMIT);
        query.orderBy('created_at');

        const rows = await query;
        return rows.map(this._convertToApiFormat.bind(this));
    // return this._requests.get('transfers', opts);
    }

    /**
   * @param opts {Object}
   * @param [opts.startTimestamp] {string}
   * @param [opts.endTimestamp] {string}
   * @param [opts.senderIdType] {string}
   * @param [opts.senderIdValue] {string}
   * @param [opts.senderIdSubValue] {string}
   * @param [opts.recipientIdType] {string}
   * @param [opts.recipientIdValue] {string}
   * @param [opts.recipientIdSubValue] {string}
   * @param [opts.direction] {string}
   * @param [opts.institution] {string}
   * @param [opts.batchId] {number}
   * @param [opts.status] {string}
   */
    async findAllWithFX(opts) {
        if (this.mockData) {
            return mock.getTransfers(opts);
        }

        const DEFAULT_LIMIT = 100;

        const query = this._db('transfer').whereRaw(true);

        this._applyJoin(query);

        if (opts.id) {
            query.andWhere('transfer.id', 'LIKE', `%${opts.id}%`);
        }
        if (opts.startTimestamp) {
            query.andWhere(
                'transfer.created_at',
                '>=',
                new Date(opts.startTimestamp).getTime()
            );
        }
        if (opts.endTimestamp) {
            query.andWhere(
                'transfer.created_at',
                '<',
                new Date(opts.endTimestamp).getTime()
            );
        }
        if (opts.senderIdType) {
            query.andWhere(
                'transfer.sender_id_type',
                'LIKE',
                `%${opts.senderIdType}%`
            );
        }
        if (opts.senderIdValue) {
            query.andWhere(
                'transfer.sender_id_value',
                'LIKE',
                `%${opts.senderIdValue}%`
            );
        }
        if (opts.senderIdSubValue) {
            query.andWhere(
                'transfer.sender_id_sub_value',
                'LIKE',
                `%${opts.senderIdSubValue}%`
            );
        }
        if (opts.recipientIdType) {
            query.andWhere(
                'transfer.recipient_id_type',
                'LIKE',
                `%${opts.recipientIdType}%`
            );
        }
        if (opts.recipientIdValue) {
            query.andWhere(
                'transfer.recipient_id_value',
                'LIKE',
                `%${opts.recipientIdValue}%`
            );
        }
        if (opts.recipientIdSubValue) {
            query.andWhere(
                'transfer.recipient_id_sub_value',
                'LIKE',
                `%${opts.recipientIdSubValue}%`
            );
        }
        if (opts.direction) {
            if (opts.direction === 'INBOUND') {
                query.andWhere('transfer.direction', '=', '-1');
            } else if (opts.direction === 'OUTBOUND') {
                query.andWhere('transfer.direction', '=', '1');
            }
        }
        if (opts.institution) {
            query.andWhere('transfer.dfsp', 'LIKE', `%${opts.institution}%`);
        }
        if (opts.batchId) {
            query.andWhere('transfer.batch_id', 'LIKE', `%${opts.batchId}%`);
        }
        if (opts.status) {
            if (opts.status === 'PENDING') {
                query.andWhereRaw('transfer.success IS NULL');
            } else {
                query.andWhere('transfer.success', opts.status === 'SUCCESS');
            }
        }
        if (opts.offset) {
            query.offset(opts.offset);
        }
        query.limit(opts.limit || DEFAULT_LIMIT);
        query.orderBy('transfer.created_at');

        const rows = await query;
        return rows.map(this._convertToApiFormat.bind(this));
    }

    /**
   *
   * @param id {string}
   */
    async findOne(id) {
        if (this.mockData) {
            return mock.getTransfer({ id });
        }
        const row = await this._db('transfer').where('id', id).first();
        return this._convertToApiFormat(row);
    }

    /**
   *
   * @param id {string}
   */
    async details(id) {
        if (this.mockData) {
            return mock.getTransferDetails({ id });
        }

        const query = this._db('transfer').where('transfer.id', id);
        this._applyJoin(query);
        const rows = await query;
        if (rows.length > 0) {
            return this._convertToApiDetailFormat(rows[0]);
        }
        return null;
    }

    /**
   *
   * @param opts {Object}
   * @param [opts.minutePrevious] {number}
   */
    async successRate(opts) {
        if (this.mockData) {
            return mock.getTransfersSuccessRate(opts);
        }
        const now = Date.now();
        const statQuery = (successOnly) => {
            const query = this._db('transfer')
                .count('id as count')
                .select(
                    this._db.raw(
                        'MIN(((created_at) / (60 * 1000)) * 60 * 1000) as timestamp'
                    )
                ) // trunc (milli)seconds
                .whereRaw(
                    `(${now} - created_at) < ${(opts.minutePrevious || 10) * 60 * 1000}`
                );
            if (successOnly) {
                query.andWhere('success', true);
            }
            query.groupByRaw('created_at / (60 * 1000)');
            return query;
        };

        const successStat = await statQuery(true);
        const allStat = await statQuery(false);
        return allStat.map(({ timestamp, count }) => {
            const successRow = successStat.find((row) => row.timestamp === timestamp);
            const successCount = successRow ? successRow.count : 0;
            return {
                timestamp,
                percentage: Math.trunc((successCount / count) * 100),
            };
        });
    }

    /**
   *
   * @param opts {Object}
   * @param [opts.minutePrevious] {number}
   */
    async avgResponseTime(opts) {
        if (this.mockData) {
            return mock.getTransfersAvgResponseTime(opts);
        }
        const now = Date.now();
        const avgRespTimeQuery = () => {
            return this._db('transfer')
                .select(
                    this._db.raw('AVG(completed_at - created_at) as averageResponseTime')
                ) // trunc (milli)seconds
                .select(
                    this._db.raw(
                        'MIN(((created_at) / (60 * 1000)) * 60 * 1000) as timestamp'
                    )
                ) // trunc (milli)seconds
                .whereRaw(
                    `(${now} - created_at) < ${(opts.minutePrevious || 10) * 60 * 1000}`
                )
                .andWhereRaw('success IS NOT NULL')
                .andWhereRaw('completed_at IS NOT NULL')
                .andWhereRaw('created_at IS NOT NULL')
                .groupByRaw('created_at / (60 * 1000)');
        };

        const rows = await avgRespTimeQuery();
        return rows;
    }

    /**
   *
   * @param opts {Object}
   * @param [opts.startTimestamp] {string}
   * @param [opts.endTimestamp] {string}
   */
    async statusSummary(opts) {
        if (this.mockData) {
            return mock.getTransferStatusSummary(opts);
        }
        const statusQuery = () => {
            const query = this._db('transfer')
                .select('success')
                .count('id as count')
                .whereRaw('true');
            if (opts.startTimestamp) {
                query.andWhere(
                    'created_at',
                    '>=',
                    new Date(opts.startTimestamp).getTime()
                );
            }
            if (opts.endTimestamp) {
                query.andWhere(
                    'created_at',
                    '<',
                    new Date(opts.endTimestamp).getTime()
                );
            }
            query.groupBy('success');
            return query;
        };
        const rows = await statusQuery();

        let ret = {};

        Object.keys(Transfer.STATUSES).map((k) => {
            ret[Transfer.STATUSES[k]] = {
                status: Transfer.STATUSES[k],
                count: 0,
            };
        });

        rows.forEach((r) => {
            ret[Transfer.STATUSES[r.success]] = {
                status: Transfer.STATUSES[r.success],
                count: r.count,
            };
        });

        return Object.keys(ret).map((r) => ret[r]);
    }

    /**
   *
   * @param opts {Object}
   * @param [opts.hoursPrevious] {number}
   */
    async hourlyFlow(opts) {
        if (this.mockData) {
            return mock.getFlows(opts);
        }
        const now = Date.now();
        const flowQuery = () => {
            return (
                this._db('transfer')
                    .select('direction', 'currency')
                    .sum('amount as sum')
                    .select(
                        this._db.raw(
                            'MIN(((created_at) / (3600 * 1000)) * 3600 * 1000) as timestamp'
                        )
                    ) // trunc (milli)seconds
                    .whereRaw(
                        `(${now} - created_at) < ${
                            (opts.hoursPrevious || 10) * 3600 * 1000
                        }`
                    )
                // .andWhere('success', true)
                    .groupByRaw('created_at / (3600 * 1000), currency, direction')
            );
        };

        const flowStat = await flowQuery();
        const stat = {};
        for (const row of flowStat) {
            const k = `${row.timestamp}_${row.currency}`;
            if (!stat[k]) {
                stat[k] = {
                    timestamp: row.timestamp,
                    currency: row.currency,
                    inbound: 0,
                    outbound: 0,
                };
            }
            if (row.direction > 0) {
                stat[k].outbound = row.sum;
            } else {
                stat[k].inbound = row.sum;
            }
        }
        return Object.values(stat);
    }

    /**
   *
   * @param opts {Object}
   * @param [opts.startTimestamp] {string}
   * @param [opts.endTimestamp] {string}
   */
    async errors(opts) {
        try {
            if (this.mockData) {
                return mock.getErrors(opts);
            }
            const rows = await this._db('transfer').where('success', false);
            return rows.map(this._convertToApiFormat.bind(this));
        } catch (err) {
            this.logger.log(
                `Error getting transfer errors: ${err.stack || util.inspect(err)}`
            );
            throw err;
        }
    }
}

Transfer.STATUSES = {
    null: 'PENDING',
    1: 'SUCCESS',
    0: 'ERROR',
};

module.exports = Transfer;

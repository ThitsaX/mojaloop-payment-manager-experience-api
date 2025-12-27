/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       Murthy Kakarlamudi - murthy@modusbox.com                         *
 *                                                                        *
 *  CONTRIBUTORS:                                                         *
 *       James Bush - james.bush@modusbox.com                             *
 *       Juan Correa - juan.correa@modusbox.com                           *
 **************************************************************************/

'use strict';

const {
    Batch,
    Transfer,
    Position,
    DFSPModel,
    CertificatesModel,
    MonetaryZoneModel,
    MetricsModel,
    EndpointsModel,
    FxpConversion,
} = require('@internal/model');


const healthCheck = async (ctx) => {
    const health = {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now(),
    };

    try {
        // Check database connectivity
        if (ctx.state.cache) {
            await ctx.state.cache.raw('SELECT 1');
            health.database = 'connected';
        }
    } catch (err) {
        ctx.state.logger.push({ err }).log('Database health check failed');
        health.status = 'degraded';
        health.database = 'disconnected';
        health.error = err.message;
        ctx.status = 503; // Service Unavailable
    }

    ctx.body = JSON.stringify(health);
};

const getDfspStatus = async (ctx) => {
    const dfspId = ctx.state.conf.dfspId;
    const { managementEndpoint } = ctx.state.conf;
    const dfspModel = new DFSPModel({
        logger: ctx.state.logger,
        managementEndpoint,
        mockData: true
    });
    ctx.body = await dfspModel.getDfspStatus(dfspId);
};

const getBatches = async (ctx) => {
    const { startTimestamp, endTimestamp } = ctx.query;
    const batch = new Batch({
        ...ctx.state.conf,
        mockData: true
    });
    ctx.body = batch.findAll({ startTimestamp, endTimestamp });
};

const getBatch = async (ctx) => {
    const batch = new Batch({
        ...ctx.state.conf,
        mockData: true
    });
    ctx.body = batch.findOne(ctx.params.batchId);
};

const getTransfers = async (ctx) => {
    const { id, startTimestamp, endTimestamp, senderIdType, senderIdValue, senderIdSubValue, recipientIdType, recipientIdValue, recipientIdSubValue, direction, institution, status, batchId, cursor, limit } = ctx.query;

    const transfer = new Transfer({ ...ctx.state.conf, logger: ctx.state.logger, db: ctx.state.db });

    // Use findAll() instead of findAllWithFX() since FX features are not being used
    // This avoids expensive LEFT JOINs with fx_quote and fx_transfer tables
    const results = await transfer.findAll({ id, startTimestamp, endTimestamp, senderIdType, senderIdValue, senderIdSubValue, recipientIdType, recipientIdValue, recipientIdSubValue, direction, institution, status, batchId, cursor, limit });

    // Return results with next cursor for pagination
    // Cursor format: "created_at|id"
    ctx.body = {
        transfers: results,
        nextCursor: results.length > 0
            ? `${new Date(results[results.length - 1].initiatedTimestamp).getTime()}|${results[results.length - 1].id}`
            : null,
        hasMore: results.length === parseInt(limit || 50) // Indicates if there are more results
    };
};

const getTransfersCount = async (ctx) => {
    const { id, startTimestamp, endTimestamp, senderIdType, senderIdValue, senderIdSubValue, recipientIdType, recipientIdValue, recipientIdSubValue, direction, institution, status, batchId } = ctx.query;

    const transfer = new Transfer({ ...ctx.state.conf, logger: ctx.state.logger, db: ctx.state.db });

    ctx.body = await transfer.count({ id, startTimestamp, endTimestamp, senderIdType, senderIdValue, senderIdSubValue, recipientIdType, recipientIdValue, recipientIdSubValue, direction, institution, status, batchId });
};


const getTransferStatusSummary = async (ctx) => {
    const { startTimestamp, endTimestamp } = ctx.query;
    const transfer = new Transfer({ ...ctx.state.conf, logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.statusSummary({ startTimestamp, endTimestamp });
};

const getTransfer = async (ctx) => {
    const transfer = new Transfer({ ...ctx.state.conf, logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.findOne(ctx.params.transferId);
};

const getTransferDetails = async (ctx) => {
    const transfer = new Transfer({ ...ctx.state.conf, logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.details(ctx.params.transferId);
};

const getErrors = async (ctx) => {
    const { startTimestamp, endTimestamp } = ctx.query;
    const transfer = new Transfer({ ...ctx.state.conf, logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.errors({ startTimestamp, endTimestamp });
};

const getHourlyPosition = async (ctx) => {
    const { hoursPrevious } = ctx.query;
    const position = new Position(ctx.state.conf);
    ctx.body = await position.findAll({ hoursPrevious });
};

const getHourlyFlow = async (ctx) => {
    const { hoursPrevious } = ctx.query;
    const transfer = new Transfer({...ctx.state.conf, logger:ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.hourlyFlow({ hoursPrevious });
};

const getTransfersSuccessRate = async (ctx) => {
    const { minutePrevious } = ctx.query;
    const transfer = new Transfer({...ctx.state.conf, logger:ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.successRate({ minutePrevious });
};

const getTransfersAvgResponseTime = async (ctx) => {
    const { minutePrevious } = ctx.query;
    const transfer = new Transfer({...ctx.state.conf, logger:ctx.state.logger, db: ctx.state.db });
    ctx.body = await transfer.avgResponseTime({ minutePrevious });
};

const getFxpConversions = async (ctx) =>  {
    const { id, startTimestamp, endTimestamp, senderIdType, senderIdValue, senderIdSubValue, recipientIdType, recipientIdValue, recipientIdSubValue, direction, institution, status, batchId, offset, limit } = ctx.query;

    const fxpConversion = new FxpConversion({ logger: ctx.state.logger, db:ctx.state.db});

    ctx.body = await fxpConversion.findAll({ id, startTimestamp, endTimestamp, senderIdType, senderIdValue, senderIdSubValue, recipientIdType, recipientIdValue, recipientIdSubValue, direction, institution, status, batchId, offset, limit });
};

const getFxpConversionStatusSummary = async (ctx) => {
    const { startTimestamp, endTimestamp } = ctx.query;
    const fxpConversion = new FxpConversion({ logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await fxpConversion.statusSummary({ startTimestamp, endTimestamp });
};

const getFxpConversionDetails = async (ctx) => {
    const fxpConversion = new FxpConversion({ logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await fxpConversion.details(ctx.params.conversionId);
};

const getFxpConversionErrors = async (ctx) => {
    const { startTimestamp, endTimestamp } = ctx.query;
    const fxpConversion = new FxpConversion({ logger: ctx.state.logger, db: ctx.state.db});
    ctx.body = await fxpConversion.fxpErrors({ startTimestamp, endTimestamp });
};

const getFxpConversionsSuccessRate = async (ctx) => {
    const { minutePrevious } = ctx.query;
    const fxpConversion = new FxpConversion({ logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await fxpConversion.successRate({ minutePrevious });
};
const getFxpConversionsAvgResponseTime = async (ctx) => {
    const { minutePrevious } = ctx.query;
    const fxpConversion = new FxpConversion({ logger: ctx.state.logger, db: ctx.state.db });
    ctx.body = await fxpConversion.avgResponseTime({ minutePrevious });
};

const getMetrics = async (ctx) => {
    const {
        startTimestamp,
        endTimestamp,
        aggregateDurationSeconds,
        resolutionSeconds,
        metricType
    } = ctx.query;

    const metrics = new MetricsModel({ ...ctx.state.conf, logger: ctx.state.logger });

    const result = await metrics.query({
        startTimestamp,
        endTimestamp,
        metricName: ctx.params.metricName,
        metricType,
        aggregateDurationSeconds,
        resolutionSeconds
    });

    if(result.error) {
        ctx.body = result.error;
        ctx.response.status = 500;
        return;
    }

    ctx.body = result;
};

const getDFSPDetails = async(ctx) => {
    const { dfspId, managementEndpoint } = ctx.state.conf;
    const dfspModel = new DFSPModel({
        dfspId,
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await dfspModel.getDFSPDetails();
};

const getAllDfsp = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const dfspModel = new DFSPModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await dfspModel.getAllDfsp();
};

const getDFSPEgressEndpointsIps = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.getDFSPEgressEndpoints({ type: 'IP' });

};

const uploadDFSPEgressEndpointsIps = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.uploadDFSPEgressEndpoints({ type: 'IP' }, ctx.request.body.value);
};

/**
 * Update existing dfsp endpoint
 * @param {*} ctx
 */
const updateDFSPEgressEndpointsIp = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.updateDFSPEndpoints({ epId: ctx.params.epId, type: 'IP', direction : 'EGRESS',...ctx.request.body.value });
};

/**
 * Update existing dfsp endpoint
 * @param {*} ctx
 */
const updateDFSPIngressEndpointsIp = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.updateDFSPEndpoints({ epId: ctx.params.epId, type: 'IP', direction : 'INGRESS',...ctx.request.body.value });
};

const deleteDFSPEndpointsIp = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.deleteDFSPEndpoints({ epId: ctx.params.epId });
};

const getDFSPIngressEndpointsIps = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.getDFSPIngressEndpoints({ type: 'IP' });
};

const uploadDFSPIngressEndpointsIps = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.uploadDFSPIngressEndpoints({ type:'IP' }, ctx.request.body.value);
};

const getDFSPIngressEndpointsUrls = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.getDFSPIngressEndpoints({ type: 'URL' });
};

const uploadDFSPIngressEndpointsUrls = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.uploadDFSPIngressEndpoints({ type:'URL' }, ctx.request.body);
};

/**
 * Update DFSP Ingress URL endpoint by Id
 * @param {*} ctx
 */
const updateDFSPIngressEndpointsUrlById = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.updateDFSPIngressEndpointsUrlById({ type:'URL', epId: ctx.params.epId }, ctx.request.body);
};

/**
 * Update DFSP Ingress URL endpoint by Id
 * @param {*} ctx
 */
const deleteDFSPIngressEndpointsUrlById = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.deleteDFSPIngressEndpointsUrlById({ epId: ctx.params.epId });
};

const getHubIngressEndpoints = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.getHubIngressEndpoints();
};

const getHubEgressEndpoints = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const endpointsModel = new EndpointsModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await endpointsModel.getHubEgressEndpoints();
};

const createClientCSR = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.createClientCSR();
};

const getClientCertificate = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getCertificates();
};

const getDFSPCA = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getDFSPCA();
};

const createDFSPCA = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.createDFSPCA(ctx.request.body);
};

const setDFSPCA = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.setDFSPCA(ctx.request.body);
};

const getAllJWSCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getAllJWSCertificates();
};

const getJWSCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getJWSCertificates();
};

const uploadJWSCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.uploadJWSCertificates(ctx.request.body);
};

const updateJWSCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.updateJWSCertificates(ctx.request.body);
};

const deleteJWSCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.deleteJWSCertificates();
};

const getHubCA = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getHubCA();
};

const getDFSPServerCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getDFSPServerCertificates();
};

const generateServerCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.generateServerCertificates(ctx.request.body);
};

const getHubServerCertificates = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.getHubServerCertificates();
};

const getMonetaryZones = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const monetaryZoneModel = new MonetaryZoneModel({
        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await monetaryZoneModel.getMonetaryZones();
};

const getDfspsByMonetaryZones = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const dfspModel = new DFSPModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await dfspModel.getDFSPsByMonetaryZone({monetaryZoneId: ctx.params.monetaryZoneId});
};

const generateAllCerts = async(ctx) => {
    const { managementEndpoint } = ctx.state.conf;
    const certsModel = new CertificatesModel({

        managementEndpoint,
        logger: ctx.state.logger,
    });
    ctx.body = await certsModel.generateAllCerts();
};



module.exports = {
    '/health': {
        get: healthCheck
    },
    '/status': {
        get: getDfspStatus,
    },
    '/batches': {
        get: getBatches,
    },
    '/batches/{batchId}': {
        get: getBatch,
    },
    '/batches/{batchId}/transfers': {
        get: getTransfers,
    },
    '/transfers': {
        get: getTransfers,
    },
    '/transfers/count': {
        get: getTransfersCount,
    },
    '/transfers/{transferId}': {
        get: getTransfer,
    },
    '/transfers/{transferId}/details': {
        get: getTransferDetails,
    },
    '/transferStatusSummary': {
        get: getTransferStatusSummary,
    },
    '/errors': {
        get: getErrors,
    },
    '/hourlyPosition': {
        get: getHourlyPosition,
    },
    '/hourlyFlow': {
        get: getHourlyFlow,
    },
    '/minuteSuccessfulTransferPerc': {
        get: getTransfersSuccessRate,
    },
    '/minuteAverageTransferResponseTime': {
        get: getTransfersAvgResponseTime,
    },
    '/metrics/{metricName}': {
        get: getMetrics,
    },
    '/dfsp/details': {
        get: getDFSPDetails,
    },
    '/dfsps': {
        get: getAllDfsp,
    },
    '/dfsp/endpoints/egress/ips': {
        get: getDFSPEgressEndpointsIps,
        post: uploadDFSPEgressEndpointsIps,
    },
    '/dfsp/endpoints/egress/ips/{epId}': {
        put: updateDFSPEgressEndpointsIp,
        delete: deleteDFSPEndpointsIp,
    },
    '/dfsp/endpoints/ingress/ips': {
        get: getDFSPIngressEndpointsIps,
        post: uploadDFSPIngressEndpointsIps,
    } ,
    '/dfsp/endpoints/ingress/ips/{epId}': {
        put: updateDFSPIngressEndpointsIp,
        delete: deleteDFSPEndpointsIp,
    } ,
    '/dfsp/endpoints/ingress/urls': {
        get: getDFSPIngressEndpointsUrls,
        post: uploadDFSPIngressEndpointsUrls,
    } ,
    '/dfsp/endpoints/ingress/urls/{epId} ': {
        put: updateDFSPIngressEndpointsUrlById,
        delete: deleteDFSPIngressEndpointsUrlById,
    } ,
    '/hub/endpoints/ingress': {
        get: getHubIngressEndpoints,
    },
    '/hub/endpoints/egress': {
        get: getHubEgressEndpoints,
    },
    '/monetaryzones': {
        get: getMonetaryZones
    },
    '/monetaryzones/{monetaryZoneId}/dfsps': {
        get: getDfspsByMonetaryZones
    },
    '/dfsp/clientCerts': {
        get: getClientCertificate,
    },
    '/dfsp/clientCerts/csr': {
        post: createClientCSR,
    },
    '/dfsp/ca': {
        get: getDFSPCA,
        post: createDFSPCA,
        put: setDFSPCA,
    },
    '/hub/ca': {
        get: getHubCA,
    },
    '/dfsp/serverCerts': {
        get: getDFSPServerCertificates,
        post: generateServerCertificates,
    },
    '/hub/serverCerts': {
        get: getHubServerCertificates,
    },
    '/dfsp/alljwscerts': {
        get: getAllJWSCertificates,
    },
    '/dfsp/jwscerts': {
        get: getJWSCertificates,
        post: uploadJWSCertificates,
        put: updateJWSCertificates,
        delete: deleteJWSCertificates,
    },
    '/dfsp/allcerts': {
        post: generateAllCerts,
    },
    '/fxpConversions': {
        get: getFxpConversions,
    },
    '/fxpConversions/{conversionId}/details': {
        get: getFxpConversionDetails,
    },
    '/fxpConversionsStatusSummary': {
        get: getFxpConversionStatusSummary,
    },
    '/fxpErrors': {
        get: getFxpConversionErrors,
    },
    '/minuteSuccessfulFxpConversionsPerc': {
        get: getFxpConversionsSuccessRate,
    },
    '/minuteAverageFxpConversionsResponseTime': {
        get: getFxpConversionsAvgResponseTime,
    },

};

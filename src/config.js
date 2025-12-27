/**************************************************************************
*  (C) Copyright ModusBox Inc. 2020 - All rights reserved.               *
*                                                                        *
*  This file is made available under the terms of the license agreement  *
*  specified in the corresponding source code repository.                *
*                                                                        *
*  ORIGINAL AUTHOR:                                                      *
*       Yevhen Kyriukha - yevhen.kyriukha@modusbox.com                   *
**************************************************************************/

require('dotenv').config();
const env = require('env-var');

const rolePermissionMap = require('./rolePermissionMap.json');

module.exports = {
    inboundPort: env.get('LISTEN_PORT').default('3000').asPortNumber(),
    mockData: env.get('MOCK_DATA').default('false').asBool(),
    logIndent: env.get('LOG_INDENT').default('2').asIntPositive(),
    managementEndpoint: env.get('MANAGEMENT_ENDPOINT').asString(),
    metricsEndpoint: env.get('METRICS_ENDPOINT').asString(),
    dfspId: env.get('DFSP_ID').asString(),
    enableCors: env.get('ENABLE_CORS').default('false').asBool(),
    sanitizeTransferRawData: env.get('SANITIZE_TRANSFER_RAW_DATA').default('true').asBool(),
    cacheConfig: {
        redisUrl: env.get('CACHE_REDIS_URL').default('redis://redis/0').asString(),
        syncInterval: env.get('CACHE_SYNC_INTERVAL_SECONDS').default(30).asIntPositive(),
        syncBatchSize: env.get('CACHE_SYNC_BATCH_SIZE').default(100).asIntPositive(),
        maxInitialSyncKeys: env.get('CACHE_MAX_INITIAL_SYNC_KEYS').default(1000).asIntPositive(),
    },
    databaseConfig: {
        host: env.get('DATABASE_HOST').required().asString(),
        port: env.get('DATABASE_PORT').default(3306).asPortNumber(),
        user: env.get('DATABASE_USER').required().asString(),
        password: env.get('DATABASE_PASSWORD').required().asString(),
        database: env.get('DATABASE_NAME').required().asString(),
        connectionTimeout: env.get('DATABASE_CONNECTION_TIMEOUT').default(10000).asIntPositive(),
        acquireConnectionTimeout: env.get('DATABASE_ACQUIRE_TIMEOUT').default(10000).asIntPositive(),
        pool: {
            min: env.get('DATABASE_POOL_MIN').default(2).asIntPositive(),
            max: env.get('DATABASE_POOL_MAX').default(20).asIntPositive(),
            acquireTimeoutMillis: env.get('DATABASE_POOL_ACQUIRE_TIMEOUT').default(30000).asIntPositive(),
            idleTimeoutMillis: env.get('DATABASE_POOL_IDLE_TIMEOUT').default(30000).asIntPositive(),
            createTimeoutMillis: env.get('DATABASE_POOL_CREATE_TIMEOUT').default(30000).asIntPositive(),
        },
    },
    sessionConfig: {
        // sessionConfig is mostly identical to the koa session middleware config object as described here:
        // https://github.com/koajs/session
        sessionKeys: env.get('APP_KEYS').asString().split(','),
        key: env.get('SESSION_KEY').default('pm4ml').asString(), /** (string) cookie key (default is koa.sess) */
        /** (number || 'session') maxAge in ms (default is 1 days) */
        /** 'session' will result in a cookie that expires when session/browser is closed */
        /** Warning: If a session cookie is stolen, this cookie will never expire */
        maxAge: env.get('SESSION_MAX_AGE').default('86400000').asIntPositive(),
        autoCommit: env.get('SESSION_AUTO_COMMIT').default('true').asBool(), /** (boolean) automatically commit headers (default true) */
        overwrite: env.get('SESSION_OVERWRITE').default('true').asBool(), /** (boolean) can overwrite or not (default true) */
        httpOnly: env.get('SESSION_HTTP_ONLY').default('true').asBool(), /** (boolean) httpOnly or not (default true) */
        signed: env.get('SESSION_SIGNED').default('true').asBool(), /** (boolean) signed or not (default true) */
        rolling: env.get('SESSION_ROLLING').default('false').asBool(), /** (boolean) Force a session identifier cookie to be set on every response. The expiration is reset to the original maxAge, resetting the expiration countdown. (default is false) */
        renew: env.get('SESSION_RENEW').default('false').asBool(), /** (boolean) renew session when session is nearly expired, so we can always keep user logged in. (default is false)*/
        secure: env.get('SESSION_SECURE').default('true').asBool(), /** (boolean) secure cookie*/
        sameSite: env.get('SESSION_SAME_SITE').asString() || null, /** (string) session cookie sameSite options (default null, don't set it) */
        redisUrl: env.get('SESSION_REDIS_URL').default('redis://redis/2').asString(),
    },
    authConfig: {
        authDiscoveryEndpoint: env.get('AUTH_DISCOVERY_ENDPOINT').asString(),
        clientId: env.get('AUTH_CLIENT_ID').asString(),
        clientSecret: env.get('AUTH_CLIENT_SECRET').asString(),
        redirectUri: env.get('AUTH_REDIRECT_URI').asString(),
        scopes: env.get('AUTH_SCOPES').asString(),
        resourceName: env.get('AUTH_RESOURCE_NAME').asString(),
        loggedInLandingUrl: env.get('AUTH_LOGGED_IN_LANDING_URL').asString(),
        rolePermissionMap,
        enableAuthClient: env.get('ENABLE_AUTH_CLIENT').default('false').asBool(),
    }
};

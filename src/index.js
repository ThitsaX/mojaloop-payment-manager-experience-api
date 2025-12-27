const config = require('./config');
const Server = require('./server');
const { createMemoryCache } = require('./lib/cacheDatabase/');
const { Logger } = require('@mojaloop/sdk-standard-components');

if(require.main === module) {
    (async () => {
        const logger = new Logger.Logger( {
            context: {
                app: 'mojaloop-payment-manager-experience-api-service-control-server'
            },
            stringify: Logger.buildStringify({ space: 2 }),
        });

        const db = await createMemoryCache({
            cacheUrl : config.cacheConfig.redisUrl,
            syncInterval: config.cacheConfig.syncInterval,
            cacheConfig: config.cacheConfig,
            databaseConfig: config.databaseConfig,
            sanitizeTransferRawData: config.sanitizeTransferRawData,
            logger,
        });

        // this module is main i.e. we were started as a server;
        // not used in unit test or "require" scenarios
        const svr = new Server(config, db);

        // handle SIGTERM to exit gracefully
        process.on('SIGTERM', async () => {
            console.log('SIGTERM received. Shutting down APIs...');

            await svr.stop();
            process.exit(0);
        });

        await svr.setupApi();

        svr.start().catch(err => {
            console.log(err);
            process.exit(1);
        });
    })();
}

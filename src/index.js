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
            console.log('SIGTERM received. Shutting down gracefully...');

            try {
                //Stop accepting new requests
                await svr.stop();
                console.log('Server stopped accepting new requests');

                //Shutdown database and cache connections
                if (db.shutdown) {
                    await db.shutdown();
                }

                console.log('Shutdown complete');
                process.exit(0);
            } catch (err) {
                console.error('Error during shutdown:', err);
                process.exit(1);
            }
        });

        // handle SIGINT
        process.on('SIGINT', async () => {
            console.log('SIGINT received. Shutting down gracefully...');

            try {
                await svr.stop();
                if (db.shutdown) {
                    await db.shutdown();
                }
                console.log('Graceful shutdown complete');
                process.exit(0);
            } catch (err) {
                console.error('Error during graceful shutdown:', err);
                process.exit(1);
            }
        });

        await svr.setupApi();

        svr.start().catch(err => {
            console.log(err);
            process.exit(1);
        });
    })();
}

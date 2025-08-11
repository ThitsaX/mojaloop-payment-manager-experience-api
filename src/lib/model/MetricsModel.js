/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2020 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - james.bush@modusbox.com                             *
 **************************************************************************/

const { Requests } = require('@internal/requests');


class MetricsModel {
    constructor(props) {
        this._props = props;
        this._logger = props.logger;

        this._requests = new Requests({
            logger: props.logger,
            endpoint: props.metricsEndpoint,
        });
    }

    async query(opts) {
        // form a prometheus request from our incoming parameters
        if(!opts.metricName) {
            throw new Error('metricName must be supplied');
        }

        // default aggregate duration to 600 seconds
        if(!opts.aggregateDurationSeconds) {
            opts.aggregateDurationSeconds = 600;
        }

        // default resolution to 600 seconds
        if(!opts.resolutionSeconds) {
            opts.resolutionSeconds = 600;
        }

        // default overall range to 1 hour of data
        if(!opts.startTimestamp) {
            opts.startTimestamp = new Date();
            opts.startTimestamp.setHours(opts.startTimestamp.getHours() - 1);
            opts.startTimestamp = opts.startTimestamp.toISOString();
        }

        if(!opts.endTimestamp) {
            opts.endTimestamp = (new Date()).toISOString();
        }

        let query = `rate(${opts.metricName}[${opts.aggregateDurationSeconds}s])`;

        if(opts.metricType === 'HIST_SIZE') {
            query = `sum(rate(${opts.metricName}_sum[${opts.aggregateDurationSeconds}s])) `
                + `/ sum(rate(${opts.metricName}_count[${opts.aggregateDurationSeconds}s]))`;
        }

        const queryParams = {
            query: query,
            start: opts.startTimestamp,
            end: opts.endTimestamp,
            step: `${opts.resolutionSeconds}`
        };

        const result = await this._requests.get('api/v1/query_range', queryParams);

        this._logger.push(result).log('Prometheus query executed');

        if(result.status !== 'success') {
            //prometheus query failed for some reason
            return {
                error: {
                    errorType: result.errorType,
                    error: result.error,
                }
            };
        }

        let resultData = [];

        // check for an empty result set
        if(result.data.result.length > 0) {
            resultData = result.data.result[0].values.map(d => {
                return {
                    // multiply timestamp by 1000 as prometheus returns
                    // seconds with decimal places!?
                    timestamp: Number(d[0]) * 1000,
                    value: Number(d[1])
                };
            });
        }

        // now we project the result into our API spec return value
        // TODO: cope with multiple timeseries in result, e.g. multiple
        // instances of mojaloop-connector or core-connector etc...
        return {
            metricName: opts.metricName,
            startTimestamp: opts.startTimestamp,
            endTimestamp: opts.endTimestamp,
            data: resultData
        };
    }
}


module.exports = MetricsModel;

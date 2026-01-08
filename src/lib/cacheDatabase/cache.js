/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       James Bush - james.bush@modusbox.com                             *
 **************************************************************************/

const redis = require('redis');
const assert = require('assert');

/**
 * A shared cache abstraction over a REDIS distributed key/value store
 */

class Cache {
    // client;
    // url;
    // logger;

    constructor(opts) {
        this.client = null;
        this.url = opts.cacheUrl;
        this.logger = opts.logger;
    }

    /**
   * Connects to a redis server and waits for ready events
   * Note: We create two connections. One for get, set and publish commands
   * and another for subscribe commands. We do this as we are not supposed
   * to issue any non-pub/sub related commands on a connection used for sub
   * See: https://redis.io/topics/pubsub
   */
    async connect() {
        if (this.client) {
            throw new Error('already connected');
        }
        this.client = await this._getClient();
    }

    async disconnect() {
        if (!this.client) {
            return;
        }
        await this.client.quit();
    }

    /**
   * Returns a new redis client
   *
   * @returns {object} - a connected REDIS client
   * */
    async _getClient() {
        const client = redis.createClient({ url: this.url });
        client.on('error', (err) => {
            this.logger
                .push({ err })
                .log('Error from REDIS client getting subscriber');
        });

        client.on('ready', () => {
            this.logger.log(`Connected to REDIS at: ${this.url}`);
        });
        await client.connect();
        return client;
    }

    /**
   * Sets a value in the cache
   *
   * @param key {string} - cache key
   * @param value {string} - cache value
   */
    async set(key, value) {
        assert(this.client);
        //if we are given an object, turn it into a string
        if (typeof value !== 'string') {
            value = JSON.stringify(value);
            console.log(`in cache set: ${value}`);
        }

        await this.client.set(key, value);
    }

    /**
   * Gets a value from the cache
   *
   * @param key {string} - cache key
   */
    async get(key) {
        assert(this.client);
        return this.client.get(key);
    }

    /**
   * Delete a key
   *
   * @param {string} key
   */
    async del(key) {
        assert(this.client);
        return this.client.del(key);
    }

    /**
   * Gets keys from the cache based on the pattern
   *
   * @param pattern {string} - keys pattern
   */
    async keys(pattern) {
        assert(this.client);
        return this.client.keys(pattern);
    }

    /**
   * Scans keys from the cache using cursor-based iteration
   * This is more memory-efficient than keys() for large datasets
   *
   * @param cursor {string} - cursor position (use '0' to start)
   * @param pattern {string} - MATCH pattern (e.g., 'transferModel_*')
   * @param count {number} - Number of keys to return per iteration
   * @returns {Promise<[string, string[]]>} - [nextCursor, keys] tuple
   *   - nextCursor: '0' means iteration complete, other values for resuming
   *   - keys: array of matching keys found in this iteration
   */
    async scan(cursor, pattern, count = 100) {
        assert(this.client);

        // Convert cursor to number (Redis client expects numeric cursor)
        // Database stores cursor as VARCHAR
        const numericCursor = typeof cursor === 'string' ? parseInt(cursor, 10) : cursor;

        // Redis SCAN command with MATCH and COUNT options
        const result = await this.client.scan(numericCursor, {
            MATCH: pattern,
            COUNT: count
        });

        // result.cursor is the next cursor position
        // result.keys is the array of keys found
        return [result.cursor.toString(), result.keys];
    }
}

module.exports = Cache;

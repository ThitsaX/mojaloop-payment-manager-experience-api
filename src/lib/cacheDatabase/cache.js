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
        return this.scan(pattern);
    }

    async scan(pattern, count = 1000) {
      assert(this.client)

      let cursor = 0;
      const results = [];

      do {
        const res = await this.client.scan(cursor, { MATCH: pattern, COUNT: count});
        cursor = Number(res.cursor);
        if (res.keys && res.keys.length) results.push(...res.keys);
      } while (cursor != 0);
      return results;
    }

    /**
    * Async iterator over keys using SCAN (non-blocking)
    *
    */
    async *scanIterator(pattern, count = 1000) {
      assert(this.client)
      for await (const key of this.client.scanIterator({ MATCH: pattern, COUNT: count})) {
        yield key;
      }
    }
}

module.exports = Cache;

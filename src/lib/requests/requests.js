/**************************************************************************
 *  (C) Copyright ModusBox Inc. 2019 - All rights reserved.               *
 *                                                                        *
 *  This file is made available under the terms of the license agreement  *
 *  specified in the corresponding source code repository.                *
 *                                                                        *
 *  ORIGINAL AUTHOR:                                                      *
 *       Murthy Kakarlamudi - murthy@modusbox.com                             *
 **************************************************************************/

const http = require('http');
const { request } = require('@mojaloop/sdk-standard-components');
const { buildUrl, throwOrJson, HTTPResponseError } = require('./common');


/**
 * A class for making requests to DFSP backend API
 */

const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

class Requests {
  // ...

  get(url, qs = {}) {
    Object.entries(qs).forEach(([k, v]) => {
      if (v === undefined) {
        delete qs[k];
      }
    });
    const reqOpts = {
      method: 'GET',
      uri: buildUrl(this.endpoint, url),
      headers: this._buildHeaders(),
      qs,
    };

    this.logger.push({ reqOpts }).log('Executing HTTP GET');
    return limiter(reqOpts, async (req, res) => {
      return request({...reqOpts, agent: this.agent})
        .then(throwOrJson)
        .catch(e => {
          this.logger.push({ e }).log('Error attempting HTTP GET');
          throw e;
        });
    });
  }

  delete(url) {
    const reqOpts = {
      method: 'DELETE',
      uri: buildUrl(this.endpoint, url),
      headers: this._buildHeaders(),
    };

    this.logger.push({ reqOpts }).log('Executing HTTP DELETE');
    return limiter(reqOpts, async (req, res) => {
      return request({...reqOpts, agent: this.agent})
        .then(throwOrJson)
        .catch(e => {
          this.logger.push({ e }).log('Error attempting HTTP DELETE');
          throw e;
        });
    });
  }

  put(url, body) {
    const reqOpts = {
      method: 'PUT',
      uri: buildUrl(this.endpoint, url),
      headers: this._buildHeaders(),
      body: JSON.stringify(body),
    };

    this.logger.push({ reqOpts }).log('Executing HTTP PUT');
    return limiter(reqOpts, async (req, res) => {
      return request({...reqOpts, agent: this.agent})
        .then(throwOrJson)
        .catch(e => {
          this.logger.push({ e }).log('Error attempting HTTP PUT');
          throw e;
        });
    });
  }

  post(url, body) {
    const reqOpts = {
      method: 'POST',
      uri: buildUrl(this.endpoint, url),
      headers: this._buildHeaders(),
      body: JSON.stringify(body),
    };

    this.logger.push({ reqOpts }).log('Executing HTTP POST');
    return limiter(reqOpts, async (req, res) => {
      return request({...reqOpts, agent: this.agent})
        .then(throwOrJson)
        .catch(e => {
          this.logger.push({ e }).log('Error attempting POST.');
          throw e;
        });
    });
  }
}

module.exports = {
    Requests,
    HTTPResponseError,
};

const { IncomingMessage } = require('http');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const zlib = require('zlib');
const { Stream, pipeline } = require('stream');
const statuses = require('statuses');
const requested = require('./executor/requested');
const responsed = require('./executor/responsed');
const { readFromLocalAsync } = require('./utils');
const log = require('../log');
const { BASE_DIR } = require('../config');

const UNIQUE_ID = Symbol('unique-id');
const REQUEST_BODY = Symbol('request-body');
const RESPONSE_BODY = Symbol('response-body');
const HAS_READ_BODY = Symbol('has-read-body');
const REQ_URL = Symbol('req-url');
const STATUS = Symbol('status');


class Context{
  constructor(protocol, req, res, proxy) {
    const headers = req.headers;
    const path = headers.path || url.parse(req.url || '').path;

    this[UNIQUE_ID] = crypto.randomBytes(16).toString('hex');  // 唯一 id
    this[HAS_READ_BODY] = false;  // 是否对真实响应做读取, 默认 false
    this[REQUEST_BODY] = null;
    this[RESPONSE_BODY] = null;

    /**
     * proxy 对象
     */
    this.proxy = proxy;

    /**
     * 自己封装的 request 实体
     *  - headers {Object} 请求头, default: clientRequest.headers
     *  - body {any} 请求体
     *  - options {Object} 详细的请求参数
     *  - clientRequest {original node req} 本地客户端真实的请求实体
     *  - req {original node req} 代理服务的请求实体
     *  - rate {Number} 节流参数
     *  - time {Number} 当前请求时间
     */
    this.request = { headers: {...headers}, body: null, rate: null };

    Object.defineProperty(this.request, 'req', {
      configurable: false,
      enumerable: true,
      value: req,
      writable: false
    });

    Object.defineProperty(this.request, 'time', {
      configurable: false,
      enumerable: true,
      value: Date.now(),
      writable: false
    });

    Object.defineProperty(this.request, 'options', {
      configurable: false,
      enumerable: true,
      value: {
        protocol,
        hostname: headers.host.split(':')[0],
        port: +headers.host.split(':')[1] || (protocol === 'http:' ? 80 : 443),
        path: path,
        method: req.method,
        headers: this.request.headers,
        auth: req.auth
      },
      writable: false
    });

    Object.defineProperty(this.request, 'clientRequest', {
      configurable: false,
      enumerable: true,
      value: req,
      writable: false
    });
    
    /**
     * 自己封装的 response 实体, 挂载了:
     *  - headers {Object} 响应头
     *  - body {any} 响应体
     *  - remoteResponse {original node res} 真实服务的响应实体
     *  - res {original node res} 代理响应实体
     *  - rate {Number} 节流参数
     *  - time {Number} 当前响应时间
     */
    this.response = { headers: {}, body: null, rate: null, remoteResponse: null };

    Object.defineProperty(this.response, 'res', {
      configurable: false,
      enumerable: true,
      value: res,
      writable: false
    });

    /**
     * 客户端真实的请求的 url
     */
    Object.defineProperty(this, 'originalUrl', {
      configurable: false,
      enumerable: true,
      value: `${this.protocol}//${this.clientRequest.headers.host}${path}`,
      writable: false
    });

    /**
     * proxy 发起请求的 url
     */
    this[REQ_URL] = `${this.protocol}//${this.request.options.headers.host}${this.path}`;

    /**
     * 当前 context 状态
     *   0 acceptRequest  接收客户端请求
     *   1 acceptEnd  接收结束
     *   2 doRequest  像真实服务发起请求
     *   3 requestEnd  发起请求结束
     *   4 doResponse  响应客户端
     *   5 responseEnd  响应结束
     *   
     */
    this[STATUS] = 0;

    /**
     * 记录一些关键时间
     */
    Object.defineProperty(this, 'timing', {
      configurable: false,
      enumerable: true,
      value: {
        init: Date.now(), // context 初始化的时间
        request: null,  // 请求动作开始时间
        requestEnd: null,  // 请求动作结束时间
        response: null,  // 响应动作开始时间
        responseEnd: null,  // 响应动作结束时间
        redirect: null,  // 请求转发动作开始时间
        redirectEnd: null,  // 请求转发动作结束时间
        sslConnect: null,  // https 握手开始时间
        sslConnectEnd: null,  // https 握手结束时间
        domainLookup: null,  // 域名解析时间
        domainLookupEnd: null,  // 域名解析完成时间
      },
      writable: false
    });
  }

  /**
   * 设置时间
   * @param {String} key
   * @param {Number} value
   * @return {Number}
   */
  setTime(key, value) {
    const val = value || Date.now();

    Object.defineProperty(this.timing, key, {
      configurable: false,
      enumerable: true,
      value: val,
      writable: false
    });

    return val;
  }

  /**
   * 设置属性
   * @param {String} field
   * @param {String} value
   * @api public
   */
  set(field, value) {
    if (value === undefined || (typeof field !== 'string' && field.constructor !== Symbol)) return;

    const validFields = [
      UNIQUE_ID, REQUEST_BODY, RESPONSE_BODY, HAS_READ_BODY, STATUS,
      'method', 'protocol', 'host',
      'path', 'hash', 'body',
      'proxy', 'clientRequest', 'remoteResponse',
      'request', 'response', 'url'
    ];

    if (validFields.includes(field)) {
      this[field] = value;
    } else {
      this.setHeader(field, value);
    }
  }

  get(field) {
    const headers = this.remoteResponse ? this.response.headers : this.request.headers;

    return this[field] || headers[field];
  }

  /**
   * 设置 context 状态
   * @param value {Number}
   * @api private
   */
  set status(value) {
    this[STATUS] = value;
  }

  get status() {
    return this[STATUS];
  }

  /**
   * 设置请求路径
   * @param value {String}
   * @api public
   */
  set url(value) {
    this[REQ_URL] = value;
  }

  get url() {
    return `${this.protocol}//${this.request.options.headers.host}${this.path}`;
  }

  /**
   * 设置请求方法
   * @param {String} value
   * @return {String} value
   * @api public
   */
  set method(value = '') {
    if (this.remoteResponse) return;

    const methodEnum = {
      get: 'GET',  // 请求一个指定资源的表示形式. 使用GET的请求应该只被用于获取数据
      head: 'HEAD',  // 请求一个与GET请求的响应相同的响应，但没有响应体
      post: 'POST',  // 用于将实体提交到指定的资源，通常导致在服务器上的状态变化或副作用
      put: 'PUT',  // 用于请求有效载荷替换目标资源的所有当前表示
      delete: 'DELETE',  // 删除指定的资源
      connect: 'CONNECT',  // 建立一个到由目标资源标识的服务器的隧道
      options: 'OPTIONS',  // 用于描述目标资源的通信选项
      trace: 'TRACE',  // 沿着到目标资源的路径执行一个消息环回测试
      patch: 'PATCH'  // 用于对资源应用部分修改
    };

    this.request.options.method = methodEnum[value.toLowerCase()] || 'GET';
  }

  get method() {
    return this.request.options.method;
  }

  /**
   * 协议头设置
   * @param {String} value
   * @return {String} value
   * @api public
   */
  set protocol(value = '') {
    if (this.remoteResponse) return;

    const protocolEnum = {
      'http:': 'http:',
      http: 'http:',
      https: 'https:',
      'https:': 'https:'
    };

    this.request.options.protocol = protocolEnum[value.toLowerCase()] || 'http:';
  }

  get protocol() {
    return this.request.options.protocol;
  }

  /**
   * 设置 host
   * @param {String} value
   * @return {String} value
   * @api public
   */
  set host(value) {
    if (this.remoteResponse) return;

    const { protocol } = this.request.options;

    this.request.options.headers.host = value;
    this.request.options.host =value;
    this.request.options.hostname = value.split(':')[0];
    this.request.options.port = +value.split(':')[1] || (protocol === 'http:' ? 80 : 443);
  }

  get host() {
    return this.request.headers.host;
  }

  set hostname(value) {
    const { host, protocol } = this.request.options;

    this.request.options.host = hostname + host.split(':')[1] || (protocol === 'http:' ? 80 : 443);
    this.request.options.hostname = value;
  }

  get hostname() {
    return this.request.options.hostname;
  }

  get port() {
    return  this.request.options.port;
  }

  set port(value) {
    const { hostname } = this.request.options;

    value = parseInt(value, 10);

    if (isNaN(value)) throw new TypeError('port must be a nubmer');

    this.request.options.host = hostname + value;
    this.request.options.port = value;
  }

  /**
   * 请求路径设置
   * @param {String}
   * @return {String} value
   * @api public
   */
  set path(value) {
    if (this.remoteResponse) return;

    value = value.toString();
    value = /^\//.test(value) ? value : '/' + value;

    this.request.options.path = value;
  }

  get path() {
    return this.request.options.path;
  }

  /**
   * 设置 headers
   * @param {Object} value
   * @return {Object} value
   * @api public
   */
  set headers(value) {
    this.setHeaders(value);
  }

  get headers() {
    return this.remoteResponse ? this.response.headers : this.request.headers;
  }

  /**
   * 设置 body
   * @param {String|Buffer|Stream|Object|Array} value
   * @return {String|Buffer|Stream|Object|Array} value
   * @api public
   */
  set body(value) {
    return this.setBody(value);
  }

  get body() {
    return this.remoteResponse ? this[RESPONSE_BODY] : this[REQUEST_BODY];
  }

  /**
   * 设置响应状态码
   * @returns {Number} statusCode
   * @param {Number}
   * @return {Number}
   * @api public
   */
  set statusCode(value) {
    this.setStatusCode(value);
  }

  get statusCode() {
    return this.response.statusCode;
  }

  /**
   * 设置 remoteResponse
   * @param {IncomingMessage} value
   * @return {IncomingMessage} value
   * @api public
   */
  set remoteResponse(value) {
    this.setRemoteResponse(value);
  }

  get remoteResponse() {
    return this.response.remoteResponse;
  }

  /**
   * 设置 clientRequest
   * @param {IncomingMessage}
   * @return {IncomingMessage}
   * @api public
   */
  set clientRequest(value) {
    if (value !== null && value.constructor !== IncomingMessage) throw(new TypeError('clientRequest: expect `http.IncomingMessage`'));
    
    this.request.clientRequest = value;
  }

  get clientRequest() {
    return this.request.clientRequest;
  }

  /**
   * 挂载真实响应到 context
   * @param {original node res} value
   * @return {original node re} value
   * @api public
   */
  setRemoteResponse(value) {
    if (value !== null && value.constructor !== IncomingMessage) throw(new TypeError('remoteResponse: expect `http.IncomingMessage`'));

    this.response.headers = {...value.headers};
    this.response.statusCode = value.statusCode;

    Object.defineProperty(this.response, 'time', {  // TODO 废弃
      configurable: false,
      enumerable: true,
      value: Date.now(),
      writable: false
    });

    Object.defineProperty(this.response, 'remoteResponse', {
      configurable: false,
      enumerable: true,
      value,
      writable: false
    });
  }

  /**
   * 设置头部 （请求头 or 响应头）
   * @param {String} name
   * @param {String} value
   * @return {Object} headers
   * @api public
   */
  setHeader(name, value) {
    name = name.toLowerCase();
    value = value.toString();

    if(this.remoteResponse) {
      this.response.headers[name] = value;
    } else {
      this.request.headers[name] = value;
    }
  }

  /**
   * 设置 headers
   * @param {Object} value
   * @param {Boolean} discardOriginal 是否覆盖原本的
   * @return {Object} value
   * @api public
   */
  setHeaders(value, discardOriginal) {
    const headers = this.remoteResponse ? this.response.headers : this.request.headers;

    if (Object.prototype.toString.call(value) !== '[object Object]') return headers;

    if (this.remoteResponse) {
      this.response.headers = discardOriginal ? value : {...this.response.headers, ...value};
    } else {
      this.request.headers = discardOriginal ? value : {...this.response.headers, ...value};
    }
  }

  setBody(value) {
    return this.remoteResponse ? this.setResponseBody(value) : this.setRequestBody(value);
  }

  setStatusCode(value) {
    value = parseInt(value, 10);
    this.response.statusCode = isNaN(value) ? 200 : value;
  }

  /**
   * 设置响应体
   * 
   * @param {String|Buffer|Object|Stream} value
   * @return {String|Buffer|Object|Stream} body
   * @api public
   */
  setResponseBody(value) {
    const isBuffer = Buffer.isBuffer(value);
    const type = this.getHeader('content-type');

    if (value === null) {
      if (statuses.empty[this.statusCode]) this.statusCode = 204;

      this.removeHeader('content-type');
      this.removeHeader('content-length');
      this.removeHeader('transfer-encoding');
    } else if (value instanceof Stream) {
      this.removeHeader('content-length');
      !type && this.setHeader('content-type', 'application/octet-stream');
    } else if (typeof value === 'string' || isBuffer) {
      this.setHeader('content-length', Buffer.byteLength(value));
      !type && this.setHeader('content-type', isBuffer ? 'application/octet-stream' : 'text/plain');
    } else {
      value = JSON.stringify(value);
      this.setHeader('content-length', Buffer.byteLength(value));
      this.setHeader('content-type', 'application/json');
    }

    // 是否需要压缩
    const contentEncoding = this.getHeader('content-encoding');
    const fnName = ({
      deflate: 'createDeflate',
      gzip: 'createGzip',
      br: 'createBrotliCompress'
    })[contentEncoding];

    if (fnName) {
      const input = zlib[fnName]();  // 双工 stream

      input.write(value);
      input.end('');

      this[RESPONSE_BODY] = input;
    } else {
      this[RESPONSE_BODY] = value;
    }

  }

  /**
   * 设置请求体
   * 
   * @param {String|Buffer|Object|Stream} value
   * @return {String|Buffer|Object|Stream} body
   * @api public
   */
  setRequestBody(value) {
    this[REQUEST_BODY] = value;
  }

  /**
   * context 唯一 id
   * @return {String}
   * @api public
   */
  get id() {
    return this[UNIQUE_ID];
  }

  /**
   * 获取 proxy req
   * @api public
   */
  get req() {
    return this.request.req;
  }


  /**
   * 获取 proxy res
   * @api public
   */
  get res() {
    return this.response.res;
  }

  /**
   * 获取当前动作时间
   * @api public
   */
  get time() {
    return this.remoteResponse ? this.response.time : this.request.time;
  }

  /**
   * 获取当前 body 是否已被读取
   * @return {Boolean}
   * @api public
   */
  get hasReadBody() {
    return this[HAS_READ_BODY];
  }

  /**
   * 获取响应体
   * @return {Promise}
   * @api public
   */
  getBody() {
    return this.remoteResponse ? this.getResBody() : this.getReqBody();
  }

  /**
   * 获取请求体
   * @return {Promise}
   * @api public
   */
  getReqBody() {
    this[HAS_READ_BODY] = true;
    return new Promise((resolve, reject) => {
      const body = this.body;

      if (body) return resolve(body);

      const data = [];
      const incomingMessage = this.clientRequest;

      incomingMessage.on('data', (chunk) => {
        data.push(chunk);
      });

      incomingMessage.on('end', () => {
        this.body = Buffer.concat(data);
        resolve(this.body);
        this[HAS_READ_BODY] = false;

        // 利用 setTimeout 确保 requested 处于当前调用栈之后
        setTimeout(() => requested(this));
      });

      incomingMessage.on('error', reject);
    });
  }

  /**
   * 获取响应体
   * @return {Promise}
   * @api public
   */
  getResBody() {
    this[HAS_READ_BODY] = true;
    return new Promise((resolve, reject) => {
      const body = this.body;

      if (body) return resolve(body);

      const incomingMessage = this.remoteResponse;
      const unpackpath = `${BASE_DIR}/tmp/${this.id}/res_body_unpack`;
      const output = fs.createWriteStream(unpackpath);
      const callback = (err) => {
        if (err) {
          reject(err);
          log('error', err);
          return;
        }

        fs.readFile(unpackpath, (err, buffer) => {
          if (err) return reject(err);

          this.body = buffer;
          resolve(buffer);
          this[HAS_READ_BODY] = false;

          // 利用 setTimeout 确保 responsed 处于当前调用栈之后
          setTimeout(() => responsed(this));
        });

      };


      switch (this.getHeader('content-encoding')) {
        case 'br':
          pipeline(incomingMessage, zlib.createBrotliDecompress(), output, callback);
          break;
        case 'gzip':
          pipeline(incomingMessage, zlib.createGunzip(), output, callback);
          break;
        case 'deflate':
          pipeline(incomingMessage, zlib.createInflate(), output, callback);
          break;
        default:
          pipeline(incomingMessage, output, callback);
          break;
      }

    });
  }

  /**
   * 读取 body
   * @return {Stream}
   * @api public
   */
  readBody() {
    return readFromLocalAsync(this.id, this.remoteResponse ? 'res_body' : 'req_body');
  }

  /**
   * 获取本地的请求数据
   */
  getLocalReqBodyData() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const stream = readFromLocalAsync(this.id, 'req_body');
        const data = [];

        if (!stream) return '';

        stream.on('data', (chunk) => {
          data.push(chunk);
        });

        stream.on('end', () => {
          resolve(Buffer.concat(data));
        });
      }, 100);
    });
  }

  /**
   * 节流控制
   * @param {Object} options
   * @api public
   */
  throttling({ upload, download }) {
    if (download) {
      this.response.rate = download;
    }
    
    if (upload) {
      this.request.rate = upload;
    }

    return this;
  }

  /**
   * 获取头部
   * @param {String} field
   * @return String
   * @api public
   */
  getHeader(field) {
    field = field.toLowerCase();

    if(this.remoteResponse) {
      return this.response.headers[field];
    } else {
      return this.request.headers[field];
    }
  }

  /**
   * 移除头部
   * @param {String} field
   * @return Boolean
   * @api public
   */
  removeHeader(field) {
    field = field.toLowerCase();

    if(this.remoteResponse) {
      delete this.response.headers[field];
    } else {
      delete this.request.headers[field];
    }
  }
}

module.exports = Context;


// MIME Types
// https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Complete_list_of_MIME_types

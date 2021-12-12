const zlib = require('zlib');
const http = require('http');
const https = require('https');
const http2 = require('http2');
const { Stream } = require('stream');
const responsed = require('../executor/responsed');
const transformStream = require('../modules/transform-stream');

/**
 * 请求远程真实服务
 * @param {Context} context
 */
module.exports = function remoteRequest(context) {
  const { proxy, clientRequest } = context;
  const proxyResponse = context.response.res;
  const reqOptions = context.request.options;
  const acceptEncoding = context.getHeader('accept-encoding');

  // createBrotliDecompress Added in: v11.7.0, v10.16.0
  if (acceptEncoding && !zlib.createBrotliDecompress) {
    const arr = acceptEncoding.split(',').filter(v => /br/g.test(v));

    context.setHeader('accept-encoding', arr.join(','));
  }

  // 移除代理痕迹 referer
  if (/http:\/\/127\.0\.0\.1/.test(reqOptions.headers['referer'])) {
    context.removeHeader('referer');
  }

  // body 被修改时 要重新计算 content-length
  const reqBody = context.body;

  if (reqBody) {
    if (typeof reqBody === 'string' || Buffer.isBuffer(reqBody)) {
      context.setHeader('content-length', Buffer.byteLength(reqBody));
      return foo();
    }

    if (reqBody instanceof Stream) {
      const data = [];

      reqBody.on('data', (chunk) => {
        data.push(chunk);
      });

      reqBody.on('end', () => {
        context.setHeader('content-length', Buffer.concat(data).length);
        foo();
      });

      return;
    }

    if (typeof reqBody === 'object') {
      context.setHeader('content-length', Buffer.byteLength(JSON.stringify(reqBody)));
      return foo();
    }
  }

  foo();

  function foo() {
    const client = reqOptions.protocol === 'http:' ? http : https;

    const agent = client.request({ ...reqOptions, agent: new client.Agent({ keepAlive: true }) }, async(remoteResponse) => {
      context.setRemoteResponse(remoteResponse);
      await proxy.emit('_useResponseRules', context);
      await proxy.emit('response', context);
      !context.hasReadBody && responsed(context);
    });

    const body = transformStream(context.body || clientRequest);

    proxy.emit('_saveReqData', context);

    body.pipe(agent);

    body.on('end', () => {
      proxy.emit('requestEnd', context);
    });

    agent.on('error', (e) => {
      e.requestInfo = reqOptions;
      proxy.emit('error', e, context);
      proxyResponse.writeHead(502, 'Proxy fetch failed');
    });

    proxyResponse.on('close', () => agent.abort());
  }
}

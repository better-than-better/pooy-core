const transformStream = require('../modules/transform-stream');
const log = require('../../log');

module.exports = function responsed(context) {
  const { res, statusCode, headers, rate } = context.response;
  const { remoteResponse, proxy } = context;

  if (proxy.isPaused) return proxy.pausedResponse.push(context);

  try {
    const h = {};

    Object.keys(headers).forEach(key => {
      h[key.trim()] = headers[key];
    });

    res.writeHead(statusCode, h);
  } catch(err) {
    log('error', err, JSON.stringify(context.request.options));
    console.log(statusCode, headers, context.request.options);
  }

  proxy.emit('_saveResData', context);
  const body = transformStream(context.body || remoteResponse, rate);

  body.pipe(res);
  body.on('end', () => proxy.emit('responseEnd', context));
}
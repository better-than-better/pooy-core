const Context = require('../context');
const requested = require('../executor/requested');
const fakeServer = require('./fake-server');
const remoteConnect = require('./remote-connect');

/**
* request 处理
* @param {Proxy} proxy 
* @param {original node req} req 
* @param {original node res} res 
*/
async function requestHandler(proxy, protocol = 'http:', req, res) {
  if (proxy.isIgnoreHost(req.headers.host)) return proxy.requestDirect(protocol, req, res);

  const ctx = new Context(protocol, req, res, proxy);

  await proxy.emit('_useRequestRules', ctx);
  await proxy.emit('request', ctx);
  !ctx.hasReadBody && requested(ctx);
};

/**
 * connect 处理转发 https 流量
 * @param {Proxy} proxy 
 */
function connectHandler(proxy) {
  fakeServer.on('request', requestHandler.bind(null, proxy, 'https:'));
  fakeServer.listen(0);

  const port = fakeServer.address().port;

  return function(req, socket) {
    const requestOptions = {
      host: req.url.split(':')[0],
      port: req.url.split(':')[1] || 443
    };

    if (!proxy.direct) {
      requestOptions.port = port;
      requestOptions.host = '127.0.0.1';
    }

    remoteConnect(requestOptions, socket);
  }
};

module.exports = {
  connectHandler,
  requestHandler
};

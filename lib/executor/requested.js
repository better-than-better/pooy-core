const fs = require('fs');
const dns = require('dns');
const remoteRequest = require('../modules/remote-request');
const { getIps } = require('../utils');
const { BASE_DIR } = require('../../config');

module.exports = function requested(context) {
  const { proxy, protocol = 'http:', hostname, path, port, clientRequest, res } = context;

  if (proxy.isPaused) return proxy.pausedRequest.push(context);

  dns.lookup(hostname, (err, address, family) => {
    if (err) return proxy.emit('error', err, context);

    const isLocalAddress = ['127.0.0.1', '0.0.0.0', getIps()[`IPv${family}`]].includes(address);

    if (isLocalAddress && port === proxy.port) {
      if (path === '/ssl') {
        res.setHeader('content-type', 'application/octet-stream');
        res.setHeader('content-disposition', `attachment; filename=POOY_rootCA.crt`);
        fs.createReadStream(BASE_DIR + '/POOY_rootCA.crt').pipe(res);
      } else {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.write('🤡 hello, proxy server', 'utf-8');
        res.end();
      }

      return;
    }

    if (proxy.direct) return proxy.requestDirect(protocol, clientRequest, res);

    remoteRequest(context);
  });
}
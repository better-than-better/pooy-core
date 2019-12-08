const https = require('https');
const tls = require('tls');
const { getSelfSignCert } = require('../utils');

const SNICallback = async function (servername, callback) {
  const timeField = `🐞 DEBUG # 自签证书耗时 -> ${servername}`;
  process.env.DEBUG && console.time(timeField);

  const selfSignCert = await getSelfSignCert(servername);

  process.env.DEBUG && console.timeEnd(timeField);


  callback(null, tls.createSecureContext({
    key: selfSignCert.privateKey,
    cert: selfSignCert.certificate
  }));
};

const fakeServer = https.createServer({ SNICallback });

module.exports = fakeServer;
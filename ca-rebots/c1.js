const { parentPort } = require('worker_threads');
const createFromRootCA = require('../ca-helper/create-from-root-ca');

parentPort.on('message', ({ domain, RSABits }) => {
  const pem = createFromRootCA(domain, RSABits);

  parentPort.postMessage(pem);
});

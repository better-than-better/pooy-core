const createFromRootCA = require('../ca-helper/create-from-root-ca');

process.title = 'pooy-core-child';

process.on('message', ({ domain, RSABits }) => {
  const pem = createFromRootCA(domain, RSABits);

  process.send(pem);
  process.exit(1);
});

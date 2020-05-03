const createFromRootCA = require('../ca-helper/create-from-root-ca');
const { TITLE } = require('../config');

process.title = TITLE + '-child';

process.on('message', ({ domain, RSABits }) => {
  const pem = createFromRootCA(domain, RSABits);

  process.send(pem);
});

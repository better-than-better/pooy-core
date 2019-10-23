const fs = require('fs');
const ora = require('ora');
const createRootCA = require('./create-root-ca');
const installCA = require('./install-ca');
const CA_PREFIX = 'POOY';
const pooyDir = `${process.env.HOME}/.pooy`;

module.exports = function caInit() {
  const spinner = ora('init root ca...').start();
  const existsPrivateKey = fs.existsSync('${pooyDir}/${CA_PREFIX}_private_key.pem');
  const existsPublicKey = fs.existsSync(`${pooyDir}/${CA_PREFIX}_key.pem`);
  const existsCert = fs.existsSync(`${pooyDir}/${CA_PREFIX}_rootCA.crt`);

  if (!existsPrivateKey || !existsPublicKey || !existsCert) {
    createRootCA();
  }

  installCA();
  spinner.stop();
};

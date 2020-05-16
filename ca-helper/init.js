const fs = require('fs');
const { execSync } = require('child_process');
const ora = require('ora');
const createRootCA = require('./create-root-ca');
const installCA = require('./install-ca');
const CA_PREFIX = 'POOY';
const { BASE_DIR, SSL_DIR } = require('../config');

module.exports = function caInit() {
  const spinner = ora('init root ca...').start();
  const existsPrivateKey = fs.existsSync(`${BASE_DIR}/${CA_PREFIX}_private_key.pem`);
  const existsPublicKey = fs.existsSync(`${BASE_DIR}/${CA_PREFIX}_key.pem`);
  const existsCert = fs.existsSync(`${BASE_DIR}/${CA_PREFIX}_rootCA.crt`);

  if (!existsPrivateKey || !existsPublicKey || !existsCert) {
    execSync(`rm -rf ${SSL_DIR} && mkdir ${SSL_DIR}`);
    createRootCA();
  }

  installCA();
  spinner.stop();
};

const fs = require('fs');

const BASE_DIR = `${process.env.HOME}/.pooy`;

const config = {
  BASE_DIR,
  LOG_DIR: `${BASE_DIR}/logs`,
  TMP_DIR: `${BASE_DIR}/tmp`,
  SSL_DIR: `${BASE_DIR}/ssl`,
  CA_PREFIX: 'POOY',
  ROOT_CA_NAME: 'pooy.proxy',
  TITLE: 'pooy-core'
};

Object.keys(config).forEach(key => {
  if (/_DIR$/.test(key) && !fs.existsSync(config[key])) {
    fs.mkdirSync(config[key]);
  }
});

module.exports = config;

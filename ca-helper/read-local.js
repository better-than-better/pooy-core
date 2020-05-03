const fs = require('fs');
const log  = require('../log');
const { BASE_DIR } = require('../config');

function readLocal(hostname) {
  return new Promise((resolve, reject) => {
    const fielpath = `${BASE_DIR}/ssl/${hostname}`;

    fs.readFile(fielpath, (err, str) => {
      if (err) {
        reject(err);
        log('error', err, `file path -> ${fielpath}`);
        return;
      }

      try {
        resolve(JSON.parse(str.toString()));
      } catch(err) {
        reject(err);
        log('error', err, `hostname -> ${hostname}`);
      }
    });
  });
}

module.exports = readLocal;
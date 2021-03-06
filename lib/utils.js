const os = require('os');
const fs = require('fs');
const multiparty = require('multiparty');
const { execSync } = require('child_process');
const { Stream } = require('stream');
const { TMP_DIR } = require('../config');

const CaRebots = require('../ca-rebots');

const caRebots = new CaRebots();

/**
 * 简单写下只适用 mac os
 */
exports.getIps = function () {
  let IPv4 = '';
  let IPv6 = '';

  if (os.type() !== 'Darwin') {
    return {}
  }

  const networkInterfaces = os.networkInterfaces().en0;

  networkInterfaces && networkInterfaces.forEach(({ family, address }) => {
    if (family === 'IPv4') {
      IPv4 = address;
    }

    if (family === 'IPv4') {
      IPv6 = address;
    }
  });

  return {
    IPv4,
    IPv6
  }
};

/**
 * 数据缓存到本地
 * @param {String} id
 * @param {Stream|Object} incoming
 * @param {String} filename
 */
exports.writeToLocalAsync = (id, incoming, filename) => {

  const fileDir = `${TMP_DIR}/${id}`;

  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir);
  }

  const filePath = `${fileDir}/${filename}`;

  if (incoming instanceof Stream) {
    const contentType = incoming.headers&& incoming.headers['content-type'];

    // 表单数据
    if (/multipart\/form-data/.test(contentType)) {
      const form = new multiparty.Form();
 
      form.parse(incoming, function(err, fields = {}, files = {}) {
        Object.keys(files).forEach(name => {
          const filesPath = `${fileDir}/files`;

          if (!fs.existsSync(filesPath)) {
            fs.mkdirSync(filesPath);
          }

          fields[name] = files[name].map((file, i) => {
            const fileId = (Math.random()).toString(36).slice(2);

            fs.copyFile(file.path, `${filesPath}/${fileId}`, () => {});
            return {
              id: fileId,
              size: file.size,
              originalFilename: file.originalFilename,
            }
          });
        });
        fs.writeFile(filePath, JSON.stringify(fields), () => {});
      });
    } else {
      const output = fs.createWriteStream(filePath);

      incoming.pipe(output);
    }

    return;
  }

  if (typeof incoming !== 'string') {
    incoming = JSON.stringify(incoming);
  }

  fs.writeFile(filePath, incoming, () => {});
};

/**
 * 读取本地数据
 * @param {String} id
 */
exports.readFromLocalAsync = (id, filename) => {
  const filePath = `${TMP_DIR}/${id}/${filename}`;

  if (!fs.existsSync(filePath)) {
    console.log('路径不存在', id, filename);
    return null;
  }

  return fs.createReadStream(filePath);
};

/**
 * 清空
 */
exports.resetTmpDir = () => {
  execSync(`rm -rf ${TMP_DIR} && mkdir ${TMP_DIR}`);
};

/**
 * 自签 ca
 */
exports.getSelfSignCert = async (hostname) => {
  return caRebots.createCa({ domain: hostname, RSABits: 2048 });
};

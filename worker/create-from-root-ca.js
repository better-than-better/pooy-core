const compareVersions = require('compare-versions');
const createFromRootCA = require('../ca-helper/create-from-root-ca');

function workerThreads() {
  const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

  if (isMainThread) {
    module.exports = function(domain, RSABits) {
      return new Promise((reslove, reject) => {
        const worker = new Worker(__filename, { workerData: { domain, RSABits } });

        worker.postMessage({ domain, RSABits });

        worker.on('message', (data) => {
          reslove(data);
          worker.terminate();
        });

        worker.on('error', (error) => {
          reject(error);
          worker.terminate();
        });

        worker.on('exit', (code) => {
          process.env.DEBUG && console.log('workder exit:', code, '-->', domain);
        });
      });
    };
  } else {
    const { domain, RSABits } = workerData;
    const pem = createFromRootCA(domain, RSABits);

    parentPort.postMessage(pem);
  }
}

function workerProcesses() {
  const { fork } = require('child_process');

  module.exports = function(domain, RSABits) {
    return new Promise((resolve, reject) => {
      const child = fork(`${__dirname}/child.js`);

      child.send({ domain, RSABits });

      child.on('message', (msg) => {
        resolve(msg);
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('exit', (code) => {
        process.env.DEBUG && console.log('workder exit:', code, '-->', domain);
      });
    });
  };
}

compareVersions(process.version.slice(1), '12') === -1 ? workerProcesses() : workerThreads();
const EventEmitter = require('events');
const { fork } = require('child_process');
const compareVersions = require('compare-versions');
const isSupportWorkder = compareVersions(process.version.slice(1), '10.5.0') >= 0;

class Rebot extends EventEmitter{
  constructor() {
    super();

    if (isSupportWorkder) {
      const { Worker } = require('worker_threads');

      this.workder = new Worker(`${__dirname}/c1.js`);
    } else {
      this.workder = fork(`${__dirname}/c2.js`);
    }

    this.workder.on('message', (data) => {
      this.emit('message', data);
    });

    this.workder.on('error', (err) => {
      this.emit('error', err);
    });

    this.workder.on('exit', (code) => {
      this.emit('exit', code);
    });
  }

  do({domain, RSABits}) {
    const data = { domain, RSABits };

    isSupportWorkder ? this.workder.postMessage(data) : this.workder.send(data);
  }

  disconnect() {
    isSupportWorkder ? this.workder.terminate() : this.workder.disconnect(0);
  }
};

module.exports = Rebot;

const os = require('os');
const fs = require('fs');
const readLocal = require('../ca-helper/read-local');

const { BASE_DIR } = require('../config');

const Rebot = require('./rebot');

class CaRebots {
  constructor(){
    const CPU_LENGTH = os.cpus().length;

    this.tasks = [];
    this.rebots = [];

    this.activePoolSize = 0;
    this.defaultPoolSize = CPU_LENGTH > 4 ? 4 : CPU_LENGTH;
    this.maxPoolSize = CPU_LENGTH > this.defaultPoolSize ? CPU_LENGTH + 1 : this.defaultPoolSize;

    this.initRebots();
  }

  /**
   * 初始化
   */
  initRebots() {
    for(let i = 0; i < this.defaultPoolSize; i ++) {
      this.createRebot();
    }
  }

  /**
   * 创建证书生成 rebot
   * @api private
   */
  createRebot() {
    const rebot = new Rebot();

    rebot.on('message', this.onMessage.bind(this, rebot));
    rebot.on('error', this.onError.bind(this, rebot));

    this.rebots.push(rebot);

    return rebot;
  }

  /**
   * 创建证书
   */
  createCa(opt) {
    if (!opt) return;

    function createNewCa() {
      return new Promise((resolve, reject) => {
        const activePoolSize = this.activePoolSize;
  
        let currRebot = null;
  
        currRebot = this.rebots[activePoolSize];
  
        // 无空闲常驻 rebot & 有能力再申请额外 rebot
        if (!currRebot && (activePoolSize < this.maxPoolSize)) {
          currRebot = this.createRebot();
        }
  
        // 存在可用线程直接分配任务
        if (currRebot) {
          this.activePoolSize++;
  
          currRebot.resolve = resolve;
          currRebot.reject = reject;
          currRebot.do(opt);
        } else {
          this.tasks.push(opt);
        }
      });
    }

    if (fs.existsSync(`${BASE_DIR}/ssl/${opt.domain}`)) {
      return readLocal(opt.domain).catch(() => {
        return createNewCa.call(this);
      });
    }

    return createNewCa.call(this);
  }

  /**
   * 检测机器人队列
   */
  checkout() {
    if (this.activePoolSize < this.defaultPoolSize) {
      const rebots = [];

      this.rebots.forEach((r, i) => {
        if (i < this.defaultPoolSize) {
          rebots.push(r);
        } else {
          r.disconnect();
        }
      });

      this.rebots = rebots;
    }
  }

  /**
   * 创建成功
   * @param {Rebot} rebot 
   * @param {Object} data 
   */
  onMessage(rebot, data) {
    rebot.resolve(data);
    this.activePoolSize--;
    this.checkout();
    this.createCa(this.tasks.shift());  // 任务完成后直接询问任务队列
  }

  /**
   * 创建出错
   * @param {Rebot} rebot 
   * @param {Error} err 
   */
  onError(rebot, err) {
    rebot.reject(err);
    this.activePoolSize = this.activePoolSize--;
    this.checkout();
  }
}

module.exports = CaRebots;

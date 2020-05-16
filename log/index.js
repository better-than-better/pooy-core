const fs = require('fs');
const { LOG_DIR } = require('../config');

/**
 * 简单处理下 错误日志
 * @param {String} type 错误类型
 * @param {Error} err 错误对象
 * @param {String} extra 补充说明
 */
module.exports = (type = 'warn', err, extra = '') => {
  process.env.DEBUG && console.log(err);

  const logfile = `${LOG_DIR}/${type}.log`;

  const date = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    const ms = now.getMilliseconds();
    const num = n => `0000000${n}`.slice(-2);

    return `[${year}-${num(month)}-${num(day)} ${num(h)}:${num(m)}:${s}:${ms}]`;
  };

  if (!fs.existsSync(logfile)) {
    fs.writeFileSync(logfile, '');
  }

  const arr = [
    date(),
    err.stack
  ];

  if (extra) {
    arr.push(`Extra info: ${extra}`)
  }

  fs.appendFile(logfile, arr.join('\n') + '\n\n', () => {});
};
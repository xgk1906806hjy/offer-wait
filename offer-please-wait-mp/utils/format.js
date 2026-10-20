const api = require('./api');

const HOUR = 3600 * 1000;

function fmtRemain(ms) {
  if (ms <= 0) return '已截止';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? d + ' 天 ' + rh + ' 小时' : d + ' 天';
  }
  return h + ' 小时 ' + m + ' 分';
}

/** 倒计时一律基于 api.now()，即服务端时间 */
function countdown(deadlineAt) {
  const left = deadlineAt - api.now();
  return {
    remain: fmtRemain(left),
    urgent: left > 0 && left < 6 * HOUR,
    over: left <= 0
  };
}

function dayOf(ts) {
  const d = new Date(ts);
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

module.exports = { fmtRemain, countdown, dayOf };

const { AppError, E } = require('./errors');

/** 字符串校验：去空格、限长、必填 */
function str(value, opt) {
  const o = opt || {};
  const name = o.name || '字段';
  let s = value === null || value === undefined ? '' : String(value);
  s = s.trim();
  if (o.required && !s) throw new AppError(E.BAD_PARAM, name + '不能为空');
  if (s.length < (o.min || 0)) throw new AppError(E.BAD_PARAM, name + '至少要 ' + (o.min || 0) + ' 个字');
  if (s.length > (o.max || 1000)) throw new AppError(E.BAD_PARAM, name + '最多 ' + (o.max || 1000) + ' 个字');
  return s;
}

function oneOf(value, list, name) {
  if (list.indexOf(value) < 0) {
    throw new AppError(E.BAD_PARAM, (name || '字段') + '取值不合法');
  }
  return value;
}

function int(value, opt) {
  const o = opt || {};
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AppError(E.BAD_PARAM, (o.name || '字段') + '必须是数字');
  if (o.min !== undefined && n < o.min) throw new AppError(E.BAD_PARAM, (o.name || '字段') + '太小');
  if (o.max !== undefined && n > o.max) throw new AppError(E.BAD_PARAM, (o.name || '字段') + '太大');
  return Math.floor(n);
}

const now = () => Date.now();

/**
 * 复合游标：把"时间 + id"压成一个字符串，分页只用一个 > 比较。
 * 云数据库和 MySQL 都能走索引，不用嵌套 or 条件。
 */
function sortKey(ts, id) {
  return String(ts).padStart(15, '0') + '_' + String(id).slice(-8);
}

/** 轻量指纹，用于 60 秒内重复提交检测，不做加密用途 */
function hash(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 只保留必要字段，防止把内部字段带到前端 */
function pick(obj, keys) {
  const out = {};
  keys.forEach(k => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

module.exports = { str, oneOf, int, now, sortKey, hash, pick };

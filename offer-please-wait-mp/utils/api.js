/**
 * 前端唯一的数据入口。
 *
 * 三种模式，按可用性自动降级：
 *   1) cloud —— 云函数（生产）
 *   2) http  —— 本地后端 dev/local-backend（开发时用，两个窗口能互相看见）
 *   3) local —— 内置演示数据（什么都没配时的兜底）
 *
 * 规则：
 *  - 页面只允许调这里，不允许出现 wx.cloud.database()；
 *  - 失败统一抛 ApiError，页面按 code 分支；
 *  - 倒计时一律用 api.now()（服务端时间），不信手机时钟；
 *  - 只有「云函数不存在 / 环境不存在 / 本地后端连不上」才降级，
 *    其他网络错误照常抛出，免得把线上故障伪装成正常。
 */
const mock = require('./mock-api');
const { ApiError } = require('./api-error');

// 本地后端地址。留空则不走这一层，直接从 cloud 掉到 local。
// 用法：node dev/local-backend/server.js，然后在开发者工具里勾上「不校验合法域名」。
const LOCAL_API = 'http://127.0.0.1:8898/api';

const FORCE_LOCAL = false;

const state = {
  mode: 'cloud',
  offset: 0,
  inited: false
};

function safeGet(key) {
  try {
    return wx.getStorageSync(key) || '';
  } catch (e) {
    return '';
  }
}

function isNotDeployed(err) {
  const msg = String((err && (err.errMsg || err.message)) || '').toLowerCase();
  return (
    msg.indexOf('function not found') >= 0 ||
    msg.indexOf('function_not_found') >= 0 ||
    msg.indexOf('environment not found') >= 0 ||
    msg.indexOf('env not found') >= 0 ||
    msg.indexOf('invalid env') >= 0 ||
    msg.indexOf('resourcenotfound') >= 0 ||
    msg.indexOf('-501000') >= 0 ||
    (msg.indexOf('cloud function') >= 0 && msg.indexOf('not exist') >= 0)
  );
}

function init() {
  if (state.inited) return state.mode;
  state.inited = true;

  // 调试开关：在 Storage 里写 __api_mode = cloud / http / local，可以强制指定
  const forced = safeGet('__api_mode');
  if (forced === 'cloud' || forced === 'http' || forced === 'local') {
    state.mode = forced;
    if (forced === 'cloud' && typeof wx !== 'undefined' && wx.cloud) {
      try {
        wx.cloud.init({ traceUser: true });
      } catch (e) {}
    }
    return state.mode;
  }

  if (FORCE_LOCAL) {
    state.mode = 'local';
    return state.mode;
  }

  if (typeof wx !== 'undefined' && wx.cloud) {
    try {
      // 不写死 env，用小程序默认环境
      wx.cloud.init({ traceUser: true });
      state.mode = 'cloud';
      return state.mode;
    } catch (e) {
      // 继续往下走
    }
  }

  state.mode = LOCAL_API ? 'http' : 'local';
  return state.mode;
}

/** 服务端时间。所有倒计时都基于它 */
function now() {
  return Date.now() + state.offset;
}

/* ---------------- 本地后端 ---------------- */

function httpPost(body) {
  const headers = { 'content-type': 'application/json' };
  const me = safeGet('__dev_user');
  if (me) headers['x-openid'] = me;

  if (typeof fetch === 'function') {
    return fetch(LOCAL_API, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(res => res.json());
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: LOCAL_API,
      method: 'POST',
      header: headers,
      data: body,
      success: res => resolve(res.data),
      fail: () => reject(new Error('local backend unreachable'))
    });
  });
}

function applyBody(body) {
  if (body.server_now) state.offset = body.server_now - Date.now();
  if (body.code !== 0) throw new ApiError(body.code, body.message, body.data);
  return body.data;
}

/* ---------------- 统一入口 ---------------- */

async function call(action, payload) {
  init();

  if (state.mode === 'local') {
    return mock.call(action, payload);
  }

  if (state.mode === 'http') {
    try {
      return applyBody(await httpPost({ action: action, payload: payload || {} }));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.warn('[api] 本地后端连不上，改用内置演示数据');
      state.mode = 'local';
      return mock.call(action, payload);
    }
  }

  let res;
  try {
    res = await wx.cloud.callFunction({
      name: 'api',
      data: { action: action, payload: payload || {} }
    });
  } catch (err) {
    if (isNotDeployed(err)) {
      console.warn('[api] 云函数未部署，降级');
      state.mode = LOCAL_API ? 'http' : 'local';
      if (state.mode === 'http') {
        try {
          return applyBody(await httpPost({ action: action, payload: payload || {} }));
        } catch (e2) {
          if (e2 instanceof ApiError) throw e2;
          state.mode = 'local';
          return mock.call(action, payload);
        }
      }
      return mock.call(action, payload);
    }
    throw new ApiError(50000, '网络异常，稍后再试');
  }

  return applyBody((res && res.result) || {});
}

function mode() {
  return state.mode;
}

function resetLocal() {
  if (state.mode === 'local') mock.reset();
}

module.exports = { init, call, now, mode, resetLocal, ApiError, LOCAL_API };

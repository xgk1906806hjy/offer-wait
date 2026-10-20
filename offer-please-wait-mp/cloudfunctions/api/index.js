const cloud = require('wx-server-sdk');

const { AppError, E } = require('./server/errors');
const offerSvc = require('./server/service/offer');
const voteSvc = require('./server/service/vote');
const meSvc = require('./server/service/me');
const adminSvc = require('./server/service/admin');
const social = require('./server/repo/social');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ROUTES = {
  'offer.list': (openid, p) => offerSvc.list(openid, p),
  'offer.mine': (openid, p) => offerSvc.mine(openid),
  'offer.create': (openid, p) => offerSvc.create(openid, p),
  'offer.detail': (openid, p) => offerSvc.detail(openid, p),
  'offer.result': (openid, p) => offerSvc.result(openid, p),
  'offer.decide': (openid, p) => offerSvc.decide(openid, p),
  'vote.create': (openid, p) => voteSvc.create(openid, p),
  'review.create': (openid, p) => offerSvc.review(openid, p),
  'report.create': (openid, p) => adminSvc.report(openid, p),
  'me.get': (openid, p) => meSvc.get(openid),
  'admin.queue': (openid, p) => adminSvc.queue(openid, p),
  'admin.moderate': (openid, p) => adminSvc.moderate(openid, p),
  'admin.takedown': (openid, p) => adminSvc.takedown(openid, p)
};

exports.main = async event => {
  const action = (event && event.action) || '';
  const payload = (event && event.payload) || {};
  const started = Date.now();

  try {
    const ctx = cloud.getWXContext();
    const openid = ctx && ctx.OPENID;
    if (!openid) throw new AppError(E.UNAUTH, '拿不到用户身份');

    await social.ensureUser(openid);
    // 每次请求都写一次 last_active_at 太贵，一小时一次足够
    const user = await social.getUser(openid);
    if (!user || !user.last_active_at || Date.now() - user.last_active_at > 3600 * 1000) {
      await social.touchUser(openid, {});
    }

    const handler = ROUTES[action];
    if (!handler) throw new AppError(E.BAD_PARAM, '未知操作：' + action);

    const data = await handler(openid, payload);

    return {
      code: 0,
      data: data,
      // 客户端一律用服务端时间算倒计时，别信手机时钟
      server_now: Date.now(),
      cost_ms: Date.now() - started
    };
  } catch (err) {
    const code = err instanceof AppError ? err.code : E.INTERNAL;
    console.log('[api] fail', action, code, err && err.message);

    return {
      code: code,
      message: (err && err.message) || '服务异常',
      data: err && err.extra ? err.extra : null,
      server_now: Date.now()
    };
  }
};

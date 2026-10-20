/**
 * 内容安全。
 *
 * 三条原则：
 * 1. 同步检查，绝不异步放行——异步意味着违规内容会先被看到；
 * 2. 审的是拼接后的全文，单字段过审没有意义；
 * 3. 检查本身失败（超时/限流/未开通）时，默认不放行，落人工队列。
 */
const cloud = require('wx-server-sdk');
const config = require('./config');

const RISKY_ERR = 87014;

/**
 * @returns {{pass:boolean, risky:boolean, needReview:boolean, reason:string}}
 */
async function checkText(content, openid) {
  const text = String(content || '').trim();
  if (!text) return { pass: true, risky: false, needReview: false, reason: '' };

  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2, // 2 = 评论
      openid: openid
    });

    const suggest = res && res.result && res.result.suggest;

    if (suggest === 'risky') {
      return { pass: false, risky: true, needReview: false, reason: 'risky' };
    }
    if (suggest === 'review') {
      return { pass: true, risky: false, needReview: true, reason: 'review' };
    }
    return { pass: true, risky: false, needReview: false, reason: suggest || 'pass' };
  } catch (err) {
    if (err && err.errCode === RISKY_ERR) {
      return { pass: false, risky: true, needReview: false, reason: 'risky' };
    }

    // 接口本身不可用：宁可进人工，也不放行
    console.log('[security] msgSecCheck failed:', err && (err.errCode || err.message));

    if (config.SECURITY_FAIL_OPEN) {
      return { pass: true, risky: false, needReview: false, reason: 'fail-open' };
    }
    return { pass: true, risky: false, needReview: true, reason: 'check-error' };
  }
}

/** 发布内容：任意字段拼起来一起审，避免绕过 */
function joinOfferText(o) {
  return [o.role, o.industry, o.city, o.company, o.pkg, o.dilemma, o.asked]
    .filter(Boolean)
    .join('\n');
}

module.exports = { checkText, joinOfferText };

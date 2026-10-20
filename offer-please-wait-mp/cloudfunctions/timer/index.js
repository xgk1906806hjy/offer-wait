/**
 * 定时任务。云函数之间不能互相 require（各自独立部署），所以这里自带一份轻量数据访问。
 *
 * event.type = 'minute' → 过期收口
 * event.type = 'hour'   → 票型对账
 *
 * 票型对账的意义：投票写入是「唯一索引 + 原子自增 + 账本」三者组合，
 * 没有跨文档事务，理论上存在自增成功但答案没写进去、或计数器漂移的情况。
 * 每小时用真实票数校准一次，页面永远以对账后的值为准。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const OFFERS = 'offers';
const VOTES = 'votes';

async function expire(ts) {
  const res = await db
    .collection(OFFERS)
    .where({ status: 'published', deadline_at: _.lt(ts) })
    .update({ data: { status: 'expired', updated_at: ts } });
  return (res && res.stats && res.stats.updated) || 0;
}

async function countChoice(offerId, choice) {
  const res = await db.collection(VOTES).where({ offer_id: offerId, choice: choice }).count();
  return res.total || 0;
}

async function reconcile(batch) {
  const res = await db
    .collection(OFFERS)
    .where({ status: _.in(['published', 'expired', 'decided']) })
    .orderBy('updated_at', 'asc')
    .limit(batch)
    .get();

  const offers = res.data || [];
  const fixed = [];

  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    const take = await countChoice(o._id, 'take');
    const wait = await countChoice(o._id, 'wait');
    const drop = await countChoice(o._id, 'drop');
    const total = take + wait + drop;

    const t = o.tally || {};
    const drift =
      (t.take || 0) !== take ||
      (t.wait || 0) !== wait ||
      (t.drop || 0) !== drop ||
      (o.vote_count || 0) !== total;

    if (drift) {
      await db.collection(OFFERS).doc(o._id).update({
        data: {
          tally: { take: take, wait: wait, drop: drop },
          vote_count: total,
          updated_at: Date.now()
        }
      });
      fixed.push({ id: o._id, before: o.tally, after: { take: take, wait: wait, drop: drop } });
    }
  }

  return fixed;
}

exports.main = async event => {
  // 线上由定时触发器唤起：event = { Type: 'Timer', TriggerName: 'expire' | 'reconcile' }
  // 手动测试时可以直接传 { type: 'minute' | 'hour' }
  const trigger = (event && (event.TriggerName || event.type)) || 'expire';
  const type = trigger === 'reconcile' || trigger === 'hour' ? 'hour' : 'minute';
  const ts = Date.now();

  if (type === 'minute') {
    return { type: type, expired: await expire(ts), at: ts };
  }

  const fixed = await reconcile((event && event.batch) || 50);
  return { type: type, checked: 50, fixed: fixed.length, detail: fixed, at: ts };
};

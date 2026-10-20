const { db, _, C } = require('./db');
const { now } = require('../lib');

const col = () => db.collection(C.offers);
const qcol = () => db.collection(C.questions);

async function addOffer(doc) {
  const res = await col().add({ data: doc });
  return res._id;
}

async function getOffer(id) {
  try {
    const res = await col().doc(id).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

/**
 * 广场流：按截止时间升序，cursor 只用一个 > 比较。
 * 注意：列表接口永远不返回 tally，只返回 vote_count。
 */
async function listOffers(options) {
  const opt = options || {};
  const where = { status: 'published' };
  if (opt.industry) where.industry = opt.industry;
  if (opt.cursor) where.sort_key = _.gt(opt.cursor);

  const res = await col()
    .where(where)
    .orderBy('sort_key', 'asc')
    .limit(Math.min(opt.limit || 20, 20))
    .get();

  return res.data || [];
}

async function updateOffer(id, patch) {
  const data = Object.assign({ updated_at: now() }, patch);
  await col().doc(id).update({ data });
}

/** 原子自增票型，不读改写，天然防并发丢更新 */
async function incTally(id, choice) {
  const data = {
    vote_count: _.inc(1),
    updated_at: now()
  };
  data['tally.' + choice] = _.inc(1);
  await col().doc(id).update({ data });
}

async function addQuestions(offerId, list) {
  const tasks = list.map((text, i) => {
    return qcol().add({
      data: {
        offer_id: offerId,
        seq: i + 1,
        text: text,
        source: 'template',
        answer_count: 0
      }
    });
  });
  await Promise.all(tasks);
}

async function listQuestions(offerId) {
  const res = await qcol().where({ offer_id: offerId }).orderBy('seq', 'asc').limit(10).get();
  return res.data || [];
}

async function incAnswerCount(offerId, seqs) {
  if (!seqs.length) return;
  await qcol()
    .where({ offer_id: offerId, seq: _.in(seqs) })
    .update({ data: { answer_count: _.inc(1) } });
}

/** 过期收口：把 deadline 已过的 published 批量改成 expired */
async function expireDue(ts) {
  const where = { status: 'published', deadline_at: _.lt(ts) };
  const res = await col().where(where).update({ data: { status: 'expired', updated_at: ts } });
  return (res && res.stats && res.stats.updated) || 0;
}

/** 60 秒内同作者同内容去重，防连点两次建两条 */
async function findRecentDuplicate(authorId, hash, since) {
  const res = await col()
    .where({ author_id: authorId, dilemma_hash: hash, created_at: _.gt(since) })
    .limit(1)
    .get();
  return (res.data || [])[0] || null;
}

async function countOffersByAuthorSince(authorId, since) {
  const res = await col().where({ author_id: authorId, created_at: _.gt(since) }).count();
  return res.total || 0;
}

/** 「我的」页：按作者取全部状态，最近发的在前 */
async function listByAuthor(authorId, limit) {
  const res = await col()
    .where({ author_id: authorId })
    .orderBy('created_at', 'desc')
    .limit(limit || 20)
    .get();
  return res.data || [];
}

async function addReview(doc) {
  await db.collection(C.reviews).add({ data: doc });
}

async function getReview(offerId) {
  const res = await db.collection(C.reviews).where({ offer_id: offerId }).limit(1).get();
  return (res.data || [])[0] || null;
}

module.exports = {
  addOffer,
  getOffer,
  listOffers,
  updateOffer,
  incTally,
  addQuestions,
  listQuestions,
  incAnswerCount,
  expireDue,
  findRecentDuplicate,
  countOffersByAuthorSince,
  listByAuthor,
  addReview,
  getReview
};

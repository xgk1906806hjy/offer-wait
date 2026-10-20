const { db, _, C, isDuplicate } = require('./db');

const col = () => db.collection(C.votes);
const acol = () => db.collection(C.answers);

/**
 * 写一票。唯一索引 (offer_id, voter_id) 是「一人一票」的唯一保障，
 * 不靠先查后写——那样在并发下必然漏。
 * @returns {string|null} voteId，重复投票返回 null
 */
async function addVote(doc) {
  try {
    const res = await col().add({ data: doc });
    return res._id;
  } catch (err) {
    if (isDuplicate(err)) return null;
    throw err;
  }
}

async function getVote(offerId, voterId) {
  const res = await col().where({ offer_id: offerId, voter_id: voterId }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function listVotes(offerId, limit) {
  const res = await col()
    .where({ offer_id: offerId, status: 'visible' })
    .orderBy('created_at', 'asc')
    .limit(limit || 50)
    .get();
  return res.data || [];
}

async function addAnswers(list) {
  if (!list.length) return;
  await Promise.all(list.map(a => acol().add({ data: a })));
}

async function listAnswers(offerId) {
  const res = await acol().where({ offer_id: offerId }).limit(200).get();
  return res.data || [];
}

async function countByChoice(offerId, choice) {
  const res = await col().where({ offer_id: offerId, choice: choice }).count();
  return res.total || 0;
}

async function countByVoter(voterId) {
  const res = await col().where({ voter_id: voterId }).count();
  return res.total || 0;
}

/** 列表页一次性回填「你审过哪些」，避免每条都查一次 */
async function listVotedOfferIds(voterId, offerIds) {
  if (!offerIds || !offerIds.length) return [];
  const res = await col()
    .where({ voter_id: voterId, offer_id: _.in(offerIds) })
    .limit(offerIds.length)
    .get();
  return (res.data || []).map(v => v.offer_id);
}

/** 对账：重算三个票型，返回真实值 */
async function recount(offerId) {
  const take = await countByChoice(offerId, 'take');
  const wait = await countByChoice(offerId, 'wait');
  const drop = await countByChoice(offerId, 'drop');
  return { take, wait, drop, total: take + wait + drop };
}

module.exports = {
  addVote,
  getVote,
  listVotes,
  addAnswers,
  listAnswers,
  countByChoice,
  countByVoter,
  listVotedOfferIds,
  recount
};

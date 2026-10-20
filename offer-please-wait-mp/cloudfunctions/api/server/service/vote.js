const config = require('../config');
const { AppError, E } = require('../errors');
const { str, oneOf, now } = require('../lib');
const offersRepo = require('../repo/offers');
const votesRepo = require('../repo/votes');
const social = require('../repo/social');
const security = require('../security');

/**
 * 投一票。
 *
 * 并发正确性靠三件事，不靠事务：
 *  1) votes 上的唯一索引 (offer_id, voter_id) —— 一人一票的最终保障；
 *  2) tally 用 _.inc 原子自增 —— 不做读改写，不会丢更新；
 *  3) 账本 (user_id, reason, ref_id) 唯一 —— 同一票不会加两次分。
 * 三者之间没有强一致，靠 timer 里的对账函数收敛。票比账重要：
 * 哪怕账本失败，也不回滚用户已经投出去的票。
 */
async function create(openid, p) {
  const id = str(p.id, { required: true, max: 40, name: 'id' });
  const choice = oneOf(p.choice, ['take', 'wait', 'drop'], '判断');
  const reason = str(p.reason, {
    required: true,
    min: config.MIN_REASON,
    max: config.MAX_REASON,
    name: '理由'
  });

  const offer = await offersRepo.getOffer(id);
  if (!offer) throw new AppError(E.NOT_FOUND, '这条 offer 不在了');

  if (offer.author_id === openid) {
    throw new AppError(E.SELF_VOTE, '不能审自己的 offer');
  }
  if (offer.status !== 'published' || offer.deadline_at <= now()) {
    throw new AppError(E.EXPIRED, '这条已经截止了');
  }

  // 先查一次给快速反馈，真正的保障是下面的唯一索引
  const existed = await votesRepo.getVote(id, openid);
  if (existed) throw new AppError(E.ALREADY_VOTED, '你已经审过这一条了');

  const qs = await offersRepo.listQuestions(id);
  const seqMap = {};
  qs.forEach(q => {
    seqMap[q.seq] = q.text;
  });

  const rawAnswers = Array.isArray(p.answers) ? p.answers : [];
  const answers = [];
  rawAnswers.forEach(a => {
    const seq = Number(a && a.seq);
    const text = str(a && a.text, { max: 300, name: '回答' });
    if (!text) return;
    if (!seqMap[seq]) throw new AppError(E.BAD_PARAM, '回答的问题不存在');
    answers.push({ seq: seq, text: text });
  });

  if (!answers.length) {
    throw new AppError(E.BAD_PARAM, '至少回答一个问题：只留态度、不留信息，等于没审');
  }

  // 理由和回答一起审，防止把违规内容塞进答案里
  const joined = reason + '\n' + answers.map(a => a.text).join('\n');
  const check = await security.checkText(joined, openid);
  if (check.risky || check.needReview) {
    throw new AppError(E.CONTENT_REJECTED, '这段内容没过安全检测，换个说法');
  }

  const ts = now();
  const voteId = await votesRepo.addVote({
    _id: 'v' + ts.toString(36) + Math.random().toString(36).slice(2, 7),
    offer_id: id,
    voter_id: openid,
    choice: choice,
    reason: reason,
    reason_len: reason.length,
    status: 'visible',
    created_at: ts
  });

  if (!voteId) throw new AppError(E.ALREADY_VOTED, '你已经审过这一条了');

  await votesRepo.addAnswers(
    answers.map(a => ({
      vote_id: voteId,
      offer_id: id,
      question_seq: a.seq,
      text: a.text
    }))
  );

  await offersRepo.incTally(id, choice);
  await offersRepo.incAnswerCount(id, answers.map(a => a.seq));

  // 审一份得 1 次额度
  const credited = await social.addLedger({
    user_id: openid,
    delta: 1,
    reason: 'vote',
    ref_id: voteId
  });
  if (credited) await social.incBalance(openid, 1);

  const tally = {
    take: (offer.tally && offer.tally.take) || 0,
    wait: (offer.tally && offer.tally.wait) || 0,
    drop: (offer.tally && offer.tally.drop) || 0
  };
  tally[choice] += 1;

  return {
    vote_id: voteId,
    tally: tally,
    total: (offer.vote_count || 0) + 1
  };
}

module.exports = { create };

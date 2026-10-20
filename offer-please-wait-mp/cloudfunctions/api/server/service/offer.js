const config = require('../config');
const { AppError, E } = require('../errors');
const { str, oneOf, int, now, hash } = require('../lib');
const offersRepo = require('../repo/offers');
const votesRepo = require('../repo/votes');
const social = require('../repo/social');
const security = require('../security');
const questions = require('../questions');

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

function newId(ts) {
  return 'o' + ts.toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------------- 出参整形 ---------------- */

function toListItem(o) {
  // 列表里永远不带 tally：未投票的人连"几票"都不该拿到
  return {
    id: o._id,
    role: o.role,
    industry: o.industry,
    city: o.city,
    company: o.company,
    pkg: o.pkg,
    dilemma: o.dilemma,
    deadline_at: o.deadline_at,
    vote_count: o.vote_count || 0,
    created_at: o.created_at
  };
}

function toDetail(o) {
  return {
    id: o._id,
    role: o.role,
    industry: o.industry,
    city: o.city,
    company: o.company,
    pkg: o.pkg,
    dilemma: o.dilemma,
    alternatives: o.alternatives,
    asked: o.asked,
    deadline_at: o.deadline_at,
    status: o.status,
    decision: o.decision || '',
    vote_count: o.vote_count || 0,
    created_at: o.created_at
  };
}

function toVote(v, answers, viewerId) {
  return {
    choice: v.choice,
    reason: v.reason,
    is_mine: v.voter_id === viewerId,
    created_at: v.created_at,
    answers: answers
      .filter(a => a.vote_id === v._id)
      .map(a => ({ seq: a.question_seq, text: a.text }))
  };
}

function buildResult(offer, qs, votes, answers, viewerId) {
  const tally = { take: 0, wait: 0, drop: 0 };
  votes.forEach(v => {
    tally[v.choice] = (tally[v.choice] || 0) + 1;
  });

  const answeredSeqs = {};
  answers.forEach(a => {
    answeredSeqs[a.question_seq] = true;
  });

  return {
    tally: tally,
    total: votes.length,
    votes: votes.map(v => toVote(v, answers, viewerId)),
    open_questions: qs
      .filter(q => !answeredSeqs[q.seq])
      .map(q => ({ seq: q.seq, text: q.text }))
  };
}

/* ---------------- 发布 ---------------- */

async function create(openid, p) {
  const user = await social.getUser(openid);
  if (!user) throw new AppError(E.UNAUTH, '用户不存在');
  if (user.status !== 'active') throw new AppError(E.FORBIDDEN, '账号状态异常');

  const role = str(p.role, { required: true, min: 2, max: 40, name: '岗位' });
  const industry = str(p.industry, { required: true, min: 1, max: 20, name: '行业' });
  const city = str(p.city, { max: 20, name: '城市' }) || '未填';
  const company = str(p.company, { max: 40, name: '公司' });
  const pkg = str(p.pkg, { max: 30, name: '总包' }) || '未填';
  const dilemma = str(p.dilemma, { required: true, min: 8, max: 120, name: '纠结' });
  const alternatives = oneOf(p.alternatives || 'none', ['none', 'pending', 'have'], '其他选择');
  const asked = str(p.asked, { max: 60, name: '已问过' });
  const ttlHours = oneOf(Number(p.ttl_hours) || 48, [24, 48, 72, 168], '答复时限');

  // 1) 重复提交：60 秒内同内容直接返回上一条，防连点
  const h = hash(role + '|' + industry + '|' + dilemma);
  const dup = await offersRepo.findRecentDuplicate(openid, h, now() - config.DEDUPE_WINDOW_MS);
  if (dup) {
    const qs = await offersRepo.listQuestions(dup._id);
    return { id: dup._id, status: dup.status, duplicated: true, questions: qs.map(q => ({ seq: q.seq, text: q.text })) };
  }

  // 2) 频率
  const todayCount = await offersRepo.countOffersByAuthorSince(openid, now() - DAY);
  if (todayCount >= config.MAX_OFFERS_PER_DAY) {
    throw new AppError(E.RATE_LIMIT, '一天最多发 ' + config.MAX_OFFERS_PER_DAY + ' 条，明天再来');
  }

  // 3) 配额（首单免费）
  const isFirst = !user.offer_count && config.FIRST_OFFER_FREE;
  if (!isFirst) {
    const balance = await social.getBalance(openid);
    if (balance < config.PUBLISH_COST) {
      throw new AppError(
        E.NO_QUOTA,
        '还要再审 ' + (config.PUBLISH_COST - balance) + ' 份，才能发这一份',
        { balance: balance, need: config.PUBLISH_COST - balance }
      );
    }
  }

  // 4) 内容安全：审拼接后的全文
  const maskedCompany = company || '某' + industry + '公司（未公开）';
  const check = await security.checkText(
    security.joinOfferText({ role, industry, city, company: maskedCompany, pkg, dilemma, asked }),
    openid
  );
  if (check.risky) {
    throw new AppError(E.CONTENT_REJECTED, '内容未通过安全检测，改一下再发');
  }

  // 5) 落库
  const ts = now();
  const id = newId(ts);
  const status = check.needReview ? 'reviewing' : 'published';

  const offerDoc = {
    _id: id,
    author_id: openid,
    role: role,
    industry: industry,
    city: city,
    company: maskedCompany,
    pkg: pkg,
    dilemma: dilemma,
    dilemma_hash: h,
    alternatives: alternatives,
    asked: asked,
    deadline_at: ts + ttlHours * HOUR,
    status: status,
    tally: { take: 0, wait: 0, drop: 0 },
    vote_count: 0,
    answer_count: 0,
    sort_key: String(ts + ttlHours * HOUR).padStart(15, '0') + '_' + id,
    created_at: ts,
    updated_at: ts
  };

  await offersRepo.addOffer(offerDoc);

  const templates = await social.listTemplates();
  const qs = questions.generate(role, templates);
  await offersRepo.addQuestions(id, qs);

  // 6) 扣配额（先生成再扣，扣失败也不回滚内容——宁可让用户占一次便宜）
  if (!isFirst) {
    const charged = await social.addLedger({
      user_id: openid,
      delta: -config.PUBLISH_COST,
      reason: 'publish',
      ref_id: id
    });
    if (charged) await social.incBalance(openid, -config.PUBLISH_COST);
  }

  await social.touchUser(openid, { offer_count: (user.offer_count || 0) + 1 });

  if (status === 'reviewing') {
    await social.addTask({ target_type: 'offer', target_id: id, source: 'auto', risk_label: check.reason });
  }

  return {
    id: id,
    status: status,
    duplicated: false,
    questions: qs.map((text, i) => ({ seq: i + 1, text: text }))
  };
}

/* ---------------- 列表 ---------------- */

async function list(openid, p) {
  if (!config.FEATURE_PUBLIC_PLAZA) {
    throw new AppError(E.FORBIDDEN, '广场暂未开放');
  }

  const limit = Math.min(int(p.limit || 20, { min: 1, max: 20, name: '条数' }), 20);
  const cursor = str(p.cursor, { max: 60, name: '游标' });
  const industry = str(p.industry, { max: 20, name: '行业' });

  const rows = await offersRepo.listOffers({ cursor: cursor, limit: limit, industry: industry });
  const votedIds = await votesRepo.listVotedOfferIds(
    openid,
    rows.map(r => r._id)
  );

  return {
    items: rows.map(toListItem),
    voted_ids: votedIds,
    next_cursor: rows.length ? rows[rows.length - 1].sort_key : ''
  };
}

/** 我的：自己发过的全部 offer，带票型（作者看自己的东西不算剧透） */
async function mine(openid) {
  const rows = await offersRepo.listByAuthor(openid, 20);
  return {
    items: rows.map(o => ({
      id: o._id,
      role: o.role,
      industry: o.industry,
      city: o.city,
      pkg: o.pkg,
      status: o.status,
      decision: o.decision || '',
      tally: o.tally || { take: 0, wait: 0, drop: 0 },
      vote_count: o.vote_count || 0,
      deadline_at: o.deadline_at,
      created_at: o.created_at
    }))
  };
}

/* ---------------- 详情（视角相关） ---------------- */

/** 审核中/已下架的内容，只有作者自己看得到 */
function assertVisible(offer, openid) {
  const open = ['published', 'expired', 'decided'];
  if (open.indexOf(offer.status) < 0 && offer.author_id !== openid) {
    throw new AppError(E.NOT_FOUND, '这条 offer 不在了');
  }
}

async function detail(openid, p) {
  const id = str(p.id, { required: true, max: 40, name: 'id' });

  const offer = await offersRepo.getOffer(id);
  if (!offer) throw new AppError(E.NOT_FOUND, '这条 offer 不在了');
  assertVisible(offer, openid);

  const qs = await offersRepo.listQuestions(id);
  const myVote = await votesRepo.getVote(id, openid);

  const isAuthor = offer.author_id === openid;
  const hasVoted = !!myVote;
  const expired = offer.deadline_at <= now() || offer.status !== 'published';

  // 作者要收到足够多票才看结果，避免被一两条意见带跑
  const canSeeResult =
    hasVoted || (isAuthor && (offer.vote_count || 0) >= config.AUTHOR_MIN_VOTES);

  const patch = {
    offer: toDetail(offer),
    questions: qs.map(q => ({ seq: q.seq, text: q.text, answer_count: q.answer_count || 0 })),
    viewer: {
      is_author: isAuthor,
      has_voted: hasVoted,
      can_vote: !isAuthor && !hasVoted && !expired,
      can_see_result: canSeeResult,
      expires_at: offer.deadline_at
    },
    my_vote: hasVoted ? toVote(myVote, [], openid) : null,
    result: null
  };

  if (canSeeResult) {
    const votes = await votesRepo.listVotes(id, 50);
    const answers = await votesRepo.listAnswers(id);
    patch.result = buildResult(offer, qs, votes, answers, openid);
  }

  return patch;
}

/* ---------------- 结果（单独接口，供刷新用） ---------------- */

async function result(openid, p) {
  const id = str(p.id, { required: true, max: 40, name: 'id' });
  const offer = await offersRepo.getOffer(id);
  if (!offer) throw new AppError(E.NOT_FOUND, '这条 offer 不在了');
  assertVisible(offer, openid);

  const qs = await offersRepo.listQuestions(id);
  const myVote = await votesRepo.getVote(id, openid);
  const isAuthor = offer.author_id === openid;
  const hasVoted = !!myVote;

  if (!hasVoted && !(isAuthor && (offer.vote_count || 0) >= config.AUTHOR_MIN_VOTES)) {
    throw new AppError(E.FORBIDDEN, '先审一份，才能看结果');
  }

  const votes = await votesRepo.listVotes(id, 50);
  const answers = await votesRepo.listAnswers(id);

  return { result: buildResult(offer, qs, votes, answers, openid) };
}

/* ---------------- 作者定夺 ---------------- */

async function decide(openid, p) {
  const id = str(p.id, { required: true, max: 40, name: 'id' });
  const decision = oneOf(p.decision, ['take', 'wait', 'drop'], '决定');

  const offer = await offersRepo.getOffer(id);
  if (!offer) throw new AppError(E.NOT_FOUND, '这条 offer 不在了');
  if (offer.author_id !== openid) throw new AppError(E.FORBIDDEN, '只有发起人能定夺');

  await offersRepo.updateOffer(id, { decision: decision, decided_at: now(), status: 'decided' });
  return { status: 'decided', decision: decision };
}

/* ---------------- 90 天复盘 ---------------- */

async function review(openid, p) {
  const id = str(p.id, { required: true, max: 40, name: 'id' });
  const text = str(p.text, { required: true, min: 2, max: 200, name: '复盘' });

  const offer = await offersRepo.getOffer(id);
  if (!offer) throw new AppError(E.NOT_FOUND, '这条 offer 不在了');
  if (offer.author_id !== openid) throw new AppError(E.FORBIDDEN, '只有发起人能写复盘');
  if (offer.status !== 'decided' && offer.status !== 'expired') {
    throw new AppError(E.FORBIDDEN, '还没做决定，先定下来再复盘');
  }

  const check = await security.checkText(text, openid);
  if (check.risky) throw new AppError(E.CONTENT_REJECTED, '内容未通过安全检测');

  await offersRepo.addReview({
    offer_id: id,
    author_id: openid,
    text: text,
    created_at: now()
  });

  return { ok: true };
}

module.exports = { create, list, mine, detail, result, decide, review, toListItem };

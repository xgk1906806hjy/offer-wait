/**
 * 本地演示实现（降级用，不是业务真相的副本）。
 *
 * 什么时候会走到这里：
 *  - 还没建云环境 / 没部署云函数；
 *  - 开发者工具里没开云开发。
 * 它会尽量遵守和后端一样的规则（一人一票、作者不能投、满 3 票解锁、审 3 发 1），
 * 但**安全与审核都在本地，纯演示**。真正上线必须跑云函数。
 */
const store = require('./seed.js');
const { ApiError, CODES } = require('./api-error');

const KEY = 'opw_mock_v1';
const HOUR = 3600 * 1000;
const ME = 'me';

let S = null;

function storageGet() {
  try {
    return wx.getStorageSync(KEY) || null;
  } catch (e) {
    return null;
  }
}

function storageSet(v) {
  try {
    wx.setStorageSync(KEY, v);
  } catch (e) {}
}

function fresh() {
  const base = store.seed();
  const offers = base.map((o, i) => {
    const votes = (o.votes || []).map((v, j) => ({
      voter_id: 'seed' + i + '_' + j,
      choice: v.choice,
      reason: v.reason,
      answers: Object.keys(v.answers || {}).map(k => ({ seq: Number(k) + 1, text: v.answers[k] })),
      created_at: (o.deadline || Date.now()) - HOUR
    }));

    return {
      id: o.id,
      author: 'seed' + i,
      role: o.role,
      industry: o.industry,
      city: o.city,
      company: o.company,
      pkg: o.pkg,
      dilemma: o.dilemma,
      alternatives: o.alternatives,
      asked: o.asked,
      deadline_at: o.deadline,
      status: 'published',
      decision: '',
      created_at: (o.deadline || Date.now()) - 48 * HOUR,
      questions: (o.questions || []).map((t, k) => ({ seq: k + 1, text: t })),
      votes: votes
    };
  });

  return { me: { quota: 0, offers: 0, votes: 0 }, offers: offers, reviews: {} };
}

function load() {
  if (S) return S;
  const saved = storageGet();
  S = saved && saved.offers && saved.offers.length ? saved : fresh();
  return S;
}

function save() {
  storageSet(S);
}

function tallyOf(o) {
  const t = { take: 0, wait: 0, drop: 0 };
  o.votes.forEach(v => {
    t[v.choice] = (t[v.choice] || 0) + 1;
  });
  return t;
}

function findOffer(id) {
  const o = load().offers.filter(x => x.id === id)[0];
  if (!o) throw new ApiError(CODES.NOT_FOUND, '这条 offer 不在了');
  return o;
}

function mineOf(o) {
  return o.votes.filter(v => v.voter_id === ME)[0] || null;
}

function isExpired(o) {
  return o.deadline_at <= Date.now() || o.status !== 'published';
}

function shapeVote(v) {
  return {
    choice: v.choice,
    reason: v.reason,
    is_mine: v.voter_id === ME,
    created_at: v.created_at,
    answers: v.answers || []
  };
}

function buildResult(o) {
  const answered = {};
  o.votes.forEach(v => (v.answers || []).forEach(a => (answered[a.seq] = true)));

  return {
    tally: tallyOf(o),
    total: o.votes.length,
    votes: o.votes.map(shapeVote),
    open_questions: o.questions
      .filter(q => !answered[q.seq])
      .map(q => ({ seq: q.seq, text: q.text }))
  };
}

/* ---------------- actions ---------------- */

const actions = {
  async 'offer.list'(p) {
    const s = load();
    const items = s.offers
      .filter(o => o.status === 'published')
      .sort((a, b) => a.deadline_at - b.deadline_at)
      .slice(0, (p && p.limit) || 20)
      .map(o => ({
        id: o.id,
        role: o.role,
        industry: o.industry,
        city: o.city,
        company: o.company,
        pkg: o.pkg,
        dilemma: o.dilemma,
        deadline_at: o.deadline_at,
        vote_count: o.votes.length,
        created_at: o.created_at
      }));

    return {
      items: items,
      voted_ids: s.offers.filter(o => mineOf(o)).map(o => o.id),
      next_cursor: ''
    };
  },

  async 'offer.mine'() {
    const s = load();
    return {
      items: s.offers
        .filter(o => o.author === ME)
        .sort((a, b) => b.created_at - a.created_at)
        .map(o => ({
          id: o.id,
          role: o.role,
          industry: o.industry,
          city: o.city,
          pkg: o.pkg,
          status: o.status,
          decision: o.decision || '',
          tally: tallyOf(o),
          vote_count: o.votes.length,
          deadline_at: o.deadline_at,
          created_at: o.created_at
        }))
    };
  },

  async 'offer.create'(p) {
    const s = load();
    const role = String((p && p.role) || '').trim();
    const industry = String((p && p.industry) || '').trim();
    const dilemma = String((p && p.dilemma) || '').trim();

    if (!role) throw new ApiError(CODES.BAD_PARAM, '岗位不能为空');
    if (!industry) throw new ApiError(CODES.BAD_PARAM, '行业不能为空');
    if (dilemma.length < 8) throw new ApiError(CODES.BAD_PARAM, '把纠结写具体一点');

    if (dilemma.indexOf('违规') >= 0) {
      throw new ApiError(CODES.CONTENT_REJECTED, '内容未通过安全检测，改一下再发');
    }

    const isFirst = s.me.offers === 0;
    if (!isFirst && s.me.quota < 3) {
      throw new ApiError(CODES.NO_QUOTA, '还要再审 ' + (3 - s.me.quota) + ' 份，才能发这一份', {
        need: 3 - s.me.quota
      });
    }

    const id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ttl = Number((p && p.ttl_hours) || 48) * HOUR;
    const questions = store.generateQuestions(role);

    s.offers.unshift({
      id: id,
      author: ME,
      role: role,
      industry: industry,
      city: String((p && p.city) || '').trim() || '未填',
      company: String((p && p.company) || '').trim() || '某' + industry + '公司（未公开）',
      pkg: String((p && p.pkg) || '').trim() || '未填',
      dilemma: dilemma,
      alternatives: (p && p.alternatives) || 'none',
      asked: String((p && p.asked) || '').trim(),
      deadline_at: Date.now() + ttl,
      status: 'published',
      decision: '',
      created_at: Date.now(),
      questions: questions.map((t, i) => ({ seq: i + 1, text: t })),
      votes: []
    });

    s.me.offers += 1;
    if (!isFirst) s.me.quota -= 3;
    save();

    return {
      id: id,
      status: 'published',
      duplicated: false,
      questions: questions.map((t, i) => ({ seq: i + 1, text: t }))
    };
  },

  async 'offer.detail'(p) {
    const o = findOffer(p.id);
    const myVote = mineOf(o);
    const isAuthor = o.author === ME;
    const canSeeResult = !!myVote || (isAuthor && o.votes.length >= 3);

    return {
      offer: {
        id: o.id,
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
        vote_count: o.votes.length,
        created_at: o.created_at
      },
      questions: o.questions.map(q => ({ seq: q.seq, text: q.text })),
      viewer: {
        is_author: isAuthor,
        has_voted: !!myVote,
        can_vote: !isAuthor && !myVote && !isExpired(o),
        can_see_result: canSeeResult,
        expires_at: o.deadline_at
      },
      my_vote: myVote ? shapeVote(myVote) : null,
      result: canSeeResult ? buildResult(o) : null
    };
  },

  async 'offer.result'(p) {
    const o = findOffer(p.id);
    const myVote = mineOf(o);
    const isAuthor = o.author === ME;
    if (!myVote && !(isAuthor && o.votes.length >= 3)) {
      throw new ApiError(CODES.FORBIDDEN, '先审一份，才能看结果');
    }
    return { result: buildResult(o) };
  },

  async 'vote.create'(p) {
    const o = findOffer(p.id);

    if (o.author === ME) throw new ApiError(CODES.SELF_VOTE, '不能审自己的 offer');
    if (isExpired(o)) throw new ApiError(CODES.EXPIRED, '这条已经截止了');
    if (mineOf(o)) throw new ApiError(CODES.ALREADY_VOTED, '你已经审过这一条了');

    const reason = String((p && p.reason) || '').trim();
    if (reason.length < 10) throw new ApiError(CODES.BAD_PARAM, '理由至少 10 个字');

    const answers = (p.answers || []).filter(a => a && String(a.text || '').trim());
    if (!answers.length) throw new ApiError(CODES.BAD_PARAM, '至少回答一个问题');

    o.votes.push({
      voter_id: ME,
      choice: p.choice,
      reason: reason,
      answers: answers.map(a => ({ seq: Number(a.seq), text: String(a.text).trim() })),
      created_at: Date.now()
    });

    load().me.votes += 1;
    load().me.quota += 1;
    save();

    const t = tallyOf(o);
    return { tally: t, total: o.votes.length };
  },

  async 'offer.decide'(p) {
    const o = findOffer(p.id);
    if (o.author !== ME) throw new ApiError(CODES.FORBIDDEN, '只有发起人能定夺');
    o.decision = p.decision;
    o.status = 'decided';
    save();
    return { status: 'decided', decision: p.decision };
  },

  async 'review.create'(p) {
    const o = findOffer(p.id);
    if (o.author !== ME) throw new ApiError(CODES.FORBIDDEN, '只有发起人能写复盘');
    if (o.status !== 'decided' && o.status !== 'expired') {
      throw new ApiError(CODES.FORBIDDEN, '还没做决定，先定下来再复盘');
    }
    load().reviews[o.id] = String((p && p.text) || '').trim();
    save();
    return { ok: true };
  },

  async 'me.get'() {
    const s = load();
    return {
      profile: {
        nickname: '',
        industry: '',
        role: '',
        years: 0,
        verify_status: 'none',
        weight: 0.3,
        is_admin: false,
        status: 'active'
      },
      quota: { balance: s.me.quota, need_to_publish: Math.max(0, 3 - s.me.quota), ledger: [] },
      stats: { offers: s.me.offers, votes: s.me.votes }
    };
  },

  async 'report.create'() {
    return { ok: true, report_count: 1, auto_hidden: false };
  },

  async 'admin.queue'() {
    return { items: [], next_cursor: 0 };
  },

  async 'admin.moderate'() {
    return { ok: true };
  },

  async 'admin.takedown'() {
    return { ok: true };
  }
};

async function call(action, payload) {
  const fn = actions[action];
  if (!fn) throw new ApiError(CODES.BAD_PARAM, '未知操作：' + action);
  return fn(payload || {});
}

function reset() {
  S = null;
  try {
    wx.removeStorageSync(KEY);
  } catch (e) {}
}

module.exports = { call, reset };

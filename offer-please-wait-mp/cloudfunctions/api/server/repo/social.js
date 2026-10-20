const { db, _, C, isDuplicate } = require('./db');
const config = require('../config');
const { now } = require('../lib');

const users = () => db.collection(C.users);
const ledger = () => db.collection(C.ledger);
const tasks = () => db.collection(C.tasks);
const reports = () => db.collection(C.reports);
const templates = () => db.collection(C.templates);

/* ---------------- users ---------------- */

async function getUser(openid) {
  try {
    const res = await users().doc(openid).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

async function ensureUser(openid) {
  const found = await getUser(openid);
  if (found) return found;

  const doc = {
    _id: openid,
    openid: openid,
    nickname: '',
    industry: '',
    role: '',
    years: 0,
    verify_status: 'none',
    weight: config.WEIGHT_UNVERIFIED,
    quota_balance: 0,
    offer_count: 0,
    vote_count: 0,
    status: 'active',
    is_admin: false,
    created_at: now(),
    last_active_at: now()
  };

  try {
    await users().add({ data: doc });
  } catch (err) {
    // 并发首次进入：另一个请求已经建好了，忽略
    if (!isDuplicate(err)) throw err;
  }
  return getUser(openid);
}

async function touchUser(openid, patch) {
  const data = Object.assign({ last_active_at: now() }, patch || {});
  await users().doc(openid).update({ data });
}

/* ---------------- quota ---------------- */

/**
 * 账本只追加。余额以账本聚合为准，users.quota_balance 只是缓存。
 * (user_id, reason, ref_id) 上的唯一索引保证同一件事不会被记两次。
 * @returns {boolean} false = 这条已经在账上了（幂等命中）
 */
async function addLedger(entry) {
  try {
    await ledger().add({
      data: {
        user_id: entry.user_id,
        delta: entry.delta,
        reason: entry.reason,
        ref_id: entry.ref_id,
        created_at: now()
      }
    });
    return true;
  } catch (err) {
    if (isDuplicate(err)) return false;
    throw err;
  }
}

async function incBalance(openid, delta) {
  await users().doc(openid).update({
    data: { quota_balance: _.inc(delta), last_active_at: now() }
  });
}

async function getBalance(openid) {
  const u = await getUser(openid);
  return (u && u.quota_balance) || 0;
}

/** 账本重算余额，定时对账用 */
async function sumLedger(openid) {
  const res = await ledger().where({ user_id: openid }).limit(1000).get();
  return (res.data || []).reduce((s, r) => s + (r.delta || 0), 0);
}

async function listLedger(openid, limit) {
  const res = await ledger()
    .where({ user_id: openid })
    .orderBy('created_at', 'desc')
    .limit(limit || 20)
    .get();
  return res.data || [];
}

/* ---------------- moderation ---------------- */

async function addTask(task) {
  const res = await tasks().add({
    data: {
      target_type: task.target_type,
      target_id: task.target_id,
      source: task.source || 'auto',
      risk_label: task.risk_label || '',
      status: 'pending',
      reviewer: '',
      note: '',
      created_at: now()
    }
  });
  return res._id;
}

async function listTasks(status, cursor, limit) {
  const where = { status: status || 'pending' };
  if (cursor) where.created_at = _.gt(cursor);
  const res = await tasks()
    .where(where)
    .orderBy('created_at', 'asc')
    .limit(limit || 20)
    .get();
  return res.data || [];
}

async function getTask(id) {
  try {
    const res = await tasks().doc(id).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

async function updateTask(id, patch) {
  await tasks().doc(id).update({ data: Object.assign({ updated_at: now() }, patch) });
}

/* ---------------- reports ---------------- */

async function addReport(doc) {
  const res = await reports().add({
    data: {
      target_type: doc.target_type,
      target_id: doc.target_id,
      reporter_id: doc.reporter_id,
      reason: doc.reason,
      status: 'open',
      created_at: now()
    }
  });
  return res._id;
}

async function countReports(targetType, targetId) {
  const res = await reports().where({ target_type: targetType, target_id: targetId }).count();
  return res.total || 0;
}

/* ---------------- templates ---------------- */

async function listTemplates() {
  const res = await templates().limit(200).get();
  return res.data || [];
}

module.exports = {
  getUser,
  ensureUser,
  touchUser,
  addLedger,
  incBalance,
  getBalance,
  sumLedger,
  listLedger,
  addTask,
  listTasks,
  getTask,
  updateTask,
  addReport,
  countReports,
  listTemplates
};

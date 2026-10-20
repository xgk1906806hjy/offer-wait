const config = require('../config');
const { AppError, E } = require('../errors');
const { str, oneOf, now } = require('../lib');
const offersRepo = require('../repo/offers');
const social = require('../repo/social');

async function requireAdmin(openid) {
  const user = await social.getUser(openid);
  if (!user || !user.is_admin) throw new AppError(E.NOT_ADMIN, '没有后台权限');
  return user;
}

/* ---------------- 举报 ---------------- */

async function report(openid, p) {
  const targetType = oneOf(p.target_type, ['offer', 'vote', 'review'], '类型');
  const targetId = str(p.target_id, { required: true, max: 40, name: '目标' });
  const reason = str(p.reason, { required: true, min: 2, max: 100, name: '举报理由' });

  await social.addReport({
    target_type: targetType,
    target_id: targetId,
    reporter_id: openid,
    reason: reason
  });

  const count = await social.countReports(targetType, targetId);
  let autoHidden = false;

  if (targetType === 'offer' && count >= config.REPORT_TAKEDOWN_THRESHOLD) {
    const offer = await offersRepo.getOffer(targetId);
    if (offer && offer.status === 'published') {
      // 先下架再转人工：宁可错杀一条，也不要让它在广场上多待一分钟
      await offersRepo.updateOffer(targetId, { status: 'reviewing' });
      await social.addTask({
        target_type: 'offer',
        target_id: targetId,
        source: 'report',
        risk_label: '被举报 ' + count + ' 次'
      });
      autoHidden = true;
    }
  }

  return { ok: true, report_count: count, auto_hidden: autoHidden };
}

/* ---------------- 审核队列 ---------------- */

async function queue(openid, p) {
  await requireAdmin(openid);

  const status = str(p.status, { max: 20, name: '状态' }) || 'pending';
  const cursor = Number(p.cursor) || 0;
  const rows = await social.listTasks(status, cursor, Math.min(Number(p.limit) || 20, 50));

  return {
    items: rows.map(t => ({
      id: t._id,
      target_type: t.target_type,
      target_id: t.target_id,
      source: t.source,
      risk_label: t.risk_label,
      created_at: t.created_at
    })),
    next_cursor: rows.length ? rows[rows.length - 1].created_at : 0
  };
}

async function moderate(openid, p) {
  const admin = await requireAdmin(openid);
  const taskId = str(p.task_id, { required: true, max: 40, name: '任务' });
  const action = oneOf(p.action, ['approve', 'reject'], '动作');
  const note = str(p.note, { max: 100, name: '备注' });

  const task = await social.getTask(taskId);
  if (!task) throw new AppError(E.NOT_FOUND, '任务不存在');
  if (task.status !== 'pending') throw new AppError(E.FORBIDDEN, '这个任务已经处理过了');

  if (task.target_type === 'offer') {
    await offersRepo.updateOffer(task.target_id, {
      status: action === 'approve' ? 'published' : 'removed'
    });
  }

  await social.updateTask(taskId, {
    status: action === 'approve' ? 'passed' : 'rejected',
    reviewer: admin.openid || openid,
    note: note
  });

  return { ok: true, status: action === 'approve' ? 'published' : 'removed' };
}

async function takedown(openid, p) {
  const admin = await requireAdmin(openid);
  const targetType = oneOf(p.target_type, ['offer', 'vote', 'review'], '类型');
  const targetId = str(p.target_id, { required: true, max: 40, name: '目标' });

  if (targetType === 'offer') {
    await offersRepo.updateOffer(targetId, { status: 'removed' });
  }

  await social.addTask({
    target_type: targetType,
    target_id: targetId,
    source: 'admin',
    risk_label: 'admin takedown by ' + (admin.openid || openid)
  });

  return { ok: true };
}

module.exports = { report, queue, moderate, takedown };

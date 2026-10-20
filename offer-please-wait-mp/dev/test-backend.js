/**
 * 后端端到端测试：用内存版 SDK 跑真实云函数代码。
 * 跑法：node dev/test-backend.js
 */
const path = require('path');
const Module = require('module');
const { createCloud } = require('./mock-sdk');

const mock = createCloud();

// 在加载云函数之前把 wx-server-sdk 换成内存实现
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mock.cloud;
  return origLoad.apply(this, arguments);
};

const api = require(path.join(__dirname, '..', 'cloudfunctions/api/index.js'));
const timer = require(path.join(__dirname, '..', 'cloudfunctions/timer/index.js'));

/* ---------------- 断言 ---------------- */
let failures = 0;
function ok(cond, label, extra) {
  if (cond) {
    console.log('  \u2713 ' + label);
  } else {
    console.log('  \u2717 ' + label + (extra ? '  → ' + JSON.stringify(extra) : ''));
    failures++;
  }
}

async function call(action, payload, openid) {
  mock.setUser(openid);
  return api.main({ action: action, payload: payload || {} });
}

const USER_A = 'openid-A'; // 发起人
const USER_B = 'openid-B';
const USER_C = 'openid-C';
const USER_D = 'openid-D';
const USER_E = 'openid-E';

const LONG_REASON = '三个人做后端，你就是唯一的背锅位。先问清楚汇报线和上线节奏。';

async function main() {
  console.log('发布');
  const c1 = await call(
    'offer.create',
    {
      role: '后端开发',
      industry: 'SaaS',
      city: '杭州',
      pkg: '20-24k',
      dilemma: '团队只有三个人，我怕进去什么都得自己扛。',
      alternatives: 'have',
      ttl_hours: 48
    },
    USER_A
  );
  ok(c1.code === 0, 'offer.create 成功', c1);
  ok(c1.data.status === 'published', '正常内容直接 published');
  ok(c1.data.questions.length === 4, '生成 4 个必答问题');
  ok(
    c1.data.questions.some(q => q.text.indexOf('oncall') >= 0),
    '技术岗问题命中'
  );

  const offerId = c1.data.id;

  console.log('重复提交');
  const c1dup = await call(
    'offer.create',
    {
      role: '后端开发',
      industry: 'SaaS',
      city: '杭州',
      pkg: '20-24k',
      dilemma: '团队只有三个人，我怕进去什么都得自己扛。',
      alternatives: 'have'
    },
    USER_A
  );
  ok(c1dup.data && c1dup.data.duplicated === true, '60 秒内重复提交被合并');

  console.log('广场');
  const list = await call('offer.list', { limit: 20 }, USER_B);
  ok(list.code === 0, 'offer.list 成功');
  ok(list.data.items.length === 1, '看到 1 条');
  ok(list.data.items[0].tally === undefined, '列表不返回票型');
  ok(list.data.items[0].vote_count === 0, '列表只给票数');
  ok(list.data.voted_ids.length === 0, '没审过时 voted_ids 为空');

  console.log('详情（未投票）');
  const d1 = await call('offer.detail', { id: offerId }, USER_B);
  ok(d1.code === 0, '详情可读');
  ok(d1.data.viewer.can_vote === true, '可以投票');
  ok(d1.data.viewer.can_see_result === false, '未投票看不到结果');
  ok(d1.data.result === null, '结果字段为空');
  ok(d1.data.questions.length === 4, '问题随详情返回');

  console.log('投票校验');
  const vShort = await call('vote.create', { id: offerId, choice: 'wait', reason: '太短', answers: [{ seq: 1, text: 'x' }] }, USER_B);
  ok(vShort.code === 40001, '理由长度不够被拒', vShort);

  const vNoAns = await call('vote.create', { id: offerId, choice: 'wait', reason: LONG_REASON, answers: [] }, USER_B);
  ok(vNoAns.code === 40001, '一个问题都没答被拒', vNoAns);

  const vSelf = await call('vote.create', { id: offerId, choice: 'wait', reason: LONG_REASON, answers: [{ seq: 1, text: 'x' }] }, USER_A);
  ok(vSelf.code === 40303, '不能审自己的 offer', vSelf);

  console.log('投票成功');
  const v1 = await call(
    'vote.create',
    { id: offerId, choice: 'wait', reason: LONG_REASON, answers: [{ seq: 1, text: '汇报人是 CTO，公司没有技术经理' }] },
    USER_B
  );
  ok(v1.code === 0, '投票成功', v1);
  ok(v1.data.total === 1 && v1.data.tally.wait === 1, '票型 +1');

  const meB = await call('me.get', {}, USER_B);
  ok(meB.data.quota.balance === 1, '审一份得 1 次额度');
  ok(meB.data.stats.votes === 1, '投票数已统计');

  const vAgain = await call(
    'vote.create',
    { id: offerId, choice: 'drop', reason: '换个判断再投一次看会不会被拦', answers: [{ seq: 1, text: 'x' }] },
    USER_B
  );
  ok(vAgain.code === 40302, '一人一票被唯一索引挡住', vAgain);

  const d2 = await call('offer.detail', { id: offerId }, USER_B);
  ok(d2.data.viewer.can_see_result === true, '投完票就能看结果');
  ok(d2.data.result.total === 1, '结果票数正确');
  ok(d2.data.result.votes[0].is_mine === true, '自己的票被标记');
  ok(d2.data.my_vote !== null, 'my_vote 回填');

  const listAfterVote = await call('offer.list', {}, USER_B);
  ok(listAfterVote.data.voted_ids.indexOf(offerId) >= 0, '列表回填「你已审」');

  const mineA0 = await call('offer.mine', {}, USER_A);
  ok(mineA0.code === 0 && mineA0.data.items.length === 1, 'offer.mine 能拿到自己发的');
  ok(mineA0.data.items[0].tally !== undefined, '自己的 offer 带票型');

  console.log('作者视角');
  const dAuthorEarly = await call('offer.detail', { id: offerId }, USER_A);
  ok(dAuthorEarly.data.viewer.is_author === true, '识别作者');
  ok(dAuthorEarly.data.viewer.can_vote === false, '作者没有投票入口');
  ok(dAuthorEarly.data.viewer.can_see_result === false, '只有 1 票时作者看不到结果');
  ok(dAuthorEarly.data.result === null, '作者结果为空');

  await call(
    'vote.create',
    { id: offerId, choice: 'take', reason: '这个位置给决策权，大厂要熬五年，值得赌。', answers: [{ seq: 2, text: '离职率大约 25%，去年走了 3 个' }] },
    USER_C
  );
  await call(
    'vote.create',
    { id: offerId, choice: 'wait', reason: '先去要一份排班表，再决定要不要签。别急着答复。', answers: [{ seq: 3, text: '考核写的是“上级评价”，没有量化' }] },
    USER_D
  );

  const dAuthor = await call('offer.detail', { id: offerId }, USER_A);
  ok(dAuthor.data.offer.vote_count === 3, '票数到 3');
  ok(dAuthor.data.viewer.can_see_result === true, '满 3 票作者解锁结果');
  ok(dAuthor.data.result.total === 3, '作者看到全部 3 票');
  ok(dAuthor.data.result.open_questions.length === 1, '还剩 1 个问题没人答');
  ok(dAuthor.data.result.tally.wait === 2 && dAuthor.data.result.tally.take === 1, '票型统计正确');

  console.log('结果接口的权限');
  const rOutsider = await call('offer.result', { id: offerId }, USER_E);
  ok(rOutsider.code === 40300, '没投票的人拿不到结果', rOutsider);

  const rVoter = await call('offer.result', { id: offerId }, USER_B);
  ok(rVoter.code === 0 && rVoter.data.result.total === 3, '投过票的人可以拿结果');

  console.log('决定与复盘');
  const decide = await call('offer.decide', { id: offerId, decision: 'drop' }, USER_A);
  ok(decide.code === 0, '作者定夺成功');
  const decideOther = await call('offer.decide', { id: offerId, decision: 'take' }, USER_B);
  ok(decideOther.code === 40300, '别人不能替作者决定');

  const review = await call('review.create', { id: offerId, text: '那句“上一任去哪了”救了我。' }, USER_A);
  ok(review.code === 0, '复盘写入成功');
  const reviewOther = await call('review.create', { id: offerId, text: '我不是作者也来写一句试试看' }, USER_B);
  ok(reviewOther.code === 40300, '只有作者能写复盘');

  console.log('配额：审 3 发 1');
  const c2 = await call(
    'offer.create',
    { role: '产品经理', industry: 'AI', city: '北京', pkg: '25k', dilemma: '团队在画饼，我怕进去背锅。' },
    USER_A
  );
  ok(c2.code === 40301, '没有额度时发不了第二条', c2);
  ok(c2.data && c2.data.need === 3, '提示还差 3 次审批', c2.data);

  // A 去审别人的三条
  const b1 = await call('offer.create', { role: '运营', industry: '电商', dilemma: '这家公司大小周，我怕扛不住。' }, USER_B);
  const b2 = await call('offer.create', { role: '设计', industry: '广告', dilemma: '这个岗位是画图岗，我怕没有成长。' }, USER_C);
  const b3 = await call('offer.create', { role: '财务', industry: '制造', dilemma: '月结要十天，我怕天天加班。' }, USER_D);
  ok(b1.code === 0 && b2.code === 0 && b3.code === 0, '其他人首单免费');

  const ids = [b1.data.id, b2.data.id, b3.data.id];
  for (let i = 0; i < ids.length; i++) {
    const r = await call(
      'vote.create',
      { id: ids[i], choice: 'wait', reason: '先问清楚汇报线和加班制度，再签字也不迟。', answers: [{ seq: 1, text: '直属上级是部门经理，来了两年' }] },
      USER_A
    );
    ok(r.code === 0, 'A 审了第 ' + (i + 1) + ' 份');
  }

  const meA = await call('me.get', {}, USER_A);
  ok(meA.data.quota.balance === 3, '审 3 份攒够 3 次额度');

  const c3 = await call(
    'offer.create',
    { role: '产品经理', industry: 'AI', city: '北京', pkg: '25k', dilemma: '团队在画饼，我怕进去背锅。' },
    USER_A
  );
  ok(c3.code === 0, '攒够额度后能发布', c3);
  const meA2 = await call('me.get', {}, USER_A);
  ok(meA2.data.quota.balance === 0, '发布扣掉 3 次额度');
  ok(meA2.data.quota.ledger.some(l => l.reason === 'publish' && l.delta === -3), '账本里有扣减记录');

  console.log('内容安全');
  const risky = await call(
    'offer.create',
    { role: '运营', industry: '电商', dilemma: '这个岗位需要你违规操作，我们加微信细聊。' },
    USER_E
  );
  ok(risky.code === 45101, '违规内容被拒', risky);
  ok(mock.rows('offers').every(o => o.dilemma.indexOf('违规') < 0), '违规内容没有落库');

  const pending = await call(
    'offer.create',
    { role: '运营', industry: '电商', dilemma: '这条内容待审一下，看看会不会进人工队列。' },
    USER_E
  );
  ok(pending.code === 0, '疑似内容仍然创建');
  ok(pending.data.status === 'reviewing', '疑似内容落 reviewing');
  ok(mock.rows('moderation_tasks').length >= 1, '进了人工队列');

  console.log('过期');
  const expiredId = b3.data.id;
  mock.rows('offers').forEach(o => {
    if (o._id === expiredId) o.deadline_at = Date.now() - 1000;
  });
  const vExpired = await call(
    'vote.create',
    { id: expiredId, choice: 'take', reason: '过了截止时间还能不能投票，这里应该被拦住。', answers: [{ seq: 1, text: 'x' }] },
    USER_E
  );
  ok(vExpired.code === 40901, '截止后不能投票', vExpired);

  console.log('举报与自动下架');
  const targetId = b1.data.id;
  const r1 = await call('report.create', { target_type: 'offer', target_id: targetId, reason: '像是软广' }, USER_A);
  const r2 = await call('report.create', { target_type: 'offer', target_id: targetId, reason: '像是软广' }, USER_C);
  ok(r1.data.auto_hidden === false && r2.data.auto_hidden === false, '两次举报还不下架');
  const r3 = await call('report.create', { target_type: 'offer', target_id: targetId, reason: '像是软广' }, USER_D);
  ok(r3.data.auto_hidden === true, '第三次举报自动下架');
  ok(mock.rows('offers').filter(o => o._id === targetId)[0].status === 'reviewing', '状态转 reviewing');

  console.log('后台');
  mock.rows('users').forEach(u => {
    if (u._id === USER_A) u.is_admin = true;
  });

  const q = await call('admin.queue', { status: 'pending' }, USER_A);
  ok(q.code === 0 && q.data.items.length >= 1, '审核队列有任务');
  const notAdmin = await call('admin.queue', {}, USER_B);
  ok(notAdmin.code === 40304, '非管理员进不去后台');

  const task = q.data.items.filter(t => t.target_type === 'offer')[0];
  const approve = await call('admin.moderate', { task_id: task.id, action: 'approve' }, USER_A);
  ok(approve.code === 0 && approve.data.status === 'published', '审核通过后重新上架');
  const approveAgain = await call('admin.moderate', { task_id: task.id, action: 'reject' }, USER_A);
  ok(approveAgain.code === 40300, '同一个任务不能处理两次');

  console.log('定时任务');
  const before = mock.rows('offers').filter(o => o.status === 'published').length;
  mock.rows('offers').forEach(o => {
    if (o._id === b2.data.id) o.deadline_at = Date.now() - 1000;
  });
  const tick = await timer.main({ type: 'minute' });
  ok(tick.expired >= 1, '过期收口生效：' + tick.expired);

  // 人为制造票型漂移，再跑对账
  mock.rows('offers').forEach(o => {
    if (o._id === offerId) o.tally = { take: 99, wait: 99, drop: 99 };
  });
  const rec = await timer.main({ type: 'hour' });
  ok(rec.fixed >= 1, '对账修复了漂移：' + rec.fixed);
  const fixedOffer = mock.rows('offers').filter(o => o._id === offerId)[0];
  ok(fixedOffer.tally.wait === 2 && fixedOffer.tally.take === 1 && fixedOffer.tally.drop === 0, '票型被校准回真实值');

  console.log('未知 action');
  const unknown = await call('nope.nope', {}, USER_A);
  ok(unknown.code === 40001, '未知 action 返回参数错误');

  console.log('\n结果');
  console.log('  offers:', mock.rows('offers').length, '| votes:', mock.rows('votes').length,
    '| ledger:', mock.rows('quota_ledger').length, '| tasks:', mock.rows('moderation_tasks').length);
  console.log(failures ? 'FAILED: ' + failures : 'ALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.log('  \u2717 抛异常：' + err.message);
  console.log(err.stack);
  process.exit(1);
});

/**
 * 页面层冒烟测试（不依赖微信开发者工具）
 * 跑法：node dev/simulate.js
 *
 * 这里刻意不 mock api 本身：wx 上没有 cloud，api 会自动降级到本地演示实现，
 * 所以测试跑的是「页面 → api → 降级 → mock 后端」这条真实链路。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------------- 伪造小程序环境 ---------------- */
const storage = {};
const calls = { toast: [], nav: [], modal: [] };
let modalMode = 'confirm';
let capturedPage = null;

global.wx = {
  getStorageSync(k) {
    return storage[k] === undefined ? '' : storage[k];
  },
  setStorageSync(k, v) {
    storage[k] = JSON.parse(JSON.stringify(v));
  },
  removeStorageSync(k) {
    delete storage[k];
  },
  showToast(o) {
    calls.toast.push(o.title);
  },
  showModal(o) {
    calls.modal.push(o.title || '');
    if (!o.success) return;
    if (modalMode === 'cancel') o.success({ confirm: false });
    else o.success({ confirm: true, content: '当时那句“上一任去哪了”救了我。' });
  },
  navigateTo(o) {
    calls.nav.push(o.url);
  },
  navigateBack() {},
  switchTab(o) {
    calls.nav.push(o.url);
  },
  stopPullDownRefresh() {}
};

global.App = opts => {
  global.__app = opts;
};
global.Page = opts => {
  capturedPage = opts;
};

// 页面里的定时器不需要真的跑
const realSetInterval = global.setInterval;
global.setInterval = () => 0;
global.clearInterval = () => {};

/* ---------------- 工具 ---------------- */
let failures = 0;
function ok(cond, label, extra) {
  if (cond) {
    console.log('  \u2713 ' + label);
  } else {
    console.log('  \u2717 ' + label + (extra ? '  → ' + JSON.stringify(extra) : ''));
    failures++;
  }
}

function setPath(obj, key, value) {
  const parts = key.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function loadPage(rel) {
  const abs = require.resolve(path.join(ROOT, rel));
  delete require.cache[abs];
  capturedPage = null;
  require(abs);
  if (!capturedPage) throw new Error('页面没有调用 Page(): ' + rel);

  const page = Object.assign({}, capturedPage);
  page.data = JSON.parse(JSON.stringify(capturedPage.data || {}));
  page.setData = function (patch) {
    Object.keys(patch).forEach(k => setPath(this.data, k, patch[k]));
  };
  return page;
}

/** 等一轮事件循环，让页面里的 await 走完 */
function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/* ---------------- 静态检查 ---------------- */
function checkStatic() {
  console.log('静态');

  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  let pagesOk = true;
  appJson.pages.forEach(p => {
    ['js', 'wxml', 'json'].forEach(ext => {
      if (!fs.existsSync(path.join(ROOT, p + '.' + ext))) pagesOk = false;
    });
  });
  ok(pagesOk, '每个页面的 js/wxml/json 都在');

  // 客户端禁止直连数据库：出现一次，视角隔离就作废了
  const jsFiles = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        if (f !== 'cloudfunctions' && f !== 'dev' && f !== 'node_modules') walk(full);
      } else if (f.endsWith('.js')) {
        jsFiles.push(full);
      }
    });
  })(ROOT);

  let direct = 0;
  jsFiles.forEach(f => {
    const src = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (src.indexOf('wx.cloud.database') >= 0) direct++;
  });
  ok(direct === 0, '小程序端没有直接访问数据库（全走 callFunction）');

  let apiOnly = true;
  ['pages/plaza/plaza.js', 'pages/detail/detail.js', 'pages/submit/submit.js', 'pages/mine/mine.js'].forEach(p => {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (src.indexOf("require('../../utils/api')") < 0) apiOnly = false;
  });
  ok(apiOnly, '四个页面都从 utils/api 取数');
}

/* ---------------- WXML 与 data 对账 ---------------- */
function checkWxml() {
  console.log('wxml 绑定');
  const whitelist = ['item', 'index', 'a', 'true', 'false', 'null', 'undefined'];

  const pages = [
    { name: 'plaza', file: 'pages/plaza/plaza' },
    { name: 'submit', file: 'pages/submit/submit' },
    { name: 'detail', file: 'pages/detail/detail' },
    { name: 'mine', file: 'pages/mine/mine' }
  ];

  pages.forEach(p => {
    const wxml = fs.readFileSync(path.join(ROOT, p.file + '.wxml'), 'utf8');
    const page = loadPage(p.file + '.js');
    const keys = Object.keys(page.data);

    const exprs = wxml.match(/\{\{[^}]+\}\}/g) || [];
    const missing = new Set();

    exprs.forEach(raw => {
      const expr = raw.slice(2, -2).trim();
      const m = expr.match(/^!?\s*([A-Za-z_$][\w$]*)/);
      if (!m) return;
      if (whitelist.indexOf(m[1]) >= 0) return;
      if (keys.indexOf(m[1]) < 0) missing.add(m[1]);
    });

    ok(
      missing.size === 0,
      p.name + '.wxml 绑定的字段都在 data 里' + (missing.size ? '：缺 ' + Array.from(missing).join(',') : '')
    );
  });
}

/* ---------------- 流程 ---------------- */
async function runFlows() {
  // 页面测试只验证页面逻辑本身，强制走内置演示数据，不依赖本地后端是否在跑
  storage['__api_mode'] = 'local';

  console.log('启动');
  require(path.join(ROOT, 'app.js'));
  global.__app.onLaunch();
  const api = require(path.join(ROOT, 'utils/api.js'));
  ok(api.mode() === 'local', '按 __api_mode 强制走内置演示');

  console.log('广场');
  const plaza = loadPage('pages/plaza/plaza.js');
  plaza.onLoad();
  plaza.onShow();
  await flush();

  ok(plaza.data.loading === false, '加载完成');
  ok(plaza.data.error === '', '没有错误');
  ok(plaza.data.items.length === 5, '拿到 5 条种子数据');
  ok(!!plaza.data.items[0].remain && plaza.data.items[0].remain !== '已截止', '倒计时已计算：' + plaza.data.items[0].remain);
  ok(plaza.data.items[0].voted === false, '未审过时没有“你已审”标记');
  ok(plaza.data.mode === 'local', '页面知道自己在演示模式');

  const firstId = plaza.data.items[0].id;

  console.log('详情页');
  const detail = loadPage('pages/detail/detail.js');
  detail.onLoad({ id: firstId });
  detail.onShow();
  await flush();

  ok(detail.data.loading === false, '详情加载完成');
  ok(detail.data.offer && detail.data.offer.role, 'offer 渲染数据齐了');
  ok(detail.data.questions.length >= 3, '问题 ' + detail.data.questions.length + ' 个');
  ok(detail.data.viewer.can_vote === true, '可以投票');
  ok(detail.data.viewer.can_see_result === false, '投票前看不到结果');
  ok(detail.data.result === null, '结果为空');
  ok(detail.data.answers.length === detail.data.questions.length, '答题框已初始化');

  console.log('审批');
  detail.onChoose({ currentTarget: { dataset: { k: 'wait' } } });
  ok(detail.data.choice === 'wait', '选中“再等等”');

  const toastBefore = calls.toast.length;
  await detail.submitVote();
  ok(detail.data.result === null && calls.toast.length > toastBefore, '理由为空时被拦下');

  detail.onReason({ detail: { value: '按时薪算是降薪，先去要一份近半年的排班记录再签。' } });
  await detail.submitVote();
  ok(detail.data.result === null, '没答题时也被拦下');

  detail.onAnswer({ currentTarget: { dataset: { idx: 0 } }, detail: { value: '汇报人是新来的总监，才来 4 个月' } });
  await detail.submitVote();
  await flush();

  ok(detail.data.viewer.has_voted === true, '投票成功');
  ok(detail.data.result !== null, '投票后结果出现');
  ok(detail.data.result.total > 0, '票数 ' + detail.data.result.total);
  ok(detail.data.result.votes.some(v => v.mine), '自己的票在列表里');
  ok(detail.data.viewer.can_vote === false, '投完不再显示表单');
  detail.onHide();

  console.log('广场回填');
  const plaza2 = loadPage('pages/plaza/plaza.js');
  plaza2.onLoad();
  plaza2.onShow();
  await flush();
  ok(plaza2.data.items.filter(i => i.voted).length === 1, '广场回填了“你已审”');

  console.log('发一条');
  const submit = loadPage('pages/submit/submit.js');
  submit.onShow();
  submit.onInput({ currentTarget: { dataset: { field: 'role' } }, detail: { value: '后端开发' } });
  submit.onInput({ currentTarget: { dataset: { field: 'industry' } }, detail: { value: 'SaaS' } });
  submit.onInput({ currentTarget: { dataset: { field: 'dilemma' } }, detail: { value: '团队只有三个人，我怕进去什么都得自己扛。' } });
  submit.onHours({ detail: { value: '2' } });

  const navBefore = calls.nav.length;
  await submit.onSubmit();
  ok(calls.nav.length === navBefore + 1, '提交后跳到详情页');
  const newUrl = calls.nav[calls.nav.length - 1];
  const newId = newUrl.split('id=')[1];
  ok(!!newId, '拿到了新 offer 的 id');

  console.log('作者视角');
  const mineDetail = loadPage('pages/detail/detail.js');
  mineDetail.onLoad({ id: newId });
  mineDetail.onShow();
  await flush();

  ok(mineDetail.data.viewer.is_author === true, '识别为作者');
  ok(mineDetail.data.viewer.can_vote === false, '作者没有投票入口');
  ok(mineDetail.data.viewer.can_see_result === false, '0 票时作者看不到结果');
  ok(mineDetail.data.offer.status === 'published', '状态是已发布');

  console.log('决定与复盘');
  await mineDetail.onDecide({ currentTarget: { dataset: { d: 'drop' } } });
  await flush();
  ok(mineDetail.data.offer.decision === 'drop', '决定已记录');

  mineDetail.onReview();
  await flush();
  ok(calls.modal.length > 0, '复盘弹窗被唤起');
  ok(!!storage['opw_mock_v1'].reviews[newId], '复盘写进了本地演示存储');
  mineDetail.onHide();

  console.log('我的');
  const mine = loadPage('pages/mine/mine.js');
  mine.onShow();
  await flush();
  ok(mine.data.loading === false, '我的页加载完成');
  ok(mine.data.offers.length === 1, '我提的 offer 有 1 条');
  ok(mine.data.offers[0].statusText === '已定', '状态文案是“已定”');
  ok(mine.data.stats.votes === 1, '我审过 1 条');

  console.log('异常');
  const bad = loadPage('pages/detail/detail.js');
  bad.onLoad({ id: 'not-exist' });
  bad.onShow();
  await flush();
  ok(bad.data.loading === false && bad.data.error !== '', '打不开的 id 给出错误态而不是白屏');
  ok(bad.data.error.indexOf('不在了') >= 0, '错误文案可读：' + bad.data.error);

  const noParam = loadPage('pages/detail/detail.js');
  noParam.onLoad({});
  noParam.onShow();
  await flush();
  ok(noParam.data.error === '缺少参数', '没有 id 时不做无效请求');

  global.setInterval = realSetInterval;
}

(async function () {
  try {
    checkStatic();
    checkWxml();
    await runFlows();
  } catch (err) {
    console.log('  \u2717 抛异常：' + err.message);
    console.log(err.stack);
    failures++;
  }

  console.log(failures ? '\nFAILED: ' + failures : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

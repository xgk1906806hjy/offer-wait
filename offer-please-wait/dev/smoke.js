/* 轻量冒烟测试：用假 DOM 跑一遍 app.js 的完整交互链路。
   运行：node dev/smoke.js  （退出码非 0 表示有断言失败） */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* ---------- 假 DOM ---------- */
function makeEl(tag) {
  const node = {
    tagName: tag || 'div',
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    attrs: {},
    style: { cssText: '' },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (on) { this._s.add(c); } else { this._s.delete(c); }
      },
      contains(c) { return this._s.has(c); }
    },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild() {},
    addEventListener() {},
    closest() { return this.attrs['data-act'] ? this : null; },
    querySelectorAll() { return []; }
  };
  return node;
}

const byId = new Map();
const tabs = ['plaza', 'submit', 'mine'].map(n => { const e = makeEl('button'); e.attrs['data-nav'] = n; return e; });

let clickHandler = null;

const document = {
  getElementById(id) {
    if (!byId.has(id)) byId.set(id, makeEl('div'));
    return byId.get(id);
  },
  querySelectorAll(sel) {
    if (sel === '#tabs button') return tabs;
    return [];
  },
  createElement(t) { return makeEl(t); },
  addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
  body: { appendChild() {} }
};

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const ctx = {
  document,
  localStorage,
  window: { addEventListener() {} },
  location: { reload() {} },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => {},
  console,
  Math,
  Date,
  JSON,
  Number,
  String,
  Object,
  Array,
  Set
};
ctx.globalThis = ctx;

/* ---------- 执行 ---------- */
let failures = 0;
function ok(cond, label) {
  if (cond) { console.log('  \u2713 ' + label); }
  else { console.log('  \u2717 ' + label); failures++; }
}
function html() { return document.getElementById('app').innerHTML; }
function has(s) { return html().indexOf(s) >= 0; }
function click(attrs) {
  const t = makeEl('button');
  Object.keys(attrs).forEach(k => { t.attrs[k] = attrs[k]; });
  clickHandler({ target: t });
}
function clean() {
  const bad = [];
  if (/\bundefined\b/.test(html())) bad.push('undefined');
  if (/\bNaN\b/.test(html())) bad.push('NaN');
  return bad;
}
function setVal(id, v) { document.getElementById(id).value = v; }

try {
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'app.js' });

  console.log('static wiring');
  const pageHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tabAttrs = pageHtml.match(/data-nav="[a-z]+"/g) || [];
  ok(tabAttrs.length === 3, '三个标签都在');
  const tabActs = pageHtml.match(/data-act="nav"/g) || [];
  ok(tabActs.length === 3, '标签按钮带 data-act="nav"（否则点击无效）');
  const acts = new Set((pageHtml.match(/data-act="([a-z-]+)"/g) || []).map(s => s.slice(10, -1)));
  let wired = true;
  acts.forEach(a => { if (code.indexOf("'" + a + "'") < 0) wired = false; });
  ok(wired, 'index.html 里的 data-act 都能在 app.js 找到对应处理');

  console.log('load');
  ok(html().length > 200, '广场渲染出来了');
  ok(has('去审批') || has('你已审'), '卡片有审批入口');
  ok(clean().length === 0, '广场没有 undefined/NaN ' + clean().join(','));

  const m = html().match(/data-act="open" data-id="([^"]+)"/);
  ok(!!m, '能取到一条 offer');
  const id = m && m[1];

  console.log('open detail');
  click({ 'data-act': 'open', 'data-id': id });
  ok(has('签字前必须问清楚'), '详情页有问题清单');
  ok(has('你来审'), '未投票时显示审批表单');
  ok(!has('审批结果'), '未投票时看不到别人结论（先投后看）');

  console.log('vote');
  click({ 'data-act': 'choose', 'data-choice': 'wait' });
  setVal('v-reason', '按时薪算是降薪，先去要一份近半年的排班记录再签。');
  setVal('v-ans-0', '汇报人是新来的总监，才来 4 个月');
  click({ 'data-act': 'vote' });
  ok(has('审批结果'), '投票后出现结果');
  ok(has('拿走这张清单'), '结果页给行动清单');
  ok(!has('你来审'), '投票后审批表单消失');
  ok(clean().length === 0, '结果页没有 undefined/NaN');

  console.log('submit offer');
  click({ 'data-act': 'nav', 'data-nav': 'submit' });
  ok(has('脱敏后再发'), '提交页渲染');
  setVal('f-role', '后端开发');
  setVal('f-industry', 'SaaS');
  setVal('f-city', '杭州');
  setVal('f-pkg', '20-24k x 14');
  setVal('f-dilemma', '钱给得够，但团队只有三个人，我怕进去什么都得自己扛。');
  click({ 'data-act': 'submit-offer' });
  ok(has('后端开发'), '提交后跳到自己的 offer');
  ok(has('你来审'), '自己的 offer 也能被别人审');
  ok(clean().length === 0, '新 offer 页没有 undefined/NaN');

  console.log('decide');
  click({ 'data-act': 'decide', 'data-d': 'take' });
  ok(has('你的决定'), '决定被记录');
  ok(has('现在就写一句复盘'), '出现复盘入口');

  console.log('review modal');
  click({ 'data-act': 'review', 'data-id': id });
  ok(document.getElementById('modal').hidden === false, '复盘弹层打开');
  setVal('rv', '那句“上一任去哪了”救了我。');
  click({ 'data-act': 'save-review', 'data-id': id });
  ok(document.getElementById('modal').hidden === true, '复盘弹层关闭');
  ok(store.has('offer-please-wait:v1'), '数据写进了 localStorage');

  console.log('mine');
  click({ 'data-act': 'nav', 'data-nav': 'mine' });
  ok(has('我提交的'), '我的页渲染');
  ok(has('后端开发'), '我的页列出自提的 offer');
  ok(has('我审过的'), '有审批战绩');
  ok(clean().length === 0, '我的页没有 undefined/NaN');

  console.log('reload persistence');
  const saved = store.get('offer-please-wait:v1');
  const parsed = JSON.parse(saved);
  ok(parsed.offers.some(o => o.mine), '自己提的 offer 已持久化');
  ok(parsed.offers.some(o => o.votes.some(v => v.mine)), '我的审批已持久化');
  ok(!!parsed.reviews[id], '复盘已持久化');
} catch (err) {
  console.log('  \u2717 抛异常：' + err.message);
  console.log(err.stack);
  failures++;
}

console.log(failures ? '\nFAILED: ' + failures : '\nALL PASS');
process.exit(failures ? 1 : 0);

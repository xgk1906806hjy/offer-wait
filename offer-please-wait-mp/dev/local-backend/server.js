/**
 * 本地后端服务（开发用）
 *
 * 跑的是**真实的云函数代码**：cloudfunctions/api 一行没改，
 * 只是把 wx-server-sdk 换成「文件持久化」的实现，于是它变成了一个能监听端口的服务。
 *
 * 用途：
 *  - 两个浏览器窗口用不同 openid，真的能互相看见、互相审；
 *  - 数据落在 dev/local-backend/data.json，重启不丢；
 *  - 接真云环境之前，先把前后端契约跑顺。
 *
 * 它不是生产运行时：没有鉴权、没有并发控制、单进程内存索引。
 *
 * 用法：node dev/local-backend/server.js [port]
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { createCloud } = require('../mock-sdk');

const PORT = Number(process.argv[2]) || 8898;
const DATA_FILE = path.join(__dirname, 'data.json');

const mock = createCloud({ persistPath: DATA_FILE });

// 必须在 require 云函数之前替换掉 wx-server-sdk
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return mock.cloud;
  return origLoad.apply(this, arguments);
};

const api = require('../../cloudfunctions/api/index.js');

/* ---------------- 首次启动灌演示数据（走真实接口） ---------------- */

const DEMO = [
  {
    author: 'openid-author-1',
    payload: {
      role: '跨境电商运营（资深）',
      industry: '跨境电商',
      city: '深圳',
      company: '某跨境电商上市公司',
      pkg: '18–22k × 14–16',
      dilemma: '涨幅 30%，但要从 965 变成 996。我怕的不是累，是三年后身体和简历一起垮。',
      alternatives: 'pending',
      asked: '问过加班强度、团队规模',
      ttl_hours: 24
    },
    votes: [
      { choice: 'wait', reason: '涨 30% 买你每天多干 3 小时，按时薪算其实是降薪。先去要一份近半年的排班记录。', answers: [{ seq: 1, text: '汇报人是新来的总监，自己才来 4 个月' }] },
      { choice: 'take', reason: '26 岁，这个涨幅和履历值得换。但把“不强制周末”写进补充条款，不然就是空话。', answers: [{ seq: 2, text: '离职率大约 25%，去年走了 3 个' }] },
      { choice: 'drop', reason: '你已经在用“怕垮”这个词了。身体给过信号的人，不要再去赌一次。', answers: [{ seq: 3, text: '试用期写的是“上级综合评价”，没有量化指标' }] }
    ]
  },
  {
    author: 'openid-author-2',
    payload: {
      role: '新能源供应链管培',
      industry: '新能源',
      city: '常州',
      company: '某新能源车企',
      pkg: '12–14k × 13',
      dilemma: '不是核心城市，但给落户和宿舍。我怕错过校招窗口，明年就没有这种管培项目了。',
      alternatives: 'none',
      asked: '',
      ttl_hours: 24
    },
    votes: [
      { choice: 'take', reason: '校招窗口确实不可逆，社招进管培的概率极低。城市以后能换，身份窗口只有一次。', answers: [{ seq: 1, text: '直属上级是供应链总监，已经来了 5 年' }] },
      { choice: 'wait', reason: '先确认“管培”是不是真轮岗。很多管培就是定向岗，轮完还得回原部门。', answers: [{ seq: 4, text: '前两届 12 个人，现在只剩 5 个还在公司' }] }
    ]
  },
  {
    author: 'openid-author-3',
    payload: {
      role: '投行承做',
      industry: '券商',
      city: '上海',
      company: '某头部券商',
      pkg: '25–30k × 12 + 奖金',
      dilemma: '团队去年裁过一轮，HR 说不会再有。我该信吗？',
      alternatives: 'have',
      asked: '问过裁员原因',
      ttl_hours: 48
    },
    votes: [
      { choice: 'wait', reason: 'HR 说“不会再有”是信息量最低的一句话。去问在职的人：去年裁的是哪个组、按什么标准。', answers: [{ seq: 2, text: '公开信息查不到，问了两个前员工，都说“看项目储备”' }] },
      { choice: 'drop', reason: '你手上还有另一个 offer，就不该在一个刚裁过员的团队上赌。投行的团队比公司重要。', answers: [{ seq: 3, text: '奖金去年只发了 0.5 个月，base 占七成' }] }
    ]
  },
  {
    author: 'openid-author-4',
    payload: {
      role: 'AI 产品经理',
      industry: 'AI 创业公司',
      city: '北京',
      company: '某 A 轮 AI 公司（40 人）',
      pkg: '20–25k × 13 + 期权',
      dilemma: '创始人很会讲，期权占我总包 40%。要不要赌一把？',
      alternatives: 'have',
      asked: '问过融资进度',
      ttl_hours: 72
    },
    votes: [
      { choice: 'wait', reason: '期权 40% 不是福利，是把你的工资押在公司估值上。先问行权价、回购条款、离职后多久必须行权。', answers: [{ seq: 1, text: '直属汇报人就是创始人本人，公司没有产品总监' }] },
      { choice: 'drop', reason: 'A 轮、40 人、创始人直接带产品——你进去是唯一的产品，也是唯一的背锅位。', answers: [{ seq: 2, text: '团队 6 个人，产品只有我一个' }] }
    ]
  },
  {
    author: 'openid-author-5',
    payload: {
      role: '快消市场管培',
      industry: '外企快消',
      city: '广州',
      company: '某外资快消',
      pkg: '15–18k × 13',
      dilemma: '工作轻松、氛围好，但我怕三年后没有竞争力，出去什么都不会。',
      alternatives: 'pending',
      asked: '问过轮岗安排',
      ttl_hours: 168
    },
    votes: [
      { choice: 'wait', reason: '“轻松”不是问题，“三年后没有可迁移的技能”才是。问他：这个岗位出去的人一般去哪。', answers: [{ seq: 4, text: '轮岗是挂名，前两届都留在了原部门' }] },
      { choice: 'take', reason: '管培的牌子本身就是竞争力，外企的流程训练在民企很值钱。别被“躺平焦虑”绑架。', answers: [{ seq: 3, text: '考核是 360 环评，没有硬指标' }] }
    ]
  }
];

const VOTER_POOL = ['openid-voter-1', 'openid-voter-2', 'openid-voter-3', 'openid-voter-4'];

async function seedIfEmpty() {
  if (mock.rows('offers').length) return;

  console.log('[seed] 空库，用真实接口灌入 ' + DEMO.length + ' 条演示数据…');

  for (let i = 0; i < DEMO.length; i++) {
    const d = DEMO[i];
    mock.setUser(d.author);

    const created = await api.main({ action: 'offer.create', payload: d.payload });
    if (created.code !== 0) {
      console.log('[seed] 创建失败', created);
      continue;
    }

    const id = created.data.id;

    for (let j = 0; j < d.votes.length; j++) {
      const v = d.votes[j];
      mock.setUser(VOTER_POOL[j % VOTER_POOL.length]);
      const res = await api.main({
        action: 'vote.create',
        payload: { id: id, choice: v.choice, reason: v.reason, answers: v.answers }
      });
      if (res.code !== 0) console.log('[seed] 投票失败', res.code, res.message);
    }
  }

  mock.flush();
  console.log(
    '[seed] 完成：offers=' + mock.rows('offers').length +
      ' votes=' + mock.rows('votes').length +
      ' questions=' + mock.rows('offer_questions').length
  );
}

/* ---------------- HTTP ---------------- */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-openid');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url.indexOf('/health') === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        offers: mock.rows('offers').length,
        votes: mock.rows('votes').length,
        users: mock.rows('users').length
      })
    );
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('method not allowed');
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw || '{}');
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 40001, message: '请求体不是合法 JSON' }));
    return;
  }

  // 开发用：用 header 模拟不同用户，方便两个窗口互相审
  const openid = req.headers['x-openid'] || body.openid || 'openid-dev';
  mock.setUser(openid);

  const out = await api.main({ action: body.action, payload: body.payload || {} });

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out));
});

seedIfEmpty()
  .catch(e => console.log('[seed] 异常', e))
  .then(() => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log('backend: http://127.0.0.1:' + PORT + '/api  (health: /health)');
      console.log('data:    ' + DATA_FILE);
    });
  });

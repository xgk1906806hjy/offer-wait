'use strict';

/* =========================================================
   offer 请等等 —— 原型
   骨架沿用《钱包请等等》，但改了三处（见 PRD）：
   1) 三态判决：接 / 再等等 / 别接
   2) 必答问题：审批人必须回答至少一个"签字前该问的事"
   3) 结果不是结论，是可执行的行动清单
   ========================================================= */

var KEY = 'offer-please-wait:v1';
var HOUR = 3600 * 1000;
var MIN_REASON = 10;

var GENERIC_Q = [
  '这个岗位的直接汇报人是谁？他在这家公司待了多久？',
  '这个组过去 12 个月的离职率大概是多少？',
  '试用期的考核标准写进合同了吗？有量化指标吗？',
  '最近一个月，组里最晚几点关灯？周末要在线吗？'
];

var ROLE_Q = [
  { k: ['运营'], q: '这个岗位背的 KPI 是谁定的？上一任去哪了？' },
  { k: ['产品'], q: '需求谁拍板？期权占你总包多少，行权价和回购条款看过吗？' },
  { k: ['投行', '券商', '承做', '金融'], q: '团队去年的项目储备有多少？裁员的传闻你打算怎么核实？' },
  { k: ['供应链', '采购', '物流'], q: 'base 地的社保和公积金按什么基数缴？' },
  { k: ['市场', '品牌', '营销'], q: '这个岗位能动的预算规模是多少？三年后这个岗位的人一般去哪？' },
  { k: ['开发', '工程师', '算法', '研发', '技术'], q: '团队的 oncall 频率是多少？技术债和上线节奏你了解吗？' },
  { k: ['管培', '培训生'], q: '这个管培项目是真轮岗还是挂名？前两届的人现在在哪？' }
];

var CHOICE = {
  take: { label: '接', en: 'TAKE' },
  wait: { label: '再等等', en: 'WAIT' },
  drop: { label: '别接', en: 'DROP' }
};

var ALT = {
  none: '没有，就这一个',
  pending: '在等另一家',
  have: '手上还有一个'
};

/* ---------------- 工具 ---------------- */

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '"') return '&quot;';
    return '&#39;';
  });
}

function fmtRemain(ms) {
  if (ms <= 0) return '已截止';
  var totalMin = Math.floor(ms / 60000);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  if (h >= 24) {
    var d = Math.floor(h / 24);
    var rh = h % 24;
    return rh ? d + ' 天 ' + rh + ' 小时' : d + ' 天';
  }
  return h + ' 小时 ' + m + ' 分';
}

function generateQuestions(role) {
  var list = GENERIC_Q.slice(0, 3);
  var r = String(role || '');
  for (var i = 0; i < ROLE_Q.length; i++) {
    var hit = false;
    for (var j = 0; j < ROLE_Q[i].k.length; j++) {
      if (r.indexOf(ROLE_Q[i].k[j]) >= 0) { hit = true; break; }
    }
    if (hit) { list.push(ROLE_Q[i].q); break; }
  }
  return list;
}

/* ---------------- 种子数据 ---------------- */

function seed() {
  var now = Date.now();

  var raw = [
    {
      role: '跨境电商运营（资深）',
      industry: '跨境电商',
      city: '深圳',
      company: '某跨境电商上市公司',
      pkg: '18–22k × 14–16',
      dilemma: '涨幅 30%，但要从 965 变成 996。我怕的不是累，是三年后身体和简历一起垮。',
      alternatives: 'pending',
      asked: '问过加班强度、团队规模',
      hours: 26,
      votes: [
        { choice: 'wait', reason: '涨 30% 买你每天多干 3 小时，按时薪算其实是降薪。先去要一份近半年的排班记录。', answers: { 0: '汇报人是新来的总监，自己才来 4 个月' } },
        { choice: 'wait', reason: '996 的公司谈“弹性”都是假的。问他一句：上周六有人在群里发过消息吗？' },
        { choice: 'take', reason: '26 岁，这个涨幅和履历值得换。但把“不强制周末”写进 offer 补充条款，不然就是空话。' },
        { choice: 'drop', reason: '你已经在用“怕垮”这个词了。身体给过信号的人，不要再去赌一次。', answers: { 2: '试用期写的是“上级综合评价”，没有量化指标' } }
      ]
    },
    {
      role: '新能源供应链管培',
      industry: '新能源',
      city: '常州',
      company: '某新能源车企',
      pkg: '12–14k × 13',
      dilemma: '不是核心城市，但给落户和宿舍。我怕错过校招窗口，明年就没有这种管培项目了。',
      alternatives: 'none',
      asked: '',
      hours: 8,
      votes: [
        { choice: 'take', reason: '校招窗口确实不可逆，社招进管培的概率极低。城市以后能换，身份窗口只有一次。' },
        { choice: 'wait', reason: '先确认“管培”是不是真轮岗。很多管培就是定向岗，轮完还得回原部门。', answers: { 3: '前两届 12 个人，现在只剩 5 个还在公司' } },
        { choice: 'take', reason: '落户加宿舍，等于前两年帮你省了八万。先落地，再谈喜不喜欢。' }
      ]
    },
    {
      role: '投行承做',
      industry: '券商',
      city: '上海',
      company: '某头部券商',
      pkg: '25–30k × 12 + 奖金',
      dilemma: '团队去年裁过一轮，HR 说不会再有。我该信吗？',
      alternatives: 'have',
      asked: '问过裁员原因',
      hours: 52,
      votes: [
        { choice: 'wait', reason: 'HR 说“不会再有”是信息量最低的一句话。去问在职的人：去年裁的是哪个组、按什么标准。', answers: { 1: '公开信息查不到，问了两个前员工，都说“看项目储备”' } },
        { choice: 'drop', reason: '你手上还有另一个 offer，就不该在一个刚裁过员的团队上赌。投行的团队比公司重要。' },
        { choice: 'wait', reason: '奖金占多少？如果 base 只占六成，25–30k 是画出来的。' }
      ]
    },
    {
      role: 'AI 产品经理',
      industry: 'AI 创业公司',
      city: '北京',
      company: '某 A 轮 AI 公司（40 人）',
      pkg: '20–25k × 13 + 期权',
      dilemma: '创始人很会讲，期权占我总包 40%。要不要赌一把？',
      alternatives: 'have',
      asked: '问过融资进度',
      hours: 15,
      votes: [
        { choice: 'wait', reason: '期权 40% 不是福利，是把你的工资押在公司估值上。先问：行权价多少、回购条款谁定、离职后多久必须行权。', answers: { 0: '直属汇报人就是创始人本人，公司没有产品总监' } },
        { choice: 'drop', reason: 'A 轮、40 人、创始人直接带产品——你进去是唯一的产品，也是唯一的背锅位。' },
        { choice: 'take', reason: '如果期权条款干净，这个位置给你的决策权，在大厂要熬五年。但一定要看期权协议原文。', answers: { 3: '目前 995，创始人说“不强制加班”' } }
      ]
    },
    {
      role: '快消市场管培',
      industry: '外企快消',
      city: '广州',
      company: '某外资快消',
      pkg: '15–18k × 13',
      dilemma: '工作轻松、氛围好，但我怕三年后没有竞争力，出去什么都不会。',
      alternatives: 'pending',
      asked: '问过轮岗安排',
      hours: 70,
      votes: [
        { choice: 'wait', reason: '“轻松”不是问题，“三年后没有可迁移的技能”才是。问他：这个岗位出去的人一般去哪。' },
        { choice: 'take', reason: '管培的牌子本身就是竞争力，外企的流程训练在民企很值钱。别被“躺平焦虑”绑架。' },
        { choice: 'wait', reason: '你已经有“怕”的感觉了。先干一个完整项目，再判断是不是真的学不到东西。', answers: { 2: '考核是 360 环评，没有硬指标' } }
      ]
    }
  ];

  return raw.map(function (r) {
    return {
      id: uid(),
      role: r.role,
      industry: r.industry,
      city: r.city,
      company: r.company,
      pkg: r.pkg,
      dilemma: r.dilemma,
      alternatives: r.alternatives,
      asked: r.asked,
      deadline: now + r.hours * HOUR,
      questions: generateQuestions(r.role),
      votes: r.votes,
      mine: false,
      decision: null
    };
  });
}

/* ---------------- 状态 ---------------- */

var state = null;
var tab = 'plaza';
var screen = 'plaza';
var currentId = null;
var draft = { choice: null };

function load() {
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && s.offers && s.offers.length) {
        if (!s.reviews) s.reviews = {};
        return s;
      }
    }
  } catch (e) { /* 无痕模式或 file:// 限制，忽略 */ }
  return { offers: seed(), reviews: {} };
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

function reviveIfDead() {
  var now = Date.now();
  var alive = false;
  for (var i = 0; i < state.offers.length; i++) {
    if (state.offers[i].deadline > now) { alive = true; break; }
  }
  if (!alive) {
    state.offers.forEach(function (o, i) {
      o.deadline = now + (4 + i * 9) * HOUR;
    });
  }
}

function findOffer(id) {
  for (var i = 0; i < state.offers.length; i++) {
    if (state.offers[i].id === id) return state.offers[i];
  }
  return null;
}

function myVote(o) {
  for (var i = 0; i < o.votes.length; i++) {
    if (o.votes[i].mine) return o.votes[i];
  }
  return null;
}

function tally(o) {
  var c = { take: 0, wait: 0, drop: 0 };
  o.votes.forEach(function (v) { c[v.choice] = (c[v.choice] || 0) + 1; });
  return c;
}

function verdictOf(o) {
  var c = tally(o);
  if (!o.votes.length) return 'wait';
  if (c.wait >= c.take && c.wait >= c.drop) return 'wait';
  if (c.take >= c.drop) return 'take';
  return 'drop';
}

/* ---------------- 视图：广场 ---------------- */

function viewPlaza() {
  var list = state.offers.slice().sort(function (a, b) { return a.deadline - b.deadline; });
  var h = '';

  h += '<div class="intro">';
  h += '<p>这里的规矩：<b>不许晒总包，只许说纠结</b>。你把 offer 脱敏发上来，过来人判“接 / 再等等 / 别接”，并且必须回答一个你没想到要问的问题。</p>';
  h += '<div class="steps"><span>1 脱敏提交</span><span>2 陌生人来审</span><span>3 必须写理由</span><span>4 拿走问题清单</span></div>';
  h += '</div>';

  list.forEach(function (o) {
    h += offerCard(o);
  });

  h += '<p class="empty">广场按截止时间排序。越急的越靠前——因为签字那一刻，没人会等你。</p>';
  return h;
}

function offerCard(o) {
  var voted = !!myVote(o);
  var h = '';
  h += '<article class="card offer" data-act="open" data-id="' + o.id + '">';
  h += '<div class="card-top">';
  h += '<span class="tag">' + esc(o.industry) + '</span>';
  h += '<span class="cd" data-deadline="' + o.deadline + '"></span>';
  h += '</div>';
  h += '<h3>' + esc(o.role) + '</h3>';
  h += '<p class="meta">' + esc(o.city) + ' · ' + esc(o.pkg) + '</p>';
  h += '<p class="company">' + esc(o.company) + '</p>';
  h += '<p class="dilemma">“' + esc(o.dilemma) + '”</p>';
  h += '<div class="card-foot">';
  h += '<span>' + o.votes.length + ' 位过来人已审</span>';
  h += voted ? '<span class="done">你已审 · ' + CHOICE[myVote(o).choice].label + '</span>'
             : '<span class="go">去审批 →</span>';
  h += '</div>';
  h += '</article>';
  return h;
}

/* ---------------- 视图：提交 ---------------- */

function viewSubmit() {
  var h = '';
  h += '<div class="intro"><p>脱敏后再发：公司名写“某 + 行业”就行，总包写区间就行。<b>这个广场不比较 package，只解决问题。</b></p></div>';
  h += '<div class="card">';

  h += '<div class="field"><label>岗位</label><input id="f-role" placeholder="例：跨境电商运营（资深）"></div>';
  h += '<div class="row2">';
  h += '<div class="field"><label>行业</label><input id="f-industry" placeholder="例：跨境电商"></div>';
  h += '<div class="field"><label>城市</label><input id="f-city" placeholder="例：深圳"></div>';
  h += '</div>';
  h += '<div class="field"><label>公司（可留空，默认脱敏）</label><input id="f-company" placeholder="例：某跨境电商上市公司"></div>';
  h += '<div class="row2">';
  h += '<div class="field"><label>总包区间</label><input id="f-pkg" placeholder="例：18–22k × 14–16"></div>';
  h += '<div class="field"><label>多久内要答复</label><select id="f-hours"><option value="24">24 小时</option><option value="48" selected>48 小时</option><option value="72">3 天</option><option value="168">一周</option></select></div>';
  h += '</div>';
  h += '<div class="field"><label>你最纠结的那一件事（一句话）</label><textarea id="f-dilemma" placeholder="例：涨薪 30%，但要从 965 变成 996，我怕身体扛不住。"></textarea></div>';
  h += '<div class="row2">';
  h += '<div class="field"><label>手上还有别的选择吗</label><select id="f-alts"><option value="none">没有，就这一个</option><option value="pending">在等另一家</option><option value="have">手上还有一个</option></select></div>';
  h += '<div class="field"><label>你已经问过什么</label><input id="f-asked" placeholder="例：问过加班强度"></div>';
  h += '</div>';

  h += '<p class="note">提交后，系统会按岗位生成 3–4 个“签字前必须问清楚”的问题。审批人必须至少回答一个——他们给的不是态度，是信息。</p>';
  h += '<button class="primary" data-act="submit-offer">提交，等过来人审</button>';
  h += '</div>';
  return h;
}

/* ---------------- 视图：详情 ---------------- */

function viewDetail() {
  var o = findOffer(currentId);
  if (!o) return '<p class="empty">这条 offer 不在了。</p>';

  var voted = !!myVote(o);
  var t = tally(o);
  var total = o.votes.length;
  var h = '';

  h += '<button class="back" data-act="back">← 返回广场</button>';

  h += '<article class="card detail">';
  h += '<div class="card-top"><span class="tag">' + esc(o.industry) + '</span><span class="cd" data-deadline="' + o.deadline + '"></span></div>';
  h += '<h2>' + esc(o.role) + '</h2>';
  h += '<p class="meta">' + esc(o.city) + ' · ' + esc(o.pkg) + '</p>';
  h += '<p class="company">' + esc(o.company) + '</p>';
  h += '<p class="dilemma">“' + esc(o.dilemma) + '”</p>';
  h += '<div class="facts">';
  h += '<div><span>其他选择</span><b>' + ALT[o.alternatives] + '</b></div>';
  if (o.asked) h += '<div><span>已经问过</span><b>' + esc(o.asked) + '</b></div>';
  h += '<div><span>答复截止</span><b class="cd" data-deadline="' + o.deadline + '"></b></div>';
  h += '</div>';
  h += '</article>';

  /* 必答问题 */
  h += '<section class="block">';
  h += '<h4>签字前必须问清楚的 ' + o.questions.length + ' 件事</h4>';
  o.questions.forEach(function (q, i) {
    h += '<div class="q"><span class="qn">Q' + (i + 1) + '</span><p>' + esc(q) + '</p></div>';
  });
  h += '</section>';

  if (!voted) {
    h += '<section class="block">';
    h += '<h4>你来审</h4>';
    h += '<p class="hint">先给判断，再写理由。<b>投完才看得到别人怎么想</b>——先看会带节奏，这是故意设计的。</p>';
    h += '<div class="choices">';
    ['take', 'wait', 'drop'].forEach(function (k) {
      h += '<button class="choice" data-act="choose" data-choice="' + k + '"><span class="cn">' + CHOICE[k].label + '</span><span class="ce">' + CHOICE[k].en + '</span></button>';
    });
    h += '</div>';
    h += '<textarea id="v-reason" placeholder="你凭什么这么判？写你真正会跟朋友说的那句话（至少 ' + MIN_REASON + ' 字）"></textarea>';
    h += '<p class="hint" style="margin-top:10px">至少回答一个上面的问题，帮他把信息补齐：</p>';
    o.questions.forEach(function (q, i) {
      h += '<textarea class="ans" id="v-ans-' + i + '" placeholder="Q' + (i + 1) + ' ' + esc(q) + '"></textarea>';
    });
    h += '<button class="primary" data-act="vote">提交审批</button>';
    h += '</section>';
  } else {
    var v = verdictOf(o);
    h += '<section class="block">';
    h += '<span class="stamp ' + v + '">' + (v === 'take' ? '可接' : v === 'wait' ? '再等等' : '别接') + '</span>';
    h += '<h4>审批结果</h4>';
    h += bar(t, total);
    h += '<div class="counts">';
    h += '<span class="take">接 <b>' + t.take + '</b></span>';
    h += '<span class="wait">再等等 <b>' + t.wait + '</b></span>';
    h += '<span class="drop">别接 <b>' + t.drop + '</b></span>';
    h += '</div>';

    h += '<h4>拿走这张清单</h4>';
    h += actionList(o);

    h += '<h4>他们怎么说的</h4>';
    o.votes.forEach(function (vv) {
      h += '<div class="reason">';
      h += '<div class="rhead"><span class="chip ' + vv.choice + '">' + CHOICE[vv.choice].label + '</span>' + (vv.mine ? '<span class="you">你</span>' : '') + '</div>';
      h += '<p>' + esc(vv.reason) + '</p>';
      h += answersHtml(vv);
      h += '</div>';
    });
    h += '</section>';
  }

  /* 自己的 offer：做决定 */
  if (o.mine) {
    h += '<section class="block">';
    if (!o.decision) {
      h += '<h4>最后，你怎么定的</h4>';
      h += '<p class="hint">没人能替你签。留个记录，三个月后我们会来问你后不后悔。</p>';
      h += '<div class="choices">';
      ['take', 'wait', 'drop'].forEach(function (k) {
        var lb = k === 'take' ? '接了' : k === 'wait' ? '还在拖' : '拒了';
        h += '<button class="choice" data-act="decide" data-d="' + k + '"><span class="cn">' + lb + '</span><span class="ce">' + CHOICE[k].en + '</span></button>';
      });
      h += '</div>';
    } else {
      var dl = o.decision === 'take' ? '接了' : o.decision === 'wait' ? '还在拖' : '拒了';
      h += '<h4>你的决定</h4>';
      h += '<p class="lead">' + esc(dl) + '。已经记下，三个月后回来复盘。</p>';
      h += '<button class="primary ghost" data-act="review" data-id="' + o.id + '">现在就写一句复盘</button>';
    }
    h += '</section>';
  }

  return h;
}

function bar(t, total) {
  if (!total) return '<div class="bar"></div>';
  var seg = function (k) {
    var pct = (t[k] / total) * 100;
    return '<i class="' + k + '" style="width:' + pct + '%"></i>';
  };
  return '<div class="bar">' + seg('take') + seg('wait') + seg('drop') + '</div>';
}

function answersHtml(v) {
  var keys = Object.keys(v.answers || {});
  if (!keys.length) return '';
  var h = '<div class="ba">';
  keys.forEach(function (k) {
    h += '<div><b>Q' + (Number(k) + 1) + '</b> ' + esc(v.answers[k]) + '</div>';
  });
  h += '</div>';
  return h;
}

function actionList(o) {
  var answered = {};
  o.votes.forEach(function (v) {
    Object.keys(v.answers || {}).forEach(function (k) { answered[k] = true; });
  });

  var open = [];
  o.questions.forEach(function (q, i) { if (!answered[i]) open.push(q); });

  var h = '';
  if (open.length) {
    h += '<p class="lead">还有 ' + open.length + ' 个问题没人替你问。签字前，把它们发邮件问 HR，要书面回复：</p>';
    h += '<ul class="todo">';
    open.forEach(function (q) { h += '<li>' + esc(q) + '</li>'; });
    h += '</ul>';
  } else {
    h += '<p class="lead">这几个问题都有人替你答了，逐条核对一遍再签。</p>';
  }
  h += '<ul class="todo fixed">';
  h += '<li>口头承诺一律补进合同，或用邮件确认一遍</li>';
  h += '<li>确认社保公积金基数、落户与档案材料</li>';
  h += '<li>查一次公开的劳动仲裁与被执行记录</li>';
  h += '</ul>';
  return h;
}

/* ---------------- 视图：我的 ---------------- */

function viewMine() {
  var mine = state.offers.filter(function (o) { return o.mine; });
  var reviewed = 0;
  var answered = 0;

  state.offers.forEach(function (o) {
    var v = myVote(o);
    if (v) {
      reviewed++;
      answered += Object.keys(v.answers || {}).length;
    }
  });

  var h = '';
  h += '<div class="stats">';
  h += '<div class="stat"><b>' + mine.length + '</b><span>我提的 offer</span></div>';
  h += '<div class="stat"><b>' + reviewed + '</b><span>我审过的</span></div>';
  h += '<div class="stat"><b>' + answered + '</b><span>我补的答案</span></div>';
  h += '</div>';

  h += '<div class="section-title">我提交的</div>';

  if (!mine.length) {
    h += '<div class="empty">还没有提交过。<br>手上那个一直不敢签的 offer，脱敏后发上来试试。</div>';
  } else {
    mine.forEach(function (o) {
      var t = tally(o);
      var status = o.decision ? '<span class="status done">已定</span>'
        : (o.deadline <= Date.now() ? '<span class="status pending">待决定</span>' : '<span class="status pending">审批中</span>');
      h += '<article class="card offer" data-act="open" data-id="' + o.id + '">';
      h += '<div class="card-top"><span class="tag">' + esc(o.industry) + '</span>' + status + '</div>';
      h += '<h3>' + esc(o.role) + '</h3>';
      h += '<p class="meta">' + esc(o.city) + ' · ' + esc(o.pkg) + '</p>';
      h += '<div class="card-foot">';
      h += '<span>接 ' + t.take + ' / 等等 ' + t.wait + ' / 别接 ' + t.drop + '</span>';
      h += '<span class="go">看结果 →</span>';
      h += '</div>';
      h += '</article>';
    });
  }

  h += '<div class="section-title">关于这个广场</div>';
  h += '<div class="card"><p class="lead" style="margin:0">不卖榜、不卖优先审批、不接招聘方的钱。这个产品的全部价值，就是审批人敢说真话。</p></div>';

  h += '<div style="text-align:center"><button class="linkish" data-act="reset">清空演示数据</button></div>';

  return h;
}

/* ---------------- 交互 ---------------- */

function toast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove('on'); }, 2200);
}

function go(nextScreen) {
  screen = nextScreen;
  render();
  var app = document.getElementById('app');
  if (app) app.scrollTop = 0;
}

function submitOffer() {
  var g = function (id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  var role = g('f-role');
  var industry = g('f-industry');
  var city = g('f-city') || '未填';
  var company = g('f-company');
  var pkg = g('f-pkg') || '未填';
  var hours = Number(g('f-hours')) || 48;
  var dilemma = g('f-dilemma');
  var alts = g('f-alts') || 'none';
  var asked = g('f-asked');

  if (!role) { toast('先写岗位，审批人得知道自己在审什么'); return; }
  if (!industry) { toast('行业也要写，不然没人能判断这家公司'); return; }
  if (dilemma.length < 8) { toast('把纠结写具体一点，别人才能替你判'); return; }

  if (!company) company = '某' + industry + '公司（未公开）';

  var o = {
    id: uid(),
    role: role,
    industry: industry,
    city: city,
    company: company,
    pkg: pkg,
    dilemma: dilemma,
    alternatives: alts,
    asked: asked,
    deadline: Date.now() + hours * HOUR,
    questions: generateQuestions(role),
    votes: [],
    mine: true,
    decision: null
  };

  state.offers.unshift(o);
  currentId = o.id;
  tab = 'plaza';
  go('detail');
  toast('已提交，等过来人审');
}

function submitVote() {
  var o = findOffer(currentId);
  if (!o) return;

  if (!draft.choice) { toast('先选一个判断：接、再等等、还是别接'); return; }

  var ta = document.getElementById('v-reason');
  var reason = ta ? ta.value.trim() : '';
  if (reason.length < MIN_REASON) {
    toast('理由至少 ' + MIN_REASON + ' 个字——写给下一个要签字的人看');
    return;
  }

  var answers = {};
  var any = false;
  o.questions.forEach(function (q, i) {
    var el = document.getElementById('v-ans-' + i);
    var val = el ? el.value.trim() : '';
    if (val) { answers[i] = val; any = true; }
  });

  if (!any) {
    toast('至少回答一个问题：只留态度、不留信息，等于没审');
    return;
  }

  o.votes.push({ choice: draft.choice, reason: reason, answers: answers, mine: true });
  draft.choice = null;
  render();
  toast('已提交，现在能看到别人的判断了');
}

function openReview(id) {
  var modal = document.getElementById('modal');
  var sheet = document.getElementById('sheet');
  if (!modal || !sheet) return;

  var saved = state.reviews[id] || '';
  sheet.innerHTML =
    '<h3>三个月后再看一次</h3>' +
    '<p class="hint">当时哪句话、哪个问题，真的帮到你了？也可能一条都没有——如实写。</p>' +
    '<textarea id="rv" placeholder="例：当时网友问“上一任去哪了”，我去问了，才知道这个岗位一年换三个人。">' + esc(saved) + '</textarea>' +
    '<button class="primary" data-act="save-review" data-id="' + id + '">存下</button>' +
    '<button class="primary ghost" data-act="close-modal">先不填</button>';

  modal.hidden = false;
}

function closeModal() {
  var modal = document.getElementById('modal');
  if (modal) modal.hidden = true;
}

document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.getAttribute('data-act');

  if (act === 'nav') {
    tab = t.getAttribute('data-nav');
    if (tab === 'submit') go('submit');
    else go('plaza');
    return;
  }

  if (act === 'open') {
    currentId = t.getAttribute('data-id');
    draft = { choice: null };
    go('detail');
    return;
  }

  if (act === 'back') { go('plaza'); return; }

  if (act === 'choose') {
    draft.choice = t.getAttribute('data-choice');
    var btns = document.querySelectorAll('.choice[data-choice]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('sel', btns[i].getAttribute('data-choice') === draft.choice);
    }
    return;
  }

  if (act === 'vote') { submitVote(); return; }

  if (act === 'submit-offer') { submitOffer(); return; }

  if (act === 'decide') {
    var o = findOffer(currentId);
    if (!o) return;
    o.decision = t.getAttribute('data-d');
    render();
    toast('记下了。三个月后回来看这条');
    return;
  }

  if (act === 'review') { openReview(t.getAttribute('data-id')); return; }

  if (act === 'save-review') {
    var id = t.getAttribute('data-id');
    var el = document.getElementById('rv');
    state.reviews[id] = el ? el.value.trim() : '';
    closeModal();
    save();
    toast('复盘已存');
    render();
    return;
  }

  if (act === 'close-modal') { closeModal(); return; }

  if (act === 'reset') {
    try { localStorage.removeItem(KEY); } catch (err) {}
    location.reload();
    return;
  }
});

document.getElementById('modal').addEventListener('click', function (e) {
  if (e.target.id === 'modal') closeModal();
});

/* ---------------- 渲染 ---------------- */

function render() {
  var app = document.getElementById('app');
  if (!app) return;

  var tabs = document.querySelectorAll('#tabs button');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('on', tabs[i].getAttribute('data-nav') === tab);
  }

  if (screen === 'detail') app.innerHTML = viewDetail();
  else if (screen === 'submit') app.innerHTML = viewSubmit();
  else if (tab === 'mine') app.innerHTML = viewMine();
  else app.innerHTML = viewPlaza();

  tick();
  save();
}

function tick() {
  var now = Date.now();
  var els = document.querySelectorAll('[data-deadline]');
  for (var i = 0; i < els.length; i++) {
    var d = Number(els[i].getAttribute('data-deadline'));
    var left = d - now;
    els[i].textContent = fmtRemain(left);
    els[i].classList.toggle('urgent', left > 0 && left < 6 * HOUR);
    els[i].classList.toggle('over', left <= 0);
  }
}

/* ---------------- 启动 ---------------- */

window.addEventListener('error', function (e) {
  var d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;background:#AF3A2A;color:#fff;font:12px/1.6 sans-serif;padding:10px 12px;border-radius:10px;z-index:999';
  d.textContent = '脚本出错：' + e.message;
  document.body.appendChild(d);
});

state = load();
reviveIfDead();
render();
setInterval(tick, 30000);

/**
 * 本地演示用的种子数据（真正上线时不需要这个文件）。
 * 页面不直接引用它，只有 utils/mock-api.js 在降级模式下用。
 */

const HOUR = 3600 * 1000;

const GENERIC_Q = [
  '这个岗位的直接汇报人是谁？他在这家公司待了多久？',
  '这个组过去 12 个月的离职率大概是多少？',
  '试用期的考核标准写进合同了吗？有量化指标吗？'
];

const ROLE_Q = [
  { k: ['运营'], q: '这个岗位背的 KPI 是谁定的？上一任去哪了？' },
  { k: ['产品'], q: '需求谁拍板？期权占你总包多少，行权价和回购条款看过吗？' },
  { k: ['投行', '券商', '承做', '金融'], q: '团队去年的项目储备有多少？裁员的传闻你打算怎么核实？' },
  { k: ['供应链', '采购', '物流'], q: 'base 地的社保和公积金按什么基数缴？' },
  { k: ['市场', '品牌', '营销'], q: '这个岗位能动的预算规模是多少？三年后这个岗位的人一般去哪？' },
  { k: ['开发', '工程师', '算法', '研发', '技术'], q: '团队的 oncall 频率是多少？技术债和上线节奏你了解吗？' },
  { k: ['管培', '培训生'], q: '这个管培项目是真轮岗还是挂名？前两届的人现在在哪？' },
  { k: ['设计'], q: '这个岗位是画图岗还是决策岗？需求方是谁？' },
  { k: ['财务', '会计'], q: '这个岗位要对哪几张报表负责？月结周期是几天？' }
];

function generateQuestions(role) {
  const list = GENERIC_Q.slice();
  const r = String(role || '');
  for (let i = 0; i < ROLE_Q.length; i++) {
    if (ROLE_Q[i].k.some(k => r.indexOf(k) >= 0)) {
      list.push(ROLE_Q[i].q);
      break;
    }
  }
  return list.slice(0, 4);
}

function seed() {
  const now = Date.now();

  const raw = [
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

  return raw.map((r, i) => ({
    id: 'seed' + i,
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
    votes: r.votes
  }));
}

module.exports = { seed, generateQuestions, HOUR };

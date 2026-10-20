/**
 * 「签字前必须问清楚」的问题模板。
 *
 * 这是产品里唯一会随时间变厚的资产：上线后把"高赞但没人问过"的问题
 * 回灌到 templates 集合，不用发版就能让下一批人问得更准。
 */
const config = require('./config');

const GENERIC = [
  '这个岗位的直接汇报人是谁？他在这家公司待了多久？',
  '这个组过去 12 个月的离职率大概是多少？',
  '试用期的考核标准写进合同了吗？有量化指标吗？'
];

const ROLE_RULES = [
  { keys: ['运营'], q: '这个岗位背的 KPI 是谁定的？上一任去哪了？' },
  { keys: ['产品'], q: '需求谁拍板？期权占你总包多少，行权价和回购条款看过吗？' },
  { keys: ['投行', '券商', '承做', '金融'], q: '团队去年的项目储备有多少？裁员的传闻你打算怎么核实？' },
  { keys: ['供应链', '采购', '物流'], q: 'base 地的社保和公积金按什么基数缴？' },
  { keys: ['市场', '品牌', '营销'], q: '这个岗位能动的预算规模是多少？三年后这个岗位的人一般去哪？' },
  { keys: ['开发', '工程师', '算法', '研发', '技术'], q: '团队的 oncall 频率是多少？技术债和上线节奏你了解吗？' },
  { keys: ['管培', '培训生'], q: '这个管培项目是真轮岗还是挂名？前两届的人现在在哪？' },
  { keys: ['设计'], q: '这个岗位是画图岗还是决策岗？需求方是谁？' },
  { keys: ['财务', '会计'], q: '这个岗位要对哪几张报表负责？月结周期是几天？' }
];

/**
 * @param {string} role 岗位名
 * @param {Array<{role_key:string,text:string}>} overrides 运营侧覆盖的问题（来自 templates 表）
 */
function generate(role, overrides) {
  const list = GENERIC.slice();
  const r = String(role || '');

  // 运营配置优先
  const extra = (overrides || []).filter(t => t.role_key && r.indexOf(t.role_key) >= 0);
  if (extra.length) {
    list.push(extra[0].text);
  } else {
    for (let i = 0; i < ROLE_RULES.length; i++) {
      const rule = ROLE_RULES[i];
      if (rule.keys.some(k => r.indexOf(k) >= 0)) {
        if (list.indexOf(rule.q) < 0) list.push(rule.q);
        break;
      }
    }
  }

  return list.slice(0, config.MAX_QUESTIONS);
}

module.exports = { generate, GENERIC, ROLE_RULES };

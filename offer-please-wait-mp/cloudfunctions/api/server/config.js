/**
 * 全局配置。上生产前按主体资质和运营策略改这里，不要散落在业务代码里。
 */
module.exports = {
  // 主体没下来时置 false：只允许群内审批，不暴露公开广场
  FEATURE_PUBLIC_PLAZA: true,

  // 发布成本：审 3 发 1
  PUBLISH_COST: 3,
  FIRST_OFFER_FREE: true,

  // 一人 24 小时内最多发几条
  MAX_OFFERS_PER_DAY: 2,

  // 理由最短长度（服务端校验，客户端可绕过）
  MIN_REASON: 10,
  MAX_REASON: 500,

  // 作者至少在收到多少票后才看得到结果
  AUTHOR_MIN_VOTES: 3,

  // 每次生成几个必答问题
  MAX_QUESTIONS: 4,

  // 举报达到几次自动转人工下架
  REPORT_TAKEDOWN_THRESHOLD: 3,

  // 内容安全：超时/异常时是否放行。false = 落 reviewing 走人工，宁可慢不可漏
  SECURITY_FAIL_OPEN: false,

  // 同一作者 60 秒内提交同样内容视为重复提交
  DEDUPE_WINDOW_MS: 60 * 1000,

  // 未认证用户权重（只影响排序与答案是否进清单，永不影响票型）
  WEIGHT_VERIFIED: 1.0,
  WEIGHT_UNVERIFIED: 0.3
};

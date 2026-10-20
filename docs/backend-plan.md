# offer 请等等 · 后端开发方案 v0.1

> 范围：把单机原型变成「两个人能互相看见、内容可审核、供给侧机制能跑」的最小可用后端。
> 不含：支付、多端、数据大屏。
> 前置假设：小程序已按现有工程跑通，本次只替换数据层。

---

## 1. 先明确这一版要解决什么

原型现在的问题不是"没有后端"，是三件事同时缺：

| 缺什么 | 具体表现 | 不解决的后果 |
|---|---|---|
| 共享状态 | 数据在各自手机缓存里 | 广场永远是空的，产品不成立 |
| 内容审核 | 用户发什么就显示什么 | 上不了线，上线也会被封 |
| 供给侧机制 | 没有配额、没有认证、没有权重 | 冷启动空转，全是白嫖和玩梗 |

所以 v1 的验收标准是三条，不是"接口写完"：

1. A 发一条 offer，B 能刷到、能审、A 能看到结果；
2. 任何文本落库前都过了内容安全，违规内容进得了人工队列；
3. 「审 3 份才能发 1 份」可执行、可对账、刷不动。

---

## 2. 选型：v1 用微信云开发，并且刻意留一条退路

### 2.1 结论

**微信云开发（云函数 + 云数据库 + 云存储）**，业务逻辑收在一个薄服务层里，数据访问全部走 repository 接口。

理由按重要性排：

1. **不需要备案域名**。自建要备案 + HTTPS + 小程序服务器域名白名单，顺利也要 2–3 周，这是上线时间的主要成本。
2. **云调用免 access_token**。`security.msgSecCheck`、订阅消息、`code2session` 在云函数里直接调，省掉一整套 token 刷新与中转服务。
3. **单人可维护**。没有服务器、没有运维、没有发布流水线，改完直接上传。
4. **早期成本接近 0**。

### 2.2 什么情况下不要选云开发

| 条件 | 换成 |
|---|---|
| 团队已有备案域名 + Go/Java 服务 | 直接自建，别折腾 |
| 需要复杂报表、多表 join、强事务 | 自建 + MySQL |
| 预期 3 个月内 DAU > 3 万 | 自建（云开发的调用配额与冷启动会开始咬人） |
| 要做 Web 端 / App 端 | 自建（云开发只服务微信生态） |

### 2.3 退路：怎么保证以后能换

三条纪律，现在就开始守：

- **数据模型按关系型设计**，只是用文档库实现（见第 4 节，唯一索引、外键关系都标出来了）；
- **业务逻辑不写在页面里，也不写在云函数入口里**，放 `server/service/*`，云函数只做路由和鉴权；
- **repository 是接口**，`repo/cloud/*` 是当前实现，将来加 `repo/mysql/*` 即可切换。

换的成本大约 1–2 周，前提是这三条守住了。守不住，换的时候就是重写。

---

## 3. 总体架构

```
┌──────────────┐
│ 小程序        │
│ 4 个页面      │
└──────┬───────┘
       │ wx.cloud.callFunction（自带 openid，无需登录态）
       ▼
┌─────────────────────────────────────────────┐
│ 云函数 api（单一入口，按 action 路由）        │
│  ├─ 鉴权/限流/幂等                            │
│  ├─ 入参校验（zod）                           │
│  └─ 分发到 service                            │
└──────┬──────────────────────────────────────┘
       │
       ├──────────────► service 层（纯业务）
       │                  offer / vote / quota / moderation / stats
       │
       ├──────────────► repo 层（接口）
       │                  cloud 实现：云数据库 / 云存储
       │
       └──────────────► 外部能力
                          security.msgSecCheck（内容安全）
                          subscribeMessage（回访提醒）
                          openapi.wxacode（分享码，二期）

┌─────────────────────────────────────────────┐
│ 定时触发器（云函数 timer）                    │
│  ├─ 每分钟：票型对账 / 过期 offer 收口         │
│  ├─ 每小时：配额对账、热度重算                  │
│  └─ 每天：90 天回访推送、审核队列超时告警        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ 管理后台（云开发静态托管 + 一个轻量前端）      │
│  审核队列 / 举报处理 / 下架 / 封禁 / 看板       │
└─────────────────────────────────────────────┘
```

**为什么是单一云函数入口**：冷启动只暖一个函数；路由、鉴权、限流、日志埋一次；将来整体搬成 HTTP 服务时，入口文件几乎不用改。

---

## 4. 数据模型

按关系型设计，共 10 张表。标 🔑 的是唯一索引，标 ⚡ 的是必须建的查询索引。

### 4.1 users

| 字段 | 类型 | 说明 |
|---|---|---|
| _id | string | 直接用 openid |
| openid 🔑 | string | 唯一 |
| nickname / avatar | string | 可空，不强制授权 |
| industry / role / years | string/int | 自述，用于路由和权重 |
| verify_status | enum | none / pending / passed / rejected |
| verify_evidence | string | 云存储 fileID |
| weight | number | 认证 1.0，未认证 0.3 |
| quota_balance | int | 冗余余额，正源是 quota_ledger |
| status | enum | active / muted / banned |
| created_at / last_active_at | timestamp | |

> **不存**：手机号、身份证、真实姓名、unionid（除非确定要做多端）。

### 4.2 offers

| 字段 | 说明 |
|---|---|
| author_id | openid |
| role / industry / city / company_masked / pkg_range | 展示字段 |
| dilemma | 一句话纠结，≤120 字 |
| alternatives | none / pending / have |
| asked | 已问过什么，可空 |
| deadline_at ⚡ | **服务端计算** = created_at + ttl_hours，绝不接受客户端传值 |
| status ⚡ | reviewing / published / expired / decided / removed |
| tally | {take, wait, drop}，冗余计数 |
| vote_count / answer_count | 冗余计数 |
| hot_score ⚡ | 排序用（票数、剩余时间、认证作者加权） |
| created_at / updated_at | |

### 4.3 offer_questions

| 字段 | 说明 |
|---|---|
| offer_id ⚡ | |
| seq | 1..4 |
| text | 问题正文 |
| source | template / vote / system |
| answer_count | 被回答次数 |

### 4.4 votes ★核心表

| 字段 | 说明 |
|---|---|
| offer_id | |
| voter_id | |
| choice | take / wait / drop |
| reason | ≥10 字，≤500 字 |
| reason_len | 冗余，用于质量统计 |
| status | visible / hidden |
| created_at ⚡ | |
| **唯一索引：(offer_id, voter_id)** | **一人一票，靠数据库兜底，不靠先查后写** |

### 4.5 vote_answers

| 字段 | 说明 |
|---|---|
| vote_id ⚡ | |
| offer_id | 冗余，便于按 offer 聚合 |
| question_seq | 回答的是第几问 |
| text | ≤300 字 |

### 4.6 decisions / reviews

- decisions：`offer_id 🔑`、`decision`（take/wait/drop）、`decided_at`。与 `offers.status` 冗余，为了统计方便。
- reviews：`offer_id`、`author_id`、`text`、`created_at`。90 天回访写入。

### 4.7 quota_ledger ★

| 字段 | 说明 |
|---|---|
| user_id ⚡ | |
| delta | +1（审了一份）/ -3（发了一份）/ 正数（退款、补偿） |
| reason | vote / publish / refund / admin |
| ref_id | 关联的 offer_id 或 vote_id，**用于防重复记账** |
| balance_after | 记账后余额，便于对账 |
| created_at | |

> **为什么用流水不用计数字段**：并发下 `balance = balance - 3` 会丢更新。流水只追加，余额由流水聚合得出；`users.quota_balance` 只是缓存，每小时对账一次。`(user_id, reason, ref_id)` 建唯一索引，防止同一次投票重复加分。

### 4.8 moderation_tasks / reports

| 表 | 关键字段 |
|---|---|
| moderation_tasks | target_type（offer/vote/review）、target_id、source（auto/report）、risk_label、status（pending/passed/rejected）、reviewer、created_at ⚡ |
| reports | target_type、target_id、reporter_id、reason、status、created_at |

### 4.9 templates

| 字段 | 说明 |
|---|---|
| role_key / industry | 匹配键 |
| text | 问题模板 |
| weight | 命中率，用于排序 |
| hit_count | 被采纳次数 |

> 这张表是**唯一会随时间变厚的资产**。上线后每周把"高赞但没人问过"的问题回灌进来。

---

## 5. 业务规则（写进代码，不写在文档里就一定会漏）

| ID | 规则 | 落点 |
|---|---|---|
| R1 | 一人一票 | votes 唯一索引 |
| R2 | 作者不能给自己的 offer 投票 | service 校验 |
| R3 | 未投票看不到别人的判断、票型、结果 | **接口层不返回**，不是前端隐藏 |
| R4 | 票数 < 3 不展示结果，只显示"已有 N 人审过" | service |
| R5 | 过了 deadline 拒绝投票（用服务端时间） | service |
| R6 | 理由 ≥10 字，且通过 msgSecCheck | service + 内容安全 |
| R7 | 至少回答 1 个问题 | service |
| R8 | 审 3 份才能发 1 份；首单免费 | quota service |
| R9 | 同一用户 24h 内最多发 2 条 | 限流 |
| R10 | 举报满 3 次自动下架转人工 | 定时 + 事件 |

**R2 + R3 放在一起会引出一个必须解决的产品问题**：作者不投票，那他怎么看到别人的理由？

答案是**作者视角单独开**：作者在票数 ≥3 后可查看全部理由与清单。作者已经提交完了，看理由不会污染任何判断，也不存在从众。这个口子必须在接口里显式做，否则作者永远看不到反馈，产品就断了一半。

---

## 6. 接口设计

统一入口：`POST /api`，body 里带 `action`。全部 JSON，全部走云函数（自带 openid）。

### 6.1 通用约定

- **鉴权**：云函数上下文拿 `OPENID`，不接受客户端传 userId；
- **幂等**：写接口带 `client_token`（uuid），服务端 24h 去重；投票另有唯一索引兜底；
- **分页**：cursor 分页（`deadline_at + id`），不用 offset，避免深翻页；
- **时间**：全部服务端时间，客户端时间只用于展示；
- **错误**：`{ code, message, data }`，code 见 6.3。

### 6.2 接口清单

| action | 说明 | 关键入参 | 关键出参 |
|---|---|---|---|
| `offer.list` | 广场流 | cursor, limit(≤20), industry? | items[]（**不含 tally**，只含 vote_count） |
| `offer.create` | 发一条 | role, industry, city, company, pkg, dilemma, alternatives, asked, ttl_hours | id, questions[] |
| `offer.detail` | 详情（视角相关） | id | offer, questions, viewer{voted, isAuthor, canSeeResult}, myVote? |
| `vote.create` | 投票 | id, choice, reason, answers[{seq,text}], client_token | result（首次可见） |
| `offer.result` | 结果与清单 | id | tally, votes[], openQuestions[], canSee |
| `offer.decide` | 作者定夺 | id, decision | ok |
| `review.create` | 90 天复盘 | id, text | ok |
| `report.create` | 举报 | targetType, targetId, reason | ok |
| `me.get` | 我的 | — | profile, quota, stats |
| `me.quota` | 配额明细 | limit | ledger[] |
| `admin.queue` | 审核队列 | status, cursor | tasks[] |
| `admin.moderate` | 通过/驳回 | taskId, action, note | ok |
| `admin.takedown` | 下架 | targetType, targetId | ok |

### 6.3 错误码

| code | 含义 | 前端处理 |
|---|---|---|
| 40001 | 参数不合法 | 原地提示 |
| 40101 | 未登录 | 重新进入 |
| 40301 | 配额不足（要审 3 份） | 引导去广场 |
| 40302 | 已投过票 | 直接跳结果页 |
| 40303 | 不能审自己的 offer | 隐藏入口（理论上走不到） |
| 40901 | 已截止 | 刷新详情 |
| 42901 | 触发限流 | 稍后再试 |
| 45101 | 内容未通过安全检测 | 提示修改，不暴露具体命中的词 |

### 6.4 两个最容易做错的接口

**`offer.detail` 是视角相关的**。同一个 id，作者、已投票者、未投票者拿到的字段完全不同：

```
未投票者：votes=[], tally=null, canSeeResult=false
已投票者：votes=[全部], tally={...}, canSeeResult=true
作者：    votes=[] 直到 vote_count>=3，之后 votes=[全部]，canSeeResult=(vote_count>=3)
```

**不要"返回全部字段，前端控制显示"**。小程序包可以被反编译，接口返回了什么，用户就能看到什么。

**`vote.create` 必须是事务**：

```
begin
  insert votes（唯一索引冲突 → 40302）
  insert vote_answers
  update offers.tally / vote_count / answer_count
  insert quota_ledger(+1)（唯一索引防重）
commit
```

云开发数据库支持事务，但事务里不能做跨库操作；配额对账失败可以异步补，不要因为账本失败把票回滚掉——**票比账重要**。

---

## 7. 内容安全：不是"接个接口"，是一条流水线

```
用户输入
  → 本地长度/格式校验
  → 服务端二次校验（客户端校验可绕过）
  → msgSecCheck（同步，200ms 级）
      ├─ 通过 → 落库 status=published
      ├─ 疑似 → 落库 status=reviewing + moderation_tasks(pending)，前台显示"审核中"
      └─ 拒绝 → 返回 45101，不落库
  → 举报/自动规则命中 → 转人工队列
```

要点：

1. **同步检查，不能异步**。异步意味着违规内容会先看到，这在审核里是红线。
2. **不接受"客户端已检查过"**。
3. **审的是拼接后的全文**（dilemma + company + role + asked），单字段过审没用。
4. **理由也要审**。理由是最容易出问题的字段，且量大，必须做频率限制。
5. **图片（二期）**：`imgSecCheck` 同步、`mediaCheckAsync` 异步回调，两条都要接。
6. **失败要有降级**：msgSecCheck 超时/限流时，落 `reviewing` 而不是直接放行。

---

## 8. 反作弊与供给质量

| 风险 | 手段 |
|---|---|
| 刷票 | 唯一索引（一票）→ 新号 24h 内投票**不计入 tally**，只计 answer → IP/设备频率限制 |
| 小号养号 | 同一 IP 注册聚簇检测，投票权重 0；提现/发帖类操作加验证 |
| 软广 / 凡尔赛 | 金额异常（远超区间中位数）+ "推荐""自用""链接"类关键词 → 转人工 |
| 搬运抄袭 | 同一文本哈希 7 日内重复 → 拒绝 |
| 恶意举报 | 举报人历史准确率 < 30% 时降权 |

**权重只影响两件事**：排序，以及"这个答案算不算进清单"。**永远不影响票型本身**——否则就是操纵结果。

---

## 9. 供给侧机制（决定产品能不能转起来）

1. **审 3 发 1**：账本实现，首单免费。逻辑简单，但对冷启动影响最大。
2. **过来人认证**：v1 只做"自述行业 + 年限"，给 1.0 权重；v2 接入企业邮箱/工牌/在职证明。
3. **路由**：新 offer 进"待审池"，优先推给同行业认证用户；同行业审完不足 3 票，才放开全量。
4. **兜底**：真人不足时显示"还没人审"，**绝不用 AI 假装有人审**。这一点写在 product 原则里，不只是技术选择。
5. **回访**：90 天后 `subscribeMessage` 推送 → 打开详情 → 写复盘。这是唯一能证明产品有用的证据，也是后续所有推荐算法的训练数据。

---

## 10. 一致性与性能

| 问题 | 方案 |
|---|---|
| 票型计数 | 事务内自增 + 每小时定时 `count` 对账修复 |
| 配额余额 | 流水聚合为准，`users.quota_balance` 缓存，每小时对账 |
| 广场热点 | offer.list 只读，加 30s 内存缓存；容器级缓存足够 |
| 深翻页 | cursor（deadline_at, id） |
| 冷启动 | 单函数入口 + 依赖精简；数据库连接在函数外初始化 |
| 大字段 | 不存图片 base64，一律 fileID |

**预期量级**：1 万 DAU、人均 20 次调用 ≈ 20 万次/日。这个量级下，云函数的瓶颈不是计算而是数据库读写次数，**读缓存和批量写要提前做**。

---

## 11. 可观测

**埋点**（前端上报 + 服务端补全）：
`submit_start / submit_success / vote_success / result_view / decide / review_submit / report`

**看板**（云开发控制台 + 自建日报）：
- 供给：日新增 offer、待审池积压、平均被审时长
- 需求：投票完成率、平均票数、理由字数中位数
- 质量：审核拦截率、举报率、下架率
- 留存：次日/7 日回访

**告警**：
- 云函数错误率 > 1%（5 分钟窗口）
- msgSecCheck 失败率 > 5%
- 审核队列 pending > 200 且最老 > 2h
- P95 延迟 > 800ms

---

## 12. 合规清单（这部分做不好，代码白写）

| 项 | 要求 |
|---|---|
| 类目 | 个人主体基本开不了公开 UGC 广场；先按工具类目只做群内审批，企业主体再开广场 |
| UGC 审核 | msgSecCheck / imgSecCheck 必接；**举报入口 + 后台删除能力**审核会查 |
| 用户协议 / 隐私政策 | 小程序必填，写清收集 openid、内容用途、留存期限 |
| 名誉权 | 公司名默认脱敏；被投诉 7 日内响应；保留申诉通道 |
| 数据留存 | 已下架内容保留 ≥6 个月备查 |
| 日志脱敏 | 不落 dilemma / reason 全文，只落 hash 和长度 |
| 免责 | 不做法律意见，涉法问题引导律师 |

---

## 13. 排期（4 周，单人）

| 周 | 交付 | 验收 |
|---|---|---|
| W1 | 工程骨架、users/offers/questions 三表、`offer.create/list/detail`、openid 鉴权 | 两台手机能看到同一条 offer |
| W2 | votes/vote_answers、事务投票、结果接口、视角隔离、msgSecCheck | 未投票拿不到票型；违规内容进队列 |
| W3 | quota 账本、认证、举报、管理后台（审核队列） | 审 3 发 1 可对账；后台能下架 |
| W4 | 定时任务（对账/过期/回访）、埋点、告警、压测、灰度 | 100 并发投票无脏数据；告警能响 |

**W3 的验收是硬门槛**：如果这时候供给侧机制没跑通，后面做什么都是空转。

---

## 14. 前端要跟着改的地方（别漏）

1. `utils/store.js` 拆成 `utils/api.js`（远程）+ 纯展示工具，**删除所有本地写操作**；
2. 每个页面加 `loading / empty / error` 三态，现在是同步渲染，改异步后空白页会很难看；
3. 详情页分「作者视角」和「评审视角」，作者不显示投票表单；
4. 列表改 cursor 分页 + 下拉刷新（已预留 `onPullDownRefresh`）；
5. 所有写操作加防抖和 `client_token`；
6. 登录态：云开发无需登录页，但要处理 `openid` 拿不到的情况（用户拒绝授权/网络异常）。

---

## 15. 换成自建 Go 的替换点（给未来的自己）

| 现在 | 换成 | 改动量 |
|---|---|---|
| 云函数 api | HTTP 服务（Gin/GoFrame） | 入口 1 个文件 |
| `OPENID` 上下文 | JWT（code2session 自建） | 鉴权中间件 |
| `repo/cloud` | `repo/mysql` | 每个接口 1 个 SQL |
| 云数据库 | MySQL 8 | 表结构已有，补 DDL |
| 云存储 | OSS/COS | 同一套 fileID 抽象 |
| 定时触发器 | cron | 逻辑不变 |

**唯一需要提前设计的**：`votes` 在 MySQL 里的 `UNIQUE(offer_id, voter_id)` 与云数据库的唯一索引语义一致，迁移时不用改业务逻辑。这条现在就要守住。

---

## 16. 三个需要你拍板的点

1. **主体**：现在有没有企业主体？没有的话，v1 只能做"群内审批"，广场要等主体下来——这直接影响 W1 要不要做公开列表。
2. **团队栈**：如果你们本来就有 Go 服务和备案域名，第 2 节的结论要反过来，直接自建，能省掉未来一次迁移。
3. **认证的严格度**：v1 用"自述行业"还是直接上"在职证明"？前者上线快但权重不可信，后者体验重但答案质量高。

---

*本文与 `offer-please-wait-mp/README.md` 配套：前者讲工程实现，本文讲后端与上线路径。*

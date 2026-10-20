# 云开发初始化清单

按顺序做完这五步，后端才算真的能用。**第 2 步和第 3 步不做，代码写得再对也白搭。**

---

## 1. 开通环境

开发者工具 → 云开发 → 新建环境，记下**环境 ID**，并在「项目设置」里把项目绑定到它。

代码里不用写死环境 ID：`utils/api.js` 调的是 `wx.cloud.init({ traceUser: true })`（不传 env 就用默认环境）。绑定好之后，前端会自动从「本地演示」切到云函数；没绑定时广场底部会显示「本地演示模式」，这是预期行为。

## 2. 建集合，并且把权限全部关掉 ★

建这 10 个集合：

```
users  offers  offer_questions  votes  vote_answers
reviews  quota_ledger  moderation_tasks  reports  templates
```

**每个集合的权限都设为「所有用户不可读写」。**

原因只有一个：客户端一旦能直连数据库，用户就能直接读 `votes` 表，把别人的判断和理由全捞出来——「先投后看」当场作废。云函数以管理员身份运行，不受这个权限限制，所以关掉不影响功能。

> 顺带一条纪律：小程序端**只准** `wx.cloud.callFunction`，不准出现 `wx.cloud.database()`。出现一次，视角隔离就破了。

## 3. 建索引（唯一索引是功能，不是优化）★

| 集合 | 字段 | 类型 | 用途 |
|---|---|---|---|
| votes | `offer_id` + `voter_id` | **唯一** | **一人一票的唯一保障**。删了它，「一人一票」就只剩一句注释 |
| votes | `offer_id` + `created_at` | 普通 | 拉取某条 offer 的全部理由 |
| votes | `voter_id` | 普通 | 我的审批数统计 |
| quota_ledger | `user_id` + `reason` + `ref_id` | **唯一** | 同一票不会加两次分；同一次发布不会扣两次 |
| quota_ledger | `user_id` + `created_at` | 普通 | 额度明细 |
| offers | `status` + `sort_key` | 普通 | 广场流分页（游标只用一个 `>`） |
| offers | `author_id` + `created_at` | 普通 | 24 小时发布频率校验 |
| offers | `author_id` + `dilemma_hash` + `created_at` | 普通 | 60 秒重复提交合并 |
| offer_questions | `offer_id` + `seq` | 普通 | 按序取问题 |
| vote_answers | `offer_id` | 普通 | 汇总回答，算「还没人问的问题」 |
| vote_answers | `vote_id` | 普通 | 拼装单条投票 |
| moderation_tasks | `status` + `created_at` | 普通 | 审核队列 |
| reports | `target_type` + `target_id` | 普通 | 举报计数 |
| reviews | `offer_id` | **唯一** | 一条 offer 只留一份复盘 |

## 4. 部署云函数

1. 右键 `cloudfunctions/api` → **上传并部署：云端安装依赖**；
2. 右键 `cloudfunctions/timer` → 同上；
3. `api/config.json` 已声明 `security.msgSecCheck` 权限，部署后到控制台确认「内容安全」接口已开通；
4. `timer/config.json` 已带两个定时触发器：
   - `expire`：每分钟把过期的 published 收口成 expired；
   - `reconcile`：每小时按真实票数校准 `tally`。

## 5. 验证顺序

**不要用云函数控制台的「测试」按钮验业务接口**——那里 `getWXContext().OPENID` 是空的，所有接口都会返回 `40101`。这是故意的，不是 bug。

正确做法：开发者工具里真机预览，按这个顺序点一遍：

1. 发一条 offer → 应返回 `status: published` 和 4 个问题；
2. 换另一个微信号 → 广场能看到它，且**看不到票型**；
3. 投票 → 返回 tally；再投一次 → `40302`；
4. 第三个号投满 3 票 → 作者能看到全部理由；
5. 作者发第二条 → `40301`，提示还差几次审批。

## 6. 上线前再确认

- [ ] 10 个集合权限都是「所有用户不可读写」
- [ ] `votes(offer_id, voter_id)` 唯一索引已建
- [ ] `quota_ledger(user_id, reason, ref_id)` 唯一索引已建
- [ ] 内容安全接口已开通，且 `SECURITY_FAIL_OPEN` 为 `false`
- [ ] 定时触发器已生效（看日志里有没有 `expire` / `reconcile`）
- [ ] 数据库每日备份已开
- [ ] `config.FEATURE_PUBLIC_PLAZA` 按主体资质决定开不开

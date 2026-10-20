# offer 请等等 · 微信小程序

> 签字之前，先让过来人问三个问题。
>
> 把 offer 签字前的纠结脱敏发上来，陌生人判「接 / 再等等 / 别接」，并且**必须回答一个你没想到要问的问题**。结果不是一句结论，而是一张「签字前必须问清楚的清单」。

---

## 一、怎么跑

1. 微信开发者工具 →「导入项目」→ 选本目录；
2. AppID 选「测试号」，或填你自己的 AppID（`project.config.json` 里是 `touristappid`，游客模式可直接预览）；
3. 编译。

**不配云开发也能跑。** 没有云环境时，前端会自动降级成本地演示数据（5 条种子、一人一票、审 3 发 1 都在本地模拟），广场底部会显示「本地演示模式」。

要连真后端：开通云开发 → 建集合和索引（见 [docs/db-init.md](docs/db-init.md)）→ 右键 `cloudfunctions/api` 上传部署。前端不需要改代码，`utils/api.js` 会自动从降级模式切回云函数。

## 二、本地跑起来（不用开发者工具）

需要两个进程：一个真后端，一个页面预览。

```bash
# 1) 后端：跑的是 cloudfunctions/api 的真实代码，wx-server-sdk 换成文件持久化
node dev/local-backend/server.js        # → http://127.0.0.1:8898/api

# 2) 页面预览：把真实 WXML/WXSS/页面 JS 拿到浏览器里跑
node dev/preview/serve.js              # → http://127.0.0.1:8899/dev/preview/preview.html
```

打开后是**连着真后端**的页面：广场 5 条数据来自 `data.json`，审一票会真的写进去。

想看「两个人互相审」，开两个窗口：

```
http://127.0.0.1:8899/dev/preview/preview.html?me=openid-A#/pages/plaza/plaza
http://127.0.0.1:8899/dev/preview/preview.html?me=openid-B#/pages/plaza/plaza
```

A 发的 offer，B 刷得到、审得了；B 审完，A 那边刷新就能看到票型和理由。

**这不是另写的一套 H5。** `dev/preview/runtime.js` 是个小号运行时：把真实的 WXML 解析成 DOM、真实的 WXSS 注入（只做 rpx→px）、真实的页面 JS 原样加载，再补上 `Page / setData / wx.*` 的浏览器实现，并模拟了原生导航栏和 tabBar。

局限（别拿它替代真机）：

- 生命周期是近似的，`onShow` 时机、页面栈行为以真机为准；
- `textarea`、`picker` 是原生组件，浏览器里用 `textarea`/`select` 近似；
- 字体、滚动惯性、安全区跟真机有差异。

预览调试参数：

```
?me=openid-B                              换一个身份看同一份数据
#/pages/detail/detail?id=seed0&as=voted   在本地演示模式下先投一票，直接看结果页
#/pages/plaza/plaza?fresh=1               清空本地演示模式的浏览器存储
```

> 上真机/开发者工具时不用起这两个服务：连上云环境就自动走云函数。本地后端只是开发期的替代品。

## 三、目录

```
offer-please-wait-mp/
├── app.js / app.json / app.wxss     启动、页面注册 + tabBar、共用样式
├── project.config.json              含 cloudfunctionRoot
├── images/                          tabBar 图标（脚本生成）
│
├── utils/
│   ├── api.js                       ★ 唯一数据入口：云函数 + 自动降级
│   ├── api-error.js                 错误码（与后端一致）
│   ├── format.js                    倒计时（基于服务端时间）
│   ├── mock-api.js                  本地演示实现（降级时用，非业务真相）
│   └── seed.js                      演示种子数据
│
├── pages/
│   ├── plaza/                       广场（tab）：加载/错误/空三态 + 触底分页
│   ├── submit/                      提一份（tab）：校验、配额不足引导
│   ├── detail/                      审批 + 结果 + 决定 + 复盘
│   └── mine/                        我的（tab）：配额、我提的
│
├── cloudfunctions/                  ← 见「四、后端」
│   ├── api/                         单一入口云函数
│   └── timer/                       过期收口 + 票型对账
│
├── docs/db-init.md                  建库、权限、索引、部署清单
└── dev/                             本地开发与测试（不用开发者工具）
    ├── simulate.js                  页面层冒烟：46 条断言
    ├── test-backend.js              后端端到端：72 条断言
    ├── mock-sdk.js                  内存/文件版 wx-server-sdk
    ├── local-backend/server.js      ★ 把云函数跑成 HTTP 服务（8898）
    ├── preview/                     页面预览器（8899）
    │   ├── runtime.js               WXML 解析 + 渲染 + Page/wx 实现
    │   └── serve.js                 静态服务
    └── make_icons.py                重新生成 tabBar 图标
```

## 四、数据流

```
页面 ──► utils/api.js ──► ① wx.cloud.callFunction('api')   ← 生产
                  │
                  ├──► ② POST 127.0.0.1:8898/api          ← 本地真后端（开发）
                  │
                  └──► ③ utils/mock-api.js                 ← 内置演示（兜底）
```

三级降级，只在「云函数/环境不存在」或「本地后端连不上」时才往下掉，其他网络错误照常抛。也可以用 Storage 里的 `__api_mode` 强制指定 `cloud / http / local`。

三条纪律：

1. **页面只认 `utils/api.js`**，不直接调 `wx.cloud`，也不碰数据库。测试里有一条静态检查专门守这条。
2. **降级有边界**，网络错误不降级——否则线上故障会被伪装成正常。
3. **倒计时一律用 `api.now()`**（服务端时间），不信手机时钟。

## 五、后端

```
cloudfunctions/api/server/
├── config.js        开关与阈值（发布成本、可见阈值、广场开关）
├── errors.js        错误码
├── lib.js           校验、游标、指纹
├── security.js      内容安全（同步，失败不放行）
├── questions.js     必答问题模板
├── repo/            db / offers / votes / social
└── service/         offer / vote / me / admin
```

接口：`offer.list / mine / create / detail / result / decide`、`vote.create`、
`review.create`、`report.create`、`me.get`、`admin.queue / moderate / takedown`。

部署、集合权限、索引见 **[docs/db-init.md](docs/db-init.md)**。其中两条最关键：

- 集合权限必须全设「所有用户不可读写」；
- `votes(offer_id, voter_id)` 唯一索引必须建。

少一条，「先投后看」和「一人一票」都只剩注释。

## 六、测试

```bash
node dev/test-backend.js   # 72 条：三种视角、一人一票、配额、内容安全、举报、对账
node dev/simulate.js       # 46 条：页面三态、审批链路、作者视角、WXML 字段对账
```

两个都不需要开发者工具、不需要云环境。后端用内存版 SDK 跑真实云函数代码，页面用真实 `api.js` 跑降级链路。

## 七、从 H5 改成小程序，改了哪些

| 原来（H5） | 现在 | 为什么 |
|---|---|---|
| DOM + `innerHTML` | `data` + `setData` | 没有 DOM |
| `localStorage` | `wx.setStorageSync` | 小程序没有 localStorage |
| `px`、CSS 变量、`*`、`grid` | `rpx` + flex | WXSS 不支持 |
| 自定义 tab | 原生 tabBar | 手势与性能 |
| 弹层里塞 textarea | `wx.showModal({editable})` | textarea 是原生组件，会盖住弹层 |
| 本地读写 store | `utils/api.js` 远程 + 降级 | 数据要共享 |

## 八、上线前必须处理

1. **类目**：个人主体基本开不了公开 UGC 广场。先按工具类目只做群内审批，企业主体再开广场；`config.FEATURE_PUBLIC_PLAZA` 控制。
2. **内容安全**：`msgSecCheck` 已接；举报入口和后台删除能力审核会查。
3. **名誉权**：公司名默认脱敏；被投诉 7 日内响应。
4. **数据留存**：已下架内容保留 ≥6 个月备查。

## 九、设计上不要动的地方

- **三态判决**（接 / 再等等 / 别接）：二元会逼人在没信息时签字；
- **必须回答至少一个问题**：只表态的审批没有信息增量；
- **先投后看**：包括票型分布，在接口层就不返回；
- **作者满 3 票才解锁理由**：避免被一两条意见带跑；
- **不显示最高票、不做薪资排行**：一旦变成晒 offer 的广场，真实求助者立刻消失；
- **不卖判决、不卖优先曝光**：这是这个产品唯一的值钱东西。

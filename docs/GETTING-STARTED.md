# 启动流程

三种跑法，按你手上的条件选：

| 场景 | 需要什么 | 走哪一节 |
|---|---|---|
| 只想看看长什么样、点点看 | Node 18+ | [一、本地跑起来](#一本地跑起来五分钟) |
| 要调样式、调交互 | Node + 微信开发者工具 | [二、开发者工具](#二在微信开发者工具里跑) |
| 要真上线、多人共享 | 企业主体 + 云开发 | [三、连真实云开发](#三连真实云开发) |

> 仓库根目录记为 `./`。所有命令都在仓库根目录执行。

---

## 一、本地跑起来（五分钟）

两个进程：一个真后端，一个页面预览。

### 1. 起后端

```bash
node offer-please-wait-mp/dev/local-backend/server.js
```

看到这两行就成了：

```
[seed] 空库，用真实接口灌入 5 条演示数据…
backend: http://127.0.0.1:8898/api  (health: /health)
data:    .../dev/local-backend/data.json
```

它跑的是 `offer-please-wait-mp/cloudfunctions/api` 的**真实云函数代码**，只把 `wx-server-sdk` 换成了文件持久化实现。路由、鉴权、视角隔离、配额、内容安全检查，全是生产那份逻辑。

自检：

```bash
curl http://127.0.0.1:8898/health
# {"ok":true,"offers":5,"votes":11,"users":8}
```

### 2. 起页面

另开一个终端：

```bash
node offer-please-wait-mp/dev/preview/serve.js
```

打开：

```
http://127.0.0.1:8899/dev/preview/preview.html
```

这就是小程序页面本身——预览器把真实的 WXML 解析成 DOM、真实的 WXSS 注入（只做 rpx→px）、真实的页面 JS 原样加载，并模拟了原生导航栏和 tabBar。

### 3. 验证「两个人互相审」

开两个窗口，`?me=` 换掉就是另一个人：

```
http://127.0.0.1:8899/dev/preview/preview.html?me=openid-A#/pages/plaza/plaza
http://127.0.0.1:8899/dev/preview/preview.html?me=openid-B#/pages/plaza/plaza
```

A 发的 offer，B 刷得到、审得了；B 审完，A 刷新就能看到票型和理由。

**检查清单**（逐条对一遍，说明链路是通的）：

- [ ] 广场有 5 条数据，倒计时在走；
- [ ] 点进任意一条，未投票时**看不到票型**，只有「你来审」表单；
- [ ] 不写理由直接提交 → 被拦（至少 10 字）；
- [ ] 理由写了但一题没答 → 被拦；
- [ ] 提交成功 → 立刻出现票型、印章和问题清单；
- [ ] 同一条再投一次 → 「你已经审过这一条了」；
- [ ] 自己发的 offer 里没有投票入口，显示「还没有人审」。

### 4. 重置演示数据

```bash
# 停掉后端，删掉数据文件，重启即重新灌种子
rm offer-please-wait-mp/dev/local-backend/data.json
node offer-please-wait-mp/dev/local-backend/server.js
```

---

## 二、在微信开发者工具里跑

### 1. 导入

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)；
2. 「导入项目」→ 目录选 **`offer-please-wait-mp`**（注意不是仓库根目录）；
3. AppID 选「**测试号**」，或填你自己的（`project.config.json` 里是 `touristappid`，游客模式可直接编译）；
4. 编译。

### 2. 三种数据模式

小程序启动时会自动选，不需要改代码：

```
① 云函数（配了云环境就走这个）
② 本地后端 127.0.0.1:8898（起了服务且域名校验关掉时走这个）
③ 内置演示数据（什么都没配时的兜底，广场底部会显示「本地演示模式」）
```

想强制指定，在开发者工具的 **Storage 面板**加一项：

```
__api_mode = cloud | http | local
```

### 3. 连本地后端

1. 照第一节把 `server.js` 起起来；
2. 开发者工具 → 右上角「详情」→「本地设置」→ 勾上 **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**；
3. 重新编译。广场底部应显示「已连本地后端」。

### 4. 真机预览

点「预览」扫码即可。注意：**手机访问不到 `127.0.0.1`**，所以真机上会自动退回「本地演示模式」。要在真机上连本地后端，把 `offer-please-wait-mp/utils/api.js` 里的 `LOCAL_API` 改成本机局域网 IP（如 `http://192.168.1.10:8898/api`），并保证手机同网段。

---

## 三、连真实云开发

这一步会真正产生多人共享的数据。

### 1. 开通环境

开发者工具 → 云开发 → 新建环境 → 在「项目设置」里把项目绑定到它。

代码里不用写死环境 ID：`utils/api.js` 调的是 `wx.cloud.init({ traceUser: true })`，不传 env 就用默认环境。

### 2. 建集合、关权限、建索引

**照 [`offer-please-wait-mp/docs/db-init.md`](../offer-please-wait-mp/docs/db-init.md) 做，不要跳。**

其中两条是功能而不是优化，少一条产品就漏了：

- 10 个集合权限全部设为「所有用户不可读写」——否则客户端能直连数据库，把别人的判断全捞出来，「先投后看」当场作废；
- `votes(offer_id, voter_id)` 建**唯一索引**——否则「一人一票」只是一行注释。

同样必须建的还有 `quota_ledger(user_id, reason, ref_id)` 唯一索引。

### 3. 部署云函数

1. 右键 `cloudfunctions/api` → **上传并部署：云端安装依赖**；
2. 右键 `cloudfunctions/timer` → 同上；
3. 确认「内容安全」接口已开通（`api/config.json` 已声明 `security.msgSecCheck` 权限）；
4. `timer/config.json` 已带两个定时触发器：`expire`（每分钟过期收口）、`reconcile`（每小时票型对账）。

### 4. 验证

**不要用云函数控制台的「测试」按钮验业务接口**——那里 `getWXContext().OPENID` 是空的，所有接口都会返回 `40101`。这是故意的安全设计，不是 bug。

正确做法是用开发者工具真机预览，按这个顺序点：

1. 发一条 offer → 返回 `published` 和 4 个问题；
2. 换另一个微信号 → 广场能看到，且看不到票型；
3. 投票 → 返回票型；再投一次 → `40302`；
4. 第三个号投满 3 票 → 作者能看到全部理由；
5. 作者发第二条 → `40301`，提示还差几次审批（审 3 发 1）。

---

## 四、常见问题

**打开预览是白屏 / 报「模块不存在」**
先确认 `serve.js` 是从仓库根目录下运行的（它按仓库结构找文件），再用浏览器控制台看具体报错。

**后端 8898 起不来**
端口被占。换端口：`node .../server.js 8899` 不行——预览器要用 8899，所以后端换 `8897`，同时改 `utils/api.js` 里的 `LOCAL_API`。

**预览里所有请求都失败、底部显示「本地演示模式」**
后端没起，或 `LOCAL_API` 指向的地址不对。先 `curl http://127.0.0.1:8898/health` 自检。

**开发者工具里报「不在以下 request 合法域名列表中」**
「详情 → 本地设置 → 不校验合法域名」勾上。

**接口全返回 40101**
你是在云函数控制台点的测试，那里没有 openid。换成真机预览。

**发了 offer 但广场刷不到**
状态可能是 `reviewing`（内容进了人工队列）。作者自己能看到，别人看不到。到后台用 `admin.queue` 处理，或直接看 `moderation_tasks` 集合。

**数据乱了想重来**
本地后端：删 `data.json` 重启。内置演示：Storage 里删 `opw_mock_v1`，或用 `#/pages/plaza/plaza?fresh=1`。

---

## 五、测试

都不需要开发者工具，也不需要云环境：

```bash
node offer-please-wait-mp/dev/test-backend.js
# 72 条：三种视角拿到的字段不同、一人一票、配额审 3 发 1、内容安全、举报下架、后台审核、过期收口、对账

node offer-please-wait-mp/dev/simulate.js
# 46 条：页面三态、审批链路、作者视角、WXML 绑定字段对账、禁止直连数据库的静态检查
```

改完代码先跑这两条，比在开发者工具里点半天快得多。

---

## 六、目录速查

| 想找什么 | 去哪 |
|---|---|
| 页面 | `offer-please-wait-mp/pages/` |
| 数据入口（三级降级） | `offer-please-wait-mp/utils/api.js` |
| 业务逻辑 | `offer-please-wait-mp/cloudfunctions/api/server/service/` |
| 数据访问 | `offer-please-wait-mp/cloudfunctions/api/server/repo/` |
| 建库清单 | `offer-please-wait-mp/docs/db-init.md` |
| 后端方案 | `docs/backend-plan.md` |
| 本地后端 | `offer-please-wait-mp/dev/local-backend/server.js` |
| 预览器 | `offer-please-wait-mp/dev/preview/` |

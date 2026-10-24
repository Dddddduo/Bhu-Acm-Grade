# ⚡ Bhu-Acm-Grade — BUH ACM 程序设计工作室成绩榜

线上地址:https://github.com/Dddddduo/Bhu-Acm-Grade (GitHub Pages,本仓库 Actions 自动部署,名单改完 push 即生效)

展示工作室成员在 Codeforces / 牛客的竞赛成绩排名,用于监督学习、互相激励。
**无数据库、无后端快照**——数据全部由访问者浏览器实时抓取并缓存在本地,页面只是一个"看数据的前端",仓库里唯一的手工数据文件是成员名单。

---

## 目录

- [页面长什么样(功能)](#页面长什么样功能)
- [架构](#架构)
- [数据流](#数据流)
- [积分与奖牌](#积分与奖牌scorejs)
- [数据加载策略](#数据加载策略缓存优先)
- [数据来源](#数据来源)
- [开发流程与时间节点](#开发流程与时间节点)
- [技术难点与踩坑记录](#技术难点与踩坑记录)
- [部署牛客代理](#部署牛客代理线上访客需要)
- [使用方法:本地开发与部署](#使用方法本地开发与部署)
- [日常维护](#日常维护)

---

## 页面长什么样(功能)

- **顶部 Hero**:居中大标题「⚡ BUH ACM 程序设计工作室 ⚡」+ 金色下划线,右上角是"更新于…"时间戳;
  标题下方一条**占满整行的励志标语轮播条**(毛玻璃质感、金色左侧竖线、右侧进度圆点可点击切换),
  每 5 秒切换一条,标语内容在 `src/App.vue` 顶部的 `TICKER_LINES` 数组里,想换直接改那个数组。
- **新生 / 老登 两个 Tab** 分开看,各自显示在册人数。
- **今日概览三卡**:在册人数 / 今日已刷题人数(CF)/ 今日合计题数。
- **🌟 今日之星**:当天 CF 解题数前 3 名上领奖台——冠军居中放大(金色描边 + 呼吸光效),
  每张卡片显示题数、占今日总量的百分比条,点击直达本人 Codeforces 主页;并列时共享名次(奖牌按名次给,站位按出场顺序)。
  当天还没人刷题时显示「👑 虚位以待」激励占位,这块永远不空。
- **榜单表格**(桌面)/ **卡片视图**(窄屏 <760px):评级(奖牌)、成员、7 个数据列、主页链接;
  表头吸附、左侧评级/成员两列在横向滚动时吸附,表格整体全量展开、不做内部滚动。
- **搜索**(姓名/班级/学号/账号)+ **班级下拉筛选**。
- **📐 数据口径说明**折叠面板:每列怎么算的,页面里自查,不用翻文档。
- 空值一律显示「**未定级**」,不用 `—`;抓失败的人保留旧值、绝不清空。

---

## 架构

```
Bhu-Acm-Grade/
├── index.html                   # Vite 入口页
├── vite.config.js               # base './',产物用相对路径 → 适配 Pages 的 /仓库名/ 子路径
├── public/
│   └── data/members.json        # ★ 唯一手工维护的文件:成员名单(分组/姓名/班级/学号/CF handle/牛客 uid)
├── src/
│   ├── main.js                  # 挂载 Vue 应用
│   ├── style.css                # 全局变量(CF/牛客段位配色)、背景、滚动条
│   ├── App.vue                  # 页面骨架:hero + 标语轮播 + Tab + 今日之星 + 表格/卡片 + 缓存调度
│   ├── score.js                 # 积分公式、奖牌切分(想改规则只动这里)
│   ├── columns.js               # 列配置(展示哪些列、怎么上色、哪列高亮)
│   ├── liveCf.js                # 浏览器端直连 CF 官方 API 抓取(限速闸门 + 分页)
│   ├── liveNc.js                # 浏览器端经代理抓牛客 Rating/总过题(WORKER_URL 在这里)
│   └── components/
│       ├── RankTable.vue        # 桌面表格(排序、吸附列、奖牌)
│       ├── TierBadge.vue        # 段位上色徽章(CF 官方段位 / 牛客 Rating 分段)
│       └── MobileCards.vue      # 窄屏卡片视图(METRICS 硬编码,加列时和 columns.js 一起改)
├── scripts/
│   ├── ncTencentScf.js          # 牛客代理 · 腾讯云 SCF Web 函数(当前线上在用)
│   ├── ncWorker.js              # 牛客代理 · Cloudflare Worker(备用方案)
│   └── wrangler.toml            # Worker 部署配置
├── .github/workflows/deploy.yml # push main → 构建 → dist 回提仓库 → 发布 Pages
└── dist/                        # 打包产物(由 Action 自动提交回仓库,勿手改)
```

**技术栈只有一个依赖:Vue 3(Composition API)+ Vite。** 没有路由、没有状态库、没有 UI 框架、没有后端。

### 数据流

```
members.json(名单)
      │
      ▼
 App.vue 启动 ──► localStorage 缓存命中?──是──► 立刻渲染,10 分钟内不再抓
      │否/超期
      ├─► liveCf.js ──直连──► Codeforces 官方 API(user.info 批量 + user.status 逐人,2s 限速)
      └─► liveNc.js ──HTTP──► 腾讯云 SCF 代理 ──► 牛客 rating-history / 个人主页统计块
      │
      ▼ (抓完一个人立刻写回缓存,增量合并)
 score.js:computeScore 算总分 → assignLevels 切金银铜/未定级
      │
      ▼
 RankTable.vue / MobileCards.vue 渲染;今日之星、概览卡从同一份数据现算
```

---

## 积分与奖牌(`src/score.js`)

总分 100 = **CF 相关 75 分 + 牛客相关 25 分**,每项 `min(指标值 ÷ 上限, 1) × 权重`,没数据的项按 0 计:

| 分项 | 权重 | 归一化上限 |
| --- | --- | --- |
| CF 当前 Rating | 30 | 2400 |
| CF 最高 Rating | 5 | 2400 |
| CF 近30天做题 | 10 | 100 题 |
| CF 总做题 | 30 | 1500 题 |
| 牛客 Rating | 10 | 2400 |
| 牛客总过题 | 15 | 1500 题 |

按总分在**当前分组内**排名,切奖牌:**前 12% 金牌、随后 24% 银牌、随后 36% 铜牌**(名额都向上取整,
并列总分同名次 1,2,2,4 式)。奖牌线之后、或一项数据都没有的人 → 显示**未定级**。鼠标悬停名次可看每人总分。

**老登榜不评奖牌**:老登分组隐藏评级/奖牌列,只列数据,并标注**「排名不分先后」**。

**默认排序**:新生按**总分**(第一眼看到正确名次);老登按 **CF 最高分**(仅排列)。
点任意表头可换成按那一列排序——新生榜奖牌等级始终按总分切,换排序列不影响每个人的奖牌。

---

## 数据加载策略:缓存优先

- 打开页面**先用 localStorage(key `bhu-acm-live-cache-v1`)立刻渲染**,完全不碰三方接口;
- 缓存超过 **10 分钟**(`LIVE_EVERY_MS`)才自动重抓一轮;页面开着每分钟看一眼是否超期,
  标签页切回来(`visibilitychange`)也会检查;
- **抓完一个人立刻填一行并写回缓存**(中途关页不亏);某人抓失败只跳过他、保留旧值,绝不清空;
- CF 与牛客两路**互不拖累**:代理挂了牛客两列显示未定级,CF 各列照常。

## 数据来源

| 列 | 来源 |
| --- | --- |
| CF Rating / CF 最高分 | CF 官方 API `user.info`(一次批量,允许跨域直连,实测 ACAO: *) |
| CF 总做题 / CF 近30天 / CF 今日 | CF 官方 API `user.status`(逐人拉提交历史,verdict=OK **按题目去重**;近30天为滚动 30 天窗口;**今日按北京时间 0 点起**,今天还没抓到就显示未定级,绝不拿昨天的数冒充;遵守官方 2 秒 1 次限速) |
| 牛客 Rating | 牛客 `rating-history` 接口最新一条记录。该接口对**带跨站 Origin 的请求会被阿里云 WAF 拦成 JS 验证页**(实测,与 CORS 无关),浏览器无法直连,**只经服务端代理获取**(当前:腾讯云 SCF) |
| 牛客总过题 | 牛客个人主页(practice-coding)头部官方统计块「N 题已通过」= 按题目去重的 AC 数(与 CF 总做题同口径;实测与逐页爬 37 页结果一致:uid 619886673 → 1286)。同样只走代理,单次请求同步返回,代理侧约每 10 分钟缓存更新 |

> CF 接口浏览器直连,无需任何服务。整站对三方接口的请求都发生在**访问者自己的浏览器**里,
> 服务器(GitHub Pages)只发静态文件,所以 Pages 免费额度永远够用。

---

## 开发流程与时间节点

项目从空仓库到可用线上服务共 **3 天**,整体路线:**先跑通数据,再跑通国内网络,最后打磨展示**。

| 时间 | 里程碑 | 做了什么 |
| --- | --- | --- |
| 2026-10-19 18:31 | **初始化** | Vue 3 + Vite 骨架、members.json 名单、表格渲染、GitHub Pages Action 上线 |
| 2026-10-19 18:43 | 数据方案定型 | 放弃"Action 定时抓快照"思路,改为**浏览器端实时抓取 + localStorage 缓存**(Pages 只是静态托管,跑不了定时任务;抓在访客浏览器,零服务器成本) |
| 2026-10-19 19:37 | 定时抓取 | liveCf.js/liveNc.js 成型:进页面自动抓、抓完写缓存;Action 精简为"只打包发布" |
| 2026-10-19 19:45 | 自动刷新 | 页面开着每 5 分钟自动抓一轮(后定为 30 分钟,现调至 10 分钟,见下) |
| 2026-10-19 20:14–21:35 | 修自动流 ×4 | 连续修 GitHub Actions 自动部署的触发链路(dist 回提触发空转、权限、paths-ignore 等) |
| 2026-10-20 20:27 | 自动流收尾 | 部署流最终稳定:push main → 构建 → dist 回提 → Pages 发布,不再空转 |
| 2026-10-20 21:43 | **牛客代理切腾讯云 SCF + 新积分权重** | 排查确认 `*.workers.dev` 被 GFW SNI 阻断、大陆访客打不到 Cloudflare Worker → 代理后端整体迁到**腾讯云 SCF Web 函数**(默认域名大陆直连、免备案、有免费额度),代码逻辑与 Worker 版完全一致;同时落地新积分口径(CF 75 + 牛客 25,权重表见 score.js) |
| 2026-10-20 21:47 – 10-21 12:20 | 修国内代理问题 | SCF 上线后的兼容性连环修:Web 函数事件结构解析、冷启动超时放宽(15s)、`&debug=1` 带 `_v` 版本号便于确认线上代码版本、缓存 TTL 节流 |
| 2026-10-21 | **展示层完善** | hero 居中大标题 + 整行励志标语轮播;今日之星升级领奖台(冠军居中放大、并列名次共享奖牌、「虚位以待」空态占位);榜单表格全量展开去掉内部滚动;移动端 ≤640px 适配 |
| 2026-10-24 | 在线状态调优 | 修 handle 大小写不敏感匹配(毕升乐在线状态永不亮的根因);在线判定窗口与抓取节奏多轮调整,访问窗口定为 **30 分钟**;同日确认 `user.info` 的 `lastOnlineTimeSeconds` 官方滞后(实测有人 5 分钟前刚交题、字段还停在 91 分钟前),改为**双信号判定**:访问 CF < 30 分钟 或 最新交题 < 60 分钟 ⇒ 在线 |

**当前刷新节奏**:每 10 分钟一轮(`LIVE_EVERY_MS`)。CF 官方限速按 2 秒 1 次算,项目闸门 `GAP_MS=3000` 留了余量;
38 人全量一轮约 2 分钟,靠 `liveBusy` 锁保证上一轮没抓完不会叠加下一轮。在线判定双窗口(`online.js` 的
`ONLINE_WINDOW_SEC` = 30 分钟访问 / `SUBMIT_WINDOW_SEC` = 60 分钟交题)都宽于抓取节奏——窗口小于节奏会把"真在线但还没轮到抓取"的人误判成离线;
窗口比节奏宽的代价是刚下线的人标签最多晚 (窗口 − 上次抓取时刻差) 才变灰,由 30 秒一跳的 `nowSec` 在到期时刻自动判灰。
交题信号顺带取自每轮本来就发的 `user.status`(最新提交时间),不额外请求。

---

## 技术难点与踩坑记录

按"卡住最久"排序,每条都是实测结论:

1. **牛客接口对浏览器彻底关门(WAF)**——`rating-history` 只要请求带跨站 `Origin` 头,阿里云 WAF
   就按机器人处理,返回 HTTP 200 但 body 是 JS 验证页(HTML)。浏览器 fetch **必发 Origin,绕不过去**,
   与 CORS 配置无关。结论:牛客数据**必须服务端代理**,浏览器直连这条路是死的。
   代理侧判断响应是否被 WAF 拦:`isWafHtml()`(匹配 `aliyun_waf|aliyunCaptcha` 或非 HTML)。
2. **Cloudflare Worker 在大陆打不通**——第一版代理用 Worker,逻辑没问题,但公共子域 `*.workers.dev`
   被 GFW 按 SNI 阻断,大陆访客时通时断,牛客两列大面积未定级。解法:换**腾讯云 SCF Web 函数**
   (默认域名 `*.tencentscf.com` 大陆直连、免备案、免费额度够)。两版接口完全一致
   (`GET <URL>?uid=...`),前端换后端只改 `src/liveNc.js` 顶部一行 `WORKER_URL`。
   注意:SCF 新版控制台只有 **Web 函数**能挂公网 HTTP 触发,事件函数已不支持新建 API 网关触发器;
   运行环境必须 Node.js ≥18(代码用了全局 fetch)。
3. **CF 官方 2 秒限速 + 逐人全量提交**——`user.status` 一人一轮要翻多页(每页最多 10000 条),
   35 人串行按 2.2s 闸门排队,一轮要几分钟。对策:全局 `lastAt` 闸门串行化所有请求;
   分页拉取设安全阀(单人最多翻 1 万条);失败跳过保留旧值;"总过题/近30天/今日"都用**题目唯一键去重**
   (正赛 `contestId-index`,gym/自建题库 `problemsetName-index`,兜底题名),同题反复 AC 只算一道。
4. **牛客"总过题数"口径**——最初 Worker 里"后台翻页爬全 + Cache API 存检查点",但 Worker isolate
   随时回收,检查点跨请求易丢,经常每次从第 1 页重爬,数字永远出不来。后来发现 practice-coding
   页头部官方统计块「N 题已通过」与逐页爬 37 页结果完全一致,**只抓第 1 页正则读一行**,单次请求
   同步返回,问题消失。教训:能信官方统计块就别自己爬全量。
5. **GitHub Pages 自动部署空转**——Action 把 `dist/` 提交回仓库会再次触发 push 事件,循环构建。
   解法:`on.push.paths-ignore: [dist/**]` + `concurrency` 组 + 机器人提交信息固定;
   Actions 权限要同时开 `contents: write`(回提 dist)和 `pages: write / id-token: write`(发布 Pages)。
6. **"今日"的时区口径**——服务器、浏览器时区五花八门,统一用**北京时间**:`Date.now() + 8h`
   后取 ISO 日期串作"今天"。今天还没抓到就显示未定级,绝不拿昨天数据冒充。
7. **今日之星领奖台的并列名次排版**——并列共享名次(7,5,5 时两个第二)导致两人都拿到 `.p2`
   class、CSS `order` 相同,冠军被挤偏。解法:视觉站位与名次**解耦**——class 按数组下标给
   `slot1/2/3`(slot1 居中放大、glow 只给冠军),奖牌 emoji 才按 `starRank` 取,`@media (prefers-reduced-motion)` 关掉呼吸动画。
8. **缓存"宁旧勿丢"**——抓失败/超时(代理 15s AbortController)只跳过该人;增量写回,
   关页不亏;`visibilitychange` + 每分钟巡检保证切回标签页也能看到新数据。
9. **样式细节**——页面加宽到 1440 后表格列全部塞进一屏(不写 min-width、无横向滚动);
   `max-height` 内部滚动移除,表格全量展开;移动端 ≤640px 时间戳从绝对定位改回文档流避免与居中标题重叠,
   标语条改竖排、圆点下移。

---

## 部署牛客代理(线上访客需要)

两个后端二选一,接口完全一致(`GET <URL>?uid=...`),换后端只需改 `src/liveNc.js` 顶部的 `WORKER_URL`:

| 方案 | 文件 | 大陆免 VPN? | 要求 |
| --- | --- | --- | --- |
| A. Cloudflare Worker | `scripts/ncWorker.js` | ❌ 公共子域 `*.workers.dev` 被 GFW SNI 阻断;**绑自有域名后 ✅** | CF 免费账号;要稳定服务大陆访客需备一个域名 |
| B. 腾讯云云函数 SCF | `scripts/ncTencentScf.js` | ✅ 默认域名大陆直连 | 腾讯云账号,新建 **Web 函数**,Node.js ≥18,有免费额度(**当前线上在用**) |

B(腾讯云 SCF Web 函数,~10 分钟):
1. [console.cloud.tencent.com/scf](https://console.cloud.tencent.com/scf) → 新建 **Web 函数**,运行环境 Node.js 18.15+,区域上海/广州(离牛客近);
2. 把 `scripts/ncTencentScf.js` 内容**全文替换**进 `index.js`(入口仍是 `main_handler`;改过代码必须重新粘贴部署,不然线上还是旧版);
3. 点「部署」;若提示发布版本/灰度,直接全量发布;「触发方法/基本信息」里拿公网 HTTPS 域名 `https://<appid>-<随机>.<地域>.tencentscf.com`;
4. URL 填进 `src/liveNc.js` 的 `WORKER_URL`,浏览器开 `<URL>?uid=619886673` 应回 `{"nc_rating":...,"nc_total":...}`;
   加 `&debug=1` 回包带 `_v:"v4"`(400 时无条件带 `_v` 和 event 结构诊断)——没有 `_v` 就是还没部署 v4;
5. `npm run build` 后 push,重新部署 Pages 即生效。

A(Cloudflare Worker):
1. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → 新建 Worker;
2. 把 `scripts/ncWorker.js` 全文粘贴进代码编辑器 → Deploy(或 `cd scripts && npx wrangler deploy`);
3. 复制地址填进 `src/liveNc.js` 的 `WORKER_URL`(大陆免 VPN 访问请绑自有域名,见 ncWorker.js 头注释);
4. `npm run build` 后 push。

两种方式改过代理代码后都要**重新部署一次函数/Worker 才生效**(不会自动跟仓库更新)。
详细步骤与大陆网络注意事项见两个脚本各自的文件头注释。

---

## 使用方法:本地开发与部署

```bash
npm install
npm run dev       # 开发服务器 http://localhost:5173,改代码热更新
                  # (牛客两列需要有 WORKER_URL 指向的代理在线才有数)
npm run build     # 产物输出到 dist/
npm run preview   # 本地预览打包产物(验证构建结果用)
```

**部署**:仓库 Settings → Pages → Source 选 "GitHub Actions"。之后每次 push 到 main,
`.github/workflows/deploy.yml` 自动:装依赖 → `npm run build` → 把 `dist/` 提交回仓库
(`dist/**` 的提交不再触发构建)→ 发布到 GitHub Pages。**名单/代码改完 push 即上线,无需手动构建。**

**看线上数据**:直接访问 Pages 地址,首次打开现抓(约几分钟,视人数),之后进来先用缓存秒开。

---

## 日常维护

**改名单**:编辑 `public/data/members.json`,push 到 main 即自动重新部署。

```json
{ "id": 1, "group": "fresh", "name": "张三", "clazz": "计算机2301", "student_id": "2023001001",
  "cf_handle": "xxx", "nowcoder_id": "xxx" }
```

- `group`:`fresh` 新生(按总分切奖牌)/ `old` 老登(不评奖牌,排名不分先后,两个 Tab 分开看);
- `id` 唯一即可,新成员往后加;`cf_handle` / `nowcoder_id` 缺哪个,对应列就显示未定级;
- 改班级/学号等纯展示信息,同样 push 即生效(已开页的访客最多等缓存过期)。

**改积分规则/奖牌比例**:只动 `src/score.js`(`METRIC_WEIGHTS` 权重表与 `assignLevels` 里的 12%/24%/36%)。

**加/改列**:`src/columns.js` + `MobileCards.vue` 的 `METRICS` 两处一起改(手机端卡片是硬编码的)。

**改励志标语**:`src/App.vue` 顶部 `TICKER_LINES` 数组;轮播间隔 `TICKER_MS`(默认 5000ms)。

**刷新频率**:`src/App.vue` 的 `LIVE_EVERY_MS`(当前 10 分钟)。

---

© BHUACM2026 · 代码仓库:https://github.com/Dddddduo/Bhu-Acm-Grade

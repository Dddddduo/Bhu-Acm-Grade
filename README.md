# ⚡ Bhu-Acm-Grade — BUH ACM 程序设计工作室成绩榜

https://github.com/Dddddduo/Bhu-Acm-Grade

展示工作室成员在 Codeforces / 牛客的竞赛成绩排名,用于监督学习、互相激励。
线上地址:GitHub Pages(本仓库 Actions 自动部署),名单改完 push 即生效。

## 架构(刻意保持简单,无数据库、无快照)

```
public/data/members.json   ← 唯一手工维护的文件:成员名单(姓名/班级/学号/账号)
src/                       ← Vue 3 + Vite 前端:实时抓取 + 浏览器 localStorage 缓存
src/score.js               ← 积分公式与金/银/铜牌切分(想改规则只动这里)
src/columns.js             ← 列定义(展示什么列、配色、链接格式都在这)
scripts/ncTencentScf.js    ← 牛客代理 · 腾讯云 SCF Web 函数(当前线上在用,大陆免 VPN)
scripts/ncWorker.js        ← 牛客代理 · Cloudflare Worker(备用,大陆需 VPN 或绑自有域名)
```

页面列依次展示 **CF Rating · CF 最高分 · CF 总做题 · CF 今日 · CF 近30天 · 牛客 Rating ·
牛客总过题数 · 主页链接**。页面展示什么列、怎么配色、链接格式 → 全部集中在
**`src/columns.js`**(手机端卡片视图 `MobileCards.vue` 里的 `METRICS` 是硬编码的,
加列时两边都要改)。

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
并列总分同名次)。奖牌线之后、或一项数据都没有的人 → 显示**未定级**(页面所有空值都是「未定级」,
不用 `—`)。鼠标悬停名次可看每人总分。

**老登榜不评奖牌**:老登分组隐藏评级/奖牌列(桌面表格整列去掉、手机卡片去掉徽章),
只列数据,并在表格上方标注**「排名不分先后」**——默认排序只是排列方式,不代表名次。

**默认排序**:新生按**总分**(第一眼看到正确名次);老登按 **CF 最高分**(仅排列,不代表名次)。
点任意表头可换成按那一列排序——新生榜奖牌等级始终按总分切,换排序列不影响每个人的奖牌;
老登榜无奖牌,随排序列自由查看。

## 数据加载:缓存优先,不每次进页面重抓

- 打开页面**先用 localStorage 缓存立刻渲染**,完全不碰三方接口;
- 缓存超过 **30 分钟**才自动重抓一轮;页面开着每 30 分钟更新一轮(切回标签页也会检查);
- 抓完一个人立刻填一行并写回缓存(中途关页不亏);某人抓失败只跳过他、保留旧值,绝不清空。

## 数据来源

| 列 | 来源 |
| --- | --- |
| CF Rating / CF 最高分 | CF 官方 API `user.info`(一次批量,允许跨域直连) |
| CF 总做题 / CF 近30天 / CF 今日 | CF 官方 API `user.status`(逐人拉全部提交,verdict=OK 按题目去重;近30天为滚动 30 天窗口;今日按北京时间 0 点起,今天还没抓到就显示未定级;遵守官方 2 秒 1 次限速) |
| 牛客 Rating | 牛客 `rating-history` 接口取最新一条记录的 rating。该接口对**带跨站 Origin 的请求会被阿里云 WAF 拦成 JS 验证页**(实测,与 CORS 无关),浏览器无法直连,**只经代理获取**(当前:腾讯云 SCF Web 函数 `scripts/ncTencentScf.js`) |
| 牛客总过题 | 牛客个人主页(practice-coding)头部官方统计块「N 题已通过」= 按题目去重的 AC 题数(同题反复 AC 只算一次,与 CF 总做题同口径;实测与逐页爬 37 页结果一致:uid 619886673 → 1286)。同样只走代理,单次请求同步返回,约每 10 分钟更新;取不到时显示**未定级** |

> CF 接口浏览器直连,无需任何服务。牛客两列依赖 Worker:Worker 没配/挂了(或大陆网络访问
> workers.dev 不通)时页面照常运行,牛客列显示未定级,CF 各列不受影响。

**部署牛客代理(线上访客需要)** —— 两个后端二选一,接口完全一致(`GET <URL>?uid=...`),
换后端只需改 `src/liveNc.js` 顶部的 `WORKER_URL`:

| 方案 | 文件 | 大陆免 VPN? | 要求 |
| --- | --- | --- | --- |
| A. Cloudflare Worker | `scripts/ncWorker.js` | ❌ 公共子域 `*.workers.dev` 被 GFW SNI 阻断;**绑自有域名后 ✅** | CF 免费账号;要稳定服务大陆访客需备一个域名 |
| B. 腾讯云云函数 SCF | `scripts/ncTencentScf.js` | ✅ 默认域名大陆直连 | 腾讯云账号,新建 **Web 函数**(事件函数已不支持 API 网关触发),有免费额度 |

A(Cloudflare Worker):
1. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → 新建 Worker;
2. 把 `scripts/ncWorker.js` 全文粘贴进代码编辑器 → Deploy;
3. 复制 `https://<名字>.<子域>.workers.dev` 地址,填进 `src/liveNc.js` 顶部的 `WORKER_URL`
   (大陆免 VPN 访问请改绑自有域名,见 ncWorker.js 头注释);
4. `npm run build` 后 push,重新部署 Pages 即生效。

B(腾讯云 SCF Web 函数,~10 分钟,**当前线上在用**):
1. [console.cloud.tencent.com/scf](https://console.cloud.tencent.com/scf) → 新建 **Web 函数**,Node.js 18.15+(必须 ≥18,代码用全局 fetch),区域上海/广州;
2. 把 `scripts/ncTencentScf.js` 内容**全文替换**进 `index.js`(改过代码必须重新粘贴部署,不然线上还是旧版);
3. 点「部署」;「触发方法/基本信息」里拿公网 HTTPS 域名 `https://<appid>-<随机>.<地域>.tencentscf.com`;
4. URL 填进 `src/liveNc.js` 的 `WORKER_URL`,浏览器开 `<URL>?uid=619886673` 应回 `{"nc_rating":...,"nc_total":...}`;
   加 `&debug=1` 回包带 `_v:"v4"`(400 时无条件带 `_v` 和 event 结构诊断)——没有 `_v` 就是还没部署 v4;
5. `npm run build` 后 push。

两种方式改过代理代码后都要**重新部署一次函数/Worker 才生效**(不会自动跟仓库更新)。
详细步骤与大陆网络注意事项见两个脚本各自的文件头注释。

## 本地开发与部署

```bash
npm install
npm run dev       # http://localhost:5173(需要 WORKER_URL 指向已部署的 Worker,牛客列才有数)
npm run build     # 产物在 dist/
```

**部署**:仓库 Settings → Pages → Source 选 "GitHub Actions",push 到 main 后
`.github/workflows/deploy.yml` 自动构建并发布到 GitHub Pages,同时把 `dist/` 打包产物提交回仓库。

## 日常维护

**改名单**:编辑 `public/data/members.json`,push 到 main 即自动重新部署。

```json
{ "id": 1, "group": "fresh", "name": "张三", "clazz": "计算机2301", "student_id": "2023001001",
  "cf_handle": "xxx", "nowcoder_id": "xxx" }
```

- `group`:`fresh` 新生(按总分切奖牌)/ `old` 老登(不评奖牌,排名不分先后,两个 Tab 分开看);
- `cf_handle` / `nowcoder_id` 缺哪个,对应列就显示未定级。

**改积分规则/奖牌比例**:只动 `src/score.js`(`METRIC_WEIGHTS` 与 `assignLevels` 里的 12%/24%/36%)。

**加/改列**:`src/columns.js` + `MobileCards.vue` 的 `METRICS` 两处一起改。

---

© BHUACM2026 · 代码仓库:https://github.com/Dddddduo/Bhu-Acm-Grade

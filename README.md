# Bhu-Acm-Grade — BUH ACM 程序设计工作室成绩榜

展示工作室成员在 Codeforces / 牛客的竞赛成绩排名,用于监督学习、互相激励。

## 架构(刻意保持简单,无数据库)

```
public/data/members.json   ← 唯一手工维护的文件:成员名单(姓名/班级/学号/账号)
public/data/stats.json     ← 脚本生成:各平台成绩快照(不要手改)
scripts/fetchStats.js      ← 调各平台 API,把成绩写进 stats.json
src/                       ← Vue 3 + Vite 前端,只读上面两个 JSON
.github/workflows/refresh.yml ← GitHub Actions 定时刷新 + 自动部署 Pages
```

页面展示什么列、怎么配色、链接格式 → 全部集中在 **`src/columns.js`**,加列不用碰组件。

## 日常维护

**改名单**:编辑 `public/data/members.json`,push 到 main 即自动重新部署。

```json
{ "id": 1, "name": "张三", "clazz": "计算机2301", "student_id": "2023001001",
  "cf_handle": "xxx", "nowcoder_id": "xxx" }
```

**本地开发**:

```bash
npm install
npm run refresh   # 抓一次成绩(需联网)
npm run dev       # http://localhost:5173
```

**部署**:仓库 Settings → Pages → Source 选 "GitHub Actions",push 后 Actions 每天自动刷新成绩并部署。

## 待接入

- [ ] Codeforces 官方接口文档 → `fetchCodeforces()`(做题数等指标)
- [ ] 牛客 API 文档 → `fetchNowcoder()`;若需密钥,放 GitHub Secrets `NOWCODER_TOKEN`,勿写进代码

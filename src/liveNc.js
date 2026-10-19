// ============================================================
// 浏览器端定时抓取牛客数据(和 liveCf.js 同一轮,约 5 分钟一次)
//
// 为什么浏览器能直接抓牛客?(2026-10 实测,推翻了旧注释"牛客不允许跨域")
//  - 牛客页面响应带 access-control-allow-origin: <回显请求来源>,任意站点都放行
//  - 纯 GET、不加任何自定义头 -> 不触发 CORS 预检,fetch 直接可读
//  - 浏览器发的是真实 Chrome UA,拿到的是服务端渲染 HTML,和抓取脚本一致
//
// 抓什么(解析正则与 scripts/fetchStats.js 保持同一套,页面改版要两边一起改):
//  - /acm/contest/profile/<uid>                  -> nc_rating / nc_rank
//  - /acm/contest/profile/<uid>/practice-coding  -> nc_solved(题已通过 = 总过题数)
//
// 限速:单人 2 个请求,全部人串行排队(相邻请求间隔 NC_GAP_MS),
//       避免几十个请求瞬间砸向牛客把自己 IP 打进验证页
// 任何一个人失败:跳过,保留旧值(上一轮实时值或仓库快照),绝不清空(宁旧勿丢)
// ============================================================

const NC_GAP_MS = 800

let lastAt = 0
async function getHtml(url) {
  const wait = lastAt + NC_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
  const res = await fetch(url) // 不带自定义头 -> 简单请求,无预检
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ---------- 个人主页:Rating / Rating排名 ----------
function parseNcProfile(html) {
  const rec = {}
  const m = html.match(/class="state-num rate-score\d+"[^>]*>\s*([\d,]+)\s*</)
  if (m) rec.nc_rating = Number(m[1].replace(/,/g, ''))
  const r = html.match(/rating-index">([\d,+]+)<\/a>[\s\S]{0,150}?Rating排名/)
  if (r && !r[1].includes('+')) rec.nc_rank = Number(r[1].replace(/,/g, ''))
  return rec
}

// ---------- practice-coding:题已通过(总过题数) ----------
function parseNcSolved(html) {
  const rec = {}
  for (const m of html.matchAll(
    /<div class="my-state-item"[^>]*>\s*<div class="state-num">([\d,]+)<\/div>\s*<span>(题已挑战|题已通过|次提交)<\/span>/g
  )) {
    if (m[2] === '题已通过') rec.nc_solved = Number(m[1].replace(/,/g, ''))
  }
  return rec
}

// 返回 { 成员id: 补丁字段 } —— 调用方把它合并进实时 patch
export async function fetchNcLive(members) {
  const withId = members.filter((m) => m.nowcoder_id)
  const out = {}
  if (!withId.length) return out

  for (const m of withId) {
    const uid = m.nowcoder_id
    const rec = {}
    try {
      Object.assign(rec, parseNcProfile(await getHtml(`https://ac.nowcoder.com/acm/contest/profile/${uid}`)))
    } catch (e) {
      console.warn(`[live nc] ${m.name}(${uid}) 主页失败(保留旧值):`, e)
    }
    try {
      Object.assign(rec, parseNcSolved(
        await getHtml(`https://ac.nowcoder.com/acm/contest/profile/${uid}/practice-coding`)
      ))
    } catch (e) {
      console.warn(`[live nc] ${m.name}(${uid}) 刷题页失败(保留旧值):`, e)
    }
    if (Object.keys(rec).length) out[String(m.id)] = rec
  }
  return out
}

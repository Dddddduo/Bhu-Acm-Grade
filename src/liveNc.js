// ============================================================
// 浏览器端定时抓牛客数据 —— 走本地 Node 代理,不直连 ac.nowcoder.com
//
// 为什么不直连(2026-10 实测):
//  - 牛客页面虽然回显 CORS 头,但挂着阿里云 WAF:浏览器连续几十个跨站请求后
//    直接返回滑块验证页(不带 CORS 头)-> fetch 报 Failed to fetch
//  - 改由本地代理(npm run proxy)代抓:带浏览器 UA、串行 900ms 礼貌间隔、
//    结果缓存,浏览器只面对 http://127.0.0.1:8787(代理回 ACAO: *)
//
// 代理没开(比如线上 Pages 访客)怎么办:
//  - 首轮连接失败 -> 之后整轮直接跳过,只安静用仓库快照数据,不刷屏报错
//
// 解析在代理侧(scripts/ncProxy.js),和 fetchStats.js 同一套正则
// ============================================================

const PROBASE = 'http://127.0.0.1:8787/api/nc?uid='
const PROXY_TIMEOUT_MS = 8000

let proxyDown = false // 代理连不上:置位后不再尝试,页面数据回落快照
let firstErrorLogged = false

async function getNcViaProxy(uid) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PROXY_TIMEOUT_MS)
  try {
    const res = await fetch(PROBASE + encodeURIComponent(uid), { signal: ctl.signal })
    if (res.status === 400) {
      // uid 非法(代理明确回复了 -> 代理是活的),这人跳过
      return null
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `代理返回 HTTP ${res.status}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// 返回 { 成员id: 补丁字段 } —— 调用方把它合并进实时 patch
export async function fetchNcLive(members) {
  if (proxyDown) return {}
  const withId = members.filter((m) => m.nowcoder_id)
  const out = {}
  for (const m of withId) {
    try {
      const rec = await getNcViaProxy(m.nowcoder_id)
      if (rec && Object.keys(rec).length) {
        out[String(m.id)] = rec
        console.log(
          `[live nc] ${m.name}(${m.nowcoder_id}) Rating=${rec.nc_rating ?? '—'} ` +
            `排名=${rec.nc_rank ?? '—'} 已通过=${rec.nc_solved ?? '—'} ` +
            `已挑战=${rec.nc_tried ?? '—'} 提交=${rec.nc_submits ?? '—'}`
        )
      }
    } catch (e) {
      // 单人失败(如被 WAF 盯上):跳过,保留旧值,宁旧勿丢
      console.warn(`[live nc] ${m.name}(${m.nowcoder_id}) 保留旧值:`, e.message || e)
      if (!firstErrorLogged && e instanceof TypeError) {
        // 连不上代理(连接被拒等)-> 视为代理未启动,后续轮次直接跳过
        firstErrorLogged = true
        proxyDown = true
        console.info('[live nc] 本地代理未启动(npm run proxy),牛客数据回落仓库快照')
        return {}
      }
    }
  }
  if (Object.keys(out).length) console.info(`[live nc] 本轮经代理更新 ${Object.keys(out).length} 人`)
  return out
}

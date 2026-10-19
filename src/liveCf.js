// ============================================================
// 浏览器端实时抓取 Codeforces 官方数据(不落盘,只更新内存里的数组)
//
// 为什么能在浏览器里直接抓 CF?
//  - CF API 返回 access-control-allow-origin: *(实测验证),允许任何网页跨域读取
//  - 牛客没有这个头,浏览器抓不到 -> 牛客数据用仓库 stats.json 快照兜底
//    (需要更新牛客时,维护者本地跑 npm run refresh 再 push)
//
// 限速:CF 官方要求最多 1 次/2s,这里 2.2s 闸门串行排队(和 fetchStats.js 同规则)
// 抓什么:
//  - user.info 一次批量拿 rating / maxRating / rank —— 1 个请求,秒开
//  - user.status 每人只翻 1 页(最近 100 条提交)-> 今日 / 近30天过题数
//    (全历史总做题数翻页太多,浏览器里不划算,沿用快照里的 cf_total)
// 任何一个人失败:跳过,保留旧值,绝不清空(数据宁旧勿丢)
// ============================================================

const API = 'https://codeforces.com/api'
const GAP_MS = 2200
const PAGE = 100

let lastAt = 0
async function getJson(url) {
  const wait = lastAt + GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// 北京时间的"今天"日期串,口径和 fetchStats.js 一致
function bjToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function problemKey(s) {
  const p = s.problem
  return p.contestId != null ? `${p.contestId}-${p.index}` : `name-${p.name}`
}

// 返回 { 成员id: 补丁字段 } —— 调用方把它合并进 stats.users
export async function fetchCfLive(members) {
  const withHandle = members.filter((m) => m.cf_handle)
  if (!withHandle.length) return {}

  const out = {}

  // 1) 基本信息:一次批量
  try {
    const handles = [...new Set(withHandle.map((m) => m.cf_handle))]
    const d = await getJson(`${API}/user.info?handles=${handles.join(';')}`)
    if (d.status === 'OK') {
      const byHandle = Object.fromEntries(d.result.map((u) => [u.handle, u]))
      for (const m of withHandle) {
        const u = byHandle[m.cf_handle]
        if (!u) continue
        out[String(m.id)] = {
          cf_rating: u.rating ?? null,
          cf_max_rating: u.maxRating ?? null,
          cf_rank: u.rank ?? '',
          cf_max_rank: u.maxRank ?? '',
        }
      }
    }
  } catch (e) {
    console.warn('[live cf] user.info 批量失败:', e)
  }

  // 2) 今日 / 近30天:每人最近 100 条提交(北京时间今日 0 点起算)
  const nowSec = Math.floor(Date.now() / 1000)
  const shifted = nowSec + 8 * 3600
  const todayStart = shifted - (shifted % 86400) - 8 * 3600
  const monthAgo = todayStart - 30 * 86400
  const todayStr = bjToday()

  for (const m of withHandle) {
    try {
      const d = await getJson(`${API}/user.status?handle=${m.cf_handle}&count=${PAGE}`)
      if (d.status !== 'OK') continue
      const today = new Set()
      const month = new Set()
      for (const s of d.result) {
        if (s.verdict !== 'OK') continue
        if (s.creationTimeSeconds >= monthAgo) month.add(problemKey(s))
        if (s.creationTimeSeconds >= todayStart) today.add(problemKey(s))
      }
      const rec = (out[String(m.id)] ||= {})
      rec.cf_today = today.size
      rec.cf_30d = month.size
      rec.cf_date = todayStr
    } catch (e) {
      console.warn(`[live cf] ${m.name} user.status 失败(保留旧值):`, e)
    }
  }
  return out
}

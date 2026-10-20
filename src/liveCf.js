// ============================================================
// 浏览器端实时抓取 Codeforces 官方数据(官方 API 允许跨域,实测 ACAO: *)
//
// 抓什么(对应各列,方法见仓库根 codeforces官方文档.md):
//  - user.info  一次批量 -> cf_rating / cf_max_rating(含段位名,上色用)
//  - user.status 每人翻全部提交历史(from=1 起每页 10000 条,直到翻完)
//      -> cf_today:北京时间今日 0 点起,verdict=OK 的提交按题目去重计数
//      -> cf_30d :最近 30 天内 verdict=OK 的**不同题目**数(滚动窗口,按提交时间)
//      -> cf_total:全部历史里 verdict=OK 的**不同题目**数(总做题)
// 限速:CF 官方要求最多 1 次/2s,这里 2.2s 闸门串行排队
// 任何一个人失败:跳过,保留旧值,绝不清空(数据宁旧勿丢)
// ============================================================

const API = 'https://codeforces.com/api'
const GAP_MS = 2200
const PAGE = 10000 // user.status 单页上限内取大,减少翻页次数(实测 count=10000 全量返回)
const MAX_PAGES = 20 // 安全阀:单人最多翻 20 万条提交,再多只按已翻到的算

let lastAt = 0
async function getJson(url) {
  const wait = lastAt + GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// 北京时间的"今天"日期串
function bjToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// 题目唯一键:正赛用 contestId-index,gym/自建题库用 problemsetName-index,兜底题名
// (同一题反复 AC 只算一道,与牛客"已通过"口径一致)
function problemKey(p) {
  if (p.contestId != null) return `cf-${p.contestId}-${p.index}`
  if (p.problemsetName) return `${p.problemsetName}-${p.index}`
  return `name-${p.name}`
}

// 翻完一个人的全部提交 -> [submission...]
async function fetchAllStatus(handle) {
  const all = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const d = await getJson(`${API}/user.status?handle=${encodeURIComponent(handle)}&from=${page * PAGE + 1}&count=${PAGE}`)
    if (d.status !== 'OK') throw new Error(d.comment || 'user.status FAILED')
    all.push(...d.result)
    if (d.result.length < PAGE) break
  }
  return all
}

// 返回 { 成员id: 补丁字段 };onEach(id, rec) 每抓完一个人立刻回调,页面逐个填行
export async function fetchCfLive(members, onEach) {
  const withHandle = members.filter((m) => m.cf_handle)
  if (!withHandle.length) return {}

  const out = {}
  const emit = (id, rec) => {
    out[id] = { ...(out[id] || {}), ...rec }
    if (onEach) onEach(id, rec)
  }

  // 1) Rating / 最高分:一次批量,秒开
  try {
    const handles = [...new Set(withHandle.map((m) => m.cf_handle))]
    const d = await getJson(`${API}/user.info?handles=${handles.map(encodeURIComponent).join(';')}`)
    if (d.status === 'OK') {
      const byHandle = Object.fromEntries(d.result.map((u) => [u.handle, u]))
      for (const m of withHandle) {
        const u = byHandle[m.cf_handle]
        if (!u) continue
        emit(String(m.id), {
          cf_rating: u.rating ?? null,
          cf_max_rating: u.maxRating ?? null,
          cf_rank: u.rank ?? '',
          cf_max_rank: u.maxRank ?? '',
        })
      }
    }
  } catch (e) {
    console.warn('[live cf] user.info 批量失败:', e)
  }

  // 2) 总做题 / 今日 / 近30天:每人翻全部提交历史(官方 2 秒 1 次,逐人排队)
  const nowSec = Math.floor(Date.now() / 1000)
  const shifted = nowSec + 8 * 3600
  const todayStart = shifted - (shifted % 86400) - 8 * 3600 // 今日 0 点(北京时间)
  const todayStr = bjToday()
  const d30Start = nowSec - 30 * 86400 // 近 30 天(滚动窗口,UTC 秒,与 creationTimeSeconds 同基准)

  for (const m of withHandle) {
    try {
      const subs = await fetchAllStatus(m.cf_handle)
      const solved = new Set() // 全历史 AC 过的不同题目
      const today = new Set() // 其中今日 AC 的
      const last30 = new Set() // 其中近 30 天 AC 的
      for (const s of subs) {
        if (s.verdict !== 'OK') continue
        const key = problemKey(s.problem)
        solved.add(key)
        if (s.creationTimeSeconds >= todayStart) today.add(key)
        if (s.creationTimeSeconds >= d30Start) last30.add(key)
      }
      emit(String(m.id), {
        cf_total: solved.size,
        cf_today: today.size,
        cf_30d: last30.size,
        cf_date: todayStr,
      })
    } catch (e) {
      console.warn(`[live cf] ${m.name} user.status 失败(保留旧值):`, e)
    }
  }
  return out
}

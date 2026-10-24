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
const GAP_MS = 3000
const REQ_TIMEOUT_MS = 15000 // 单次请求超时:CF 响应正常 <1s,15s 不回就是链路死了
const PAGE = 10000 // user.status 单页上限内取大,减少翻页次数(实测 count=10000 全量返回)
const MAX_PAGES = 1 // 安全阀:单人最多翻 1 万条提交,再多只按已翻到的算

let lastAt = 0
// 全站唯一的 CF 限速闸门:user.status / contest.list / contest.ratingChanges 都排队走这里
// (官方限制 1 次/2s 是按 IP 算的,多开一条队列就会撞限)
// 必须带超时:裸 fetch 一旦在弱网/代理环境吊死(不拒不回),整轮 Promise 永远悬着,
// liveBusy 卡成 true,之后每一轮都被静默跳过 -> 页面再也不刷新。abort 后走各层 try/catch,
// 单人失败保留旧值,不拖全轮。
export async function getJson(url) {
  const wait = lastAt + GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), REQ_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  } finally {
    clearTimeout(timer)
  }
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
      // handle 大小写不敏感:members.json 可能存 "Bishengleandjay111",API 返回规范小写
      const byHandle = Object.fromEntries(d.result.map((u) => [u.handle.toLowerCase(), u]))
      for (const m of withHandle) {
        const u = byHandle[m.cf_handle.toLowerCase()]
        if (!u) continue
        emit(String(m.id), {
          cf_rating: u.rating ?? null,
          cf_max_rating: u.maxRating ?? null,
          cf_rank: u.rank ?? '',
          cf_max_rank: u.maxRank ?? '',
          // 上次访问 CF 的时间(unix 秒)-> 在线状态,判定口径见 online.js
          cf_last_online: u.lastOnlineTimeSeconds ?? null,
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

// ============================================================
// 近期比赛(contest.list?gym=false,匿名直连,一次请求)
// 只收 Div.1 / Div.2 / Div.3 / Div.4 / 1+2 合一的轮;gym 与 IOI/ICPC 赛制一律排除。
// 「已确认计分」用 contest.ratingChanges 实测(非空=计分),结论按 contestId 永久缓存;
// 未开始的比赛按名称启发式标「预计计分」(CF API 赛前不给 rated 字段)。
// 最多展示 RECENT_MAX 场,其余只计数提醒;抓失败返回 null(调用方保留旧值)。
// ============================================================
const RECENT_MAX = 3
export const RECENT_CONTEST_MAX = RECENT_MAX
const FINISHED_WINDOW = 7 * 86400 // 已结束比赛只展示近 7 天的
export const CONTEST_CACHE_KEY = 'bhu-acm-contest-cache-v1'

function safeGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function safeSet(key, val) {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* 存不进去就算了 */
  }
}

// 名称匹配 Div.1 / Div.2 / Div.3 / Div.4 / 1+2 合一(逗号后缀也算,如 "(Div. 1, Based on …)")。
// 别用 Contest.type 过滤:type 是计分制式(CF/IOI/ICPC),Educational、Div.3 常见 type=ICPC,
// gym 已经由接口参数 gym=false 排除。
export function isDivRound(name) {
  return /\bDiv\. [1-4]\b/.test(name) || /Div\. 1 \+ Div\. 2/.test(name)
}

// 名称启发式:Div.1~4 / 1+2 的 CF 轮默认就是 rated;写了 Unrated / Practice 的不计
export function ratedGuess(name) {
  if (/unrated/i.test(name) || /\bpractice\b/i.test(name)) return false
  return isDivRound(name)
}

// 返回 { contests, rest, fetchedAt };失败返回 null
export async function fetchCfContests() {
  try {
    const d = await getJson(`${API}/contest.list?gym=false`)
    if (d.status !== 'OK') throw new Error(d.comment || 'contest.list FAILED')
    const now = Math.floor(Date.now() / 1000)
    const all = d.result.filter((c) => Number.isFinite(c.startTimeSeconds) && isDivRound(c.name))
    const upcoming = all
      .filter((c) => ['BEFORE', 'CODING', 'SYSTEM_TEST', 'PENDING_SYSTEM_TEST'].includes(c.phase))
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    const past = all
      .filter((c) => c.phase === 'FINISHED' && c.startTimeSeconds > now - FINISHED_WINDOW)
      .sort((a, b) => b.startTimeSeconds - a.startTimeSeconds)

    const show = [...upcoming, ...past].slice(0, RECENT_MAX)
    const rest = upcoming.length + past.length - show.length
    const ratingMap = await ensureRatingConfirmed(show)
    return {
      contests: show.map((c) => ({ ...c, ratingConfirmed: !!ratingMap[String(c.id)] })),
      rest,
      fetchedAt: Date.now(),
    }
  } catch (e) {
    console.warn('[live cf] contest.list 失败(保留旧值):', e)
    return null
  }
}

// 已结束展示比赛的「确认计分」表:先读永久缓存,缺的用 contest.ratingChanges 补
// (每轮最多 RECENT_MAX 个新请求,补到就缓存,后续轮次不再请求;单个失败当不计分,下轮重试)
async function ensureRatingConfirmed(contests) {
  let map = {}
  try {
    map = JSON.parse(safeGet(CONTEST_CACHE_KEY + '-rating')) || {}
  } catch {
    map = {}
  }
  const missing = contests.filter((c) => c.phase === 'FINISHED' && !(String(c.id) in map))
  let changed = false
  for (const c of missing) {
    try {
      const d = await getJson(`${API}/contest.ratingChanges?contestId=${c.id}`)
      if (d.status === 'OK') {
        map[String(c.id)] = Array.isArray(d.result) && d.result.length > 0
        changed = true
      }
    } catch (e) {
      console.warn(`[live cf] contest.ratingChanges ${c.id} 失败:`, e)
    }
  }
  if (changed) safeSet(CONTEST_CACHE_KEY + '-rating', JSON.stringify(map))
  return map
}

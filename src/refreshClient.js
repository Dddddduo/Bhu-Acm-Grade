// ============================================================
// 浏览器端"立即刷新":直接调 Codeforces 官方 API 更新成绩
//
// 为什么只刷 CF?
//  - CF API 开放跨域(返回 access-control-allow-origin: *),浏览器可直连
//  - 牛客页面不允许跨域,浏览器抓不到;牛客数据由 GitHub Actions 定时刷新
//  - 本按钮更新的是内存里的展示数据;Actions 每 5 分钟的定时任务负责持久化
//
// 限速:官方要求 1 次/2s,这里所有请求强制间隔 2.1s
// ============================================================

const API = 'https://codeforces.com/api'
const MIN_GAP_MS = 2100
const PAGE = 100
const MAX_PAGES = 10

let lastCallAt = 0
async function getJson(url) {
  const wait = lastCallAt + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt = Date.now()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// 北京时间(UTC+8)今日 0 点 / 30 天前,unix 秒
function nowWindow() {
  const shifted = Math.floor(Date.now() / 1000) + 8 * 3600
  const todayStart = shifted - (shifted % 86400) - 8 * 3600
  return { todayStart, monthAgo: todayStart - 30 * 86400 }
}

function problemKey(sub) {
  const p = sub.problem
  return p.contestId != null ? `${p.contestId}-${p.index}` : `name-${p.name}`
}

// CF 基本信息:先试批量,任 handle 无效会整批失败 -> 逐人重试
async function fetchInfo(handles, onProgress) {
  const out = {}
  try {
    const data = await getJson(`${API}/user.info?handles=${handles.join(';')}`)
    if (data.status !== 'OK') throw new Error(data.comment || 'CF API error')
    for (const u of data.result) out[u.handle] = u
    return out
  } catch {
    onProgress(`批量失败,逐人重试 ${handles.length} 个 handle(每个间隔 2.1s)…`)
    for (const h of handles) {
      try {
        const data = await getJson(`${API}/user.info?handles=${h}`)
        if (data.status === 'OK' && data.result[0]) out[h] = data.result[0]
      } catch { /* handle 无效,跳过 */ }
      onProgress(`基本信息 ${Object.keys(out).length}/${handles.length}`)
    }
    return out
  }
}

// 翻页统计:今日 / 近30天 / 总(去重 OK 题目)
async function fetchSolved(handle, win) {
  const today = new Set()
  const month = new Set()
  const total = new Set()
  let from = 1
  for (let page = 0; page < MAX_PAGES; page++) {
    let subs
    try {
      const data = await getJson(`${API}/user.status?handle=${handle}&from=${from}&count=${PAGE}`)
      if (data.status !== 'OK') throw new Error(data.comment || 'CF API error')
      subs = data.result
    } catch {
      break // 某页失败就用已有数据兜底
    }
    for (const s of subs) {
      if (s.verdict !== 'OK') continue
      const k = problemKey(s)
      total.add(k)
      if (s.creationTimeSeconds >= win.monthAgo) month.add(k)
      if (s.creationTimeSeconds >= win.todayStart) today.add(k)
    }
    if (!subs.length) break
    from += PAGE
  }
  return { today: today.size, month: month.size, total: total.size }
}

// 入口:members = 名单数组, existing = stats.json 的 users(保留牛客字段)
// 返回新的 users;onProgress(文案, 完成数, 总数) 用于刷新按钮显示进度
export async function refreshCf(members, existing, onProgress = () => {}) {
  const win = nowWindow()

  const withHandle = members.filter((m) => m.cf_handle)
  const handles = [...new Set(withHandle.map((m) => m.cf_handle))]
  const users = { ...existing }

  onProgress('拉取 CF 基本信息…', 0, withHandle.length + 1)
  const info = await fetchInfo(handles, (t) => onProgress(t, 0, withHandle.length + 1))

  let done = 0
  for (const m of withHandle) {
    const rec = { ...(users[String(m.id)] || {}) }
    const u = info[m.cf_handle]
    if (u) {
      rec.cf_rating = u.rating ?? null
      rec.cf_max_rating = u.maxRating ?? null
      rec.cf_rank = u.rank ?? ''
      rec.cf_max_rank = u.maxRank ?? ''
    }
    const s = await fetchSolved(m.cf_handle, win)
    rec.cf_today = s.today
    rec.cf_30d = s.month
    rec.cf_total = s.total
    users[String(m.id)] = rec
    onProgress(`已刷新 ${m.name} 等 ${done + 1}/${withHandle.length} 人`, done + 1, withHandle.length)
    done++
  }
  return users
}

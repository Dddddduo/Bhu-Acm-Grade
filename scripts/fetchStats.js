// ============================================================
// 成绩刷新脚本:读 members.json -> 抓 Codeforces API + 牛客官方页面 -> 写 stats.json
//
// 用法:npm run refresh
//
// Codeforces(官方文档见仓库 codeforces官方文档.md):
//  - 限速:最多 1 次请求 / 2 秒 —— 所有请求(含牛客)共用一个 2.1s 间隔闸门
//  - user.info 批量 handle 时,任一个 handle 不存在会**整批 FAILED** -> 逐人重试兜底
//  - user.status 按时间倒序返回提交,翻页统计:
//      cf_today / cf_30d = 去重 OK 题目数;cf_total = 全部历史去重 OK 题目数
//    上限 MAX_PAGES 页(30 页 = 3000 条提交),超出则标记 cf_total_capped
//
// 牛客(无对外 API,抓官方渲染页,浏览器 UA 才能拿到服务端渲染数据):
//  - /acm/contest/profile/<uid>                 -> Rating、Rating排名
//  - /acm/contest/profile/<uid>/practice-coding -> 题已挑战/题已通过/次提交 +
//    提交记录表格(答案正确 + 提交时间) -> nc_today / nc_30d
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import https from 'node:https'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MEMBERS_FILE = path.join(ROOT, 'public/data/members.json')
const STATS_FILE = path.join(ROOT, 'public/data/stats.json')

// 读旧成绩:本轮某个请求失败(多为 CF 限流 429)时,保留旧值而不是清空,
// 避免"抓一次失败 -> 数据全丢"。合并规则见 mergeInto()。
function readOldStats() {
  try {
    return JSON.parse(readFileSync(STATS_FILE, 'utf8')).users || {}
  } catch {
    return {}
  }
}
function mergeInto(oldRec, newRec, todayStr) {
  // 直接以旧记录为底、新值覆盖:CF 今日数由浏览器实时抓取(liveCf.js)维护,
  // 快照这里抓不到 CF 时**不能删**,否则会把浏览器刚同步的旧值也拖没了。
  // 过期的今日数不主动清理:浏览器每次抓取都会写入 cf_date/cf_today 覆盖掉。
  return { ...oldRec, ...newRec }
}

const API = 'https://codeforces.com/api'
const CF_GAP_MS = 2600 // CF 官方限速 1 次/2s;本地连跑容易触发 429 惩罚,留点余量
const PAGE = 100 // user.status 每页条数
const MAX_PAGES = 30 // CF 单人翻页上限(3000 条提交,够覆盖总做题)
const DAY = 86400

// 牛客抓取参数(无官方限速,自己礼貌节流;和 CF 的闸门相互独立)
const NC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const NC_GAP_MS = 900 // 牛客相邻请求间隔
const NC_PAGE = 50 // practice-coding 每页条数(实测 pageSize 参数有效)
const NC_MAX_PAGES = 4 // 近30天翻页上限(200 条足够覆盖)

// ---------- 限速闸门:每个平台一个,谁也不拖谁 ----------
// 请求本身很快,闸门里串行排队,等效于并发抓取下保持固定间隔
function makeGate(gapMs) {
  let last = 0
  return async function rateLimited(fn) {
    const wait = last + gapMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return fn()
  }
}
const cfGate = makeGate(CF_GAP_MS)
const ncGate = makeGate(NC_GAP_MS)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function request(url, headers) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(body))
      })
      .on('error', reject)
  })
}

async function getCfJson(url) {
  const body = await cfGate(() => request(url, { 'User-Agent': 'Bhu-Acm-Grade/0.1 (refresh script)' }))
  try { return JSON.parse(body) } catch { throw new Error(`非 JSON 响应: ${body.slice(0, 80)}`) }
}

async function getNcHtml(url) {
  return ncGate(() => request(url, { 'User-Agent': NC_UA, Accept: 'text/html' }))
}

// ---------- 时间窗口 ----------
// CF:unix 秒(北京时间 UTC+8 的今日 0 点 / 30 天前)
function nowWindow() {
  const shifted = Math.floor(Date.now() / 1000) + 8 * 3600
  const todayStart = shifted - (shifted % DAY) - 8 * 3600
  return { todayStart, monthAgo: todayStart - 30 * DAY }
}
// 牛客:提交时间是 "YYYY-MM-DD HH:mm:ss" 北京时间字符串,直接按字符串比较日期
function ncWindow() {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000)
  const dateStr = (d) => d.toISOString().slice(0, 10)
  const todayStr = dateStr(shifted)
  const monthAgo = new Date(shifted.getTime() - 30 * DAY * 1000)
  return { todayStr, monthAgoStr: dateStr(monthAgo) }
}

// ---------- Codeforces:基本信息(批量) ----------
async function fetchCfInfo(handles) {
  const out = {}
  if (!handles.length) return out
  try {
    const data = await getCfJson(`${API}/user.info?handles=${handles.join(';')}`)
    if (data.status !== 'OK') throw new Error(data.comment || 'CF API error')
    for (const u of data.result) out[u.handle] = u
  } catch (e) {
    console.warn(`[cf.info] 批量失败(${e.message}),逐人重试`)
    for (const h of handles) {
      try {
        const data = await getCfJson(`${API}/user.info?handles=${h}`)
        if (data.status === 'OK' && data.result[0]) out[h] = data.result[0]
      } catch {
        console.warn(`[cf.info] ${h}: handle 无效或获取失败`)
      }
    }
  }
  return out
}

// ---------- Codeforces:今日 / 近30天 / 总做题数(一次全历史翻页) ----------
async function fetchCfStats(handle, win) {
  const solvedToday = new Set()
  const solvedMonth = new Set()
  const solvedTotal = new Set()
  let from = 1
  let capped = false
  let failed = false
  let retried = false
  for (let page = 0; page < MAX_PAGES; page++) {
    let subs
    try {
      const data = await getCfJson(`${API}/user.status?handle=${handle}&from=${from}&count=${PAGE}`)
      if (data.status !== 'OK') throw new Error(data.comment || 'CF API error')
      subs = data.result
    } catch (e) {
      console.warn(`[cf.status] ${handle}: 第 ${page + 1} 页失败(${e.message})`)
      // 多为 CF 限流(429):429 说明 IP 被短期惩罚,等 40 秒重试一次再放弃
      if (!retried) { retried = true; await sleep(40000); page--; continue }
      if (page === 0) failed = true // 第一页都没拿到 -> 做题数未知,不能写 0
      break
    }
    for (const s of subs) {
      if (s.verdict !== 'OK') continue
      const k = problemKey(s)
      solvedTotal.add(k)
      if (s.creationTimeSeconds >= win.todayStart) solvedToday.add(k)
      if (s.creationTimeSeconds >= win.monthAgo) solvedMonth.add(k)
    }
    if (!subs.length) break // 历史翻完
    if (subs.length === PAGE && page === MAX_PAGES - 1) capped = true
    from += PAGE
  }
  if (capped) console.warn(`[cf.status] ${handle}: 提交超过 ${MAX_PAGES * PAGE} 条,cf_total 为截断值`)
  return { today: solvedToday.size, month: solvedMonth.size, total: solvedTotal.size, capped, failed }
}

// 题目唯一标识:gym 题可能没有 contestId,兜底用题名
function problemKey(sub) {
  const p = sub.problem
  return p.contestId != null ? `${p.contestId}-${p.index}` : `name-${p.name}`
}

// ---------- 牛客:个人主页(Rating / Rating排名) ----------
function parseNcProfile(html) {
  const rec = {}
  const m = html.match(/class="state-num rate-score\d+"[^>]*>\s*([\d,]+)\s*</)
  if (m) rec.nc_rating = Number(m[1].replace(/,/g, ''))
  const r = html.match(/rating-index">([\d,+]+)<\/a>[\s\S]{0,150}?Rating排名/)
  if (r && !r[1].includes('+')) rec.nc_rank = Number(r[1].replace(/,/g, ''))
  return rec
}

// ---------- 牛客:practice-coding(总题数 + 今日/近30天过题) ----------
function parseNcPractice(html, win) {
  const rec = {}
  // 题已挑战 / 题已通过 / 次提交
  for (const m of html.matchAll(
    /<div class="my-state-item"[^>]*>\s*<div class="state-num">([\d,]+)<\/div>\s*<span>(题已挑战|题已通过|次提交)<\/span>/g
  )) {
    const v = Number(m[1].replace(/,/g, ''))
    if (m[2] === '题已挑战') rec.nc_tried = v
    else if (m[2] === '题已通过') rec.nc_solved = v
    else rec.nc_submits = v
  }
  return { rec, rows: extractNcRows(html), win }
}

// 提交行:submissionId、题目、verdict、时间
function extractNcRows(html) {
  const rows = []
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const block = tr[1]
    const subId = block.match(/submissionId=(\d+)/)
    const time = block.match(/(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}/)
    if (!subId || !time) continue // 表头行等
    const prob = block.match(/href="(\/acm\/problem\/\d+)"/)
    rows.push({
      problem: prob ? prob[1] : subId[1], // 无题目链接时用提交号兜底
      accepted: block.includes('答案正确'),
      date: time[1],
    })
  }
  return rows
}

async function fetchNcOne(member, win) {
  const uid = member.nowcoder_id
  const rec = {}
  const solvedToday = new Set()
  const solvedMonth = new Set()
  let ok = false // 页面确实渲染出来(有统计块或有提交),才能写今日/近30天,否则是假 0

  try {
    Object.assign(rec, parseNcProfile(await getNcHtml(`https://ac.nowcoder.com/acm/contest/profile/${uid}`)))
  } catch (e) {
    console.warn(`[nc] ${member.name}(${uid}) 主页获取失败: ${e.message}`)
  }
  if (rec.nc_rating == null) console.warn(`[nc] ${member.name}(${uid}) 主页无 Rating 数据(检查牛客ID是否正确)`)

  for (let page = 1; page <= NC_MAX_PAGES; page++) {
    let result
    try {
      result = parseNcPractice(
        await getNcHtml(
          `https://ac.nowcoder.com/acm/contest/profile/${uid}/practice-coding?pageSize=${NC_PAGE}&page=${page}`
        ),
        win
      )
    } catch (e) {
      console.warn(`[nc] ${member.name}(${uid}) 刷题页第 ${page} 页失败: ${e.message}`)
      break
    }
    Object.assign(rec, result.rec) // 统计块在第一页就有,后续页同值覆盖无妨
    const rows = result.rows
    if (rows.length || Object.keys(result.rec).length) ok = true
    for (const r of rows) {
      if (!r.accepted) continue
      if (r.date >= win.monthAgoStr) solvedMonth.add(r.problem)
      if (r.date === win.todayStr) solvedToday.add(r.problem)
    }
    if (!rows.length) break
    const oldest = rows[rows.length - 1].date
    if (oldest < win.monthAgoStr) break // 整页都比 30 天前早
  }

  // 页面没渲染出来(被反爬/超时)时不写今日和近30天,免得存成假 0
  if (ok) {
    rec.nc_today = solvedToday.size
    rec.nc_30d = solvedMonth.size
  }
  return rec
}

async function fetchNowcoder(members) {
  const withId = members.filter((m) => m.nowcoder_id)
  console.log(`抓取牛客页面(${withId.length} 人,并发,间隔≥${NC_GAP_MS}ms)…`)
  const out = {}
  await Promise.all(
    withId.map(async (m) => {
      const rec = await fetchNcOne(m, ncWindow())
      out[String(m.id)] = rec
      console.log(`  牛客 ${m.name}: Rating=${rec.nc_rating ?? '-'} 已通过=${rec.nc_solved ?? '-'} 今日=${rec.nc_today}`)
    })
  )
  const missing = members.filter((m) => !m.nowcoder_id)
  if (missing.length) console.warn(`[nc] ${missing.length} 人无牛客ID,已跳过: ${missing.map((m) => m.name).join('、')}`)
  return out
}

// ---------- 主流程 ----------
async function main() {
  const members = JSON.parse(readFileSync(MEMBERS_FILE, 'utf8'))
  console.log(`读取名单:${members.length} 人`)
  const win = nowWindow()

  // 牛客和 CF 各自限速、并行跑,总耗时 ≈ max(CF, 牛客)
  const ncPromise = fetchNowcoder(members)
  const oldUsers = readOldStats()
  const todayStr = ncWindow().todayStr

  const handles = [...new Set(members.filter((m) => m.cf_handle).map((m) => m.cf_handle))]
  console.log(`拉取 CF 基本信息(${handles.length} 个 handle,批量)…`)
  const info = await fetchCfInfo(handles)

  const users = {}
  const cfTasks = members
    .filter((m) => m.cf_handle)
    .map(async (m) => {
      const id = String(m.id)
      const rec = mergeInto(oldUsers[id] || {}, {}, todayStr)
      const u = info[m.cf_handle]
      if (u) {
        rec.cf_rating = u.rating ?? null
        rec.cf_max_rating = u.maxRating ?? null
        rec.cf_rank = u.rank ?? ''
        rec.cf_max_rank = u.maxRank ?? ''
        const s = await fetchCfStats(m.cf_handle, win)
        if (!s.failed) {
          rec.cf_today = s.today
          rec.cf_30d = s.month
          rec.cf_total = s.total
          rec.cf_date = todayStr
          if (s.capped) rec.cf_total_capped = true
        } else {
          console.warn(`  CF ${m.name}: 保留上一次的做题数(${rec.cf_total ?? '无'})`)
        }
        console.log(`  CF ${m.name}(${m.cf_handle}): ${s.failed ? '做题记录获取失败' : `今日=${s.today} 30天=${s.month} 总=${s.total}`}`)
      } else {
        console.warn(`[cf] ${m.name}: handle "${m.cf_handle}" 无效,CF 数据缺失`)
      }
      if (Object.keys(rec).length) users[id] = rec
    })
  const noHandle = members.filter((m) => !m.cf_handle).map((m) => m.name)
  if (noHandle.length) console.warn(`[cf] ${noHandle.length} 人无 CF handle: ${noHandle.join('、')}`)

  // CF 限速串行(闸门保证 1 次/2s),任务只是排进队列,不是真并发
  await Promise.all(cfTasks)

  const ncAll = await ncPromise
  for (const id of Object.keys(ncAll)) {
    // 牛客整块失败(比如无 Rating 且无统计)时,也别把旧值抹掉
    const merged = mergeInto(oldUsers[id] || {}, ncAll[id], todayStr)
    if (ncAll[id].nc_today != null) merged.nc_date = todayStr
    else if (merged.nc_date !== todayStr) delete merged.nc_today
    users[id] = { ...(users[id] || {}), ...merged }
  }
  // 只有 CF 数据、本轮牛客没跑到的人:今日数过期也要清掉
  for (const id of Object.keys(users)) {
    if (users[id].nc_today != null && users[id].nc_date !== todayStr) delete users[id].nc_today
  }

  const stats = {
    updated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
    users,
  }
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2) + '\n', 'utf8')
  console.log(`完成:写入 ${path.relative(ROOT, STATS_FILE)},${Object.keys(users).length} 人有数据`)
}

main().catch((e) => {
  console.error('刷新失败:', e)
  process.exit(1)
})

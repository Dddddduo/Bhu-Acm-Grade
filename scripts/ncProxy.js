// ============================================================
// 本地牛客代理服务(浏览器前端 <-> 本代理 <-> ac.nowcoder.com)
//
// 为什么需要它:
//  - ac.nowcoder.com 挂着阿里云 WAF:浏览器连续几十个请求后会弹滑块验证页,
//    验证页不带 CORS 头 -> 前端 fetch 直接 Failed to fetch(实测)
//  - Node 这边带浏览器 UA、串行礼貌间隔(900ms)+ 结果缓存,浏览器只面对本地
//    代理(代理回 Access-Control-Allow-Origin: *,怎么调都行)
//
// 用法:npm run proxy   (默认端口 8787,可用 PORT=xxxx 覆盖)
// 接口:GET /api/nc?uid=619886673
//   200 -> { "nc_rating":1867, "nc_rank":1976, "nc_solved":1284 }
//   502 -> { "error":"..." }  没解析到数据 / 被 WAF 拦(前端保留旧值,宁旧勿丢)
//
// 线上(GitHub Pages)不跑这个代理也没关系:前端抓不到就回落仓库快照,
// 不需要改 Actions 配置。
//
// 解析正则与 scripts/fetchStats.js 同一套,牛客改版要两边一起改。
// ============================================================
import https from 'node:https'
import http from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const NC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const GAP_MS = 900 // 相邻上游请求间隔(礼貌节流,降低触发 WAF 的概率)
const TTL_MS = 4 * 60 * 1000 // 结果缓存:比前端 5 分钟一轮略短,多标签页共享

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 限速闸门:所有对牛客的上游请求都走这里 ----------
let lastAt = 0
async function gate(fn) {
  const wait = lastAt + GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
  return fn()
}

function getHtml(url) {
  return gate(
    () =>
      new Promise((resolve, reject) => {
        https
          .get(url, { headers: { 'User-Agent': NC_UA, Accept: 'text/html' } }, (res) => {
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
  )
}

// 阿里云 WAF 拦截页特征(实测连发后返回的就是这个页面,没有数据也没有 CORS 头)
function assertNotWaf(html) {
  if (/aliyun_waf|aliyunCaptcha/.test(html)) {
    throw new Error('命中牛客 WAF 验证页(本机 IP 被风控):暂停几分钟再试,或换网络')
  }
}

// ---------- 解析(与 fetchStats.js 保持一致) ----------
function parseNcProfile(html) {
  const rec = {}
  const m = html.match(/class="state-num rate-score\d+"[^>]*>\s*([\d,]+)\s*</)
  if (m) rec.nc_rating = Number(m[1].replace(/,/g, ''))
  const r = html.match(/rating-index">([\d,+]+)<\/a>[\s\S]{0,150}?Rating排名/)
  if (r && !r[1].includes('+')) rec.nc_rank = Number(r[1].replace(/,/g, ''))
  return rec
}

function parseNcPractice(html) {
  const rec = {}
  for (const m of html.matchAll(
    /<div class="my-state-item"[^>]*>\s*<div class="state-num">([\d,]+)<\/div>\s*<span>(题已挑战|题已通过|次提交)<\/span>/g
  )) {
    const v = Number(m[1].replace(/,/g, ''))
    if (m[2] === '题已挑战') rec.nc_tried = v
    else if (m[2] === '题已通过') rec.nc_solved = v
    else rec.nc_submits = v
  }
  return rec
}

async function fetchNcUid(uid) {
  const rec = {}
  const errors = []
  try {
    const prof = await getHtml(`https://ac.nowcoder.com/acm/contest/profile/${uid}`)
    assertNotWaf(prof)
    Object.assign(rec, parseNcProfile(prof))
  } catch (e) {
    errors.push(`主页: ${e.message}`)
  }
  try {
    const prac = await getHtml(`https://ac.nowcoder.com/acm/contest/profile/${uid}/practice-coding`)
    assertNotWaf(prac)
    Object.assign(rec, parseNcPractice(prac))
  } catch (e) {
    errors.push(`刷题页: ${e.message}`)
  }
  if (!Object.keys(rec).length) throw new Error(errors.join(' / ') || '页面无数据(检查牛客ID)')
  return rec
}

// ---------- 缓存 + 同 uid 请求去重(多标签页/并发只打一次上游) ----------
const cache = new Map() // uid -> { at, rec }
const inflight = new Map() // uid -> Promise<rec>

function cachedNc(uid) {
  const hit = cache.get(uid)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.rec)
  if (inflight.has(uid)) return inflight.get(uid)
  const p = fetchNcUid(uid)
    .then((rec) => {
      cache.set(uid, { at: Date.now(), rec })
      return rec
    })
    .finally(() => inflight.delete(uid))
  inflight.set(uid, p)
  return p
}

// ---------- HTTP 服务 ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (u.pathname !== '/api/nc') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('nc-proxy: GET /api/nc?uid=...')
  }
  const uid = (u.searchParams.get('uid') || '').trim()
  if (!/^\d+$/.test(uid)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('uid 需为数字')
  }
  const fromCache = cache.has(uid) && Date.now() - cache.get(uid).at < TTL_MS
  try {
    const rec = await cachedNc(uid)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rec))
    console.log(
      `  ${uid} -> Rating=${rec.nc_rating ?? '-'} 排名=${rec.nc_rank ?? '-'} 已通过=${rec.nc_solved ?? '-'}` +
        (fromCache ? '(缓存)' : '')
    )
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(e.message) }))
    console.warn(`  ${uid} 失败: ${e.message}(前端将保留旧值)`)
  }
})

server.listen(PORT, () => {
  console.log(`牛客代理已启动:http://127.0.0.1:${PORT}/api/nc?uid=<牛客ID>`)
  console.log(`前端(src/liveNc.js)每轮把这 5 分钟要刷的 uid 发过来;Ctrl+C 停止`)
})

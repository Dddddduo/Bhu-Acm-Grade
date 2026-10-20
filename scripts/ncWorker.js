// ============================================================
// 牛客 Rating + 总过题数 公共代理 —— Cloudflare Worker(线上访客用的就是这个)
//
// 为什么需要服务端代理(实测结论,2026-10-20):
//  - rating-history 接口只要请求里带跨站 Origin 头,阿里云 WAF 就按机器人处理,
//    返回 JS 验证页(HTTP 200 但 body 是 HTML,不是 JSON)。浏览器 fetch 必带
//    Origin,所以**浏览器直连永远拿不到数据**,跟 CORS 头没关系。
//  - 服务端请求不发 Origin(本 Worker 即如此),牛客正常回数据。
//
// 接口:
//   GET /api/nc?uid=<牛客ID>
//     200 -> { "nc_rating": 1867, "nc_total": 1286 }
//             nc_rating = 最新一次 Rating 更新后的分值
//             nc_total  = 题数统计;取不到时为 null(前端显示「未定级」)
//     502 -> { "error": "..." }    两个都取不到(无记录/被 WAF 拦)
//   GET /api/nc?uid=...&debug=1 -> 额外回 raw 字段(统计块原文),排查改版用
//   任意来源可跨域调用(Access-Control-Allow-Origin: *)。
//
// nc_total 口径(实测 2026-10-20,重要简化):
//   practice-coding 页头部自带官方统计块「N 题已挑战 / N 题已通过 / N 次提交」,
//   「题已通过」= 按题目去重的 AC 数,与逐页爬 37 页的结果完全一致(样例 uid 619886673 -> 1286)。
//   所以只抓第 1 页、正则读这一行即可 —— 单次请求同步返回,不再分批爬全/存检查点。
//   (旧版"后台翻页爬全 + Cache API 检查点"废弃:Worker isolate 随时回收,
//    检查点跨请求易丢,经常每次都在从第 1 页重爬,总过题数永远出不来。)
//
// 部署(改了本文件要重新部署一次才生效):
//  A. 网页版(最简单,无需本地工具):
//     1) https://dash.cloudflare.com -> Workers & Pages -> 找到 nc-proxy Worker
//     2) 代码编辑器里全选替换为本文件内容 -> Deploy
//  B. 命令行:cd scripts && npx wrangler deploy(需先 npx wrangler login)
//
// ⚠️ 大陆网络提示:workers.dev 默认子域在大陆时通时断。给 Club 内部用问题不大
// (不通时牛客两列显示「未定级」,CF 各列不受影响);要稳定服务线上访客,建议在 Worker 设置里绑定
// 自己的域名走 Custom Domain(CF 对已绑自有域名的 Worker 在大陆可达性明显更好)。
// ============================================================

const NC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const GAP_MS = 1000 // 上游请求的礼貌节流(同一实例内串行)
const RATING_TTL = 4 * 60 * 1000 // Rating 缓存:比前端 30 分钟一轮短得多,多访客/多轮共享
const TOTAL_TTL = 10 * 60 * 1000 // 「题已通过」统计:一题一刷,10 分钟够新,也扛得住多访客

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 限速闸门:所有对牛客的上游请求都走这里 ----------
let lastAt = 0
async function gate(fn, gap) {
  const wait = lastAt + gap - Date.now()
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
  return fn()
}

function isWafHtml(body) {
  return /aliyun_waf|aliyunCaptcha/i.test(body) || !/<html/i.test(body.slice(0, 2000))
}

async function upstreamRating(uid) {
  const url = `https://ac.nowcoder.com/acm/contest/rating-history?token=&uid=${encodeURIComponent(uid)}`
  const res = await gate(
    () =>
      fetch(url, {
        headers: {
          'User-Agent': NC_UA,
          Accept: 'application/json',
          Referer: 'https://ac.nowcoder.com/acm/contest/profile',
        },
      }),
    GAP_MS
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()
  // WAF 拦截页是 HTML;正常返回是 JSON —— 认不出来就当被拦
  if (/aliyun_waf|aliyunCaptcha/i.test(body) || !body.trim().startsWith('{')) {
    throw new Error('命中牛客 WAF(Worker 出口 IP 被风控,稍后自动重试或换网络)')
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('牛客接口返回不是 JSON(可能改版)')
  }
}

// 抓 practice-coding 第 1 页(服务端渲染 HTML,头部带统计块)
async function upstreamProfileHtml(uid) {
  const url = `https://ac.nowcoder.com/acm/contest/profile/${encodeURIComponent(uid)}/practice-coding?page=1&pageSize=20`
  const res = await gate(
    () =>
      fetch(url, {
        headers: {
          'User-Agent': NC_UA,
          Accept: 'text/html',
          Referer: `https://ac.nowcoder.com/acm/contest/profile/${uid}/practice-coding`,
        },
      }),
    GAP_MS
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()
  if (isWafHtml(body)) throw new Error('命中牛客 WAF(抓统计页被风控,稍后自动重试)')
  return body
}

// 最新一条 Rating 记录(time 最大)的 rating
function parseRatingHistory(json, uid) {
  if (!json || json.code !== 0 || !Array.isArray(json.data)) {
    throw new Error(`接口异常 code=${json && json.code} msg=${json && json.msg}`)
  }
  if (!json.data.length) throw new Error(`uid ${uid} 没有 Rating 历史(未打过牛客比赛?)`)
  let latest = json.data[0]
  for (const r of json.data) if ((r.time ?? 0) > (latest.time ?? 0)) latest = r
  const rating = Number(latest.rating)
  if (!Number.isFinite(rating)) throw new Error('最新记录里没有 rating 字段(牛客可能改版)')
  return { nc_rating: Math.round(rating) }
}

// 头部统计块:<div class="state-num">1286</div><span>题已通过</span>
// —— 牛客官方按题目去重的 AC 数,与逐页爬全口径一致
function parsePassed(html) {
  const m = html.match(/<div class="state-num">\s*(\d+)\s*<\/div>\s*<span>\s*题已通过\s*<\/span>/)
  if (!m) throw new Error('页面里没有「题已通过」统计(牛客可能改版)')
  return Number(m[1])
}

// ---------- 缓存 + 同 uid 并发去重(多标签页只打一次上游)----------
function makeCached(fetcher, ttl) {
  const cache = new Map() // uid -> { at, val }
  const inflight = new Map() // uid -> Promise<val>
  return (uid) => {
    const hit = cache.get(uid)
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.val)
    if (inflight.has(uid)) return inflight.get(uid)
    const p = fetcher(uid)
      .then((val) => {
        cache.set(uid, { at: Date.now(), val })
        return val
      })
      .finally(() => inflight.delete(uid))
    inflight.set(uid, p)
    return p
  }
}

const cachedRating = makeCached(async (uid) => parseRatingHistory(await upstreamRating(uid), uid).nc_rating, RATING_TTL)
const cachedTotal = makeCached(async (uid) => parsePassed(await upstreamProfileHtml(uid)), TOTAL_TTL)

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const u = new URL(request.url)
    if (u.pathname !== '/api/nc') {
      return new Response('nc-proxy: GET /api/nc?uid=...', { status: 404, headers: CORS })
    }
    const uid = (u.searchParams.get('uid') || '').trim()
    if (!/^\d+$/.test(uid)) {
      return new Response('uid 需为数字', { status: 400, headers: CORS })
    }
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })

    // 两个字段独立取用:一个挂了另一个照常回(取不到的回 null,前端显示未定级)
    const [r, t] = await Promise.allSettled([cachedRating(uid), cachedTotal(uid)])
    const out = {}
    if (r.status === 'fulfilled') out.nc_rating = r.value
    if (t.status === 'fulfilled') out.nc_total = t.value
    else out.nc_total = null
    if (u.searchParams.get('debug') === '1') {
      out.debug = {
        rating_err: r.status === 'rejected' ? String(r.reason && r.reason.message) : null,
        total_err: t.status === 'rejected' ? String(t.reason && t.reason.message) : null,
      }
      if (t.status === 'rejected') {
        try {
          const html = await upstreamProfileHtml(uid)
          const i = html.indexOf('题已通过')
          out.debug.raw = i >= 0 ? html.slice(Math.max(0, i - 220), i + 40) : html.slice(0, 300)
        } catch (e) {
          out.debug.raw_fetch_err = String(e.message || e)
        }
      }
    }
    if (r.status === 'fulfilled' || t.status === 'fulfilled') return json(out)
    return json({ error: `Rating 与总过题都取不到:${String(r.reason && r.reason.message)} / ${String(t.reason && t.reason.message)}` }, 502)
  },
}

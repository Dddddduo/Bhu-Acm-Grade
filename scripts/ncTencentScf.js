// ============================================================
// 牛客 Rating + 总过题数 代理 —— 腾讯云云函数 SCF(大陆免 VPN 方案)
// 逻辑与 scripts/ncWorker.js 完全一致,只是换成 SCF Web 函数的写法。
//
// 为什么换:Cloudflare 公共子域 *.workers.dev 被 GFW 按 SNI 阻断,大陆访客不挂 VPN
// 打不到 Worker(自有域名绑定可解,但需要你有域名)。腾讯云 SCF 的默认域名
// (***.tencentscf.com)大陆直连可达,且默认域名无需备案,有免费额度。
//
// 部署(约 10 分钟,用「Web 函数」——新版控制台的事件函数已不支持新建 API 网关触发器):
//  1) https://console.cloud.tencent.com/scf -> 函数服务 -> 新建
//     类型选「Web 函数」,运行环境 Node.js 18.15+(必须 ≥18,代码用了全局 fetch),
//     模板选 Node.js,区域建议 上海/广州(离牛客近)
//  2) 在线编辑代码:把本文件内容粘贴进 index.js(入口仍是 main_handler)
//  3) 点「部署」;若提示发布版本/灰度,直接全量发布
//  4) 「触发方法/基本信息」里拿公网访问 HTTPS 域名,形如
//     https://<appid>-<随机>.<地域>.tencentscf.com —— 填进 src/liveNc.js 的 WORKER_URL
//  5) 浏览器直接开 <URL>?uid=619886673 验证返回 {"nc_rating":...,"nc_total":...};
//     加 &debug=1 回包里带 _v:"v4"(400 时无条件带 _v+event 诊断),没有 _v 就说明还是旧代码
//     验证通过后 npm run build 重新部署 Pages。
//
// 接口(与 Worker 版一致):
//   GET ?uid=<牛客ID>          -> { "nc_rating": 1867, "nc_total": 1286 }
//   GET ?uid=...&debug=1       -> 额外回错误原因,排查改版用
//   任意来源可跨域(Access-Control-Allow-Origin: *)
//
// nc_total 口径:practice-coding 页头部官方统计块「N 题已通过」(按题目去重的 AC 数,
// 与逐页爬全一致)。单次抓第 1 页同步返回,容器温启动期间带内存缓存。
// ============================================================

const NC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const GAP_MS = 1000 // 上游请求的礼貌节流(同一容器内串行)
const RATING_TTL = 4 * 60 * 1000 // Rating 缓存
const TOTAL_TTL = 10 * 60 * 1000 // 「题已通过」统计缓存

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
    throw new Error('命中牛客 WAF(出口 IP 被风控,稍后自动重试)')
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
function parsePassed(html) {
  const m = html.match(/<div class="state-num">\s*(\d+)\s*<\/div>\s*<span>\s*题已通过\s*<\/span>/)
  if (!m) throw new Error('页面里没有「题已通过」统计(牛客可能改版)')
  return Number(m[1])
}

// ---------- 缓存 + 同 uid 并发去重(SCF 容器温启动期间有效)----------
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
}

// SCF Web 函数入口(GET ?uid=...;Web 函数 event 的参数在 queryString 原始串里)
exports.main_handler = async (event) => {
  // Web 函数场景下 event 可能是 JSON 字符串,先兜底解析
  if (typeof event === 'string') {
    try { event = JSON.parse(event) } catch { /* 保持原样 */ }
  }
  // ---------- 通用取参:不猜腾讯云给哪种结构,全都试一遍 ----------
  // 实测(2026-10-20,Web 函数):event.queryString 是**已解析的对象** {uid:"..."},
  // 而 queryStringParameters 是空对象 {} —— 千万别只认 queryStringParameters!
  // 其它可能形态:queryString 原始串、url/rawPath 自带 ?、multiValue、整个 event 是 JSON 串
  const bag = JSON.stringify(event || {})
  const fromObj = (o, name) => {
    if (!o || typeof o !== 'object') return null
    let v = o[name]
    if (Array.isArray(v)) v = v[0]
    return v == null ? null : String(v)
  }
  const pick = (name) => {
    return (
      fromObj(event?.queryStringParameters, name) ??
      fromObj(event?.queryString, name) ?? // ★ Web 函数真实给的就是这里
      fromObj(event?.multiValueQueryStringParameters, name) ??
      (typeof event?.queryString === 'string' ? new URLSearchParams(event.queryString).get(name) : null) ??
      (() => {
        const u = event?.url ?? event?.path
        return typeof u === 'string' && u.includes('?')
          ? new URLSearchParams(u.slice(u.indexOf('?') + 1)).get(name)
          : null
      })() ??
      // 最后兜底:序列化后按 key 找(扛住任何没见过的嵌套结构)
      (() => {
        const m = bag.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`))
        if (m) return m[1]
        const m2 = bag.match(new RegExp(`${name}=([^&"\\s,}]+)`))
        return m2 ? decodeURIComponent(m2[1]) : null
      })()
    )
  }
  // 浏览器 CORS 预检
  if (String(event?.httpMethod || event?.requestContext?.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return {
      isBase64Encoded: false,
      statusCode: 204,
      headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
      body: '',
    }
  }
  const uid = String(pick('uid') ?? (event?.path || '').split('/').filter(Boolean).pop() ?? '').trim()
  const debugOn = String(pick('debug') ?? '') === '1'
  const json = (obj, status = 200) => ({
    isBase64Encoded: false,
    statusCode: status,
    headers: CORS_HEADERS,
    body: JSON.stringify(obj),
  })
  // 400 时**无条件**带上诊断信息:线上取不到 uid,看一眼 keys 就知道腾讯云真实给了什么结构
  if (!/^\d+$/.test(uid)) {
    return json({
      error: 'uid 需为数字',
      _v: 'v4',
      debug: {
        keys: Object.keys(event || {}),
        types: { event: typeof event, queryString: typeof event?.queryString, qsp: typeof event?.queryStringParameters, url: typeof event?.url },
        head: bag.slice(0, 700),
        uid,
      },
    }, 400)
  }

  // 两个字段独立取用:一个挂了另一个照常回(取不到的回 null,前端显示未定级)
  const [r, t] = await Promise.allSettled([cachedRating(uid), cachedTotal(uid)])
  const out = {}
  if (r.status === 'fulfilled') out.nc_rating = r.value
  if (t.status === 'fulfilled') out.nc_total = t.value
  else out.nc_total = null
  if (debugOn) {
    out.debug = {
      // _v:版本探针——线上响应里没这个字段或不为 v4,就说明部署的还是旧代码
      _v: 'v4',
      echo: { uid, httpMethod: event.httpMethod, path: event.path },
      keys: Object.keys(event),
      rating_err: r.status === 'rejected' ? String(r.reason && r.reason.message) : null,
      total_err: t.status === 'rejected' ? String(t.reason && t.reason.message) : null,
    }
  }
  if (r.status === 'fulfilled' || t.status === 'fulfilled') return json(out)
  return json(
    { error: `Rating 与总过题都取不到:${String(r.reason && r.reason.message)} / ${String(t.reason && t.reason.message)}` },
    502
  )
}

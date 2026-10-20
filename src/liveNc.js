// ============================================================
// 浏览器端实时获取牛客 Rating + 总过题数 —— 经 Cloudflare Worker 代理
// (本机 npm run proxy 兜底已按需求移除,牛客数据只走 Worker)
//
// 为什么必须服务端代理(实测结论 2026-10-20):
//  rating-history 接口只要带跨站 Origin 头就被阿里云 WAF 拦成 JS 验证页
//  (HTTP 200 但返回 HTML)。浏览器 fetch 一定发 Origin,绕不过去 ——
//  跟 CORS 头无关,所以浏览器直连这条路是死的。
//
// 数据口径:GET ${WORKER_URL}?uid=<牛客ID>
//   -> { nc_rating: 最新 Rating, nc_total: 总过题数(首轮没抓全时为 null) }
//   502 -> { error }  (无记录 / 上游被 WAF 拦)
//
// 任何一个人失败:跳过,保留旧值,绝不清空(数据宁旧勿丢)
// ============================================================

// ★ 部署 Cloudflare Worker 后,地址填这里(scripts/ncWorker.js)
const WORKER_URL = 'https://nc-proxy.1732446549.workers.dev/api/nc'
const TIMEOUT_MS = 15000 // 代理上游要排队节流,给宽裕点

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let workerAlive = null // 本轮是否确认可用:null=没探过,true/false=探过

function fetchJsonOnce(uid) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  return fetch(`${WORKER_URL}?uid=${encodeURIComponent(uid)}`, { signal: ctl.signal, cache: 'no-store' })
    .then((res) => {
      clearTimeout(timer)
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`)
        e.proxyErr = true // 代理活着但取数失败(上游被 WAF 拦等),502 也带 JSON 时会走这里
        throw e
      }
      return res.json()
    })
    .catch((e) => {
      clearTimeout(timer)
      if (e.proxyErr) throw e
      if (e.name === 'AbortError') {
        const err = new Error('代理响应超时')
        err.proxyErr = true
        throw err
      }
      throw new Error(`连不上牛客 Worker 代理(${WORKER_URL})`)
    })
}

// 返回 { 成员id: 补丁字段 };onEach(id, rec) 每取完一个人立刻回调
export async function fetchNcLive(members, onEach) {
  const withId = members.filter((m) => m.nowcoder_id)
  if (!withId.length) return {}
  workerAlive = null // 每轮重新探测

  const out = {}
  let lastErr = null
  for (const m of withId) {
    try {
      const rec = await fetchJsonOnce(String(m.nowcoder_id))
      workerAlive = true
      const patch = {}
      if (Number.isFinite(rec.nc_rating)) patch.nc_rating = Math.round(rec.nc_rating)
      if (Number.isFinite(rec.nc_total)) patch.nc_total = Math.round(rec.nc_total)
      if (Object.keys(patch).length) {
        const id = String(m.id)
        out[id] = { ...(out[id] || {}), ...patch }
        if (onEach) onEach(id, patch)
      }
    } catch (e) {
      // 连不上 Worker(非 HTTP 错误):整个代理当掉,别再逐个人撞墙,上抛让调用方提示
      if (!e.proxyErr && workerAlive !== true) {
        e.proxyDown = true
        throw e
      }
      lastErr = e
      console.warn(`[live nc] ${m.name} 取数失败(保留旧值):`, e)
    }
    await sleep(300) // 前端侧也留点间隔,配合代理节流
  }
  if (!Object.keys(out).length && lastErr) throw lastErr
  return out
}

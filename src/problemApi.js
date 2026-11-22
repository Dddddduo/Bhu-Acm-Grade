const API = 'https://codeforces.com/api'
const CACHE_PREFIX = 'bhu-acm-problems-v1:'
const CACHE_TTL = 60 * 60 * 1000
const PAGE_SIZE = 10000
const MAX_PAGES = 1
let lastRequestAt = 0
const GAP_MS = 3000

function readCache(handle) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + handle.toLowerCase()) || 'null')
    if (cached?.at && Array.isArray(cached.data) && Date.now() - cached.at < CACHE_TTL) return cached.data
  } catch {}
  return null
}
function writeCache(handle, data) {
  try { localStorage.setItem(CACHE_PREFIX + handle.toLowerCase(), JSON.stringify({ at: Date.now(), data })) } catch {}
}
async function getJson(url) {
  const wait = lastRequestAt + GAP_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Codeforces HTTP ${response.status}`)
  return response.json()
}
export async function fetchSolvedSubmissions(handle) {
  const cached = readCache(handle)
  if (cached) return { data: cached, cached: true }
  const submissions = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await getJson(`${API}/user.status?handle=${encodeURIComponent(handle)}&from=${page * PAGE_SIZE + 1}&count=${PAGE_SIZE}`)
    if (payload.status !== 'OK') throw new Error(payload.comment || 'user.status failed')
    submissions.push(...payload.result)
    if (payload.result.length < PAGE_SIZE) break
  }
  const solved = []; const keys = new Set()
  for (const submission of submissions) {
    if (submission.verdict !== 'OK' || !submission.problem) continue
    const problem = submission.problem
    const key = problem.contestId != null ? `cf-${problem.contestId}-${problem.index}` : `${problem.problemsetName || 'custom'}-${problem.index}`
    if (keys.has(key)) continue
    keys.add(key)
    solved.push({ key, name: problem.name, index: problem.index, rating: problem.rating || 0, tags: problem.tags || [], contestId: problem.contestId || null })
  }
  writeCache(handle, solved)
  return { data: solved, cached: false }
}

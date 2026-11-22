const API = 'https://codeforces.com/api'
const CACHE_PREFIX = 'bhu-acm-rating-v1:'
const CACHE_TTL = 30 * 60 * 1000

function readCache(handle) {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_PREFIX + handle.toLowerCase()) || 'null')
    if (value?.at && Array.isArray(value.data) && Date.now() - value.at < CACHE_TTL) return value.data
  } catch {
    // Storage can be disabled in private browsing.
  }
  return null
}

function writeCache(handle, data) {
  try { localStorage.setItem(CACHE_PREFIX + handle.toLowerCase(), JSON.stringify({ at: Date.now(), data })) } catch {
    // A full cache must not prevent the profile from rendering.
  }
}

export async function fetchUserRating(handle) {
  const cached = readCache(handle)
  if (cached) return { data: cached, cached: true }
  const response = await fetch(`${API}/user.rating?handle=${encodeURIComponent(handle)}`)
  if (!response.ok) throw new Error(`Codeforces HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.status !== 'OK') throw new Error(payload.comment || 'Codeforces API failed')
  writeCache(handle, payload.result)
  return { data: payload.result, cached: false }
}

export function ratingDelta(history) {
  if (!history?.length) return 0
  return history[history.length - 1].newRating - history[0].oldRating
}

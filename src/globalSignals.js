const CACHE_PREFIX = 'bhu-acm-global-signal-v2:'
const CACHE_TTL = 30 * 60 * 1000

function readCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null')
    if (cached?.at && cached.data && Date.now() - cached.at < CACHE_TTL) return cached.data
  } catch {
    // Ignore unavailable or malformed browser storage.
  }
  return null
}

function writeCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // A disabled or full cache must not break the dashboard.
  }
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function fetchHoliday() {
  const cached = readCache('holiday')
  if (cached) return cached
  const data = await getJson('https://date.nager.at/api/v3/NextPublicHolidays/CN')
  const today = new Date().toISOString().slice(0, 10)
  const next = data.find((item) => item.date >= today)
  if (!next) throw new Error('No upcoming holiday')
  const result = { name: next.localName || next.name, date: next.date, country: next.countryCode, fetchedAt: Date.now() }
  writeCache('holiday', result)
  return result
}

export async function fetchHitokoto(force = false) {
  const cached = force ? null : readCache('hitokoto')
  if (cached) return cached
  const data = await getJson('https://v1.hitokoto.cn/?c=a&c=d&c=i')
  if (!data.hitokoto) throw new Error('No hitokoto available')
  const result = {
    text: data.hitokoto,
    from: data.from || '一言',
    fromWho: data.from_who || '',
    type: data.type || '',
    fetchedAt: Date.now(),
  }
  writeCache('hitokoto', result)
  return result
}

export async function fetchExchangeRates() {
  const cached = readCache('exchange-rates')
  if (cached) return cached
  const data = await getJson('https://api.frankfurter.dev/v1/latest?from=CNY&to=USD')
  const rates = data.rates || {}
  if (!Number.isFinite(Number(rates.USD))) {
    throw new Error('CNY/USD exchange rate unavailable')
  }
  const result = {
    base: data.base || 'CNY',
    date: data.date || '',
    usd: Number(rates.USD),
    fetchedAt: Date.now(),
  }
  writeCache('exchange-rates', result)
  return result
}

export async function fetchMetalPrices() {
  const cached = readCache('metal-prices-cny-v1')
  if (cached) return cached
  const [gold, silver, exchange] = await Promise.all([
    getJson('https://api.gold-api.com/price/XAU'),
    getJson('https://api.gold-api.com/price/XAG'),
    getJson('https://api.frankfurter.dev/v1/latest?from=CNY&to=USD'),
  ])
  const usdPerCny = Number(exchange.rates?.USD)
  const goldUsdPerOz = Number(gold.price)
  const silverUsdPerOz = Number(silver.price)
  const troyOunceInGrams = 31.1034768
  if (![usdPerCny, goldUsdPerOz, silverUsdPerOz].every(Number.isFinite) || usdPerCny <= 0) {
    throw new Error('CNY metal prices unavailable')
  }
  const result = {
    gold: (goldUsdPerOz / usdPerCny) / troyOunceInGrams,
    silver: (silverUsdPerOz / usdPerCny) / troyOunceInGrams,
    currency: 'CNY',
    unit: 'g',
    exchangeDate: exchange.date || '',
    fetchedAt: Date.now(),
  }
  writeCache('metal-prices-cny-v1', result)
  return result
}



export function formatHolidayDate(value) {
  if (!value) return '日期等待中'
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

export function daysUntil(value) {
  if (!value) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${value}T00:00:00`)
  return Math.max(0, Math.ceil((target - today) / 86400000))
}

const CACHE_KEY = 'bhu-acm-visitor-environment-v4'
const CACHE_TTL = 30 * 60 * 1000

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    const hasCoordinates = Number.isFinite(Number(value?.data?.latitude)) && Number.isFinite(Number(value?.data?.longitude))
    if (value?.at && value.data && hasCoordinates && Date.now() - value.at < CACHE_TTL) return value.data
  } catch {
    // Private browsing or malformed cache is treated as empty.
  }
  return null
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })) } catch {
    // A full or disabled cache must not break the dashboard.
  }
}

async function fetchBrowserLocation() {
  if (!navigator.geolocation) throw new Error('Browser geolocation unavailable')
  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 5 * 60 * 1000,
    })
  })
  const { latitude, longitude, accuracy } = position.coords
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Invalid browser coordinates')
  const reverseUrl = new URL('https://nominatim.openstreetmap.org/reverse')
  reverseUrl.searchParams.set('format', 'jsonv2')
  reverseUrl.searchParams.set('lat', latitude)
  reverseUrl.searchParams.set('lon', longitude)
  reverseUrl.searchParams.set('zoom', '18')
  reverseUrl.searchParams.set('addressdetails', '1')
  const response = await fetch(reverseUrl)
  if (!response.ok) throw new Error(`Reverse geocoding HTTP ${response.status}`)
  const data = await response.json()
  const address = data.address || {}
  return {
    source: 'browser',
    type: 'GPS / Wi-Fi',
    country: address.country,
    region: address.state || address.province,
    city: address.city || address.town || address.municipality || address.county,
    district: address.district || address.suburb || address.city_district,
    latitude,
    longitude,
    accuracy,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    network: '',
    asn: '',
  }
}
async function fetchLocation() {
  try {
    return await fetchBrowserLocation()
  } catch (error) {
    console.info('[visitor environment] browser location unavailable, using IP fallback:', error.message)
  }

  const providers = [
    async () => {
      const response = await fetch('https://geolocation-db.com/json/')
      if (!response.ok) throw new Error(`geolocation-db HTTP ${response.status}`)
      const data = await response.json()
      if (!Number.isFinite(Number(data.latitude)) || !Number.isFinite(Number(data.longitude))) throw new Error('geolocation-db unavailable')
      return {
        type: data.IPv6 ? 'IPv6' : 'IPv4',
        country: data.country_name,
        region: data.state,
        city: data.city,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        timezone: data.time_zone,
        network: data.organization_name,
      }
    },
    async () => {
      const response = await fetch('https://ipinfo.io/json')
      if (!response.ok) throw new Error(`ipinfo.io HTTP ${response.status}`)
      const data = await response.json()
      const [latitude, longitude] = String(data.loc || '').split(',').map(Number)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('ipinfo.io unavailable')
      return {
        type: data.ip?.includes(':') ? 'IPv6' : 'IPv4',
        country: data.country,
        region: data.region,
        city: data.city,
        latitude,
        longitude,
        timezone: data.timezone,
        network: data.org,
        asn: data.org?.match(/AS\d+/i)?.[0]?.toUpperCase(),
      }
    },
    async () => {
      const response = await fetch('https://api.ipapi.is/')
      if (!response.ok) throw new Error(`ipapi.is HTTP ${response.status}`)
      const data = await response.json()
      if (!Number.isFinite(data.lat) || !Number.isFinite(data.lon)) throw new Error('ipapi.is unavailable')
      return {
        type: data.ip?.includes(':') ? 'IPv6' : 'IPv4',
        country: data.country,
        region: data.region,
        city: data.city,
        latitude: data.lat,
        longitude: data.lon,
        timezone: data.timezone,
        network: data.company || data.asn,
        asn: data.asn,
      }
    },
  ]
  let lastError
  for (const provider of providers) {
    try { return await provider() } catch (error) { lastError = error }
  }
  throw lastError || new Error('Location unavailable')
}

export async function fetchVisitorEnvironment() {
  const cached = readCache()
  if (cached) return cached

  const location = await fetchLocation()
  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast')
  weatherUrl.searchParams.set('latitude', location.latitude)
  weatherUrl.searchParams.set('longitude', location.longitude)
  weatherUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m')
  weatherUrl.searchParams.set('timezone', 'auto')
  const weatherResponse = await fetch(weatherUrl)
  if (!weatherResponse.ok) throw new Error(`Weather service HTTP ${weatherResponse.status}`)
  const weather = await weatherResponse.json()

  const data = {
    district: location.district || '',
    source: location.source || 'ip',
    accuracy: location.accuracy || null,
    country: location.country || '未知地区',
    region: location.region || '',
    city: location.city || '',
    latitude: location.latitude,
    longitude: location.longitude,
    timezone: location.timezone || weather.timezone || 'UTC',
    weatherTimezone: weather.timezone || location.timezone || 'UTC',
    ipType: location.type || '',
    network: location.network || '未知网络',
    asn: location.asn || '',
    current: weather.current || null,
    fetchedAt: Date.now(),
  }
  writeCache(data)
  return data
}

export function weatherLabel(code) {
  const labels = {
    0: '晴朗', 1: '基本晴朗', 2: '局部多云', 3: '阴天',
    45: '雾', 48: '冻雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '中阵雨', 82: '强阵雨', 95: '雷雨', 96: '雷雨伴冰雹', 99: '强雷雨伴冰雹',
  }
  return labels[code] || '天气未知'
}

export function weatherIcon(code) {
  if (code == null) return '·'
  if (code === 0) return '☀'
  if ([1, 2, 3].includes(code)) return '◐'
  if ([45, 48].includes(code)) return '≋'
  if ([71, 73, 75].includes(code)) return '❄'
  if ([95, 96, 99].includes(code)) return 'ϟ'
  return '⌁'
}

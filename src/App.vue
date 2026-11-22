<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import LeaderboardView from './views/LeaderboardView.vue'
import MemberProfileView from './views/MemberProfileView.vue'
import ContestArenaView from './views/ContestArenaView.vue'
import DevLogView from './views/DevLogView.vue'
import CountUp from './components/CountUp.vue'
import LiveClock from './components/LiveClock.vue'
import cursorImageUrl from '../img/shubiao.png'
import logoUrl from '../img/duihui.png'
import { fetchCfContests, CONTEST_CACHE_KEY } from './liveCf.js'
import { fetchVisitorEnvironment, weatherIcon, weatherLabel } from './visitorEnvironment.js'
import { daysUntil, fetchExchangeRates, fetchHitokoto, fetchHoliday, fetchMetalPrices, formatHolidayDate } from './globalSignals.js'

const CACHE_KEY = 'bhu-acm-live-cache-v1'
const THEME_MODE_KEY = 'theme-mode'
const AUTO_LIGHT_START = 7
const AUTO_DARK_START = 19
const routes = [
  { key: 'dashboard', label: '指挥中心', short: '01', icon: '◈' },
  { key: 'leaderboard', label: '成员榜单', short: '02', icon: '↗' },
  { key: 'contests', label: '赛事中心', short: '03', icon: '◉' },
  { key: 'devlog', label: '开发日志', short: '04', icon: '✦' },
]

const currentRoute = ref(routeFromHash())
const selectedMemberId = ref(memberIdFromHash())
const isDark = ref(false)
const sidebarCollapsed = ref(false)
const members = ref([])
const livePatch = ref({})
const liveAt = ref(0)
const contests = ref([])
const contestAt = ref(0)
const contestLoading = ref(false)
const visitorEnvironment = ref(null)
const visitorEnvironmentLoading = ref(false)
const visitorEnvironmentError = ref('')
const clockNow = ref(Date.now())
const globalSignals = ref({ holiday: null, hitokoto: null, exchange: null, metals: null })
const globalSignalsLoading = ref(true)
const commandPointer = ref({ x: 50, y: 50 })
const commandTilt = ref({ x: 0, y: 0 })
const commandMotionEnabled = ref(true)
const cursorPosition = ref({ x: -100, y: -100 })
const cursorVisible = ref(false)
const cursorHovering = ref(false)
const cursorClicking = ref(false)
const heartBursts = ref([])
const customCursorEnabled = ref(false)
let heartBurstId = 0
let clockTimer = null
let themeTimer = null

function routeFromHash() {
  const value = window.location.hash.replace(/^#\/?/, '')
  if (value.startsWith('member/')) return 'member'
  return routes.some((r) => r.key === value) ? value : 'dashboard'
}
function memberIdFromHash() {
  const match = window.location.hash.match(/^#\/?member\/(\d+)/)
  return match ? match[1] : ''
}
async function ensureContests() {
  if (contestLoading.value || (contests.value.length && Date.now() - contestAt.value < 30 * 60 * 1000)) return
  contestLoading.value = true
  try {
    const result = await fetchCfContests()
    if (result) { contests.value = result.contests; contestAt.value = result.fetchedAt }
  } finally { contestLoading.value = false }
}
async function ensureVisitorEnvironment() {
  if (visitorEnvironmentLoading.value || visitorEnvironment.value) return
  visitorEnvironmentLoading.value = true
  visitorEnvironmentError.value = ''
  try { visitorEnvironment.value = await fetchVisitorEnvironment() } catch (error) { visitorEnvironmentError.value = error.message || '环境数据暂不可用' } finally { visitorEnvironmentLoading.value = false }
}
async function ensureGlobalSignals() {
  await ensureVisitorEnvironment()
  const tasks = [
    ['holiday', fetchHoliday],
    ['hitokoto', fetchHitokoto],
    ['exchange', fetchExchangeRates],
    ['metals', fetchMetalPrices],
  ]
  await Promise.all(tasks.map(async ([key, loader]) => {
    try { globalSignals.value[key] = await loader() } catch (error) { console.warn(`[global signal] ${key} unavailable:`, error) }
  }))
  globalSignalsLoading.value = false
}
function signalDaysUntil(date) { return daysUntil(date) }
function signalHolidayDate(date) { return formatHolidayDate(date) }
function enableCustomCursor() {
  customCursorEnabled.value = true
  document.documentElement.classList.add('custom-cursor-enabled')
}
function disableCustomCursor() {
  customCursorEnabled.value = false
  document.documentElement.classList.remove('custom-cursor-enabled')
}
function updateCursor(event) {
  if (event.pointerType !== 'mouse') return
  enableCustomCursor()
  cursorPosition.value = { x: event.clientX, y: event.clientY }
  cursorVisible.value = true
  cursorHovering.value = Boolean(event.target?.closest?.('button, a, input, select, summary'))
}
function updateCursorHover(event) {
  if (event.pointerType !== 'mouse') return
  cursorHovering.value = Boolean(event.target?.closest?.('button, a, input, select, summary'))
}
function hideCursor(event) {
  if (event.pointerType === 'mouse') {
    cursorVisible.value = false
    cursorHovering.value = false
    disableCustomCursor()
  }
}
function createClickBurst(event) {
  if (event.pointerType !== 'mouse') return
  enableCustomCursor()
  cursorClicking.value = true
  window.setTimeout(() => { cursorClicking.value = false }, 520)
  const heartId = ++heartBurstId
  const hearts = Array.from({ length: 5 }, (_, index) => ({
    id: `${heartId}-${index}`,
    x: event.clientX,
    y: event.clientY,
    angle: -36 + index * 18,
    distance: 24 + (index % 3) * 12,
    delay: index * 35,
  }))
  heartBursts.value = [...heartBursts.value, ...hearts]
  window.setTimeout(() => {
    heartBursts.value = heartBursts.value.filter((heart) => heart.id.split('-')[0] !== String(heartId))
  }, 950)
}
function updateCommandPointer(event) {
  updateCursor(event)
  if (!commandMotionEnabled.value || currentRoute.value !== 'dashboard') return
  const target = event.currentTarget
  const rect = target.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100
  commandPointer.value = { x, y }
  commandTilt.value = { x: ((y - 50) / 50) * -2.8, y: ((x - 50) / 50) * 3.2 }
}
function resetCommandPointer() {
  commandPointer.value = { x: 50, y: 50 }
  commandTilt.value = { x: 0, y: 0 }
}
function navigate(key) {
  window.location.hash = key
  currentRoute.value = key
  selectedMemberId.value = ''
  if (key === 'contests') ensureContests()
}
function openMember(member) {
  window.location.hash = `member/${member.id}`
  currentRoute.value = 'member'
  selectedMemberId.value = String(member.id)
}
function backToLeaderboard() {
  navigate('leaderboard')
}
function onHashChange() {
  currentRoute.value = routeFromHash()
  selectedMemberId.value = memberIdFromHash()
  if (currentRoute.value === 'contests') ensureContests()
}
function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function loadShellData() {
  fetch(`data/members.json?t=${Date.now()}`).then((r) => r.json()).then((data) => { members.value = data }).catch(() => {})
  const live = readStorage(CACHE_KEY)
  if (live?.patch) { livePatch.value = live.patch; liveAt.value = live.at || 0 }
  const contest = readStorage(CONTEST_CACHE_KEY)
  if (Array.isArray(contest?.list)) contests.value = contest.list
  if (Number.isFinite(contest?.at)) contestAt.value = contest.at
}
function isAutoDarkTime() {
  const hour = new Date().getHours()
  return hour >= AUTO_DARK_START || hour < AUTO_LIGHT_START
}
function applyTheme() {
  const mode = localStorage.getItem(THEME_MODE_KEY) || 'auto'
  const saved = localStorage.getItem('theme')
  const preferred = mode === 'auto' ? isAutoDarkTime() : saved === 'dark'
  isDark.value = preferred
  document.documentElement.toggleAttribute('data-command-theme', isDark.value)
  if (isDark.value) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}
function toggleTheme() {
  isDark.value = !isDark.value
  localStorage.setItem(THEME_MODE_KEY, 'manual')
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  applyTheme()
}
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('sidebar-collapsed', sidebarCollapsed.value ? '1' : '0')
}
function cfStats(member) { return livePatch.value[String(member.id)] || {} }
function todayValue(member) {
  const stats = cfStats(member)
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  return stats.cf_date === today ? stats.cf_today || 0 : 0
}
const totalToday = computed(() => members.value.reduce((sum, member) => sum + todayValue(member), 0))
const activeToday = computed(() => members.value.filter((member) => todayValue(member) > 0).length)
const totalSolved = computed(() => members.value.reduce((sum, member) => sum + (cfStats(member).cf_total || 0), 0))
const topRating = computed(() => Math.max(0, ...members.value.map((member) => cfStats(member).cf_rating || 0)))
const onlineCount = computed(() => {
  const threshold = Math.floor(Date.now() / 1000) - 30 * 60
  return members.value.filter((member) => {
    const stats = cfStats(member)
    return Math.max(stats.cf_last_online || 0, stats.cf_last_submit || 0) >= threshold
  }).length
})
const topPlayers = computed(() => [...members.value].sort((a, b) => {
  return todayValue(b) - todayValue(a) || (cfStats(b).cf_rating || 0) - (cfStats(a).cf_rating || 0)
}).slice(0, 5))
const selectedMember = computed(() => members.value.find((member) => String(member.id) === String(selectedMemberId.value)))
const updatedText = computed(() => liveAt.value ? new Date(liveAt.value).toLocaleString('zh-CN', { hour12: false }) : '等待首轮数据')
const visitorClock = computed(() => {
  const environment = visitorEnvironment.value
  const format = (timeZone) => new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(clockNow.value)
  return { beijing: format('Asia/Shanghai'), utc: format('UTC'), local: environment?.timezone ? format(environment.timezone) : format(Intl.DateTimeFormat().resolvedOptions().timeZone) }
})
const visitorLocationText = computed(() => {
  const environment = visitorEnvironment.value
  if (!environment) return visitorEnvironmentLoading.value ? '正在定位访问环境…' : '访问环境暂不可用'
  const regionNames = {
    Jilin: '吉林省',
    Heilongjiang: '黑龙江省',
    Liaoning: '辽宁省',
    Beijing: '北京市',
    Shanghai: '上海市',
    Tianjin: '天津市',
    Chongqing: '重庆市',
    Hebei: '河北省',
    Shandong: '山东省',
    Guangdong: '广东省',
    Jiangsu: '江苏省',
    Zhejiang: '浙江省',
    Sichuan: '四川省',
    Hubei: '湖北省',
    Hunan: '湖南省',
    Henan: '河南省',
    Anhui: '安徽省',
    Fujian: '福建省',
    Jiangxi: '江西省',
    Shaanxi: '陕西省',
    Yunnan: '云南省',
    Guizhou: '贵州省',
    Gansu: '甘肃省',
    Qinghai: '青海省',
    Hainan: '海南省',
    Shanxi: '山西省',
    'Inner Mongolia': '内蒙古自治区',
    Xinjiang: '新疆维吾尔自治区',
    Tibet: '西藏自治区',
    Ningxia: '宁夏回族自治区',
    Guangxi: '广西壮族自治区',
    'Hong Kong': '香港特别行政区',
    Macao: '澳门特别行政区',
    Taiwan: '台湾省',
  }
  const cityNames = {
    Taobei: '洮北区',
    Baicheng: '白城市',
  }
  const region = regionNames[environment.region] || environment.region
  const city = cityNames[environment.city] || environment.city
  const district = environment.district || ''
  return [region, city, district].filter(Boolean).join(' · ') || environment.country
})
const visitorWeatherText = computed(() => {
  const current = visitorEnvironment.value?.current
  if (!current) return '—'
  return `${Math.round(current.temperature_2m)}°C`
})
const visitorWeatherDetails = computed(() => {
  const current = visitorEnvironment.value?.current
  if (!current) return visitorEnvironmentError.value || '正在读取天气'
  return `${weatherLabel(current.weather_code)} · 体感 ${Math.round(current.apparent_temperature)}° · 湿度 ${current.relative_humidity_2m}% · 风速 ${Math.round(current.wind_speed_10m)}km/h`
})
const visitorNetworkText = computed(() => {
  const environment = visitorEnvironment.value
  if (!environment) return '网络环境读取中'
  return `${environment.network || '未知网络'}${environment.asn ? ` · AS${environment.asn}` : ''}`
})
const visitorCoordinates = computed(() => {
  const environment = visitorEnvironment.value
  if (!environment || !Number.isFinite(Number(environment.latitude)) || !Number.isFinite(Number(environment.longitude))) return '坐标读取中'
  return `${Number(environment.latitude).toFixed(4)}, ${Number(environment.longitude).toFixed(4)}`
})
const deviceInfo = computed(() => {
  const ua = navigator.userAgent || ''
  const mobile = /Android|iPhone|iPod|Mobile/i.test(ua)
  const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '浏览器'
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Linux/i.test(ua) ? 'Linux' : '未知系统'
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  return {
    type: tablet ? '平板设备' : mobile ? '移动设备' : '桌面设备',
    browser,
    os,
    screen: `${window.screen.width} × ${window.screen.height}`,
    connection: connection?.effectiveType || '未知类型',
    downlink: connection?.downlink ? `${connection.downlink} Mbps` : '—',
    online: navigator.onLine,
  }
})
const visitorAsnText = computed(() => visitorEnvironment.value?.asn ? `AS${visitorEnvironment.value.asn}` : 'ASN 未知')
const exchangeSummary = computed(() => {
  const signal = globalSignals.value.exchange
  return signal ? `1 人民币 = ${signal.usd.toFixed(4)} 美元` : '人民币 / 美元汇率暂不可用'
})
const exchangeDetails = computed(() => {
  const signal = globalSignals.value.exchange
  return signal ? `CNY → USD · ${signal.date}` : 'Frankfurter API'
})
const metalSummary = computed(() => {
  const signal = globalSignals.value.metals
  return signal ? `黄金 ¥${signal.gold.toFixed(2)} · 白银 ¥${signal.silver.toFixed(2)}` : '金银价格暂不可用'
})
const metalDetails = computed(() => {
  const signal = globalSignals.value.metals
  return signal ? `${signal.currency} / ${signal.unit} · XAU / XAG` : '金价接口暂不可用'
})

onMounted(() => {
  applyTheme(); loadShellData(); window.addEventListener('hashchange', onHashChange)
  window.addEventListener('pointermove', updateCursor, { passive: true })
  window.addEventListener('pointerover', updateCursorHover, { passive: true })
  window.addEventListener('pointerout', updateCursorHover, { passive: true })
  window.addEventListener('pointerleave', hideCursor, { passive: true })
  window.addEventListener('click', createClickBurst)
  const savedSidebar = localStorage.getItem('sidebar-collapsed')
  sidebarCollapsed.value = savedSidebar === '1'
  ensureVisitorEnvironment()
  ensureGlobalSignals()
  if (currentRoute.value === 'contests') ensureContests()
  clockTimer = window.setInterval(() => {
    const now = Date.now()
    clockNow.value = now
  }, 1000)
  themeTimer = window.setInterval(() => {
    if (localStorage.getItem(THEME_MODE_KEY) !== 'manual') applyTheme()
  }, 60 * 1000)
})
onUnmounted(() => {
  if (clockTimer) {
    window.clearInterval(clockTimer)
    clockTimer = null
  }
  if (themeTimer) {
    window.clearInterval(themeTimer)
    themeTimer = null
  }
  window.removeEventListener('hashchange', onHashChange)
  window.removeEventListener('pointermove', updateCursor)
  window.removeEventListener('pointerover', updateCursorHover)
  window.removeEventListener('pointerout', updateCursorHover)
  window.removeEventListener('pointerleave', hideCursor)
  window.removeEventListener('click', createClickBurst)
})
</script>

<template>
  <div class="command-app" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'cursor-active': cursorVisible, 'cursor-hovering': cursorHovering, 'cursor-clicking': cursorClicking }">
    <div class="cursor-character" :style="{ left: `${cursorPosition.x}px`, top: `${cursorPosition.y}px`, backgroundImage: `url(${cursorImageUrl})` }" aria-hidden="true"></div><div class="click-burst-layer" aria-hidden="true"><b v-for="heart in heartBursts" :key="heart.id" class="click-heart" :style="{ left: `${heart.x}px`, top: `${heart.y}px`, '--heart-angle': `${heart.angle}deg`, '--heart-distance': `${heart.distance}px`, '--heart-delay': `${heart.delay}ms` }">♥</b></div>
    <aside class="command-sidebar">
      <div class="brand-lockup">
        <img class="brand-logo" :src="logoUrl" alt="北华大学 ACM 程序设计工作室队徽" />
        <div class="brand-copy"><strong>BUH ACM</strong><small>ALGORITHM LAB</small></div>
      </div>
      <button class="sidebar-toggle" @click="toggleSidebar" :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"><span>{{ sidebarCollapsed ? '→' : '←' }}</span><em>{{ sidebarCollapsed ? '展开' : '收起' }}</em></button>
      <div class="sidebar-label">WORKSPACE</div>
      <nav class="command-nav">
        <button v-for="route in routes" :key="route.key" :class="{ active: currentRoute === route.key }" @click="navigate(route.key)">
          <span class="nav-index">{{ route.short }}</span><span class="nav-icon">{{ route.icon }}</span><span class="nav-label">{{ route.label }}</span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="system-state"><i></i><span>DATA LINK ONLINE</span></div>
        <button class="theme-button" @click="toggleTheme"><span>{{ isDark ? '☼' : '◐' }}</span>{{ isDark ? '亮色界面' : '暗色界面' }}</button>
        <a href="https://github.com/Dddddduo/Bhu-Acm-Grade" target="_blank" rel="noopener">GITHUB REPOSITORY ↗</a>
      </div>
    </aside>

    <div class="command-main">
      <header class="command-topbar">
        <div><span class="eyebrow">BHU / COMPETITIVE PROGRAMMING</span><h1>{{ currentRoute === 'member' ? selectedMember?.name || '成员档案' : routes.find((route) => route.key === currentRoute)?.label }}</h1></div>
        <div class="top-status"><span class="live-pip"></span><LiveClock /><span class="top-divider"></span><span>数据更新 {{ updatedText }}</span></div>
      </header>

      <main v-if="currentRoute === 'dashboard'" class="dashboard-view">
        <section class="dashboard-hero" @pointermove="updateCommandPointer" @pointerleave="resetCommandPointer" :style="{ '--pointer-x': `${commandPointer.x}%`, '--pointer-y': `${commandPointer.y}%`, '--tilt-x': `${commandTilt.x}deg`, '--tilt-y': `${commandTilt.y}deg` }">
          <div class="hero-noise" aria-hidden="true"></div><div class="hero-scanline" aria-hidden="true"></div><div class="hero-stars" aria-hidden="true"><i v-for="n in 32" :key="n" :style="{ '--star-x': `${(n * 37) % 100}%`, '--star-y': `${(n * 61) % 100}%`, '--star-delay': `${-(n % 9) * .7}s`, '--star-size': `${1 + n % 3}px` }"></i></div><div class="hero-crosshair crosshair-a" aria-hidden="true"></div><div class="hero-crosshair crosshair-b" aria-hidden="true"></div><div class="hero-grid-mark">BHU / 01</div>
          <div class="hero-copy"><span class="hero-kicker">COMMAND CENTER <i></i> LIVE SYSTEM</span><h2>把每一次<br /><em>提交变成进度。</em></h2><div class="hero-brand-code">BHU ACM · ALGORITHM LAB</div><p>竞赛数据中枢，连接成员状态、Codeforces 赛事与工作室实时信号。</p><div class="hero-actions"><button class="hero-action" @click="navigate('leaderboard')">查看成员榜单 <span>↗</span></button><button class="hero-secondary" @click="navigate('contests')">赛事中心 <span>→</span></button></div></div>
          <div class="hero-radar" style="transform: translateZ(30px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y))"><div class="hero-particles" aria-hidden="true"><i v-for="n in 18" :key="n" :style="{ '--particle-angle': `${n * 20}deg`, '--particle-delay': `${-n * 0.22}s`, '--particle-distance': `${105 + (n % 5) * 15}px` }"></i></div><div class="radar-energy energy-one"></div><div class="radar-energy energy-two"></div><div class="radar-orbit orbit-a"></div><div class="radar-orbit orbit-b"></div><img class="hero-logo" :src="logoUrl" alt="BUH ACM 队徽" /><div class="radar-ring ring-one"></div><div class="radar-ring ring-two"></div><div class="radar-sweep"></div><span class="radar-dot dot-a"></span><span class="radar-dot dot-b"></span><span class="radar-dot dot-c"></span><span class="radar-label label-a">LIVE / 01</span><span class="radar-label label-b">SYNC / OK</span></div>
          <div class="hero-metrics"><div><small>成员总数</small><strong :key="`members-${members.length}`"><CountUp :value="members.length" /></strong><em>工作室成员</em></div><div><small>当前在线</small><strong :key="`online-${onlineCount}`"><CountUp :value="onlineCount" /></strong><em>Codeforces 活跃</em></div><div><small>今日通过</small><strong :key="`today-${totalToday}`"><CountUp :value="totalToday" /></strong><em>今日 AC 题数</em></div><div><small>累计通过</small><strong :key="`solved-${totalSolved}`"><CountUp :value="totalSolved" /></strong><em>全员 Codeforces 总题数</em></div></div>
          <div class="hero-foot"><span>EST. 2026</span><span>DATA LINK / {{ updatedText }}</span><span>CF / NOWCODER / LIVE</span></div>
        </section>

        <section class="environment-grid"><article class="environment-card visitor-card"><div class="environment-card-head"><div><span class="panel-kicker">VISITOR ENVIRONMENT</span><h3>访问环境</h3></div><span class="environment-status"><i></i> SESSION</span></div><div class="environment-location"><strong>{{ visitorLocationText }}</strong><small>{{ visitorEnvironment?.source === 'browser' ? '浏览器精确定位' : 'IP 粗定位' }} · {{ visitorEnvironment?.country || '未知地区' }} · {{ visitorEnvironment?.timezone || '时区等待中' }}</small><div class="environment-detail-grid"><span><b>坐标</b>{{ visitorCoordinates }}</span><span><b>设备</b>{{ deviceInfo.type }} · {{ deviceInfo.os }}</span><span><b>浏览器</b>{{ deviceInfo.browser }} · {{ deviceInfo.screen }}</span><span><b>连接</b>{{ deviceInfo.connection }} · {{ deviceInfo.downlink }}</span><span><b>网络组织</b>{{ visitorEnvironment?.network || '未知网络' }}</span><span><b>网络标识</b>{{ visitorAsnText }} · {{ visitorEnvironment?.ipType || 'IP 类型未知' }}</span></div></div><div class="environment-weather"><span class="weather-symbol">{{ visitorEnvironment?.current ? weatherIcon(visitorEnvironment.current.weather_code) : '◌' }}</span><div><strong>{{ visitorWeatherText }}</strong><small>{{ visitorWeatherDetails }}</small></div></div></article><article class="environment-card signal-card"><div class="environment-card-head"><div><span class="panel-kicker">GLOBAL SIGNALS</span><h3>全球信号</h3></div><span class="clock-zone">LIVE FEED</span></div><div v-if="globalSignalsLoading" class="signal-loading">正在读取全球信号…</div><div v-else class="signal-grid"><article class="signal-item holiday-signal"><span class="signal-icon">⌁</span><div><small>NEXT HOLIDAY</small><strong>{{ globalSignals.holiday?.name || '暂无节假日数据' }}</strong><em v-if="globalSignals.holiday">{{ signalHolidayDate(globalSignals.holiday.date) }} · {{ signalDaysUntil(globalSignals.holiday.date) }} 天后</em><em v-else>接口暂不可用</em></div></article><article class="signal-item exchange-signal"><span class="signal-icon">¥</span><div><small>CNY / USD</small><strong>{{ exchangeSummary }}</strong><em>{{ exchangeDetails }}</em></div></article><article class="signal-item hitokoto-signal"><span class="signal-icon">✦</span><div><small>HITOKOTO / 一言</small><strong>{{ globalSignals.hitokoto?.text || '一言数据读取中' }}</strong><em>{{ globalSignals.hitokoto?.fromWho || globalSignals.hitokoto?.from || 'Hitokoto' }}</em></div></article><article class="signal-item metals-signal"><span class="signal-icon">Au</span><div><small>PRECIOUS METALS</small><strong>{{ metalSummary }}</strong><em>{{ metalDetails }}</em></div></article></div></article></section>
      </main>
      <main v-else-if="currentRoute === 'leaderboard'" class="embedded-view"><LeaderboardView :embedded="true" @open-profile="openMember" /></main>
      <main v-else-if="currentRoute === 'member'" class="embedded-view"><MemberProfileView v-if="selectedMember" :member="selectedMember" :stats="cfStats(selectedMember)" @back="backToLeaderboard" /><div v-else class="placeholder-view"><h2>成员不存在</h2><button class="hero-action" @click="navigate('leaderboard')">返回成员榜单 <span>↗</span></button></div></main>
      <main v-else-if="currentRoute === 'contests'" class="embedded-view"><ContestArenaView :contests="contests" :members="members" :live-patch="livePatch" /></main>
      <main v-else-if="currentRoute === 'devlog'" class="embedded-view"><DevLogView /></main>
      <main v-else class="placeholder-view"><span class="placeholder-index">04</span><span class="eyebrow">MODULE NOT FOUND</span><h2>页面不存在</h2><p>请从左侧导航选择一个有效模块。</p><button class="hero-action" @click="navigate('dashboard')">返回指挥中心 <span>↗</span></button></main>
    </div>
  </div>
</template>

<style>
.custom-cursor-enabled, .custom-cursor-enabled * { cursor: none !important; }
.command-app { min-height: 100vh; display: flex; background: var(--command-bg); color: var(--command-text); }.click-burst-layer { position: fixed; z-index: 9999; pointer-events: none; }.cursor-character { position: fixed; z-index: 10000; width: 58px; height: 58px; margin: -15px 0 0 -13px; pointer-events: none; opacity: 0; background-position: center; background-repeat: no-repeat; background-size: contain; filter: drop-shadow(0 5px 8px rgba(20, 12, 54, .3)); transform: rotate(-6deg) scale(.82); transition: opacity .18s ease, transform .2s cubic-bezier(.2,.8,.2,1), filter .2s ease; animation: cursor-float 2.2s ease-in-out infinite; }.cursor-active .cursor-character { opacity: 1; transform: rotate(-6deg) scale(1); }.cursor-hovering .cursor-character { animation: cursor-jump .52s cubic-bezier(.2,.8,.2,1); filter: drop-shadow(0 0 12px var(--command-accent)) saturate(1.3); }.cursor-clicking .cursor-character { animation: cursor-spin .52s cubic-bezier(.2,.8,.2,1); }.click-heart { position: absolute; display: block; margin: -7px 0 0 -7px; color: #f472b6; font: 14px/1 Arial, sans-serif; text-shadow: 0 0 7px rgba(244, 114, 182, .9), 0 0 14px rgba(167, 139, 250, .7); opacity: 0; transform: rotate(var(--heart-angle)) translateY(0) scale(.45); animation: heart-float .85s cubic-bezier(.2,.8,.2,1) var(--heart-delay) forwards; }.command-sidebar { width: 240px; flex: 0 0 240px; min-height: 100vh; padding: 34px 24px 26px; border-right: 1px solid var(--command-line); display: flex; flex-direction: column; background: var(--command-side); transition: width .25s ease, flex-basis .25s ease, padding .25s ease; }.sidebar-collapsed .command-sidebar { width: 72px; flex-basis: 72px; padding-left: 12px; padding-right: 12px; }.brand-lockup { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }.brand-copy { min-width: 0; overflow: hidden; white-space: nowrap; }.brand-logo { width: 52px; height: 52px; flex: 0 0 52px; object-fit: contain; border-radius: 50%; background: #fff4bd; box-shadow: 0 0 0 1px var(--command-line), 0 0 22px rgba(118, 87, 232, .24); }.brand-lockup strong { display: block; font: 800 14px/1.1 Arial; letter-spacing: 1.5px; }.brand-lockup small { display: block; margin-top: 5px; color: var(--command-muted); font-size: 8px; letter-spacing: 1.5px; }.sidebar-toggle { display: flex; align-items: center; gap: 8px; width: 100%; margin: 0 0 34px; padding: 7px 9px; border: 1px solid var(--command-line); background: transparent; color: var(--command-muted); text-align: left; font-size: 10px; }.sidebar-toggle:hover { border-color: var(--command-accent); color: var(--command-accent); }.sidebar-toggle span { color: var(--command-accent); font: 16px monospace; }.sidebar-toggle em { font-style: normal; }.sidebar-collapsed .sidebar-toggle { justify-content: center; padding: 7px 0; }.sidebar-collapsed .sidebar-toggle em,.sidebar-collapsed .brand-copy,.sidebar-collapsed .sidebar-label,.sidebar-collapsed .nav-label,.sidebar-collapsed .sidebar-bottom { display: none; }
.sidebar-label,.eyebrow,.panel-kicker,.metric-label { color: var(--command-muted); font-size: 9px; font-weight: 800; letter-spacing: 1.8px; }.sidebar-label { margin-bottom: 16px; }.command-nav { display: grid; gap: 5px; }.command-nav button { border: 0; background: transparent; color: var(--command-muted); text-align: left; padding: 13px 10px; display: grid; grid-template-columns: 26px 22px 1fr; align-items: center; gap: 7px; font-size: 12px; }.command-nav button:hover,.command-nav button.active { color: var(--command-text); background: var(--command-hover); }.command-nav button.active { box-shadow: inset 3px 0 var(--command-accent); }.nav-index { font: 10px monospace; color: var(--command-muted); }.nav-icon { color: var(--command-accent); font-size: 16px; }.sidebar-bottom { margin-top: auto; display: grid; gap: 18px; font-size: 9px; color: var(--command-muted); }.system-state { display: flex; gap: 7px; align-items: center; color: var(--command-green); font-size: 9px; letter-spacing: 1px; }.system-state i,.tiny-live { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: var(--command-green); box-shadow: 0 0 10px var(--command-green); }.theme-button { padding: 0; border: 0; text-align: left; background: none; color: var(--command-muted); font-size: 10px; }.theme-button span { color: var(--command-accent); font-size: 16px; margin-right: 7px; }.sidebar-bottom a { color: var(--command-muted); font-size: 9px; letter-spacing: 1px; }
.command-main { min-width: 0; flex: 1; padding: 0 44px 60px; }.command-topbar { max-width: 1280px; margin: 0 auto; min-height: 108px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--command-line); }.command-topbar h1 { margin-top: 9px; font-size: 21px; letter-spacing: -.4px; }.top-status { color: var(--command-muted); font: 10px monospace; display: flex; gap: 10px; align-items: center; }.top-clock { color: var(--command-text); font: 700 14px monospace; font-variant-numeric: tabular-nums; letter-spacing: .5px; }.live-pip { width: 7px; height: 7px; background: var(--command-accent); border-radius: 50%; box-shadow: 0 0 14px var(--command-accent); }.top-divider { width: 1px; height: 14px; background: var(--command-line); }.dashboard-view,.placeholder-view { max-width: 1280px; margin: 0 auto; }.dashboard-hero { min-height: 470px; position: relative; overflow: hidden; perspective: 1000px; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(330px, .95fr); grid-template-rows: 1fr auto auto; align-items: center; column-gap: 40px; padding: 38px 34px 0; border: 1px solid var(--command-line); border-top: 0; background: radial-gradient(circle at var(--pointer-x) var(--pointer-y), color-mix(in srgb, var(--command-accent) 18%, transparent), transparent 18%), radial-gradient(circle at 80% 42%, var(--command-accent-soft), transparent 29%), linear-gradient(135deg, color-mix(in srgb, var(--command-accent-soft) 55%, transparent), transparent 46%), var(--command-bg); transition: background .2s ease; }.hero-noise,.hero-scanline,.hero-stars,.hero-crosshair { position: absolute; pointer-events: none; }.hero-noise { z-index: 0; inset: 0; opacity: .08; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.32'/%3E%3C/svg%3E"); mix-blend-mode: screen; animation: noise-shift .25s steps(2) infinite; }.hero-scanline { z-index: 7; inset: -30% 0 auto; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--command-accent) 75%, transparent), transparent); box-shadow: 0 0 18px var(--command-accent); opacity: .6; animation: scanline 7s linear infinite; }.hero-stars { z-index: 1; inset: 0; overflow: hidden; }.hero-stars i { position: absolute; left: var(--star-x); top: var(--star-y); width: var(--star-size); height: var(--star-size); border-radius: 50%; background: var(--command-accent); box-shadow: 0 0 8px var(--command-accent); opacity: .18; animation: star-blink 2.8s ease-in-out infinite; animation-delay: var(--star-delay); }.hero-crosshair { z-index: 1; width: 70px; height: 70px; border: 1px solid color-mix(in srgb, var(--command-accent) 38%, transparent); opacity: .45; animation: crosshair-pulse 4s ease-in-out infinite; }.hero-crosshair::before,.hero-crosshair::after { content: ''; position: absolute; background: color-mix(in srgb, var(--command-accent) 50%, transparent); }.hero-crosshair::before { top: 50%; left: -12px; right: -12px; height: 1px; }.hero-crosshair::after { left: 50%; top: -12px; bottom: -12px; width: 1px; }.crosshair-a { top: 14%; left: 46%; transform: rotate(45deg); }.crosshair-b { right: 8%; bottom: 23%; width: 44px; height: 44px; transform: rotate(15deg); animation-delay: -2s; }.dashboard-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--command-line) 1px, transparent 1px), linear-gradient(90deg, var(--command-line) 1px, transparent 1px); background-size: 44px 44px; opacity: .16; mask-image: linear-gradient(120deg, #000, transparent 75%); }.dashboard-hero::after { content: ''; position: absolute; top: 0; left: 0; width: 42%; height: 3px; background: linear-gradient(90deg, var(--command-accent), transparent); box-shadow: 0 0 24px var(--command-accent); }.hero-grid-mark { position: absolute; top: 20px; right: 30px; color: var(--command-muted); font: 9px monospace; letter-spacing: 2px; }.hero-copy,.hero-radar,.hero-metrics,.hero-foot { position: relative; z-index: 1; }.hero-copy { align-self: center; }.hero-kicker { display: inline-flex; align-items: center; gap: 8px; color: var(--command-accent); font: 700 9px monospace; letter-spacing: 1.8px; }.hero-kicker i { width: 6px; height: 6px; border-radius: 50%; background: var(--command-green); box-shadow: 0 0 10px var(--command-green); }.hero-copy h2 { margin: 22px 0 14px; font-size: clamp(42px, 5vw, 72px); line-height: .94; letter-spacing: -3px; }.hero-copy h2 em { color: var(--command-accent); font-style: normal; }.hero-brand-code { margin-top: 17px; color: var(--command-accent); font: 700 10px monospace; letter-spacing: 2px; }.hero-copy p { max-width: 430px; color: var(--command-muted); line-height: 1.7; font-size: 12px; }.hero-actions { display: flex; gap: 10px; align-items: center; margin-top: 26px; }.hero-action,.hero-secondary { margin-top: 0; cursor: pointer; }.hero-action { border: 1px solid var(--command-accent); padding: 12px 16px; background: var(--command-accent); color: #fff; font-weight: 800; font-size: 11px; }.hero-action span { margin-left: 23px; font-size: 16px; }.hero-secondary { padding: 11px 15px; border: 1px solid var(--command-line); background: transparent; color: var(--command-muted); font-size: 11px; }.hero-secondary:hover { border-color: var(--command-accent); color: var(--command-accent); }.hero-radar { width: min(330px, 100%); aspect-ratio: 1; justify-self: center; border: 1px solid color-mix(in srgb, var(--command-accent) 45%, var(--command-line)); border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--command-accent) 22%, transparent), transparent 59%); box-shadow: 0 0 60px color-mix(in srgb, var(--command-accent) 16%, transparent), inset 0 0 50px color-mix(in srgb, var(--command-accent) 9%, transparent); animation: radar-breathe 5s ease-in-out infinite; transition: transform .35s cubic-bezier(.2,.8,.2,1), filter .3s ease, box-shadow .3s ease; }.hero-radar:hover { transform: scale(1.045) rotate(1deg); filter: saturate(1.18) contrast(1.04); box-shadow: 0 0 110px color-mix(in srgb, var(--command-accent) 35%, transparent), inset 0 0 80px color-mix(in srgb, var(--command-accent) 20%, transparent); }.hero-radar::before,.hero-radar::after { content: ''; position: absolute; z-index: 5; pointer-events: none; border-radius: 50%; }.hero-radar::before { inset: -10px; border: 1px solid color-mix(in srgb, var(--command-accent) 24%, transparent); animation: radar-pulse 3.8s ease-out infinite; }.hero-radar::after { inset: 8%; background: repeating-conic-gradient(from 0deg, transparent 0deg 14deg, color-mix(in srgb, var(--command-accent) 12%, transparent) 15deg 16deg, transparent 17deg 30deg); mask-image: radial-gradient(circle, transparent 0 54%, #000 55% 56%, transparent 57%); animation: orbit-spin 30s linear infinite reverse; }.hero-particles { position: absolute; z-index: 4; inset: 0; pointer-events: none; }.hero-particles i { position: absolute; top: 50%; left: 50%; width: 3px; height: 3px; border-radius: 50%; background: var(--command-accent); box-shadow: 0 0 9px var(--command-accent); opacity: .2; transform: rotate(var(--particle-angle)) translateY(calc(-1 * var(--particle-distance))); animation: particle-float 3.8s ease-in-out infinite; animation-delay: var(--particle-delay); }.hero-logo { position: absolute; z-index: 2; inset: 18%; width: 64%; height: 64%; object-fit: contain; border-radius: 50%; opacity: .98; filter: drop-shadow(0 0 24px color-mix(in srgb, var(--command-accent) 70%, transparent)); animation: logo-hover 6s ease-in-out infinite; }.radar-ring { position: absolute; inset: 12%; border: 1px solid var(--command-line); border-radius: 50%; }.ring-two { inset: 28%; border-color: color-mix(in srgb, var(--command-accent) 55%, var(--command-line)); }.radar-orbit { position: absolute; inset: 5%; border: 1px dashed color-mix(in srgb, var(--command-accent) 45%, transparent); border-radius: 50%; animation: orbit-spin 16s linear infinite; }.radar-energy { position: absolute; z-index: 1; inset: 10%; border: 2px solid transparent; border-top-color: color-mix(in srgb, var(--command-accent) 70%, transparent); border-right-color: color-mix(in srgb, var(--command-accent) 18%, transparent); border-radius: 50%; filter: blur(.2px) drop-shadow(0 0 8px var(--command-accent)); animation: energy-flow 3.5s linear infinite; }.energy-two { inset: 24%; border-width: 1px; border-top-color: var(--command-green); border-right-color: transparent; animation-duration: 2.2s; animation-direction: reverse; opacity: .7; }.orbit-b { inset: 18%; transform: rotate(62deg) scaleY(.48); animation-duration: 10s; animation-direction: reverse; }.radar-sweep { position: absolute; inset: 0; z-index: 1; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0 74%, color-mix(in srgb, var(--command-accent) 30%, transparent) 87%, transparent 93%); animation: sweep 4s linear infinite; }.radar-core { position: absolute; z-index: 3; inset: 43%; display: grid; place-content: center; text-align: center; border: 1px solid var(--command-accent); border-radius: 50%; color: var(--command-accent); background: var(--command-bg); font: 700 11px/1.1 monospace; }.radar-core small { display: block; margin-top: 3px; color: var(--command-muted); font-size: 7px; letter-spacing: 1px; }.radar-dot { position: absolute; z-index: 4; width: 7px; height: 7px; background: var(--command-accent); border-radius: 50%; box-shadow: 0 0 14px var(--command-accent); }.dot-a { top: 21%; left: 66%; }.dot-b { top: 69%; left: 23%; }.dot-c { top: 78%; left: 72%; }.radar-label { position: absolute; z-index: 4; color: var(--command-muted); font: 9px monospace; }.label-a { top: 17%; right: 4%; }.label-b { bottom: 15%; left: 4%; }.hero-metrics { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); margin: 22px -34px 0; border-top: 1px solid var(--command-line); }.hero-metrics div { min-width: 0; padding: 14px 16px 13px; border-right: 1px solid var(--command-line); transition: background .25s ease, box-shadow .25s ease; }.hero-metrics:hover div:not(:hover) { opacity: .78; }.hero-metrics div:hover { position: relative; z-index: 2; background: color-mix(in srgb, var(--command-accent-soft) 78%, var(--command-panel)); box-shadow: inset 0 -2px var(--command-accent), 0 0 28px color-mix(in srgb, var(--command-accent) 18%, transparent); transform: translateY(-5px) scale(1.035); transition: transform .22s cubic-bezier(.2,.8,.2,1), background .25s ease, box-shadow .25s ease, opacity .2s ease, filter .2s ease; }.hero-metrics div:last-child { border-right: 0; }.hero-metrics small,.hero-metrics em { display: block; color: var(--command-muted); font: 8px monospace; letter-spacing: 1px; }.hero-metrics strong { display: block; margin: 5px 0 3px; color: var(--command-accent); font: 700 25px monospace; animation: metric-pop .45s cubic-bezier(.2,.8,.2,1); }.hero-metrics em { color: var(--command-muted); font-size: 7px; letter-spacing: .5px; font-style: normal; }.hero-foot { grid-column: 1 / -1; display: flex; gap: 28px; padding: 13px 0 16px; color: var(--command-muted); font: 8px monospace; }.environment-grid { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--command-line); }.metric-card { min-height: 142px; padding: 23px 24px; border-right: 1px solid var(--command-line); }.metric-card:last-child { border-right: 0; }.metric-card strong { display: block; margin: 17px 0 5px; color: var(--command-text); font: 600 36px/1 monospace; letter-spacing: -3px; }.metric-primary strong { color: var(--command-accent); }.metric-note { color: var(--command-muted); font-size: 10px; }.metric-note .tiny-live { margin-right: 5px; }.environment-grid { display: grid; grid-template-columns: .9fr 1.1fr; gap: 1px; margin-top: 1px; background: var(--command-line); border-bottom: 1px solid var(--command-line); }.environment-card { min-height: 170px; padding: 22px 25px; background: var(--command-bg); transition: transform .28s cubic-bezier(.2,.8,.2,1), filter .25s ease, opacity .25s ease, box-shadow .28s ease; }.environment-grid:hover .environment-card:not(:hover) { opacity: .78; }.environment-grid .environment-card:hover { position: relative; z-index: 2; transform: translateY(-6px) scale(1.012); box-shadow: 0 18px 40px color-mix(in srgb, var(--command-accent) 17%, transparent); }.signal-card { background: var(--command-panel); }.environment-card-head { display: flex; align-items: flex-start; justify-content: space-between; }.environment-card-head h3 { margin-top: 8px; font-size: 18px; }.environment-status,.clock-zone { color: var(--command-green); font: 8px monospace; letter-spacing: 1px; }.environment-status i { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: var(--command-green); box-shadow: 0 0 8px var(--command-green); }.environment-location { margin-top: 22px; }.environment-location strong { display: block; color: var(--command-text); font-size: 18px; }.environment-location small { display: block; margin-top: 6px; color: var(--command-muted); font: 9px monospace; }.environment-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 12px; margin-top: 13px; }.environment-detail-grid span { min-width: 0; overflow: hidden; color: var(--command-muted); font: 9px monospace; text-overflow: ellipsis; white-space: nowrap; }.environment-detail-grid b { margin-right: 7px; color: var(--command-accent); font-weight: 700; }.environment-weather { display: flex; align-items: center; gap: 12px; margin-top: 17px; }.weather-symbol { color: var(--command-accent); font: 30px monospace; }.environment-weather strong,.environment-weather small { display: block; }.environment-weather strong { font: 700 21px monospace; }.environment-weather small { margin-top: 3px; color: var(--command-muted); font-size: 10px; }.clock-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 28px; border: 1px solid var(--command-line); }.clock-grid div { min-height: 75px; padding: 12px; border-right: 1px solid var(--command-line); }.clock-grid div:last-child { border-right: 0; }.clock-grid span,.clock-grid small { display: block; color: var(--command-muted); font: 8px monospace; }.clock-grid strong { display: block; margin: 9px 0 4px; color: var(--command-accent); font: 700 18px monospace; }.clock-grid small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.signal-loading { min-height: 142px; display: grid; place-items: center; color: var(--command-muted); font: 10px monospace; }.signal-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 18px; }.signal-item { min-width: 0; display: flex; gap: 10px; min-height: 65px; padding: 10px; border: 1px solid var(--command-line); background: var(--command-bg); transition: transform .22s cubic-bezier(.2,.8,.2,1), filter .22s ease, opacity .22s ease, border-color .22s ease, box-shadow .22s ease; }.signal-grid:hover .signal-item:not(:hover) { opacity: .72; }.signal-item:hover { position: relative; z-index: 2; border-color: var(--command-accent); transform: translateY(-4px) scale(1.035); box-shadow: 0 12px 26px color-mix(in srgb, var(--command-accent) 18%, transparent), inset 0 0 22px color-mix(in srgb, var(--command-accent) 8%, transparent); }.signal-icon { display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; border: 1px solid var(--command-accent); color: var(--command-accent); font: 15px monospace; }.signal-item div { min-width: 0; }.signal-item small,.signal-item strong,.signal-item em { display: block; }.signal-item small { color: var(--command-muted); font: 8px monospace; letter-spacing: .6px; }.signal-item strong { overflow: hidden; margin-top: 6px; color: var(--command-text); font-size: 11px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }.signal-item em { overflow: hidden; margin-top: 5px; color: var(--command-muted); font: 9px monospace; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }.dashboard-link-card { position: relative; min-height: 210px; display: flex; align-items: flex-end; gap: 18px; overflow: hidden; cursor: pointer; border: 1px solid var(--command-line); transition: border-color .2s ease, transform .2s ease, background .2s ease; }.dashboard-link-card:hover { transform: translateY(-3px); border-color: var(--command-accent); background: var(--command-hover); }.dashboard-link-card::before { content: ''; position: absolute; inset: auto -50px -80px auto; width: 220px; height: 220px; border: 1px solid var(--command-accent); border-radius: 50%; opacity: .16; }.contests-link-card::before { border-radius: 0; transform: rotate(45deg); }.link-card-index { align-self: flex-start; color: var(--command-accent); font: 12px monospace; }.link-card-copy { position: relative; z-index: 1; }.link-card-copy h3 { margin: 10px 0; font-size: 25px; }.link-card-copy p { max-width: 330px; color: var(--command-muted); font-size: 11px; line-height: 1.7; }.link-card-action { display: inline-block; margin-top: 20px; color: var(--command-accent); font: 10px monospace; }.link-card-icon { position: absolute; top: 25px; right: 25px; color: var(--command-accent); font: 34px monospace; opacity: .8; }
@keyframes sweep { to { transform: rotate(360deg); } }
@keyframes cursor-float { 0%, 100% { translate: 0 0; } 50% { translate: 0 -4px; } }
@keyframes cursor-jump { 0% { transform: rotate(-6deg) scale(1); } 35% { transform: rotate(14deg) scale(1.38) translateY(-12px); } 65% { transform: rotate(-12deg) scale(1.28) translateY(-5px); } 100% { transform: rotate(-6deg) scale(1); } }
@keyframes cursor-spin { 0% { transform: rotate(-6deg) scale(1); } 45% { transform: rotate(185deg) scale(1.18); } 100% { transform: rotate(360deg) scale(1); } }
@keyframes heart-float { 0% { opacity: 0; transform: rotate(var(--heart-angle)) translate(0, 4px) scale(.35); } 18% { opacity: 1; } 100% { opacity: 0; transform: rotate(var(--heart-angle)) translate(var(--heart-distance), -46px) scale(1.05); } }
@keyframes click-expand { 0% { opacity: .9; transform: scale(.35); } 55% { opacity: .8; } 100% { opacity: 0; transform: scale(4); } }

@keyframes orbit-spin { to { transform: rotate(360deg); } }
@keyframes radar-breathe { 0%, 100% { box-shadow: 0 0 60px color-mix(in srgb, var(--command-accent) 14%, transparent), inset 0 0 50px color-mix(in srgb, var(--command-accent) 8%, transparent); } 50% { box-shadow: 0 0 92px color-mix(in srgb, var(--command-accent) 26%, transparent), inset 0 0 72px color-mix(in srgb, var(--command-accent) 16%, transparent); } }
@keyframes radar-pulse { 0% { opacity: .7; transform: scale(.96); } 70%, 100% { opacity: 0; transform: scale(1.08); } }
@keyframes particle-float { 0%, 100% { opacity: .18; transform: rotate(var(--particle-angle)) translateY(calc(-1 * var(--particle-distance))) scale(.75); } 50% { opacity: .9; transform: rotate(calc(var(--particle-angle) + 18deg)) translateY(calc(-1 * var(--particle-distance) - 8px)) scale(1.35); } }
@keyframes logo-hover { 0%, 100% { transform: scale(1) translateY(0); } 50% { transform: scale(1.025) translateY(-3px); } }
@keyframes metric-pop { from { opacity: .2; transform: translateY(5px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes scanline { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: .75; } 86% { opacity: .55; } 100% { transform: translateY(760px); opacity: 0; } }
@keyframes noise-shift { 0% { transform: translate(0, 0); } 25% { transform: translate(1%, -1%); } 50% { transform: translate(-1%, 1%); } 75% { transform: translate(1%, 1%); } 100% { transform: translate(0, 0); } }
@keyframes star-blink { 0%, 100% { opacity: .12; transform: scale(.7); } 45% { opacity: .75; transform: scale(1.5); } 65% { opacity: .22; transform: scale(.9); } }
@keyframes crosshair-pulse { 0%, 100% { opacity: .25; transform: scale(.85) rotate(45deg); } 50% { opacity: .75; transform: scale(1.1) rotate(45deg); } }
@keyframes energy-flow { to { transform: rotate(360deg); } }
@media (pointer: coarse) { .custom-cursor-enabled, .custom-cursor-enabled * { cursor: auto !important; }.command-app { cursor: auto; }.command-app button,.command-app a,.command-app input,.command-app select,.command-app summary { cursor: auto; }.cursor-character { display: none; }.click-heart { animation: none; } }
@media (prefers-reduced-motion: reduce) { .cursor-character,.click-heart,.hero-radar,.hero-radar::before,.hero-radar::after,.hero-particles i,.hero-logo,.hero-metrics strong,.hero-noise,.hero-scanline,.hero-stars i,.hero-crosshair,.radar-energy { animation: none; } }
@media (max-width: 680px) { .command-sidebar { width: 190px; flex-basis: 190px; }.command-main { padding: 0 22px 40px; }.dashboard-hero { min-height: 440px; padding-left: 24px; padding-right: 24px; column-gap: 20px; }.hero-metrics { margin-left: -24px; margin-right: -24px; }.metric-card { padding: 20px 14px; }.metric-card strong { font-size: 28px; }.bottom-strip > div { gap: 10px; }.bottom-strip p { max-width: 390px; }.environment-detail-grid { gap: 7px 8px; } }
@media (max-width: 680px) { .command-app { display: block; }.command-sidebar { width: 100%; min-height: auto; padding: 16px; border-right: 0; border-bottom: 1px solid var(--command-line); }.sidebar-toggle { display: none; }.brand-lockup { margin-bottom: 15px; }.sidebar-label,.sidebar-bottom { display: none; }.command-nav { grid-template-columns: repeat(4, 1fr); gap: 3px; }.command-nav button { padding: 9px 5px; display: flex; justify-content: center; gap: 4px; font-size: 10px; }.nav-index { display: none; }.command-main { padding: 0 16px 35px; }.command-topbar { min-height: 82px; }.top-status { font-size: 8px; }.top-clock { font-size: 12px; }.top-status .top-divider,.top-status { gap: 5px; }.dashboard-hero { min-height: 0; display: grid; grid-template-columns: 1fr; grid-template-rows: auto auto auto auto; gap: 22px; padding: 54px 18px 0; }.hero-grid-mark { top: 18px; right: 18px; }.hero-copy h2 { font-size: 48px; }.hero-actions { margin-top: 20px; }.hero-radar { width: min(270px, 82vw); }.hero-metrics { grid-template-columns: 1fr 1fr; margin: 0 -18px; }.hero-metrics div { padding: 11px 13px; }.hero-metrics strong { font-size: 21px; }.hero-foot { gap: 12px; padding: 11px 0 13px; font-size: 7px; white-space: nowrap; }.hero-logo { inset: 18%; width: 64%; height: 64%; }.brand-logo { width: 44px; height: 44px; flex-basis: 44px; }.metric-grid { grid-template-columns: 1fr 1fr; }.metric-card:nth-child(2) { border-right: 0; }.metric-card:nth-child(-n+2) { border-bottom: 1px solid var(--command-line); }.dashboard-columns { display: block; }.panel { min-height: auto; }.bottom-strip { display: block; }.bottom-strip > div { align-items: flex-start; }.bottom-strip p { line-height: 1.6; }.bottom-strip button { margin: 20px 0 0 48px; }.placeholder-view h2 { font-size: 42px; }.environment-detail-grid { grid-template-columns: 1fr; }.signal-grid { grid-template-columns: 1fr; } }
  .command-sidebar {
    position: relative;
    background: linear-gradient(180deg, var(--command-side) 0%, color-mix(in srgb, var(--command-side) 86%, var(--command-accent) 14%) 100%);
    box-shadow: 12px 0 32px rgba(73, 52, 139, .08);
  }
  .command-sidebar::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 1px;
    height: 100%;
    background: linear-gradient(180deg, transparent, var(--command-accent), transparent);
    opacity: .45;
  }
  .brand-lockup { position: relative; padding: 14px 12px 18px; margin: -10px -10px 20px; border-bottom: 1px solid var(--command-line); }
  .brand-logo { width: 58px; height: 58px; flex-basis: 58px; box-shadow: 0 0 0 2px var(--command-side), 0 0 0 3px var(--command-accent), 0 10px 24px rgba(118, 87, 232, .24); }
  .brand-lockup strong { font-size: 15px; letter-spacing: 2px; }
  .brand-lockup small { color: var(--command-accent); font-size: 8px; letter-spacing: 1.8px; }
  .sidebar-toggle { border-radius: 8px; border-color: color-mix(in srgb, var(--command-accent) 35%, var(--command-line)); background: color-mix(in srgb, var(--command-accent-soft) 60%, transparent); }
  .sidebar-label { padding-left: 10px; margin-bottom: 9px; font-size: 8px; }
  .command-nav { gap: 4px; padding: 0 2px; }
  .command-nav button { position: relative; min-height: 48px; border-radius: 9px; grid-template-columns: 28px 26px 1fr; gap: 8px; padding: 10px 11px; color: var(--command-muted); transition: background .2s ease, color .2s ease, transform .2s ease; }
  .command-nav button::after { content: '↗'; position: absolute; right: 12px; color: transparent; font: 12px monospace; transition: color .2s ease; }
  .command-nav button:hover { transform: translateX(2px); }
  .command-nav button.active { color: var(--command-text); background: linear-gradient(90deg, var(--command-accent-soft), transparent); box-shadow: inset 3px 0 var(--command-accent), 0 6px 16px rgba(118, 87, 232, .08); }
  .command-nav button.active::after { color: var(--command-accent); }
  .command-nav button.active .nav-index { color: var(--command-accent); }
  .nav-index { color: color-mix(in srgb, var(--command-muted) 72%, transparent); font-size: 9px; }
  .nav-icon { display: grid; place-items: center; width: 23px; height: 23px; border: 1px solid var(--command-line); border-radius: 6px; background: var(--command-panel); font-size: 14px; }
  .command-nav button.active .nav-icon { border-color: var(--command-accent); background: var(--command-accent); color: #fff; }
  .sidebar-bottom { margin: auto -4px 0; padding: 14px 12px 0; border-top: 1px solid var(--command-line); gap: 12px; }
  .system-state { padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--command-green) 28%, var(--command-line)); border-radius: 8px; background: color-mix(in srgb, var(--command-green) 7%, transparent); font-size: 8px; }
  .theme-button { padding: 5px 0; }
  .sidebar-bottom a { padding-top: 3px; font-size: 8px; }
  .sidebar-collapsed .brand-lockup { justify-content: center; padding: 14px 0 18px; margin-left: -4px; margin-right: -4px; }
  .sidebar-collapsed .brand-logo { width: 48px; height: 48px; flex-basis: 48px; }
  .sidebar-collapsed .sidebar-toggle { margin-top: 4px; }
  .sidebar-collapsed .command-nav button { grid-template-columns: 1fr; justify-items: center; min-height: 46px; padding: 8px 0; }
  .sidebar-collapsed .command-nav button::after { display: none; }
  .sidebar-collapsed .nav-index { display: none; }
  .sidebar-collapsed .nav-icon { width: 30px; height: 30px; font-size: 16px; }
  .sidebar-collapsed .sidebar-bottom { display: grid; margin: auto -4px 0; padding: 12px 0 0; gap: 0; justify-items: center; }
  .sidebar-collapsed .sidebar-bottom .system-state,
  .sidebar-collapsed .sidebar-bottom > a { display: none; }
  .sidebar-collapsed .theme-button { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--command-line); border-radius: 8px; background: var(--command-panel); font-size: 0; }
  .sidebar-collapsed .theme-button:hover { border-color: var(--command-accent); background: var(--command-accent-soft); }
  .sidebar-collapsed .theme-button span { margin: 0; font-size: 20px; line-height: 1; }
  @media (max-width: 680px) {
    .brand-lockup { margin: -4px 0 14px; padding: 8px 0 12px; }
    .brand-logo { width: 44px; height: 44px; flex-basis: 44px; }
    .brand-lockup strong { font-size: 13px; }
    .command-nav button::after { display: none; }
    .command-nav button.active { box-shadow: inset 0 -2px var(--command-accent); }
    .nav-icon { width: 21px; height: 21px; }
  }
</style>

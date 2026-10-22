<script setup>
// 主页面:读 members.json 渲染,数据实时抓取(CF 直连官方 API;牛客只走 Cloudflare Worker
// 代理,见 liveNc.js —— 牛客页面对跨站 Origin 会被 WAF 拦,浏览器直连拿不到)。
// ★ 进页面先用 localStorage 缓存立刻渲染,缓存不超过 LIVE_EVERY_MS 就不再重新调三方;
//   页面开着每隔 LIVE_EVERY_MS 自动抓一轮,抓完写回缓存。
// ★ 总分/名次见 score.js:CF 75%(Rating30/最高5/近30天10/总题30)+ 牛客 25%(Rating10/总过题15);
//   按总分排,前 12% 金牌、24% 银牌、36% 铜牌(向上取整),其余/没数据 = 未定级。
//   ★ 奖牌只挂新生榜;老登榜不显示评级列,页面标注「排名不分先后」。
// 抓到的值进 livePatch + localStorage;抓失败的人跳过、保留旧值(宁旧勿丢)。
// Worker 不可用 -> 提示一次,牛客列显示未定级,CF 列照常。
import { ref, computed, onMounted, onUnmounted } from 'vue'
import RankTable from './components/RankTable.vue'
import MobileCards from './components/MobileCards.vue'
import CountUp from './components/CountUp.vue'
import { COLUMNS } from './columns.js'
import { fetchCfLive, fetchCfContests, ratedGuess, CONTEST_CACHE_KEY } from './liveCf.js'
import { fetchNcLive } from './liveNc.js'
import { computeScore, assignLevels } from './score.js'

const LIVE_EVERY_MS = 10 * 60 * 1000 // 每 10 分钟自动抓一轮(缓存在这之内直接复用,不重抓)
const CACHE_KEY = 'bhu-acm-live-cache-v1'

const members = ref([])
const loading = ref(true)
const loadError = ref('')

// 实时抓到的值:{ 成员id: 补丁字段 } —— 同时写进 localStorage,
// 下次进页面立刻用缓存渲染,不用等三方接口(见 loadCache / saveCache)
const livePatch = ref({})
// 最近一次实时抓取完成时间:**数字时间戳(Date.now())**
// 曾有坑:这里存 toLocaleString 字符串,Chrome 中文下是 "2026/10/19 21:16:30",
// replace(' ','T') 后 new Date() 解析成 NaN -> 超期判断永远 false -> 页面再也不自动刷
const liveAt = ref(0)
const liveBusy = ref(false) // 正在抓取
const liveError = ref('') // CF 侧最近一次抓取失败原因
const ncHint = ref('') // 牛客侧提示(代理不可用 / 取数失败)

// localStorage 缓存读写:全程 try/catch(无痕模式 / 配额满会抛),读写失败当没缓存用
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (!c || typeof c !== 'object' || !c.patch || typeof c.patch !== 'object') return null
    if (!Number.isFinite(c.at) || c.at > Date.now()) return null // 时间戳异常/未来时间,视为脏缓存
    return c
  } catch {
    return null
  }
}
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: liveAt.value, patch: livePatch.value }))
  } catch {
    /* 存不进去就算了,不影响页面 */
  }
}

const search = ref('')
const clazzFilter = ref('')
const group = ref('fresh') // 新生 / 老登分开看
// 排序默认:新生按积分总分(奖牌按总分切,第一眼看到正确名次);老登按 CF 最高分
const sortKey = ref(defaultSortFor('fresh'))
const sortDir = ref('desc')

function defaultSortFor(g) {
  return g === 'old' ? 'cf_max_rating' : 'score'
}
function selectGroup(g) {
  group.value = g
  clazzFilter.value = ''
  sortKey.value = defaultSortFor(g)
  sortDir.value = 'desc'
}

// 排序取值:数值列直接从行数据里取;没数据 = 排最后(-Infinity)
function rowValue(row, key) {
  const v = row.stats?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : -Infinity
}

// 窄屏换卡片视图,表格不用左右划
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 760)
function onResize() {
  isMobile.value = window.innerWidth < 760
}
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

// ---------- 近期比赛(Div.1~4 / 1+2,不含 gym) ----------
// contests: { id, name, phase, startTimeSeconds, durationSeconds, ratingConfirmed } 最多 5 条;
// restCount: 窗口内没展示出来的场数,只做数字提醒。
// 「可计算 Rating」标注:已结束的以 contest.ratingChanges 实锤为准(ratingConfirmed),
// 未结束的按名称启发式预估(ratedGuess),文案区分「计分 / 预计计分」。
const contests = ref([])
const restCount = ref(0)
const contestsAt = ref(0) // 最近一次比赛数据更新时间戳
const CONTEST_EVERY_MS = 30 * 60 * 1000 // 比赛列表变化慢,单独 30 分钟 TTL(成员缓存没过期时也会补抓)

function loadContestCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CONTEST_CACHE_KEY))
    if (c && Array.isArray(c.list) && Number.isFinite(c.at) && c.at <= Date.now()) {
      contests.value = c.list
      restCount.value = c.rest || 0
      contestsAt.value = c.at
    }
  } catch {
    /* 没缓存就用空的 */
  }
}
function saveContestCache() {
  try {
    localStorage.setItem(
      CONTEST_CACHE_KEY,
      JSON.stringify({ at: contestsAt.value, list: contests.value, rest: restCount.value })
    )
  } catch {
    /* 存不进去就算了 */
  }
}

async function refreshContests() {
  if (contestsAt.value && Date.now() - contestsAt.value < CONTEST_EVERY_MS) return // 比赛缓存没超期,不重抓
  const r = await fetchCfContests()
  if (!r) return // 失败保留旧值,绝不清空
  contests.value = r.contests
  restCount.value = r.rest
  contestsAt.value = r.fetchedAt
  saveContestCache()
}

// 北京时间「MM月d日 HH:mm」;跨天的加「周X」帮判断别记错
function fmtCfTime(sec) {
  const d = new Date((sec + 8 * 3600) * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()]
  return `${pad(d.getUTCMonth() + 1)}月${pad(d.getUTCDate())}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} · ${week}`
}
function phaseText(phase) {
  return phase === 'FINISHED' ? '已结束' : phase === 'CODING' ? '进行中' : '即将开始'
}
function contestUrl(id) {
  return `https://codeforces.com/contests/${id}`
}
function ratedTag(c) {
  if (c.phase === 'FINISHED')
    return c.ratingConfirmed ? { t: '计Rating分', cls: 'yes' } : { t: '不计分', cls: 'no' }
  return ratedGuess(c.name) ? { t: '计Rating分', cls: 'maybe' } : { t: '预计不计分', cls: 'no' }
}
const ratedContestCount = computed(() => contests.value.filter((c) => ratedTag(c).cls !== 'no').length)

// ---------- 比赛倒计时:每秒一跳,实时显示「距开始/距结束 还有 X天X小时X分X秒」 ----------
// 一个 ref 当秒针,模板里所有倒计时都读它 -> Vue 每秒精准重渲染这几个 span
const nowTick = ref(Date.now())
let cdTimer = null
onMounted(() => {
  cdTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (cdTimer) clearInterval(cdTimer)
})

// 剩余秒数 -> 「X天X小时X分X秒」(高位为 0 就省略,最简只留「X秒」)
function fmtRemain(sec) {
  let s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600);  s -= h * 3600
  const m = Math.floor(s / 60);    s -= m * 60
  const parts = []
  if (d) parts.push(`${d}天`)
  if (d || h) parts.push(`${h}小时`)
  if (d || h || m) parts.push(`${m}分`)
  parts.push(`${s}秒`)
  return parts.join('')
}

// 一场比赛的倒计时:{ label, value, remain, live } —— 没开 -> 距开始;正在打 -> 距结束(红色警示);打完 -> null(不显示)
function cdOf(c) {
  const now = nowTick.value
  if (c.phase === 'FINISHED') return null
  const start = c.startTimeSeconds * 1000
  const end = (c.startTimeSeconds + c.durationSeconds) * 1000
  if (now < start) return { label: '距开始', value: fmtRemain((start - now) / 1000), remain: (start - now) / 1000, live: false }
  if (now < end) return { label: '距结束', value: fmtRemain((end - now) / 1000), remain: (end - now) / 1000, live: true }
  // phase 缓存还没翻成 FINISHED 的窗口期:已结束就不显示倒计时,避免显示负数/0
  return null
}

const visibleColumns = computed(() => COLUMNS.filter((c) => !c.hidden))

const groups = [
  { key: 'fresh', label: '新生' },
  { key: 'old', label: '老登' },
]

const classes = computed(() =>
  [...new Set(groupMembers.value.map((m) => m.clazz).filter(Boolean))].sort()
)

// 当前分组名单
const groupMembers = computed(() => members.value.filter((m) => m.group === group.value))

// 名单 + 实时数据合并,并算出积分总分。"今日"列按日期口径显示:cf_date 不是北京今天的,
// 当没数据(今日列显示未定级,但**不影响其它项计分**——近30天/总分照常),
// 绝不把昨天的数字挂成今天的(宁缺勿假)
function bjDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}
const joined = computed(() => {
  const live = livePatch.value
  const todayStr = bjDate()
  return groupMembers.value.map((m) => {
    let st = live[String(m.id)] || null
    if (st && st.cf_date !== todayStr && 'cf_today' in st) st = { ...st, cf_today: null }
    // 总分单独算:cf_today 不进积分,所以"今日过期"不影响 score
    const raw = live[String(m.id)] || null
    const score = raw ? computeScore(raw) : null
    return { member: m, stats: st ? { ...st, score } : { score } }
  })
})

// 奖牌等级:按当前分组内总分排名切 12% 金 / 24% 银 / 36% 铜(向上取整),没数据=未定级
const levels = computed(() => assignLevels(joined.value))

// 今日概览 / 今日之星:CF 今日做题口径(牛客只展示 Rating,没有今日列)
function todayOf(r) {
  return r.stats?.cf_today ?? 0
}
const todayActive = computed(() => joined.value.filter((r) => todayOf(r) > 0))
const todaySum = computed(() => joined.value.reduce((s, r) => s + todayOf(r), 0))

// 今日之星:按今日 CF 做题数取前三(并列同名次,后面顺延)
const todayStars = computed(() => {
  const ranked = [...todayActive.value].sort((a, b) => todayOf(b) - todayOf(a))
  const out = []
  let lastVal
  let lastRank = 0
  ranked.forEach((r, i) => {
    const v = todayOf(r)
    if (i === 0 || v !== lastVal) { lastRank = i + 1; lastVal = v }
    if (lastRank <= 3) out.push({ ...r, starRank: lastRank, today: v })
  })
  return out.slice(0, 3)
})
// 展示辅助(纯视觉,不改口径):前三合计、每人占今日总量的百分比
const topSum = computed(() => todayStars.value.reduce((s, r) => s + r.today, 0))
function sharePct(n) {
  return todaySum.value ? Math.max(1, Math.round((n / todaySum.value) * 100)) : 0
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return joined.value.filter(({ member: m }) => {
    if (clazzFilter.value && m.clazz !== clazzFilter.value) return false
    if (!q) return true
    return [m.name, m.clazz, m.student_id, m.cf_handle, m.nowcoder_id]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
  })
})

const sorted = computed(() => {
  const dir = sortDir.value === 'asc' ? 1 : -1
  return [...filtered.value].sort((a, b) => {
    const va = rowValue(a, sortKey.value)
    const vb = rowValue(b, sortKey.value)
    return (va - vb) * dir
  })
})

function onSort(key) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

async function loadJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.json()
}

// ---------- 浏览器端定时抓取(10 分钟一轮 + localStorage 缓存) ----------
// CF 官方 API 允许跨域(实测 ACAO: *)直连抓;牛客 rating-history 对跨站 Origin
// 会被 WAF 拦(实测),必须经 Cloudflare Worker 代理(见 liveNc.js)。
// 两家并发、各自内部有自己的限速闸门,互不干扰;
// **抓到一个人就填一行**(onEach -> applyLive),不等全员完成,并写回缓存。
// 任何一个人失败:跳过,保留旧值,绝不清空。

// 单人补丁即时并入实时层:每次都是新对象,Vue 响应式立刻重渲染该行
function applyLive(id, rec) {
  livePatch.value = { ...livePatch.value, [id]: { ...(livePatch.value[id] || {}), ...rec } }
  saveCache() // 抓一个存一个:中途关页面也不亏,下次进来立刻有数据
}

let liveTimer = null
function onVisible() {
  // 从别的标签页切回来,如果距上次抓取已超过一个周期,立刻补一轮
  if (document.visibilityState !== 'visible') return
  if (Date.now() - liveAt.value > LIVE_EVERY_MS) refreshLive()
}
async function refreshLive() {
  if (liveBusy.value || !members.value.length) return
  liveBusy.value = true
  liveError.value = ''
  ncHint.value = ''
  // 近期比赛:独立一次请求(共用限速闸门),不拖累成员数据,失败静默保留旧值
  refreshContests().catch((e) => console.warn('[live] contests:', e))
  try {
    const [cf, nc] = await Promise.all([
      fetchCfLive(members.value, applyLive).catch((e) => {
        console.warn('[live] CF:', e)
        liveError.value = 'CF 实时获取失败(下一轮自动重试)'
        return {}
      }),
      fetchNcLive(members.value, applyLive).catch((e) => {
        console.warn('[live] 牛客:', e)
        ncHint.value = e.proxyDown
          ? '牛客列取数失败:请确认代理已部署(见 README 方案 B:重新粘贴 ncTencentScf.js 并部署;浏览器开 <代理URL>?uid=619886673 回包带 _v:"v4" 或正常出数即为最新版。CF 列不受影响)'
          : '牛客 Rating 实时获取失败(下一轮自动重试)'
        return {}
      }),
    ])
    liveAt.value = Object.keys(cf).length || Object.keys(nc).length ? Date.now() : liveAt.value
    saveCache()
    logLive(cf, nc)
  } finally {
    liveBusy.value = false
  }
}

// 把这一轮实时抓到的数据逐人打到浏览器控制台(F12 -> Console),方便核对
// 抓取现场:哪个字段拿到了、哪个字段没拿到(缺失 = 该请求失败,沿用旧值)
function logLive(cf, nc) {
  const byId = Object.fromEntries(members.value.map((m) => [String(m.id), m]))
  const ids = [...new Set([...Object.keys(cf), ...Object.keys(nc)])]
  if (!ids.length) {
    console.warn('[live] 本轮 CF / 牛客 都没抓到数据(全部沿用旧值)')
    return
  }
  console.groupCollapsed(`[live] ${new Date().toLocaleString('zh-CN', { hour12: false })} 实时抓取 ${ids.length} 人`)
  for (const id of ids) {
    const name = byId[id]?.name || `#${id}`
    const c = cf[id] || {}
    const n = nc[id] || {}
    const cfPart = Object.keys(c).length
      ? `CF: rating=${c.cf_rating ?? '—'} 最高=${c.cf_max_rating ?? '—'} 总题=${c.cf_total ?? '—'} 今日=${c.cf_today ?? '—'} 近30天=${c.cf_30d ?? '—'}`
      : 'CF: 本轮未抓到(保留旧值)'
    const ncPart = Object.keys(n).length
      ? `牛客: Rating=${n.nc_rating ?? '—'} 总过题=${n.nc_total ?? '—'}`
      : '牛客: 本轮未抓到(保留旧值)'
    console.log(`  ${name} —— ${cfPart} | ${ncPart}`)
  }
  console.groupEnd()
}

onMounted(async () => {
  // 打开页面 = 先拿缓存秒开:表格立刻带数据出现,不再"空表等三方"
  try {
    members.value = await loadJson('data/members.json')
  } catch (e) {
    loadError.value = String(e.message || e)
  } finally {
    loading.value = false
  }
  loadContestCache() // 比赛区先带缓存渲染,不等抓取
  // 比赛列表独立于成员数据:即便成员缓存在效期内不重抓,这里也按自己的 TTL 补一轮
  refreshContests().catch((e) => console.warn('[live] contests:', e))
  if (!members.value.length) return

  const cached = loadCache()
  if (cached) {
    livePatch.value = cached.patch
    liveAt.value = cached.at
  }
  // 缓存还在有效期内 -> 完全不调三方;超期(或没缓存)才抓一轮
  if (Date.now() - liveAt.value > LIVE_EVERY_MS) refreshLive()
  liveTimer = setInterval(onVisible, 60 * 1000) // 每分钟看一眼是否超期
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => {
  clearInterval(liveTimer)
  document.removeEventListener('visibilitychange', onVisible)
})

const updatedText = computed(() => {
  if (liveBusy.value) return '实时更新中…'
  if (liveAt.value) return `更新于 ${new Date(liveAt.value).toLocaleString('zh-CN', { hour12: false })}`
  return '等待首轮抓取…'
})

// ---------- 顶部励志标语轮播(纯展示,不碰任何数据逻辑) ----------
const TICKER_MS = 5000
const TICKER_LINES = [
  '今天的每一发 WA,都是在给明天的 AC 攒人品。',
  'Rating 会波动,努力不会骗你。',
  '题解看懂了不算会,独立 AC 才算数。',
  '把会做的题全做对,就已经超过一半人。',
  '别怕从零开始,榜单上每个人都曾是新人。',
  '所有的一鸣惊人,都是厚积薄发。',
  '今天不肯动脑,明天赛场流泪。',
  '只做题不补题不利于成长。',
  '分数没有意义，快乐才是真谛。',
]
const tickIdx = ref(Math.floor(Math.random() * TICKER_LINES.length))
let tickTimer = null
onMounted(() => {
  tickTimer = setInterval(() => { tickIdx.value = (tickIdx.value + 1) % TICKER_LINES.length }, TICKER_MS)
})
onUnmounted(() => clearInterval(tickTimer))
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="hero-inner">
        <h1>
          <span class="logo zap zap-l">⚡</span>
          <span class="title-text">北华大学程序设计工作室<b class="title-accent">BHU-ACM</b>榜单系统</span>
          <span class="logo zap zap-r">⚡</span>
        </h1>
        <div class="stamp" :class="{ busy: liveBusy }">{{ updatedText }}</div>
        <!-- 励志标语:占 hero 底部一整行 -->
        <p class="ticker"><span class="ticker-q">“</span><Transition name="ticker-fade" mode="out-in"><span :key="tickIdx" class="ticker-line">{{ TICKER_LINES[tickIdx] }}</span></Transition><span class="ticker-q">”</span><span class="ticker-dots"><i v-for="(l, li) in TICKER_LINES" :key="li" :class="{ on: li === tickIdx }" @click="tickIdx = li" :title="l"></i></span></p>
      </div>
    </header>

    <main>
      <!-- 新生 / 老登 切换 -->
      <nav class="tabs">
        <button
          v-for="g in groups"
          :key="g.key"
          class="tab"
          :class="{ on: group === g.key }"
          @click="selectGroup(g.key)"
        >
          {{ g.label }}
          <small>{{ members.filter((m) => m.group === g.key).length }} 人</small>
        </button>
      </nav>

      <!-- 今日概览:CF 今日做题口径(数字滚动,抓取实时更新时不硬闪) -->
      <section class="summary">
        <div class="sum-card">
          <div class="sum-num"><CountUp :value="groupMembers.length" /></div>
          <div class="sum-label">{{ group === 'fresh' ? '在册新生' : '在册老登' }}</div>
        </div>
        <div class="sum-card accent">
          <div class="sum-num"><CountUp :value="todayActive.length" /></div>
          <div class="sum-label">今日Codeforces已刷题人数</div>
        </div>
        <div class="sum-card">
          <div class="sum-num"><CountUp :value="todaySum" /></div>
          <div class="sum-label">今日Codeforces合计题数</div>
        </div>
      </section>

      <!-- 今日之星:CF 今日做题数前 3,podium 大卡,冠军居中放大;点卡直达 CF 主页 -->
      <section v-if="todayStars.length" class="stars">
        <div class="stars-head">
          <span class="stars-title">🌟 今日之星</span>
          <span class="stars-sub">今日 CF 已解 <b>{{ todaySum }}</b> 题,前三合计 <b>{{ topSum }}</b> 题 —— 向 TA 们看齐!</span>
        </div>
        <div class="podium">
          <a
            v-for="(s, i) in todayStars"
            :key="s.member.id"
            class="pod"
            :class="'slot' + (i + 1)"
            :href="s.member.cf_handle ? `https://codeforces.com/profile/${s.member.cf_handle}` : null"
            target="_blank"
            rel="noopener"
            :title="`今日解 ${s.today} 题 · 点击查看 ${s.member.name} 的 Codeforces 主页`"
          >
            <span class="pod-medal">{{ ['🥇', '🥈', '🥉'][s.starRank - 1] }}</span>
            <span class="pod-name">{{ s.member.name }}</span>
            <span class="pod-class">{{ s.member.clazz }}</span>
            <span class="pod-num"><CountUp :value="s.today" /><small>题</small></span>
            <span class="pod-bar"><i :style="{ width: sharePct(s.today) + '%' }"></i></span>
            <span class="pod-share">占今日 {{ sharePct(s.today) }}%</span>
            <span class="pod-total" title="该成员 Codeforces 历史累计 AC 的不同题目数">
              CF 总过题
              <b v-if="s.stats?.cf_total != null"><CountUp :value="s.stats.cf_total" /></b>
              <b v-else class="unknown">未定级</b>
            </span>
          </a>
        </div>
      </section>
      <!-- 今日还没人刷题:激励占位,这块永远不空 -->
      <section v-else-if="!loading && groupMembers.length" class="stars empty-stars">
        <span class="empty-crown">👑</span>
        <div class="empty-text">
          <b>今日之星 · 虚位以待</b>
          <small>今天的第一个 AC,就能点亮这张卡片 —— 谁先来?</small>
        </div>
      </section>

      <!-- 近期比赛:CF 正式轮(Div.1~4 / 1+2),不含 gym;最多 5 场,其余只提醒数量 -->
      <section v-if="contests.length" class="contests">
        <div class="ctests-head">
          <span class="ctests-title">📅 近期比赛</span>
          <span class="ctests-sub">
            Codeforces 正式轮(Div.1~4 / 1+2,不含 Gym)·
            <b>{{ ratedContestCount }}</b> 场可计算 Codeforces Rating<template v-if="restCount"> · 另有 {{ restCount }} 场未列出</template>
          </span>
        </div>
        <ul class="ctests-list">
          <li v-for="c in contests" :key="c.id" class="ctest">
            <span class="ctest-phase" :class="{ live: c.phase === 'CODING', done: c.phase === 'FINISHED' }">
              {{ phaseText(c.phase) }}
            </span>
            <div class="ctest-main">
              <a class="ctest-name" :href="contestUrl(c.id)" target="_blank" rel="noopener" :title="`点击进入 Codeforces 比赛页(第 ${c.id} 场)`">
                {{ c.name }} <span class="ctest-ext">↗</span>
              </a>
              <span class="ctest-time">🕐 {{ fmtCfTime(c.startTimeSeconds) }}<template v-if="c.phase !== 'FINISHED'"> · 时长 {{ Math.round(c.durationSeconds / 3600 * 10) / 10 }}h</template></span>
              <!-- 实时倒计时:秒级跳动;24 小时内开场高亮提醒,正在打变红「距结束」 -->
              <span
                v-if="cdOf(c)"
                class="ctest-cd"
                :class="{ soon: !cdOf(c).live && cdOf(c).remain < 86400, 'cd-live': cdOf(c).live }"
                :title="cdOf(c).live ? '比赛正在进行,这是剩余时间' : '距比赛开始还有(实时倒计时)'"
              >
                <span class="cd-label">{{ cdOf(c).label }}</span>
                <b>{{ cdOf(c).value }}</b>
                <span v-if="cdOf(c).live" class="cd-note">正在进行中</span>
              </span>
            </div>
            <span class="ctest-rated" :class="ratedTag(c).cls" :title="ratedTag(c).cls === 'maybe' ? '按赛制惯例预估,CF 赛前不公布 rated 状态' : ''">
              {{ ratedTag(c).t }}
            </span>
          </li>
        </ul>
        <p v-if="restCount" class="ctest-more">
          另有 {{ restCount }} 场未展示(只保留最近 5 场,打完的超过 7 天自动移出列表)——
          <a href="https://codeforces.com/contests" target="_blank" rel="noopener">全部比赛 ↗</a>
        </p>
      </section>

      <!-- 抓取提示条:牛客代理 / CF 失败 -->
      <div v-if="ncHint || liveError" class="notice">
        <div v-if="ncHint" class="notice-line">🔌 {{ ncHint }}</div>
        <div v-if="liveError" class="notice-line">⚠️ {{ liveError }}</div>
      </div>

      <!-- 数据口径说明 -->
      <details class="rules">
        <summary>📐 各列数据怎么来的?</summary>
        <div class="rules-body">
          <ul class="rule-notes">
            <li><strong>奖牌</strong>(仅新生榜):按总分排名,前 12% 金牌、随后 24% 银牌、随后 36% 铜牌(名额向上取整);排在奖牌线之后、或完全没有数据的人显示<strong>未定级</strong>。<strong>老登榜不评奖牌</strong>,表格不显示评级列——数据仅供参考,<strong>排名不分先后</strong>。</li>
            <li><strong>CF Rating / CF 最高分</strong>:Codeforces 官方 API <code>user.info</code>,按官方段位上色。</li>
            <li><strong>CF 总做题 / CF 近30天</strong>:官方 API <code>user.status</code> 全部提交历史里,verdict=OK 的<strong>不同题目</strong>数(近30天为滚动30天窗口;同一题反复 AC 只算一道)。</li>
            <li><strong>CF 今日</strong>:北京时间今日 0 点起 AC 的不同题目数;今天还没抓到就显示<strong>未定级</strong>,绝不拿昨天的数冒充。</li>
            <li><strong>牛客 Rating</strong>:牛客 <code>rating-history</code> 接口最新一条记录的 Rating。该接口对带跨站 Origin 的请求会被 WAF 拦截,浏览器无法直连,经服务端代理(腾讯云 SCF Web 函数)获取。</li>
            <li><strong>牛客总过题</strong>:牛客个人主页官方统计「题已通过」数(按题目去重的 AC 题数,同一题反复 AC 只算一次,与 CF 总做题同口径),经代理读取,约每 10 分钟更新。</li>
            <li>数据缓存在浏览器里:打开页面先显示缓存,超过 10 分钟才自动重抓;页面开着每 10 分钟更新一轮。某人抓失败只跳过他(保留旧值),不影响别人。</li>
            <li>默认排序:新生按<strong>总分</strong>,老登按 <strong>CF 最高分</strong>(仅排列展示,不代表名次——老登榜排名不分先后);点表头可按任意列单独排序。🌟 今日之星:按当天 CF 做题数取前 3。</li>
          </ul>
        </div>
      </details>

      <div class="toolbar">
        <input
          v-model="search"
          class="search"
          type="search"
          placeholder="搜索姓名 / 班级 / 学号 / 账号…"
        />
        <select v-model="clazzFilter" class="filter">
          <option value="">全部班级</option>
          <option v-for="c in classes" :key="c" :value="c">{{ c }}</option>
        </select>
        <span class="count">共 {{ sorted.length }} 人</span>
      </div>

      <div class="score-explain">
        <b>积分总分:</b><a href="https://codeforces.com/" target="_blank">Codeforces</a> 占 75 分(当前 Rating 30% + 最高 Rating 5% + 近30天做题 10% + 总做题 30%),<a href="https://ac.nowcoder.com/" target="_blank">牛客</a> 占 25 分(Rating 10% + 总过题 15%);无数据项按 0 计。(codeforces刷题占比比重较大)
      </div>

      <!-- 老登榜:不评奖牌,只列数据 -->
      <p v-if="group === 'old'" class="no-order-tip">📌 老登榜不评奖牌，<strong>排名不分先后</strong>；下方顺序仅为当前排序列的结果。</p>

      <p v-if="loading" class="hint">加载名单…</p>
      <p v-else-if="loadError" class="hint error">
        名单加载失败:{{ loadError }}<br />请检查 public/data/members.json。
      </p>

      <RankTable
        v-else-if="!isMobile"
        :rows="sorted"
        :columns="visibleColumns"
        :levels="levels"
        :sort-key="sortKey"
        :sort-dir="sortDir"
        :show-medals="group === 'fresh'"
        @sort="onSort"
      />
      <MobileCards v-else :rows="sorted" :levels="levels" :show-medals="group === 'fresh'" />
    </main>

    <footer class="foot">
      <div class="foot-made">🛠️ 由北华大学程序设计工作室自研</div>
      数据实时抓取 + 浏览器缓存:CF 各列直连官方 API · 牛客 Rating / 总过题数经服务端代理(腾讯云 SCF)·
      名单维护:编辑 <code>public/data/members.json</code>
      <div class="foot-feedback">
        💡 如果有任何更改意见,请提交
        <a href="https://github.com/Dddddduo/Bhu-Acm-Grade/issues" target="_blank" rel="noopener">
          GitHub Issues ↗
        </a>
      </div>
      <div class="foot-repo">
        <a href="https://github.com/Dddddduo/Bhu-Acm-Grade" target="_blank" rel="noopener">
          GitHub:Dddddduo/Bhu-Acm-Grade
        </a>
        <span class="foot-copy">© BHUACM2026</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.page { max-width: 1440px; margin: 0 auto; padding: 0 20px 40px; }

.hero {
  background: linear-gradient(115deg, #16224d 0%, #2b4fae 55%, #3b6cff 100%);
  margin: 0 -16px;
  padding: 30px 0 26px;
  color: #fff;
}
.hero-inner {
  max-width: 1440px; margin: 0 auto; padding: 0 40px;
  display: grid; grid-template-columns: 1fr; justify-items: center; gap: 14px;
  position: relative;
}
/* 主标题:整行居中,加大加粗 + 金色下划线;流光艺术字 —— 渐变金在字面上来回扫 */
.hero h1 {
  font-size: 30px; font-weight: 800; letter-spacing: 1.5px;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  position: relative; padding-bottom: 10px;
}
.title-text {
  color: #fff; /* 不支持渐变裁切时的保底 */
  background: linear-gradient(100deg, #dbe7ff 0%, #ffffff 18%, #ffd97a 34%, #fff6d8 46%, #ffffff 58%, #dbe7ff 78%, #ffffff 100%);
  background-size: 220% 100%;
  animation: title-shine 5.5s ease-in-out infinite;
}
.title-accent {
  color: #ffd97a; font-weight: 900; font-style: normal; letter-spacing: 2px;
  background: linear-gradient(100deg, #f5b629 0%, #fff3c4 25%, #ffe89a 40%, #f5b629 55%, #fff3c4 75%, #f5b629 100%);
  background-size: 200% 100%;
  animation: accent-shine 2.8s linear infinite;
}
@supports (-webkit-background-clip: text) or (background-clip: text) {
  .title-text, .title-accent {
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; /* 渐变即字色;text-shadow 会透出,改用 drop-shadow */
  }
  .title-text { filter: drop-shadow(0 2px 10px rgba(0, 0, 0, 0.35)); }
  .title-accent { filter: drop-shadow(0 0 3px rgba(245, 182, 41, 0.5)); animation: accent-shine 2.8s linear infinite, accent-glow 2.8s ease-in-out infinite; }
}
@keyframes title-shine {
  0% { background-position: 120% 0; }
  55%, 100% { background-position: -80% 0; } /* 扫过去后停一拍,再回来,不晃眼 */
}
@keyframes accent-shine { to { background-position: -200% 0; } }
@keyframes accent-glow {
  0%, 100% { filter: drop-shadow(0 0 3px rgba(245, 182, 41, 0.45)); }
  50% { filter: drop-shadow(0 0 10px rgba(255, 217, 122, 0.9)); }
}
.hero h1::after {
  content: ''; position: absolute; left: 50%; transform: translateX(-50%); bottom: 0;
  width: 72px; height: 3px; border-radius: 999px;
  background: linear-gradient(90deg, transparent, #ffd97a, #f5b629, transparent);
  background-size: 200% 100%;
  animation: underline-slide 2.8s ease-in-out infinite;
}
@keyframes underline-slide { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
/* 双⚡:左右各自摆动 + 摆到顶点"来电"一亮 */
.logo { font-size: 30px; }
.zap { display: inline-block; transform-origin: top center; animation: zap-swing 2.8s ease-in-out infinite; }
.zap-r { animation-delay: 1.4s; }
@keyframes zap-swing {
  0%, 100% { transform: rotate(0deg); filter: drop-shadow(0 0 2px rgba(255, 217, 122, 0.3)); }
  12% { transform: rotate(-12deg); filter: drop-shadow(0 0 8px rgba(255, 217, 122, 0.95)); }
  24% { transform: rotate(8deg); }
  36% { transform: rotate(-4deg); filter: drop-shadow(0 0 3px rgba(255, 217, 122, 0.4)); }
  48%, 100% { transform: rotate(0deg); filter: drop-shadow(0 0 2px rgba(255, 217, 122, 0.3)); }
}
/* 减少动态:标题流光/下划线/双⚡全部静止,渐变停在最好看的一帧 */
@media (prefers-reduced-motion: reduce) {
  .title-text, .title-accent, .hero h1::after, .zap { animation: none; }
  .title-text { background-position: 34% 0; }   /* 定格:金色高光正好压在字面上 */
  .title-accent { background-position: 30% 0; filter: drop-shadow(0 0 3px rgba(245, 182, 41, 0.5)); }
  .zap { transform: none; filter: drop-shadow(0 0 2px rgba(255, 217, 122, 0.3)); }
}

/* 励志标语轮播:hero 底部独占一整行,5s 换一条,淡入淡出;小圆点可手动切换 */
.ticker {
  grid-column: 1 / -1; width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  position: relative;
  min-height: 46px; padding: 10px 120px 10px 16px;
  border-radius: 12px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.06));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
  font-size: 17px; line-height: 1.4; letter-spacing: 0.6px;
  color: #fff; text-align: center;
}
/* 左侧金色竖条,强化"标语位"的存在感 */
.ticker::before {
  content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #ffd97a, #f5b629);
}
.ticker-q { font-size: 24px; opacity: 0.5; font-family: Georgia, serif; line-height: 1; }
.ticker-line {
  font-weight: 700; letter-spacing: 0.6px;
  text-shadow: 0 1px 6px rgba(0,0,0,0.28);
}
.ticker-dots { display: inline-flex; gap: 5px; position: absolute; right: 18px; top: 50%; transform: translateY(-50%); }
.ticker-dots i {
  width: 6px; height: 6px; border-radius: 50%; cursor: pointer;
  background: rgba(255,255,255,0.35); transition: all 0.25s;
}
.ticker-dots i:hover { background: rgba(255,255,255,0.8); }
.ticker-dots i.on { background: #fff; width: 16px; border-radius: 999px; }
.ticker-fade-enter-active, .ticker-fade-leave-active { transition: opacity 0.35s ease, transform 0.35s ease; }
.ticker-fade-enter-from { opacity: 0; transform: translateY(6px); }
.ticker-fade-leave-to { opacity: 0; transform: translateY(-6px); }
.stamp {
  position: absolute; top: 0; right: 40px;
  font-size: 12px; opacity: 0.8; background: rgba(255,255,255,0.12); padding: 5px 12px; border-radius: 999px;
}
/* 抓取中:前面亮一个呼吸绿点,状态一眼可见 */
.stamp.busy { opacity: 1; }
.stamp.busy::before {
  content: ''; display: inline-block; vertical-align: 1px;
  width: 7px; height: 7px; border-radius: 50%; margin-right: 6px;
  background: #7dffa8; box-shadow: 0 0 0 0 rgba(125, 255, 168, 0.7);
  animation: stamp-pulse 1.2s ease-out infinite;
}
@keyframes stamp-pulse {
  0% { box-shadow: 0 0 0 0 rgba(125, 255, 168, 0.7); }
  100% { box-shadow: 0 0 0 7px rgba(125, 255, 168, 0); }
}

main { margin-top: -14px; position: relative; z-index: 2; }

.tabs { display: inline-flex; gap: 4px; background: rgba(255,255,255,0.6); padding: 4px; border-radius: 12px; box-shadow: var(--shadow); margin-bottom: 14px; }
.tab {
  border: none; cursor: pointer; background: transparent;
  padding: 8px 22px; border-radius: 9px; font-size: 14px; font-weight: 600;
  color: var(--muted); font-family: inherit; transition: all 0.15s;
}
.tab small { font-weight: 400; margin-left: 6px; opacity: 0.7; font-size: 12px; }
.tab:hover { color: var(--accent); }
.tab.on { background: var(--accent); color: #fff; box-shadow: 0 2px 8px rgba(59,108,255,0.35); }

.summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
.sum-card {
  background: var(--card); border-radius: 14px; padding: 16px 20px;
  box-shadow: var(--shadow); text-align: center;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.sum-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(28, 42, 90, 0.12); }
.sum-num { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sum-label { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.sum-card.accent .sum-num { color: var(--green); }

/* 今日之星:podium 大卡区,金色渐变底,冠军居中放大 */
.stars {
  position: relative; overflow: hidden;
  background:
    radial-gradient(520px 180px at 50% -40px, rgba(255, 199, 64, 0.28), transparent 70%),
    linear-gradient(135deg, #fffdf4 0%, var(--card) 55%);
  border: 1.5px solid #f0d89a;
  border-radius: 16px; padding: 16px 18px 18px;
  box-shadow: 0 6px 22px rgba(160, 106, 0, 0.10);
  margin-bottom: 14px;
}
.stars::before { /* 顶部一道流动金线,强调“领奖台”氛围 */
  content: ''; position: absolute; inset: 0 0 auto; height: 3px;
  background: linear-gradient(90deg, transparent, #f5b629 30%, #ffd97a 50%, #f5b629 70%, transparent);
}
.stars-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.stars-title { font-size: 16px; font-weight: 800; color: #8a5800; letter-spacing: 1px; }
.stars-sub { font-size: 12.5px; color: var(--muted); }
.stars-sub b { color: var(--green); font-variant-numeric: tabular-nums; }

.podium { display: grid; grid-template-columns: 1fr 1.25fr 1fr; gap: 12px; align-items: stretch; }
.pod {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  border-radius: 14px; padding: 14px 10px 12px; text-decoration: none !important;
  color: var(--text); border: 1px solid var(--line); background: var(--card);
  box-shadow: 0 2px 10px rgba(28, 42, 90, 0.06);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  position: relative;
  animation: pod-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards; /* 进场:依次上浮落位 */
}
/* 三张卡按槽位错开入场(先冠军、再左右),比齐刷刷出现更有仪式感 */
.pod.slot1 { animation-delay: 0.05s; }
.pod.slot2 { animation-delay: 0.16s; }
.pod.slot3 { animation-delay: 0.27s; }
@keyframes pod-in {
  from { opacity: 0; transform: translateY(16px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.pod:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 8px 22px rgba(28, 42, 90, 0.14); }
.pod-medal { font-size: 26px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(160,106,0,0.25)); transform-origin: top center; animation: medal-swing 3.2s ease-in-out infinite; }
@keyframes medal-swing {
  0%, 100% { transform: rotate(0deg); }
  12% { transform: rotate(-10deg); }
  24% { transform: rotate(7deg); }
  36% { transform: rotate(-4deg); }
  48% { transform: rotate(0deg); }
}
.pod-name { font-size: 15px; font-weight: 700; margin-top: 4px; }
.pod-class { font-size: 11.5px; color: var(--muted); }
.pod-num { font-size: 30px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; color: var(--green); }
.pod-num small { font-size: 12px; font-weight: 600; color: var(--muted); margin-left: 2px; }
.pod-bar { width: 78%; height: 5px; border-radius: 999px; background: #eef1f8; overflow: hidden; margin-top: 4px; }
.pod-bar i {
  display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ffd97a, #f5b629);
  transform-origin: left center; animation: bar-grow 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.45s backwards; /* 卡片落位后,占比条从 0 生长 */
}
@keyframes bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.pod-share { font-size: 11px; color: #a06a00; margin-top: 3px; font-variant-numeric: tabular-nums; }
/* CF 总过题标注:比"占今日"再沉稳一档,和今日题数区分开 */
.pod-total {
  margin-top: 6px; padding-top: 6px; font-size: 11px; color: var(--muted);
  border-top: 1px dashed #f0d89a; font-variant-numeric: tabular-nums;
}
.pod-total b { color: var(--accent); font-size: 12.5px; font-weight: 700; margin-left: 3px; }
.pod-total b.unknown { color: #b8bdd0; font-weight: 500; font-size: 11px; }
.pod.slot1 .pod-total { font-size: 12px; }
.pod.slot1 .pod-total b { font-size: 14px; }

/* 冠军居中:更大、金色描边、轻微呼吸光晕(按槽位算,并列名次也不会错位) */
.pod.slot1 {
  order: 2; border-color: #eec06a;
  background: linear-gradient(180deg, #fffaf0, var(--card) 70%);
  box-shadow: 0 4px 18px rgba(214, 158, 46, 0.22);
  animation: pod-glow 2.6s ease-in-out infinite;
}
.pod.slot1 .pod-medal { font-size: 36px; }
.pod.slot1 .pod-name { font-size: 17px; }
.pod.slot1 .pod-num { font-size: 40px; }
@keyframes pod-glow {
  0%, 100% { box-shadow: 0 4px 18px rgba(214, 158, 46, 0.22); }
  50% { box-shadow: 0 4px 26px rgba(214, 158, 46, 0.40); }
}
.pod.slot2 { order: 1; }
.pod.slot3 { order: 3; }
.pod.slot2 .pod-medal, .pod.slot3 .pod-medal { opacity: 0.92; }
/* 今天只有 1 人刷题:单卡居中,不歪在左边 */
.podium > .pod:only-child { grid-column: 1 / -1; max-width: 340px; margin: 0 auto; width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .pod.slot1 { animation: none; }
  .pod { transition: none; animation: none; }
  .pod-medal { animation: none; }
  .pod-bar i { animation: none; }
  .stamp.busy::before { animation: none; }
}

/* 还没人刷题:虚位以待 */
.empty-stars { display: flex; align-items: center; gap: 14px; padding: 18px; }
.empty-crown { font-size: 30px; filter: grayscale(0.3); opacity: 0.8; }
.empty-text { display: flex; flex-direction: column; gap: 2px; }
.empty-text b { font-size: 15px; color: #8a5800; letter-spacing: 0.5px; }
.empty-text small { font-size: 12.5px; color: var(--muted); }

/* 近期比赛 */
.contests {
  background: var(--card); border-radius: 14px; padding: 14px 18px;
  box-shadow: var(--shadow); margin-bottom: 14px;
}
.ctests-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.ctests-title { font-size: 15px; font-weight: 800; color: var(--accent); letter-spacing: 0.5px; }
.ctests-sub { font-size: 12.5px; color: var(--muted); }
.ctests-sub b { color: var(--green); }
.ctests-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ctest {
  display: grid; grid-template-columns: 76px 1fr auto; align-items: center; gap: 12px;
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px;
  background: #fbfcff;
}
.ctest-phase { font-size: 11.5px; font-weight: 600; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 3px 0; text-align: center; }
.ctest-phase.live { color: #fff; background: var(--green); animation: ctest-pulse 1.6s ease-in-out infinite; }
.ctest-phase.done { color: var(--muted); background: #eef1f8; }
@keyframes ctest-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.ctest-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ctest-name {
  font-size: 14px; font-weight: 700; color: var(--text); text-decoration: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ctest-name:hover { color: var(--accent); text-decoration: underline; }
.ctest-ext { font-size: 11px; color: var(--muted); }
.ctest-time { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* 实时倒计时:每秒跳动。tabular-nums 等宽数字,秒位翻动不抖行 */
.ctest-cd {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 4px;
  font-size: 12px; color: var(--muted);
}
.ctest-cd .cd-label {
  font-weight: 600; color: var(--accent);
  background: var(--accent-soft); border-radius: 999px; padding: 1px 8px;
}
.ctest-cd b { color: #1c2233; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.3px; }
/* 24 小时内开场:整条转橙色警示,数字微微呼吸 */
.ctest-cd.soon .cd-label { color: #b45309; background: #fff3e0; }
.ctest-cd.soon b { color: #d97706; animation: cd-breathe 1.6s ease-in-out infinite; }
/* 正在打:红色「距结束」,和进行中徽章同色系 */
.ctest-cd.cd-live .cd-label { color: #fff; background: #d92d20; }
.ctest-cd.cd-live b { color: #d92d20; }
.cd-note { font-size: 11px; color: #d92d20; font-weight: 600; }
@keyframes cd-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { .ctest-cd.soon b { animation: none; } }
.ctest-rated { font-size: 11.5px; font-weight: 600; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.ctest-rated.yes { color: var(--green); background: var(--green-soft); }
.ctest-rated.maybe { color: #8a5800; background: #fff6e0; }
.ctest-rated.no { color: var(--muted); background: #eef1f8; }
.ctest-more { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.ctest-more a { color: var(--accent); text-decoration: none; }
.ctest-more a:hover { text-decoration: underline; }
@media (prefers-reduced-motion: reduce) { .ctest-phase.live { animation: none; } }

/* 抓取提示条 */
.notice {
  background: #fff4f0; border: 1px solid #f3c9b5; border-radius: 12px;
  padding: 10px 16px; margin-bottom: 14px; font-size: 13px; color: #9a3b12;
  box-shadow: var(--shadow);
}
.notice-line + .notice-line { margin-top: 4px; }

/* 数据口径说明 */
.rules {
  background: var(--card); border-radius: 14px; padding: 0 16px;
  box-shadow: var(--shadow); margin-bottom: 14px; font-size: 13px;
}
.rules summary {
  cursor: pointer; padding: 12px 0; font-weight: 600; color: var(--accent);
  list-style: none; user-select: none;
}
.rules summary::-webkit-details-marker { display: none; }
.rules summary::after { content: ' ▾'; font-size: 11px; color: var(--muted); }
.rules[open] summary::after { content: ' ▴'; }
.rules-body { padding: 4px 0 16px; border-top: 1px dashed var(--line); }
.rule-notes { margin: 0; padding-left: 18px; color: var(--muted); line-height: 1.9; }
.rule-notes code { background: #eef1f8; padding: 1px 6px; border-radius: 4px; color: #1c2233; }

.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
.search {
  flex: 1; min-width: 220px; padding: 10px 16px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card); outline: none;
  box-shadow: var(--shadow);
}
.search:focus { border-color: var(--accent); }
.filter {
  padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px;
  background: var(--card); color: var(--text); outline: none; box-shadow: var(--shadow);
}
.count { color: var(--muted); font-size: 13px; }

.hint { padding: 40px; text-align: center; color: var(--muted); background: var(--card); border-radius: 14px; box-shadow: var(--shadow); }
.hint.error { color: #d02020; }

/* 积分口径说明:原来是裸 h4,收进卡片样式,和上方口径说明区呼应 */
.score-explain {
  background: var(--card); border-radius: 12px; padding: 11px 16px;
  box-shadow: var(--shadow); margin-bottom: 14px; font-size: 13px;
  color: var(--muted); line-height: 1.7;
}
.score-explain b { color: var(--text); }

/* 老登榜「排名不分先后」提示条 */
.no-order-tip {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 10px 16px; margin: 0 0 14px; font-size: 13px; color: var(--muted);
  box-shadow: var(--shadow); text-align: center;
}
.no-order-tip strong { color: var(--accent); }

.foot { margin-top: 22px; color: var(--muted); font-size: 12px; text-align: center; }
.foot-made {
  display: inline-block; margin-bottom: 10px; padding: 5px 16px;
  border-radius: 999px; font-size: 12.5px; font-weight: 600; letter-spacing: 0.5px;
  color: var(--accent); background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px rgba(59, 108, 255, 0.18);
}
.foot code { background: #e4e9f4; padding: 1px 6px; border-radius: 4px; }
/* 反馈入口:页脚里最醒目的一行,引导提 issue */
.foot-feedback {
  margin-top: 10px; font-size: 12.5px; color: var(--text);
}
.foot-feedback a {
  color: var(--accent); font-weight: 700; text-decoration: none;
  border-bottom: 1px dashed var(--accent);
}
.foot-feedback a:hover { text-decoration: none; border-bottom-style: solid; }
.foot-repo { margin-top: 8px; display: flex; justify-content: center; align-items: center; gap: 14px; flex-wrap: wrap; }
.foot-repo a { color: var(--accent); text-decoration: none; }
.foot-repo a:hover { text-decoration: underline; }
.foot-copy { color: #a5abc0; letter-spacing: 0.5px; }

@media (max-width: 640px) {
  .hero-inner { padding: 0 20px; }
  .hero h1 { font-size: 20px; letter-spacing: 0.5px; gap: 8px; }
  .logo { font-size: 20px; }
  .hero h1::after { width: 52px; }
  /* 窄屏标题占满宽度,时间胶囊改回正常流居中,避免压住标题 */
  .stamp { position: static; }
  /* 标语条:窄屏仍占整行,字号收小、圆点移到文字下方 */
  .ticker { font-size: 14px; letter-spacing: 0.3px; padding: 9px 10px; flex-direction: column; gap: 6px; min-height: 0; }
  .ticker-q { display: none; }
  .ticker-dots { position: static; transform: none; }
  .summary { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .sum-card { padding: 12px 8px; }
  .sum-num { font-size: 20px; }
  .sum-label { font-size: 11.5px; }
  .toolbar { gap: 8px; }
  .search { min-width: 0; flex-basis: 100%; }
  .count { width: 100%; }
  .tab { padding: 8px 16px; }
  /* 今日之星:窄屏保持三列领奖台,整体缩小一档 */
  .stars { padding: 12px 10px 14px; }
  .stars-head { margin-bottom: 10px; gap: 8px; }
  .stars-title { font-size: 14px; }
  .stars-sub { font-size: 11.5px; }
  .podium { gap: 8px; }
  .pod { padding: 10px 4px 9px; }
  .pod-medal { font-size: 20px; }
  .pod.slot1 .pod-medal { font-size: 27px; }
  .pod-name { font-size: 13px; }
  .pod.slot1 .pod-name { font-size: 14.5px; }
  .pod-class { display: none; }
  .pod-num { font-size: 22px; }
  .pod.slot1 .pod-num { font-size: 28px; }
  .pod-bar { width: 88%; }
  .empty-stars { padding: 14px; }
  .empty-crown { font-size: 24px; }
  /* 近期比赛:窄屏两行排版,徽章与计分标签各就各位 */
  .contests { padding: 12px; }
  .ctests-head { margin-bottom: 8px; gap: 6px; }
  .ctests-title { font-size: 13.5px; }
  .ctests-sub { font-size: 11px; }
  .ctest { grid-template-columns: 62px 1fr; gap: 8px; padding: 8px 10px; }
  .ctest-rated { grid-column: 2; justify-self: start; }
  .ctest-name { font-size: 13px; }
  .ctest-time { font-size: 11px; }
}
</style>

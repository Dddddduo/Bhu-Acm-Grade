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
import { COLUMNS } from './columns.js'
import { fetchCfLive } from './liveCf.js'
import { fetchNcLive } from './liveNc.js'
import { computeScore, assignLevels } from './score.js'

const LIVE_EVERY_MS = 30 * 60 * 1000 // 每 30 分钟自动抓一轮(缓存在这之内直接复用,不重抓)
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

// ---------- 浏览器端定时抓取(30 分钟一轮 + localStorage 缓存) ----------
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
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="hero-inner">
        <div>
          <h1>
            <span class="logo">⚡</span>
            BUH ACM 程序设计工作室
          </h1>
          <p class="sub">竞赛成绩榜 · 一起卷,一起变强</p>
        </div>
        <div class="stamp">{{ updatedText }}</div>
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

      <!-- 今日概览:CF 今日做题口径 -->
      <section class="summary">
        <div class="sum-card">
          <div class="sum-num">{{ groupMembers.length }}</div>
          <div class="sum-label">{{ group === 'fresh' ? '在册新生' : '在册老登' }}</div>
        </div>
        <div class="sum-card accent">
          <div class="sum-num">{{ todayActive.length }}</div>
          <div class="sum-label">今日已刷题(CF)</div>
        </div>
        <div class="sum-card">
          <div class="sum-num">{{ todaySum }}</div>
          <div class="sum-label">今日合计题数</div>
        </div>
      </section>

      <!-- 今日之星:CF 今日做题数前 3 -->
      <div v-if="todayStars.length" class="star-strip">
        <span class="strip-tag">🌟 今日之星 TOP{{ todayStars.length }}</span>
        <span v-for="s in todayStars" :key="s.member.id" class="star-chip">
          <em>{{ ['🥇', '🥈', '🥉'][s.starRank - 1] }}</em>
          {{ s.member.name }}
          <b>{{ s.today }}</b> 题
        </span>
      </div>

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
            <li>数据缓存在浏览器里:打开页面先显示缓存,超过 30 分钟才自动重抓;页面开着每 30 分钟更新一轮。某人抓失败只跳过他(保留旧值),不影响别人。</li>
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

      <h4><strong>积分总分：</strong><a href="https://codeforces.com/" target="_blank">Codeforces</a>占75分(当前Rating30%+最高Rating5%+近30天做题10%+总做题30%)，<a href="https://ac.nowcoder.com/" target="_blank">牛客</a>占25分(Rating10%+总过题15%)；无数据项按0计。</h4>

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
      数据实时抓取 + 浏览器缓存:CF 各列直连官方 API · 牛客 Rating / 总过题数经服务端代理(腾讯云 SCF)·
      名单维护:编辑 <code>public/data/members.json</code>
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
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap;
}
.hero h1 { font-size: 24px; font-weight: 700; letter-spacing: 0.5px; display: flex; align-items: center; gap: 10px; }
.logo { font-size: 26px; }
.hero .sub { margin-top: 6px; font-size: 13px; opacity: 0.75; }
.stamp { font-size: 12px; opacity: 0.8; background: rgba(255,255,255,0.12); padding: 5px 12px; border-radius: 999px; }

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
}
.sum-num { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sum-label { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.sum-card.accent .sum-num { color: var(--green); }

/* 今日之星 TOP3 */
.star-strip {
  background: linear-gradient(100deg, #fff8e6, var(--card) 60%);
  border: 1px solid #f2dfae;
  border-radius: 14px; padding: 12px 16px;
  box-shadow: var(--shadow); margin-bottom: 14px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.star-strip .strip-tag { font-size: 12px; font-weight: 700; color: #a06a00; margin-right: 4px; }
.star-chip {
  background: var(--card); border: 1px solid #ecd9a0;
  border-radius: 999px; padding: 5px 14px; font-size: 13.5px;
  display: inline-flex; align-items: center; gap: 6px;
}
.star-chip em { font-style: normal; font-size: 15px; }
.star-chip b { color: var(--green); }

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

/* 老登榜「排名不分先后」提示条 */
.no-order-tip {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 10px 16px; margin: 0 0 14px; font-size: 13px; color: var(--muted);
  box-shadow: var(--shadow); text-align: center;
}
.no-order-tip strong { color: var(--accent); }

.foot { margin-top: 22px; color: var(--muted); font-size: 12px; text-align: center; }
.foot code { background: #e4e9f4; padding: 1px 6px; border-radius: 4px; }
.foot-repo { margin-top: 8px; display: flex; justify-content: center; align-items: center; gap: 14px; flex-wrap: wrap; }
.foot-repo a { color: var(--accent); text-decoration: none; }
.foot-repo a:hover { text-decoration: underline; }
.foot-copy { color: #a5abc0; letter-spacing: 0.5px; }

@media (max-width: 640px) {
  .hero-inner { padding: 0 20px; }
  .hero h1 { font-size: 19px; }
  .summary { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .sum-card { padding: 12px 8px; }
  .sum-num { font-size: 20px; }
  .sum-label { font-size: 11.5px; }
  .toolbar { gap: 8px; }
  .search { min-width: 0; flex-basis: 100%; }
  .count { width: 100%; }
  .tab { padding: 8px 16px; }
}
</style>

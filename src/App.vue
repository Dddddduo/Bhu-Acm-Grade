<script setup>
// 主页面:加载 members.json + stats.json(仓库快照打底),
// 再在浏览器里定时直连刷新:CF 官方 API + 牛客渲染页(均允许跨域,实测)。
// 不落盘,只更内存数组;今日/近30天这类仍需脚本采集的字段以快照为准。
import { ref, computed, onMounted, onUnmounted } from 'vue'
import RankTable from './components/RankTable.vue'
import MobileCards from './components/MobileCards.vue'
import { COLUMNS } from './columns.js'
import { weightedScore, rowValue, WEIGHTS, RATING_UNIT, SOLVED_UNIT } from './score.js'
import { fetchCfLive } from './liveCf.js'
import { fetchNcLive } from './liveNc.js'

const LIVE_EVERY_MS = 5 * 60 * 1000 // 每 5 分钟一轮:重读快照 + 实时抓 CF/牛客

// 规则说明里的权重条
const RULE_LIST = [
  { key: 'nc_rating', label: '牛客 Rating', pct: WEIGHTS.nc_rating * 100, cls: 'bar-nc' },
  { key: 'nc_solved', label: '牛客 刷题数', pct: WEIGHTS.nc_solved * 100, cls: 'bar-nc' },
  { key: 'cf_rating', label: 'CF Rating', pct: WEIGHTS.cf_rating * 100, cls: 'bar-cf' },
  { key: 'cf_total', label: 'CF 刷题数', pct: WEIGHTS.cf_total * 100, cls: 'bar-cf' },
]

const members = ref([])
const stats = ref({ updated_at: null, users: {} })
const loading = ref(true)
const loadError = ref('')

// 浏览器实时抓取的最新值:{ 成员id: 补丁字段 } —— 不落盘,关掉页面就没了
const livePatch = ref({})
// 最近一次实时抓取完成时间:**数字时间戳(Date.now())**
// 曾有坑:这里存 toLocaleString 字符串,Chrome 中文下是 "2026/10/19 21:16:30",
// replace(' ','T') 后 new Date() 解析成 NaN -> 超期判断永远 false -> 页面再也不自动刷
const liveAt = ref(0)
const liveBusy = ref(false) // 正在抓取
const liveError = ref('') // 最近一次抓取失败原因(成功则清空)

const search = ref('')
const clazzFilter = ref('')
const group = ref('fresh') // 新生 / 老登分开看
// 默认排序:新生看综合得分,老登看 CF 最高分(毕业后当前分会掉,最高分才是真实力)
const sortKey = ref('score')
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

// 窄屏换卡片视图,表格不用左右划
const isMobile = ref(typeof window !== 'undefined' && window.innerWidth < 760)
function onResize() {
  isMobile.value = window.innerWidth < 760
}
onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

// 老登榜不显示综合得分(默认按 CF 最高分排);新生榜照常显示
const visibleColumns = computed(() =>
  COLUMNS.filter((c) => !c.hidden && !(group.value === 'old' && c.key === 'score'))
)

const groups = [
  { key: 'fresh', label: '新生' },
  { key: 'old', label: '老登' },
]

const classes = computed(() =>
  [...new Set(groupMembers.value.map((m) => m.clazz).filter(Boolean))].sort()
)

// 当前分组名单
const groupMembers = computed(() => members.value.filter((m) => m.group === group.value))

// 名单 + 成绩合并:仓库快照打底,浏览器实时抓到的字段(livePatch)覆盖同名项
// score = 综合得分(牛客Rating20%+刷题10%,CF Rating40%+刷题30%)
// "今日"列按日期口径显示:cf_date / nc_date 不是今天的,当没数据(—),
// 绝不把昨天的数字挂成今天的(宁缺勿假)
function bjDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}
const joined = computed(() => {
  const users = stats.value.users || {}
  const live = livePatch.value
  const todayStr = bjDate()
  return groupMembers.value.map((m) => {
    const id = String(m.id)
    const snap = users[id]
    const patch = live[id]
    let st = patch ? { ...(snap || {}), ...patch } : snap || null
    if (st) {
      if (st.cf_date !== todayStr && 'cf_today' in st) st = { ...st, cf_today: null }
      if (st.nc_date !== todayStr && 'nc_today' in st) st = { ...st, nc_today: null }
    }
    return { member: m, stats: st, score: weightedScore(st, m.group) }
  })
})

// 今日概览:CF + 牛客 两平台合计
function todayOf(r) {
  return (r.stats?.cf_today ?? 0) + (r.stats?.nc_today ?? 0)
}
const todayActive = computed(() => joined.value.filter((r) => todayOf(r) > 0))
const todaySum = computed(() => joined.value.reduce((s, r) => s + todayOf(r), 0))

// 今日之星:按今日两平台合计做题数取前三(并列同名次,后面顺延)
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

// ---------- 浏览器端定时抓取(约每 5 分钟一轮) ----------
// 一轮干三件事:
//  1) 重读仓库快照 stats.json -> 今日/近30天这类仍需脚本采集的字段跟着换新
//     (维护者 push 后开着的页面最多 5 分钟就更新,不用手动刷新浏览器)
//  2) CF 官方 API 允许跨域(实测 access-control-allow-origin: *)-> 直连实时抓;
//  3) 牛客页面同样允许跨域(实测 ACAO 回显来源)且是服务端渲染 HTML ->
//     直连实时抓 Rating / 总过题数(见 liveNc.js);
//     任何一个人抓失败就跳过,保留旧值,绝不清空。
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
  try {
    // 先重读仓库快照:维护者 push 新 stats.json 后,开着的页面不用刷新,
    // 快照类数据最多 5 分钟也会跟着换新
    const st = await loadJson('data/stats.json').catch(() => null)
    if (st && st.users) stats.value = st
    // CF 与牛客两家并发抓:各自内部有自己的限速闸门,互不干扰
    const [cf, nc] = await Promise.all([
      fetchCfLive(members.value).catch((e) => {
        console.warn('[live] CF:', e)
        liveError.value = 'CF 实时获取失败'
        return {}
      }),
      fetchNcLive(members.value).catch((e) => {
        console.warn('[live] 牛客:', e)
        liveError.value = liveError.value ? liveError.value + ' / 牛客实时获取失败' : '牛客实时获取失败'
        return {}
      }),
    ])
    const patch = { ...livePatch.value }
    for (const [id, rec] of Object.entries(cf)) {
      patch[id] = { ...(patch[id] || {}), ...rec }
    }
    for (const [id, rec] of Object.entries(nc)) {
      patch[id] = { ...(patch[id] || {}), ...rec }
    }
    livePatch.value = patch
    if (Object.keys(cf).length || Object.keys(nc).length) {
      liveAt.value = Date.now()
    }
    logLive(cf, nc)
  } catch (e) {
    liveError.value = liveError.value || '实时获取失败'
    console.warn('[live]', e)
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
      ? `CF: rating=${c.cf_rating ?? '—'} 最高=${c.cf_max_rating ?? '—'} 今日=${c.cf_today ?? '—'} 近30天=${c.cf_30d ?? '—'}`
      : 'CF: 本轮未抓到(保留旧值)'
    const ncPart = Object.keys(n).length
      ? `牛客: Rating=${n.nc_rating ?? '—'} 排名=${n.nc_rank ?? '—'} 已通过=${n.nc_solved ?? '—'}`
      : '牛客: 本轮未抓到(保留旧值)'
    console.log(`  ${name} —— ${cfPart} | ${ncPart}`)
  }
  console.log('  合并后的实时 patch:', livePatch.value)
  console.groupEnd()
}

onMounted(async () => {
  try {
    const [ms, st] = await Promise.all([
      loadJson('data/members.json'),
      loadJson('data/stats.json').catch(() => ({ updated_at: null, users: {} })),
    ])
    members.value = ms
    stats.value = st
  } catch (e) {
    loadError.value = String(e.message || e)
  } finally {
    loading.value = false
  }
  // 定时任务在这里:打开页面就刷一轮(快照+CF),之后约每 5 分钟一轮
  // (页面隐藏时不发请求,切回来发现超期立刻补刷)
  refreshLive()
  liveTimer = setInterval(onVisible, 60 * 1000) // 每分钟看一眼是否超期
  document.addEventListener('visibilitychange', onVisible)
})
onUnmounted(() => {
  clearInterval(liveTimer)
  document.removeEventListener('visibilitychange', onVisible)
})

const updatedText = computed(() => {
  const snap = stats.value.updated_at ? `快照 ${stats.value.updated_at}` : '尚无快照'
  let live = ''
  if (liveBusy.value) live = ' · 实时抓取中…'
  else if (liveAt.value)
    live = ` · 实时 ${new Date(liveAt.value).toLocaleString('zh-CN', { hour12: false })}`
  else if (liveError.value) live = ` · ${liveError.value}(显示快照)`
  return snap + live
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

      <!-- 今日概览 -->
      <section class="summary">
        <div class="sum-card">
          <div class="sum-num">{{ groupMembers.length }}</div>
          <div class="sum-label">{{ group === 'fresh' ? '在册新生' : '在册老登' }}</div>
        </div>
        <div class="sum-card accent">
          <div class="sum-num">{{ todayActive.length }}</div>
          <div class="sum-label">今日已刷题</div>
        </div>
        <div class="sum-card">
          <div class="sum-num">{{ todaySum }}</div>
          <div class="sum-label">今日合计题数</div>
        </div>
      </section>

      <!-- 今日之星:两平台今日合计做题数前 3 -->
      <div v-if="todayStars.length" class="star-strip">
        <span class="strip-tag">🌟 今日之星 TOP{{ todayStars.length }}</span>
        <span v-for="s in todayStars" :key="s.member.id" class="star-chip">
          <em>{{ ['🥇', '🥈', '🥉'][s.starRank - 1] }}</em>
          {{ s.member.name }}
          <b>{{ s.today }}</b> 题
          <small>(CF {{ s.stats?.cf_today ?? 0 }} · 牛客 {{ s.stats?.nc_today ?? 0 }})</small>
        </span>
      </div>

      <!-- 综合得分规则说明 -->
      <details class="rules">
        <summary>📐 综合得分怎么算?</summary>
        <div class="rules-body">
          <div class="rule-bars">
            <div class="rule-bar" v-for="w in RULE_LIST" :key="w.key">
              <span class="rb-label">{{ w.label }}</span>
              <span class="rb-track"><i :style="{ width: w.pct + '%' }" :class="w.cls" /></span>
              <span class="rb-pct">{{ Math.round(w.pct) }}%</span>
            </div>
          </div>
          <ul class="rule-notes">
            <li>
              Rating 分 = <code>Rating ÷ {{ RATING_UNIT }}</code>,不设上限,
              2400 分约折成 100 分,再高继续累计。
            </li>
            <li>
              刷题分 = <code>已通过题数 ÷ {{ SOLVED_UNIT }}</code>,不设上限,
              多刷多得,继续累计。
            </li>
            <li>四个维度按权重相加即综合分,没有账号 / 没数据 = 该维度 0 分(权重不挪给别的维度)。</li>
            <li>老登榜不显示综合得分,默认按<strong>「CF 最高分」</strong>排序(毕业/长期不打当前分会掉,最高分才是真实力);新生榜显示综合分,按当前分默认综合分排。</li>
            <li>榜单默认按综合分从高到低;点表头可以按任意一列单独排序。</li>
            <li>🌟 今日之星:按当天 <code>CF 今日 + 牛客 今日</code> 合计做题数取前 3,随每次刷新自动更新。</li>
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

      <p v-if="loading" class="hint">加载中…</p>
      <p v-else-if="loadError" class="hint error">
        数据加载失败:{{ loadError }}<br />请先运行 npm run refresh 生成成绩数据。
      </p>

      <RankTable
        v-else-if="!isMobile"
        :rows="sorted"
        :columns="visibleColumns"
        :sort-key="sortKey"
        :sort-dir="sortDir"
        @sort="onSort"
      />
      <MobileCards v-else :rows="sorted" :show-score="group !== 'old'" />
    </main>

    <footer class="foot">
      数据约每 5 分钟自动刷新:CF Rating/今日 · 牛客 Rating/总过题 浏览器实时抓取 ·
      其余以仓库快照为准 ·
      名单维护:编辑 <code>public/data/members.json</code>
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
.star-chip small { color: var(--muted); font-size: 11.5px; }

/* 综合得分规则说明 */
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
.rule-bars { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 20px; margin: 12px 0; }
.rule-bar { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.rb-label { width: 96px; color: var(--muted); flex: none; }
.rb-track { flex: 1; height: 10px; border-radius: 999px; background: #eef1f8; overflow: hidden; }
.rb-track i { display: block; height: 100%; border-radius: 999px; }
.bar-nc { background: #2fa858; }
.bar-cf { background: var(--accent); }
.rb-pct { width: 38px; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.rule-notes { margin: 0; padding-left: 18px; color: var(--muted); line-height: 1.8; }
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

.foot { margin-top: 22px; color: var(--muted); font-size: 12px; text-align: center; }
.foot code { background: #e4e9f4; padding: 1px 6px; border-radius: 4px; }

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

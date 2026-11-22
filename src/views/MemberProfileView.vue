<script setup>
import { computed, onMounted, ref } from 'vue'
import { fetchUserRating, ratingDelta } from '../cfApi.js'

const props = defineProps({ member: { type: Object, required: true }, stats: { type: Object, default: () => ({}) } })
const history = ref([])
const loading = ref(false)
const error = ref('')
const cached = ref(false)

const rating = computed(() => props.stats.cf_rating || history.value.at(-1)?.newRating || 0)
const maxRating = computed(() => props.stats.cf_max_rating || Math.max(0, ...history.value.map((item) => item.newRating)))
const ratingChange = computed(() => history.value.length ? ratingDelta(history.value) : 0)
const recentContests = computed(() => [...history.value].reverse().slice(0, 6))
const bestContest = computed(() => history.value.length ? [...history.value].sort((a, b) => a.rank - b.rank)[0] : null)
const chartPoints = computed(() => {
  if (!history.value.length) return ''
  const values = history.value.slice(-18).map((item) => item.newRating)
  const min = Math.min(...values, 800); const max = Math.max(...values, 1800); const span = Math.max(1, max - min)
  return values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${100 - ((value - min) / span) * 82 - 9}`).join(' ')
})
const chartDots = computed(() => chartPoints.value.split(' ').filter(Boolean).map((point, index) => ({ point, index })))
const rankPercentile = computed(() => bestContest.value ? Math.max(1, Math.round((1 - bestContest.value.rank / Math.max(bestContest.value.rank, 10000)) * 100)) : 0)

async function loadHistory() {
  if (!props.member.cf_handle) { error.value = '该成员尚未绑定 Codeforces Handle'; return }
  loading.value = true; error.value = ''
  try {
    const result = await fetchUserRating(props.member.cf_handle)
    history.value = result.data; cached.value = result.cached
  } catch (e) { error.value = e.message || 'Rating 历史暂时不可用' } finally { loading.value = false }
}
function formatDate(seconds) { return new Date(seconds * 1000).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) }
function formatChange(item) { return item.newRating - item.oldRating }
function ratingClass(value) { return value >= 1900 ? 'master' : value >= 1600 ? 'expert' : value >= 1400 ? 'specialist' : value >= 1200 ? 'pupil' : 'newbie' }

onMounted(loadHistory)
</script>

<template>
  <section class="profile-view">
    <button class="profile-back" @click="$emit('back')">← 返回成员榜单</button>
    <section class="profile-hero">
      <div class="profile-identity"><div class="profile-avatar">{{ member.name?.slice(0, 1) }}</div><div><span class="profile-kicker">PLAYER PROFILE / {{ String(member.id).padStart(2, '0') }}</span><h2>{{ member.name }}</h2><p>{{ member.cf_handle || 'NO CODEFORCES HANDLE' }} <span v-if="member.clazz">· {{ member.clazz }}</span></p></div></div>
      <a v-if="member.cf_handle" class="profile-external" :href="`https://codeforces.com/profile/${member.cf_handle}`" target="_blank" rel="noopener">OPEN CODEFORCES ↗</a>
    </section>
    <div class="profile-stats"><article><span>CURRENT RATING</span><strong :class="ratingClass(rating)">{{ rating || '—' }}</strong><small>{{ props.stats.cf_rank || '等待官方数据' }}</small></article><article><span>PEAK RATING</span><strong>{{ maxRating || '—' }}</strong><small>历史最高段位</small></article><article><span>RATING CHANGE</span><strong :class="ratingChange >= 0 ? 'positive' : 'negative'">{{ ratingChange > 0 ? '+' : '' }}{{ ratingChange || '—' }}</strong><small>从首场比赛开始</small></article><article><span>TOTAL SOLVED</span><strong>{{ stats.cf_total ?? '—' }}</strong><small>不同题目 AC</small></article></div>
    <div class="profile-grid"><article class="profile-panel chart-panel"><div class="profile-panel-head"><div><span class="profile-kicker">PERFORMANCE TRACE</span><h3>Rating 轨迹</h3></div><span v-if="cached" class="cache-tag">CACHED DATA</span></div><div v-if="chartPoints" class="rating-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Rating 历史曲线"><defs><linearGradient id="profile-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d9ff3f" stop-opacity=".32"/><stop offset="1" stop-color="#d9ff3f" stop-opacity="0"/></linearGradient></defs><polygon :points="`0,100 ${chartPoints} 100,100`" fill="url(#profile-fill)"/><polyline :points="chartPoints" fill="none" stroke="#d9ff3f" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg><div class="chart-labels"><span>{{ history.length ? formatDate(history[Math.max(0, history.length - 18)].ratingUpdateTimeSeconds) : '' }}</span><span>{{ history.length ? formatDate(history.at(-1).ratingUpdateTimeSeconds) : '' }}</span></div></div><div v-else class="profile-empty">{{ loading ? '正在从 Codeforces 拉取 Rating 历史…' : error }}</div></article><article class="profile-panel signal-panel"><div class="profile-panel-head"><div><span class="profile-kicker">TRAINING SIGNALS</span><h3>竞赛信号</h3></div></div><div class="signal-row"><span>参赛场次</span><strong>{{ history.length || '—' }}</strong></div><div class="signal-row"><span>最佳名次</span><strong>{{ bestContest?.rank || '—' }}</strong></div><div class="signal-row"><span>最佳比赛</span><strong class="signal-name">{{ bestContest?.contestName || '—' }}</strong></div><div class="signal-row"><span>历史涨幅</span><strong class="positive">{{ ratingChange > 0 ? '+' : '' }}{{ ratingChange || '—' }}</strong></div></article></div>
    <section class="recent-section"><div class="section-heading"><div><span class="profile-kicker">CONTEST LOG</span><h3>最近比赛记录</h3></div><span>{{ history.length }} RECORDS</span></div><div v-if="recentContests.length" class="contest-log"><div v-for="item in recentContests" :key="`${item.contestId}-${item.ratingUpdateTimeSeconds}`" class="contest-log-row"><span class="log-date">{{ formatDate(item.ratingUpdateTimeSeconds) }}</span><div class="log-main"><strong>{{ item.contestName }}</strong><small>RANK {{ item.rank }}</small></div><span class="log-rating">{{ item.newRating }}</span><span class="log-change" :class="formatChange(item) >= 0 ? 'positive' : 'negative'">{{ formatChange(item) > 0 ? '+' : '' }}{{ formatChange(item) }}</span></div></div><div v-else class="profile-empty">{{ loading ? '同步比赛记录中…' : error || '暂无比赛记录' }}</div></section>
  </section>
</template>

<style scoped>
.profile-view { max-width: 1280px; margin: 0 auto; padding: 30px 0 60px; }.profile-back { border: 0; background: none; color: var(--command-muted); font: 11px monospace; padding: 0; margin-bottom: 30px; }.profile-back:hover { color: var(--command-accent); }.profile-hero { display: flex; justify-content: space-between; align-items: center; padding: 30px 0 36px; border-bottom: 1px solid var(--command-line); }.profile-identity { display: flex; align-items: center; gap: 20px; }.profile-avatar { width: 76px; height: 76px; display: grid; place-items: center; background: var(--command-accent); color: #101114; font-size: 35px; font-weight: 900; }.profile-kicker { color: var(--command-muted); font: 9px monospace; letter-spacing: 1.6px; }.profile-hero h2 { margin: 10px 0 7px; font-size: 38px; letter-spacing: -1.5px; }.profile-hero p { color: var(--command-muted); font: 11px monospace; }.profile-external { color: var(--command-accent); font: 10px monospace; }.profile-stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--command-line); }.profile-stats article { min-height: 135px; padding: 24px; border-right: 1px solid var(--command-line); }.profile-stats article:last-child { border-right: 0; }.profile-stats span { color: var(--command-muted); font: 9px monospace; letter-spacing: 1px; }.profile-stats strong { display: block; margin: 17px 0 5px; font: 700 31px monospace; }.profile-stats strong.specialist,.profile-stats strong.expert,.profile-stats strong.master { color: var(--command-accent); }.profile-stats small { color: var(--command-muted); font-size: 10px; }.positive { color: var(--command-green) !important; }.negative { color: #ff7568 !important; }.profile-grid { display: grid; grid-template-columns: 1.4fr .6fr; gap: 1px; background: var(--command-line); border-bottom: 1px solid var(--command-line); }.profile-panel { min-height: 315px; padding: 28px 25px; background: var(--command-bg); }.profile-panel-head,.section-heading { display: flex; justify-content: space-between; align-items: flex-start; }.profile-panel h3,.section-heading h3 { margin-top: 8px; font-size: 19px; }.cache-tag,.section-heading > span { color: var(--command-muted); font: 9px monospace; }.rating-chart { height: 220px; margin-top: 29px; padding: 14px 0 0; background: repeating-linear-gradient(to bottom, transparent 0 49px, var(--command-line) 50px); }.rating-chart svg { width: 100%; height: 185px; overflow: visible; }.chart-labels { display: flex; justify-content: space-between; color: var(--command-muted); font: 9px monospace; }.profile-empty { min-height: 190px; display: grid; place-items: center; color: var(--command-muted); text-align: center; font-size: 12px; }.signal-panel { background: var(--command-panel); }.signal-row { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 18px 0; border-bottom: 1px solid var(--command-line); color: var(--command-muted); font-size: 11px; }.signal-row strong { max-width: 180px; color: var(--command-text); font: 700 17px monospace; text-align: right; }.signal-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px !important; }.recent-section { padding: 30px 0; }.contest-log { margin-top: 23px; border-top: 1px solid var(--command-line); }.contest-log-row { min-height: 64px; display: grid; grid-template-columns: 100px 1fr 80px 70px; align-items: center; gap: 15px; border-bottom: 1px solid var(--command-line); }.log-date,.log-main small { color: var(--command-muted); font: 10px monospace; }.log-main strong,.log-main small { display: block; }.log-main strong { font-size: 12px; }.log-main small { margin-top: 5px; font-size: 9px; }.log-rating,.log-change { font: 700 14px monospace; }.log-rating { text-align: right; }.log-change { text-align: right; }
@media (max-width: 720px) { .profile-view { padding-top: 22px; }.profile-hero { display: block; }.profile-external { display: inline-block; margin: 24px 0 0 96px; }.profile-hero h2 { font-size: 32px; }.profile-stats { grid-template-columns: 1fr 1fr; }.profile-stats article:nth-child(2) { border-right: 0; }.profile-stats article:nth-child(-n+2) { border-bottom: 1px solid var(--command-line); }.profile-grid { display: block; }.profile-panel { min-height: 280px; }.contest-log-row { grid-template-columns: 65px 1fr 55px; gap: 8px; }.log-change { display: none; } }
</style>

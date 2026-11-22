<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { fetchContestStandings, ratedGuess } from '../liveCf.js'

const props = defineProps({
  contests: { type: Array, default: () => [] },
  members: { type: Array, default: () => [] },
})

const selectedId = ref(null)
const currentPage = ref(1)
const PAGE_SIZE = 6
const standings = ref(null)
const loading = ref(false)
const error = ref('')
const now = ref(Date.now())
let timer

const upcomingContests = computed(() => props.contests
  .filter((contest) => contest.phase === 'BEFORE')
  .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds))
const liveContests = computed(() => props.contests
  .filter((contest) => ['CODING', 'PENDING_SYSTEM_TEST', 'SYSTEM_TEST'].includes(contest.phase))
  .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds))
const finishedContests = computed(() => props.contests
  .filter((contest) => contest.phase === 'FINISHED')
  .sort((a, b) => b.startTimeSeconds - a.startTimeSeconds))
const pageCount = computed(() => Math.max(1, Math.ceil(finishedContests.value.length / PAGE_SIZE)))
const pagedFinishedContests = computed(() => finishedContests.value.slice((currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE))
const selectedContest = computed(() => finishedContests.value.find((contest) => contest.id === selectedId.value))
const memberRows = computed(() => {
  const standingsByHandle = new Map()
  for (const row of standings.value?.rows || []) {
    for (const person of row.party?.members || []) standingsByHandle.set(person.handle.trim().toLowerCase(), row)
  }
  const ratingChanges = standings.value?.ratingChanges || []
  const ratingByHandle = new Map(ratingChanges.map((item) => [item.handle.trim().toLowerCase(), item]))
  return props.members.map((member) => {
    const handle = member.cf_handle?.trim().toLowerCase()
    const row = handle ? standingsByHandle.get(handle) || null : null
    const rating = handle ? ratingByHandle.get(handle) || null : null
    return { member, row, rating, ratedOnly: !row && !!rating }
  })
})
const participatingRows = computed(() => [...memberRows.value.filter((item) => item.row || item.ratedOnly)].sort((a, b) => {
  const rankA = a.row?.rank ?? a.rating?.rank ?? Number.POSITIVE_INFINITY
  const rankB = b.row?.rank ?? b.rating?.rank ?? Number.POSITIVE_INFINITY
  return rankA - rankB
}))
const problemStats = computed(() => [])

function difficultyOf(contest) {
  const division = contest.name.match(/Div\. ?([1-4])/i)?.[1]
  if (division) return `Div.${division}`
  if (contest.type === 'IOI') return 'IOI'
  if (contest.type === 'ICPC') return 'ICPC'
  if (/educational/i.test(contest.name)) return 'Educational'
  return '常规赛'
}
function remainOf(contest) {
  const start = contest.startTimeSeconds * 1000
  const end = start + contest.durationSeconds * 1000
  const remaining = contest.phase === 'BEFORE' ? start - now.value : end - now.value
  if (remaining <= 0) return contest.phase === 'BEFORE' ? '即将开始' : '比赛即将结束'
  const total = Math.floor(remaining / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${days ? `${days}天 ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
function formatDate(seconds) {
  return new Date(seconds * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function officialUrl(contest) { return `https://codeforces.com/contest/${contest.id}` }
function problemsetUrl(contest) { return `https://codeforces.com/contest/${contest.id}/problems` }
function problemUrl(problem) {
  return problem.contestId ? `https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}` : 'https://codeforces.com/problemsets'
}
function memberUrl(item) { return item.member.cf_handle ? `https://codeforces.com/profile/${encodeURIComponent(item.member.cf_handle)}` : '#' }
function contestClass(contest) {
  return contest.phase === 'FINISHED' ? 'finished' : contest.phase === 'BEFORE' ? 'upcoming' : 'live'
}
function rowAc(item) { return item.row?.problemResults?.filter((result) => (result.points || 0) > 0).length || 0 }
function rowHandle(item) { return item.member.cf_handle || '未绑定 CF Handle' }
function rankOf(item) { return item.row?.rank ?? item.rating?.rank ?? '—' }
function ratingChangeOf(item) {
  if (!item.rating) return '—'
  const delta = item.rating.newRating - item.rating.oldRating
  return `${item.rating.oldRating} → ${item.rating.newRating} (${delta >= 0 ? '+' : ''}${delta})`
}
async function loadStandings(contest) {
  if (!contest || contest.phase !== 'FINISHED') return
  selectedId.value = contest.id
  loading.value = true
  error.value = ''
  standings.value = null
  try {
    standings.value = await fetchContestStandings(contest.id)
  } catch (e) {
    error.value = e.message || '比赛排名暂时不可用'
  } finally {
    loading.value = false
  }
}
function setPage(page) {
  currentPage.value = Math.min(Math.max(1, page), pageCount.value)
  if (!pagedFinishedContests.value.some((contest) => contest.id === selectedId.value)) closeDetails()
}
function selectFinished(contest) {
  loadStandings(contest)
  nextTick(() => document.querySelector('.details-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
function closeDetails() {
  selectedId.value = null
  standings.value = null
  error.value = ''
}

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 1000)
})
watch(() => props.contests, () => {
  if (currentPage.value > pageCount.value) currentPage.value = pageCount.value
  if (!selectedId.value && !props.contests.length) error.value = ''
}, { deep: true })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="arena-view">
    <section class="contest-section upcoming-section">
      <div class="section-head"><div><span class="arena-kicker">01 / NEXT ON TRACK</span><h3>即将开始</h3></div><span>倒计时实时更新</span></div>
      <div v-if="upcomingContests.length" class="contest-grid featured-grid">
        <a v-for="contest in upcomingContests" :key="contest.id" class="contest-card upcoming-card" :href="officialUrl(contest)" target="_blank" rel="noopener">
          <div class="contest-card-top"><span class="state-tag upcoming">即将开始</span><span class="difficulty-tag">难度 · {{ difficultyOf(contest) }}</span></div>
          <h4>{{ contest.name }}</h4>
          <div class="countdown-label">DISTANCE TO START</div><strong class="countdown-value">{{ remainOf(contest) }}</strong>
          <div class="contest-meta"><span>{{ formatDate(contest.startTimeSeconds) }}</span><span>{{ Math.round(contest.durationSeconds / 3600 * 10) / 10 }}H</span></div>
          <span class="contest-links"><span>比赛主页 ↗</span></span>
        </a>
      </div>
      <div v-else class="section-empty">暂无即将开始的比赛</div>
    </section>

    <section class="contest-section live-section">
      <div class="section-head"><div><span class="arena-kicker">02 / IN PROGRESS</span><h3>正在进行</h3></div><span>比赛结束后进入历史归档</span></div>
      <div v-if="liveContests.length" class="contest-grid live-grid">
        <article v-for="contest in liveContests" :key="contest.id" class="contest-card live-card">
          <div class="contest-card-top"><span class="state-tag live">● 进行中</span><span class="difficulty-tag">难度 · {{ difficultyOf(contest) }}</span></div>
          <h4>{{ contest.name }}</h4>
          <div class="countdown-label">TIME REMAINING</div><strong class="countdown-value">{{ remainOf(contest) }}</strong>
          <div class="contest-meta"><span>ROUND #{{ contest.id }}</span><span>{{ Math.round(contest.durationSeconds / 3600 * 10) / 10 }}H</span></div>
          <div class="contest-links"><a :href="officialUrl(contest)" target="_blank" rel="noopener">进入比赛 ↗</a><a :href="problemsetUrl(contest)" target="_blank" rel="noopener">查看题目 ↗</a></div>
        </article>
      </div>
      <div v-else class="section-empty">当前没有正在进行的比赛</div>
    </section>

    <section class="contest-section history-section">
      <div class="section-head"><div><span class="arena-kicker">03 / ARCHIVE</span><h3>已结束比赛</h3></div><span>点击左侧比赛，右侧查看参赛情况</span></div>
      <div class="archive-layout">
        <div class="archive-list-column">
          <div v-if="finishedContests.length" class="history-list">
          <button v-for="contest in pagedFinishedContests" :key="contest.id" class="history-card" :class="{ selected: contest.id === selectedId }" @click="selectFinished(contest)">
            <span class="history-date">{{ formatDate(contest.startTimeSeconds) }}</span><span class="history-name"><strong>{{ contest.name }}</strong><small>ROUND #{{ contest.id }} · 难度 {{ difficultyOf(contest) }}</small></span><span class="history-status">查看 ↗</span>
          </button>
        </div>
        <div v-else class="section-empty">暂无已结束比赛</div>
          <div v-if="finishedContests.length > PAGE_SIZE" class="pagination"><button :disabled="currentPage === 1" @click="setPage(currentPage - 1)">←</button><button v-for="page in pageCount" :key="page" :class="{ active: page === currentPage }" @click="setPage(page)">{{ page }}</button><button :disabled="currentPage === pageCount" @click="setPage(currentPage + 1)">→</button></div>
        </div>
        <section v-if="selectedContest" class="details-panel">
          <div class="detail-head"><div><span class="arena-kicker">CONTEST TELEMETRY / ARCHIVED</span><h3>{{ selectedContest.name }}</h3><p>{{ formatDate(selectedContest.startTimeSeconds) }} · 难度 {{ difficultyOf(selectedContest) }}</p></div><div class="detail-actions"><a :href="officialUrl(selectedContest)" target="_blank" rel="noopener">比赛主页 ↗</a><button class="close-details" @click="closeDetails">×</button></div></div>
          <div v-if="loading" class="section-empty">正在读取比赛数据，首次打开会从 Codeforces 获取并永久缓存…</div>
          <div v-else-if="error" class="section-empty error">{{ error }}</div>
          <template v-else-if="standings"><div class="contest-problem-links"><span>题目</span><a v-for="problem in standings.problems" :key="`${problem.contestId}-${problem.index}`" :href="problemUrl(problem)" target="_blank" rel="noopener">{{ problem.index }} ↗</a></div><div class="contest-overview"><div><span>参赛成员</span><strong>{{ participatingRows.length }}</strong></div><div><span>比赛题目</span><strong>{{ standings.problems.length }}</strong></div><div><span>公开榜单</span><strong>{{ participatingRows.filter((item) => item.row).length }}</strong></div><div><span>Rating</span><strong>{{ selectedContest.ratingConfirmed || ratedGuess(selectedContest.name) ? 'YES' : 'NO' }}</strong></div></div><section class="arena-board"><div class="board-head"><span>RANK</span><span>PLAYER</span><span>SOLVED</span><span>PENALTY</span><span>POINTS</span><span>PROBLEMS</span></div><div v-for="item in participatingRows" :key="item.member.id" class="board-row"><strong class="board-rank">{{ rankOf(item) }}</strong><div class="board-player"><a :href="memberUrl(item)" target="_blank" rel="noopener">{{ item.member.name }} ↗</a><small>{{ rowHandle(item) }}{{ item.rating ? ` · Rating ${ratingChangeOf(item)}` : '' }}</small></div><strong class="board-solved">{{ item.row ? rowAc(item) : '—' }}<small v-if="item.row">/{{ standings.problems.length }}</small></strong><span>{{ item.row?.penalty ?? '—' }}</span><span class="board-points">{{ item.row ? Math.round(item.row.points || 0) : item.rating ? ratingChangeOf(item) : '—' }}</span><div v-if="item.row" class="problem-statuses"><span v-for="(result, index) in item.row.problemResults" :key="index" :class="result.points > 0 ? 'accepted' : 'failed'" :title="standings.problems[index]?.name">{{ result.points > 0 ? 'AC' : result.rejectedAttemptCount ? `-${result.rejectedAttemptCount}` : '·' }}</span></div><div v-else class="problem-statuses unavailable">—</div></div><div v-if="!participatingRows.length" class="section-empty">本场没有检测到工作室成员参赛</div></section></template>
        </section>
        <div v-else class="detail-placeholder"><span>←</span><strong>选择一场已结束的比赛</strong><small>比赛榜单和工作室参赛情况将在这里展示</small></div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.arena-view { max-width: 1280px; margin: 0 auto; padding: 30px 0 60px; }
.arena-kicker { color: var(--command-muted); font: 9px monospace; letter-spacing: 1.7px; }
.arena-hero { min-height: 285px; display: grid; grid-template-columns: 1fr 1fr; align-items: center; border-bottom: 1px solid var(--command-line); background: linear-gradient(125deg, var(--command-accent-soft), transparent 47%); }
.arena-hero h2 { margin: 17px 0 13px; font-size: 58px; line-height: .95; letter-spacing: -3px; }.arena-hero h2 em { color: var(--command-accent); font-style: normal; }.arena-hero p { color: var(--command-muted); font-size: 13px; }
.arena-hero-stats { justify-self: end; display: grid; grid-template-columns: repeat(3, 1fr); width: min(430px, 100%); border: 1px solid var(--command-line); }.arena-hero-stats div { min-height: 120px; padding: 18px; border-right: 1px solid var(--command-line); }.arena-hero-stats div:last-child { border-right: 0; }.arena-hero-stats strong { display: block; color: var(--command-accent); font: 700 32px monospace; }.arena-hero-stats span { display: block; margin-top: 13px; color: var(--command-muted); font: 9px monospace; }
.contest-section { padding: 32px 0; border-bottom: 1px solid var(--command-line); }.section-head,.detail-head { display: flex; justify-content: space-between; align-items: flex-start; }.section-head h3,.detail-head h3 { margin-top: 8px; font-size: 21px; }.section-head > span,.detail-head p { color: var(--command-muted); font: 10px monospace; }.contest-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 22px; }.contest-card { min-height: 250px; padding: 22px; border: 1px solid var(--command-line); background: var(--command-panel); }.upcoming-card { border-color: var(--command-accent); box-shadow: 0 0 28px var(--command-accent-soft); }.live-card { border-color: #a855f7; }.contest-card-top { display: flex; justify-content: space-between; gap: 10px; }.state-tag,.difficulty-tag { font: 9px monospace; letter-spacing: .8px; }.state-tag.upcoming { color: var(--command-accent); }.state-tag.live { color: #a855f7; }.difficulty-tag { color: var(--command-muted); }.contest-card h4 { min-height: 48px; margin: 25px 0 19px; font-size: 17px; line-height: 1.35; }.countdown-label { color: var(--command-muted); font: 9px monospace; }.countdown-value { display: block; margin-top: 7px; color: var(--command-accent); font: 700 26px monospace; }.live-card .countdown-value { color: #a855f7; }.contest-meta { display: flex; justify-content: space-between; margin-top: 19px; color: var(--command-muted); font: 9px monospace; }.contest-links { display: flex; gap: 18px; margin-top: 20px; }.contest-links a,.detail-head a { color: var(--command-accent); font: 10px monospace; }.history-list { display: grid; gap: 2px; margin-top: 20px; }.history-card { display: grid; grid-template-columns: 125px 1fr auto; gap: 20px; align-items: center; width: 100%; min-height: 70px; padding: 13px 17px; border: 1px solid transparent; border-bottom-color: var(--command-line); background: transparent; color: var(--command-text); text-align: left; }.history-card:hover,.history-card.selected { border-color: var(--command-accent); background: var(--command-hover); }.history-date { color: var(--command-muted); font: 10px monospace; }.history-name strong,.history-name small { display: block; }.history-name strong { font-size: 13px; }.history-name small { margin-top: 6px; color: var(--command-muted); font: 9px monospace; }.history-list { display: grid; gap: 2px; margin-top: 20px; }.history-card { display: grid; grid-template-columns: 125px 1fr auto; gap: 20px; align-items: center; width: 100%; min-height: 70px; padding: 13px 17px; border: 1px solid transparent; border-bottom-color: var(--command-line); background: transparent; color: var(--command-text); text-align: left; }.history-card:hover,.history-card.selected { border-color: var(--command-accent); background: var(--command-hover); }.history-date { color: var(--command-muted); font: 10px monospace; }.history-name strong,.history-name small { display: block; }.history-name strong { font-size: 13px; }.history-name small { margin-top: 6px; color: var(--command-muted); font: 9px monospace; }.history-status { color: var(--command-accent); font: 10px monospace; }.archive-layout { display: grid; grid-template-columns: minmax(280px, .78fr) minmax(0, 1.22fr); gap: 24px; margin-top: 20px; align-items: stretch; }.archive-list-column { min-width: 0; display: flex; flex-direction: column; min-height: 690px; }.archive-layout .history-list { margin-top: 0; }.archive-layout .history-card { grid-template-columns: 82px 1fr; gap: 10px; padding: 15px; }.archive-layout .history-status { grid-column: 2; }.pagination { display: flex; justify-content: center; gap: 5px; margin-top: auto; padding-top: 16px; }.pagination button { min-width: 28px; height: 28px; border: 1px solid var(--command-line); background: transparent; color: var(--command-muted); font: 10px monospace; }.pagination button:hover,.pagination button.active { border-color: var(--command-accent); background: var(--command-accent); color: #fff; }.pagination button:disabled { opacity: .35; cursor: not-allowed; }.details-panel { min-width: 0; height: 690px; overflow: auto; padding: 22px; border: 1px solid var(--command-line); background: var(--command-panel); }
.detail-actions { display: flex; align-items: center; gap: 12px; }.detail-actions a { color: var(--command-accent); font: 10px monospace; }.close-details { width: 26px; height: 26px; border: 1px solid var(--command-line); background: transparent; color: var(--command-muted); font-size: 16px; line-height: 1; }.close-details:hover { border-color: var(--command-accent); color: var(--command-accent); }
.contest-problem-links { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 18px 0; padding: 9px 11px; border: 1px solid var(--command-line); background: var(--command-bg); }.contest-problem-links span { margin-right: 5px; color: var(--command-muted); font: 9px monospace; }.contest-problem-links a { padding: 4px 8px; border: 1px solid var(--command-line); color: var(--command-accent); font: 10px monospace; text-decoration: none; }.contest-problem-links a:hover { border-color: var(--command-accent); background: var(--command-hover); }
.contest-overview { display: grid; grid-template-columns: repeat(4, 1fr); margin: 20px 0; border: 1px solid var(--command-line); }.contest-overview div { min-height: 72px; padding: 13px; border-right: 1px solid var(--command-line); }.contest-overview div:last-child { border-right: 0; }.contest-overview span { color: var(--command-muted); font: 8px monospace; }.contest-overview strong { display: block; margin-top: 10px; color: var(--command-accent); font: 700 18px monospace; }
.arena-board { border-top: 1px solid var(--command-line); }.board-head,.board-row { display: grid; grid-template-columns: 42px minmax(120px, 1fr) 52px 65px 60px minmax(180px, 1.4fr); gap: 9px; align-items: center; }.board-head { padding: 11px 0; color: var(--command-muted); font: 8px monospace; border-bottom: 1px solid var(--command-line); }.board-row { min-height: 54px; border-bottom: 1px solid var(--command-line); color: var(--command-text); font: 11px monospace; }.board-player a { color: var(--command-text); font-size: 11px; }.board-player a:hover { color: var(--command-accent); }.board-player small { display: block; margin-top: 4px; color: var(--command-muted); font-size: 8px; }.board-rank,.board-solved { color: var(--command-accent); font-size: 14px; }.board-solved small { color: var(--command-muted); font-size: 9px; }.board-points { font-weight: 700; }.problem-statuses { display: grid; grid-template-columns: repeat(auto-fit, minmax(25px, 1fr)); gap: 3px; }.problem-statuses span { display: grid; place-items: center; min-width: 25px; height: 22px; border: 1px solid var(--command-line); color: var(--command-muted); font: 8px monospace; }.problem-statuses span.accepted { border-color: rgba(24, 168, 116, .4); background: rgba(24, 168, 116, .12); color: var(--command-green); }.problem-statuses span.failed { background: var(--command-bg); }.problem-statuses.unavailable { display: grid; place-items: center; color: var(--command-muted); }
.problem-matrix { margin-top: 26px; }.problem-hint { color: var(--command-muted); font: 9px monospace; }.problem-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 13px; }.problem-tile { min-height: 0; display: grid; grid-template-columns: 28px 1fr; grid-template-rows: auto auto; gap: 2px 9px; padding: 9px 10px; border: 1px solid var(--command-line); background: var(--command-bg); color: var(--command-text); text-decoration: none; }.problem-tile:hover { border-color: var(--command-accent); background: var(--command-hover); }.problem-tile strong { grid-row: 1 / span 2; align-self: center; color: var(--command-accent); font: 700 16px monospace; }.problem-tile span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }.problem-tile small { color: var(--command-muted); font: 8px monospace; }
@media (max-width: 760px) { .arena-view { padding-top: 20px; }.arena-hero { display: block; padding: 30px 0; }.arena-hero h2 { font-size: 47px; }.arena-hero-stats { margin-top: 30px; }.contest-grid { grid-template-columns: 1fr; }.archive-layout { display: block; }.archive-list-column { min-height: 0; }.archive-layout .history-list { margin-bottom: 0; }.pagination { padding-top: 13px; }.history-card { grid-template-columns: 82px 1fr; gap: 10px; }.history-status { grid-column: 2; }.detail-head { gap: 15px; }.detail-actions { flex-wrap: wrap; justify-content: flex-end; }.details-panel { height: auto; max-height: none; margin-top: 18px; padding: 17px; }.contest-overview { grid-template-columns: 1fr 1fr; }.contest-overview div:nth-child(2) { border-right: 0; }.contest-overview div:nth-child(-n+2) { border-bottom: 1px solid var(--command-line); }.board-head,.board-row { grid-template-columns: 35px minmax(105px, 1fr) 50px 58px 120px; gap: 6px; }.board-head span:nth-child(4),.board-row > span:nth-child(4),.board-head span:nth-child(5),.board-row > span:nth-child(5) { display: none; }.problem-statuses { grid-column: 5; }.problem-statuses span { min-width: 20px; height: 20px; font-size: 7px; }.board-points { display: none; }.problem-grid { grid-template-columns: 1fr; } }
</style>

<script setup>
import { computed, onMounted, ref } from 'vue'

const owner = 'Dddddduo'
const repo = 'Bhu-Acm-Grade'
const repository = `https://github.com/${owner}/${repo}`
const apiBase = `https://api.github.com/repos/${owner}/${repo}`
const issues = `${repository}/issues`
const commitsUrl = `${repository}/commits/main`
const CACHE_KEY = 'bhu-acm-devlog-github-v1'
const CACHE_TTL = 10 * 60 * 1000

const project = ref(null)
const contributors = ref([])
const commits = ref([])
const loading = ref(true)
const error = ref('')

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (cached?.at && cached.data && Date.now() - cached.at < CACHE_TTL) return cached.data
  } catch {
    // Browser storage may be unavailable.
  }
  return null
}
function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })) } catch {
    // A full or disabled cache must not break the page.
  }
}
async function githubJson(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`)
  return response.json()
}
function mapContributor(item) {
  return {
    display: item.login || 'Unknown contributor',
    handle: item.login || '',
    count: item.contributions || 0,
    role: `${item.type === 'Bot' ? '自动化账号' : 'GitHub Contributor'} · ${item.contributions || 0} 次提交`,
    url: item.html_url || `${repository}/graphs/contributors`,
    avatar: item.avatar_url || '',
    initial: (item.login || '?').slice(0, 1).toUpperCase(),
  }
}
function mapCommit(item) {
  return {
    hash: item.sha?.slice(0, 7) || '—',
    fullHash: item.sha || '',
    date: item.commit?.author?.date ? new Date(item.commit.author.date).toLocaleDateString('zh-CN') : '—',
    author: item.author?.login || item.commit?.author?.name || 'Unknown author',
    title: item.commit?.message?.split('\\n')[0] || '无提交说明',
    url: item.html_url || `${commitsUrl}/${item.sha}`,
  }
}
async function loadGithubData() {
  const cached = readCache()
  if (cached) {
    project.value = cached.project
    contributors.value = cached.contributors || []
    commits.value = cached.commits || []
    loading.value = false
    return
  }
  try {
    const [repoData, contributorData, commitData] = await Promise.all([
      githubJson(''),
      githubJson('/contributors?per_page=100'),
      githubJson('/commits?per_page=100'),
    ])
    const data = {
      project: {
        name: repoData.full_name || `${owner}/${repo}`,
        description: repoData.description || 'GitHub repository',
        stars: repoData.stargazers_count || 0,
        forks: repoData.forks_count || 0,
        issues: repoData.open_issues_count || 0,
        pushedAt: repoData.pushed_at || '',
      },
      contributors: contributorData.filter((item) => item.login !== 'github-actions[bot]').map(mapContributor),
      commits: commitData.map(mapCommit),
    }
    project.value = data.project
    contributors.value = data.contributors
    commits.value = data.commits
    writeCache(data)
  } catch (loadError) {
    error.value = loadError.message || 'GitHub 数据读取失败'
  } finally {
    loading.value = false
  }
}
const contributorCount = computed(() => contributors.value.length)
const commitCount = computed(() => commits.value.length)
const projectUpdatedText = computed(() => project.value?.pushedAt ? new Date(project.value.pushedAt).toLocaleString('zh-CN', { hour12: false }) : '等待 GitHub 数据')
onMounted(loadGithubData)
</script>

<template>
  <section class="devlog-view">
    <section class="devlog-hero"><div><span class="devlog-kicker">04 / DEVELOPMENT LOG</span><h2>每一次提交，<br /><em>都有记录。</em></h2><p>项目贡献者与 GitHub 官方 commit 历史。</p></div><div class="devlog-mark"><span>04</span><strong>BUILD<br /><small>HISTORY</small></strong></div></section>
    <section class="devlog-grid"><article class="devlog-about"><span class="devlog-kicker">PROJECT LINKS</span><h3>{{ project?.name || 'BUH ACM 项目' }}</h3><p>{{ project?.description || (loading ? '正在读取 GitHub 仓库信息…' : 'GitHub 仓库信息暂不可用') }}</p><div v-if="project" class="project-stats"><span>{{ project.stars }}<small>STARS</small></span><span>{{ project.forks }}<small>FORKS</small></span><span>{{ project.issues }}<small>ISSUES</small></span></div><div class="devlog-links"><a :href="repository" target="_blank" rel="noopener">↗ GitHub 项目主页</a><a :href="commitsUrl" target="_blank" rel="noopener">↗ 全部提交记录</a><a :href="issues" target="_blank" rel="noopener">✦ 提交想法 / Issue</a></div></article><article class="devlog-contributors"><div class="section-title"><div><span class="devlog-kicker">CONTRIBUTORS</span><h3>开发与贡献</h3></div><span>{{ contributorCount }} PEOPLE</span></div><p v-if="loading" class="devlog-state">正在读取 GitHub Contributors…</p><p v-else-if="error && !contributors.length" class="devlog-state error">{{ error }}</p><p v-else-if="!contributors.length" class="devlog-state">暂无贡献者数据</p><div v-else class="contributor-grid"><a v-for="person in contributors" :key="person.handle" class="contributor-card" :href="person.url" target="_blank" rel="noopener"><div class="contributor-avatar"><img :src="person.avatar" :alt="`${person.display} GitHub 头像`" @error="$event.target.style.display = 'none'" /><span>{{ person.initial }}</span></div><div class="contributor-info"><strong>{{ person.display }}</strong><small>GitHub ID · {{ person.handle }}</small><em>{{ person.role }}</em></div><b>{{ person.count }}<small>COMMITS</small></b></a></div></article></section>
    <section class="timeline"><div class="timeline-head"><div><span class="devlog-kicker">GIT COMMIT LOG</span><h3>开发记录 <small>{{ commitCount }} COMMITS</small></h3></div><div class="timeline-meta"><span>LAST PUSH · {{ projectUpdatedText }}</span><a :href="commitsUrl" target="_blank" rel="noopener">GitHub Commits ↗</a></div></div><p v-if="loading" class="devlog-state">正在读取 GitHub Commits…</p><p v-else-if="error && !commits.length" class="devlog-state error">{{ error }}</p><p v-else-if="!commits.length" class="devlog-state">暂无提交记录</p><div v-else class="commit-list"><a v-for="commit in commits" :key="commit.fullHash" class="commit-card" :href="commit.url" target="_blank" rel="noopener"><div class="commit-hash"><code>{{ commit.hash }}</code><span>{{ commit.date }}</span></div><div class="commit-message"><strong>{{ commit.title }}</strong><small>{{ commit.author }}</small></div><b>↗</b></a></div></section>
  </section>
</template>

<style scoped>
.devlog-view { max-width: 1280px; margin: 0 auto; padding: 30px 0 45px; }.devlog-kicker { color: var(--command-muted); font: 9px monospace; letter-spacing: 1.7px; }.devlog-hero { min-height: 250px; display: grid; grid-template-columns: 1fr 1fr; align-items: center; border-bottom: 1px solid var(--command-line); background: linear-gradient(125deg, var(--command-accent-soft), transparent 48%); }.devlog-hero h2 { margin: 17px 0 13px; font-size: 58px; line-height: .95; letter-spacing: -3px; }.devlog-hero h2 em { color: var(--command-accent); font-style: normal; }.devlog-hero p { color: var(--command-muted); font-size: 13px; }.devlog-mark { justify-self: end; width: 190px; height: 190px; display: flex; align-items: center; justify-content: center; gap: 14px; border: 1px solid var(--command-accent); border-radius: 50%; color: var(--command-accent); }.devlog-mark span { font: 700 50px monospace; }.devlog-mark strong { color: var(--command-text); font: 700 18px monospace; line-height: 1.1; }.devlog-mark small { color: var(--command-muted); font-size: 8px; letter-spacing: 1px; }.devlog-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 1px; background: var(--command-line); border-bottom: 1px solid var(--command-line); }.devlog-about,.devlog-contributors { min-height: 225px; padding: 27px 25px; background: var(--command-bg); }.devlog-contributors { background: var(--command-panel); }.devlog-grid h3 { margin: 12px 0; font-size: 20px; line-height: 1.3; }.devlog-grid p { color: var(--command-muted); font-size: 11px; line-height: 1.7; }.project-stats { display: flex; gap: 18px; margin-top: 18px; }.project-stats span { color: var(--command-accent); font: 700 16px monospace; }.project-stats small { display: block; margin-top: 3px; color: var(--command-muted); font-size: 7px; letter-spacing: 1px; }.devlog-state { padding: 24px 0; color: var(--command-muted); font: 10px monospace; }.devlog-state.error { color: var(--command-danger, #c45b68); }.devlog-links { display: grid; gap: 10px; margin-top: 20px; }.devlog-links a,.timeline-head a { color: var(--command-accent); font: 10px monospace; text-decoration: none; }.devlog-links a:hover { color: var(--command-text); }.section-title { display: flex; align-items: flex-start; justify-content: space-between; }.section-title > span { color: var(--command-muted); font: 9px monospace; }.contributor-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; }.contributor-card { min-width: 0; position: relative; display: flex; align-items: flex-start; gap: 9px; min-height: 110px; padding: 12px; border: 1px solid var(--command-line); color: var(--command-text); text-decoration: none; }.contributor-card:hover { border-color: var(--command-accent); background: var(--command-hover); }.contributor-avatar { position: relative; display: grid; place-items: center; flex: 0 0 40px; width: 40px; height: 40px; overflow: hidden; border-radius: 50%; background: var(--command-accent); color: #fff; font-weight: 800; box-shadow: 0 0 0 2px var(--command-panel), 0 0 0 3px var(--command-accent); }.contributor-avatar img { position: absolute; z-index: 1; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; background: var(--command-accent); }.contributor-avatar span { position: relative; z-index: 0; }.contributor-info { min-width: 0; }.contributor-info strong,.contributor-info small,.contributor-info em { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.contributor-info strong { font-size: 11px; }.contributor-info small { margin-top: 3px; color: var(--command-muted); font: 8px monospace; }.contributor-info em { margin-top: 8px; color: var(--command-muted); font-size: 9px; font-style: normal; line-height: 1.3; white-space: normal; }.contributor-card > b { position: absolute; right: 9px; bottom: 8px; color: var(--command-accent); font: 700 13px monospace; }.contributor-card > b small { display: block; color: var(--command-muted); font: 7px monospace; }.timeline { padding-top: 30px; }.timeline-head { display: flex; justify-content: space-between; align-items: flex-start; }.timeline-head h3 { margin-top: 8px; font-size: 21px; }.timeline-head h3 small { margin-left: 8px; color: var(--command-muted); font: 9px monospace; }.timeline-meta { display: grid; justify-items: end; gap: 8px; }.timeline-meta > span { color: var(--command-muted); font: 8px monospace; }.commit-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin-top: 22px; }.commit-card { display: grid; grid-template-columns: 76px 1fr 18px; gap: 12px; align-items: center; min-height: 64px; padding: 11px 13px; border: 1px solid var(--command-line); background: var(--command-panel); color: var(--command-text); text-decoration: none; }.commit-card:hover { border-color: var(--command-accent); background: var(--command-hover); }.commit-hash code,.commit-hash span,.commit-message small { display: block; }.commit-hash code { color: var(--command-accent); font: 10px monospace; }.commit-hash span,.commit-message small { margin-top: 5px; color: var(--command-muted); font: 8px monospace; }.commit-message { min-width: 0; }.commit-message strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }.commit-card > b { color: var(--command-accent); font: 14px monospace; text-align: right; }
@media (max-width: 850px) { .contributor-grid { grid-template-columns: 1fr 1fr; }.commit-list { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .devlog-view { padding-top: 20px; }.devlog-hero { display: block; padding: 30px 0; }.devlog-hero h2 { font-size: 47px; }.devlog-mark { width: 165px; height: 165px; margin: 30px auto 0; }.devlog-grid { display: block; }.devlog-about,.devlog-contributors { min-height: 0; }.contributor-grid { grid-template-columns: 1fr; }.commit-list { grid-template-columns: 1fr; }.timeline-head { gap: 15px; }.timeline-head a { font-size: 8px; }.timeline-meta { justify-items: start; } }
</style>

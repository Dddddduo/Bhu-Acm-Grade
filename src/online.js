// ============================================================
// 在线状态:数据源是 CF 官方 user.info 的 lastOnlineTimeSeconds(上次访问 CF,unix 秒)
// + user.status 里最新一次提交时间。官方 API 没有"实时在线"布尔字段,所以这里自己定口径:
//   距上次访问 Codeforces < 30 分钟   ⇒  在线(online now)
//   距最新一次交题     < 60 分钟   ⇒  在线(online now)
// 为什么要提交信号:user.info 的 lastOnlineTimeSeconds 更新很懒,实测有人正在交题
// 该字段却滞后 1~2 小时(2026-10-24 LBH68:5 分钟前刚交题,lastOnline 仍停在 91 分钟前),
// 单靠访问字段会把"真在线在刷题"的人误判离线;每轮抓取本来就翻 user.status,顺手取最新提交。
// 两信号都宽于抓取节奏(App.vue 的 LIVE_EVERY_MS = 10 分钟),不会把"还没轮到抓取"的人误判离线;
// 代价是刚下线的人标签最多晚 (窗口 − 上次抓取时刻差) 才变灰——30 秒一跳的 nowSec 会在到期时刻自动判灰。
// ============================================================
import { ref } from 'vue'

export const ONLINE_WINDOW_SEC = 30 * 60 // 访问过 CF 的在线窗口
export const SUBMIT_WINDOW_SEC = 60 * 60 // 交过题的在线窗口

export const nowSec = ref(Math.floor(Date.now() / 1000))
if (typeof window !== 'undefined') {
  setInterval(() => {
    nowSec.value = Math.floor(Date.now() / 1000)
  }, 30 * 1000)
}

// 两个时间戳取大:任一为数字才返回,都缺 -> null(未知)
function maxSec(a, b) {
  const x = typeof a === 'number' && Number.isFinite(a) ? a : null
  const y = typeof b === 'number' && Number.isFinite(b) ? b : null
  return x == null ? y : y == null ? x : Math.max(x, y)
}

// 有没有抓到过任何在线信号(两个字段都缺 = 未知,不当在线也不显示离线时长)
export function hasOnlineData(stats) {
  return stats?.cf_last_online != null || stats?.cf_last_submit != null
}

// 上次活跃时间 = 两信号里最近的一个
export function lastActiveSec(stats) {
  return maxSec(stats?.cf_last_online, stats?.cf_last_submit)
}

// 在线判定:访问 CF 在 30 分钟内,或最新交题在 60 分钟内,任一命中即在线;都没数据 = 未知
export function isOnlineNow(stats) {
  const t = lastActiveSec(stats)
  if (t == null) return false
  const now = nowSec.value
  return (typeof stats?.cf_last_online === 'number' && now - stats.cf_last_online < ONLINE_WINDOW_SEC) ||
    (typeof stats?.cf_last_submit === 'number' && now - stats.cf_last_submit < SUBMIT_WINDOW_SEC)
}

// 距上次活跃多久:「刚刚 / 12 分钟前 / 3 小时前 / 5 天前」;没数据 -> 空串
// 服务器时间偶尔比本地快(时间戳在未来),按 diff<0 兜底成「刚刚」,不显示「-3 分钟前」
export function lastSeenText(stats) {
  const t = lastActiveSec(stats)
  if (t == null) return ''
  const diff = Math.max(0, nowSec.value - t)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

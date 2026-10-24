// ============================================================
// 在线状态:唯一数据源是 CF 官方 user.info 的 lastOnlineTimeSeconds(unix 秒)
// 官方 API 没有"实时在线"布尔字段,所以这里自己定口径:
//   距上次访问 Codeforces < 10 分钟  ⇒  在线(online now)
// 口径权衡:时间戳只在每轮抓取时更新,窗口 = 抓取节奏(App.vue 的 LIVE_EVERY_MS)。
// 窗口小于节奏会把"真在线但还没轮到抓取"的人误判成离线;再往下调窗口必须同时加密抓取,
// 且不能小于单轮抓取耗时(~2 分钟),否则一轮没抓完早先抓的人就被判离线。
// nowSec 每 30 秒跳一次:人离开后标签会在窗口到期时自己变灰,不用等下一轮抓取。
// ============================================================
import { ref } from 'vue'

export const ONLINE_WINDOW_SEC = 10 * 60

export const nowSec = ref(Math.floor(Date.now() / 1000))
if (typeof window !== 'undefined') {
  setInterval(() => {
    nowSec.value = Math.floor(Date.now() / 1000)
  }, 30 * 1000)
}

// 没数据(非数字)= 未知,不当在线
export function isOnlineNow(lastOnlineSec) {
  return typeof lastOnlineSec === 'number' && Number.isFinite(lastOnlineSec) &&
    nowSec.value - lastOnlineSec < ONLINE_WINDOW_SEC
}

// 距上次在线多久:「刚刚 / 12 分钟前 / 3 小时前 / 5 天前」;没数据 -> 空串
// 服务器时间偶尔比本地快(时间戳在未来),按 diff<0 兜底成「刚刚」,不显示「-3 分钟前」
export function lastSeenText(lastOnlineSec) {
  if (typeof lastOnlineSec !== 'number' || !Number.isFinite(lastOnlineSec)) return ''
  const diff = Math.max(0, nowSec.value - lastOnlineSec)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

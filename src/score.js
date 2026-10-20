// ============================================================
// 积分与评级(用户定的口径,2026-10-20):
//  - CF 相关占 70 分:当前 Rating 30 / 最高 Rating 5 / 近30天做题 5 / 总做题 30
//  - 牛客相关占 30 分:Rating 10 / 总过题 20
//  - 每项 = min(指标值 / 上限, 1) × 权重;没数据的项按 0 计
//  - 排名:有数据的人按总分降序,前 12% 金牌、再 24% 银牌、再 36% 铜牌(都向上取整),
//    剩余的人以及完全没数据的人 = 未定级
// 想调权重/上限,只改下面两个常量表即可。
// ============================================================

// key -> [权重, 归一化上限]
const METRIC_WEIGHTS = {
  cf_rating:     [30, 2400], // CF 当前分
  cf_max_rating: [5, 2400], // CF 最高分
  cf_30d:        [5, 100],  // CF 近 30 天 AC 题数
  cf_total:      [30, 1500], // CF 总做题
  nc_rating:     [15, 2400], // 牛客 Rating
  nc_total:      [15, 1500], // 牛客总过题
}

// 个人总分(0~100,保留 1 位小数);st = 该成员的实时数据补丁
export function computeScore(st) {
  let s = 0
  for (const [k, [w, cap]] of Object.entries(METRIC_WEIGHTS)) {
    const v = st?.[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) s += Math.min(v / cap, 1) * w
  }
  return Math.round(s * 10) / 10
}

// 是否"有数据":任何一个计分项是数字即算有,全空 -> 未定级(不占奖牌名额)
export function hasData(st) {
  return Object.keys(METRIC_WEIGHTS).some(
    (k) => typeof st?.[k] === 'number' && Number.isFinite(st[k])
  )
}

// 给一组行分配名次和奖牌等级。
// rows: [{ member, stats }] —— 返回 Map<成员id, { rank, level }>
// level: 'gold' | 'silver' | 'bronze' | 'unranked'
export function assignLevels(rows) {
  const ranked = rows
    .filter((r) => hasData(r.stats))
    .map((r) => ({ id: String(r.member.id), score: r.stats?.score ?? 0 }))
    .sort((a, b) => b.score - a.score)

  const n = ranked.length
  const g = Math.ceil(n * 0.12)
  const gs = g + Math.ceil(n * 0.24)
  const gsb = gs + Math.ceil(n * 0.36)

  const out = new Map()
  let lastScore
  let lastRank = 0
  ranked.forEach((r, i) => {
    // 并列同名次(1,2,2,4 式),奖牌按排位区间切
    if (i === 0 || r.score !== lastScore) { lastRank = i + 1; lastScore = r.score }
    const level = i < g ? 'gold' : i < gs ? 'silver' : i < gsb ? 'bronze' : 'unranked'
    out.set(r.id, { rank: lastRank, level })
  })
  for (const r of rows) {
    const id = String(r.member.id)
    if (!out.has(id)) out.set(id, { rank: null, level: 'unranked' }) // 没数据的
  }
  return out
}

export const LEVEL_TEXT = {
  gold: '金牌',
  silver: '银牌',
  bronze: '铜牌',
  unranked: '未定级',
}

// ============================================================
// 综合得分(用户指定的权重,四项合计 100%):
//   牛客 Rating   20%  +  牛客刷题数  10%
//   CF   Rating   40%  +  CF  刷题数  30%
//
// CF Rating 取值:
//   新生 = 当前 Rating;老登 = CF 最高分(毕业后不再打比赛,当前分会掉)
//
// 每个维度先换算成百分制分,再加权,不设上限,多刷多得:
//   Rating  : rating / 24        —— 2400 分恰好折成 100,再高继续加
//   刷题数  : 总通过题数 / 20     —— 2000 题恰好折成 100,再多继续加
//   没有账号 / 没数据 = 该维度 0 分(权重不挪给别的维度,督促四个维度都有分)
//
// rowValue:表格排序/名次取值用 —— 综合分在行上(合并时算好),其余在 stats 里
// ============================================================

export const WEIGHTS = {
  nc_rating: 0.2,
  nc_solved: 0.1,
  cf_rating: 0.4,
  cf_total: 0.3,
}

// 换算基准:2400 Rating = 100 分,2000 题 = 100 分(只作除数,不是上限)
export const RATING_UNIT = 24
export const SOLVED_UNIT = 20

function ratingScore(rating) {
  const r = Number(rating)
  if (!Number.isFinite(r) || r <= 0) return 0
  return r / RATING_UNIT
}

function solvedScore(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return 0
  return v / SOLVED_UNIT
}

// group === 'old' 时 CF Rating 维度用历史最高分(cf_max_rating)参与评分
export function weightedScore(stats, group) {
  if (!stats) return 0
  const cfRating = group === 'old' ? stats.cf_max_rating ?? stats.cf_rating : stats.cf_rating
  // 保留两位小数:刚注册刷了题但还没 Rating 的新生得分很小,
  // 一位小数会被抹成 0.0,看着像"没得分"
  return +(
    ratingScore(stats.nc_rating) * WEIGHTS.nc_rating +
    solvedScore(stats.nc_solved) * WEIGHTS.nc_solved +
    ratingScore(cfRating) * WEIGHTS.cf_rating +
    solvedScore(stats.cf_total) * WEIGHTS.cf_total
  ).toFixed(2)
}

export function rowValue(row, key) {
  if (key === 'score') return row.score ?? -Infinity
  return row.stats?.[key] ?? -Infinity
}

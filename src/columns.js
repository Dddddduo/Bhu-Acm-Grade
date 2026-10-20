// ============================================================
// 榜单列配置 —— 想加/减一列,只改这个文件,不用动组件
// (手机端卡片视图 MobileCards.vue 里的 METRICS 是硬编码的,加列时两边都要改)
//
// key        : 实时抓取补丁(liveCf.js / liveNc.js 产出)的字段名
// label      : 表头显示文字
// cfTier     : true 表示按 Codeforces 官方段位上色(段位名取 rankKey 字段)
// ncTier     : true 表示按牛客官方 Rating 分段上色(见 TierBadge)
// rankKey    : 上色时附带展示的 CF 段位名字段
// hot        : 今日这类"活跃度"列,前端用高亮 pill 样式
// hidden     : true 表示暂时不展示(数据照常采集,以后放开)
//
// 数据全部浏览器实时抓取:CF 列直连官方 API;牛客 Rating / 总过题 经 Cloudflare Worker
// 代理(scripts/ncWorker.js)。没数据 = 显示「未定级」;总过题数首轮还没抓全时也算没数据。
// 排序/奖牌按 score.js 的积分总分(列本身不展示总分,鼠标悬停名次可见)。
// ============================================================

export const COLUMNS = [
  { key: 'cf_rating',     label: 'CF Rating', cfTier: true, rankKey: 'cf_rank' },
  { key: 'cf_max_rating', label: 'CF 最高分', cfTier: true, rankKey: 'cf_max_rank' },
  { key: 'cf_total',      label: 'CF 总做题' },
  { key: 'cf_today',      label: 'CF 今日', hot: true },
  { key: 'cf_30d',        label: 'CF 近30天' },
  { key: 'nc_rating',     label: '牛客 Rating', ncTier: true },
  { key: 'nc_total',      label: '牛客总过题' },
]

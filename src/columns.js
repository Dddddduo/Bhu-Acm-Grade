// ============================================================
// 榜单列配置 —— 想加/减一列,只改这个文件,不用动组件
//
// key        : 对应 data/stats.json 里每个人 stats 的字段名
// idKey      : 账号列,取值来自 members 的这个字段(nowcoder_id / cf_handle)
// label      : 表头显示文字
// sortable   : false 表示表头不可点排序(账号这类文本列)
// cfTier     : true 表示按 Codeforces 官方段位上色(段位名取 rankKey 字段)
// ncTier     : true 表示按牛客官方 Rating 分段上色(牛客是另一套颜色,见 TierBadge)
// rankKey    : 上色时附带展示的段位/排名字段
// hot        : 今日/近30天这类"活跃度"列,前端用高亮样式
// hideMobile : 手机端窄屏不展示(数据照常,只是屏幕放不下)
// 注:两个账号ID列默认隐藏 —— 长句柄(如 Bishengleandjay111)会把表格撑出横向滚动;
//     最右「主页」列和手机卡片里都有两个平台的链接,搜索也仍能按账号搜,信息不丢
// hidden     : true 表示暂时不展示(数据照常采集,以后放开)
// ============================================================

export const COLUMNS = [
  { key: 'score',         label: '综合得分' },
  { key: 'nc_rating',     label: '牛客 Rating', ncTier: true, rankKey: 'nc_rank' },
  { key: 'nc_solved',     label: '牛客已通过', hideMobile: true },
  { key: 'nc_today',      label: '牛客今日', hot: true, hideMobile: true },
  { key: 'nc_id',         label: '牛客ID', idKey: 'nowcoder_id', sortable: false, hidden: true },
  { key: 'cf_rating',     label: 'CF Rating', cfTier: true, rankKey: 'cf_rank' },
  { key: 'cf_max_rating', label: 'CF 最高分', cfTier: true, rankKey: 'cf_max_rank', hideMobile: true },
  { key: 'cf_total',      label: 'CF 总做题', hideMobile: true },
  { key: 'cf_today',      label: 'CF 今日', hot: true },
  { key: 'cf_30d',        label: 'CF 近30天', hideMobile: true },
  { key: 'cf_id',         label: 'CF账号', idKey: 'cf_handle', sortable: false, hidden: true },
  // 数据已采集,以后想放开把 hidden 去掉即可
  { key: 'nc_30d',        label: '牛客近30天', hidden: true },
  { key: 'nc_tried',      label: '牛客已挑战', hidden: true },
  { key: 'nc_submits',    label: '牛客提交数', hidden: true },
]

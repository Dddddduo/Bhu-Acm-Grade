<script setup>
// 榜单表格(桌面端):评级 + 成员 + 数据列 + 主页链接
// 数据列取值一律来自 row.stats(liveCf.js / liveNc.js 实时补丁 + score.js 算出的总分)
// 名次/奖牌不按当前排序列算,而是父组件按**积分总分**切好的 levels(gold/silver/bronze/unranked),
// 换成别的列排序时每个人的奖牌等级保持不变;没数据的人显示「未定级」(不再用 —)
// ★ showMedals=false(老登榜):整列去掉评级/奖牌——不评奖牌,排名不分先后
import TierBadge from './TierBadge.vue'

const props = defineProps({
  rows: { type: Array, required: true },
  columns: { type: Array, required: true },
  levels: { type: Map, required: true }, // 成员id -> { rank, level }
  sortKey: { type: String, default: '' },
  sortDir: { type: String, default: 'desc' },
  showMedals: { type: Boolean, default: true },
})
const emit = defineEmits(['sort'])

const MEDAL = { gold: '🥇', silver: '🥈', bronze: '🥉' }

function levelOf(row) {
  return props.levels.get(String(row.member.id)) || { rank: null, level: 'unranked' }
}

// 今日做题的展示样式:0 题灰色,有题绿色高亮 pill,没数据走 empty(未定级)
function todayClass(v) {
  if (v == null) return 'empty'
  return v > 0 ? 'active' : 'idle'
}
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th v-if="showMedals" class="col-rank sticky-col">评级</th>
          <th class="col-name sticky-col" :class="{ 'no-rank': !showMedals }">成员</th>
          <th
            v-for="col in columns"
            :key="col.key"
            class="col-metric"
            :class="{ active: sortKey === col.key, hot: col.hot }"
            @click="emit('sort', col.key)"
            :title="`点击按「${col.label}」排序`"
          >
            {{ col.label }}
            <span class="arrow" v-if="sortKey === col.key">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
          </th>
          <th class="col-links">主页</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="row.member.id">
          <td v-if="showMedals" class="col-rank sticky-col">
            <span
              class="rank-cell"
              :class="[levelOf(row).level]"
              :title="levelOf(row).rank != null ? `总分 ${row.stats?.score ?? 0}(按积分排第 ${levelOf(row).rank})` : '暂无数据,未定级'"
            >
              <template v-if="MEDAL[levelOf(row).level]">
                <span class="medal">{{ MEDAL[levelOf(row).level] }}</span>
                <span class="rk">{{ levelOf(row).rank }}</span>
              </template>
              <template v-else>未定级</template>
            </span>
          </td>
          <td class="col-name sticky-col" :class="{ 'no-rank': !showMedals }">
            <span class="who-text">
              <b>{{ row.member.name }}</b>
              <small>{{ row.member.clazz }}</small>
            </span>
          </td>
          <td
            v-for="col in columns"
            :key="col.key"
            class="col-metric"
            :class="{ hot: col.hot }"
          >
            <!-- Rating 列:按平台段位上色;没数据 TierBadge 显示未定级 -->
            <TierBadge
              v-if="col.cfTier || col.ncTier"
              :rating="row.stats?.[col.key] ?? null"
              :rank="col.cfTier ? row.stats?.[col.rankKey] || '' : ''"
              :platform="col.cfTier ? 'cf' : 'nc'"
            />
            <!-- 今日列:高亮 pill -->
            <span
              v-else-if="col.hot"
              class="pill"
              :class="todayClass(row.stats?.[col.key])"
            >
              <template v-if="row.stats?.[col.key] == null">未定级</template>
              <template v-else-if="row.stats[col.key] > 0">{{ row.stats[col.key] }}</template>
              <template v-else>0</template>
            </span>
            <!-- 普通数值列 -->
            <template v-else>
              <span v-if="row.stats?.[col.key] == null" class="empty">未定级</span>
              <span v-else class="num">{{ row.stats[col.key] }}</span>
            </template>
          </td>
          <td class="col-links">
            <a v-if="row.member.cf_handle" :href="`https://codeforces.com/profile/${row.member.cf_handle}`" target="_blank" rel="noopener">CF</a>
            <a v-if="row.member.nowcoder_id" :href="`https://ac.nowcoder.com/acm/contest/profile/${row.member.nowcoder_id}`" target="_blank" rel="noopener">牛客</a>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + (showMedals ? 4 : 3)" class="no-data">没有匹配的成员</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap {
  background: var(--card);
  border-radius: 16px;
  overflow: auto; /* 保险:极窄窗口仍能看,常规宽度不会出横向滚动条 */
  box-shadow: var(--shadow);
}
/* 页面已加宽到 1440,列全部塞进一屏;不写 min-width,表格自适应不留横向滚动 */
table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: auto; }
th, td {
  padding: 11px 8px;
  text-align: left;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
th { font-size: 12px; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:nth-child(even) { background: #fafbff; }
tbody tr:hover { background: var(--accent-soft); }

thead th {
  position: sticky; top: 0; z-index: 3;
  background: var(--card);
  font-size: 12.5px; color: var(--muted); font-weight: 600;
  letter-spacing: 0.3px;
  border-bottom: 2px solid var(--line);
}
/* 左两列(评级/成员)横向滚动时固定,长表格不迷路 */
.sticky-col { position: sticky; z-index: 2; background: var(--card); }
thead .sticky-col { z-index: 4; }
.col-rank.sticky-col { left: 0; }
.col-name.sticky-col { left: 92px; box-shadow: 6px 0 8px -6px rgba(28,42,90,0.18); }
/* 老登榜无评级列:成员列就是第一列,吸附位置归零 */
.col-name.sticky-col.no-rank { left: 0; }
tbody tr:nth-child(even) .sticky-col { background: #fafbff; }
tbody tr:hover .sticky-col { background: var(--accent-soft); }

.col-metric { cursor: pointer; user-select: none; }
.col-metric:hover { color: var(--accent); }
.col-metric.active { color: var(--accent); }
.col-metric.hot { color: var(--green); }
.arrow { font-size: 10px; margin-left: 2px; }

.col-rank { width: 92px; }
.rank-cell {
  display: inline-flex; align-items: center; gap: 5px;
  min-width: 30px; height: 30px; border-radius: 9px;
  font-weight: 600; font-size: 13px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.rank-cell .medal { font-size: 18px; }
.rank-cell .rk { font-size: 12.5px; color: var(--muted); }
.rank-cell.gold .rk { color: #a06a00; }
.rank-cell.silver .rk { color: #6b7280; }
.rank-cell.bronze .rk { color: #9a5b2d; }
.rank-cell.unranked { font-size: 12px; font-weight: 500; color: #a5abc0; }

.col-name { max-width: 150px; }
.who-text { display: inline-flex; flex-direction: column; line-height: 1.25; }
.who-text b { font-size: 14px; }
.who-text small { color: var(--muted); font-size: 12px; font-weight: 400; }

.num { font-variant-numeric: tabular-nums; font-weight: 600; }
.empty { color: #b8bdd0; font-size: 12px; }

.pill {
  display: inline-block; min-width: 40px; text-align: center;
  padding: 3px 10px; border-radius: 999px;
  font-weight: 600; font-variant-numeric: tabular-nums; font-size: 13px;
}
.pill.active { background: var(--green-soft); color: var(--green); }
.pill.idle { background: #f2f3f7; color: #a5abc0; }
.pill.empty { background: transparent; font-weight: 400; }

.col-links a { margin-right: 10px; font-size: 13px; }
.no-data { text-align: center; color: var(--muted); padding: 40px 0; }

/* 列全部常显(全量数据);窗口不够宽时靠 .table-wrap 横向滚动兜底,
   再窄(<760)整表换成卡片视图(见 MobileCards) */
</style>

<script setup>
// 榜单表格(桌面端):名次 + 成员 + 数据列 + 主页链接
// 列的取值分三类:stats 字段 / member 字段(账号ID) / 行上的综合分
import { computed } from 'vue'
import TierBadge from './TierBadge.vue'
import { rowValue } from '../score.js'

const props = defineProps({
  rows: { type: Array, required: true },
  columns: { type: Array, required: true },
  sortKey: { type: String, default: '' },
  sortDir: { type: String, default: 'desc' },
})
const emit = defineEmits(['sort'])

// 名次:按当前排序列,分值相同则并列(1,2,2,4 式)
const ranks = computed(() => {
  const out = []
  let lastVal
  let lastRank = 0
  props.rows.forEach((row, i) => {
    const v = rowValue(row, props.sortKey)
    if (i === 0 || v !== lastVal) { lastRank = i + 1; lastVal = v }
    out.push(lastRank)
  })
  return out
})

const MEDAL = ['🥇', '🥈', '🥉']

// 今日做题的展示样式:0 题灰色,有题绿色高亮 pill
function todayClass(v) {
  if (v == null) return 'empty'
  return v > 0 ? 'active' : 'idle'
}

// 账号ID列:点击直达官方主页
function homeUrl(col, row) {
  return col.key === 'nc_id'
    ? `https://ac.nowcoder.com/acm/contest/profile/${row.member.nowcoder_id}`
    : `https://codeforces.com/profile/${row.member.cf_handle}`
}
function idVal(col, row) {
  return col.key === 'nc_id' ? row.member.nowcoder_id : row.member.cf_handle
}
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="col-rank sticky-col">#</th>
          <th class="col-name sticky-col">成员</th>
          <th
            v-for="col in columns"
            :key="col.key"
            class="col-metric"
            :class="{ active: sortKey === col.key, hot: col.hot, 'c-id': col.sortable === false, 'hide-m': col.hideMobile }"
            @click="col.sortable !== false && emit('sort', col.key)"
            :title="col.sortable === false ? '' : `点击按「${col.label}」排序`"
          >
            {{ col.label }}
            <span class="arrow" v-if="sortKey === col.key">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
          </th>
          <th class="col-links">主页</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="row.member.id">
          <td class="col-rank sticky-col">
            <span class="rank-cell" :class="{ top3: ranks[i] <= 3 }">
              <template v-if="MEDAL[ranks[i] - 1]">{{ MEDAL[ranks[i] - 1] }}</template>
              <template v-else>{{ ranks[i] }}</template>
            </span>
          </td>
          <td class="col-name sticky-col">
            <span class="who-text">
              <b>{{ row.member.name }}</b>
              <small>{{ row.member.clazz }}</small>
            </span>
          </td>
          <td
            v-for="col in columns"
            :key="col.key"
            class="col-metric"
            :class="{ hot: col.hot, 'hide-m': col.hideMobile }"
          >
            <!-- 综合分 -->
            <b v-if="col.key === 'score'" class="score-num">{{ row.score }}</b>
            <!-- 账号ID:点击直达主页,无账号显示 — -->
            <a
              v-else-if="col.idKey && idVal(col, row)"
              :href="homeUrl(col, row)"
              target="_blank"
              rel="noopener"
              class="handle"
            >{{ idVal(col, row) }}</a>
            <span v-else-if="col.idKey" class="empty">—</span>
            <TierBadge
              v-else-if="col.cfTier || col.ncTier"
              :rating="row.stats?.[col.key] ?? null"
              :rank="col.cfTier ? row.stats?.[col.rankKey] || '' : row.stats?.[col.rankKey] ?? ''"
              :platform="col.cfTier ? 'cf' : 'nc'"
            />
            <span
              v-else-if="col.hot"
              class="pill"
              :class="todayClass(row.stats?.[col.key])"
            >
              <template v-if="row.stats?.[col.key] == null">—</template>
              <template v-else-if="row.stats[col.key] > 0">{{ row.stats[col.key] }}</template>
              <template v-else>0</template>
            </span>
            <template v-else>
              <span v-if="row.stats?.[col.key] == null" class="empty">—</span>
              <span v-else class="num">{{ row.stats[col.key] }}</span>
            </template>
          </td>
          <td class="col-links">
            <a v-if="row.member.cf_handle" :href="`https://codeforces.com/profile/${row.member.cf_handle}`" target="_blank" rel="noopener">CF</a>
            <a v-if="row.member.nowcoder_id" :href="`https://ac.nowcoder.com/acm/contest/profile/${row.member.nowcoder_id}`" target="_blank" rel="noopener">牛客</a>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + 4" class="no-data">没有匹配的成员</td>
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
  max-height: 78vh;
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
/* 左两列(名次/成员)横向滚动时固定,长表格不迷路 */
.sticky-col { position: sticky; z-index: 2; background: var(--card); }
thead .sticky-col { z-index: 4; }
.col-rank.sticky-col { left: 0; }
.col-name.sticky-col { left: 56px; box-shadow: 6px 0 8px -6px rgba(28,42,90,0.18); }
tbody tr:nth-child(even) .sticky-col { background: #fafbff; }
tbody tr:hover .sticky-col { background: var(--accent-soft); }

.col-metric { cursor: pointer; user-select: none; }
.col-metric.c-id { cursor: default; }
.col-metric:hover:not(.c-id) { color: var(--accent); }
.col-metric.active { color: var(--accent); }
.col-metric.hot { color: var(--green); }
.arrow { font-size: 10px; margin-left: 2px; }

.col-rank { width: 56px; }
.rank-cell {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 30px; border-radius: 9px;
  font-weight: 600; font-size: 13px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.rank-cell.top3 { background: #fff7e0; }
.top3 { font-size: 18px; }

.col-name { max-width: 150px; }
.who-text { display: inline-flex; flex-direction: column; line-height: 1.25; }
.who-text b { font-size: 14px; }
.who-text small { color: var(--muted); font-size: 12px; font-weight: 400; }

.score-num { font-size: 14.5px; color: var(--accent); font-variant-numeric: tabular-nums; }
.handle { font-size: 12.5px; font-family: ui-monospace, Menlo, monospace; }
.num { font-variant-numeric: tabular-nums; font-weight: 600; }
.empty { color: #c6cbda; }

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

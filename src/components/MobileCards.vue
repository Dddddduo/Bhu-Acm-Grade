<script setup>
// 手机端卡片视图:一人一张卡,不用左右滑
// 数据口径和 RankTable 完全一致(同一个 rows、同一个 score.js)
import TierBadge from './TierBadge.vue'

defineProps({
  rows: { type: Array, required: true },
  // 老登卡片不显示综合得分(和桌面表格口径一致)
  showScore: { type: Boolean, default: true },
})

// 卡片上展示的字段:和 columns.js 里手机端可见的主列一致
const METRICS = [
  { key: 'nc_rating', label: '牛客 Rating', ncTier: true, rankKey: 'nc_rank' },
  { key: 'cf_rating', label: 'CF Rating', cfTier: true, rankKey: 'cf_rank' },
  { key: 'nc_today', label: '牛客今日', hot: true },
  { key: 'cf_today', label: 'CF 今日', hot: true },
  { key: 'nc_solved', label: '牛客已通过' },
  { key: 'cf_total', label: 'CF 总做题' },
  { key: 'cf_30d', label: 'CF 近30天' },
]
</script>

<template>
  <div class="cards">
    <div v-for="(row, i) in rows" :key="row.member.id" class="card">
      <div class="card-head">
        <span class="idx">{{ i + 1 }}</span>
        <span class="name">
          <b>{{ row.member.name }}</b>
          <small>{{ row.member.clazz }}</small>
        </span>
        <span v-if="showScore" class="score">综合 <b>{{ row.score }}</b></span>
      </div>

      <div class="grid">
        <div v-for="m in METRICS" :key="m.key" class="cell" :class="{ hotcell: m.hot && row.stats?.[m.key] > 0 }">
          <div class="cell-label">{{ m.label }}</div>
          <div class="cell-value">
            <TierBadge
              v-if="m.cfTier || m.ncTier"
              :rating="row.stats?.[m.key] ?? null"
              :rank="m.cfTier ? row.stats?.[m.rankKey] || '' : row.stats?.[m.rankKey] ?? ''"
              :platform="m.cfTier ? 'cf' : 'nc'"
            />
            <template v-else-if="m.hot">
              <span v-if="row.stats?.[m.key] == null" class="empty">—</span>
              <b v-else :class="{ green: row.stats[m.key] > 0 }">{{ row.stats[m.key] }}</b>
            </template>
            <template v-else>
              <span v-if="row.stats?.[m.key] == null" class="empty">—</span>
              <b v-else>{{ row.stats[m.key] }}</b>
            </template>
          </div>
        </div>
      </div>

      <div class="ids">
        <a v-if="row.member.nowcoder_id" :href="`https://ac.nowcoder.com/acm/contest/profile/${row.member.nowcoder_id}`" target="_blank" rel="noopener">牛客 {{ row.member.nowcoder_id }}</a>
        <a v-if="row.member.cf_handle" :href="`https://codeforces.com/profile/${row.member.cf_handle}`" target="_blank" rel="noopener">CF {{ row.member.cf_handle }}</a>
      </div>
    </div>
    <p v-if="rows.length === 0" class="no-data">没有匹配的成员</p>
  </div>
</template>

<style scoped>
.cards { display: flex; flex-direction: column; gap: 10px; }
.card {
  background: var(--card); border-radius: 14px; padding: 12px 14px;
  box-shadow: var(--shadow);
}
.card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.idx {
  width: 26px; height: 26px; border-radius: 8px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: var(--muted);
  background: #f2f4fa; font-variant-numeric: tabular-nums;
}
.card-head .name { display: flex; flex-direction: column; line-height: 1.2; flex: 1; }
.card-head .name b { font-size: 15px; }
.card-head .name small { font-size: 11.5px; color: var(--muted); }
.score { font-size: 12px; color: var(--muted); }
.score b { color: var(--accent); font-size: 15px; }

.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.cell { background: #f7f9fd; border-radius: 10px; padding: 7px 10px; }
.cell.hotcell { background: var(--green-soft); }
.cell-label { font-size: 11px; color: var(--muted); margin-bottom: 2px; }
.cell-value { font-size: 14px; font-variant-numeric: tabular-nums; }
.cell-value b { font-size: 14.5px; }
.cell-value .green { color: var(--green); }
.empty { color: #c6cbda; }

.ids { margin-top: 10px; display: flex; gap: 14px; flex-wrap: wrap; }
.ids a { font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
.no-data { text-align: center; color: var(--muted); padding: 40px 0; }
</style>

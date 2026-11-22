<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  joinedRows: { type: Array, required: true }, // Array of { member, stats }
  groupName: { type: String, required: true }, // 'fresh' | 'old'
})

// Define the CF tiers we want to track
const TIERS = [
  { name: 'Grandmaster (红名)', min: 2400, colorVar: '--cf-gm', text: 'GM' },
  { name: 'Master / IM (橙名)', min: 2100, colorVar: '--cf-master', text: 'Master' },
  { name: 'Candidate Master (紫名)', min: 1900, colorVar: '--cf-cm', text: 'CM' },
  { name: 'Expert (蓝名)', min: 1600, colorVar: '--cf-expert', text: 'Expert' },
  { name: 'Specialist (青名)', min: 1400, colorVar: '--cf-specialist', text: 'Spec' },
  { name: 'Pupil (绿名)', min: 1200, colorVar: '--cf-pupil', text: 'Pupil' },
  { name: 'Newbie (灰名)', min: 0, colorVar: '--cf-newbie', text: 'Newbie' },
]

// 1. Compute Tiers Distribution
const tiersDistribution = computed(() => {
  // Initialize counts and people arrays
  const dist = TIERS.map(t => ({ ...t, count: 0, members: [] }))
  const unratedList = []

  props.joinedRows.forEach(row => {
    const rating = row.stats?.cf_rating
    const name = row.member.name
    if (rating == null || rating <= 0) {
      unratedList.push(name)
    } else {
      const matchedTier = dist.find(t => rating >= t.min)
      if (matchedTier) {
        matchedTier.count++
        matchedTier.members.push(`${name} (${rating})`)
      } else {
        unratedList.push(name)
      }
    }
  })

  // Add Unrated as the bottom category
  dist.push({
    name: 'Unrated (未定级)',
    min: -1,
    colorVar: '--muted',
    text: 'Unrated',
    count: unratedList.length,
    members: unratedList
  })

  // Find max count for scaling bar widths
  const maxCount = Math.max(...dist.map(d => d.count), 1)

  return dist.map(d => ({
    ...d,
    percentage: (d.count / props.joinedRows.length) * 100,
    barWidth: (d.count / maxCount) * 100
  }))
})

// 2. Compute Studio Overall Metrics
const totalMembers = computed(() => props.joinedRows.length)

// Today Solved Ratio (Today Solved / Total)
const todaySolvedCount = computed(() => {
  return props.joinedRows.filter(r => (r.stats?.cf_today ?? 0) > 0).length
})
const todaySolvedRatio = computed(() => {
  if (!totalMembers.value) return 0
  return Math.round((todaySolvedCount.value / totalMembers.value) * 100)
})

// 30 Days Active Ratio (Solved in last 30 days > 5 / Total)
const active30dCount = computed(() => {
  return props.joinedRows.filter(r => (r.stats?.cf_30d ?? 0) >= 5).length
})
const active30dRatio = computed(() => {
  if (!totalMembers.value) return 0
  return Math.round((active30dCount.value / totalMembers.value) * 100)
})

// Rated Members Ratio (Has rating / Total)
const ratedCount = computed(() => {
  return props.joinedRows.filter(r => (r.stats?.cf_rating ?? 0) > 0).length
})
const ratedRatio = computed(() => {
  if (!totalMembers.value) return 0
  return Math.round((ratedCount.value / totalMembers.value) * 100)
})

// Average Codeforces Rating of rated members
const avgRating = computed(() => {
  const rated = props.joinedRows.filter(r => (r.stats?.cf_rating ?? 0) > 0)
  if (!rated.length) return 0
  const sum = rated.reduce((acc, r) => acc + r.stats.cf_rating, 0)
  return Math.round(sum / rated.length)
})

// Average Codeforces Max Rating
const avgMaxRating = computed(() => {
  const rated = props.joinedRows.filter(r => (r.stats?.cf_max_rating ?? 0) > 0)
  if (!rated.length) return 0
  const sum = rated.reduce((acc, r) => acc + r.stats.cf_max_rating, 0)
  return Math.round(sum / rated.length)
})

const activeHoveredIndex = ref(null)
</script>

<template>
  <section class="studio-analytics">
    <div class="analytics-head">
      <span class="analytics-title">📊 {{ groupName === 'fresh' ? '新生' : '老登' }}战力看板</span>
      <span class="analytics-sub">基于当前抓取数据，实时分析本组成员的能力梯度与活跃态势</span>
    </div>

    <div class="analytics-grid">
      <!-- Section 1:段位梯队分布柱状图(CSS/HTML Flex 实现极简优雅) -->
      <div class="analytics-card chart-card">
        <h4 class="card-title">🎖️ Codeforces 段位阶梯</h4>
        <div class="bar-chart">
          <div
            v-for="(tier, idx) in tiersDistribution"
            :key="tier.name"
            class="chart-row"
            @mouseenter="activeHoveredIndex = idx"
            @mouseleave="activeHoveredIndex = null"
          >
            <div class="row-label" :style="{ color: `var(${tier.colorVar})` }">
              <span class="badge-dot" :style="{ backgroundColor: `var(${tier.colorVar})` }"></span>
              {{ tier.text }}
            </div>
            <div class="row-track-wrapper">
              <div class="row-track">
                <div
                  class="row-bar"
                  :style="{
                    width: tier.barWidth + '%',
                    backgroundColor: `var(${tier.colorVar})`,
                    boxShadow: activeHoveredIndex === idx ? `0 0 12px var(${tier.colorVar})` : 'none'
                  }"
                >
                  <span v-if="tier.count > 0" class="bar-count-inner">{{ tier.count }}</span>
                </div>
              </div>
              <div v-if="activeHoveredIndex === idx && tier.members.length" class="tier-tooltip">
                <div class="tooltip-title">{{ tier.name }} — {{ tier.count }}人</div>
                <div class="tooltip-list">{{ tier.members.join('、') }}</div>
              </div>
            </div>
            <div class="row-value">
              <span class="count-num">{{ tier.count }}人</span>
              <span class="count-pct">{{ Math.round(tier.percentage) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 2:团队指数统计区 -->
      <div class="analytics-card kpi-card">
        <h4 class="card-title">📈 核心质量与活跃指标</h4>
        <div class="kpi-list">
          <!-- KPI 1: Rated 比例 -->
          <div class="kpi-row-item">
            <div class="kpi-meta">
              <span class="kpi-label">🏆 已定级人数占比</span>
              <span class="kpi-value">{{ ratedCount }} / {{ totalMembers }} <small>({{ ratedRatio }}%)</small></span>
            </div>
            <div class="kpi-meter-track">
              <div class="kpi-meter-fill" :style="{ width: ratedRatio + '%' }"></div>
            </div>
          </div>

          <!-- KPI 2: 今日过题比例 -->
          <div class="kpi-row-item">
            <div class="kpi-meta">
              <span class="kpi-label">⚡ 今日活跃刷题率</span>
              <span class="kpi-value">{{ todaySolvedCount }} / {{ totalMembers }} <small>({{ todaySolvedRatio }}%)</small></span>
            </div>
            <div class="kpi-meter-track">
              <div class="kpi-meter-fill green" :style="{ width: todaySolvedRatio + '%' }"></div>
            </div>
          </div>

          <!-- KPI 3: 30天活跃比例 (近30天过题 >= 5) -->
          <div class="kpi-row-item">
            <div class="kpi-meta">
              <span class="kpi-label">🔥 滚动30天中度活跃 (≥5题)</span>
              <span class="kpi-value">{{ active30dCount }} / {{ totalMembers }} <small>({{ active30dRatio }}%)</small></span>
            </div>
            <div class="kpi-meter-track">
              <div class="kpi-meter-fill active-color" :style="{ width: active30dRatio + '%' }"></div>
            </div>
          </div>
        </div>

        <div class="averages-box">
          <div class="avg-item">
            <div class="avg-num">{{ avgRating || '未定级' }}</div>
            <div class="avg-label">已定级平均 Rating</div>
          </div>
          <div class="avg-divider"></div>
          <div class="avg-item">
            <div class="avg-num">{{ avgMaxRating || '未定级' }}</div>
            <div class="avg-label">已定级平均最高 Rating</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.studio-analytics {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 18px 20px;
  box-shadow: var(--shadow);
  margin-bottom: 14px;
  transition: all 0.3s ease;
}

.analytics-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 16px;
}

.analytics-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--accent);
  letter-spacing: 0.5px;
}

.analytics-sub {
  font-size: 12.5px;
  color: var(--muted);
}

.analytics-grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 20px;
}

.analytics-card {
  background: var(--ctest-bg);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--line);
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 14px;
  border-bottom: 1px dashed var(--line);
  padding-bottom: 8px;
}

/* 1. Bar Chart Styles */
.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.chart-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 24px;
}

.row-label {
  width: 72px;
  font-size: 12px;
  font-weight: 700;
  text-align: right;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.row-track-wrapper {
  flex: 1;
  position: relative;
  height: 100%;
}

.row-track {
  height: 100%;
  width: 100%;
  background: var(--badge-bg);
  border-radius: 4px;
  overflow: hidden;
}

.row-bar {
  height: 100%;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
  transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
}

.bar-count-inner {
  color: #fff;
  font-size: 10.5px;
  font-weight: 800;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.row-value {
  width: 66px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.count-num {
  color: var(--text);
}

.count-pct {
  color: var(--muted);
}

/* Tooltip on row hover */
.tier-tooltip {
  position: absolute;
  bottom: 28px;
  left: 0;
  z-index: 100;
  background: var(--card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-hover);
  border-radius: 8px;
  padding: 8px 12px;
  min-width: 200px;
  max-width: 320px;
  pointer-events: none;
  animation: tooltip-in 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.tooltip-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 4px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 2px;
}

.tooltip-list {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  word-break: break-all;
}

@keyframes tooltip-in {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 2. KPI Section Styles */
.kpi-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 16px;
}

.kpi-row-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.kpi-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.kpi-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.kpi-value small {
  color: var(--muted);
  font-weight: 500;
  font-size: 11px;
}

.kpi-meter-track {
  height: 6px;
  background: var(--badge-bg);
  border-radius: 3px;
  overflow: hidden;
}

.kpi-meter-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
  transition: width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.kpi-meter-fill.green {
  background: var(--green);
}

.kpi-meter-fill.active-color {
  background: linear-gradient(90deg, var(--accent), var(--green));
}

.averages-box {
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 8px;
  margin-top: 10px;
}

.avg-item {
  text-align: center;
  flex: 1;
}

.avg-num {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.avg-label {
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}

.avg-divider {
  width: 1px;
  height: 32px;
  background: var(--line);
}

@media (max-width: 900px) {
  .analytics-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}

@media (max-width: 640px) {
  .studio-analytics {
    padding: 12px 14px;
  }
  .row-label {
    width: 60px;
    font-size: 11px;
  }
  .row-value {
    width: 58px;
    font-size: 11px;
  }
  .averages-box {
    padding: 8px 4px;
  }
  .avg-num {
    font-size: 15px;
  }
  .avg-label {
    font-size: 9.5px;
  }
}
</style>

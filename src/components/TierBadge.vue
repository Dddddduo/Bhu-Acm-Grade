<script setup>
// Rating 徽章上色:CF 和牛客是两套官方段位色,用 platform 区分,不能混用
// - CF  :优先按 API 返回的段位英文名上色,没给段位时按官方分值阈值兜底
//         (<1200灰 1200~1399绿 1400~1599青 1600~1899蓝 1900~2099紫 2100~2399橙 2400~2999红 ≥3000黑红)
// - 牛客:牛客没有段位名,rank 传的是排名数字(#1976),颜色一律按牛客分值表
//         (0~699灰 700~1099紫 1100~1499蓝 1500~1999青 2000~2399黄 2400~2799橙 ≥2800红,初始分 1000)
import { computed } from 'vue'

const props = defineProps({
  rating: { type: Number, default: null },
  rank: { type: [String, Number], default: '' },
  platform: { type: String, default: 'cf' }, // 'cf' | 'nc'
})

// CF 段位英文名 -> CSS 变量(定义在 style.css)
const CF_TIER_COLOR = {
  'legendary grandmaster': '--cf-lgm',
  'international grandmaster': '--cf-gm',
  grandmaster: '--cf-gm',
  'international master': '--cf-im',
  master: '--cf-master',
  'candidate master': '--cf-cm',
  specialist: '--cf-specialist',
  expert: '--cf-expert',
  pupil: '--cf-pupil',
  newbie: '--cf-newbie',
}

// CF 分值兜底(从高到低取第一个命中的阈值)
const CF_BY_RATING = [
  [3000, '--cf-lgm'],
  [2400, '--cf-gm'],
  [2100, '--cf-master'],
  [1900, '--cf-cm'],
  [1600, '--cf-expert'],
  [1400, '--cf-specialist'],
  [1200, '--cf-pupil'],
]

// 牛客官方分值段(从高到低)
const NC_BY_RATING = [
  [2800, '--nc-red'],
  [2400, '--nc-orange'],
  [2000, '--nc-yellow'],
  [1500, '--nc-cyan'],
  [1100, '--nc-blue'],
  [700, '--nc-purple'],
]

const color = computed(() => {
  if (props.rating == null) return '' // 没数据不着色,走 .none 样式(未定级灰)
  if (props.platform === 'nc') {
    const hit = NC_BY_RATING.find(([min]) => props.rating >= min)
    return `var(${hit ? hit[1] : '--nc-gray'})`
  }
  // CF:段位名优先;数字 rank 没有 toLowerCase,走分值兜底(牛客误传也不会崩)
  const key = typeof props.rank === 'string' ? props.rank.toLowerCase() : ''
  if (CF_TIER_COLOR[key]) return `var(${CF_TIER_COLOR[key]})`
  const hit = CF_BY_RATING.find(([min]) => props.rating >= min)
  return `var(${hit ? hit[1] : '--cf-newbie'})`
})

// 牛客传入的是排名数字 -> 显示 #1976;CF 传入段位名 -> 原样
const rankText = computed(() => {
  if (props.rank === '' || props.rank == null) return ''
  return typeof props.rank === 'number' ? `#${props.rank}` : props.rank
})
</script>

<template>
  <span class="tier-badge" :class="{ none: rating == null }" :style="{ color }">
    <template v-if="rating == null">未定级</template>
    <template v-else>
      <b>{{ rating }}</b>
      <em v-if="rankText" class="tier-name">{{ rankText }}</em>
    </template>
  </span>
</template>

<style scoped>
.tier-badge { display: inline-flex; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; }
.tier-badge b { font-size: 15px; }
.tier-badge.none { color: #b8bdd0; font-size: 12px; }
.tier-name { font-style: normal; font-size: 11px; opacity: 0.85; }
</style>

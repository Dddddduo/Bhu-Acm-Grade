<script setup>
// 数字滚动组件:值变化时用 easeOutCubic 从旧值滚到新值(首屏从 0 滚起)
// 用在"今日概览三卡"和"今日之星题数"上 —— 实时抓取逐人写入时,数字会平滑跳变而不是硬闪
// 系统开启"减少动态效果"时直接赋值,不做动画
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  duration: { type: Number, default: 700 }, // 单次滚动时长(ms)
})

const shown = ref(0)
let raf = 0

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function roll(from, to) {
  cancelAnimationFrame(raf)
  const target = Number.isFinite(to) ? to : 0
  if (reduced() || from === target) { shown.value = target; return }
  const t0 = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - t0) / props.duration)
    const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic:先快后慢,收尾稳
    shown.value = Math.round(from + (target - from) * eased)
    if (p < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => roll(0, props.value))
watch(() => props.value, (nv, ov) => roll(ov || 0, nv || 0))
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template><span>{{ shown }}</span></template>

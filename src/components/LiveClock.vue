<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const text = ref(formatTime(new Date()))
let timer = null

function formatTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function tick() {
  text.value = formatTime(new Date())
}

onMounted(() => {
  tick()
  timer = window.setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer !== null) window.clearInterval(timer)
  timer = null
})
</script>

<template><strong class="live-clock">{{ text }}</strong></template>

<style scoped>
.live-clock {
  color: var(--command-text);
  font: 700 14px monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: .5px;
}
</style>

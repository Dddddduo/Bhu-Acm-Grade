<script setup>
// 在线成员横条:展示在今日之星下方,谁此刻在线一眼可见
// 全员合并(新生+老登),与分组切换无关;在线判定用 online.js 双信号(访问 CF 30 分钟内 / 交题 60 分钟内),每 30 秒自动重算
// 没人在线也照常展示:人数显示 0 + 「当前没有人在线」,不整块隐藏
// 第二排「最近上线」:离线但不久前上过线的人(最多 9 个,按上次在线时间倒序),灰胶囊弱显示
// 在线胶囊:头像(带呼吸绿点)+ 姓名,点胶囊直达 TA 的 CF 主页
import MemberAvatar from './MemberAvatar.vue'
import { lastSeenText } from '../online.js'

defineProps({
  rows: { type: Array, required: true }, // [{ member, stats }] —— 已筛出在线的人
  recent: { type: Array, default: () => [] }, // [{ member, stats }] —— 离线但最近上过线的人
})
</script>

<template>
  <section class="online-bar">
    <div class="ob-row">
      <span class="ob-head" :class="{ quiet: !rows.length }">
        <span class="ob-dot" :class="{ gray: !rows.length }"></span>
        当前codeforces在线 <b>{{ rows.length }}</b> 人
      </span>
      <div class="ob-list">
        <a
          v-for="r in rows"
          :key="r.member.id"
          class="ob-chip"
          :href="r.member.cf_handle ? `https://codeforces.com/profile/${r.member.cf_handle}` : null"
          target="_blank"
          rel="noopener"
          :title="`${r.member.name} 正在 Codeforces`"
        >
          <MemberAvatar :member="r.member" online />
          <span class="ob-name">{{ r.member.name }}</span>
        </a>
        <span v-if="!rows.length" class="ob-none">当前没有人在线</span>
      </div>
    </div>

    <!-- 最近上线:离线但不久前上过线,同样新生+老登合并,按上次在线时间从近到远 -->
    <div v-if="recent.length" class="ob-row ob-recent">
      <span class="ob-head ob-recent-label">
        <span class="ob-dot-off"></span>
        最近上线
      </span>
      <div class="ob-list">
        <a
          v-for="r in recent"
          :key="r.member.id"
          class="ob-chip off"
          :href="r.member.cf_handle ? `https://codeforces.com/profile/${r.member.cf_handle}` : null"
          target="_blank"
          rel="noopener"
          :title="`${r.member.name} 上次活跃:${lastSeenText(r.stats) || '?'}`"
        >
          <MemberAvatar :member="r.member" :online="false" />
          <span class="ob-name">{{ r.member.name }}</span>
          <small class="ob-ago">{{ lastSeenText(r.stats) }}</small>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.online-bar {
  display: flex; flex-direction: column; gap: 5px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 6px 10px; margin-bottom: 8px; box-shadow: var(--shadow);
}
.ob-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ob-head {
  display: inline-flex; align-items: center; gap: 5px; flex: none;
  font-size: 11px; font-weight: 700; color: var(--muted);
}
.ob-head b { color: var(--green); font-size: 13px; font-variant-numeric: tabular-nums; }
.ob-head.quiet b { color: var(--muted); }
.ob-dot {
  position: relative; width: 7px; height: 7px; flex: none;
  border-radius: 50%; background: #22c55e;
  box-shadow: 0 0 5px 1px rgba(34, 197, 94, 0.8);
}
.ob-dot.gray { background: #c3c9d9; box-shadow: none; }
.ob-dot::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: rgba(34, 197, 94, 0.5);
  animation: ob-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}
.ob-dot.gray::after { animation: none; }
@keyframes ob-ping {
  0% { transform: scale(1); opacity: 0.8; }
  70%, 100% { transform: scale(2.6); opacity: 0; }
}
.ob-none { font-size: 11px; color: var(--muted); }
.ob-list { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
.ob-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px 2px 3px; border-radius: 999px;
  border: 1px solid rgba(18, 161, 80, 0.35); background: var(--green-soft);
  color: var(--text); text-decoration: none !important;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  animation: chip-in 0.4s ease backwards;
}
.ob-chip:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(18, 161, 80, 0.2); }
:deep(.avatar) { width: 18px; height: 18px; font-size: 9px; }
.ob-name { font-size: 11px; font-weight: 600; white-space: nowrap; }
@keyframes chip-in {
  from { opacity: 0; transform: translateY(4px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.ob-recent { opacity: .78; }
.ob-recent-label { font-size: 10.5px; }
.ob-dot-off { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #c3c9d9; }
.ob-chip.off { border-color: var(--line); background: #f2f3f7; color: var(--muted); }
.ob-chip.off .ob-name { color: #5a6178; font-weight: 600; }
.ob-chip.off:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(28, 42, 90, 0.1); }
.ob-ago { font-size: 9px; color: #9aa1b5; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .ob-dot::after { animation: none; }
  .ob-chip { animation: none; transition: none; }
}
</style>

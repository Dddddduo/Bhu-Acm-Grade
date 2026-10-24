<script setup>
// 成员头像:members.json 里填了 qq 就用腾讯图床 q.qlogo.cn 拿头像,渲染成圆形
// 没填 qq / 图挂了 → 兜底显示姓名首字的灰色圆,保证每行对齐,不会出现空洞
// 尺寸由父容器 CSS 控制(用 :deep 或直接继承 class)
// online=true 时右下角挂一枚「在线」呼吸绿点:醒目优先,加白描边 + 光晕,
// 任何底色上都看得清;判定口径由父层给(见 src/online.js)
import { computed, ref, watch } from 'vue'

const props = defineProps({
  member: { type: Object, required: true },
  online: { type: Boolean, default: false },
})

const failed = ref(false)
// 换人时(member 变了)重置失败状态
watch(() => props.member.qq, () => { failed.value = false })

const src = computed(() =>
  props.member.qq ? `https://q.qlogo.cn/headimg_dl?dst_uin=${props.member.qq}&spec=640` : ''
)
const initial = computed(() => (props.member.name || '?').trim().slice(0, 1))
</script>

<template>
  <span class="avatar-wrap">
    <img
      v-if="src && !failed"
      class="avatar"
      :src="src"
      :alt="member.name"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else class="avatar avatar-fallback" aria-hidden="true">{{ initial }}</span>
    <!-- 在线点:dot 本体 + ping 扩散圈,两层动画叠出"正在呼吸"的醒目感 -->
    <span v-if="online" class="online-dot" aria-hidden="true">
      <i class="online-ping"></i>
      <i class="online-core"></i>
    </span>
  </span>
</template>

<style scoped>
.avatar-wrap { position: relative; display: inline-flex; flex: none; }
.avatar {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  object-fit: cover; display: inline-block;
  border: 1px solid var(--line); background: #eef1f8;
}
.avatar-fallback {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #8b93ab;
}
/* 右下角在线灯:定位相对头像容器,尺寸随容器字号变化不影响(固定 10px 足够醒目) */
.online-dot { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; }
.online-core {
  position: absolute; inset: 0; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 2px #fff, 0 0 6px 1px rgba(34, 197, 94, 0.9);
}
.online-ping {
  position: absolute; inset: 0; border-radius: 50%;
  background: rgba(34, 197, 94, 0.55);
  animation: online-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes online-ping {
  0% { transform: scale(1); opacity: 0.8; }
  70%, 100% { transform: scale(2.4); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .online-ping { animation: none; opacity: 0.35; transform: scale(1.6); }
}
</style>

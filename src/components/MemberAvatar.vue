<script setup>
// 成员头像:members.json 里填了 qq 就用腾讯图床 q.qlogo.cn 拿头像,渲染成圆形
// 没填 qq / 图挂了 → 兜底显示姓名首字的灰色圆,保证每行对齐,不会出现空洞
// 尺寸由父容器 CSS 控制(用 :deep 或直接继承 class)
import { computed, ref, watch } from 'vue'

const props = defineProps({
  member: { type: Object, required: true },
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
</template>

<style scoped>
.avatar {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  object-fit: cover; display: inline-block;
  border: 1px solid var(--line); background: #eef1f8;
}
.avatar-fallback {
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #8b93ab;
}</style>

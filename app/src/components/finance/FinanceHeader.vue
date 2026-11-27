<template>
  <!-- 桌面端由「生活」工作台左侧导航承担页面切换，返回按钮仅在移动端显示 -->
  <header class="flex items-center gap-2 min-h-12 lg:min-h-14">
    <button
      v-if="back"
      class="hc-hdr-btn -ml-2 lg:hidden"
      :aria-label="backLabel"
      @click="goBack"
    >
      <span class="material-symbols-outlined">arrow_back</span>
    </button>
    <div class="flex-1 min-w-0">
      <h1 class="font-headline text-lg lg:text-2xl font-semibold truncate">{{ title }}</h1>
      <p v-if="subtitle" class="mt-0.5 text-[11px] lg:text-xs text-muted font-body truncate">{{ subtitle }}</p>
    </div>
    <slot />
  </header>
</template>

<script setup>
import { useRouter } from 'vue-router'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  back: { type: Boolean, default: true },
  to: { type: String, default: '/inventory' },
  backLabel: { type: String, default: '返回生活' },
  // 优先返回来源页；无历史（如直接打开链接）时回退到 to
  useHistory: { type: Boolean, default: false },
})

const router = useRouter()

function goBack() {
  if (props.useHistory && window.history.state && window.history.state.back) {
    router.back()
    return
  }
  router.push(props.to)
}
</script>

<style scoped>
.hc-hdr-btn {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-on-surface));
  transition: background-color .15s ease;
  flex-shrink: 0;
}
.hc-hdr-btn:hover { background: rgb(var(--c-surface-alt)); }
</style>

<!-- 浏览器命令弹窗（Browser_mod popup 同款形态）：
     HA 经事件总线下发 popup 命令 → browserCommands.js 动态挂载本组件，
     内容支持已净化的 HTML（content 为字符串）或 JSON 降级展示（content 为对象）。
     独立挂载（非全局单例），因此不依赖 App 的 provide/router 上下文。 -->
<template>
  <div class="fixed inset-0 z-[75] flex items-end sm:items-center justify-center" data-bp="panel">
    <div class="absolute inset-0 bg-black/50" @click="onBackdrop"></div>

    <div class="relative w-full max-h-[88vh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-background border border-border shadow-2xl"
      :class="sizeCls">
      <!-- 头部（hideHeader 时仅保留一条拖拽/关闭条） -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <span v-if="!hideHeader" class="material-symbols-outlined text-primary text-xl shrink-0" aria-hidden="true">chat_bubble</span>
        <h2 class="flex-1 min-w-0 font-headline font-bold text-base text-on-background truncate">{{ title || '通知' }}</h2>
        <button class="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors"
          @click="close" aria-label="关闭弹窗">
          <span class="material-symbols-outlined text-2xl" aria-hidden="true">close</span>
        </button>
      </div>

      <div class="px-4 py-4 space-y-3 overflow-y-auto" data-bp="body">
        <!-- HTML 内容 -->
        <div v-if="html" class="font-body text-sm text-on-surface leading-relaxed break-words hc-popup-html" v-html="html"></div>
        <!-- 结构化内容（对象）：JSON 降级展示 -->
        <pre v-else-if="json" class="text-xs font-code text-muted whitespace-pre-wrap break-words m-0">{{ json }}</pre>
        <p v-else class="font-body text-sm text-muted">（无内容）</p>

        <!-- 关联实体：直达「更多信息」面板 -->
        <button v-if="entityId" @click="$emit('more-info', entityId)"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-colors">
          <span class="material-symbols-outlined text-base text-primary" aria-hidden="true">tune</span>
          <span class="flex-1 min-w-0 text-left truncate">{{ entityId }}</span>
          <span class="material-symbols-outlined text-base text-muted" aria-hidden="true">chevron_right</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  html: { type: String, default: '' },
  json: { type: String, default: '' },
  entityId: { type: String, default: '' },
  size: { type: String, default: 'md' },     // sm | md | lg
  hideHeader: { type: Boolean, default: false },
  dismissable: { type: Boolean, default: true }, // 遮罩点击/ESC 是否可关闭
})

const emit = defineEmits(['close', 'more-info'])

const sizeCls = computed(() => ({
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
}[props.size] || 'sm:max-w-lg'))

function close() { emit('close') }
function onBackdrop() { if (props.dismissable) close() }

function escHandler(e) {
  if (e.key === 'Escape' && props.dismissable) {
    e.stopPropagation() // 不把 ESC 透传给下层（设备抽屉等）
    close()
  }
}
onMounted(() => window.addEventListener('keydown', escHandler, true))
onUnmounted(() => window.removeEventListener('keydown', escHandler, true))
</script>

<!-- 注入的 HTML 由 HA 侧提供，样式需全局作用到子元素（v-html 内容不带头部 scope 标记） -->
<style scoped>
.hc-popup-html :deep(> *:first-child) { margin-top: 0; }
.hc-popup-html :deep(> *:last-child) { margin-bottom: 0; }
.hc-popup-html :deep(p) { margin: 0 0 0.6em; }
.hc-popup-html :deep(ul), .hc-popup-html :deep(ol) { margin: 0.4em 0 0.6em; padding-left: 1.3em; }
.hc-popup-html :deep(ul) { list-style: disc; }
.hc-popup-html :deep(ol) { list-style: decimal; }
.hc-popup-html :deep(a) { color: rgb(var(--c-primary)); text-decoration: underline; }
.hc-popup-html :deep(img) { max-width: 100%; height: auto; border-radius: 0.6rem; }
.hc-popup-html :deep(code) { font-family: ui-monospace, monospace; font-size: 0.85em; padding: 0.1em 0.35em; border-radius: 0.35rem; background: rgb(var(--c-surface-alt)); }
.hc-popup-html :deep(h1), .hc-popup-html :deep(h2), .hc-popup-html :deep(h3) { font-weight: 600; margin: 0.6em 0 0.3em; }
.hc-popup-html :deep(hr) { border: 0; border-top: 1px solid rgb(var(--c-border)); margin: 0.8em 0; }
</style>
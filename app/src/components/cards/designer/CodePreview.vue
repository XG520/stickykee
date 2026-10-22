<template>
  <div class="hc-ds-preview">
    <div class="hc-ds-preview-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="hc-ds-preview-tab"
        :class="{ 'is-on': activeTab === t.key }"
        @click="activeTab = t.key"
      >{{ t.label }}</button>
    </div>
    <div class="hc-ds-preview-body">
      <MonacoEditor
        v-if="htmlCode"
        :model-value="displayCode"
        :language="activeTab === 'css' ? 'css' : 'html'"
        theme="vs-dark"
        :height="'100%'"
        :read-only="true"
        :options="{ fontSize: 11, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }"
      />
      <div v-else class="hc-ds-preview-empty">暂无 schema</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent } from 'vue'
import { designerStore } from '@/composables/designerStore'
import { renderSchemaToHtml } from './blockDefs'

const MonacoEditor = defineAsyncComponent(() =>
  import('monaco-editor-vue3').then((m) => m.MonacoEditor || m.default),
)

const TABS = [
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
]

const activeTab = ref('html')

const htmlCode = computed(() => {
  if (!designerStore.state.schema) return ''
  try {
    const ctx = { entitySlots: {} }
    const html = renderSchemaToHtml(designerStore.state.schema, ctx)
    return html
  } catch (e) {
    console.warn('[designer] renderSchemaToHtml error:', e)
    return ''
  }
})

// Phase 2 CSS：先放骨架，Phase 3 再汇总
const cssCode = computed(() => `/* Phase 2 骨架——Phase 3 补完整主题变量与组件样式 */
.hc { /* 卡片根 */ }
.h-head { /* 顶部标题栏 */ }
.h-row { /* 底部/行 */ }
.hc-mq-wrap, .hc-mq-track { /* 跑马灯 */ }
.hc-binding-entity { /* 实体绑定 */ }
.hc-design-avatar { /* 头像 */ }
.h-badge { /* 状态角标 */ }
`)

const displayCode = computed(() => {
  if (activeTab.value === 'css') return cssCode.value
  return htmlCode.value
})
</script>

<style scoped>
.hc-ds-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  overflow: hidden;
}
.hc-ds-preview-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid rgb(255 255 255 / .08);
  flex-shrink: 0;
  background: #252526;
}
.hc-ds-preview-tab {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 500;
  color: #9d9d9d;
  border: none;
  border-right: 1px solid rgb(255 255 255 / .06);
  background: transparent;
  cursor: pointer;
  transition: color .15s, background .15s;
}
.hc-ds-preview-tab:hover {
  color: #fff;
  background: rgb(255 255 255 / .04);
}
.hc-ds-preview-tab.is-on {
  color: #fff;
  background: #1e1e1e;
  border-bottom: 2px solid #007acc;
}
.hc-ds-preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.hc-ds-preview-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #6b6b6b;
}
</style>

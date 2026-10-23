<template>
  <div class="hc-ds-preview">
    <div class="hc-ds-preview-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="hc-ds-preview-tab"
        :class="{ 'is-on': activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
        <em v-if="overridden(t.key)" class="hc-ds-dot" title="已手改：保存时以此为准">●</em>
      </button>
      <span class="hc-ds-tabs-spacer"></span>
      <button
        v-if="overridden(activeTab)"
        class="hc-ds-reset"
        title="放弃手改，回到积木生成物"
        @click="resetActive"
      >
        <span class="material-symbols-outlined">restart_alt</span>重置
      </button>
    </div>
    <div class="hc-ds-preview-body">
      <MonacoEditor
        :key="activeTab"
        :model-value="displayCode"
        :language="langOf(activeTab)"
        theme="vs-dark"
        :height="'100%'"
        :options="{ fontSize: 11, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true }"
        @update:model-value="onEdit"
      />
    </div>
    <p class="hc-ds-preview-tip">
      <template v-if="activeTab === 'js'">JS 由你手写（积木不生成脚本），保存时原样进入卡片。</template>
      <template v-else-if="overridden(activeTab)">此 {{ activeTab.toUpperCase() }} 已被手改，积木改动不再影响它；点「重置」回到生成物。</template>
      <template v-else>当前为积木生成物，实时跟随画布；直接编辑即转为手改。</template>
    </p>
  </div>
</template>

<script setup>
import { ref, computed, defineAsyncComponent } from 'vue'
import { designerStore } from '@/composables/designerStore'

const MonacoEditor = defineAsyncComponent(() =>
  import('monaco-editor-vue3').then((m) => m.MonacoEditor || m.default),
)

const TABS = [
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'js', label: 'JS' },
]

const activeTab = ref('html')

function langOf(key) {
  if (key === 'css') return 'css'
  if (key === 'js') return 'javascript'
  return 'html'
}

// html/css：手改优先，未手改跟随积木生成物；js：纯手改
const displayCode = computed(() => {
  const o = designerStore.state.codeOverride
  const key = activeTab.value
  if (key === 'js') return o.js || ''
  return o[key] ?? designerStore.generated.value[key] ?? ''
})

function overridden(key) {
  const o = designerStore.state.codeOverride
  if (key === 'js') return !!(o.js && o.js.trim())
  return o[key] !== null
}

function onEdit(v) {
  designerStore.setCode(activeTab.value, v ?? '')
}

function resetActive() {
  designerStore.resetCode(activeTab.value)
}
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
  align-items: center;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.hc-ds-dot {
  font-style: normal;
  font-size: 8px;
  color: var(--hc-color, #f5a623);
}
.hc-ds-tabs-spacer { flex: 1; }
.hc-ds-reset {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  padding: 3px 8px;
  font-size: 10px;
  color: #d4d4d4;
  background: rgb(255 255 255 / .06);
  border: 1px solid rgb(255 255 255 / .12);
  border-radius: 5px;
  cursor: pointer;
}
.hc-ds-reset:hover { background: rgb(255 255 255 / .12); }
.hc-ds-reset .material-symbols-outlined { font-size: 13px; }
.hc-ds-preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.hc-ds-preview-tip {
  flex-shrink: 0;
  margin: 0;
  padding: 5px 10px;
  font-size: 10px;
  line-height: 1.4;
  color: #8a8a8a;
  background: #252526;
  border-top: 1px solid rgb(255 255 255 / .08);
}
</style>

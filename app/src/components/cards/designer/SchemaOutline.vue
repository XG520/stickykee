<template>
  <div class="hc-layer-panel">
    <div class="hc-layer-title">图层（{{ layers.length }}）</div>
    <div v-if="layers.length" class="hc-layer-list">
      <div
        v-for="(el, i) in layers"
        :key="el.id"
        class="hc-layer-row"
        :class="{ 'is-on': el.id === selectedId }"
        @click="designerStore.select(el.id)"
      >
        <span class="material-symbols-outlined hc-layer-icon">{{ iconOf(el) }}</span>
        <span class="hc-layer-name">{{ nameOf(el) }}</span>
        <span class="hc-layer-ops" @click.stop>
          <button title="上移一层" :disabled="i === 0" @click="designerStore.reorderElement(el.id, 1)">
            <span class="material-symbols-outlined">keyboard_arrow_up</span>
          </button>
          <button title="下移一层" :disabled="i === layers.length - 1" @click="designerStore.reorderElement(el.id, -1)">
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
          </button>
          <button title="删除" class="is-danger" @click="designerStore.deleteElement(el.id)">
            <span class="material-symbols-outlined">close</span>
          </button>
        </span>
      </div>
    </div>
    <div v-else class="hc-layer-empty">
      <span class="material-symbols-outlined" style="font-size:26px;opacity:.4">layers</span>
      <span>画布还是空的，从左侧添加元素</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ELEMENT_DEFS } from './elementDefs'
import { designerStore } from '@/composables/designerStore'

const selectedId = computed(() => designerStore.state.selectedId)
// 数组末尾 = 最上层；列表倒序展示（上面的是顶层）
const layers = computed(() => [...(designerStore.state.schema?.elements || [])].reverse())

function iconOf(el) {
  return ELEMENT_DEFS[el.type]?.icon || 'help'
}
function nameOf(el) {
  const p = el.props || {}
  if (el.type === 'text') return (p.text || '文本').slice(0, 12)
  if (el.type === 'icon') return p.icon || '图标'
  if (el.type === 'entity') return p.entity || '实体状态'
  if (el.type === 'button') return p.text || p.glyph || '按钮'
  return ELEMENT_DEFS[el.type]?.label || el.type
}
</script>

<style scoped>
.hc-layer-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 8px;
  background: var(--hc-bg2, rgb(var(--c-surface-alt)));
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hc-layer-title {
  font-size: 10px;
  font-weight: 700;
  color: rgb(var(--c-muted));
  text-transform: uppercase;
  letter-spacing: .06em;
  padding: 0 4px 4px;
}
.hc-layer-list { display: flex; flex-direction: column; gap: 3px; }
.hc-layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 6px;
  border-radius: 7px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 11px;
  color: rgb(var(--c-on-surface));
  transition: background .12s, border-color .12s;
}
.hc-layer-row:hover { background: rgb(var(--c-surface)); }
.hc-layer-row.is-on {
  background: color-mix(in srgb, var(--hc-primary) 14%, rgb(var(--c-surface)));
  border-color: var(--hc-color, var(--hc-primary));
}
.hc-layer-icon { font-size: 16px; color: var(--hc-color, var(--hc-primary)); flex: none; }
.hc-layer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-layer-ops { display: none; align-items: center; gap: 1px; flex: none; }
.hc-layer-row:hover .hc-layer-ops, .hc-layer-row.is-on .hc-layer-ops { display: inline-flex; }
.hc-layer-ops button {
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: 4px;
  color: rgb(var(--c-muted)); cursor: pointer;
}
.hc-layer-ops button:hover:not(:disabled) { background: rgb(var(--c-border)); color: rgb(var(--c-on-surface)); }
.hc-layer-ops button.is-danger:hover { color: rgb(var(--c-error)); background: rgb(var(--c-error) / .12); }
.hc-layer-ops button:disabled { opacity: .3; cursor: default; }
.hc-layer-ops .material-symbols-outlined { font-size: 14px; }
.hc-layer-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgb(var(--c-muted));
  font-size: 11px;
  text-align: center;
  padding: 20px;
}
</style>

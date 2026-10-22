<template>
  <div class="hc-ds-lib">
    <div v-for="group in groups" :key="group.key" class="hc-ds-lib-group">
      <div class="hc-ds-lib-group-title">{{ group.label }}</div>
      <VueDraggable
        :model-value="group.items"
        :group="GROUP"
        :item-key="'type'"
        :clone="cloneItem"
        :ghost-class="'hc-ds-ghost'"
        :animation="140"
        class="hc-ds-lib-list"
      >
        <template #item="{ element }">
          <div class="hc-ds-lib-item" :title="element.label">
            <span class="material-symbols-outlined" :class="element.icon">{{ element.icon }}</span>
            <span class="hc-ds-lib-item-label">{{ element.label }}</span>
          </div>
        </template>
      </VueDraggable>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { BLOCK_DEFS } from './blockDefs'

// 一个 source-only 组：从库拖出时 clone（vue-draggable-plus 会调用 clone）
const GROUP = { name: 'blocks', pull: 'clone', put: false }

// 分组
const groups = computed(() => [
  {
    key: 'slot',
    label: '容器',
    items: Object.values(BLOCK_DEFS).filter((d) => d.group === 'slot'),
  },
  {
    key: 'binding',
    label: '绑定',
    items: Object.values(BLOCK_DEFS).filter((d) => d.group === 'binding'),
  },
  {
    key: 'primitive',
    label: '原子',
    items: Object.values(BLOCK_DEFS).filter((d) => d.group === 'primitive'),
  },
])

// vue-draggable-plus 在 pull:clone 时会调 clone；这里直接返回 def 本身（DefInstance 是纯对象）
function cloneItem(item) {
  return { ...item }
}
</script>

<style scoped>
.hc-ds-lib {
  height: 100%;
  overflow-y: auto;
  padding: 10px 8px;
  background: var(--hc-bg2, rgb(var(--c-surface-alt)));
  border-right: 1px solid var(--hc-border, rgb(var(--c-border)));
}
.hc-ds-lib-group { margin-bottom: 12px; }
.hc-ds-lib-group-title {
  font-size: 8px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--hc-sub, rgb(var(--c-muted)));
  text-transform: uppercase;
  padding: 2px 6px 6px;
}
.hc-ds-lib-list { display: grid; grid-template-columns: 1fr; gap: 6px; }
.hc-ds-lib-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--hc-bg, rgb(var(--c-surface)));
  border: 1px solid var(--hc-border, rgb(var(--c-border)));
  cursor: grab;
  transition: border-color .15s, transform .1s, box-shadow .15s;
  user-select: none;
  touch-action: none;
}
.hc-ds-lib-item:hover {
  border-color: var(--hc-color, var(--hc-primary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--hc-primary) 15%, transparent);
}
.hc-ds-lib-item:active { cursor: grabbing; transform: scale(.98); }
.hc-ds-lib-item .material-symbols-outlined {
  font-size: 18px;
  color: var(--hc-color, var(--hc-primary));
  flex: none;
}
.hc-ds-lib-item-label { font-size: 11px; color: var(--hc-text, rgb(var(--c-on-surface))); }
.hc-ds-ghost { opacity: 0.4; }
</style>

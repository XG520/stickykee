<template>
  <div class="hc-ds-ol-node">
    <!-- 单行节点 -->
    <div
      class="hc-ds-ol-row"
      :class="{
        'is-selected': isSelected,
        'hc-ds-ol-row-root': isRoot,
      }"
      :style="{ paddingLeft: (depth * 12 + 4) + 'px' }"
      @click.stop="onClick"
    >
      <span class="hc-ds-ol-expand" @click.stop="toggleCollapse">
        <span class="material-symbols-outlined">{{ isCollapsed && hasChildren ? 'chevron_right' : 'chevron_down' }}</span>
      </span>
      <span class="hc-ds-ol-icon material-symbols-outlined">{{ defIcon }}</span>
      <span class="hc-ds-ol-label">{{ defLabel }}</span>
      <span v-if="hasChildren" class="hc-ds-ol-count">{{ children.length }}</span>
      <span v-if="!isRoot" class="hc-ds-ol-delete" @click.stop="onDelete">
        <span class="material-symbols-outlined">close</span>
      </span>
    </div>

    <!-- 子节点列表（vue-draggable-plus） -->
    <VueDraggable
      v-if="hasSlots && !isCollapsed"
      :model-value="children"
      :group="DRAG_GROUP"
      :item-key="'id'"
      :animation="140"
      :ghost-class="'hc-ds-ol-ghost'"
      :chosen-class="'hc-ds-ol-chosen'"
      :class="'hc-ds-ol-children'"
      @change="onChange"
    >
      <template #item="{ element }">
        <OutlineNode :node="element" :depth="depth + 1" />
      </template>
    </VueDraggable>
  </div>
</template>

<script setup>
import { ref, computed, defineOptions } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { BLOCK_DEFS } from './blockDefs'
import { designerStore } from '@/composables/designerStore'

defineOptions({ name: 'OutlineNode' })

const DRAG_GROUP = { name: 'outline', put: true, pull: true }

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
})

const isCollapsed = ref(false)

const def = computed(() => BLOCK_DEFS[props.node.defType] || { label: props.node.defType, icon: 'help', slots: [] })
const defLabel = computed(() => def.value.label)
const defIcon = computed(() => def.value.icon || 'help')
const isSelected = computed(() => designerStore.state.selectedId === props.node.id)
const isRoot = computed(() => props.node.defType === 'slot_root')
const hasSlots = computed(() => (def.value.slots || []).length > 0)
const children = computed(() => props.node.children || [])
const hasChildren = computed(() => children.value.length > 0)

function onClick() {
  designerStore.select(props.node.id)
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function onDelete() {
  if (isRoot.value) return
  designerStore.deleteBlock(props.node.id)
}

function _findParent(tree, targetId, parent = null) {
  if (!tree) return null
  if (tree.id === targetId) return parent
  for (const c of tree.children || []) {
    const r = _findParent(c, targetId, tree)
    if (r !== null) return r
  }
  return null
}

function onChange(ev) {
  if (ev.added) {
    const { element } = ev.added
    if (element && !element.id && element.type && BLOCK_DEFS[element.type]) {
      // 从库拖入：新建实例
      designerStore.addBlock(props.node.id, element.type, ev.added.newIndex)
    } else if (element && element.id) {
      // 容器间移动
      const srcParent = _findParent(designerStore.state.schema, element.id)
      if (srcParent && srcParent.id !== props.node.id) {
        designerStore.moveBlock(element.id, props.node.id, ev.added.newIndex)
      }
    }
  } else if (ev.moved) {
    const { element } = ev.moved
    if (element && element.id) {
      designerStore.moveBlock(element.id, props.node.id, ev.moved.newIndex)
    }
  }
}
</script>

<style scoped>
.hc-ds-ol-node {
  display: flex;
  flex-direction: column;
}
.hc-ds-ol-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  transition: background .1s;
  user-select: none;
}
.hc-ds-ol-row:hover {
  background: rgb(var(--c-surface));
}
.hc-ds-ol-row.is-selected {
  background: color-mix(in srgb, var(--hc-color, var(--hc-primary)) 14%, transparent);
  outline: 2px solid var(--hc-color, var(--hc-primary));
}
.hc-ds-ol-row-root {
  font-weight: 700;
}
.hc-ds-ol-expand {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-muted));
  cursor: pointer;
}
.hc-ds-ol-expand .material-symbols-outlined { font-size: 14px; }
.hc-ds-ol-icon {
  font-size: 14px;
  color: var(--hc-color, var(--hc-primary));
}
.hc-ds-ol-label {
  color: rgb(var(--c-on-surface));
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hc-ds-ol-count {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  font-family: monospace;
  line-height: 14px;
}
.hc-ds-ol-delete {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: rgb(var(--c-muted));
  opacity: 0;
  transition: opacity .15s, color .15s, background .15s;
}
.hc-ds-ol-row:hover .hc-ds-ol-delete { opacity: 1; }
.hc-ds-ol-delete:hover {
  color: rgb(var(--c-error));
  background: rgb(var(--c-error) / .15);
}
.hc-ds-ol-delete .material-symbols-outlined { font-size: 14px; }
.hc-ds-ol-children {
  display: flex;
  flex-direction: column;
}
.hc-ds-ol-ghost { opacity: .45; }
.hc-ds-ol-chosen {
  box-shadow: 0 4px 12px rgb(0 0 0 / .25);
}
</style>

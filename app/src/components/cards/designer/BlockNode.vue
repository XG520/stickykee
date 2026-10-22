<template>
  <div
    class="hc-ds-block"
    :class="{ 'is-selected': isSelected, 'hc-ds-block-root': isRoot }"
    :data-id="node.id"
    @click.stop="onClick"
  >
    <!-- 拖拽 handle（容器/原子可拖；根节点不可拖） -->
    <div v-if="!isRoot" class="hc-ds-block-handle">
      <span class="hc-ds-block-dot material-symbols-outlined">drag_indicator</span>
    </div>
    <!-- 节点外壳 HTML（v-html） -->
    <div class="hc-ds-block-html" v-html="nodeHtml"></div>
    <!-- 子积木 Draggable：仅当 def 有 slots 且当前 defType 不是 primitive 时渲染 -->
    <template v-if="hasSlots">
      <VueDraggable
        :model-value="node.children"
        :group="DRAG_GROUP"
        :item-key="'id'"
        :animation="140"
        :ghost-class="'hc-ds-ghost'"
        :chosen-class="'hc-ds-chosen'"
        :class="'hc-ds-slot hc-ds-slot-' + firstSlotName"
        @change="onChange"
      >
        <template #item="{ element }">
          <BlockNode :node="element" />
        </template>
      </VueDraggable>
      <div v-if="!node.children || node.children.length === 0" class="hc-ds-slot-empty">拖积木进来</div>
    </template>
  </div>
</template>

<script setup>
import { computed, defineOptions } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { BLOCK_DEFS } from './blockDefs'
import { designerStore } from '@/composables/designerStore'
import { entityStates } from '@/store'
import { iconFor, domainGlyph } from '@/utils/entities'

defineOptions({ name: 'BlockNode' }) // 让模板能递归 <BlockNode>

const DRAG_GROUP = { name: 'blocks', put: true, pull: true }

const props = defineProps({
  node: { type: Object, required: true },
})

const def = computed(() => BLOCK_DEFS[props.node.defType] || { render: () => '', slots: [] })
// 预览 ctx：binding_entity 直接展示真实实体状态，而不是 s_<slot>_<index>_* 占位符原文
const nodeHtml = computed(() => def.value.render(props.node.props || {}, {}, {
  preview: true,
  entities: entityStates,
  iconFor: (e) => iconFor(e, domainGlyph[e?.domain] || 'widgets'),
}))
const hasSlots = computed(() => (def.value.slots || []).length > 0)
const firstSlotName = computed(() => (def.value.slots || [])[0] || 'default')
const isSelected = computed(() => designerStore.state.selectedId === props.node.id)
const isRoot = computed(() => props.node.defType === 'slot_root')

function onClick() {
  designerStore.select(props.node.id)
}

// 从 store schema 中找到某个 id 的父节点
function _findParent(tree, targetId, parent = null) {
  if (!tree) return null
  if (tree.id === targetId) return parent
  for (const c of tree.children || []) {
    const r = _findParent(c, targetId, tree)
    if (r !== null) return r
  }
  return null
}

// vue-draggable-plus change 事件处理
function onChange(ev) {
  // add: 从库拖入（ev.added.element 是 BlockDef）或跨容器移动
  if (ev.added) {
    const { element } = ev.added
    // 判断是从库拖来还是容器间移动：库拖来的没有 id，容器间移动有 id
    if (element && !element.id && element.type && BLOCK_DEFS[element.type]) {
      // 新建 BlockInstance
      designerStore.addBlock(props.node.id, element.type, ev.added.newIndex)
    } else if (element && element.id) {
      // 已有 id：容器间移动
      const srcParent = _findParent(designerStore.state.schema, element.id)
      if (srcParent && srcParent.id !== props.node.id) {
        designerStore.moveBlock(element.id, props.node.id, ev.added.newIndex)
      }
    }
  } else if (ev.moved) {
    // 同容器内排序
    const { element } = ev.moved
    if (element && element.id) {
      designerStore.moveBlock(element.id, props.node.id, ev.moved.newIndex)
    }
  }
  // remove：容器间移动时 Vue 会从旧容器的 v-model（children 数组引用）里移除，
  // 但 store 的 schema.children 数组引用和 Vue 的是同一个（我们传的是 reactive 对象），
  // 所以 store 里也自动同步了。
  // 但拖拽结束后 ev.removed 不会自动调用 designerStore.deleteBlock——那是删除按钮的活。
}
</script>

<style scoped>
.hc-ds-block {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 6px 6px 6px 18px;
  border-radius: 8px;
  border: 1px dashed transparent;
  transition: border-color .15s, background .15s;
  cursor: default;
  min-height: 28px;
}
.hc-ds-block:hover {
  border-color: rgb(var(--c-border));
  background: color-mix(in srgb, rgb(var(--c-surface-alt)) 40%, transparent);
}
.hc-ds-block.is-selected {
  border: 2px solid var(--hc-color, var(--hc-primary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--hc-primary) 20%, transparent);
  background: color-mix(in srgb, rgb(var(--c-surface-alt)) 60%, transparent);
}
.hc-ds-block-root { padding-left: 6px; }
.hc-ds-block-handle {
  position: absolute;
  left: 2px;
  top: 4px;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  opacity: 0;
  transition: opacity .15s;
}
.hc-ds-block:hover .hc-ds-block-handle,
.hc-ds-block.is-selected .hc-ds-block-handle { opacity: 1; }
.hc-ds-block-handle:active { cursor: grabbing; }
.hc-ds-block-dot { font-size: 12px; color: rgb(var(--c-muted)); }
.hc-ds-block-html {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 20px;
}
.hc-ds-slot {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  padding: 2px;
}
.hc-ds-slot-root, .hc-ds-slot-default { flex-direction: row; align-items: center; }
.hc-ds-slot-empty {
  font-size: 9px;
  color: rgb(var(--c-muted));
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px dashed rgb(var(--c-border));
  align-self: flex-start;
}
.hc-ds-ghost { opacity: 0.5; }
.hc-ds-chosen { box-shadow: 0 4px 12px rgb(0 0 0 / .2); }
</style>

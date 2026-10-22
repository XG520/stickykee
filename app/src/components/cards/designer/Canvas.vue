<template>
  <div class="hc-ds-canvas" ref="canvasRef">
    <BlockNode v-if="designerStore.state.schema" :node="designerStore.state.schema" />
    <div v-else class="hc-ds-canvas-empty">
      <span class="material-symbols-outlined" style="font-size:32px;opacity:.5">auto_awesome</span>
      <span>从左侧拖一个积木进来开始设计</span>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import BlockNode from './BlockNode.vue'
import { designerStore } from '@/composables/designerStore'

// Delete / Backspace 键删除当前选中积木
function onKeyDown(e) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && designerStore.state.selectedId) {
    // 仅当焦点不在输入框里才触发
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
    e.preventDefault()
    designerStore.deleteBlock(designerStore.state.selectedId)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})

// ESC 取消选中
onMounted(() => {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') designerStore.select(null)
  })
})
</script>

<style scoped>
.hc-ds-canvas {
  background: var(--hc-bg, rgb(var(--c-surface)));
  border-radius: 12px;
  border: 1px dashed rgb(var(--c-border));
  padding: 12px;
  min-height: 320px;
  width: 100%;
  height: 100%;
  overflow: auto;
}
.hc-ds-canvas-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 200px;
  color: rgb(var(--c-muted));
  font-size: 11px;
}
</style>

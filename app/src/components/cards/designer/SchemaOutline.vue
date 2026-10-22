<template>
  <div class="hc-ds-outline">
    <template v-if="designerStore.state.schema">
      <OutlineNode :node="designerStore.state.schema" :depth="0" />
    </template>
    <div v-else class="hc-ds-outline-empty">暂无结构</div>
  </div>
</template>

<script setup>
import { designerStore } from '@/composables/designerStore'
import OutlineNode from './OutlineNode.vue'
</script>

<style scoped>
.hc-ds-outline {
  height: 100%;
  overflow-y: auto;
  padding: 8px 4px;
  background: var(--hc-bg2, rgb(var(--c-surface-alt)));
  display: flex;
  flex-direction: column;
}
.hc-ds-outline-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: rgb(var(--c-muted));
}
</style>

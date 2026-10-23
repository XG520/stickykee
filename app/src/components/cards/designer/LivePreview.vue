<template>
  <!-- 全屏预览遮罩：与主页同一条 CodeCard 链路，真实数据实时渲染 -->
  <Teleport to="body">
    <div class="hc-lp-mask" @click.self="$emit('close')">
      <div class="hc-lp-root">
        <div class="hc-lp-bar">
          <span class="hc-lp-title">
            <span class="material-symbols-outlined">play_circle</span> 实时预览
          </span>
          <div class="hc-lp-size">
            <select v-model.number="w" class="hc-lp-select">
              <option v-for="n in 4" :key="n" :value="n">{{ n }} 列</option>
            </select>
            <span class="hc-lp-x">×</span>
            <select v-model.number="h" class="hc-lp-select">
              <option v-for="n in 4" :key="n" :value="n">{{ n }} 行</option>
            </select>
            <span class="hc-lp-meta">{{ pxW }}×{{ pxH }}px</span>
          </div>
          <button class="hc-lp-close" @click="$emit('close')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="hc-lp-stage">
          <div class="hc-lp-card" :style="{ width: pxW + 'px', height: pxH + 'px' }">
            <CodeCard :card="previewCard" :scope-id="'designer-live'" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'
import { designerStore } from '@/composables/designerStore'
import CodeCard from '@/components/cards/CodeCard.vue'

defineEmits(['close'])

// 与主页网格一致的格宽（8 列 ≈ 120px/格）
const CELL = 120

const w = ref(2)
const h = ref(2)
const pxW = computed(() => w.value * CELL)
const pxH = computed(() => h.value * CELL)

// 预览卡片：最终产物（手改优先的 html/css/js + 实体槽位映射）
const previewCard = computed(() => {
  const p = designerStore.serialize()
  return {
    type: 'custom',
    uid: 'designer-live-preview',
    html: p.html,
    css: p.css,
    js: p.js,
    w: w.value,
    h: h.value,
    icon: '',
    entity_id: '',
    entity_ids: [],
    entitySlotMap: p.entitySlotMap || {},
  }
})
</script>

<style scoped>
.hc-lp-mask {
  position: fixed;
  inset: 0;
  z-index: 10002;
  background: rgb(0 0 0 / .6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hc-lp-root {
  display: flex;
  flex-direction: column;
  width: min(96vw, 860px);
  max-height: 92vh;
  border-radius: 14px;
  background: rgb(var(--c-background));
  border: 1px solid rgb(var(--c-border));
  box-shadow: 0 16px 48px rgb(0 0 0 / .45);
  overflow: hidden;
}
.hc-lp-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  flex-shrink: 0;
}
.hc-lp-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--c-on-surface));
}
.hc-lp-title .material-symbols-outlined { font-size: 18px; color: var(--hc-color, var(--hc-primary)); }
.hc-lp-size {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.hc-lp-select {
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-lp-x { font-size: 11px; color: rgb(var(--c-faint, var(--c-muted))); }
.hc-lp-meta { font-size: 10px; color: rgb(var(--c-faint, var(--c-muted))); }
.hc-lp-close {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; background: transparent;
  color: rgb(var(--c-muted)); cursor: pointer;
}
.hc-lp-close:hover { color: rgb(var(--c-error)); background: rgb(var(--c-error) / .1); }
.hc-lp-close .material-symbols-outlined { font-size: 18px; }
.hc-lp-stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 24px;
}
.hc-lp-card {
  flex-shrink: 0;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgb(0 0 0 / .25);
}
</style>

<template>
  <!-- 画布底部浮动工具条：缩放控制（Canva 风） -->
  <div class="hc-bt">
    <button class="hc-bt-btn" :disabled="zoom <= MIN" title="缩小" @click="step(-0.25)">
      <span class="material-symbols-outlined">remove</span>
    </button>
    <button class="hc-bt-pct" title="复位 100%" @click="$emit('update:zoom', 1)">{{ pct }}%</button>
    <button class="hc-bt-btn" :disabled="zoom >= MAX" title="放大" @click="step(0.25)">
      <span class="material-symbols-outlined">add</span>
    </button>
    <span class="hc-bt-sep"></span>
    <button class="hc-bt-btn hc-bt-fit" title="适应窗口" @click="$emit('fit')">
      <span class="material-symbols-outlined">fit_screen</span>
      <span>适应</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const MIN = 0.25
const MAX = 2

const props = defineProps({ zoom: { type: Number, default: 1 } })
const emit = defineEmits(['update:zoom', 'fit'])

const pct = computed(() => Math.round(props.zoom * 100))

function step(d) {
  const z = Math.round((props.zoom + d) * 100) / 100
  emit('update:zoom', Math.max(MIN, Math.min(MAX, z)))
}
</script>

<style scoped>
.hc-bt {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-radius: 99px;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  box-shadow: 0 4px 16px rgb(0 0 0 / .25);
  z-index: 20;
}
.hc-bt-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  min-width: 26px;
  padding: 0 4px;
  border: none;
  border-radius: 99px;
  background: transparent;
  color: rgb(var(--c-on-surface));
  cursor: pointer;
  font-size: 10px;
}
.hc-bt-btn:hover:not(:disabled) { background: rgb(var(--c-surface-alt)); }
.hc-bt-btn:disabled { opacity: .35; cursor: not-allowed; }
.hc-bt-btn .material-symbols-outlined { font-size: 16px; }
.hc-bt-pct {
  min-width: 42px;
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--c-on-surface));
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  padding: 4px 2px;
}
.hc-bt-pct:hover { background: rgb(var(--c-surface-alt)); }
.hc-bt-sep { width: 1px; height: 14px; background: rgb(var(--c-border)); margin: 0 4px; }
.hc-bt-fit { padding: 0 8px; color: rgb(var(--c-muted)); }
.hc-bt-fit:hover { color: rgb(var(--c-on-surface)); }
</style>

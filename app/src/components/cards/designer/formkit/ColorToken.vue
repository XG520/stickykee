<template>
  <div class="fk-ct">
    <div class="fk-ct-row">
      <!-- 左：原生色板 -->
      <label class="fk-ct-color">
        <span class="fk-ct-color-swatch" :style="swatchStyle"></span>
        <input
        type="color"
          :value="hexValue"
          @input="onNativeColorChange"
        />
        <span class="fk-ct-color-label">取色器</span>
      </label>

      <!-- 右：手动文本 -->
      <input
        v-model="manualInput"
        class="fk-ct-manual"
        placeholder="或输入 CSS 颜色值"
        @change="onManualChange"
        @keydown.enter.prevent="onManualChange"
      />
    </div>

    <!-- 主题 token chips -->
    <div class="fk-ct-section-label">主题 Token</div>
    <div class="fk-ct-tokens">
      <button
        v-for="t in TOKEN_LIST"
        :key="t.value"
        type="button"
        class="fk-ct-token"
        :class="{ 'is-on': modelValue === t.value }"
        :title="t.value"
        @click="emit('update:modelValue', t.value)"
      >
        <span class="fk-ct-token-swatch" :style="{ background: t.cssValue }"></span>
        <span class="fk-ct-token-name">{{ t.label }}</span>
      </button>
    </div>

    <div class="fk-ct-section-label">常用 Hex</div>
    <div class="fk-ct-hex">
      <button
        v-for="h in HEX_LIST"
        :key="h"
        type="button"
        class="fk-ct-hex-btn"
        :class="{ 'is-on': modelValue === h }"
        :title="h"
        :style="{ background: h, borderColor: h }"
        @click="emit('update:modelValue', h)"
      ></button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const TOKEN_LIST = [
  { label: 'primary', value: 'var(--hc-primary)',      cssValue: 'var(--hc-primary)' },
  { label: 'success', value: 'var(--hc-success)',      cssValue: 'var(--hc-success)' },
  { label: 'warn',    value: 'var(--hc-warn)',         cssValue: 'var(--hc-warn)' },
  { label: 'info',    value: 'var(--hc-info)',         cssValue: 'var(--hc-info)' },
  { label: 'text',    value: 'var(--hc-text)',         cssValue: 'var(--hc-text)' },
  { label: 'sub',     value: 'var(--hc-sub)',          cssValue: 'var(--hc-sub)' },
  { label: 'bg',      value: 'var(--hc-bg)',           cssValue: 'var(--hc-bg)' },
  { label: 'bg2',     value: 'var(--hc-bg2)',          cssValue: 'var(--hc-bg2)' },
]

const HEX_LIST = ['#ffffff', '#000000', '#ff3366', '#2ecc71', '#3498db', '#f39c12', '#9b59b6', '#1abc9c']

const manualInput = ref(props.modelValue || '')

watch(() => props.modelValue, (v) => {
  manualInput.value = v || ''
})

const isHex = computed(() => /^#[0-9a-fA-F]{3,8}$/.test(String(props.modelValue || '').trim()))

// 原生 color input 只接受 hex，var(...) 时用默认值占位
const hexValue = computed(() => {
  if (isHex.value) return props.modelValue
  return '#3498db' // fallback
})

const swatchStyle = computed(() => {
  const v = props.modelValue || 'transparent'
  return {
    background: v,
    border: v === 'transparent' ? '1px dashed rgb(var(--c-muted))' : '1px solid rgb(var(--c-border))',
  }
})

function onNativeColorChange(e) {
  emit('update:modelValue', e.target.value)
}

function onManualChange() {
  const v = manualInput.value.trim()
  emit('update:modelValue', v)
}
</script>

<style scoped>
.fk-ct {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fk-ct-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.fk-ct-color {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  cursor: pointer;
  position: relative;
}
.fk-ct-color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: transparent;
  border: 1px solid rgb(var(--c-border));
}
.fk-ct-color input[type="color"] {
  position: absolute;
  width: 0; height: 0;
  opacity: 0;
  pointer-events: none;
}
.fk-ct-color-label {
  font-size: 10px;
  color: rgb(var(--c-muted));
}
.fk-ct-manual {
  flex: 1;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  outline: none;
  min-width: 0;
  font-family: monospace;
}
.fk-ct-manual:focus {
  border-color: var(--hc-color, var(--hc-primary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--hc-primary) 18%, transparent);
}
.fk-ct-section-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: rgb(var(--c-muted));
}
.fk-ct-tokens {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fk-ct-token {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 10px;
  font-family: monospace;
  border-radius: 4px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-muted));
  cursor: pointer;
  transition: all .15s;
  line-height: 1.3;
}
.fk-ct-token:hover {
  border-color: var(--hc-color, var(--hc-primary));
  color: rgb(var(--c-on-surface));
}
.fk-ct-token.is-on {
  background: var(--hc-color, var(--hc-primary));
  border-color: var(--hc-color, var(--hc-primary));
  color: #000;
  font-weight: 700;
}
.fk-ct-token-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgb(var(--c-border));
  flex: none;
}
.fk-ct-hex {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fk-ct-hex-btn {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  cursor: pointer;
  transition: transform .12s, box-shadow .12s;
  padding: 0;
}
.fk-ct-hex-btn:hover { transform: scale(1.15); }
.fk-ct-hex-btn.is-on {
  box-shadow: 0 0 0 2px var(--hc-color, var(--hc-primary));
}
</style>

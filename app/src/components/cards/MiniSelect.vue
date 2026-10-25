<template>
  <!-- 统一样式的小型下拉选择器：替代原生 <select>（原生展开列表无法跟随主题）。
       用法：<MiniSelect v-model="x" :options="[{value,label}]" class="宽度类" /> -->
  <button type="button" class="ms-btn" :class="[{ empty: isEmpty }, $attrs.class]" :disabled="disabled" @click="toggle">
    <span class="ms-label">{{ currentLabel || placeholder }}</span>
    <span class="material-symbols-outlined ms-caret">expand_more</span>
  </button>
  <Teleport to="body">
    <div v-if="openState" class="ms-mask" @mousedown="close" @wheel.stop>
      <div class="ms-menu" :style="menuStyle" @mousedown.stop>
        <button
          v-for="o in options"
          :key="String(o.value)"
          type="button"
          class="ms-item"
          :class="{ on: o.value === modelValue }"
          @click="pick(o)"
        >{{ o.label }}</button>
        <p v-if="!options.length" class="ms-empty">暂无可选项</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'

// Teleport 与按钮构成多根节点，class 需手动透传到按钮上
defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, default: () => [] }, // [{ value, label }]
  placeholder: { type: String, default: '请选择…' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const openState = ref(false)
const pos = reactive({ left: 0, top: 0, up: false, width: 180 })
const MENU_H = 240

const isEmpty = computed(() => props.modelValue === '' || props.modelValue === null || props.modelValue === undefined)
const currentLabel = computed(() => props.options.find((o) => o.value === props.modelValue)?.label || '')
const menuStyle = computed(() => ({
  left: pos.left + 'px',
  width: pos.width + 'px',
  ...(pos.up ? { bottom: window.innerHeight - pos.top + 'px' } : { top: pos.top + 'px' }),
}))

function toggle(e) {
  openState.value = !openState.value
  if (!openState.value) return
  const r = e?.currentTarget?.getBoundingClientRect?.()
  if (!r) return
  // 底部空间不足时向上展开
  pos.up = window.innerHeight - r.bottom < MENU_H + 12 && r.top > MENU_H + 12
  pos.left = Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 4))
  pos.top = pos.up ? r.top - 6 : r.bottom + 4
  pos.width = Math.max(r.width, 180)
}
function close() { openState.value = false }
function pick(o) {
  emit('update:modelValue', o.value)
  close()
}
</script>

<style scoped>
.ms-btn {
  height: 28px;
  padding: 0 4px 0 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  color: rgb(var(--c-on-background));
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.ms-btn:hover:not(:disabled) { border-color: rgb(var(--c-primary) / 0.4); }
.ms-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ms-btn.empty .ms-label { color: rgb(var(--c-muted)); }
.ms-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-caret { font-size: 15px; color: rgb(var(--c-muted)); flex: none; }

.ms-mask { position: fixed; inset: 0; z-index: 2147483200; }
.ms-menu {
  position: fixed;
  min-width: 150px;
  max-width: 260px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ms-item {
  padding: 6px 9px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: rgb(var(--c-on-surface));
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ms-item:hover { background: rgb(var(--c-primary) / 0.12); color: rgb(var(--c-on-background)); }
.ms-item.on { background: rgb(var(--c-primary) / 0.18); color: rgb(var(--c-primary)); }
.ms-empty { margin: 0; padding: 12px; text-align: center; font-size: 11px; color: rgb(var(--c-muted)); }
</style>

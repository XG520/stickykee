<template>
  <div ref="wrap" class="ui-sel" :class="{ disabled }">
    <button type="button" class="ui-sel-btn" :disabled="disabled" @click.stop="toggle">
      <span class="ui-sel-label" :class="{ ph: current == null }">{{ current == null ? (placeholder || '请选择') : current.label }}</span>
      <span class="material-symbols-outlined ui-sel-arrow" :class="{ open }">expand_more</span>
    </button>
    <Teleport to="body">
      <div v-if="open" class="ui-sel-pop" :style="popStyle">
        <button
          v-for="o in normalized"
          :key="String(o.value)"
          type="button"
          class="ui-sel-opt"
          :class="{ on: o.value === modelValue }"
          @click.stop="pick(o)"
        >
          <span class="ui-sel-opt-label">{{ o.label }}</span>
          <span v-if="o.value === modelValue" class="material-symbols-outlined ui-sel-check">check</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
// 全局统一下拉：弹层由应用自绘（玻璃拟态面板，跟随 --c-* 主题），替代浏览器原生 select 弹层。
// options 支持 ['a','b'] 或 [{label,value}]；v-model 值类型按 option.value 原样保留。
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: null },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])

const wrap = ref(null)
const open = ref(false)
const popStyle = ref({})

const normalized = computed(() =>
  props.options.map((o) => (o !== null && typeof o === 'object' ? o : { label: String(o), value: o })))
const current = computed(() => normalized.value.find((o) => o.value === props.modelValue) || null)

function place() {
  const el = wrap.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const maxH = Math.min(240, window.innerHeight - 16)
  const below = window.innerHeight - r.bottom - 8
  const up = below < Math.min(maxH, 180) && r.top - 8 > below
  popStyle.value = {
    left: r.left + 'px',
    width: r.width + 'px',
    ...(up
      ? { bottom: (window.innerHeight - r.top + 6) + 'px' }
      : { top: (r.bottom + 6) + 'px' }),
    maxHeight: maxH + 'px',
  }
}

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) nextTick(place)
}
function pick(o) {
  emit('update:modelValue', o.value)
  emit('change', o.value)
  open.value = false
}
function onDocClick() { open.value = false }
function onWinResize() { if (open.value) place() }
function onKey(e) { if (e.key === 'Escape') open.value = false }

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('resize', onWinResize)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('resize', onWinResize)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.ui-sel { position: relative; display: inline-flex; min-width: 0; max-width: 100%; }
.ui-sel.disabled { opacity: .5; pointer-events: none; }
/* 触发按钮：与全局 select 同一外观语言（surface-alt 底 / border 描边 / 右侧箭头） */
.ui-sel-btn {
  display: inline-flex; align-items: center; gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 5px 8px 5px 10px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background-color: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font: inherit; font-size: inherit; line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background-color .15s;
}
.ui-sel-btn:hover { border-color: rgb(var(--c-primary) / .55); }
.ui-sel-btn:focus-visible { outline: none; border-color: rgb(var(--c-border-focus)); }
.ui-sel-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-sel-label.ph { color: rgb(var(--c-muted)); }
.ui-sel-arrow { flex: none; font-size: 16px; color: rgb(var(--c-muted)); transition: transform .18s; }
.ui-sel-arrow.open { transform: rotate(180deg); }

/* 弹出面板：玻璃拟态（与全应用弹窗体系一致） */
.ui-sel-pop {
  position: fixed;
  z-index: 2100;
  min-width: 96px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  background: rgb(var(--c-surface) / .96);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 14px 40px rgb(0 0 0 / .42);
  animation: ui-sel-in .16s ease;
}
@keyframes ui-sel-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.ui-sel-opt {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: none; border-radius: 8px;
  background: none;
  color: rgb(var(--c-on-surface));
  font: inherit; font-size: 13px; line-height: 1.35;
  text-align: left;
  cursor: pointer;
  transition: background-color .12s;
}
.ui-sel-opt:hover { background: rgb(var(--c-surface-hover)); }
.ui-sel-opt-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-sel-opt.on { color: rgb(var(--c-primary)); font-weight: 700; }
.ui-sel-check { flex: none; font-size: 16px; color: rgb(var(--c-primary)); }
</style>

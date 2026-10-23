<template>
  <div class="hc-ds-panel">
    <!-- 选中状态：位置尺寸 + FormKit 属性表单 -->
    <template v-if="selected">
      <div class="hc-ds-panel-header">
        <div class="hc-ds-panel-label">
          <span class="material-symbols-outlined">{{ defIcon }}</span>
          <span>{{ defLabel }}</span>
        </div>
        <button class="hc-ds-panel-delete" @click="onDelete">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>

      <!-- 位置尺寸（自由画布变换区） -->
      <div class="hc-ds-xform">
        <label v-for="f in XFORM" :key="f.key" class="hc-ds-xform-item">
          <span>{{ f.label }}</span>
          <input
            type="number"
            :value="selected[f.key]"
            :step="f.key === 'rotate' ? 5 : 1"
            @input="onXform(f.key, $event)"
          />
        </label>
      </div>

      <FormKit
        type="form"
        :schema="formSchema"
        :model-value="selected.props || {}"
        @update:model-value="onPropsChange"
      />
      <div class="hc-ds-panel-meta">
        <div class="hc-ds-panel-meta-row">
          <span>id</span><code>{{ selected.id }}</code>
        </div>
        <div class="hc-ds-panel-meta-row">
          <span>type</span><code>{{ selected.type }}</code>
        </div>
      </div>
    </template>
    <!-- 无选中态 -->
    <div v-else class="hc-ds-panel-empty">
      <span class="material-symbols-outlined" style="font-size:28px;opacity:.4">touch_app</span>
      <span>请在画布上选中一个元素</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { FormKit } from '@formkit/vue'
import { ELEMENT_DEFS } from './elementDefs'
import { designerStore } from '@/composables/designerStore'

const XFORM = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'w', label: '宽' },
  { key: 'h', label: '高' },
  { key: 'rotate', label: '旋转' },
]

const selected = computed(() => designerStore.selected.value)
const def = computed(() => (selected.value ? ELEMENT_DEFS[selected.value.type] : null))
const defLabel = computed(() => def.value?.label || '')
const defIcon = computed(() => def.value?.icon || 'help')

// 把 propsSchema 转成 FormKit schema
const formSchema = computed(() => {
  const schema = def.value?.propsSchema || {}
  const items = Object.entries(schema).map(([key, field]) => {
    // 已知的 FormKit 类型（含自定义的三个 designer input）直接透传，
    // 其他未知 schema 映射成原生 input 类型，兜底 text
    const CUSTOM_TYPES = new Set(['entity-select', 'domain-multi-select', 'color-token'])
    const KNOWN_NATIVE = new Set(['number', 'text', 'select', 'checkbox', 'color', 'textarea', 'radio', 'range', 'email', 'password', 'tel', 'url', 'date', 'time'])
    let fkType = String(field.type || 'text')
    if (CUSTOM_TYPES.has(fkType)) {
      // 自定义 designer input 直接透传
    } else if (KNOWN_NATIVE.has(fkType)) {
      // 原生 FormKit input 直接透传
    } else {
      // 兜底成 text
      fkType = 'text'
    }
    const item = {
      name: key,
      type: fkType,
      label: field.label,
    }
    if (field.options) item.options = field.options
    if (field.min != null) item.min = field.min
    if (field.max != null) item.max = field.max
    if (field.step != null) item.step = field.step
    // 自定义 input 的额外 props 透传
    if (CUSTOM_TYPES.has(fkType)) {
      if (field.entityDomains != null) item.entityDomains = field.entityDomains
      if (field.multiple != null) item.multiple = field.multiple
    }
    return item
  })
  return items
})

function onPropsChange(val) {
  if (!selected.value) return
  designerStore.updateProps(selected.value.id, val)
}

// 位置尺寸连续输入：silent 模式，不炸 history
function onXform(key, e) {
  if (!selected.value) return
  const v = parseFloat(e.target.value)
  if (Number.isNaN(v)) return
  designerStore.updateTransform(selected.value.id, { [key]: v }, true)
}

function onDelete() {
  if (!selected.value) return
  designerStore.deleteElement(selected.value.id)
}
</script>

<style scoped>
.hc-ds-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 10px;
  background: var(--hc-bg2, rgb(var(--c-surface-alt)));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hc-ds-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: var(--hc-bg, rgb(var(--c-surface)));
  border: 1px solid var(--hc-border, rgb(var(--c-border)));
  border-radius: 8px;
}
.hc-ds-panel-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--hc-text, rgb(var(--c-on-surface)));
}
.hc-ds-panel-label .material-symbols-outlined { font-size: 18px; color: var(--hc-color, var(--hc-primary)); }
.hc-ds-panel-delete {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-muted));
  transition: color .15s, background .15s;
}
.hc-ds-panel-delete:hover { color: rgb(var(--c-error)); background: rgb(var(--c-error) / .1); }
.hc-ds-panel-delete .material-symbols-outlined { font-size: 16px; }
.hc-ds-xform {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  padding: 6px;
  background: var(--hc-bg, rgb(var(--c-surface)));
  border: 1px solid var(--hc-border, rgb(var(--c-border)));
  border-radius: 8px;
}
.hc-ds-xform-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.hc-ds-xform-item span {
  font-size: 8px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  text-transform: uppercase;
  text-align: center;
}
.hc-ds-xform-item input {
  width: 100%;
  min-width: 0;
  font-size: 10px;
  padding: 3px 2px;
  text-align: center;
  border-radius: 5px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-ds-xform-item input:focus {
  border-color: var(--hc-color, var(--hc-primary));
}
.hc-ds-panel-meta {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed rgb(var(--c-border));
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hc-ds-panel-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  color: rgb(var(--c-muted));
  font-family: monospace;
}
.hc-ds-panel-meta-row code {
  background: rgb(var(--c-surface));
  padding: 2px 4px;
  border-radius: 3px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hc-ds-panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  color: rgb(var(--c-muted));
  font-size: 11px;
  text-align: center;
  padding: 20px;
}
/* FormKit 暗色主题适配（简化） */
:deep(.formkit) {
  background: transparent;
  color: rgb(var(--c-on-surface));
}
:deep(.formkit .formkit-label) {
  font-size: 9px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
:deep(.formkit .formkit-input) {
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  width: 100%;
  outline: none;
}
:deep(.formkit .formkit-input:focus) {
  border-color: var(--hc-color, var(--hc-primary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--hc-primary) 20%, transparent);
}
:deep(.formkit .formkit-option) {
  font-size: 11px;
}
</style>

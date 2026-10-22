<template>
  <Teleport to="body">
    <div v-if="modelValue" class="hc-ds-overlay" @click.self="$emit('update:modelValue', false)">
      <div class="hc-ds-root">
        <!-- 顶栏 -->
        <header class="hc-ds-header">
          <div class="hc-ds-header-left">
            <button class="hc-ds-close" @click="$emit('update:modelValue', false)">
              <span class="material-symbols-outlined">close</span>
            </button>
            <span class="hc-ds-title">卡片设计器</span>
            <span class="hc-ds-breadcrumb" v-if="selectedBreadcrumb.length">
              <template v-for="p in selectedBreadcrumb" :key="p.id">
                <span class="hc-ds-breadcrumb-sep">/</span>
                <span class="hc-ds-breadcrumb-item">{{ p.label }}</span>
              </template>
            </span>
          </div>
          <div class="hc-ds-header-center">
            <button class="hc-ds-act" :disabled="!designerStore.canUndo.value" @click="designerStore.undo()">
              <span class="material-symbols-outlined">undo</span> 撤销
            </button>
            <button class="hc-ds-act" :disabled="!designerStore.canRedo.value" @click="designerStore.redo()">
              <span class="material-symbols-outlined">redo</span> 重做
            </button>
            <span class="hc-ds-header-sep"></span>
            <button class="hc-ds-act" :disabled="!designerStore.canUndo.value && !designerStore.canRedo.value" @click="loadEmpty">
              <span class="material-symbols-outlined">delete_sweep</span> 清空
            </button>
            <button v-for="name in presetNames" :key="name" class="hc-ds-act" @click="loadPreset(name)">预设: {{ name }}</button>
          </div>
          <div class="hc-ds-header-right">
            <button class="hc-ds-act hc-ds-act-primary" @click="onSave">
              <span class="material-symbols-outlined">save</span> 保存
            </button>
          </div>
        </header>

        <!-- 三栏 -->
        <div class="hc-ds-body">
          <BlockLibrary />
          <Canvas />
          <aside class="hc-ds-right">
            <div class="hc-ds-right-tabs">
              <button
                v-for="tab in RIGHT_TABS"
                :key="tab.key"
                class="hc-ds-right-tab"
                :class="{ 'is-on': rightTab === tab.key }"
                @click="rightTab = tab.key"
              >
                <span class="material-symbols-outlined">{{ tab.icon }}</span>
                <span>{{ tab.label }}</span>
              </button>
            </div>
            <div class="hc-ds-right-body">
              <PropertyPanel v-show="rightTab === 'props'" />
              <SchemaOutline v-show="rightTab === 'outline'" />
              <CodePreview v-show="rightTab === 'code'" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { designerStore } from '@/composables/designerStore'
import { BLOCK_DEFS, PRESETS } from './blockDefs'
import { PRESET_MAP } from './presets'
import BlockLibrary from './BlockLibrary.vue'
import Canvas from './Canvas.vue'
import PropertyPanel from './PropertyPanel.vue'
import SchemaOutline from './SchemaOutline.vue'
import CodePreview from './CodePreview.vue'

const RIGHT_TABS = [
  { key: 'props', label: '属性', icon: 'tune' },
  { key: 'outline', label: '结构', icon: 'account_tree' },
  { key: 'code', label: '预览', icon: 'code' },
]

const rightTab = ref('props')

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialSchema: { type: Object, default: null },
})

const emit = defineEmits(['update:modelValue', 'save'])

// 选中积木的面包屑路径
const selectedBreadcrumb = computed(() => {
  const id = designerStore.state.selectedId
  if (!id || !designerStore.state.schema) return []
  // 从 schema 向下找路径
  const path = []
  function walk(node, trail) {
    if (!node) return false
    const newTrail = [...trail, { id: node.id, label: BLOCK_DEFS[node.defType]?.label || node.defType }]
    if (node.id === id) { path.push(...newTrail); return true }
    for (const c of node.children || []) {
      if (walk(c, newTrail)) return true
    }
    return false
  }
  walk(designerStore.state.schema, [])
  return path
})

function loadEmpty() {
  designerStore.newEmpty()
}

// 预设列表：优先使用完整预设（presets/，Phase 3 四张卡），回退到 blockDefs 的骨架预设
const presetNames = Object.keys(PRESET_MAP).length ? Object.keys(PRESET_MAP) : Object.keys(PRESETS)
function loadPreset(name) {
  const preset = PRESET_MAP[name] || PRESETS[name]
  if (preset) designerStore.cloneFromPreset(preset())
}

function onSave() {
  const payload = designerStore.serialize()
  emit('save', payload)
  // 自动关闭（Phase 1）
  emit('update:modelValue', false)
}

// mounted 时初始化画布
onMounted(() => {
  if (props.initialSchema) {
    designerStore.cloneFromPreset(props.initialSchema)
  } else if (!designerStore.state.schema) {
    designerStore.newEmpty()
  }
})

// modelValue 变 true 时也可以用 initialSchema 覆盖
watch(() => [props.modelValue, props.initialSchema], ([open, schema]) => {
  if (open && schema) {
    designerStore.cloneFromPreset(schema)
  }
}, { deep: true })
</script>

<style scoped>
.hc-ds-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgb(0 0 0 / .55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: stretch;
  justify-content: center;
  animation: hc-ds-fade-in .18s ease-out;
}
@keyframes hc-ds-fade-in {
  from { opacity: 0; } to { opacity: 1; }
}
.hc-ds-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1280px;
  height: 100vh;
  max-height: 100vh;
  margin: 0 auto;
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
  box-shadow: 0 8px 40px rgb(0 0 0 / .4);
  animation: hc-ds-slide-up .2s ease-out;
}
@keyframes hc-ds-slide-up {
  from { transform: translateY(12px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.hc-ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  flex-shrink: 0;
  gap: 12px;
}
.hc-ds-header-left, .hc-ds-header-center, .hc-ds-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.hc-ds-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: rgb(var(--c-muted));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color .15s, background .15s;
}
.hc-ds-close:hover { color: rgb(var(--c-error)); background: rgb(var(--c-error) / .1); }
.hc-ds-close .material-symbols-outlined { font-size: 18px; }
.hc-ds-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .01em;
}
.hc-ds-breadcrumb {
  font-size: 10px;
  color: rgb(var(--c-muted));
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}
.hc-ds-breadcrumb-item {
  color: rgb(var(--c-on-surface));
}
.hc-ds-breadcrumb-sep { opacity: .5; }
.hc-ds-header-center { flex: 1; justify-content: center; }
.hc-ds-header-sep {
  width: 1px; height: 18px;
  background: rgb(var(--c-border));
  margin: 0 4px;
}
.hc-ds-act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  cursor: pointer;
  transition: border-color .15s, background .15s, opacity .15s;
}
.hc-ds-act:hover:not(:disabled) {
  border-color: var(--hc-color, var(--hc-primary));
  background: color-mix(in srgb, var(--hc-primary) 10%, rgb(var(--c-surface)));
}
.hc-ds-act:disabled { opacity: .35; cursor: not-allowed; }
.hc-ds-act .material-symbols-outlined { font-size: 15px; }
.hc-ds-act-primary {
  background: var(--hc-color, var(--hc-primary));
  border-color: var(--hc-color, var(--hc-primary));
  color: #000;
  font-weight: 600;
}
.hc-ds-act-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--hc-color, var(--hc-primary)) 85%, white);
}
.hc-ds-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
/* 子组件宽度由子组件自己控制 */
.hc-ds-right {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid rgb(var(--c-border));
  background: var(--hc-bg2, rgb(var(--c-surface-alt)));
  min-height: 0;
}
.hc-ds-right-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
}
.hc-ds-right-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 8px;
  font-size: 10px;
  font-weight: 500;
  color: rgb(var(--c-muted));
  border: none;
  background: transparent;
  cursor: pointer;
  transition: color .15s, background .15s, border-color .15s;
  border-bottom: 2px solid transparent;
}
.hc-ds-right-tab .material-symbols-outlined {
  font-size: 14px;
}
.hc-ds-right-tab:hover {
  color: rgb(var(--c-on-surface));
  background: rgb(var(--c-surface-alt));
}
.hc-ds-right-tab.is-on {
  color: var(--hc-color, var(--hc-primary));
  border-bottom-color: var(--hc-color, var(--hc-primary));
  font-weight: 600;
}
.hc-ds-right-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>

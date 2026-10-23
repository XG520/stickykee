<template>
  <!-- rail 点击展开的 280px flyout 面板：素材/文字/实体/AI/代码 -->
  <aside class="hc-flyout">
    <div class="hc-flyout-head">
      <span class="hc-flyout-title">{{ title }}</span>
      <button class="hc-flyout-close" @click="$emit('close')">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <!-- 素材：形状 / 图标 / 图片 -->
    <div v-if="type === 'assets'" class="hc-flyout-body">
      <button v-for="def in assetDefs" :key="def.type" class="hc-flyout-add" @click="add(def.type)">
        <span class="material-symbols-outlined">{{ def.icon }}</span>
        <span>{{ def.label }}</span>
      </button>
      <button class="hc-flyout-add" @click="uploadImage">
        <span class="material-symbols-outlined">upload_file</span>
        <span>上传图片</span>
      </button>
      <p class="hc-flyout-tip">点击添加到画布，拖动摆放、拉伸缩放、旋转；上传图片限 800KB 内</p>
    </div>

    <!-- 文字：预设档位 -->
    <div v-else-if="type === 'text'" class="hc-flyout-body">
      <button v-for="p in TEXT_PRESETS" :key="p.label" class="hc-flyout-text" @click="addText(p)">
        <span :style="{ fontSize: Math.min(p.props.fontSize, 18) + 'px', fontWeight: p.props.weight }">{{ p.sample }}</span>
        <span class="hc-flyout-text-lb">{{ p.label }}</span>
      </button>
      <p class="hc-flyout-tip">文字支持 {{占位符}}，属性里可改字号/字重/颜色</p>
    </div>

    <!-- 实体：实体状态 + 按钮 -->
    <div v-else-if="type === 'entity'" class="hc-flyout-body">
      <button class="hc-flyout-add" @click="add('entity')">
        <span class="material-symbols-outlined">monitor_heart</span>
        <span>实体状态</span>
      </button>
      <button class="hc-flyout-add" @click="add('button')">
        <span class="material-symbols-outlined">smart_button</span>
        <span>按钮</span>
      </button>
      <p class="hc-flyout-tip">添加后在右侧属性里绑定实体；按钮支持开关/跳转动作</p>
    </div>

    <!-- AI 设计（原面板迁入） -->
    <AiPanel v-else-if="type === 'ai'" class="hc-flyout-flex" />

    <!-- 代码（Monaco 面板迁入） -->
    <CodePreview v-else-if="type === 'code'" class="hc-flyout-flex" />
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { ELEMENT_DEFS } from './elementDefs'
import { designerStore } from '@/composables/designerStore'
import { pickImageFile } from './imageUpload'
import AiPanel from './AiPanel.vue'
import CodePreview from './CodePreview.vue'

const props = defineProps({ type: { type: String, required: true } })
defineEmits(['close'])

const TITLES = { assets: '素材', text: '文字', entity: '实体', ai: 'AI 设计', code: '代码' }
const title = computed(() => TITLES[props.type] || '')

const assetDefs = ['rect', 'icon', 'image'].map((t) => ELEMENT_DEFS[t])

const TEXT_PRESETS = [
  { label: '标题', sample: '添加标题', props: { text: '添加标题', fontSize: 16, weight: 600 } },
  { label: '正文', sample: '添加正文', props: { text: '添加正文', fontSize: 12, weight: 500 } },
  { label: '标签', sample: '添加标签', props: { text: '添加标签', fontSize: 10, weight: 500, color: 'var(--hc-sub)' } },
]

function add(type) {
  designerStore.addElement(type)
}
// 上传本地图片 → dataURL 图片元素
function uploadImage() {
  pickImageFile((dataUrl) => {
    const el = designerStore.addElement('image')
    if (el) designerStore.updateProps(el.id, { url: dataUrl })
  })
}
function addText(p) {
  const el = designerStore.addElement('text')
  if (el) designerStore.updateProps(el.id, p.props)
}
</script>

<style scoped>
.hc-flyout {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: rgb(var(--c-surface));
  border-right: 1px solid rgb(var(--c-border));
  min-height: 0;
  animation: hc-flyout-in .15s ease-out;
}
@keyframes hc-flyout-in {
  from { transform: translateX(-8px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.hc-flyout-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgb(var(--c-border));
  flex-shrink: 0;
}
.hc-flyout-title { font-size: 12px; font-weight: 700; }
.hc-flyout-close {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px; background: transparent;
  color: rgb(var(--c-muted)); cursor: pointer;
}
.hc-flyout-close:hover { color: rgb(var(--c-on-surface)); background: rgb(var(--c-surface-alt)); }
.hc-flyout-close .material-symbols-outlined { font-size: 16px; }
.hc-flyout-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hc-flyout-add {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-size: 12px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.hc-flyout-add:hover {
  border-color: var(--hc-color, var(--hc-primary));
  background: color-mix(in srgb, var(--hc-primary) 8%, rgb(var(--c-surface-alt)));
}
.hc-flyout-add .material-symbols-outlined { font-size: 22px; color: var(--hc-color, var(--hc-primary)); }
.hc-flyout-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  cursor: pointer;
  transition: border-color .15s;
}
.hc-flyout-text:hover { border-color: var(--hc-color, var(--hc-primary)); }
.hc-flyout-text-lb { font-size: 9px; color: rgb(var(--c-muted)); }
.hc-flyout-tip {
  margin: auto 2px 0;
  padding-top: 10px;
  font-size: 9px;
  line-height: 1.6;
  color: rgb(var(--c-muted));
}
.hc-flyout-flex { flex: 1; min-height: 0; overflow-y: auto; }
</style>

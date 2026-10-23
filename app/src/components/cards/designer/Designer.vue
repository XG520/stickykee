<template>
  <Teleport to="body">
    <div v-if="modelValue" class="hc-ds-overlay" @click.self="$emit('update:modelValue', false)">
      <div class="hc-ds-root">
        <!-- 顶栏（精简）：返回 / 撤销重做 / 预览+保存 -->
        <header class="hc-ds-header">
          <div class="hc-ds-header-left">
            <button class="hc-ds-close" :title="editHint" @click="$emit('update:modelValue', false)">
              <span class="material-symbols-outlined">arrow_back</span>
            </button>
            <span class="hc-ds-title">卡片设计器</span>
            <span class="hc-ds-breadcrumb" v-if="tplName">
              <span class="hc-ds-breadcrumb-sep">/</span>
              <span class="hc-ds-breadcrumb-item">{{ tplName }}</span>
            </span>
          </div>
          <div class="hc-ds-header-center">
            <button class="hc-ds-act" :disabled="!designerStore.canUndo.value" @click="designerStore.undo()">
              <span class="material-symbols-outlined">undo</span> 撤销
            </button>
            <button class="hc-ds-act" :disabled="!designerStore.canRedo.value" @click="designerStore.redo()">
              <span class="material-symbols-outlined">redo</span> 重做
            </button>
          </div>
          <div class="hc-ds-header-right">
            <button class="hc-ds-act" @click="previewOn = true">
              <span class="material-symbols-outlined">play_circle</span> 预览
            </button>
            <button class="hc-ds-act hc-ds-act-primary" @click="onSave">
              <span class="material-symbols-outlined">save</span> {{ saveLabel }}
            </button>
          </div>
        </header>

        <!-- 主体：rail + flyout + 画布 + 右侧上下文面板 -->
        <div class="hc-ds-body">
          <SideRail :active="flyout" @select="onRail" />
          <FlyoutPanel v-if="flyout" :type="flyout" @close="flyout = ''" />

          <section class="hc-ds-center">
            <Canvas />
          </section>

          <aside class="hc-ds-right">
            <!-- 图层抽屉（可折叠） -->
            <div class="hc-ds-drawer">
              <button class="hc-ds-drawer-head" @click="layersOpen = !layersOpen">
                <span class="material-symbols-outlined">layers</span>
                <span>图层</span>
                <span class="hc-ds-drawer-caret material-symbols-outlined">{{ layersOpen ? 'expand_less' : 'expand_more' }}</span>
              </button>
              <SchemaOutline v-show="layersOpen" class="hc-ds-drawer-body" />
            </div>
            <!-- 上下文面板：选中=元素属性；未选中=画布设置 -->
            <PropertyPanel v-if="hasSelection" />
            <div v-else class="hc-ds-canvas-settings">
              <div class="hc-ds-cs-title">
                <span class="material-symbols-outlined">crop_free</span> 画布设置
              </div>
              <div class="hc-ds-cs-row">
                <label class="hc-ds-cs-field">
                  <span>宽</span>
                  <select :value="gridW" @change="onGrid(+ $event.target.value, gridH)">
                    <option v-for="n in 4" :key="n" :value="n">{{ n }} 格</option>
                  </select>
                </label>
                <label class="hc-ds-cs-field">
                  <span>高</span>
                  <select :value="gridH" @change="onGrid(gridW, + $event.target.value)">
                    <option v-for="n in 4" :key="n" :value="n">{{ n }} 格</option>
                  </select>
                </label>
              </div>
              <div class="hc-ds-cs-meta">{{ canvasW }}×{{ canvasH }}px 设计基准（1 格 = 120px）</div>

              <!-- 背景：无 / 纯色 / 渐变 / 上传图片 -->
              <div class="hc-ds-cs-bg">
                <div class="hc-ds-cs-bg-head">
                  <span class="material-symbols-outlined">wallpaper</span> 背景
                </div>
                <div class="hc-ds-cs-bg-types">
                  <button
                    v-for="t in BG_TYPES"
                    :key="t.value"
                    class="hc-ds-cs-bg-type"
                    :class="{ 'is-on': bgType === t.value }"
                    @click="onBgType(t.value)"
                  >{{ t.label }}</button>
                </div>
                <!-- 纯色 -->
                <div v-if="bgType === 'color'" class="hc-ds-cs-bg-row">
                  <input type="color" class="hc-ds-cs-swatch" :value="bgHex(bg.color, '#16213e')" @change="onBg({ type: 'color', color: $event.target.value })">
                  <input type="text" class="hc-ds-cs-input" :value="bg.color || ''" placeholder="#16213e 或 CSS 变量" @change="onBg({ type: 'color', color: $event.target.value })">
                </div>
                <!-- 渐变 -->
                <div v-else-if="bgType === 'gradient'" class="hc-ds-cs-bg-col">
                  <div class="hc-ds-cs-bg-row">
                    <input type="color" class="hc-ds-cs-swatch" :value="bgHex(bg.from, '#1a2a4a')" @change="onBg({ ...bg, from: $event.target.value })">
                    <span class="hc-ds-cs-arrow material-symbols-outlined">arrow_forward</span>
                    <input type="color" class="hc-ds-cs-swatch" :value="bgHex(bg.to, '#0e1626')" @change="onBg({ ...bg, to: $event.target.value })">
                    <label class="hc-ds-cs-angle">
                      <input type="number" min="0" max="360" step="15" :value="bg.angle ?? 135" @change="onBg({ ...bg, angle: +$event.target.value })">°
                    </label>
                  </div>
                </div>
                <!-- 图片 -->
                <div v-else-if="bgType === 'image'" class="hc-ds-cs-bg-col">
                  <div class="hc-ds-cs-bg-row">
                    <button class="hc-ds-cs-upload" @click="uploadBg">
                      <span class="material-symbols-outlined">upload</span> {{ bg.image ? '重新上传' : '上传图片' }}
                    </button>
                    <select class="hc-ds-cs-fit" :value="bg.fit || 'cover'" @change="onBg({ ...bg, fit: $event.target.value })">
                      <option value="cover">裁剪填满</option>
                      <option value="contain">完整包含</option>
                    </select>
                  </div>
                  <div v-if="bg.image" class="hc-ds-cs-bg-preview" :style="{ backgroundImage: `url(${bg.image})` }"></div>
                  <input type="text" class="hc-ds-cs-input" :value="bg.image && !bg.image.startsWith('data:') ? bg.image : ''" placeholder="或粘贴图片 URL" @change="onBg({ ...bg, image: $event.target.value })">
                </div>
              </div>

              <button class="hc-ds-cs-clear" :disabled="!elementCount" @click="loadEmpty">
                <span class="material-symbols-outlined">delete_sweep</span> 清空画布
              </button>
              <p class="hc-ds-cs-tip">从左侧「素材 / 文字 / 实体」添加元素，或点「模板」返回画廊换模板。</p>
            </div>
          </aside>
        </div>
      </div>

      <!-- 全屏实时预览 -->
      <LivePreview v-if="previewOn" @close="previewOn = false" />
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { designerStore } from '@/composables/designerStore'
import { ELEMENT_DEFS } from './elementDefs'
import { pickImageFile } from './imageUpload'
import SideRail from './SideRail.vue'
import FlyoutPanel from './FlyoutPanel.vue'
import Canvas from './Canvas.vue'
import LivePreview from './LivePreview.vue'
import PropertyPanel from './PropertyPanel.vue'
import SchemaOutline from './SchemaOutline.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  initialSchema: { type: Object, default: null },
  // 纯代码卡进入设计器时的既有代码（载入到手改区，保存时代码不丢）
  initialCode: { type: Object, default: null },
  // 保存按钮文案（uid 编辑模式为「保存到卡片」）
  saveLabel: { type: String, default: '保存' },
  // 初始 flyout（画廊「AI 设计」入口传 'ai'）
  initialTab: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'save'])

// flyout 当前展开项（'' = 收起）；initialTab 兼容旧值 'ai'
const flyout = ref(props.initialTab === 'ai' ? 'ai' : '')
const previewOn = ref(false)
const layersOpen = ref(false)

const editHint = '返回'

// rail 选择：template = 返回画廊（关闭设计器，由 DesignerView 路由回画廊）
function onRail(key) {
  if (key === 'template') {
    emit('update:modelValue', false)
    return
  }
  flyout.value = flyout.value === key ? '' : key
}

// 顶栏面包屑：来源模板名
const tplName = computed(() => designerStore.state.tplMeta?.name || '')

const hasSelection = computed(() => !!designerStore.selected.value)
const elementCount = computed(() => designerStore.state.schema?.elements?.length || 0)

// 画布尺寸按卡片格数切换（1 格 = 120px 设计基准）
const canvasW = computed(() => designerStore.state.schema?.canvas?.w || 480)
const canvasH = computed(() => designerStore.state.schema?.canvas?.h || 240)
const gridW = computed(() => Math.round(canvasW.value / 120))
const gridH = computed(() => Math.round(canvasH.value / 120))
function onGrid(w, h) {
  designerStore.setCanvas(w * 120, h * 120)
}

// —— 画布背景（无/纯色/渐变/图片，存 schema.canvas.background，随产物内联） ——
const BG_TYPES = [
  { value: 'none', label: '无' },
  { value: 'color', label: '纯色' },
  { value: 'gradient', label: '渐变' },
  { value: 'image', label: '图片' },
]
const bg = computed(() => designerStore.state.schema?.canvas?.background || {})
const bgType = computed(() => bg.value.type || 'none')
// 原生 color 选择器只收 #rrggbb；CSS 变量等走文本框
function bgHex(v, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : fallback
}
function onBg(next) {
  designerStore.setBackground({ ...next, type: next.type || bgType.value })
}
function onBgType(t) {
  if (t === 'none') { designerStore.setBackground(null); return }
  const b = bg.value
  if (t === 'color') designerStore.setBackground({ type: 'color', color: b.color || '#16213e' })
  else if (t === 'gradient') designerStore.setBackground({ type: 'gradient', from: b.from || '#1a2a4a', to: b.to || '#0e1626', angle: b.angle ?? 135 })
  else if (t === 'image') designerStore.setBackground({ type: 'image', image: b.image || '', fit: b.fit || 'cover' })
}
function uploadBg() {
  pickImageFile((dataUrl) => designerStore.setBackground({ type: 'image', image: dataUrl, fit: bg.value.fit || 'cover' }))
}

function loadEmpty() {
  designerStore.newEmpty({ w: gridW.value * 120, h: gridH.value * 120 })
}

function onSave() {
  const payload = designerStore.serialize()
  emit('save', payload)
  emit('update:modelValue', false)
}

// mounted 时初始化画布
function initCanvas() {
  // v2 自由画布 schema：恢复元素；v1 积木/纯代码卡：空画布起步，代码载入手改区（代码不丢）
  if (props.initialSchema && props.initialSchema.version === 2) {
    designerStore.loadSchema(props.initialSchema)
    if (props.initialCode) applyInitialCode()
  } else if (props.initialCode) {
    designerStore.newEmpty()
    applyInitialCode()
  } else if (!designerStore.state.schema) {
    designerStore.newEmpty()
  }
}
function applyInitialCode() {
  designerStore.state.codeOverride = {
    html: props.initialCode.html ?? null,
    css: props.initialCode.css ?? null,
    js: props.initialCode.js || '',
  }
}
onMounted(initCanvas)

// modelValue 变 true 时也可以用 initialSchema 覆盖
watch(() => [props.modelValue, props.initialSchema], ([open, schema]) => {
  if (open && schema) initCanvas()
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
  height: 100vh;
  max-height: 100vh;
  margin: 0 auto;
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
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
.hc-ds-header-center { flex: 1; justify-content: center; }
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
.hc-ds-close:hover { color: rgb(var(--c-on-surface)); background: rgb(var(--c-surface-alt)); }
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
.hc-ds-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.hc-ds-right {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid rgb(var(--c-border));
  background: var(--hc-bg2, rgb(var(--c-surface-alt)));
  min-height: 0;
}
/* 图层抽屉 */
.hc-ds-drawer {
  flex-shrink: 0;
  border-bottom: 1px solid rgb(var(--c-border));
  display: flex;
  flex-direction: column;
  max-height: 40%;
  min-height: 0;
}
.hc-ds-drawer-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  background: rgb(var(--c-surface));
  color: rgb(var(--c-muted));
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.hc-ds-drawer-head:hover { color: rgb(var(--c-on-surface)); }
.hc-ds-drawer-head .material-symbols-outlined { font-size: 16px; }
.hc-ds-drawer-caret { margin-left: auto; }
.hc-ds-drawer-body {
  min-height: 0;
  overflow-y: auto;
  max-height: 220px;
}
/* 画布设置（无选中态） */
.hc-ds-canvas-settings {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hc-ds-cs-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--c-on-surface));
}
.hc-ds-cs-title .material-symbols-outlined { font-size: 16px; color: var(--hc-color, var(--hc-primary)); }
.hc-ds-cs-row { display: flex; gap: 8px; }
.hc-ds-cs-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hc-ds-cs-field span {
  font-size: 9px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  text-transform: uppercase;
}
.hc-ds-cs-field select {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-ds-cs-field select:focus { border-color: var(--hc-color, var(--hc-primary)); }
.hc-ds-cs-meta { font-size: 10px; color: rgb(var(--c-muted)); }
.hc-ds-cs-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: transparent;
  color: rgb(var(--c-muted));
  font-size: 11px;
  cursor: pointer;
}
.hc-ds-cs-clear:hover:not(:disabled) { color: rgb(var(--c-error)); border-color: rgb(var(--c-error)); }
.hc-ds-cs-clear:disabled { opacity: .4; cursor: not-allowed; }
.hc-ds-cs-clear .material-symbols-outlined { font-size: 15px; }
/* 背景编辑 */
.hc-ds-cs-bg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 10px;
  background: rgb(var(--c-surface));
}
.hc-ds-cs-bg-head {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--c-on-surface));
}
.hc-ds-cs-bg-head .material-symbols-outlined { font-size: 15px; color: var(--hc-color, var(--hc-primary)); }
.hc-ds-cs-bg-types { display: flex; gap: 4px; }
.hc-ds-cs-bg-type {
  flex: 1;
  padding: 5px 0;
  font-size: 10px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  cursor: pointer;
}
.hc-ds-cs-bg-type.is-on {
  border-color: var(--hc-color, var(--hc-primary));
  background: color-mix(in srgb, var(--hc-primary) 14%, rgb(var(--c-surface)));
  color: rgb(var(--c-on-surface));
  font-weight: 600;
}
.hc-ds-cs-bg-row { display: flex; align-items: center; gap: 6px; }
.hc-ds-cs-bg-col { display: flex; flex-direction: column; gap: 6px; }
.hc-ds-cs-swatch {
  width: 28px; height: 26px;
  padding: 0;
  border: 1px solid rgb(var(--c-border));
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  flex: none;
}
.hc-ds-cs-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-ds-cs-input:focus { border-color: var(--hc-color, var(--hc-primary)); }
.hc-ds-cs-arrow { font-size: 14px; color: rgb(var(--c-muted)); }
.hc-ds-cs-angle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: rgb(var(--c-muted));
}
.hc-ds-cs-angle input {
  width: 46px;
  font-size: 11px;
  padding: 5px 4px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-ds-cs-upload {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px;
  border-radius: 7px;
  border: 1px dashed rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-size: 11px;
  cursor: pointer;
}
.hc-ds-cs-upload:hover { border-color: var(--hc-color, var(--hc-primary)); }
.hc-ds-cs-upload .material-symbols-outlined { font-size: 15px; }
.hc-ds-cs-fit {
  font-size: 10px;
  padding: 6px 4px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-ds-cs-bg-preview {
  height: 56px;
  border-radius: 7px;
  border: 1px solid rgb(var(--c-border));
  background: center / cover no-repeat;
}
.hc-ds-cs-tip {
  margin-top: auto;
  font-size: 10px;
  line-height: 1.6;
  color: rgb(var(--c-muted));
  border-top: 1px dashed rgb(var(--c-border));
  padding-top: 10px;
}
</style>

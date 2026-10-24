<template>
  <div class="hc-fc-wrap" ref="wrapEl">
    <!-- 标尺（vue3-guides）：随缩放/滚动同步 -->
    <div class="hc-fc-corner">
      <span class="material-symbols-outlined">width_full</span>
    </div>
    <Guides ref="guidesH" type="horizontal" class="hc-fc-ruler hc-fc-ruler-h" :zoom="zoom" :unit="50" :background-color="'rgba(0,0,0,0)'" :line-color="'rgba(140,148,160,.5)'" :text-color="'rgba(140,148,160,.9)'" />
    <Guides ref="guidesV" type="vertical" class="hc-fc-ruler hc-fc-ruler-v" :zoom="zoom" :unit="50" :background-color="'rgba(0,0,0,0)'" :line-color="'rgba(140,148,160,.5)'" :text-color="'rgba(140,148,160,.9)'" />

    <!-- 视口：缩放用外层 transform:scale（不改 DOM 尺寸），Moveable :zoom 同步换算 -->
    <div class="hc-fc-viewport" ref="viewportEl" @scroll="onScroll">
      <div class="hc-fc-content" :style="contentStyle">
        <div class="hc-fc-scale" :style="{ transform: `scale(${zoom})` }">
          <!-- 画布：DOM 尺寸严格等于设计基准（canvas.w × canvas.h），元素 px 坐标即产物坐标 -->
          <div
            ref="stageEl"
            class="hc-fc-stage"
            :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
            @click="onStageClick"
            @pointerdown="onStagePointerDown"
          >
            <div class="hc-fc-render" v-html="previewHtml"></div>
          </div>
          <!-- 框选选区（设计坐标系，随父级 scale 缩放） -->
          <div v-if="marquee.on" class="hc-fc-marquee" :style="marqueeStyle"></div>
          <Moveable
            v-if="targetsEl.length"
            :target="targetsEl.length === 1 ? targetsEl[0] : targetsEl"
            :container="stageEl"
            :zoom="zoom"
            :draggable="true"
            :resizable="targetsEl.length === 1"
            :rotatable="targetsEl.length === 1"
            :throttle-drag="0"
            :throttle-resize="0"
            :throttle-rotate="0"
            :snappable="true"
            :snap-threshold="5"
            :is-display-snap-digit="true"
            :snap-gap="true"
            :snap-element="true"
            :snap-vertical="true"
            :snap-horizontal="true"
            :snap-center="true"
            :element-guidelines="guidelines"
            :vertical-guidelines="[0, canvasW / 2, canvasW]"
            :horizontal-guidelines="[0, canvasH / 2, canvasH]"
            :origin="false"
            @drag="onDrag"
            @drag-end="onDragEnd"
            @drag-group="onDragGroup"
            @drag-group-end="onDragGroupEnd"
            @resize="onResize"
            @resize-end="onResizeEnd"
            @rotate="onRotate"
            @rotate-end="onRotateEnd"
          />
        </div>
      </div>
    </div>

    <!-- 对齐/分布浮动条（有选中时出现；单选=对齐画布，多选=对齐选区） -->
    <div v-if="selCount" class="hc-fc-alignbar" @pointerdown.stop>
      <button
        v-for="a in ALIGNS"
        :key="a.mode"
        :title="a.title"
        @click="designerStore.alignElements(a.mode)"
      ><span class="material-symbols-outlined">{{ a.icon }}</span></button>
      <template v-if="selCount >= 3">
        <i class="hc-fc-ab-sep"></i>
        <button title="水平均布" @click="designerStore.distributeElements('h')"><span class="material-symbols-outlined">horizontal_distribute</span></button>
        <button title="垂直均布" @click="designerStore.distributeElements('v')"><span class="material-symbols-outlined">vertical_distribute</span></button>
      </template>
      <i class="hc-fc-ab-sep"></i>
      <span class="hc-fc-ab-n">已选 {{ selCount }} 项</span>
    </div>

    <!-- 底部缩放工具条 -->
    <BottomToolbar :zoom="zoom" @update:zoom="setZoom" @fit="fitZoom" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Moveable from 'vue3-moveable'
import Guides from 'vue3-guides'
import { designerStore } from '@/composables/designerStore'
import { renderElementsToHtml } from './elementDefs'
import { ensureDesignerCss } from './templates/catalog'
import { entityStates } from '@/store'
import BottomToolbar from './BottomToolbar.vue'

const RULER = 20 // 标尺厚度
const PAD = 32   // 画布在视口内容区的留白

const wrapEl = ref(null)
const viewportEl = ref(null)
const stageEl = ref(null)
// 选中元素的 DOM 列表（单选时长度 1，Moveable 用单目标模式以启用缩放/旋转）
const targetsEl = ref([])
const guidesH = ref(null)
const guidesV = ref(null)
// 吸附参考元素（其他元素的 DOM），重渲染后重收集
const guidelines = ref([])

const zoom = ref(1)

const canvasW = computed(() => designerStore.state.schema?.canvas?.w || 480)
const canvasH = computed(() => designerStore.state.schema?.canvas?.h || 240)

const contentStyle = computed(() => ({
  width: `${canvasW.value * zoom.value + PAD * 2}px`,
  height: `${canvasH.value * zoom.value + PAD * 2}px`,
}))

// 画布预览：px 单位 + 真实实体值（与产物同一渲染器，所见即所得）
const previewHtml = computed(() => {
  const s = designerStore.state.schema
  if (!s) return ''
  return renderElementsToHtml(s, { entitySlots: {}, preview: true, entities: entityStates, unit: 'px' })
})

// —— 缩放 ——
function setZoom(z) {
  zoom.value = Math.max(0.25, Math.min(2, z))
}
function fitZoom() {
  const vp = viewportEl.value
  if (!vp) return
  const z = Math.min((vp.clientWidth - PAD * 2) / canvasW.value, (vp.clientHeight - PAD * 2) / canvasH.value)
  setZoom(Math.round(z * 100) / 100)
  nextTick(() => {
    // 居中
    vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2)
    vp.scrollTop = Math.max(0, (vp.scrollHeight - vp.clientHeight) / 2)
    syncRulers()
  })
}

// —— 标尺同步：标尺 0 刻度对齐画布左上角 ——
function syncRulers() {
  const vp = viewportEl.value
  if (!vp) return
  guidesH.value?.scroll(vp.scrollLeft - PAD)
  guidesV.value?.scroll(vp.scrollTop - PAD)
}
function onScroll() {
  syncRulers()
}

// 选中集合 → 找其 DOM 作为 moveable target；吸附参考线排除选中项
function bindTarget() {
  const ids = designerStore.state.selectedIds
  targetsEl.value = ids
    .map((id) => stageEl.value?.querySelector(`[data-el-id="${id}"]`))
    .filter(Boolean)
  const idSet = new Set(ids)
  guidelines.value = stageEl.value
    ? [...stageEl.value.querySelectorAll('[data-el-id]')].filter((n) => !idSet.has(n.dataset.elId))
    : []
}

// —— 对齐/分布浮动条 ——
const selCount = computed(() => designerStore.state.selectedIds.length)
const ALIGNS = [
  { mode: 'left', icon: 'align_horizontal_left', title: '左对齐（单选=对齐画布）' },
  { mode: 'hcenter', icon: 'align_horizontal_center', title: '水平居中' },
  { mode: 'right', icon: 'align_horizontal_right', title: '右对齐' },
  { mode: 'top', icon: 'align_vertical_top', title: '顶对齐' },
  { mode: 'vcenter', icon: 'align_vertical_center', title: '垂直居中' },
  { mode: 'bottom', icon: 'align_vertical_bottom', title: '底对齐' },
]

// —— 框选（自绘选区：设计坐标系，天然适配缩放；避开元素与 Moveable 手柄） ——
const marquee = reactive({ on: false, x0: 0, y0: 0, x1: 0, y1: 0, additive: false })
let _marqueePending = false
let _marqueeJustEnded = false
const marqueeStyle = computed(() => ({
  left: Math.min(marquee.x0, marquee.x1) + 'px',
  top: Math.min(marquee.y0, marquee.y1) + 'px',
  width: Math.abs(marquee.x1 - marquee.x0) + 'px',
  height: Math.abs(marquee.y1 - marquee.y0) + 'px',
}))
function stagePoint(e) {
  const r = stageEl.value.getBoundingClientRect()
  return { x: (e.clientX - r.left) / zoom.value, y: (e.clientY - r.top) / zoom.value }
}
function onStagePointerDown(e) {
  if (e.button !== 0) return
  if (e.target.closest('.moveable-control-box, [class*="moveable-"]')) return // 手柄交给 Moveable
  if (e.target.closest('[data-el-id]')) return // 元素交给 click 选中 / Moveable 拖动
  const p = stagePoint(e)
  marquee.on = false
  marquee.x0 = marquee.x1 = p.x
  marquee.y0 = marquee.y1 = p.y
  marquee.additive = e.shiftKey || e.ctrlKey || e.metaKey
  _marqueePending = true
  window.addEventListener('pointermove', onMarqueeMove)
  window.addEventListener('pointerup', onMarqueeUp, { once: true })
}
function onMarqueeMove(e) {
  if (!_marqueePending) return
  e.preventDefault()
  const p = stagePoint(e)
  marquee.x1 = p.x
  marquee.y1 = p.y
  if (!marquee.on && Math.abs(marquee.x1 - marquee.x0) + Math.abs(marquee.y1 - marquee.y0) > 4) marquee.on = true
}
function onMarqueeUp() {
  window.removeEventListener('pointermove', onMarqueeMove)
  _marqueePending = false
  if (marquee.on) {
    const l = Math.min(marquee.x0, marquee.x1)
    const t = Math.min(marquee.y0, marquee.y1)
    const r = Math.max(marquee.x0, marquee.x1)
    const b = Math.max(marquee.y0, marquee.y1)
    const hits = (designerStore.state.schema?.elements || [])
      .filter((el) => el.x < r && el.x + el.w > l && el.y < b && el.y + el.h > t)
      .map((el) => el.id)
    const base = marquee.additive ? designerStore.state.selectedIds : []
    designerStore.selectMany([...base, ...hits])
    // 拖选结束后浏览器仍会派发一次 click，吞掉避免刚框选的集合被清空
    _marqueeJustEnded = true
    setTimeout(() => { _marqueeJustEnded = false }, 200)
  }
  marquee.on = false
}

function onStageClick(e) {
  if (_marqueeJustEnded) { _marqueeJustEnded = false; return }
  // 点 moveable 控制框不取消选中
  if (e.target.closest('.moveable-control-box, [class*="moveable-"]') && !e.target.closest('[data-el-id]')) return
  const el = e.target.closest('[data-el-id]')
  const id = el ? el.dataset.elId : null
  if (id && (e.shiftKey || e.ctrlKey || e.metaKey)) designerStore.toggleSelect(id)
  else designerStore.select(id)
}

// —— moveable 事件：过程中只改 DOM（不打断手势），结束才 commit store（触发重渲染） ——
function onDrag(e) {
  e.target.style.left = `${e.beforeTranslate[0]}px`
  e.target.style.top = `${e.beforeTranslate[1]}px`
}
function onDragEnd(e) {
  const id = designerStore.state.selectedId
  if (!id || !e.isDrag) return
  designerStore.updateTransform(id, { x: e.lastEvent?.beforeTranslate?.[0] ?? readX(e.target), y: e.lastEvent?.beforeTranslate?.[1] ?? readY(e.target) })
}
function readX(el) { return parseFloat(el.style.left) || 0 }
function readY(el) { return parseFloat(el.style.top) || 0 }

// —— 多选群组拖动（仅拖动；缩放/旋转保持单选模式） ——
function onDragGroup(e) {
  for (const ev of e.events) {
    ev.target.style.left = `${ev.beforeTranslate[0]}px`
    ev.target.style.top = `${ev.beforeTranslate[1]}px`
  }
}
function onDragGroupEnd(e) {
  if (!e.isDrag) return
  const evs = e.lastEvent?.events
  if (!evs?.length) return
  designerStore.updateTransforms(
    evs.map((ev) => ({ id: ev.target.dataset.elId, t: { x: ev.beforeTranslate[0], y: ev.beforeTranslate[1] } })),
  )
}

function onResize(e) {
  e.target.style.width = `${e.width}px`
  e.target.style.height = `${e.height}px`
  e.target.style.left = `${e.drag.beforeTranslate[0]}px`
  e.target.style.top = `${e.drag.beforeTranslate[1]}px`
}
function onResizeEnd(e) {
  const id = designerStore.state.selectedId
  if (!id || !e.isDrag) return
  const le = e.lastEvent
  designerStore.updateTransform(id, {
    x: le?.drag?.beforeTranslate?.[0] ?? readX(e.target),
    y: le?.drag?.beforeTranslate?.[1] ?? readY(e.target),
    w: le?.width ?? e.target.offsetWidth,
    h: le?.height ?? e.target.offsetHeight,
  })
}

let _lastRotation = 0
function onRotate(e) {
  _lastRotation = e.rotation ?? e.rotate ?? 0
  e.target.style.transform = e.transform
}
function onRotateEnd(e) {
  const id = designerStore.state.selectedId
  if (!id || !e.isDrag) return
  designerStore.updateTransform(id, { rotate: e.lastEvent?.rotation ?? _lastRotation })
}

// 选中变化 / schema 重渲染后重绑 target（v-html 会重建 DOM）
watch(() => designerStore.state.selectedIds, () => nextTick(bindTarget))
watch(previewHtml, () => nextTick(bindTarget))
watch(zoom, () => nextTick(() => {
  guidesH.value?.resize()
  guidesV.value?.resize()
  syncRulers()
}))

// —— 键盘：Ctrl+A 全选，Delete 删除，方向键微调（Shift ×10），Ctrl+Z/Y 撤销重做 ——
function onKeydown(e) {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) designerStore.redo()
    else designerStore.undo()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    designerStore.redo()
    return
  }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    designerStore.selectMany((designerStore.state.schema?.elements || []).map((el) => el.id))
    return
  }
  if (!designerStore.state.selectedIds.length) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    designerStore.deleteSelected()
    return
  }
  const step = e.shiftKey ? 10 : 1
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
  if (mv) {
    e.preventDefault()
    designerStore.moveSelectedBy(mv[0], mv[1])
  }
}

onMounted(() => {
  ensureDesignerCss() // 画布内的产物壳层样式（.hc/.h-btn 等，scoped 到 .hc-fc-stage）
  window.addEventListener('keydown', onKeydown)
  nextTick(() => {
    bindTarget()
    guidesH.value?.resize()
    guidesV.value?.resize()
    fitZoom()
  })
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.hc-fc-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: rgb(0 0 0 / .25);
}
.hc-fc-corner {
  position: absolute;
  top: 0; left: 0;
  width: 20px; height: 20px;
  background: rgb(var(--c-surface));
  border-right: 1px solid rgb(var(--c-border));
  border-bottom: 1px solid rgb(var(--c-border));
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-faint, var(--c-muted)));
}
.hc-fc-corner .material-symbols-outlined { font-size: 12px; }
.hc-fc-ruler {
  position: absolute;
  z-index: 11;
  background: rgb(var(--c-surface));
  overflow: hidden;
}
.hc-fc-ruler-h {
  top: 0; left: 20px; right: 0;
  height: 20px;
  border-bottom: 1px solid rgb(var(--c-border));
}
.hc-fc-ruler-v {
  top: 20px; left: 0; bottom: 0;
  width: 20px;
  border-right: 1px solid rgb(var(--c-border));
}
.hc-fc-viewport {
  position: absolute;
  top: 20px; left: 20px; right: 0; bottom: 0;
  overflow: auto;
}
.hc-fc-content {
  position: relative;
}
.hc-fc-scale {
  position: absolute;
  left: 32px;
  top: 32px;
  transform-origin: 0 0;
}
.hc-fc-stage {
  position: relative;
  flex: none;
  border-radius: 14px;
  box-shadow: 0 4px 24px rgb(0 0 0 / .35), 0 0 0 1px rgb(var(--c-border));
  /* 点阵网格背景：帮助目测对齐，不影响产物（渲染层在其上方） */
  background:
    radial-gradient(circle, rgb(255 255 255 / .10) 1px, transparent 1px) 0 0 / 12px 12px,
    linear-gradient(165deg, rgb(255 255 255 / .05), rgb(255 255 255 / 0) 46%),
    color-mix(in srgb, var(--hc-bg2) 72%, var(--hc-bg));
}
.hc-fc-render {
  position: absolute;
  inset: 0;
}
/* 画布内元素可点选（产物里 button 等交互元素在设计态只选中不触发） */
.hc-fc-render :deep([data-el-id]) {
  cursor: default;
  user-select: none;
}
.hc-fc-render :deep([data-el-id]:hover) {
  outline: 1px dashed color-mix(in srgb, var(--hc-primary) 60%, transparent);
  outline-offset: 1px;
}
/* 框选选区 */
.hc-fc-marquee {
  position: absolute;
  border: 1px solid var(--hc-color, var(--hc-primary));
  background: color-mix(in srgb, var(--hc-primary) 14%, transparent);
  z-index: 20;
  pointer-events: none;
}
/* 对齐/分布浮动条 */
.hc-fc-alignbar {
  position: absolute;
  top: 28px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 13;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  box-shadow: 0 6px 20px rgb(0 0 0 / .25);
}
.hc-fc-alignbar button {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; border-radius: 6px;
  color: rgb(var(--c-muted)); cursor: pointer;
}
.hc-fc-alignbar button:hover { background: rgb(var(--c-surface-alt)); color: rgb(var(--c-on-surface)); }
.hc-fc-alignbar .material-symbols-outlined { font-size: 17px; }
.hc-fc-ab-sep { width: 1px; height: 16px; background: rgb(var(--c-border)); margin: 0 4px; }
.hc-fc-ab-n { font-size: 10px; color: rgb(var(--c-muted)); white-space: nowrap; }
/* moveable 控制框主题色 */
:deep(.moveable-control-box) {
  --moveable-color: var(--hc-color, var(--hc-primary));
}
</style>

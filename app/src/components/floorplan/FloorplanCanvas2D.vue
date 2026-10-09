<!-- 户型图 2D 画布：几何层用 SVG.js 2.x 绘制，画墙/画房间用官方 svg.draw.js 插件（开源流行画图方案），设备图标用 DOM 覆盖层。
     SVG 原生支持 CSS 变量（rgb(var(--c-surface)) 等），主题色即时生效；CSS 变量颜色走 .style() 内联样式以绕过 SVG.js 的颜色解析。
     分层：
       - geoGroup（SVG）：底色、背景底图、网格、房间多边形+名称、墙体
       - draftGroup（SVG）：画墙/画房间的草稿（svg.draw.js 管理，自动落点/预览/吸附）
       - 设备 DOM 覆盖层：DeviceIconRenderer 三种图标模式（字形/图片/代码）全部可用
     坐标换算：SVG 用 viewBox(0,0,W,H) + 浏览器 xMidYMid meet 等比缩放居中；
     设备 DOM 覆盖层用 scale=min(容器/画布)、居中偏移 offsetX/Y 做同样换算，二者严格一致。
     交互：
       - 画墙/画房间：单击落点（svg.draw.js 自动吸附网格），回车或「完成」结束，Esc/「取消」放弃
       - 设备拖拽：window 级 pointermove/up 跟踪（避免 pointer 丢失） -->
<template>
  <div ref="holder" data-fp-canvas class="fp-holder relative w-full h-full select-none">
    <!-- SVG 几何层挂载点（背景/网格/房间/墙体/底图 + 绘制草稿） -->
    <div ref="svgMount" class="absolute inset-0"></div>

    <!-- 家具 DOM 覆盖层（普通家具，位于设备之下；编辑态可拖拽/选中） -->
    <div class="absolute inset-0 pointer-events-none">
      <div
        v-for="fu in floor.furniture" :key="fu.id"
        class="absolute"
        :data-key="'furniture:'+fu.id"
        :class="furnitureEditable ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : 'pointer-events-none'"
        :style="furnitureBoxStyle(fu)"
        :title="fu.name"
        @pointerdown="onFurnitureDown(fu, $event)"
        @click="onFurnitureClick(fu)"
      >
        <div
          v-if="editMode && selectedFurnitureId === fu.id"
          class="absolute rounded-md border-2 border-dashed border-info"
          style="inset:-3px"
        ></div>
        <div
          v-if="editMode && multiKeys.includes('furniture:'+fu.id)"
          class="absolute rounded-md border-2"
          style="inset:-3px;border-color:#12C2B5"
        ></div>
        <div class="w-full h-full rounded-md border border-border bg-surface-alt/60 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
          <span class="material-symbols-outlined leading-none" :style="{ fontSize: Math.max(12, Math.min(fu.w, fu.d) * scale * 0.5) + 'px', color: 'rgb(var(--c-muted))' }">{{ fu.icon }}</span>
          <span v-if="fu.w * scale > 40" class="text-[9px] font-body text-muted truncate max-w-full px-0.5">{{ fu.name }}</span>
        </div>
      </div>
    </div>

    <!-- 设备 DOM 覆盖层（穿透到下方 SVG，设备项自身可交互） -->
    <div class="absolute inset-0 pointer-events-none" :style="editMode ? 'touch-action:none' : ''">
      <div
        v-for="it in items" :key="it.dev.id"
        class="absolute pointer-events-auto"
        :data-key="'device:'+it.dev.id"
        :class="editMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'"
        :style="iconBoxStyle(it.dev)"
        @pointerdown="onDeviceDown(it.dev, $event)"
        @click="onDeviceClick(it.dev)"
      >
        <!-- 编辑态选中圈 -->
        <div
          v-if="editMode && selectedId === it.dev.id"
          class="absolute rounded-full border-2 border-dashed border-primary"
          style="inset:-6px"
        ></div>
        <!-- 多选高亮圈 -->
        <div
          v-if="editMode && multiKeys.includes('device:'+it.dev.id)"
          class="absolute rounded-full border-2"
          style="inset:-6px;border-color:#12C2B5"
        ></div>
        <div :style="{ width: '100%', height: '100%' }">
          <DeviceIconRenderer :device="it.dev" :entity="it.entity" :size="it.dev.size * scale" />
        </div>
      </div>
      <!-- 设备读数 + 名字（Home Assistant Floorplan 信息密度） -->
      <div
        v-for="it in items" :key="it.dev.id + '-lb'"
        class="absolute pointer-events-none -translate-x-1/2 flex flex-col items-center leading-tight whitespace-nowrap"
        :style="nameStyle(it.dev)"
      >
        <div v-if="readoutsOf(it).length" class="flex items-center gap-1.5">
          <span v-for="(r, ri) in readoutsOf(it)" :key="ri" class="font-body font-semibold" :style="{ fontSize: Math.max(9, 11 * scale) + 'px', color: 'rgb(var(--c-on-surface))' }">{{ r.v }}<span class="text-[0.82em] opacity-60 font-normal">{{ r.u }}</span></span>
        </div>
        <div class="font-body max-w-24 truncate" :style="{ fontSize: Math.max(8, 9 * scale) + 'px', color: 'rgb(var(--c-muted))' }">{{ truncName(it.name) }}</div>
      </div>
    </div>

    <!-- 绘制中浮层控制（画墙/画房间）：右上角，提示文字数秒后自动淡出，悬停按钮可再次查看 -->
    <div
      v-if="editMode && (tool === 'wall' || tool === 'room' || tool === 'floor')"
      class="group absolute top-3 right-3 z-10 flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background/90 backdrop-blur-sm shadow-xl"
    >
      <span
        class="pointer-events-none text-xs font-body text-muted transition-opacity duration-300"
        :class="drawHintVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'"
      >单击落点，{{ tool === 'wall' ? '回车完成墙体（需 ≥2 点）' : tool === 'floor' ? '回车闭合地板轮廓（需 ≥3 点）' : '回车闭合房间（需 ≥3 点）' }}</span>
      <button
        class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        @click="finishDraw"
      >
        <span class="material-symbols-outlined text-sm" aria-hidden="true">check</span>完成
      </button>
      <button
        class="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-surface-alt text-muted text-xs font-body hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        @click="cancelDraw"
      >
        <span class="material-symbols-outlined text-sm" aria-hidden="true">close</span>取消
      </button>
    </div>

    <!-- 缩放控件：滚轮缩放 / 中键平移的可见入口（触屏适配见 .fpz 样式） -->
    <div class="fpz absolute bottom-3 right-3 z-10 pointer-events-auto" role="group" aria-label="视图缩放">
      <button class="fpz-btn" aria-label="放大" title="放大（滚轮）" @click="zoomStep(1.25)">
        <span class="material-symbols-outlined leading-none" aria-hidden="true">add</span>
      </button>
      <button class="fpz-num" aria-label="重置缩放" title="重置视图（100%）" @click="resetView">{{ Math.round(userZoom * 100) }}</button>
      <button class="fpz-btn" aria-label="适应全部内容" title="缩放以适应全部" @click="zoomToFit">
        <span class="material-symbols-outlined leading-none" aria-hidden="true">fit_screen</span>
      </button>
      <button class="fpz-btn" aria-label="缩小" title="缩小（滚轮）" @click="zoomStep(1 / 1.25)">
        <span class="material-symbols-outlined leading-none" aria-hidden="true">remove</span>
      </button>
    </div>

    <!-- 绘制中：精确尺寸输入（酷家乐式：长度 mm + 角度 °，回车落点；点击画布仍可落点） -->
    <div
      v-if="dimPanel.visible"
      class="absolute z-20 flex items-center gap-1 rounded-lg border border-border bg-surface/95 backdrop-blur px-2 py-1 shadow-lg text-xs select-none"
      :style="{ left: dimPanel.x + 'px', top: dimPanel.y + 'px' }"
      role="group" aria-label="输入段尺寸"
      @pointerdown.stop
    >
      <span class="material-symbols-outlined text-muted text-sm" aria-hidden="true">straighten</span>
      <input
        ref="lenInput"
        v-model.number="dimPanel.lenMm"
        type="number" min="1" step="1" inputmode="numeric"
        class="w-16 bg-transparent text-on-surface text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="段长度，单位毫米" placeholder="长度"
        @keydown="onDimKeydown" @focus="dimPanel.focus = 'len'" @blur="dimPanel.focus = ''"
      >
      <span class="text-muted">mm</span>
      <span class="w-px h-3.5 bg-border" aria-hidden="true"></span>
      <input
        ref="angInput"
        v-model.number="dimPanel.angleDeg"
        type="number" step="1" inputmode="numeric"
        class="w-11 bg-transparent text-on-surface text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="段角度，单位度" placeholder="角度"
        @keydown="onDimKeydown" @focus="dimPanel.focus = 'ang'" @blur="dimPanel.focus = ''"
      >
      <span class="text-muted">°</span>
      <!-- 画房间/地板：实时面积预览 -->
      <template v-if="dimPanel.areaM2 != null">
        <span class="w-px h-3.5 bg-border" aria-hidden="true"></span>
        <span class="text-primary font-medium tabular-nums">{{ dimPanel.areaM2.toFixed(1) }}</span>
        <span class="text-muted">m²</span>
      </template>
    </div>

    <!-- 选中墙：点尺寸标注后行内改墙段长度（毫米） -->
    <div
      v-if="segEdit.visible"
      class="absolute z-20 flex items-center gap-1 rounded-lg border border-primary/50 bg-surface/95 backdrop-blur px-2 py-1 shadow-lg text-xs select-none"
      :style="{ left: segEdit.x + 'px', top: segEdit.y + 'px' }"
      role="group" aria-label="修改墙段长度"
      @pointerdown.stop
    >
      <input
        ref="segInput"
        v-model.number="segEdit.value"
        type="number" min="1" step="1" inputmode="numeric"
        class="w-16 bg-transparent text-primary text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="新墙段长度，单位毫米"
        @keydown="onSegKeydown"
      >
      <span class="text-muted">mm</span>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import SVG from 'svg.js'
import 'svg.draw.js'
import DeviceIconRenderer from './DeviceIconRenderer.vue'
import { snap, clamp, pointAlong, wallVisibleSegments, polygonArea, PLAN_SCALE } from '@/utils/floorplanDoc'
import { numVal } from '@/utils/entities'

const props = defineProps({
  canvas: { type: Object, required: true },        // doc.canvas {w,h,grid}
  floor: { type: Object, required: true },         // 当前楼层（响应式，直接改 devices[].x/y）
  items: { type: Array, default: () => [] },       // [{ dev, entity, name }]
  editMode: { type: Boolean, default: false },
  tool: { type: String, default: '' },             // '' | 'wall' | 'room' | 'door' | 'window'
  selectedId: { type: String, default: '' },
  selectedRoomId: { type: String, default: '' },
  selectedFurnitureId: { type: String, default: '' },
  selectedWallId: { type: String, default: '' },
  selectedFloorId: { type: String, default: '' },
  multiKeys: { type: Array, default: () => [] },   // 框选/多选对象键 "type:id"
})
const emit = defineEmits(['edit-begin', 'device-click', 'device-moved', 'room-click', 'blank-click', 'wall-done', 'room-done', 'floor-done', 'furniture-click', 'furniture-moved', 'opening-place', 'wall-click', 'wall-moved', 'room-moved', 'floor-click', 'floor-moved', 'marquee-select', 'context-menu', 'group-moved'])

const holder = ref(null)
const svgMount = ref(null)
const grid = computed(() => props.canvas.grid || 20)

// ---- 视图变换：fit 基准缩放 × 用户缩放 userZoom + 平移 pan（SVG viewBox 与 DOM 覆盖层共用同一换算） ----
const holderW = ref(0)
const holderH = ref(0)
const MIN_Z = 0.3, MAX_Z = 5
const userZoom = ref(1)                 // 相对 fit 缩放的倍数
const panX = ref(0), panY = ref(0)      // 屏幕像素平移

const baseScale = computed(() => {
  if (!holderW.value || !holderH.value) return 1
  return Math.min(holderW.value / props.canvas.w, holderH.value / props.canvas.h)
})
const scale = computed(() => baseScale.value * userZoom.value)
const offsetX = computed(() => (holderW.value - props.canvas.w * scale.value) / 2 + panX.value)
const offsetY = computed(() => (holderH.value - props.canvas.h * scale.value) / 2 + panY.value)

// SVG viewBox：preserveAspectRatio=none，viewBox 由缩放/平移反算，使 SVG 与 DOM 覆盖层严格对齐
function applyViewBox() {
  if (!svg) return
  const s = scale.value || 1
  svg.viewbox(-offsetX.value / s, -offsetY.value / s, holderW.value / s, holderH.value / s)
}

// 以屏幕点 (sx,sy) 为锚点缩放到 nz（指针下的画布点保持不动）
function zoomAt(sx, sy, nz) {
  nz = clamp(nz, MIN_Z, MAX_Z)
  const s0 = scale.value || 1
  const s1 = baseScale.value * nz
  const cx = (sx - offsetX.value) / s0
  const cy = (sy - offsetY.value) / s0
  panX.value = sx - (holderW.value - props.canvas.w * s1) / 2 - cx * s1
  panY.value = sy - (holderH.value - props.canvas.h * s1) / 2 - cy * s1
  userZoom.value = nz
}
function zoomStep(f) { zoomAt(holderW.value / 2, holderH.value / 2, userZoom.value * f) }
function resetView() { userZoom.value = 1; panX.value = 0; panY.value = 0 }

// 所有已绘制内容的包围盒（墙/房间/地板/家具/设备）
function contentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  const addPts = (pts) => { for (const p of pts) add(p[0], p[1]) }
  for (const w of props.floor.walls || []) addPts(w.pts)
  for (const r of props.floor.rooms || []) addPts(r.poly)
  if (props.floor.floorPoly) addPts(props.floor.floorPoly)
  for (const fu of props.floor.furniture || []) {
    const r = Math.max(fu.w, fu.d) / 2
    add(fu.x - r, fu.y - r); add(fu.x + r, fu.y + r)
  }
  for (const d of props.floor.devices || []) {
    const r = (d.size || 40) / 2
    add(d.x - r, d.y - r); add(d.x + r, d.y + r)
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

// 缩放并平移以框住全部内容
function zoomToFit() {
  const b = contentBounds()
  if (!b) { resetView(); return }
  const pad = 56
  const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY)
  const fit = Math.min((holderW.value - pad * 2) / bw, (holderH.value - pad * 2) / bh)
  const nz = clamp(fit / baseScale.value, MIN_Z, MAX_Z)
  const s1 = baseScale.value * nz
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2
  panX.value = holderW.value / 2 - cx * s1 - (holderW.value - props.canvas.w * s1) / 2
  panY.value = holderH.value / 2 - cy * s1 - (holderH.value - props.canvas.h * s1) / 2
  userZoom.value = nz
}

// ================= 选择 / 对齐原语（框选、多选、智能参考线共用） =================
const keyOf = (type, o) => `${type}:${o.id}`
function boxOfPts(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts || []) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1] }
  return { minX, minY, maxX, maxY }
}
// 全部可选择对象 {key, box, obj, type}
function allObjects() {
  const out = []
  const f = props.floor
  for (const d of f.devices || []) {
    const s = d.size || 40
    out.push({ key: keyOf('device', d), type: 'device', obj: d, box: { minX: d.x - s / 2, minY: d.y - s / 2, maxX: d.x + s / 2, maxY: d.y + s / 2 } })
  }
  for (const fu of f.furniture || []) {
    // 轴对齐包围盒（忽略旋转）
    out.push({ key: keyOf('furniture', fu), type: 'furniture', obj: fu, box: { minX: fu.x - fu.w / 2, minY: fu.y - fu.d / 2, maxX: fu.x + fu.w / 2, maxY: fu.y + fu.d / 2 } })
  }
  for (const w of f.walls || []) out.push({ key: keyOf('wall', w), type: 'wall', obj: w, box: boxOfPts(w.pts) })
  for (const r of f.rooms || []) out.push({ key: keyOf('room', r), type: 'room', obj: r, box: boxOfPts(r.poly) })
  if (f.floorPoly) {
    const fb = boxOfPts(f.floorPoly)
    out.push({ key: keyOf('floor', f), type: 'floor', obj: f, box: fb })
  }
  return out
}
function boxesIntersect(a, b) {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY)
}
function pointInBox(x, y, b) { return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY }
function pointInPoly(x, y, poly) {
  let inside = false
  for (let i = 0, j = (poly || []).length - 1; i < (poly || []).length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ---- 智能对齐参考线：以移动中包围盒 box 与其它对象的 左/中/右、上/中/下 比较，近距吸附 ----
// 返回 {dx, dy, guides:[{axis:'v'|'h', pos}]}
function computeAlign(box, excludeKeys = []) {
  const s = scale.value || 1
  const thr = 6 / s                         // 屏幕 6px 阈值换算到画布
  const others = allObjects().filter((o) => !excludeKeys.includes(o.key))
  // 候选线位置
  const vCand = new Map()                   // pos → key 标记
  const hCand = new Map()
  for (const o of others) {
    const { minX, maxX, minY, maxY } = o.box
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    vCand.set(+minX.toFixed(2), 1); vCand.set(+cx.toFixed(2), 1); vCand.set(+maxX.toFixed(2), 1)
    hCand.set(+minY.toFixed(2), 1); hCand.set(+cy.toFixed(2), 1); hCand.set(+maxY.toFixed(2), 1)
  }
  // 画布中线也作为候选
  vCand.set(props.canvas.w / 2, 1); hCand.set(props.canvas.h / 2, 1)

  const mcx = (box.minX + box.maxX) / 2, mcy = (box.minY + box.maxY) / 2
  const mTargets = [['l', box.minX], ['c', mcx], ['r', box.maxX]]
  let bestV = null, bestVD = thr
  for (const pos of vCand.keys()) {
    for (const [, mv] of mTargets) {
      const d = Math.abs(pos - mv)
      if (d <= bestVD) { bestVD = d; bestV = pos - mv }
    }
  }
  let bestH = null, bestHD = thr
  const mTargetsY = [['t', box.minY], ['c', mcy], ['b', box.maxY]]
  for (const pos of hCand.keys()) {
    for (const [, mv] of mTargetsY) {
      const d = Math.abs(pos - mv)
      if (d <= bestHD) { bestHD = d; bestH = pos - mv }
    }
  }
  const guides = []
  if (bestV) guides.push({ axis: 'v', pos: mcx + bestV })
  if (bestH) guides.push({ axis: 'h', pos: mcy + bestH })
  return { dx: bestV || 0, dy: bestH || 0, guides }
}

// ---- 设备 DOM 定位（画布坐标 → 屏幕像素） ----
function iconBoxStyle(dev) {
  const s = scale.value
  const size = dev.size * s
  return {
    left: (offsetX.value + dev.x * s - size / 2) + 'px',
    top: (offsetY.value + dev.y * s - size / 2) + 'px',
    width: size + 'px',
    height: size + 'px',
  }
}
function nameStyle(dev) {
  const s = scale.value
  return {
    left: (offsetX.value + dev.x * s) + 'px',
    top: (offsetY.value + dev.y * s + dev.size * s / 2 + 3) + 'px',
  }
}

// 家具是否可交互：编辑态且未在画墙/画房间时
const furnitureEditable = computed(() => props.editMode && props.tool !== 'wall' && props.tool !== 'room')

// 家具 DOM 定位（x/y 为中心，w×d 为占地，rotation 绕中心旋转）
function furnitureBoxStyle(fu) {
  const s = scale.value
  return {
    left: (offsetX.value + fu.x * s) + 'px',
    top: (offsetY.value + fu.y * s) + 'px',
    width: (fu.w * s) + 'px',
    height: (fu.d * s) + 'px',
    transform: `translate(-50%,-50%) rotate(${fu.rotation || 0}deg)`,
  }
}

// 屏幕坐标 → 画布坐标（用于设备拖拽与外部拖放落点）
function clientToCanvas(e) {
  const rect = holder.value ? holder.value.getBoundingClientRect() : { left: 0, top: 0 }
  const s = scale.value || 1
  return {
    x: (e.clientX - rect.left - offsetX.value) / s,
    y: (e.clientY - rect.top - offsetY.value) / s,
  }
}
defineExpose({ toSvgPoint: (e) => clientToCanvas(e), zoomToFit })

function strokeW(t) { return Math.max(3, Math.round((t || 0.12) * 40)) }
function centroid(poly) {
  const pts = poly || []
  if (!pts.length) return { x: 0, y: 0 }
  let x = 0, y = 0
  for (const p of pts) { x += p[0]; y += p[1] }
  return { x: x / pts.length, y: y / pts.length }
}
function truncName(s) { return (s || '').length > 8 ? s.slice(0, 7) + '…' : s }
function formatLen(m) { return (m >= 10 ? m.toFixed(1) : m.toFixed(2)) + 'm' }

// 设备实时读数（Home Assistant Floorplan 信息密度：图标下方并排显示温度/湿度/功率等，最多 2 个）
function roundN(v) { return v == null ? null : Math.round(v) }
function readoutsOf(it) {
  const e = it.entity
  if (!e) return []
  const a = e.attributes || {}
  const dom = e.domain || ''
  const out = []
  const add = (v, u) => { if (v != null && isFinite(v)) out.push({ v: roundN(v), u }) }
  if (dom === 'climate') {
    add(numVal(a.current_temperature) ?? numVal(a.temperature), '°C')
    add(numVal(a.humidity), '%')
    if (out.length < 2) add(numVal(a.target_temperature), '°')
  } else if (dom === 'light') {
    const b = numVal(a.brightness)
    if (b != null) add(b / 255 * 100, '%')
  } else if (dom === 'cover') {
    add(numVal(a.current_position), '%')
  } else if (dom === 'sensor') {
    const v = numVal(a.value)
    if (v != null) add(v, a.unit_of_measurement || '')
  } else {
    add(numVal(a.current_temperature) ?? numVal(a.temperature), '°C')
    add(numVal(a.humidity), '%')
    if (out.length < 2) add(numVal(a.current_power_w) ?? numVal(a.power), 'W')
  }
  return out.slice(0, 2)
}

// ---- SVG 画布（svg.js 2.x） ----
let svg = null
let geoGroup = null
let draftGroup = null
let overlayGroup = null
let measureGroup = null
let ro = null

// 参考线绘制/清除
function drawGuides(guides) {
  if (!overlayGroup) return
  overlayGroup.clear()
  const vb = svg.viewbox()
  for (const g of guides || []) {
    if (g.axis === 'v') {
      overlayGroup.line(g.pos, vb.y, g.pos, vb.y + vb.height)
        .stroke({ color: '#12C2B5', width: 1 / (scale.value || 1) })
    } else {
      overlayGroup.line(vb.x, g.pos, vb.x + vb.width, g.pos)
        .stroke({ color: '#12C2B5', width: 1 / (scale.value || 1) })
    }
  }
}
function clearOverlay() { if (overlayGroup) overlayGroup.clear() }

function redrawGeometry() {
  if (!svg || !geoGroup) return
  geoGroup.clear()
  const W = props.canvas.w, H = props.canvas.h
  const f = props.floor
  applyViewBox()

  // 底色：画布仅作为参考坐标系，不渲染为地板（data-fp-bg 仅用于空白检测）
  geoGroup.rect(W, H).attr({ rx: 8, ry: 8, 'data-fp-bg': '1' }).style({ fill: 'rgb(var(--c-surface))' })

  // 地板多边形：仅在 floorPoly 存在时显示，紫色边界线，可点击选中
  if (f.floorPoly && f.floorPoly.length >= 3) {
    const fp = f.floorPoly
    const isSel = props.selectedFloorId === f.id
    const floorPoly = geoGroup.polygon(fp)
      .fill({ color: '#B08AD9', opacity: isSel ? 0.12 : 0.05 })
      .stroke({ color: '#B08AD9', width: isSel ? 2.5 : 1.5, opacity: isSel ? 0.9 : 0.4 })
    floorPoly.node.addEventListener('pointerdown', (e) => {
      if (!props.editMode || props.tool) return
      if (e.altKey) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (tryStartGroupDrag(`floor:${f.id}`, e)) return
      e.preventDefault(); e.stopPropagation()
      emit('edit-begin')
      emit('floor-click', f)
      const p = clientToCanvas(e)
      geoDrag = { type: 'floor', obj: f, startX: p.x, startY: p.y, orig: fp.map((pt) => [pt[0], pt[1]]), moved: false }
      window.addEventListener('pointermove', onGeoMove, { passive: false })
      window.addEventListener('pointerup', onGeoUp, { once: true })
    })

    // 选中态：每个顶点显示手柄，可拖拽单个顶点修改地板形状
    if (isSel) {
      fp.forEach((pt, i) => {
        const h = geoGroup.circle(9).cx(pt[0]).cy(pt[1])
          .fill('#ffffff').stroke({ color: '#B08AD9', width: 2 })
        h.node.addEventListener('pointerdown', (e) => {
          if (!props.editMode || props.tool) return
          if (e.pointerType === 'mouse' && e.button !== 0) return
          e.preventDefault(); e.stopPropagation()
          emit('edit-begin')
          const onMove = (ev) => {
            ev.preventDefault()
            const q = clientToCanvas(ev)
            fp[i][0] = clamp(snap(q.x, grid.value), 0, props.canvas.w)
            fp[i][1] = clamp(snap(q.y, grid.value), 0, props.canvas.h)
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            emit('floor-moved', f)
          }
          window.addEventListener('pointermove', onMove, { passive: false })
          window.addEventListener('pointerup', onUp)
        })
      })
    }
  }

  // 网格（仅编辑模式）
  if (props.editMode) {
    const g = grid.value
    for (let x = g; x < W; x += g) {
      geoGroup.line(x, 0, x, H).attr({ 'stroke-width': 0.5, 'stroke-opacity': 0.5 }).style({ stroke: 'rgb(var(--c-border))' })
    }
    for (let y = g; y < H; y += g) {
      geoGroup.line(0, y, W, y).attr({ 'stroke-width': 0.5, 'stroke-opacity': 0.5 }).style({ stroke: 'rgb(var(--c-border))' })
    }
  }

  // 背景底图（位于网格之上、房间之下）
  if (f.bg && f.bg.dataUrl) {
    geoGroup.image(f.bg.dataUrl, W, H).move(0, 0).attr({ preserveAspectRatio: 'none' }).opacity(f.bg.opacity ?? 0.6)
  }

  // 房间多边形 + 名称（编辑态使用地板色显示，查看态使用标记色）
  for (const r of (f.rooms || [])) {
    const sel = props.selectedRoomId === r.id
    const c = r.color || '#F5A623'
    const fc = r.floorColor || c  // 地板色优先，回退到标记色
    const poly = geoGroup.polygon(r.poly)
      .fill({ color: fc, opacity: sel ? 0.35 : 0.12 })
      .stroke({ color: c, width: 1.5, opacity: sel ? 0.9 : 0.45 })
    poly.node.addEventListener('pointerdown', (e) => onGeoDown('room', r, e))
    poly.node.addEventListener('click', (e) => {
      // 编辑态：选中/拖拽由 pointerdown 处理，此处仅阻止冒泡到根以免误触发 blank-click
      if (props.editMode) {
        if (props.tool === 'wall' || props.tool === 'room') return
        e.stopPropagation()
        return
      }
      // 查看态：点击高亮房间
      if (props.tool === 'wall' || props.tool === 'room') return
      e.stopPropagation()
      onRoomClick(r)
    })
    const ct = centroid(r.poly)
    geoGroup.text(r.name || '')
      .attr({ x: ct.x, y: ct.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
      .fill(c).opacity(0.85).font({ size: 13, weight: '600' })
  }

  // 墙体（按门窗洞口断开）
  for (const w of (f.walls || [])) {
    const wo = (f.openings || []).filter((o) => o.wallId === w.id)
    const vis = wallVisibleSegments(w.pts, wo)
    const isSel = props.selectedWallId === w.id
    for (const sub of vis) {
      geoGroup.polyline(sub)
        .attr({
          fill: 'none',
          'stroke-width': strokeW(w.t),
          'stroke-opacity': isSel ? 1 : 0.65,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
        .style({ stroke: isSel ? 'rgb(var(--c-primary))' : 'rgb(var(--c-on-surface))' })
      // 透明命中层：更宽、易点选/拖拽；仅在编辑态可交互（点击/拖拽墙体）
      const hit = geoGroup.polyline(sub)
        .attr({
          fill: 'none',
          'stroke-width': Math.max(12, strokeW(w.t) + 8),
          'stroke-opacity': 0,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'pointer-events': props.editMode ? 'stroke' : 'none',
        })
      if (props.editMode) hit.node.style.cursor = 'grab'
      hit.node.addEventListener('pointerdown', (e) => onGeoDown('wall', w, e))
    }
    // 门窗符号
    for (const o of wo) drawOpeningSymbol(geoGroup, w, o)
  }

  // 墙段尺寸标注（仅编辑模式，计算态非存储；选中墙的标注可点击直接输入长度）
  if (props.editMode) {
    for (const w of (f.walls || [])) {
      const pts = w.pts || []
      const wallSel = props.selectedWallId === w.id
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (len < 8) continue
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const dx = -(b[1] - a[1]) / len, dy = (b[0] - a[0]) / len
        const off = 12
        const t = geoGroup.text(formatLen(len / PLAN_SCALE))
          .attr({ x: mx + dx * off, y: my + dy * off, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
          .fill('#64A6D9').opacity(0.9).font({ size: 10, weight: '500' })
        if (wallSel) {
          t.node.style.cursor = 'pointer'
          t.node.style.pointerEvents = 'all'
          t.node.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation()
            openSegEdit(w, i)
          })
        }
      }
    }
  }

  // 选中墙的编辑手柄（酷家乐式）：端点拖改形状（自动吸附其它墙端点连接），中点「+」插入顶点
  if (props.editMode && props.selectedWallId) {
    const sw = (f.walls || []).find((w) => w.id === props.selectedWallId)
    if (sw && sw.pts) {
      // 端点手柄
      sw.pts.forEach((pt, i) => {
        const h = geoGroup.circle(10).cx(pt[0]).cy(pt[1]).fill('#ffffff').stroke({ color: '#6BA3D9', width: 2 })
        h.node.addEventListener('pointerdown', (e) => startWallVertexDrag(e, sw, i))
      })
      // 中点插入手柄
      for (let i = 0; i < sw.pts.length - 1; i++) {
        const a = sw.pts[i], b = sw.pts[i + 1]
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const m = geoGroup.group()
        m.circle(11).cx(mx).cy(my).fill('#ffffff').stroke({ color: '#6BA3D9', width: 1.5 })
        m.text('+').attr({ x: mx, y: my + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
          .fill('#6BA3D9').font({ size: 11, weight: '700' })
        m.node.style.cursor = 'copy'
        m.node.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          e.preventDefault(); e.stopPropagation()
          emit('edit-begin')
          sw.pts.splice(i + 1, 0, [mx, my])
          emit('wall-moved', sw)
        })
      }
    }
  }
}

// 在洞口位置绘制门（门扇 + 开启弧）或窗（双线窗扇）符号
function drawOpeningSymbol(group, wall, o) {
  const pts = wall.pts || []
  if (pts.length < 2) return
  const w = o.width || 0
  const p0 = pointAlong(pts, o.offset)
  const p1 = pointAlong(pts, (o.offset || 0) + w)
  const th = Math.atan2(p1[1] - p0[1], p1[0] - p0[0])
  if (o.kind === 'door') {
    const leaf = [p0[0] + Math.cos(th - Math.PI / 2) * w, p0[1] + Math.sin(th - Math.PI / 2) * w]
    group.line(p0[0], p0[1], leaf[0], leaf[1])
      .attr({ 'stroke-width': 1.3, fill: 'none' })
      .style({ stroke: 'rgb(var(--c-muted))' })
    const arc = []
    const a0 = th - Math.PI / 2, a1 = th
    for (let k = 0; k <= 14; k++) {
      const a = a1 + (a0 - a1) * (k / 14)
      arc.push([p0[0] + Math.cos(a) * w, p0[1] + Math.sin(a) * w])
    }
    group.polyline(arc).attr({ 'stroke-width': 1, fill: 'none' }).style({ stroke: 'rgb(var(--c-muted))' })
  } else {
    const dist = 4
    const nx = -Math.sin(th), ny = Math.cos(th)
    group.line(p0[0] + nx * dist, p0[1] + ny * dist, p1[0] + nx * dist, p1[1] + ny * dist)
      .attr({ 'stroke-width': 1.5, fill: 'none' }).style({ stroke: 'rgb(var(--c-muted))' })
    group.line(p0[0] - nx * dist, p0[1] - ny * dist, p1[0] - nx * dist, p1[1] - ny * dist)
      .attr({ 'stroke-width': 1.5, fill: 'none' }).style({ stroke: 'rgb(var(--c-muted))' })
  }
}

// 距 (x,y) 最近且距离在阈值内的墙段，返回 { wallId, offset }
function nearestWallAt(x, y, threshold = 14) {
  const f = props.floor
  let best = null, bestD = threshold
  for (const w of (f.walls || [])) {
    const pts = w.pts || []
    let acc = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const segLen = Math.hypot(dx, dy)
      const proj = segLen ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (segLen * segLen), 0, 1) : 0
      const px = a[0] + dx * proj, py = a[1] + dy * proj
      const d = Math.hypot(x - px, y - py)
      if (d <= bestD) { bestD = d; best = { wallId: w.id, offset: acc + proj * segLen } }
      acc += segLen
    }
  }
  return best
}

function onRoomClick(r) {
  if (props.editMode && (props.tool === 'wall' || props.tool === 'room' || props.tool === 'floor')) return
  emit('room-click', r)
}
function onWallClick(w) {
  emit('wall-click', w)
}

// ---- 几何选中与拖拽（墙 / 房间，编辑态无工具时） ----
let geoDrag = null
function onGeoDown(type, obj, e) {
  if (!props.editMode) return
  if (e.altKey) return                          // Alt+左键交给画布平移
  if (props.tool) return                        // 任何绘制/洞口工具激活时不选中、不拖拽
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (tryStartGroupDrag(`${type}:${obj.id}`, e)) return
  e.preventDefault()
  e.stopPropagation()
  emit('edit-begin')                            // 拖拽/选中前记录历史快照
  if (type === 'wall') onWallClick(obj)
  else onRoomClick(obj)
  const pts = type === 'wall' ? obj.pts : obj.poly
  const p = clientToCanvas(e)
  geoDrag = { type, obj, startX: p.x, startY: p.y, orig: pts.map((pt) => [pt[0], pt[1]]), moved: false }
  window.addEventListener('pointermove', onGeoMove, { passive: false })
  window.addEventListener('pointerup', onGeoUp, { once: true })
}
function onGeoMove(e) {
  const d = geoDrag
  if (!d) return
  e.preventDefault()
  const p = clientToCanvas(e)
  // 整体平移（吸附到网格，并整体钳制在画布内）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pt of d.orig) {
    if (pt[0] < minX) minX = pt[0]
    if (pt[0] > maxX) maxX = pt[0]
    if (pt[1] < minY) minY = pt[1]
    if (pt[1] > maxY) maxY = pt[1]
  }
  let dx = snap(p.x - d.startX, grid.value)
  let dy = snap(p.y - d.startY, grid.value)
  // 智能对齐参考线
  const exKey = `${d.type}:${d.obj.id}`
  const al = computeAlign({ minX: minX + dx, minY: minY + dy, maxX: maxX + dx, maxY: maxY + dy }, [exKey])
  dx += al.dx; dy += al.dy
  dx = clamp(dx, -minX, props.canvas.w - maxX)
  dy = clamp(dy, -minY, props.canvas.h - maxY)
  if (dx !== 0 || dy !== 0) d.moved = true
  const tgt = d.type === 'wall' ? d.obj.pts : d.type === 'floor' ? d.obj.floorPoly : d.obj.poly
  d.orig.forEach((pt, i) => { tgt[i][0] = pt[0] + dx; tgt[i][1] = pt[1] + dy })
  drawGuides(al.guides)
}
function onGeoUp() {
  const d = geoDrag
  geoDrag = null
  if (!d) return
  window.removeEventListener('pointermove', onGeoMove)
  clearOverlay()
  if (d.moved) {
    if (d.type === 'wall') emit('wall-moved', d.obj)
    else if (d.type === 'floor') emit('floor-moved', d.obj)
    else emit('room-moved', d.obj)
  }
}

// 拖拽墙端点改形状：优先吸附其它墙的端点（连接成 L/T），否则吸附网格
function startWallVertexDrag(e, w, i) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault(); e.stopPropagation()
  emit('edit-begin')
  const W = props.canvas.w, H = props.canvas.h
  const onMove = (ev) => {
    ev.preventDefault()
    const q = clientToCanvas(ev)
    let nx = q.x, ny = q.y
    // 在阈值内寻找其它墙端点吸附
    const thr = grid.value * 0.75
    let best = null, bd = thr
    for (const ow of props.floor.walls) {
      if (ow.id === w.id) continue
      for (const p of (ow.pts || [])) {
        const d = Math.hypot(p[0] - nx, p[1] - ny)
        if (d < bd) { bd = d; best = p }
      }
    }
    if (best) { nx = best[0]; ny = best[1] }
    else { nx = snap(nx, grid.value); ny = snap(ny, grid.value) }
    w.pts[i][0] = clamp(nx, 0, W)
    w.pts[i][1] = clamp(ny, 0, H)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('wall-moved', w)
  }
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
}

// ---- 画墙/画房间（svg.draw.js：单击落点、自动吸附、回车/完成按钮结束） ----
let activeDraw = null
const drawHintVisible = ref(true)
let drawHintTimer = null

// ---- 精确尺寸输入（酷家乐式）：长度 mm + 角度 °，回车落点 ----
// 单位换算：PLAN_SCALE=40 画布单位/米 ⇒ 1mm = 0.04 单位 ⇒ units = mm/25
const MM_TO_UNITS = PLAN_SCALE / 1000
const dimPanel = reactive({ visible: false, x: 0, y: 0, lenMm: null, angleDeg: null, areaM2: null, focus: '' })
const lenInput = ref(null)
const angInput = ref(null)
let drawMouse = null      // 绘制期间鼠标的画布坐标（shift 时为吸附后位置）
function normAngle(a) { a %= 360; if (a < 0) a += 360; return a }
function focusLen() { const i = lenInput.value; if (i) { i.focus(); i.select() } }
// 以 a 为原点，把 b 的方向吸附到 step 度倍数（保持距离）。屏幕坐标系（y 向下）。
function snapDir(a, b, step) {
  const dx = b.x - a.x, dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return { x: b.x, y: b.y }
  const rad = Math.round(Math.atan2(dy, dx) * 180 / Math.PI / step) * step * Math.PI / 180
  return { x: a.x + Math.cos(rad) * dist, y: a.y + Math.sin(rad) * dist }
}

// 绘制期间鼠标移动：定位面板 + 用未聚焦的输入框实时显示长度/角度 + 房间/地板面积预览
function onDrawMouseMove(e) {
  if (!activeDraw || !holder.value) return
  const rect = holder.value.getBoundingClientRect()
  dimPanel.x = clamp(e.clientX - rect.left + 16, 4, rect.width - 190)
  dimPanel.y = clamp(e.clientY - rect.top + 16, 4, rect.height - 40)
  const p0 = clientToCanvas(e)
  let arr
  try { arr = activeDraw.array().valueOf() } catch { return }
  if (arr.length < 2) return
  const last = arr[arr.length - 2]        // 最后确定点（svg.draw：末点为预览）
  // Shift 正交锁定：预览与数据吸附到 45° 倍数方向（我们监听注册晚于 svg.draw，plot 会覆盖其预览）
  let p = p0
  if (e.shiftKey) {
    p = snapDir({ x: last[0], y: last[1] }, p0, 45)
    const a2 = arr.slice()
    a2[a2.length - 1] = [p.x, p.y]
    activeDraw.plot(a2)
  }
  drawMouse = p
  const dx = p.x - last[0], dy = p.y - last[1]
  if (dimPanel.focus !== 'len') dimPanel.lenMm = Math.round(Math.hypot(dx, dy) / MM_TO_UNITS)
  if (dimPanel.focus !== 'ang') dimPanel.angleDeg = Math.round(normAngle(Math.atan2(-dy, dx) * 180 / Math.PI))
  // 房间/地板：确定点 + 当前鼠标闭合的多边形面积
  if (props.tool !== 'wall') {
    const poly = arr.slice(0, -1).map((q) => [q[0], q[1]])
    poly.push([p.x, p.y])
    dimPanel.areaM2 = poly.length >= 3 ? Math.abs(polygonArea(poly)) / (PLAN_SCALE * PLAN_SCALE) : null
  }
}

// Shift 点击落点校正：svg.draw 的 point() 在 click 先执行（我们注册更晚），把刚 push 的
// 落点按「前一确定点 → 落点」方向吸附到 45° 倍数，保证预览与实际落点一致
function onDrawClick(e) {
  if (!activeDraw || !e.shiftKey) return
  let arr
  try { arr = activeDraw.array().valueOf() } catch { return }
  if (arr.length < 3) return
  const d = arr[arr.length - 3]
  const q = arr[arr.length - 1]
  const s = snapDir({ x: d[0], y: d[1] }, { x: q[0], y: q[1] }, 45)
  arr[arr.length - 2] = [s.x, s.y]
  arr[arr.length - 1] = [s.x, s.y]
  activeDraw.plot(arr)
  drawMouse = { x: s.x, y: s.y }
}

function onDimKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitTypedPoint() }
  // Escape 交给全局 onKeydown 取消绘制
}

// 按输入的长度/角度精确落点（未填项沿用鼠标当前值），然后继续绘制下一段
function commitTypedPoint() {
  if (!activeDraw || !drawMouse) return
  const lenTyped = dimPanel.lenMm !== null && dimPanel.lenMm !== '' && !Number.isNaN(Number(dimPanel.lenMm))
  const angTyped = dimPanel.angleDeg !== null && dimPanel.angleDeg !== '' && !Number.isNaN(Number(dimPanel.angleDeg))
  let arr
  try { arr = activeDraw.array().valueOf() } catch { return }
  if (arr.length < 2) return
  const last = arr[arr.length - 2]
  let ang
  if (angTyped) ang = Number(dimPanel.angleDeg) * Math.PI / 180
  else ang = Math.atan2(-(drawMouse.y - last[1]), drawMouse.x - last[0])
  let dist
  if (lenTyped) dist = Number(dimPanel.lenMm) * MM_TO_UNITS
  else dist = Math.hypot(drawMouse.x - last[0], drawMouse.y - last[1])
  const qx = last[0] + Math.cos(ang) * dist
  const qy = last[1] - Math.sin(ang) * dist
  // 等价于在该点单击：弹出移动预览 → 压入已确认点 + 新的移动预览
  arr.pop()
  arr.push([qx, qy], [qx, qy])
  activeDraw.plot(arr)
  dimPanel.lenMm = null
  dimPanel.angleDeg = null
  nextTick(focusLen)
}

function startDraw() {
  endActiveDraw()
  const t = props.tool
  if (t !== 'wall' && t !== 'room' && t !== 'floor') return
  const isRoom = t === 'room' || t === 'floor'
  const color = t === 'floor' ? '#B08AD9' : isRoom ? '#5EC4B0' : '#6BA3D9'
  const el = isRoom ? draftGroup.polygon() : draftGroup.polyline()
  el.fill(isRoom ? { color, opacity: 0.10 } : 'none')
    .stroke({ color, width: 2, linecap: 'round', linejoin: 'round', dasharray: '6 4' })
  el.on('drawdone', onDrawDone)
  el.on('drawstart', () => {
    dimPanel.visible = true
    dimPanel.areaM2 = null
    nextTick(focusLen)
  })
  el.on('drawpoint', () => nextTick(focusLen))   // 鼠标单击落点后继续聚焦长度框
  el.draw({ snapToGrid: grid.value })
  activeDraw = el
  drawMouse = null
  window.addEventListener('mousemove', onDrawMouseMove)
  window.addEventListener('click', onDrawClick)
  // 提示文字短暂展示后自动淡出，避免持续遮挡画布
  drawHintVisible.value = true
  clearTimeout(drawHintTimer)
  drawHintTimer = setTimeout(() => { drawHintVisible.value = false }, 2800)
}

function hideDimPanel() {
  dimPanel.visible = false
  dimPanel.areaM2 = null
  drawMouse = null
  window.removeEventListener('mousemove', onDrawMouseMove)
  window.removeEventListener('click', onDrawClick)
}

function onDrawDone() {
  const el = activeDraw
  activeDraw = null
  if (!el) return
  const t = props.tool
  let pts = []
  try { pts = (el.array().valueOf() || []).map((p) => [p[0], p[1]]) } catch (e) { console.error(e) }
  el.remove()
  hideDimPanel()
  // svg.draw 点击落点会在尾部留下「旧预览 + 落点」的近零长度段，去掉
  while (pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]) < 1) pts.pop()
  if (t === 'wall' && pts.length >= 2) emit('wall-done', pts)
  else if (t === 'room' && pts.length >= 3) emit('room-done', pts)
  else if (t === 'floor' && pts.length >= 3) emit('floor-done', pts)
}

function endActiveDraw() {
  if (activeDraw) {
    try { activeDraw.draw('cancel') } catch (e) { /* 元素可能已移除 */ }
    activeDraw = null
  }
  hideDimPanel()
  clearTimeout(drawHintTimer)
}
function finishDraw() { if (activeDraw) { try { activeDraw.draw('done') } catch (e) { console.error(e) } } }
function cancelDraw() { endActiveDraw() }

function onKeydown(e) {
  if (props.tool === 'measure') {
    if (e.key === 'Escape') { e.preventDefault(); clearMeasure(); return }
    // Backspace/Delete 回退上一个测量点（输入框内不拦截）
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const tg = e.target
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return
      e.preventDefault()
      if (measurePts.length) { measurePts.pop(); renderMeasure() }
    }
    return
  }
  if (!activeDraw) return
  if (e.key === 'Enter') { e.preventDefault(); finishDraw() }
  else if (e.key === 'Escape') { e.preventDefault(); cancelDraw() }
}

watch(() => props.tool, (t, oldT) => {
  if (oldT === 'measure' && t !== 'measure') clearMeasure()
  if (t === 'measure') {
    clearMeasure()
    window.addEventListener('mousemove', onMeasureMouseMove)
    return
  }
  if (t === 'wall' || t === 'room' || t === 'floor') startDraw()
  else endActiveDraw()
})

// ================= 测量工具（酷家乐式连续测距） =================
const measurePts = []      // 已点击的点（画布坐标）
let measureMouse = null
let measureDown = null
// 文字胶囊：rect 底 + 居中文字
function measurePill(g, x, y, text, color) {
  const fs = 11
  const w = text.length * fs * 0.62 + 10
  const grp = g.group()
  grp.rect(w, fs + 6).x(x - w / 2).y(y - (fs + 6) / 2)
    .rx((fs + 6) / 2).ry((fs + 6) / 2)
    .fill('#ffffff').stroke({ color, width: 1 })
  grp.text(text).attr({ x, y: y + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
    .fill(color).font({ size: fs, weight: '600' })
}
function renderMeasure() {
  if (!measureGroup) return
  measureGroup.clear()
  const color = '#12A8C9'
  // 已确认线段
  for (let i = 0; i < measurePts.length - 1; i++) {
    const a = measurePts[i], b = measurePts[i + 1]
    measureGroup.line(a.x, a.y, b.x, b.y).stroke({ color, width: 1.5 })
    const mm = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / MM_TO_UNITS)
    measurePill(measureGroup, (a.x + b.x) / 2, (a.y + b.y) / 2, `${mm} mm`, color)
  }
  // 端点
  measurePts.forEach((p) => measureGroup.circle(6).cx(p.x).cy(p.y).fill('#ffffff').stroke({ color, width: 1.5 }))
  // 橡皮筋：最后一点 → 鼠标
  if (measurePts.length && measureMouse) {
    const a = measurePts[measurePts.length - 1], b = measureMouse
    measureGroup.line(a.x, a.y, b.x, b.y).stroke({ color, width: 1, dasharray: '5 4' })
    const ang = normAngle(Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI)
    measurePill(measureGroup, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, `${Math.round(ang)}°`, '#7c8896')
  }
}
function onMeasureMouseMove(e) {
  if (props.tool !== 'measure' || !holder.value) return
  let p = clientToCanvas(e)
  if (e.shiftKey && measurePts.length) p = snapDir(measurePts[measurePts.length - 1], p, 45)
  measureMouse = p
  renderMeasure()
}
function onMeasurePointerDown(e) {
  if (props.tool !== 'measure') return
  if (e.altKey || e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault(); e.stopImmediatePropagation()
  measureDown = { x: e.clientX, y: e.clientY }
  window.addEventListener('pointerup', onMeasurePointerUp, { once: true })
}
function onMeasurePointerUp(e) {
  if (!measureDown) return
  const moved = Math.hypot(e.clientX - measureDown.x, e.clientY - measureDown.y)
  measureDown = null
  if (moved > 5) return      // 拖拽（平移意图）不加点
  let p = clientToCanvas(e)
  if (e.shiftKey && measurePts.length) p = snapDir(measurePts[measurePts.length - 1], p, 45)
  measurePts.push(p)
  measureMouse = p
  renderMeasure()
}
function clearMeasure() {
  measurePts.length = 0
  measureMouse = null
  if (measureGroup) measureGroup.clear()
  window.removeEventListener('mousemove', onMeasureMouseMove)
}

// ---- 选中墙段：行内输入毫米数改墙段长度（段起点与方向固定，后续链点刚性平移） ----
const segInput = ref(null)
const segEdit = reactive({ visible: false, x: 0, y: 0, value: null })
let segCtx = null      // { wall, index }
function canvasToClient(cx, cy) {
  return { x: panX.value + cx * userZoom.value, y: panY.value + cy * userZoom.value }
}
function openSegEdit(wall, i) {
  const pts = wall.pts
  const a = pts[i], b = pts[i + 1]
  const lenMm = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / MM_TO_UNITS)
  const c = canvasToClient((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  segCtx = { wall, i }
  segEdit.value = lenMm
  segEdit.x = clamp(c.x - 60, 4, (holder.value ? holder.value.clientWidth : 100) - 132)
  segEdit.y = clamp(c.y - 14, 4, (holder.value ? holder.value.clientHeight : 100) - 32)
  segEdit.visible = true
  nextTick(() => { const inp = segInput.value; if (inp) { inp.focus(); inp.select() } })
}
function onSegKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitSegEdit() }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); segEdit.visible = false; segCtx = null }
}
function commitSegEdit() {
  if (!segCtx) return
  const v = Number(segEdit.value)
  const { wall, i } = segCtx
  segEdit.visible = false
  segCtx = null
  if (!Number.isFinite(v) || v <= 0) return
  const pts = wall.pts
  const a = pts[i], oldB = pts[i + 1]
  const dirx = oldB[0] - a[0], diry = oldB[1] - a[1]
  const oldLen = Math.hypot(dirx, diry)
  if (oldLen < 1e-6) return
  const newLen = v * MM_TO_UNITS
  const nx = a[0] + dirx / oldLen * newLen
  const ny = a[1] + diry / oldLen * newLen
  const ddx = nx - oldB[0], ddy = ny - oldB[1]
  emit('edit-begin')
  oldB[0] = nx; oldB[1] = ny
  // 后续顶点整体平移，保持后面墙段形状不变
  for (let k = i + 2; k < pts.length; k++) { pts[k][0] += ddx; pts[k][1] += ddy }
  emit('wall-moved', wall)
}

// ---- 统一整组拖拽（多选后移动任一选中对象即整组移动） ----
let groupDrag = null
function anchorOf(type, o) {
  if (type === 'wall') return (o.pts || []).map((p) => [p[0], p[1]])
  if (type === 'room') return (o.poly || []).map((p) => [p[0], p[1]])
  if (type === 'floor') return (o.floorPoly || []).map((p) => [p[0], p[1]])
  return { x: o.x, y: o.y }                    // device / furniture
}
function applyAnchor(type, o, a, dx, dy) {
  if (type === 'wall' || type === 'room') {
    const pts = type === 'wall' ? o.pts : o.poly
    a.forEach((p, i) => { pts[i][0] = p[0] + dx; pts[i][1] = p[1] + dy })
  } else if (type === 'floor') {
    a.forEach((p, i) => { o.floorPoly[i][0] = p[0] + dx; o.floorPoly[i][1] = p[1] + dy })
  } else { o.x = a.x + dx; o.y = a.y + dy }
}
function unionBoxOf(keys) {
  const objs = allObjects().filter((o) => keys.includes(o.key))
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const o of objs) { if (o.box.minX < minX) minX = o.box.minX; if (o.box.minY < minY) minY = o.box.minY; if (o.box.maxX > maxX) maxX = o.box.maxX; if (o.box.maxY > maxY) maxY = o.box.maxY }
  return { minX, minY, maxX, maxY }
}
// key 属于当前多选 → 启动整组拖拽；返回 true 表示已接管
function tryStartGroupDrag(key, e) {
  if (!props.multiKeys.includes(key) || props.multiKeys.length < 2) return false
  e.preventDefault(); e.stopPropagation()
  emit('edit-begin')
  const items = allObjects().filter((o) => props.multiKeys.includes(o.key))
  groupDrag = {
    keys: props.multiKeys.slice(),
    start: clientToCanvas(e),
    items: items.map((o) => ({ type: o.type, obj: o.obj, anchor: anchorOf(o.type, o.obj) })),
    box: unionBoxOf(props.multiKeys),
    moved: false,
  }
  window.addEventListener('pointermove', onGroupMove, { passive: false })
  window.addEventListener('pointerup', onGroupUp, { once: true })
  return true
}
function onGroupMove(e) {
  if (!groupDrag) return
  e.preventDefault()
  const p = clientToCanvas(e)
  let dx = snap(p.x - groupDrag.start.x, grid.value)
  let dy = snap(p.y - groupDrag.start.y, grid.value)
  if (dx || dy) groupDrag.moved = true
  // 整组包围盒参与智能对齐
  const box = { minX: groupDrag.box.minX + dx, minY: groupDrag.box.minY + dy, maxX: groupDrag.box.maxX + dx, maxY: groupDrag.box.maxY + dy }
  const al = computeAlign(box, groupDrag.keys)
  dx += al.dx; dy += al.dy
  for (const it of groupDrag.items) applyAnchor(it.type, it.obj, it.anchor, dx, dy)
  drawGuides(al.guides)
}
function onGroupUp() {
  if (!groupDrag) return
  const moved = groupDrag.moved
  groupDrag = null
  window.removeEventListener('pointermove', onGroupMove)
  clearOverlay()
  if (moved) emit('group-moved')
}

// ---- 设备拖拽（DOM 覆盖层，window 级跟踪，避免 pointer 丢失） ----
let dragTarget = null
let dragOffsetX = 0, dragOffsetY = 0, dragMoved = false
function onDeviceDown(dev, e) {
  if (!props.editMode) return
  if (e.altKey) return                       // Alt+左键交给画布平移
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (tryStartGroupDrag(`device:${dev.id}`, e)) return
  e.preventDefault()
  emit('edit-begin')
  const p = clientToCanvas(e)
  dragTarget = dev
  dragOffsetX = p.x - dev.x
  dragOffsetY = p.y - dev.y
  dragMoved = false
  window.addEventListener('pointermove', onWindowMove, { passive: false })
  window.addEventListener('pointerup', onWindowUp, { once: true })
}
function onWindowMove(e) {
  if (!dragTarget) return
  e.preventDefault()
  const p = clientToCanvas(e)
  const half = dragTarget.size / 2
  let nx = snap(p.x - dragOffsetX, grid.value)
  let ny = snap(p.y - dragOffsetY, grid.value)
  // 智能对齐（未接近参考线时吸附值为 0）
  const al = computeAlign({ minX: nx - half, minY: ny - half, maxX: nx + half, maxY: ny + half }, [`device:${dragTarget.id}`])
  nx += al.dx; ny += al.dy
  nx = clamp(nx, half, props.canvas.w - half)
  ny = clamp(ny, half, props.canvas.h - half)
  if (nx !== dragTarget.x || ny !== dragTarget.y) dragMoved = true
  dragTarget.x = nx
  dragTarget.y = ny
  drawGuides(al.guides)
}
function onWindowUp() {
  if (!dragTarget) return
  const dev = dragTarget
  const moved = dragMoved
  dragTarget = null
  dragMoved = false
  window.removeEventListener('pointermove', onWindowMove)
  clearOverlay()
  if (moved) emit('device-moved', dev)
  else emit('device-click', dev)
}
function onDeviceClick(dev) {
  if (props.editMode) return // 编辑态点击已在 pointerup 分发
  emit('device-click', dev)
}

// ---- 家具拖拽（DOM 覆盖层，window 级跟踪） ----
let furnitureTarget = null
let furnitureOffsetX = 0, furnitureOffsetY = 0, furnitureMoved = false
function onFurnitureDown(fu, e) {
  if (!props.editMode) return
  if (e.altKey) return                       // Alt+左键交给画布平移
  if (props.tool === 'wall' || props.tool === 'room' || props.tool === 'floor') return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (tryStartGroupDrag(`furniture:${fu.id}`, e)) return
  e.preventDefault()
  emit('edit-begin')
  const p = clientToCanvas(e)
  furnitureTarget = fu
  furnitureOffsetX = p.x - fu.x
  furnitureOffsetY = p.y - fu.y
  furnitureMoved = false
  window.addEventListener('pointermove', onFurnitureMove, { passive: false })
  window.addEventListener('pointerup', onFurnitureUp, { once: true })
}
function onFurnitureMove(e) {
  if (!furnitureTarget) return
  e.preventDefault()
  const p = clientToCanvas(e)
  let nx = snap(p.x - furnitureOffsetX, grid.value)
  let ny = snap(p.y - furnitureOffsetY, grid.value)
  // 智能对齐
  const al = computeAlign({ minX: nx - furnitureTarget.w / 2, minY: ny - furnitureTarget.d / 2, maxX: nx + furnitureTarget.w / 2, maxY: ny + furnitureTarget.d / 2 }, [`furniture:${furnitureTarget.id}`])
  nx += al.dx; ny += al.dy
  nx = clamp(nx, 0, props.canvas.w)
  ny = clamp(ny, 0, props.canvas.h)
  if (nx !== furnitureTarget.x || ny !== furnitureTarget.y) furnitureMoved = true
  furnitureTarget.x = nx
  furnitureTarget.y = ny
  drawGuides(al.guides)
}
function onFurnitureUp() {
  if (!furnitureTarget) return
  const fu = furnitureTarget
  const moved = furnitureMoved
  furnitureTarget = null
  furnitureMoved = false
  window.removeEventListener('pointermove', onFurnitureMove)
  clearOverlay()
  if (moved) emit('furniture-moved', fu)
  else emit('furniture-click', fu)
}
function onFurnitureClick(fu) {
  if (props.editMode) return // 编辑态点击已在 pointerup 分发
}

// ---- 滚轮缩放（以指针位置为锚点） ----
function onWheel(e) {
  e.preventDefault()
  const rect = holder.value.getBoundingClientRect()
  const factor = Math.exp(-e.deltaY * 0.0015)
  zoomAt(e.clientX - rect.left, e.clientY - rect.top, userZoom.value * factor)
}

// ---- 鼠标平移：中键 / Alt+左键（编辑态任意位置）；查看态左键空白处 ----
let panStart = null
function onHolderPointerDown(e) {
  const byKey = e.button === 1 || (e.button === 0 && e.altKey)
  const blankPan = !props.editMode && e.button === 0 && e.target?.dataset?.fpBg === '1'
  // 编辑态左键空白处（无工具）→ 框选
  const marqueeStart = props.editMode && e.button === 0 && !e.altKey && !props.tool
    && !e.target?.closest?.('[data-key]')
  if (byKey || blankPan) {
    if (panStart?.active) return
    e.preventDefault()              // 中键时阻止浏览器自动滚动
    panStart = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value, active: true }
    window.addEventListener('pointermove', onPanMove)
    window.addEventListener('pointerup', onPanUp, { once: true })
  } else if (marqueeStart) {
    e.preventDefault()
    startMarquee(e)
  }
}
function onPanMove(e) {
  if (!panStart?.active) return
  panX.value = panStart.px + (e.clientX - panStart.x)
  panY.value = panStart.py + (e.clientY - panStart.y)
}
function onPanUp() {
  if (!panStart) return
  panStart.active = false
  panStart = null
  window.removeEventListener('pointermove', onPanMove)
}

// ---- 框选：拖出虚线矩形，选中与之相交的对象；Shift 追加；极小拖动视为点击空白 ----
let marquee = null
function startMarquee(e) {
  const p0 = clientToCanvas(e)
  marquee = { x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y, addMode: e.shiftKey }
  window.addEventListener('pointermove', onMarqueeMove, { passive: false })
  window.addEventListener('pointerup', onMarqueeUp, { once: true })
}
function onMarqueeMove(e) {
  if (!marquee) return
  e.preventDefault()
  const p = clientToCanvas(e)
  marquee.x1 = p.x; marquee.y1 = p.y
  const r = normMarquee()
  clearOverlay()
  overlayGroup.rect(r.maxX - r.minX, r.maxY - r.minY)
    .move(r.minX, r.minY)
    .fill({ color: '#12C2B5', opacity: 0.07 })
    .stroke({ color: '#12C2B5', width: 1.5 / (scale.value || 1), dasharray: `${5 / (scale.value || 1)},${4 / (scale.value || 1)}` })
}
function normMarquee() {
  return {
    minX: Math.min(marquee.x0, marquee.x1), minY: Math.min(marquee.y0, marquee.y1),
    maxX: Math.max(marquee.x0, marquee.x1), maxY: Math.max(marquee.y0, marquee.y1),
  }
}
function onMarqueeUp() {
  if (!marquee) return
  const m = marquee
  marquee = null
  window.removeEventListener('pointermove', onMarqueeMove)
  clearOverlay()
  // 屏幕像素阈值：<5px 的拖动当作空白点击
  const s = scale.value || 1
  const r = normMarquee()
  if ((r.maxX - r.minX) * s < 5 && (r.maxY - r.minY) * s < 5) {
    emit('blank-click')
    return
  }
  const keys = allObjects().filter((o) => boxesIntersect(o.box, r)).map((o) => o.key)
  emit('marquee-select', { keys, additive: m.addMode })
}

// ---- 点到折线（多段墙）的最短距离 ----
function distPointToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (!l2) return Math.hypot(px - a[0], py - a[1])
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
}
function distPointToWall(px, py, pts) {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distPointToSeg(px, py, pts[i], pts[i + 1]))
  return best
}

// ---- 右键上下文菜单：检测被右击对象并上报（菜单由父组件渲染） ----
function onContextMenu(e) {
  if (!props.editMode) return
  e.preventDefault()
  let key = e.target?.closest?.('[data-key]')?.dataset?.key || ''
  if (!key) {
    const p = clientToCanvas(e)
    const objs = allObjects()
    // 房间 / 地板：点在多边形内
    for (const t of ['room', 'floor']) {
      const hit = objs.filter((o) => o.type === t).find((o) => pointInPoly(p.x, p.y, t === 'room' ? o.obj.poly : o.obj.floorPoly))
      if (hit) { key = hit.key; break }
    }
    // 墙线：屏幕 8px 距离阈值
    if (!key) {
      const thr = 8 / (scale.value || 1)
      let best = null, bd = thr
      for (const o of objs.filter((o) => o.type === 'wall')) {
        const d = distPointToWall(p.x, p.y, o.obj.pts)
        if (d < bd) { bd = d; best = o }
      }
      if (best) key = best.key
    }
  }
  emit('context-menu', { x: e.clientX, y: e.clientY, key })
}

// ---- 触屏双指：捏合缩放（以两指中点为锚）+ 双指平移（仅查看态） ----
const touchPointers = new Map()
let pinch = null
function onTouchPointerDown(e) {
  if (props.editMode || e.pointerType !== 'touch') return
  touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (touchPointers.size === 2) {
    const [a, b] = [...touchPointers.values()]
    const rect = holder.value.getBoundingClientRect()
    const mx0 = (a.x + b.x) / 2 - rect.left, my0 = (a.y + b.y) / 2 - rect.top
    const s0 = scale.value
    pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      z: userZoom.value,
      mx: mx0, my: my0,
      // 中点对应的画布锚点（起始状态反算），缩放/平移过程中保持该点跟随中点
      cx: (mx0 - offsetX.value) / s0,
      cy: (my0 - offsetY.value) / s0,
    }
    if (panStart?.active) { panStart.active = false; panStart = null }  // 双指接管，放弃单指平移
  }
  window.addEventListener('pointermove', onTouchMove)
  window.addEventListener('pointerup', onTouchUp)
  window.addEventListener('pointercancel', onTouchUp)
}
function onTouchMove(e) {
  const cur = touchPointers.get(e.pointerId)
  if (!cur) return
  cur.x = e.clientX; cur.y = e.clientY
  if (!pinch || touchPointers.size < 2) return
  const [a, b] = [...touchPointers.values()]
  const rect = holder.value.getBoundingClientRect()
  const d = Math.hypot(a.x - b.x, a.y - b.y)
  const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top
  const nz = clamp(pinch.z * (d / Math.max(1, pinch.d)), MIN_Z, MAX_Z)
  const s1 = baseScale.value * nz
  // 锚点 (pinch.cx/cy) 始终跟随当前中点：pan = 中点 - fit居中 - 锚点×新缩放
  panX.value = mx - (holderW.value - props.canvas.w * s1) / 2 - pinch.cx * s1
  panY.value = my - (holderH.value - props.canvas.h * s1) / 2 - pinch.cy * s1
  userZoom.value = nz
}
function onTouchUp(e) {
  touchPointers.delete(e.pointerId)
  if (touchPointers.size < 2) pinch = null
  if (!touchPointers.size) {
    window.removeEventListener('pointermove', onTouchMove)
    window.removeEventListener('pointerup', onTouchUp)
    window.removeEventListener('pointercancel', onTouchUp)
  }
}

// ---- 初始化 / 销毁 ----
function init() {
  if (!svgMount.value) return
  // svg.js 2.x：SVG(domNode) 会在容器内自动创建 <svg> 并设为 100%×100%；
  // preserveAspectRatio=none：viewBox 完全由缩放/平移换算控制
  svg = SVG(svgMount.value)
  svg.attr('preserveAspectRatio', 'none')
  applyViewBox()
  geoGroup = svg.group()
  draftGroup = svg.group()
  overlayGroup = svg.group()                    // 智能参考线 + 框选矩形（不拦截指针）
  overlayGroup.node.style.pointerEvents = 'none'
  overlayGroup.node.setAttribute('aria-hidden', 'true')
  measureGroup = svg.group()                    // 测量工具（不拦截指针，capture 手势单独处理）
  measureGroup.node.style.pointerEvents = 'none'
  measureGroup.node.setAttribute('aria-hidden', 'true')

  // 右键上下文菜单（仅编辑态）
  holder.value.addEventListener('contextmenu', onContextMenu)
  // 测量工具激活时：capture 阶段接管指针，屏蔽平移/设备点击
  holder.value.addEventListener('pointerdown', onMeasurePointerDown, true)
  // 滚轮缩放（passive:false 才能 preventDefault）
  holder.value.addEventListener('wheel', onWheel, { passive: false })
  // 平移：中键/Alt+左键（编辑态任意位置）、查看态左键空白
  holder.value.addEventListener('pointerdown', onHolderPointerDown)
  // 触屏双指捏合缩放 / 平移（查看态）
  holder.value.addEventListener('pointerdown', onTouchPointerDown)

  // 点击空白处（非绘制工具时）取消选中；门/窗工具在最近墙段放置洞口
  svg.node.addEventListener('click', (e) => {
    if (!props.editMode) return
    if (props.tool === 'wall' || props.tool === 'room' || props.tool === 'floor') return // 交给 svg.draw.js
    if (props.tool === 'door' || props.tool === 'window') {
      const p = clientToCanvas(e)
      const hit = nearestWallAt(p.x, p.y)
      if (hit) emit('opening-place', { wallId: hit.wallId, offset: hit.offset, kind: props.tool })
      return
    }
    emit('blank-click')
  })

  redrawGeometry()
  if (props.tool === 'wall' || props.tool === 'room') startDraw()
}

onMounted(() => {
  holderW.value = holder.value?.clientWidth || 600
  holderH.value = holder.value?.clientHeight || 400
  init()
  window.addEventListener('keydown', onKeydown)
  ro = new ResizeObserver(() => {
    holderW.value = holder.value?.clientWidth || 0
    holderH.value = holder.value?.clientHeight || 0
  })
  ro.observe(holder.value)
})

// 几何/模式变化 → 重绘（房间高亮随 selectedRoomId 变化；SVG 随主题变量自动变色）
watch(
  () => [props.canvas.w, props.canvas.h, props.floor.rooms, props.floor.walls, props.floor.openings, props.floor.bg, props.floor.floorPoly, props.editMode, props.selectedRoomId, props.selectedWallId, props.selectedFloorId],
  redrawGeometry,
  { deep: true },
)

// 缩放/平移变化 → 只更新 viewBox，无需重绘几何
watch(() => [userZoom.value, panX.value, panY.value, holderW.value, holderH.value], applyViewBox)

onBeforeUnmount(() => {
  if (ro) { ro.disconnect(); ro = null }
  if (holder.value) {
    holder.value.removeEventListener('contextmenu', onContextMenu)
    holder.value.removeEventListener('pointerdown', onMeasurePointerDown, true)
  }
  clearMeasure()
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointermove', onFurnitureMove)
  window.removeEventListener('pointermove', onGeoMove)
  window.removeEventListener('pointermove', onGroupMove)
  window.removeEventListener('pointermove', onMarqueeMove)
  window.removeEventListener('pointermove', onPanMove)
  window.removeEventListener('pointermove', onTouchMove)
  window.removeEventListener('keydown', onKeydown)
  endActiveDraw()
  if (svg) { svg.remove(); svg = null; geoGroup = null; draftGroup = null; overlayGroup = null; measureGroup = null }
})
</script>

<style scoped>
.fp-holder {
  min-height: 0;
}
/* 缩放控件触屏适配：
   1) hover 仅在真悬停设备生效——触屏点按后不再残留灰底（手机模式的显示 bug 根源）
   2) 去掉 iOS/Android 点按灰色高亮、禁用双击缩放抢手势
   3) 粗指针（触屏）下加大点按目标；百分比读数定宽防止数字变宽时按钮跳动 */
.fpz{display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px;border-radius:12px;
  border:1px solid rgb(var(--c-border));background:rgb(var(--c-background) / .9);backdrop-filter:blur(4px);
  box-shadow:0 8px 24px rgb(0 0 0 / .18)}
.fpz-btn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;
  color:rgb(var(--c-muted));background:transparent;border:0;cursor:pointer;padding:0;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:color .15s,background .15s}
.fpz-btn .material-symbols-outlined{font-size:16px}
.fpz-btn:active{color:rgb(var(--c-on-surface));background:rgb(var(--c-surface-alt));transform:scale(.92)}
.fpz-num{min-width:36px;height:20px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;padding:0;
  font-family:inherit;font-size:10px;font-variant-numeric:tabular-nums;color:rgb(var(--c-muted));cursor:pointer;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:color .15s}
.fpz-num:active{color:rgb(var(--c-on-surface))}
@media (hover:hover){
  .fpz-btn:hover{color:rgb(var(--c-on-surface));background:rgb(var(--c-surface-alt))}
  .fpz-num:hover{color:rgb(var(--c-on-surface))}
}
@media (pointer:coarse){
  .fpz-btn{width:34px;height:34px}
  .fpz-btn .material-symbols-outlined{font-size:18px}
  .fpz-num{height:24px}
}
</style>
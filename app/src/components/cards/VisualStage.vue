<template>
  <div
    ref="wrapRef"
    class="ve-wrap"
    tabindex="-1"
    @pointerdown.capture="onPointerDown"
    @pointermove.capture="onHoverMove"
    @dblclick="onDblClick"
    @keydown.capture="onKey"
  >
    <!-- 顶部工具：撤销/重做/帮助 -->
    <div class="ve-tools">
      <button class="ve-tbtn" :disabled="!undoStack.length" title="撤销（Ctrl+Z）" @click="undo">
        <span class="material-symbols-outlined">undo</span>
      </button>
      <button class="ve-tbtn" :disabled="!redoStack.length" title="重做（Ctrl+Shift+Z）" @click="redo">
        <span class="material-symbols-outlined">redo</span>
      </button>
      <span class="ve-tools-divider"></span>
      <button class="ve-tbtn" title="使用帮助" @click="showHint = !showHint">
        <span class="material-symbols-outlined">help</span>
      </button>
    </div>

    <Transition name="ve-hint">
      <div v-if="showHint" class="ve-hint-card">
        <p><b>图形设计模式</b>（不会调用任何真实设备操作）</p>
        <ul>
          <li><span class="material-symbols-outlined">ads_click</span>点击元素选中，再次点击内层元素可精确选择</li>
          <li><span class="material-symbols-outlined">open_with</span>按住元素直接拖动，调整摆放位置</li>
          <li><span class="material-symbols-outlined">stylus</span>双击文字直接改内容；双击图标换图标</li>
          <li><span class="material-symbols-outlined">tune</span>选中后用下方属性条调色/字号/圆角等</li>
          <li><span class="material-symbols-outlined">code</span>所有改动会同步写入右侧 HTML 代码，可随时切回代码微调</li>
        </ul>
        <button class="ve-hint-close" @click="showHint = false">我知道了</button>
      </div>
    </Transition>

    <!-- 与真实卡片一致：基准渲染 + zoom + scale 等比缩放 -->
    <div class="ce-slot ve-slot" :style="slotStyle">
      <div :id="'preview-' + card.uid" class="ce-pholder ve-ph" :style="holderStyle">
        <div class="hc-card-zoom" :style="zoomStyle">
          <CodeCard :card="visualCard" :scope-id="'preview-' + card.uid" :freeze="true" :interactive="false" />
        </div>
      </div>
    </div>

    <!-- 悬停提示标签 -->
    <div v-if="hoverTag.show && !selectedVid" class="ve-tag ve-tag-hover" :style="hoverTag.style">
      {{ hoverTag.text }}
    </div>
    <div v-else-if="hoverTag.show && selectedVid && hoverTag.vid !== selectedVid" class="ve-tag ve-tag-hover" :style="hoverTag.style">
      {{ hoverTag.text }}
    </div>

    <!-- 无实体遮罩（需要实体但未绑定 / 等待连接） -->
    <Transition name="ve-fade">
      <div v-if="!hasTemplate" class="ve-needentity">
        <span class="material-symbols-outlined ve-ne-icon">link_off</span>
        <p v-if="needEntity">这张卡需要先绑定一个 Home Assistant 实体才能设计布局</p>
        <p v-else>当前卡片没有可编辑的元素</p>
        <button v-if="needEntity" class="ve-ne-btn" @click="$emit('change-entity')">
          <span class="material-symbols-outlined">add_link</span>选择实体
        </button>
      </div>
    </Transition>

    <!-- ============ 选中元素的属性条（Teleport 到右侧代码区旁的属性面板） ============ -->
    <Teleport :to="panelEl || undefined" :disabled="!panelEl">
    <Transition name="ve-bar">
      <div v-if="selectedVid && hasTemplate" class="ve-bar">
        <div class="ve-bar-title">
          <span class="material-symbols-outlined">touch_app</span>
          <span>{{ selDescriptor }}</span>
        </div>

        <!-- 数据来源实体：卡片数据由哪个实体提供，可更换 -->
        <div class="ve-src">
          <div class="ve-src-head">
            <span class="material-symbols-outlined">database</span>
            <span class="ve-src-title">数据来源实体</span>
            <span v-if="srcAuto" class="ve-src-auto" title="未手动指定，自动使用第一个同类型实体">自动</span>
            <span class="ve-spacer"></span>
            <button class="ve-chip ve-chip-mini" :disabled="!canChangeEntity" title="更换提供数据的实体" @click="$emit('change-entity')">
              <span class="material-symbols-outlined">swap_horiz</span>更换
            </button>
          </div>
          <div v-if="srcEntity" class="ve-src-row">
            <span class="ve-domain-badge">{{ srcEntity.domain }}</span>
            <span class="ve-src-name">{{ srcEntity.friendly_name || srcEntity.entity_id }}</span>
            <code class="ve-src-id">{{ srcEntity.entity_id }}</code>
          </div>
          <p v-else class="ve-src-empty">
            <span class="material-symbols-outlined">info</span>
            <template v-if="needEntity">未绑定实体，请在右上配置区选择</template>
            <template v-else-if="card.type === 'weather'">暂无可用 weather 实体</template>
            <template v-else>该卡片不依赖实体数据</template>
          </p>
          <ul v-if="srcAttrs.length" class="ve-src-attrs">
            <li v-for="a in srcAttrs" :key="a.key">
              <span class="ve-src-a-key">{{ a.key }}</span>
              <span class="ve-src-a-val">{{ a.val }}</span>
            </li>
          </ul>
        </div>

        <div class="ve-bar-scroll">
          <!-- 文字编辑：输入框直接改显示的文字 -->
          <label v-if="selCanText" class="ve-text-row" title="修改显示的文字">
            <span class="material-symbols-outlined">stylus</span>
            <input
              ref="barTextRef"
              type="text"
              :value="barTextVal"
              placeholder="输入文字内容…"
              spellcheck="false"
              @input="applyBarText($event.target.value)"
              @keydown.enter.prevent="commitBarText"
              @keydown.esc.prevent="revertBarText"
              @blur="commitBarText"
            />
          </label>
          <p v-if="selCanText && selTextToken" class="ve-text-hint">
            <span class="material-symbols-outlined">bolt</span>
            原为实时数据 <code>{{ selTextToken }}</code>，修改后将固定显示
          </p>
          <p v-if="selIsText && !selCanText" class="ve-text-lock">
            <span class="material-symbols-outlined">lock</span>
            该文字为传感器数据，按实际值显示，不可修改
          </p>
          <!-- 换图标 -->
          <button v-if="selIsIcon" class="ve-chip ve-chip-accent" @click="openIconFromBar">
            <span class="material-symbols-outlined">progress</span>换图标
          </button>

          <span v-if="selIsText" class="ve-sep"></span>
          <!-- 文字颜色 -->
          <label v-if="selIsText" class="ve-ctl" title="文字颜色">
            <span class="ve-ctl-ic material-symbols-outlined">format_color_text</span>
            <input type="color" :value="selVals.color" @input="applyLive('color', $event.target.value)" @change="commitProps({ color: $event.target.value })">
          </label>
          <!-- 加粗 -->
          <button v-if="selIsText" class="ve-ctl ve-ctl-btn" :class="{ on: selVals.bold }" title="加粗"
            @click="toggleBold">
            <span class="ve-bold-b">B</span>
          </button>
          <!-- 对齐 -->
          <div v-if="selIsText" class="ve-seg" title="对齐方式">
            <button :class="{ on: selVals.align === 'left' }" @click="commitProps({ 'text-align': 'left' })"><span class="material-symbols-outlined">format_align_left</span></button>
            <button :class="{ on: selVals.align === 'center' }" @click="commitProps({ 'text-align': 'center' })"><span class="material-symbols-outlined">format_align_center</span></button>
            <button :class="{ on: selVals.align === 'right' }" @click="commitProps({ 'text-align': 'right' })"><span class="material-symbols-outlined">format_align_right</span></button>
          </div>
          <!-- 字号 -->
          <label v-if="selIsText" class="ve-ctl ve-ctl-range" title="文字大小">
            <span class="ve-ctl-ic material-symbols-outlined">format_size</span>
            <input type="range" min="6" max="42" step="1" :value="selVals.fontSize"
              @input="applyLive('font-size', $event.target.value + 'px')"
              @change="commitProps({ 'font-size': $event.target.value + 'px' })">
            <em>{{ selVals.fontSize }}</em>
          </label>

          <span class="ve-sep"></span>
          <!-- 背景色 -->
          <label class="ve-ctl" title="背景颜色">
            <span class="ve-ctl-ic material-symbols-outlined">format_color_fill</span>
            <input type="color" :value="selVals.bg" @input="applyLive('background-color', $event.target.value)" @change="commitProps({ 'background-color': $event.target.value })">
          </label>
          <button class="ve-chip ve-chip-mini" title="清除背景" @click="commitClear('background-color')">
            <span class="material-symbols-outlined">format_color_reset</span>透明
          </button>
          <!-- 圆角 -->
          <label class="ve-ctl ve-ctl-range" title="圆角">
            <span class="ve-ctl-ic material-symbols-outlined">rounded_corner</span>
            <input type="range" min="0" max="40" step="1" :value="selVals.radius"
              @input="applyLive('border-radius', $event.target.value + 'px')"
              @change="commitProps({ 'border-radius': $event.target.value + 'px' })">
            <em>{{ selVals.radius }}</em>
          </label>

          <span class="ve-sep"></span>
          <!-- 位置复位 -->
          <button class="ve-chip" :disabled="!selVals.hasPos" title="恢复元素在布局中的原始位置" @click="resetPosition">
            <span class="material-symbols-outlined">center_focus_strong</span>复位位置
          </button>
          <!-- 删除 -->
          <button v-if="!selIsSurface" class="ve-chip ve-chip-danger" title="删除该元素" @click="deleteElement">
            <span class="material-symbols-outlined">delete</span>删除
          </button>
        </div>
      </div>
    </Transition>
    </Teleport>

    <!-- ============ 双击文字：浮动输入框 ============ -->
    <Transition name="ve-pop">
      <div v-if="textPop.open" class="ve-pop" :style="textPop.style" @pointerdown.capture.stop>
        <div class="ve-pop-head">
          <span class="material-symbols-outlined">stylus</span>
          <span class="ve-pop-head-label">编辑文字</span>
          <code class="ve-pop-head-desc">{{ textPop.desc }}</code>
        </div>
        <input
          ref="textInputRef"
          v-model="textPop.value"
          class="ve-text-input"
          :style="{ fontSize: textPop.fs + 'px' }"
          @keydown.enter.prevent="confirmText"
          @keydown.esc.prevent="textPop.open = false"
        />
        <div class="ve-pop-foot">
          <span v-if="textPop.token" class="ve-token-hint">
            <span class="material-symbols-outlined">bolt</span>
            原为实时数据 <code>{{ textPop.token }}</code>，自定义后将固定显示
          </span>
          <span v-else class="ve-token-hint">回车确认 · Esc 取消</span>
          <span class="ve-spacer"></span>
          <button v-if="textPop.token" class="ve-btn-ghost" @click="restoreToken">恢复实时数据</button>
          <button class="ve-btn-primary" @click="confirmText">确定</button>
        </div>
      </div>
    </Transition>

    <!-- ============ 图标选择器 ============ -->
    <Transition name="ve-pop">
      <div v-if="iconPop.open" class="ve-icon-pop" @pointerdown.capture.stop>
        <div class="ve-icon-head">
          <span class="ve-icon-title"><span class="material-symbols-outlined">progress</span>选择图标</span>
          <div class="ve-search">
            <span class="material-symbols-outlined">search</span>
            <input ref="iconSearchRef" v-model="iconQuery" class="ve-search-input" type="text" placeholder="搜索图标（英文）…">
          </div>
          <button class="ve-icon-close" @click="iconPop.open = false"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="ve-icon-grid">
          <button
            v-for="n in visibleIcons"
            :key="n"
            class="ve-icon-cell"
            :class="{ on: n === iconCurrent }"
            :title="n"
            @click="pickIcon(n)"
          >
            <span class="ve-ic-swatch" :style="iconSwatch(n)"></span>
          </button>
          <p v-if="!visibleIcons.length" class="ve-icon-empty">没有匹配的图标</p>
        </div>
        <div class="ve-icon-foot">
          <input v-model="customIcon" class="ve-custom-input" type="text" placeholder="也可输入 Material 图标名，如 water_drop"
            @keydown.enter.prevent="pickIcon(customIcon)">
          <button class="ve-btn-primary" :disabled="!validCustom" @click="pickIcon(customIcon)">使用该图标</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import CodeCard from './CodeCard.vue'
import { cardDefaults, computeData, renderTemplate } from './defaults'
import { useEntities } from '@/composables/useLive'
import { entityStates } from '@/store'
import { iconUrl } from '@/utils/hcIcons'

const props = defineProps({
  card: { type: Object, required: true },
  scale: { type: Number, default: 1 }, // 预览整体缩放（zoom×transform 合并系数通过实际矩形换算）
  cellSize: { type: Number, default: 0 },
  cols: { type: Number, default: 8 },
  // 右侧属性面板的挂载元素（CardEditor 提供）；存在时属性条 Teleport 到该面板
  panelEl: { type: [Object, null], default: null },
})
const emit = defineEmits(['html', 'change-entity', 'select'])

const baseCell = 120
const needEntity = computed(() => !!cardDefaults[props.card.type]?.needEntity)
const entityOptional = computed(() => !!cardDefaults[props.card.type]?.entityOptional)

// ================= 数据来源实体（卡片级：展示提供数据的实体 + 关键属性，可更换） =================
const TOGGLE_DOMAINS = ['switch', 'light', 'plug', 'valve', 'input_boolean', 'fan', 'humidifier', 'group', 'remote', 'siren']
const srcEntity = computed(() => {
  const id = props.card.entity_id
  if (id) return entityStates[id] || null
  // 未手动指定：与 data.js 一致，天气卡取第一个 weather 实体，开关卡取第一个开关类实体
  if (props.card.type === 'weather') return all.value.find((e) => e.domain === 'weather') || null
  if (props.card.type === 'toggle') return all.value.find((e) => TOGGLE_DOMAINS.includes(e.domain)) || null
  return null
})
const srcAuto = computed(() => !props.card.entity_id && !!srcEntity.value)
const canChangeEntity = computed(() => needEntity.value || entityOptional.value)
// 跳过 HA 内部配置/元字段，只展示有意义的业务属性
const SRC_SKIP = new Set([
  'friendly_name', 'icon', 'device_class', 'unit_of_measurement', 'state_class', 'entity_category',
  'supported_features', 'supported_color_modes', 'restored', 'hidden', 'assumed_state', 'attribution',
  'options', 'min', 'max', 'step', 'mode', 'min_mireds', 'max_mireds',
  'min_color_temp_kelvin', 'max_color_temp_kelvin', 'color_temp_kelvin',
  'rgb_color', 'rgbw_color', 'rgbww_color', 'xy_color', 'hs_color',
  'effect_list', 'preset_modes', 'fan_modes', 'swing_modes', 'hvac_modes',
])
const SRC_UNIT_KEYS = {
  temperature: 'temperature_unit', humidity: 'humidity_unit', wind_speed: 'wind_speed_unit',
  pressure: 'pressure_unit', precipitation: 'precipitation_unit', visibility: 'visibility_unit',
}
const srcAttrs = computed(() => {
  const e = srcEntity.value
  const attrs = e?.attributes
  if (!attrs || typeof attrs !== 'object') return []
  const out = []
  for (const [k, v] of Object.entries(attrs)) {
    if (SRC_SKIP.has(k) || v === null || v === undefined || v === '') continue
    let val
    if (Array.isArray(v)) val = v.length + ' 项'
    else if (typeof v === 'object') val = JSON.stringify(v).slice(0, 24) + '…'
    else if (typeof v === 'boolean') val = v ? '开' : '关'
    else {
      const u = e.unit || attrs.unit_of_measurement || attrs[SRC_UNIT_KEYS[k]]
      val = String(v) + (u ? ' ' + u : '')
    }
    out.push({ key: k, val })
  }
  return out.slice(0, 12)
})

// ================= 模板文档（data-vid 元素身份） =================
// 所有图形编辑都作用在「模板 HTML」上并序列化回 card.html；
// data-vid 在元素首次提交图形编辑后会随 HTML 持久化，保证身份稳定。
let parserDoc = null
let lastSrc = null
function ensureDoc() {
  if (lastSrc === props.card.html && parserDoc) return parserDoc
  const d = new DOMParser().parseFromString(props.card.html || '<div></div>', 'text/html')
  const box = d.body
  let i = 0
  box.querySelectorAll('*').forEach((el) => {
    if (!el.hasAttribute('data-vid')) el.setAttribute('data-vid', 'e' + i)
    i++
  })
  parserDoc = d
  lastSrc = props.card.html
  return d
}
function docBox() { return ensureDoc().body }
function docEl(vid) { return docBox().querySelector('[data-vid="' + vid + '"]') }
function serialize() { return docBox().innerHTML }

const visualCard = computed(() => {
  const box = docBox()
  return { ...props.card, html: box.innerHTML }
})

// ================= 预览几何 =================
function cellPx() { return props.cellSize > 0 ? props.cellSize : 240 }
const effW = computed(() => Math.min(Math.max(1, props.card.w || 1), props.cols))
const effH = computed(() => Math.min(3, Math.max(1, props.card.h || 1)))
const slotStyle = computed(() => ({
  width: effW.value * cellPx() * props.scale + 'px',
  height: effH.value * cellPx() * props.scale + 'px',
}))
const holderStyle = computed(() => ({
  width: effW.value * cellPx() + 'px',
  height: effH.value * cellPx() + 'px',
  transform: `scale(${props.scale})`,
}))
const zoomStyle = computed(() => ({
  zoom: cellPx() / baseCell,
  width: effW.value * baseCell + 'px',
  height: effH.value * baseCell + 'px',
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
}))

const { all, hasData } = useEntities()

// ================= 运行时根元素 =================
const wrapRef = ref(null)
function cardRoot() { return wrapRef.value?.querySelector('.hc-code-card') || null }
function surfaceEl() {
  const r = cardRoot()
  const first = r?.firstElementChild
  return first && first.hasAttribute('data-vid') ? first : null
}
const hasTemplate = ref(true)

// 重渲染后重新定位选中态（CodeCard 的 v-html 会整体重建 DOM）
watch(() => props.card.html, () => nextTick(afterRender))
// 切换实体 / 实时数据首次到达时 CodeCard 也会重渲染，选中态同样需要重绑
watch(() => [props.card.entity_id, hasData.value], () => nextTick(afterRender))
onMounted(() => {
  nextTick(afterRender)
  wrapRef.value?.focus({ preventScroll: true })
})
function afterRender() {
  hasTemplate.value = !!cardRoot()?.querySelector('[data-vid]')
  setHover(null)
  markSelected()
  readSelVals()
}

// ================= 选择 / 悬停 =================
const selectedVid = ref('')
const hoverTag = reactive({ show: false, text: '', vid: '', style: {} })
let hoverEl = null

function descriptor(el) {
  if (!el) return ''
  const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).filter((c) => c !== 'hc-iconsvg')[0]
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
}
function candidateFromEvent(e) {
  const root = cardRoot()
  if (!root || !root.contains(e.target)) return null
  const hit = e.target.closest && e.target.closest('[data-vid]')
  if (hit && root.contains(hit)) return hit
  return surfaceEl()
}
function selectEl(el) {
  selectedVid.value = el?.dataset.vid || ''
  closePopovers()
  markSelected()
  readSelVals()
  wrapRef.value?.focus({ preventScroll: true })
}
function markSelected() {
  const root = cardRoot()
  if (!root) return
  root.querySelectorAll('.ve-on').forEach((n) => n.classList.remove('ve-on'))
  if (selectedVid.value) {
    const el = root.querySelector('[data-vid="' + selectedVid.value + '"]')
    if (el) el.classList.add('ve-on')
  }
}
// 选中元素变化 → 通知父级（用于右侧「元素代码」编辑视图）
watch(selectedVid, () => {
  const el = selectedVid.value ? docEl(selectedVid.value) : null
  emit('select', { vid: selectedVid.value, desc: el ? descriptor(el) : '' })
})
function setHover(el, e) {
  if (hoverEl === el) {
    if (el) positionHoverTag(el, e)
    return
  }
  if (hoverEl) hoverEl.classList.remove('ve-hover')
  hoverEl = el
  if (el) {
    el.classList.add('ve-hover')
    hoverTag.show = true
    hoverTag.vid = el.dataset.vid
    hoverTag.text = descriptor(el)
    positionHoverTag(el, e)
  } else {
    hoverTag.show = false
  }
}
function positionHoverTag(el, e) {
  const wrap = wrapRef.value.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  let left = r.left - wrap.left
  let top = r.top - wrap.top - 20
  if (top < 4) top = r.bottom - wrap.top + 4
  hoverTag.style = { left: left + 'px', top: top + 'px' }
}
function onHoverMove(e) {
  if (drag) return
  const el = candidateFromEvent(e)
  setHover(el, e)
}

// ================= 拖动定位（overlay ghost 方案） =================
// 设计原则（参考 Figma / Framer 等成熟编辑器）：
// 拖动期间【完全不改动卡片 DOM】——原元素仅 visibility:hidden（保持占位，
// 兄弟不重排、容器尺寸不变），在 body 层创建一个逐节点内联计算样式的「幽灵」副本，
// 用纯屏幕像素跟随光标（零坐标换算，天然 1:1 跟手）。
// 松手时只做一次换算：幽灵屏幕位移 ÷ K（实测卡根宽 ÷ (格数×120)，涵盖 zoom
// 与 transform:scale），写入模板文档并序列化回 card.html。
// 关键：落位用 transform:translate 平移，元素【始终留在文档流中】占位，
// 兄弟元素永不重排、位置不受影响；多次拖动按累计位移叠加。
let drag = null
function onPointerDown(e) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  // 点击浮层内部不触发画布交互（浮层自身已 capture.stop，双保险）
  if (e.target.closest && e.target.closest('.ve-pop, .ve-icon-pop, .ve-bar, .ve-tools, .ve-hint-card, .ve-needentity')) return
  closePopovers()
  const el = candidateFromEvent(e)
  if (!el) return
  e.preventDefault()
  e.stopPropagation()
  drag = {
    el,
    vid: el.dataset.vid,
    sx: e.clientX,
    sy: e.clientY,
    moved: false,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}
// 深拷贝元素并把「计算后样式」逐节点内联到副本上，
// 使幽灵脱离卡片作用域 CSS 也能 1:1 还原屏幕外观（含 zoom 后的实际尺寸）。
function cloneWithStyles(src) {
  const dst = src.cloneNode(true)
  const a = [src, ...src.querySelectorAll('*')]
  const b = [dst, ...dst.querySelectorAll('*')]
  for (let i = 0; i < a.length && i < b.length; i++) {
    try { b[i].setAttribute('style', getComputedStyle(a[i]).cssText) } catch { /* 忽略个别节点 */ }
  }
  return dst
}
function startDrag() {
  const el = drag.el
  const r = el.getBoundingClientRect()
  drag.rect = { left: r.left, top: r.top, width: r.width, height: r.height }
  drag.grabX = drag.sx - r.left
  drag.grabY = drag.sy - r.top
  drag.x = r.left
  drag.y = r.top
  drag.cardRect = cardRoot().getBoundingClientRect()

  // 幽灵挂在 body 层 fixed 容器中：祖先的 zoom / transform 都不会干扰它
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none'
  const ghost = cloneWithStyles(el)
  Object.assign(ghost.style, {
    position: 'absolute',
    boxSizing: 'border-box',
    left: r.left + 'px',
    top: r.top + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
    margin: '0',
    opacity: '0.92',
    boxShadow: '0 10px 34px rgba(0,0,0,0.45)',
    outline: '1.5px solid rgba(245,166,35,0.9)',
  })
  holder.appendChild(ghost)
  document.body.appendChild(holder)
  drag.holder = holder

  el.style.visibility = 'hidden'
  setHover(null)
  selectedVid.value = drag.vid
  readSelVals()
  wrapRef.value?.classList.add('ve-dragging')
  wrapRef.value?.focus({ preventScroll: true })
}
// 把幽灵限制在卡片屏幕范围内（拖不丢）
function clampGhost(d) {
  const cr = d.cardRect
  d.x = Math.max(cr.left, Math.min(d.x, Math.max(cr.left, cr.right - d.rect.width)))
  d.y = Math.max(cr.top, Math.min(d.y, Math.max(cr.top, cr.bottom - d.rect.height)))
}
function onDragMove(e) {
  if (!drag) return
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return
    drag.moved = true
    startDrag()
  }
  drag.x = e.clientX - drag.grabX
  drag.y = e.clientY - drag.grabY
  clampGhost(drag)
  // 纯屏幕像素位移：transform 只作用于 body 层容器，零换算、必然跟手
  drag.holder.style.transform = `translate(${drag.x - drag.rect.left}px, ${drag.y - drag.rect.top}px)`
}
const round1 = (n) => Math.round(n * 10) / 10
// 解析元素已存在的 translate 位移（多次拖动累计），仅支持 px
function parseTranslate(style) {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style || '')
  return m ? { x: parseFloat(m[1]) || 0, y: parseFloat(m[2]) || 0 } : { x: 0, y: 0 }
}
function commitDrag(d) {
  const rootRect = cardRoot().getBoundingClientRect()
  const K = rootRect.width > 0 ? rootRect.width / (effW.value * baseCell) : 1
  pushHistory()
  const tel = docEl(d.vid)
  if (!tel) return
  // 幽灵屏幕位移 → 设计像素位移，叠加已有 translate（元素保留在文档流中占位）
  const t = parseTranslate(tel.getAttribute('style'))
  const dx = round1(t.x + (d.x - d.rect.left) / K)
  const dy = round1(t.y + (d.y - d.rect.top) / K)
  rawSet(tel, 'transform', `translate(${dx}px, ${dy}px)`)
  rawSet(tel, 'z-index', '6')
  emitHtml()
}
function onDragUp() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointercancel', onDragUp)
  const d = drag
  drag = null
  wrapRef.value?.classList.remove('ve-dragging')
  if (!d) return
  if (!d.moved) {
    selectEl(d.el)
    return
  }
  d.holder.remove()
  commitDrag(d)
  // commitDrag → emitHtml 会整体重建卡片 DOM，原元素的 visibility 随旧节点一并销毁
}
function cancelDrag() {
  if (!drag) return
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointercancel', onDragUp)
  drag.holder?.remove()
  drag.el.style.visibility = ''
  wrapRef.value?.classList.remove('ve-dragging')
  drag = null
}

// ================= 双击：文字 / 图标 =================
function onDblClick(e) {
  const el = candidateFromEvent(e)
  if (!el) return
  if (isDocIcon(el.dataset.vid)) openIcon(el)
  else openText(el)
}

// ---- 原始 style 字符串编辑（DOMParser 会丢弃含 {{}} 的非法声明，故手工维护） ----
function rawGet(el) { return el.getAttribute('style') || '' }
function rawSet(el, prop, val) {
  let s = rawGet(el)
  const re = new RegExp('(^|;)\\s*' + prop.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*:[^;]*', 'i')
  if (val === null || val === undefined || val === '') {
    s = s.replace(re, '$1')
  } else if (re.test(s)) {
    s = s.replace(re, '$1' + prop + ':' + val)
  } else {
    s = s.replace(/\s+$/, '') + (s && !/;\s*$/.test(s) ? ';' : '') + prop + ':' + val
  }
  s = s.replace(/^;/, '').replace(/;{2,}/g, ';')
  if (s.trim()) el.setAttribute('style', s)
  else el.removeAttribute('style')
}

// ---- 文字编辑 ----
// 是否为数据值域文本：含除 {{name}} 之外的动态 token（传感器值/键值对）
// 这类文字按实际值显示，禁止修改；只有实体名字（{{name}}）与静态说明可编辑。
function textIsValue(tpl) {
  let isValue = false
  String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    if (k !== 'name') isValue = true
  })
  return isValue
}
const textPop = reactive({ open: false, vid: '', desc: '', value: '', token: '', origTpl: '', node: null, style: {}, fs: 12 })
const textInputRef = ref(null)
const popEntity = computed(() => (props.card.entity_id ? entityStates[props.card.entity_id] || null : null))
const popData = computed(() =>
  computeData(props.card.type, { all: all.value, hasData: hasData.value, entity: popEntity.value, entityId: props.card.entity_id, now: new Date(), card: props.card }))

function textNodeOf(dEl) {
  const nodes = [...dEl.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim() !== '')
  return nodes[0] || null
}
function openText(el) {
  const vid = el.dataset.vid
  const dEl = docEl(vid)
  if (!dEl) return
  const node = textNodeOf(dEl)
  if (!node) return
  const tpl = node.nodeValue
  if (textIsValue(tpl)) return // 键值对值域：按传感器实际值显示，禁止编辑
  const shown = renderTemplate(tpl, popData.value)
  const m = /\{\{\s*(\w+)\s*\}\}/.exec(tpl)
  const wrap = wrapRef.value.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const rootRect = cardRoot()?.getBoundingClientRect()
  const k = rootRect ? rootRect.width / (effW.value * cellPx()) : 1 // zoom × scale 综合系数
  textPop.open = true
  textPop.vid = vid
  textPop.desc = descriptor(el)
  textPop.node = node
  textPop.origTpl = tpl
  textPop.token = m ? m[0] : ''
  textPop.value = shown.trim()
  textPop.fs = Math.max(11, Math.min(22, parseFloat(cs.fontSize) * k))
  const left = Math.min(Math.max(r.left - wrap.left, 8), wrap.width - 200)
  const above = r.bottom - wrap.top > wrap.height - 120
  textPop.style = {
    left: left + 'px',
    [above ? 'bottom' : 'top']: (above ? wrap.height - (r.top - wrap.top) + 6 : r.bottom - wrap.top + 6) + 'px',
    width: Math.max(180, Math.min(320, r.width + 24)) + 'px',
  }
  nextTick(() => textInputRef.value?.select())
}
function confirmText() {
  if (!textPop.node) { textPop.open = false; return }
  const lead = (textPop.origTpl.match(/^\s*/) || [''])[0]
  const trail = (textPop.origTpl.match(/\s*$/) || [''])[0]
  pushHistory()
  textPop.node.nodeValue = lead + textPop.value + trail
  textPop.open = false
  emitHtml()
}
function restoreToken() {
  pushHistory()
  if (textPop.node) textPop.node.nodeValue = textPop.origTpl
  textPop.open = false
  emitHtml()
}

// ---- 右侧属性面板文字输入（与双击弹层一致：只改显示的文字） ----
const barTextRef = ref(null)
const barTextVal = ref('')
let barTextNode = null // 当前选中文案的模板节点（doc 层）
let barTextShown = '' // 刷新时的原始显示值，用于判断是否真的被改动
const selTextToken = computed(() => {
  const node = barTextNode
  if (!node) return ''
  const m = /\{\{\s*(\w+)\s*\}\}/.exec(node.nodeValue)
  return m ? m[0] : ''
})
function refreshBarText() {
  barTextNode = null
  barTextShown = ''
  barTextVal.value = ''
  if (!selectedVid.value) return
  const dEl = docEl(selectedVid.value)
  const node = dEl ? textNodeOf(dEl) : null
  if (!node) return
  barTextNode = node
  barTextShown = renderTemplate(node.nodeValue, popData.value).trim()
  barTextVal.value = barTextShown
}
function applyBarText(v) {
  barTextVal.value = v
  // 实时只改运行时文本节点，预览即时更新；最终提交走 doc 层
  const el = selRuntime()
  if (!el) return
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim() !== '')
  if (node) node.nodeValue = v
}
function commitBarText() {
  const node = barTextNode
  if (!node || barTextVal.value === barTextShown) return
  const orig = node.nodeValue
  const lead = (orig.match(/^\s*/) || [''])[0]
  const trail = (orig.match(/\s*$/) || [''])[0]
  pushHistory()
  node.nodeValue = lead + barTextVal.value + trail
  emitHtml()
}
function revertBarText() {
  refreshBarText()
  barTextRef.value?.blur()
}

// ---- 图标 ----
const iconPop = reactive({ open: false, vid: '' })
const iconQuery = ref('')
const customIcon = ref('')
const iconSearchRef = ref(null)
const CURATED = [
  'home', 'lightbulb', 'ceiling_light', 'lamp', 'toggle_on', 'mode_fan', 'sensors', 'thermostat',
  'curtains', 'tv', 'speaker', 'lock', 'lock_open', 'shield', 'videocam', 'robot', 'person',
  'person_pin', 'partly_cloudy_day', 'wb_sunny', 'air', 'water_drop', 'bolt', 'calendar_month',
  'schedule', 'timer', 'door_front', 'window', 'blinds', 'spa', 'yard', 'map', 'navigation',
  'my_location', 'dark_mode', 'light_mode', 'image', 'palette', 'power_settings_new', 'play_arrow',
  'pause', 'stop', 'volume_up', 'mic', 'add', 'remove', 'check', 'close', 'restart_alt', 'delete',
]
const iconList = ref([])
const iconCurrent = ref('')
let iconLoaded = false
async function loadIcons() {
  if (iconLoaded) return
  try {
    const r = await fetch('/api/v1/icons')
    const j = r.ok ? await r.json() : { data: [] }
    iconList.value = j.data || []
  } catch { iconList.value = [] }
  iconLoaded = true
}
const visibleIcons = computed(() => {
  const known = new Set(iconList.value)
  const base = [...CURATED.filter((n) => !known.size || known.has(n)), ...iconList.value]
  const uniq = [...new Set(base)]
  const q = iconQuery.value.trim().toLowerCase()
  const out = q ? uniq.filter((n) => n.includes(q)) : uniq
  return out.slice(0, 120)
})
const validCustom = computed(() => /^[a-z0-9_]+$/.test(customIcon.value.trim()))
function iconSwatch(n) {
  const u = iconUrl(n)
  return { '-webkit-mask-image': `url("${u}")`, 'mask-image': `url("${u}")` }
}
function isDocIcon(vid) {
  const dEl = docEl(vid)
  if (!dEl || dEl.tagName !== 'SPAN') return false
  return /(^|\s)material-symbols-outlined(\s|$)/.test(dEl.getAttribute('class') || '')
}
function openIcon(el) {
  const dEl = docEl(el.dataset.vid)
  iconCurrent.value = (dEl?.textContent || '').trim()
  customIcon.value = iconCurrent.value
  iconQuery.value = ''
  iconPop.open = true
  iconPop.vid = el.dataset.vid
  loadIcons().then(() => nextTick(() => iconSearchRef.value?.focus()))
}
function pickIcon(name) {
  const n = String(name || '').trim()
  if (!/^[a-z0-9_]+$/.test(n)) return
  pushHistory()
  const dEl = docEl(iconPop.vid || selectedVid.value)
  if (dEl) {
    dEl.textContent = n
    emitHtml()
  }
  iconPop.open = false
}
function closePopovers() {
  textPop.open = false
  iconPop.open = false
}

// ================= 属性条 =================
const selDescriptor = computed(() => {
  const el = selRuntime()
  return el ? descriptor(el) : ''
})
const selIsIcon = computed(() => selectedVid.value ? isDocIcon(selectedVid.value) : false)
const selIsSurface = computed(() => {
  const s = docBox().firstElementChild
  return !!s && s.getAttribute('data-vid') === selectedVid.value
})
const selIsText = computed(() => {
  if (!selectedVid.value) return false
  return !!textNodeOf(docEl(selectedVid.value))
})
// 文字内容可编辑：仅实体名字（{{name}}）与静态说明可改；键值对值域按实际值显示、禁止修改
const selCanText = computed(() => {
  if (!selIsText.value) return false
  return !textIsValue(textNodeOf(docEl(selectedVid.value)).nodeValue)
})
const selVals = reactive({ color: '#f2f0eb', bg: '#1a1b1e', bgSet: false, fontSize: 10, bold: false, align: 'left', radius: 0, hasPos: false })

function selRuntime() {
  if (!selectedVid.value) return null
  return cardRoot()?.querySelector('[data-vid="' + selectedVid.value + '"]') || null
}
function rgbToHex(v) {
  const m = /rgba?\(([^)]+)\)/.exec(v || '')
  if (!m) return ''
  const p = m[1].split(',').map((x) => x.trim())
  const h = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0')
  return '#' + h(p[0]) + h(p[1]) + h(p[2])
}
function readSelVals() {
  refreshBarText()
  const el = selRuntime()
  if (!el) return
  const cs = getComputedStyle(el)
  selVals.color = rgbToHex(cs.color) || '#f2f0eb'
  const bg = cs.backgroundColor
  selVals.bgSet = !/rgba\([^)]*,\s*0+\s*\)/.test(bg || '')
  selVals.bg = rgbToHex(bg) || '#1a1b1e'
  selVals.fontSize = Math.round(parseFloat(cs.fontSize) || 10)
  selVals.bold = (parseInt(cs.fontWeight) || 400) >= 600
  selVals.align = (cs.textAlign || 'left').replace('-webkit-', '')
  selVals.radius = Math.round(parseFloat(cs.borderTopLeftRadius) || 0)
  selVals.hasPos = !!el.style.transform || el.style.position === 'absolute'
}
function applyLive(prop, val) {
  const el = selRuntime()
  if (el) el.style.setProperty(prop, val)
}
function commitProps(map) {
  const dEl = docEl(selectedVid.value)
  if (!dEl) return
  pushHistory()
  Object.entries(map).forEach(([k, v]) => rawSet(dEl, k, v))
  emitHtml()
}
function commitClear(prop) {
  const dEl = docEl(selectedVid.value)
  if (!dEl) return
  pushHistory()
  rawSet(dEl, prop, null)
  emitHtml()
}
function toggleBold() {
  commitProps({ 'font-weight': selVals.bold ? '400' : '700' })
}
function resetPosition() {
  const dEl = docEl(selectedVid.value)
  if (!dEl) return
  pushHistory()
  // 清除拖动写入的位移/层级/冻结尺寸，让元素完全回到原始文档流布局
  ;['position', 'left', 'top', 'right', 'bottom', 'z-index', 'width', 'height', 'transform'].forEach((p) => rawSet(dEl, p, null))
  emitHtml()
}
function deleteElement() {
  const dEl = docEl(selectedVid.value)
  if (!dEl || selIsSurface.value) return
  pushHistory()
  dEl.remove()
  selectedVid.value = ''
  emitHtml()
}
function openIconFromBar() {
  const el = selRuntime()
  if (el) openIcon(el)
}

// ================= 撤销 / 重做 =================
const undoStack = ref([])
const redoStack = ref([])
function pushHistory() {
  undoStack.value.push(props.card.html)
  if (undoStack.value.length > 60) undoStack.value.shift()
  redoStack.value = []
}
function emitHtml() {
  emit('html', serialize())
}
function undo() {
  if (!undoStack.value.length) return
  redoStack.value.push(props.card.html)
  emit('html', undoStack.value.pop())
}
function redo() {
  if (!redoStack.value.length) return
  undoStack.value.push(props.card.html)
  emit('html', redoStack.value.pop())
}
function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase()
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable
  if (e.key === 'Escape') {
    if (textPop.open || iconPop.open) { e.stopPropagation(); closePopovers(); return }
    if (drag) { e.stopPropagation(); cancelDrag(); return }
    if (selectedVid.value) { e.stopPropagation(); selectedVid.value = ''; markSelected(); return }
  }
  if (typing) return
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    e.stopPropagation()
    if (e.shiftKey) redo(); else undo()
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedVid.value && !selIsSurface.value) {
    e.preventDefault()
    deleteElement()
  }
}

const showHint = ref(true)

// ================= 元素代码编辑（暴露给 CardEditor 的「元素代码」视图） =================
// 只读：返回当前选中元素的 outerHTML
function getElementHtml() {
  const tel = docEl(selectedVid.value)
  return tel ? tel.outerHTML : ''
}
function getSelectedDescriptor() {
  const el = selectedVid.value ? docEl(selectedVid.value) : null
  return el ? descriptor(el) : ''
}
// 应用：用解析后的新元素替换当前选中元素（保留 data-vid 身份），返回错误信息或空串
function applyElementHtml(html) {
  const tel = docEl(selectedVid.value)
  if (!tel) return '未选中可编辑的元素'
  const s = String(html || '').trim()
  if (!s) return '元素代码不能为空'
  let parsed
  try {
    parsed = new DOMParser().parseFromString(s, 'text/html')
  } catch {
    return 'HTML 解析失败'
  }
  const roots = [...parsed.body.childNodes].filter((n) => n.nodeType === 1)
  if (roots.length !== 1) return '只允许一个根元素（请把内容合并到一个元素内）'
  pushHistory()
  const newEl = roots[0]
  newEl.setAttribute('data-vid', selectedVid.value)
  tel.replaceWith(newEl)
  emitHtml()
  return ''
}
defineExpose({ getElementHtml, getSelectedDescriptor, applyElementHtml })

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointercancel', onDragUp)
  window.removeEventListener('pointerup', onDragUp)
  drag?.holder?.remove()
  drag = null
})
</script>

<style scoped>
.ve-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.ve-wrap.ve-dragging,
.ve-wrap.ve-dragging * {
  cursor: grabbing !important;
}
.ve-slot { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.ve-ph {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  background: rgb(var(--c-surface));
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.07);
}
.ve-wrap :deep(.hc-code-card) { position: relative; }
.ve-wrap :deep(.hc-code-card [data-vid]) { cursor: move; }

/* 悬停 / 选中 */
.ve-wrap :deep(.ve-hover) {
  outline: 1.5px dashed rgba(245, 166, 35, 0.85) !important;
  outline-offset: -1px;
}
.ve-wrap :deep(.ve-on) {
  outline: 2px solid #f5a623 !important;
  outline-offset: -1px;
  box-shadow: 0 0 0 4px rgba(245, 166, 35, 0.16) !important;
}
.ve-tag {
  position: absolute;
  z-index: 8;
  transform: translateY(-100%);
  pointer-events: none;
  font: 600 10px/1 ui-monospace, Menlo, Consolas, monospace;
  color: #1a1206;
  background: #f5a623;
  padding: 3px 6px;
  border-radius: 5px 5px 5px 0;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* 顶部工具 */
.ve-tools {
  position: absolute;
  z-index: 9;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: rgba(20, 21, 24, 0.92);
  border: 1px solid #34353b;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
}
.ve-tbtn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #b6b4ad;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ve-tbtn:hover:not(:disabled) { background: rgba(245, 166, 35, 0.14); color: #f5a623; }
.ve-tbtn:disabled { opacity: 0.32; cursor: default; }
.ve-tbtn .material-symbols-outlined { font-size: 17px; }
.ve-tools-divider { width: 1px; height: 18px; background: #2e2f33; margin: 0 2px; }

/* 帮助卡片 */
.ve-hint-card {
  position: absolute;
  z-index: 9;
  top: 54px;
  left: 10px;
  width: 308px;
  max-width: calc(100% - 20px);
  padding: 13px 14px 11px;
  background: rgba(20, 21, 24, 0.96);
  border: 1px solid #3a3b41;
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  color: #c9c7c0;
  font-size: 12px;
  line-height: 1.5;
}
.ve-hint-card p { margin: 0 0 8px; color: #f2f0eb; font-size: 12.5px; }
.ve-hint-card ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ve-hint-card li { display: flex; align-items: flex-start; gap: 7px; }
.ve-hint-card .material-symbols-outlined { font-size: 14px; color: #f5a623; margin-top: 1px; flex: none; }
.ve-hint-close {
  margin-top: 10px;
  width: 100%;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(245, 166, 35, 0.4);
  background: rgba(245, 166, 35, 0.14);
  color: #f5a623;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.ve-hint-enter-active, .ve-hint-leave-active { transition: all 0.2s ease; }
.ve-hint-enter-from, .ve-hint-leave-to { opacity: 0; transform: translateX(-8px); }

/* 无实体遮罩 */
.ve-needentity {
  position: absolute;
  inset: 0;
  z-index: 7;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(14, 15, 18, 0.82);
  backdrop-filter: blur(2px);
  border-radius: 12px;
  text-align: center;
  padding: 20px;
}
.ve-ne-icon { font-size: 34px; color: #8a8986; }
.ve-needentity p { margin: 0; font-size: 12.5px; color: #b6b4ad; max-width: 260px; }
.ve-ne-btn {
  margin-top: 4px;
  height: 34px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  border: 1px solid rgba(245, 166, 35, 0.45);
  background: #f5a623;
  color: #0e0f12;
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
}
.ve-fade-enter-active, .ve-fade-leave-active { transition: opacity 0.2s ease; }
.ve-fade-enter-from, .ve-fade-leave-to { opacity: 0; }

/* ============ 属性条（位于右侧属性面板内，静态纵向布局） ============ */
.ve-bar {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 9px;
  padding: 11px 13px;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}
.ve-bar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font: 600 11px/1 ui-monospace, Menlo, Consolas, monospace;
  color: #f5a623;
  padding-bottom: 8px;
  border-bottom: 1px solid #2e2f33;
}
.ve-bar-title .material-symbols-outlined { font-size: 15px; }
/* ---- 数据来源实体区块 ---- */
.ve-src {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 10px;
  border: 1px solid #2e2f33;
  border-radius: 9px;
  background: #191a1d;
}
.ve-src-head { display: flex; align-items: center; gap: 6px; }
.ve-src-head > .material-symbols-outlined { font-size: 14px; color: #8fbce4; flex: none; }
.ve-src-title { font: 700 11px/1 ui-monospace, Menlo, Consolas, monospace; color: #d8d6cf; }
.ve-src-auto {
  flex: none;
  font: 600 9.5px/1 ui-monospace, Menlo, Consolas, monospace;
  color: #f5a623;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid rgba(245, 166, 35, 0.3);
  border-radius: 5px;
  padding: 2px 6px;
}
.ve-src-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ve-domain-badge {
  flex: none;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #6ba3d9;
  background: rgba(107, 163, 217, 0.12);
  border: 1px solid rgba(107, 163, 217, 0.25);
  border-radius: 5px;
  padding: 2px 6px;
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ve-src-name {
  font-size: 12px;
  font-weight: 600;
  color: #f2f0eb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ve-src-id {
  flex: none;
  font: 10px/1 ui-monospace, Menlo, Consolas, monospace;
  color: #8a8986;
  background: #232428;
  border-radius: 4px;
  padding: 2px 5px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ve-src-empty {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: 11px;
  color: #8a8986;
}
.ve-src-empty .material-symbols-outlined { font-size: 13px; }
.ve-src-attrs {
  list-style: none;
  margin: 0;
  padding: 6px 0 0;
  border-top: 1px dashed #2e2f33;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}
.ve-src-attrs li { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.ve-src-a-key {
  flex: none;
  font: 10px/1.4 ui-monospace, Menlo, Consolas, monospace;
  color: #8a8986;
}
.ve-src-a-val {
  font-size: 11px;
  color: #d8d6cf;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ve-bar-scroll {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
/* 大面板内：分隔符占满整行形成横向分组线 */
.ve-bar-scroll .ve-sep { flex: 0 0 100%; width: auto; height: 1px; margin: 2px 0; }
.ve-chip {
  flex: none;
  height: 30px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  border: 1px solid #34353b;
  background: #232428;
  color: #d8d6cf;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ve-chip:hover { border-color: rgba(245, 166, 35, 0.5); color: #f5a623; }
.ve-chip:disabled { opacity: 0.4; cursor: default; }
.ve-chip .material-symbols-outlined { font-size: 15px; }
.ve-chip-accent { border-color: rgba(107, 163, 217, 0.45); color: #8fbce4; background: rgba(107, 163, 217, 0.1); }
.ve-chip-danger:hover { border-color: rgba(232, 93, 76, 0.6); color: #f09185; background: rgba(232, 93, 76, 0.1); }
.ve-chip-mini { padding: 0 8px; font-size: 11px; }
.ve-sep { flex: none; width: 1px; height: 20px; background: #2e2f33; }
.ve-ctl {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  color: #8a8986;
  cursor: pointer;
}
.ve-ctl-ic { font-size: 16px !important; }
.ve-ctl input[type='color'] {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid #34353b;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.ve-ctl-range input[type='range'] { width: 74px; accent-color: #f5a623; cursor: pointer; }
.ve-ctl-range em { font-style: normal; font-size: 10.5px; color: #8a8986; width: 22px; text-align: right; }
.ve-ctl-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid #34353b;
  background: #232428;
  color: #8a8986;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ve-ctl-btn.on { border-color: rgba(245, 166, 35, 0.6); background: rgba(245, 166, 35, 0.16); color: #f5a623; }
.ve-bold-b { font-weight: 800; font-size: 13px; font-family: Georgia, serif; }
.ve-seg {
  flex: none;
  display: inline-flex;
  border: 1px solid #34353b;
  border-radius: 8px;
  overflow: hidden;
}
.ve-seg button {
  width: 28px;
  height: 28px;
  border: none;
  background: #232428;
  color: #8a8986;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ve-seg button + button { border-left: 1px solid #34353b; }
.ve-seg button.on { background: rgba(245, 166, 35, 0.18); color: #f5a623; }
.ve-seg .material-symbols-outlined { font-size: 14px; }
.ve-bar-enter-active, .ve-bar-leave-active { transition: all 0.18s ease; }
.ve-bar-enter-from, .ve-bar-leave-to { opacity: 0; transform: translateY(8px); }

/* 属性面板：文字输入行 */
.ve-text-row {
  flex: 0 0 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid #34353b;
  background: #121316;
  color: #8a8986;
}
.ve-text-row .material-symbols-outlined { font-size: 15px; flex: none; }
.ve-text-row input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: #f2f0eb;
  font-size: 12.5px;
  font-weight: 600;
}
.ve-text-row:focus-within { border-color: #f5a623; }
.ve-text-hint {
  flex: 0 0 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: -2px 0 0;
  font-size: 10.5px;
  color: #9a9994;
}
.ve-text-hint .material-symbols-outlined { font-size: 13px; color: #f5a623; }
.ve-text-hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: #f5a623;
  background: rgba(245, 166, 35, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
}
.ve-text-lock {
  flex: 0 0 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: -2px 0 0;
  font-size: 10.5px;
  color: #8a8986;
}
.ve-text-lock .material-symbols-outlined { font-size: 13px; color: #6f6e6a; }

/* ============ 文字弹层 ============ */
.ve-pop {
  position: absolute;
  z-index: 20;
  background: #1a1b1f;
  border: 1px solid #41424a;
  border-radius: 11px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ve-pop-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 700;
  color: #f2f0eb;
  padding: 2px 4px 4px;
}
.ve-pop-head .material-symbols-outlined { font-size: 14px; color: #f5a623; }
.ve-pop-head-label { flex: none; }
.ve-pop-head-desc {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: #8fbce4;
  background: rgba(107, 163, 217, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
}
.ve-text-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #34353b;
  border-radius: 8px;
  background: #121316;
  color: #f2f0eb;
  padding: 6px 9px;
  outline: none;
  font-family: 'Source Sans 3', system-ui, sans-serif;
  font-weight: 600;
}
.ve-text-input:focus { border-color: #f5a623; }
.ve-pop-foot { display: flex; align-items: center; gap: 8px; }
.ve-token-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: #9a9994;
}
.ve-token-hint .material-symbols-outlined { font-size: 13px; color: #f5a623; }
.ve-token-hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: #f5a623;
  background: rgba(245, 166, 35, 0.1);
  padding: 1px 5px;
  border-radius: 4px;
}
.ve-spacer { flex: 1; }
.ve-btn-ghost,
.ve-btn-primary {
  height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ve-btn-ghost { background: transparent; border: 1px solid #34353b; color: #b6b4ad; }
.ve-btn-ghost:hover { border-color: #55565e; color: #f2f0eb; }
.ve-btn-primary { background: #f5a623; border: 1px solid #f5a623; color: #0e0f12; }
.ve-btn-primary:disabled { opacity: 0.45; cursor: default; }
.ve-pop-enter-active, .ve-pop-leave-active { transition: all 0.16s ease; }
.ve-pop-enter-from, .ve-pop-leave-to { opacity: 0; transform: translateY(6px); }

/* ============ 图标选择器 ============ */
.ve-icon-pop {
  position: absolute;
  z-index: 20;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, calc(100% - 40px));
  max-height: 82%;
  display: flex;
  flex-direction: column;
  background: #1a1b1f;
  border: 1px solid #41424a;
  border-radius: 14px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}
.ve-icon-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border-bottom: 1px solid #2a2b2f;
}
.ve-icon-title { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; color: #f2f0eb; flex: none; }
.ve-icon-title .material-symbols-outlined { font-size: 16px; color: #f5a623; }
.ve-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 9px;
  border-radius: 8px;
  background: #121316;
  border: 1px solid #2e2f33;
}
.ve-search .material-symbols-outlined { font-size: 15px; color: #6f6e6a; }
.ve-search-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-size: 12.5px; color: #e8e5dd; }
.ve-icon-close { width: 28px; height: 28px; border: none; border-radius: 7px; background: transparent; color: #8a8986; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
.ve-icon-close:hover { background: rgba(255, 255, 255, 0.07); color: #f2f0eb; }
.ve-icon-grid {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 6px;
  align-content: start;
}
.ve-icon-cell {
  height: 40px;
  border: 1px solid #2e2f33;
  border-radius: 9px;
  background: #202126;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s, background 0.12s, transform 0.08s;
}
.ve-icon-cell:hover { border-color: rgba(245, 166, 35, 0.6); background: rgba(245, 166, 35, 0.08); transform: translateY(-1px); }
.ve-icon-cell.on { border-color: #f5a623; background: rgba(245, 166, 35, 0.16); }
.ve-ic-swatch {
  width: 20px;
  height: 20px;
  background: #d8d6cf;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.ve-icon-empty { grid-column: 1 / -1; text-align: center; color: #6f6e6a; font-size: 12px; padding: 20px 0; }
.ve-icon-foot {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #2a2b2f;
}
.ve-custom-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid #2e2f33;
  background: #121316;
  color: #e8e5dd;
  font-size: 12px;
  outline: none;
}
.ve-custom-input:focus { border-color: #f5a623; }
</style>

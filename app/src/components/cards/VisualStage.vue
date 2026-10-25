<template>
  <div
    ref="wrapRef"
    class="ve-wrap"
    :data-layer="designLayer"
    tabindex="-1"
    @pointerdown.capture="onPointerDown"
    @pointermove.capture="onHoverMove"
    @dblclick="onDblClick"
    @keydown.capture="onKey"
  >
    <!-- 顶部工具：撤销/重做/选中元素操作（层级+删除）/帮助 -->
    <div class="ve-tools">
      <button class="ve-tbtn" :disabled="!undoStack.length" title="撤销（Ctrl+Z）" @click="undo">
        <span class="material-symbols-outlined">undo</span>
      </button>
      <button class="ve-tbtn" :disabled="!redoStack.length" title="重做（Ctrl+Shift+Z）" @click="redo">
        <span class="material-symbols-outlined">redo</span>
      </button>
      <template v-if="selectedVid && !selIsSurface">
        <span class="ve-tools-divider"></span>
        <button class="ve-tbtn" title="置于最上层" @click="layerOp(selectedVid, 'front')">
          <span class="material-symbols-outlined">vertical_align_top</span>
        </button>
        <button class="ve-tbtn" title="上移一层" @click="layerOp(selectedVid, 'up')">
          <span class="material-symbols-outlined">arrow_upward</span>
        </button>
        <button class="ve-tbtn" title="下移一层" @click="layerOp(selectedVid, 'down')">
          <span class="material-symbols-outlined">arrow_downward</span>
        </button>
        <button class="ve-tbtn" title="置于最下层" @click="layerOp(selectedVid, 'back')">
          <span class="material-symbols-outlined">vertical_align_bottom</span>
        </button>
        <button class="ve-tbtn ve-tbtn-del" title="删除该模型（Delete 键同效）" @click="deleteElement">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </template>
      <span class="ve-tools-divider"></span>
      <button class="ve-tbtn" :class="{ on: designLayer === 'pop' }" :title="designLayer === 'pop' ? '返回卡片层设计' : '设计弹窗层（先插入「弹窗层」模型）'" @click="toggleDesignLayer">
        <span class="material-symbols-outlined">{{ designLayer === 'pop' ? 'flip_to_front' : 'web_asset' }}</span>
      </button>
      <button class="ve-tbtn ve-tbtn-add" title="添加模型" @click.stop="toggleAddPop">
        <span class="material-symbols-outlined">add_box</span>
      </button>
      <button class="ve-tbtn" title="使用帮助" @click="showHint = !showHint">
        <span class="material-symbols-outlined">help</span>
      </button>
    </div>

    <!-- 添加模型弹层：模型库（点按插入到卡片中央，可连续添加） -->
    <Teleport to="body">
      <div v-if="addPop" class="ve-addpop-mask" @pointerdown="addPop = false">
        <div class="ve-addpop" :style="addPopStyle" @pointerdown.stop>
          <div v-for="g in WIDGET_GROUPS" :key="g.key" class="ve-addpop-group">
            <p class="ve-addpop-gtitle">{{ g.label }}</p>
            <div class="ve-addpop-grid">
              <button
                v-for="w in defsOf(g.key)"
                :key="w.key"
                class="ve-addpop-item"
                :title="'添加：' + w.label"
                @click="insertFromPop(w)"
              >
                <span class="material-symbols-outlined">{{ w.icon }}</span>
                <em>{{ w.label }}</em>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <Transition name="ve-hint">
      <div v-if="showHint" class="ve-hint-card">
        <p><b>图形设计模式</b>（不会调用任何真实设备操作）</p>
        <ul>
          <li><span class="material-symbols-outlined">add_box</span>顶部「添加模型」按钮或右侧「模型库」页可插入文字/图标/图片/背景/数据模型（右侧支持鼠标拖入画布）</li>
          <li><span class="material-symbols-outlined">web_asset</span>「弹窗层」模型运行时默认隐藏，用「弹窗按钮」打开；工具条 web_asset 图标切换卡片层/弹窗层设计</li>
          <li><span class="material-symbols-outlined">ads_click</span>点击模型选中，再次点击内层模型可精确选择</li>
          <li><span class="material-symbols-outlined">open_with</span>按住模型直接拖动，边缘会出参考线并自动吸附（按住 Alt 临时关闭吸附）</li>
          <li><span class="material-symbols-outlined">keyboard</span>选中后方向键微调 1px，Shift+方向键 10px</li>
          <li><span class="material-symbols-outlined">aspect_ratio</span>拖动选中框上的 8 个方块柄可改尺寸（Shift 等比）</li>
          <li><span class="material-symbols-outlined">stylus</span>双击文字直接改内容；双击图标换图标</li>
          <li><span class="material-symbols-outlined">tune</span>选中后用右侧属性条调色/字号/圆角；顶部工具条可添加模型、调层级与删除模型</li>
          <li><span class="material-symbols-outlined">layers</span>右侧「图层」页可查看模型树、点击选中、拖动行调整同一容器内的顺序</li>
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
        <p v-else>当前卡片没有可编辑的模型</p>
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
          <!-- 图片地址：输入即预览，回车/失焦提交 -->
          <label v-if="selIsImg" class="ve-text-row" title="图片地址（URL 或 data URI）">
            <span class="material-symbols-outlined">image</span>
            <input
              type="text"
              :value="barImgVal"
              placeholder="输入图片地址…"
              spellcheck="false"
              @input="applyBarImg($event.target.value)"
              @keydown.enter.prevent="commitBarImg"
              @keydown.esc.prevent="refreshBarImg()"
              @blur="commitBarImg"
            />
          </label>

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
          <button class="ve-chip" :disabled="!selVals.hasPos" title="恢复模型在布局中的原始位置与尺寸" @click="resetPosition">
            <span class="material-symbols-outlined">center_focus_strong</span>复位位置/尺寸
          </button>
          <!-- 层级调整与删除在顶部工具条（选中模型时出现） -->
        </div>
        <p class="ve-bar-hint">
          <span class="material-symbols-outlined">tips_and_updates</span>
          拖动模型可自动吸附对齐（按住 Alt 临时关闭）；方向键微调 1px，Shift+方向键 10px；拖动选中框上的方块柄改尺寸
        </p>
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

    <!-- ============ 缩放句柄：挂到 body 层，避免被 .ve-wrap 的 overflow:hidden 裁掉 ============ -->
    <Teleport to="body">
      <div v-if="handlesOn" class="ve-hz-layer" :style="hzLayerStyle">
        <i
          v-for="d in HANDLE_DIRS"
          :key="d"
          class="ve-hz"
          :class="'hz-' + d"
          @pointerdown.stop.prevent="onHandleDown($event, d)"
        ></i>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import CodeCard from './CodeCard.vue'
import { cardDefaults, computeData, renderTemplate } from './defaults'
import { widgetDef, widgetHtml, WIDGET_DEFS, WIDGET_GROUPS } from './widgets'
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
  // data-vid 是元素身份：已存在的保留，缺失的补「未被占用的最小序号」。
  // 不能用文档下标命名（删掉中间元素后再插入会与新元素撞号，导致选择/属性条/删除全部错乱）。
  const used = new Set()
  box.querySelectorAll('[data-vid]').forEach((el) => used.add(el.getAttribute('data-vid')))
  let n = 0
  box.querySelectorAll('*').forEach((el) => {
    if (el.hasAttribute('data-vid')) return
    while (used.has('e' + n)) n++
    el.setAttribute('data-vid', 'e' + n)
    used.add('e' + n)
  })
  parserDoc = d
  lastSrc = props.card.html
  return d
}
function docBox() { return ensureDoc().body }
function docEl(vid) { return docBox().querySelector('[data-vid="' + vid + '"]') }
function serialize() { return docBox().innerHTML }
// 新元素身份：现有 data-vid 数字后缀最大值 +1，保证唯一
function newVid() {
  let max = -1
  docBox().querySelectorAll('[data-vid]').forEach((el) => {
    const m = /^e(\d+)$/.exec(el.getAttribute('data-vid') || '')
    if (m) max = Math.max(max, Number(m[1]))
  })
  return 'e' + (max + 1)
}

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
  // 预览净缩放 = scale × (cellPx/baseCell)，边框厚度按它反向补偿，与仪表盘所见即所得
  '--card-bw': (1 / (props.scale * (cellPx() / baseCell) || 1)).toFixed(3) + 'px',
}))
const zoomStyle = computed(() => ({
  // transform:scale 替代 zoom：zoom 触发同步重排且与 container-type/content-visibility 组合会反复失效重排
  transform: `scale(${cellPx() / baseCell})`,
  width: effW.value * baseCell + 'px',
  height: effH.value * baseCell + 'px',
  display: 'flex',
  flexDirection: 'column',
  flex: 'none',
}))

// ================= 几何换算与位移抽象 =================
// 设计像素 = 卡片内局部 CSS px（外层只做 transform:scale，不影响计算样式）；
// 屏幕像素 = 设计像素 × K（K 综合了 previewScale 与 zoom 两层缩放）。
function K() {
  const r = cardRoot()?.getBoundingClientRect()
  if (!r || !r.width) return props.scale || 1
  return r.width / (effW.value * baseCell)
}
const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 2) / 2

// 绝对定位的包含块原点：根元素自带 position 时包含块是它的 padding box（要扣掉边框厚度），
// 否则回落 .hc-code-card 的 padding box（CodeCard 里它是 position:relative 且无内边距）。
// 各卡模板根元素有的 relative（.hc/.dk/.wx）有的是 static，不能硬编码，必须运行时测量。
function cbOrigin() {
  const root = cardRoot()
  if (!root) return null
  const r = root.getBoundingClientRect()
  const k = K()
  const first = root.firstElementChild
  const cs = first ? getComputedStyle(first) : null
  if (first && cs && cs.position !== 'static') {
    return {
      left: r.left + (parseFloat(cs.borderLeftWidth) || 0) * k,
      top: r.top + (parseFloat(cs.borderTopWidth) || 0) * k,
      right: r.right - (parseFloat(cs.borderRightWidth) || 0) * k,
      bottom: r.bottom - (parseFloat(cs.borderBottomWidth) || 0) * k,
    }
  }
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

// 模板文档元素对应的运行时元素（doc 元素脱离文档、没有计算样式，读基准值必须走运行时）
function rtEl(vid) {
  if (!vid) return null
  return cardRoot()?.querySelector('[data-vid="' + vid + '"]') || null
}

// ---- 位移抽象：flow（文档流内累计 transform 位移）与 abs（绝对定位 left/top）----
// 两种模式并存是为了向后兼容：历史卡片元素都在文档流里，靠 translate 位移（兄弟不重排）；
// 组件库插入的控件是自由摆放的绝对定位元素，直接改 left/top。
// doc 层元素没有计算样式，基准值必须在手势开始时从运行时元素抓一次，之后统一写 base + 累计位移。
function moveMode(rt) {
  const pos = rt ? getComputedStyle(rt).position : ''
  return pos === 'absolute' || pos === 'fixed' ? 'abs' : 'flow'
}
let moveBase = null
function captureMoveBase(rt, vid) {
  moveBase = null
  if (!rt) return null
  const mode = moveMode(rt)
  const base = { mode, left: 0, top: 0, tx: 0, ty: 0 }
  if (mode === 'abs') {
    const cs = getComputedStyle(rt)
    base.left = cs.left === 'auto' ? rt.offsetLeft : parseFloat(cs.left) || 0
    base.top = cs.top === 'auto' ? rt.offsetTop : parseFloat(cs.top) || 0
  } else {
    const t = parseTranslate(docEl(vid)?.getAttribute('style') || '')
    base.tx = t.x
    base.ty = t.y
  }
  moveBase = base
  return base
}
// 把设计像素位移写入模板文档元素
function writeMove(dDoc, dx, dy) {
  if (!dDoc || !moveBase) return
  if (moveBase.mode === 'abs') {
    rawSet(dDoc, 'left', round2(moveBase.left + dx) + 'px')
    rawSet(dDoc, 'top', round2(moveBase.top + dy) + 'px')
  } else {
    rawSet(dDoc, 'transform', `translate(${round1(moveBase.tx + dx)}px, ${round1(moveBase.ty + dy)}px)`)
  }
}

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

// 最近一次「已落地」的 HTML：emit 之后 props.card.html 要下一帧才更新，
// 而撤销栈 / 重做栈需要立即拿到准确值，故本地镜像一份。
let lastHtml = props.card.html
// 重渲染后重新定位选中态（CodeCard 的 v-html 会整体重建 DOM）
watch(() => props.card.html, (v) => { lastHtml = v; nextTick(afterRender) })
// 切换实体 / 实时数据首次到达时 CodeCard 也会重渲染，选中态同样需要重绑
watch(() => [props.card.entity_id, hasData.value], () => nextTick(afterRender))
onMounted(() => {
  nextTick(afterRender)
  wrapRef.value?.focus({ preventScroll: true })
  window.addEventListener('resize', syncOverlay)
  if (typeof ResizeObserver !== 'undefined' && cardRoot()) {
    new ResizeObserver(() => syncOverlay()).observe(wrapRef.value)
  }
})
function afterRender() {
  hasTemplate.value = !!cardRoot()?.querySelector('[data-vid]')
  setHover(null)
  markSelected()
  readSelVals()
  syncOverlay()
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
  flushEmit()
  selectedVid.value = el?.dataset.vid || ''
  closePopovers()
  markSelected()
  readSelVals()
  syncOverlay()
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
  if (e.target.closest && e.target.closest('.ve-pop, .ve-icon-pop, .ve-bar, .ve-tools, .ve-hint-card, .ve-needentity, .ve-hz-layer')) return
  flushEmit() // 方向键微调等延迟回写先落地，避免与新改动交叉
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
// body 层浮层容器：fixed + 零尺寸 + 不吃指针事件，祖先的 zoom / transform:scale 都干扰不到它，
// 坐标即屏幕像素（无需换算），也不会被 .ve-wrap 的 overflow:hidden 裁掉。
function makeBodyLayer(z) {
  const d = document.createElement('div')
  d.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;z-index:${z};pointer-events:none`
  document.body.appendChild(d)
  return d
}
// 浮层上的坐标/尺寸徽章（body 层元素拿不到 scoped 样式，故样式内联）
function makeBadge() {
  const b = document.createElement('div')
  b.style.cssText = 'position:absolute;transform:translateX(-50%);padding:2px 7px;border-radius:6px;'
    + 'background:rgb(var(--c-surface) / .92);color:rgb(var(--c-primary));border:1px solid rgb(var(--c-primary) / .45);'
    + 'font:600 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;pointer-events:none'
  return b
}
// 吸附目标：卡片边界 + 中轴，以及其它元素的三边与中轴。
// 拖动开始时抓一次即可——原件只是 visibility:hidden，兄弟布局不变。
function collectSnapTargets(exceptEl) {
  const t = { xs: [], ys: [] }
  const cb = cbOrigin()
  if (cb) {
    t.xs.push(cb.left, (cb.left + cb.right) / 2, cb.right)
    t.ys.push(cb.top, (cb.top + cb.bottom) / 2, cb.bottom)
  }
  const root = cardRoot()
  if (root) {
    root.querySelectorAll('[data-vid]').forEach((el) => {
      if (t.xs.length > 60) return
      if (el === exceptEl || el.contains(exceptEl) || exceptEl.contains(el)) return
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) return
      t.xs.push(r.left, r.left + r.width / 2, r.right)
      t.ys.push(r.top, r.top + r.height / 2, r.bottom)
    })
  }
  return t
}
// 单轴吸附：把元素的「起点 / 中点 / 终点」与参考值比对，取阈值内最近的一个做修正
function snapAxis(edges, values, th) {
  let best = null
  for (const g of edges) {
    for (const v of values) {
      const d = v - g
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, guide: v }
    }
  }
  return best
}
// 计算样式里的纯平移矩阵（上一次拖动写入的位移）；含旋转/缩放则返回 null 表示需要保留
function translateFromMatrix(tf) {
  const m = /matrix\(([^)]+)\)/.exec(tf || '')
  if (!m) return null
  const p = m[1].split(',').map((x) => parseFloat(x.trim()))
  if (p.length !== 6) return null
  if (Math.abs(p[0] - 1) > 1e-4 || Math.abs(p[1]) > 1e-4 || Math.abs(p[2]) > 1e-4 || Math.abs(p[3] - 1) > 1e-4) return null
  return { x: p[4] || 0, y: p[5] || 0 }
}
// 参考线与坐标徽章画在独立浮层里（幽灵 holder 自身带位移 transform，放一起会被一起平移）
function updateGuides(d, guideX, guideY) {
  if (!d.guideHolder) return
  const cb = cbOrigin()
  if (!cb) return
  d.guideX.style.cssText = guideX === null || guideX === undefined
    ? 'display:none'
    : `position:absolute;left:${guideX}px;top:${cb.top}px;width:1px;height:${cb.bottom - cb.top}px;background:rgba(245,166,35,.9)`
  d.guideY.style.cssText = guideY === null || guideY === undefined
    ? 'display:none'
    : `position:absolute;left:${cb.left}px;top:${guideY}px;width:${cb.right - cb.left}px;height:1px;background:rgba(245,166,35,.9)`
  const k = K()
  d.badge.textContent = `X ${round1((d.x - cb.left) / k)}  Y ${round1((d.y - cb.top) / k)} ｜ ${round1(d.rect.width / k)}×${round1(d.rect.height / k)}`
  d.badge.style.left = d.x + d.rect.width / 2 + 'px'
  d.badge.style.top = Math.max(cb.top, d.y - 22) + 'px'
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
  drag.targets = collectSnapTargets(el)
  captureMoveBase(el, drag.vid)

  // 幽灵挂在 body 层 fixed 容器中：祖先的 zoom / transform 都不会干扰它
  const holder = makeBodyLayer(2147483000)
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
  // 计算样式里带着上一次拖动写入的纯平移矩阵，而 drag.rect 取的是「已含该位移」的视觉矩形，
  // 不清掉会再叠加一次 → 二次拖动起手必跳。非平移变换（旋转/缩放）保留。
  if (translateFromMatrix(getComputedStyle(el).transform)) ghost.style.transform = 'none'
  holder.appendChild(ghost)
  drag.holder = holder

  // 参考线 / 坐标徽章放到不带位移的独立浮层
  drag.guideHolder = makeBodyLayer(2147483002)
  drag.guideX = document.createElement('div')
  drag.guideY = document.createElement('div')
  drag.badge = makeBadge()
  drag.guideHolder.append(drag.guideX, drag.guideY, drag.badge)

  el.style.visibility = 'hidden'
  setHover(null)
  selectedVid.value = drag.vid
  readSelVals()
  wrapRef.value?.classList.add('ve-dragging')
  wrapRef.value?.focus({ preventScroll: true })
  updateGuides(drag, null, null)
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

  // 吸附：元素的起/中/终点对上参考值取最近（按住 Alt 临时关闭；触屏阈值放宽，否则难以精确落位）
  let guideX = null
  let guideY = null
  const th = e.pointerType === 'touch' ? 10 : 6
  if (!e.altKey && drag.targets) {
    const gx = snapAxis([drag.x, drag.x + drag.rect.width / 2, drag.x + drag.rect.width], drag.targets.xs, th)
    if (gx) { drag.x += gx.d; guideX = gx.guide }
    const gy = snapAxis([drag.y, drag.y + drag.rect.height / 2, drag.y + drag.rect.height], drag.targets.ys, th)
    if (gy) { drag.y += gy.d; guideY = gy.guide }
  }

  // 纯屏幕像素位移：transform 只作用于 body 层容器，零换算、必然跟手
  drag.holder.style.transform = `translate(${drag.x - drag.rect.left}px, ${drag.y - drag.rect.top}px)`
  updateGuides(drag, guideX, guideY)
}
// 解析元素已存在的 translate 位移（多次拖动累计），仅支持 px
function parseTranslate(style) {
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style || '')
  return m ? { x: parseFloat(m[1]) || 0, y: parseFloat(m[2]) || 0 } : { x: 0, y: 0 }
}
function commitDrag(d) {
  const tel = docEl(d.vid)
  if (!tel) return
  pushHistory()
  // 幽灵屏幕位移 → 设计像素位移，按元素实际定位模式写入（flow：translate 累计 / abs：left·top）
  writeMove(tel, (d.x - d.rect.left) / K(), (d.y - d.rect.top) / K())
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
  d.holder?.remove()
  d.guideHolder?.remove()
  commitDrag(d)
  // commitDrag → emitHtml 会整体重建卡片 DOM，原元素的 visibility 随旧节点一并销毁
}
function cancelDrag() {
  if (!drag) return
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointercancel', onDragUp)
  drag.holder?.remove()
  drag.guideHolder?.remove()
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

// ---- 图片元素：地址编辑（与文字输入一致：input 改运行时预览，回车/失焦提交落 doc 层） ----
const barImgVal = ref('')
const selIsImg = computed(() => {
  if (!selectedVid.value) return false
  const el = docEl(selectedVid.value)
  return !!el && el.tagName === 'IMG'
})
function refreshBarImg() {
  const dEl = selectedVid.value ? docEl(selectedVid.value) : null
  barImgVal.value = dEl && dEl.tagName === 'IMG' ? (dEl.getAttribute('src') || '') : ''
}
function applyBarImg(v) {
  barImgVal.value = v
  const el = selRuntime()
  if (el && el.tagName === 'IMG') el.src = v
}
function commitBarImg() {
  const dEl = selectedVid.value ? docEl(selectedVid.value) : null
  if (!dEl || dEl.tagName !== 'IMG') return
  const v = barImgVal.value.trim()
  if (v === (dEl.getAttribute('src') || '')) return
  pushHistory()
  dEl.setAttribute('src', v)
  emitHtml()
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
  refreshBarImg()
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
  // 清除拖动写入的位移/层级/冻结尺寸与为保证尺寸生效的 flex 覆盖，让元素完全回到原始文档流布局
  ;['position', 'left', 'top', 'right', 'bottom', 'z-index', 'width', 'height', 'transform', 'flex', 'align-self', 'display'].forEach((p) => rawSet(dEl, p, null))
  emitHtml()
}
function deleteElement() {
  const dEl = docEl(selectedVid.value)
  if (!dEl || selIsSurface.value) return
  pushHistory()
  dEl.remove()
  selectedVid.value = ''
  emitHtml()
  // 删掉了弹窗层本身时退回卡片层，避免停在空弹窗层视图
  if (designLayer.value === 'pop' && !docBox()?.querySelector?.('.hc-pop')) designLayer.value = 'card'
}
function openIconFromBar() {
  const el = selRuntime()
  if (el) openIcon(el)
}

// ================= 撤销 / 重做 / 回写 =================
// emit('html') 会让 CodeCard 用 v-html 整体重建卡片 DOM（卡内 JS 重新执行、动画重启），
// 所以指针交互期间绝不 emit；高频的键盘微调走 trailing 防抖，关键时机再 flushEmit 落地。
const undoStack = ref([])
const redoStack = ref([])
let emitTimer = 0
let emitDirty = false
function emitHtml() {
  clearTimeout(emitTimer)
  emitTimer = 0
  emitDirty = false
  nudgePending = false
  nudgeX = 0
  nudgeY = 0
  const s = serialize()
  lastHtml = s
  emit('html', s)
}
// 只改模板文档、推迟回写：doc 变更不重建 DOM，画面反馈靠运行时元素即时写入
function scheduleEmit(delay = 220) {
  emitDirty = true
  clearTimeout(emitTimer)
  emitTimer = setTimeout(() => {
    emitTimer = 0
    emitDirty = false
    nudgePending = false
    const s = serialize()
    lastHtml = s
    emit('html', s)
  }, delay)
}
function flushEmit() {
  if (!emitDirty) { nudgePending = false; return }
  clearTimeout(emitTimer)
  emitTimer = 0
  emitDirty = false
  nudgePending = false
  const s = serialize()
  lastHtml = s
  emit('html', s)
}
function pushHistory() {
  flushEmit() // 先落地未回写的改动，否则压栈的 html 与当前状态不一致
  undoStack.value.push(lastHtml)
  if (undoStack.value.length > 60) undoStack.value.shift()
  redoStack.value = []
}
function undo() {
  flushEmit()
  if (!undoStack.value.length) return
  redoStack.value.push(lastHtml)
  const s = undoStack.value.pop()
  lastHtml = s
  emit('html', s)
}
function redo() {
  flushEmit()
  if (!redoStack.value.length) return
  undoStack.value.push(lastHtml)
  const s = redoStack.value.pop()
  lastHtml = s
  emit('html', s)
}

// ================= 方向键微调 =================
// 一次连续微调 = 一条历史；doc 与运行时元素都实时写，只有回写走防抖。
let nudgePending = false
let nudgeX = 0
let nudgeY = 0
function nudge(dx, dy) {
  const vid = selectedVid.value
  const rt = rtEl(vid)
  const dEl = docEl(vid)
  if (!rt || !dEl || selIsSurface.value) return
  if (!nudgePending) {
    flushEmit()
    pushHistory()
    nudgePending = true
    nudgeX = 0
    nudgeY = 0
    captureMoveBase(rt, vid)
  }
  nudgeX += dx
  nudgeY += dy
  writeMove(dEl, nudgeX, nudgeY)
  if (moveBase?.mode === 'abs') {
    rt.style.left = round2(moveBase.left + nudgeX) + 'px'
    rt.style.top = round2(moveBase.top + nudgeY) + 'px'
  } else {
    rt.style.transform = `translate(${round1((moveBase?.tx || 0) + nudgeX)}px, ${round1((moveBase?.ty || 0) + nudgeY)}px)`
  }
  scheduleEmit()
  syncOverlay()
}

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase()
  const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable
  if (e.key === 'Escape') {
    if (textPop.open || iconPop.open) { e.stopPropagation(); closePopovers(); return }
    if (drag) { e.stopPropagation(); cancelDrag(); return }
    if (selectedVid.value) { e.stopPropagation(); selectedVid.value = ''; markSelected(); syncOverlay(); return }
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
    return
  }
  const step = e.shiftKey ? 10 : 1
  const ARROWS = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  const a = ARROWS[e.key]
  if (a && selectedVid.value && !selIsSurface.value) {
    e.preventDefault()
    e.stopPropagation()
    nudge(a[0], a[1])
  }
}

// 使用帮助默认隐藏（不再每次自动弹出）；用户点 ? 可随时打开
const showHint = ref(false)

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
// ================= 元素内联样式（CSS）编辑 =================
// 读取选中元素的 style 属性文本（无则空串）
function getElementCss() {
  const tel = docEl(selectedVid.value)
  return tel ? (tel.getAttribute('style') || '') : ''
}
// 应用 CSS 文本到选中元素的内联 style。css 为 "k:v; k:v" 形式；非法规则忽略。返回错误信息或空串
function applyElementCss(css) {
  const tel = docEl(selectedVid.value)
  if (!tel) return '未选中可编辑的元素'
  pushHistory()
  const s = String(css || '').trim()
  if (!s) { tel.removeAttribute('style'); emitHtml(); return '' }
  // 用临时元素解析 style 文本，合法化后写回（浏览器自动丢弃非法声明）
  const tmp = document.createElement('div')
  tmp.setAttribute('style', s)
  tel.setAttribute('style', tmp.getAttribute('style') || '')
  emitHtml()
  return ''
}
// ================= 组件库：插入新控件 =================
// 插入的控件是「自由摆放」的绝对定位元素（position:absolute + left/top），与历史卡片里
// 靠 transform:translate 位移的文档流元素并存；两种模式由 moveMode() 判定后统一走 writeMove()。
const insertSeq = ref(0)
// 数据上下文：镜像 CodeCard 的 liveData，供数据绑定类控件的 {{token}} 取实际可用键
const widgetData = computed(() => {
  const ids = Array.isArray(props.card.entity_ids) && props.card.entity_ids.length
    ? props.card.entity_ids
    : (props.card.entity_id ? [props.card.entity_id] : [])
  const ents = ids.map((id) => entityStates[id]).filter(Boolean)
  const d = computeData(props.card.type, {
    all: all.value,
    hasData: hasData.value,
    entity: ents[0] || null,
    entities: ents,
    entityId: props.card.entity_id,
    now: new Date(),
    card: props.card,
  })
  if (props.card.icon) d.glyph = props.card.icon
  return d || {}
})
// 屏幕坐标 → 设计像素落点（相对绝对定位包含块），并夹在卡片范围内
function designPoint(clientX, clientY, w, h) {
  const cb = cbOrigin()
  const k = K()
  const maxX = Math.max(0, effW.value * baseCell - w)
  const maxY = Math.max(0, effH.value * baseCell - h)
  if (!cb) return { x: maxX / 2, y: maxY / 2 }
  return {
    x: Math.max(0, Math.min((clientX - cb.left) / k, maxX)),
    y: Math.max(0, Math.min((clientY - cb.top) / k, maxY)),
  }
}
// ---- 添加模型弹层（顶部工具条 add_box 按钮）：点按插入卡片中央，可连续添加 ----
const addPop = ref(false)
// ---- 卡片层 / 弹窗层设计切换：弹窗层（.hc-pop）运行时默认隐藏，切层后由 CSS 强制显示以编辑内容 ----
const designLayer = ref('card')
function toggleDesignLayer() {
  designLayer.value = designLayer.value === 'pop' ? 'card' : 'pop'
  selectedVid.value = '' // 切层清空选中，避免误编辑另一层的隐藏模型
}
const addPopPos = reactive({ left: 8, top: 40 })
const addPopStyle = computed(() => ({ left: addPopPos.left + 'px', top: addPopPos.top + 'px' }))
function defsOf(group) { return WIDGET_DEFS.filter((w) => w.group === group) }
function toggleAddPop(e) {
  addPop.value = !addPop.value
  if (addPop.value) {
    const r = e?.currentTarget?.getBoundingClientRect?.()
    if (r) {
      addPopPos.left = Math.max(4, Math.min(r.left, window.innerWidth - 260))
      addPopPos.top = r.bottom + 6
    }
  }
}
function insertFromPop(def) {
  insertWidget(def.key, null) // 弹层保持打开，便于连续添加
}

// 插入控件；at 为空时落到卡片中央（触摸端点按的主路径），连续插入按 8px 级联错开
function insertWidget(key, at) {
  if (!hasTemplate.value || !docBox().firstElementChild) return 'no-template'
  const def = widgetDef(key)
  if (!def) return 'unknown-widget'
  let node
  try {
    node = new DOMParser().parseFromString(widgetHtml(def, widgetData.value), 'text/html').body.firstElementChild
  } catch {
    node = null
  }
  if (!node) return 'parse-failed'
  let p
  if (at && at.clientX != null) {
    p = designPoint(at.clientX, at.clientY, def.w, def.h)
  } else {
    const off = (insertSeq.value % 6) * 8
    insertSeq.value++
    p = {
      x: Math.max(0, (effW.value * baseCell - def.w) / 2 + off),
      y: Math.max(0, (effH.value * baseCell - def.h) / 2 + off),
    }
  }
  const surface = docBox().firstElementChild
  let host = surface
  // 弹窗层设计模式下，普通模型插入到弹窗内容容器里（弹窗层/背景层除外）
  if (designLayer.value === 'pop' && !def.bg && !def.pop) {
    host = surface.querySelector('.hc-pop .hc-pop-inner') || surface.querySelector('.hc-pop') || surface
  }
  node.setAttribute('data-vid', newVid())
  rawSet(node, 'position', 'absolute')
  // 背景层模型：铺满整卡、置于最底层（DOM 最前 + z-index 0）
  if (def.bg) {
    rawSet(node, 'left', '0')
    rawSet(node, 'top', '0')
    rawSet(node, 'width', '100%')
    rawSet(node, 'height', '100%')
    rawSet(node, 'z-index', '0')
    pushHistory()
    host.prepend(node)
    selectedVid.value = node.getAttribute('data-vid')
    emitHtml()
    return ''
  }
  // 弹窗层模型：铺满整卡（自身 inset:0 已铺满）、置于最上层（DOM 最后），插入后直接切到弹窗层继续设计
  if (def.pop) {
    pushHistory()
    surface.append(node)
    selectedVid.value = node.getAttribute('data-vid')
    emitHtml()
    designLayer.value = 'pop'
    return ''
  }
  // 插入宿主不是卡片根时（弹窗层内），落点坐标扣除宿主相对卡片包含块的偏移
  let ox = 0
  let oy = 0
  if (host !== surface) {
    const cb = cbOrigin()
    const k = K()
    if (cb) {
      const r = host.getBoundingClientRect()
      ox = (r.left - cb.left) / k
      oy = (r.top - cb.top) / k
    }
  }
  rawSet(node, 'left', round2(Math.max(0, p.x - ox)) + 'px')
  rawSet(node, 'top', round2(Math.max(0, p.y - oy)) + 'px')
  rawSet(node, 'width', def.w + 'px')
  rawSet(node, 'height', def.h + 'px')
  // 容器里已有内联 z-index（历史拖拽会写 6）时取最大值 +1，确保新控件落在最上层
  let maxZ = 0
  ;[...host.children].forEach((c) => {
    const z = parseInt(c.style?.zIndex || '')
    if (Number.isFinite(z)) maxZ = Math.max(maxZ, z)
  })
  if (maxZ) rawSet(node, 'z-index', String(maxZ + 1))
  pushHistory()
  host.appendChild(node)
  selectedVid.value = node.getAttribute('data-vid')
  emitHtml()
  return ''
}
// 供桌面端「从组件库拖入」绘制预览框：是否落在卡内 + 预览框屏幕矩形
function widgetDropRect(key, clientX, clientY) {
  const def = widgetDef(key)
  const cb = cbOrigin()
  if (!def || !cb || !hasTemplate.value) return { inside: false }
  const k = K()
  const inside = clientX >= cb.left && clientX <= cb.right && clientY >= cb.top && clientY <= cb.bottom
  // 背景层/弹窗层预览框 = 整卡矩形
  if (def.bg || def.pop) {
    return { inside, rect: { left: cb.left, top: cb.top, width: effW.value * baseCell * k, height: effH.value * baseCell * k } }
  }
  const p = designPoint(clientX, clientY, def.w, def.h)
  return {
    inside,
    rect: { left: cb.left + p.x * k, top: cb.top + p.y * k, width: def.w * k, height: def.h * k },
  }
}

// ================= 缩放句柄 =================
const MIN_SIZE = 6
const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const selRectScreen = reactive({ on: false, left: 0, top: 0, width: 0, height: 0 })
const handlesOn = computed(() => selRectScreen.on)
const hzLayerStyle = computed(() => ({
  left: selRectScreen.left + 'px',
  top: selRectScreen.top + 'px',
  width: selRectScreen.width + 'px',
  height: selRectScreen.height + 'px',
}))
let resize = null
// 选中态变化 / 卡片重渲染 / 画布尺寸变化后重新定位句柄
function syncOverlay() {
  const rt = rtEl(selectedVid.value)
  const on = !!rt && !selIsSurface.value && hasTemplate.value && !drag && !resize && !textPop.open && !iconPop.open
  selRectScreen.on = on
  if (!on) return
  const r = rt.getBoundingClientRect()
  selRectScreen.left = r.left
  selRectScreen.top = r.top
  selRectScreen.width = r.width
  selRectScreen.height = r.height
}
// 句柄位置随选中态 / 缩放 / 卡片尺寸变化刷新
watch([selectedVid, () => props.scale, () => props.cellSize, () => props.card.w, () => props.card.h], () => nextTick(syncOverlay))
// 面板/图层树选中：按 vid 直接从运行时 DOM 选（不依赖画布指针事件）
function selectVid(vid) {
  flushEmit()
  const el = rtEl(vid)
  if (!el) return false
  selectedVid.value = vid
  closePopovers()
  markSelected()
  readSelVals()
  syncOverlay()
  wrapRef.value?.focus({ preventScroll: true })
  return true
}
function onHandleDown(e, dir) {
  const vid = selectedVid.value
  const rt = rtEl(vid)
  const dEl = docEl(vid)
  if (!e || !rt || !dEl || selIsSurface.value) return
  e.preventDefault()
  e.stopPropagation()
  const cs = getComputedStyle(rt)
  const r = rt.getBoundingClientRect()
  captureMoveBase(rt, vid)
  resize = {
    vid, dEl, dir, cs,
    sx: e.clientX,
    sy: e.clientY,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    localW: parseFloat(cs.width) || r.width / K(),
    localH: parseFloat(cs.height) || r.height / K(),
    w: 0, h: 0, mx: 0, my: 0,
  }
  resize.w = resize.localW
  resize.h = resize.localH
  // 尺寸框 / 尺寸徽章用 body 层浮层（不重建 DOM，只拖拽预览）
  resize.layer = makeBodyLayer(2147483001)
  resize.box = document.createElement('div')
  resize.badge = makeBadge()
  resize.layer.append(resize.box, resize.badge)
  drawResizeBox()
  selRectScreen.on = false
  wrapRef.value?.classList.add('ve-dragging')
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeUp)
  window.addEventListener('pointercancel', onResizeUp)
}
function drawResizeBox() {
  const d = resize
  if (!d) return
  const k = K()
  const left = d.rect.left + d.mx * k
  const top = d.rect.top + d.my * k
  const w = Math.max(MIN_SIZE, d.w) * k
  const h = Math.max(MIN_SIZE, d.h) * k
  d.box.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;border:1.5px dashed rgba(245,166,35,.95);border-radius:4px;box-sizing:border-box`
  d.badge.textContent = `${round2(d.w)} × ${round2(d.h)}`
  d.badge.style.left = left + w / 2 + 'px'
  d.badge.style.top = Math.max(0, top - 22) + 'px'
}
function onResizeMove(e) {
  const d = resize
  if (!d) return
  const k = K()
  const dLX = (e.clientX - d.sx) / k
  const dLY = (e.clientY - d.sy) / k
  let w = d.localW
  let h = d.localH
  if (d.dir.includes('e')) w = d.localW + dLX
  if (d.dir.includes('w')) w = d.localW - dLX
  if (d.dir.includes('s')) h = d.localH + dLY
  if (d.dir.includes('n')) h = d.localH - dLY
  w = Math.max(MIN_SIZE, w)
  h = Math.max(MIN_SIZE, h)
  // Shift + 角柄：等比缩放（以宽度为基准）
  if (e.shiftKey && d.dir.length === 2 && d.localW > 0) h = Math.max(MIN_SIZE, w * (d.localH / d.localW))
  d.w = w
  d.h = h
  // W/N 边：对边固定 → 同时位移（复用位移抽象，flow / abs 两种元素都对）
  d.mx = d.dir.includes('w') ? -(w - d.localW) : 0
  d.my = d.dir.includes('n') ? -(h - d.localH) : 0
  drawResizeBox()
}
// 写入宽高；flex 子项 / inline 元素 / stretch 交叉轴会让固定尺寸失效，先解除这些约束
function applySize(dEl, w, h, cs) {
  if (!dEl) return
  if ((parseFloat(cs?.flexGrow) || 0) > 0 || (cs?.flexBasis && cs.flexBasis !== 'auto' && cs.flexBasis !== '0%')) rawSet(dEl, 'flex', '0 0 auto')
  if (cs?.alignSelf === 'stretch') rawSet(dEl, 'align-self', 'flex-start')
  if (cs?.display === 'inline') rawSet(dEl, 'display', 'inline-block')
  rawSet(dEl, 'width', round2(w) + 'px')
  rawSet(dEl, 'height', round2(h) + 'px')
}
function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointercancel', onResizeUp)
  const d = resize
  resize = null
  wrapRef.value?.classList.remove('ve-dragging')
  if (!d) return
  d.layer?.remove()
  pushHistory()
  applySize(d.dEl, d.w, d.h, d.cs)
  if (d.mx || d.my) writeMove(d.dEl, d.mx, d.my)
  emitHtml()
  syncOverlay()
}

// ================= 图层（元素树 / 层级顺序） =================
function layerName(el) {
  const t = (el.textContent || '').trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, 14) : descriptor(el)
}
// 从模板文档读元素树：doc 与 draft.html 天然同步，父级面板据此渲染缩进列表
function getLayerTree() {
  const host = docBox().firstElementChild
  if (!host) return []
  const out = []
  const walk = (el, depth) => {
    if (out.length >= 160) return
    const vid = el.getAttribute('data-vid')
    if (vid) out.push({ vid, depth, tag: el.tagName.toLowerCase(), name: layerName(el), isSurface: el === host, isPop: el.classList.contains('hc-pop') })
    ;[...el.children].forEach((c) => walk(c, depth + 1))
  }
  walk(host, 0)
  return out
}
// 层级以「DOM 顺序」为唯一权威：置顶/置底/上移/下移都落成节点顺序。
// 必须先清掉同父所有内联 z-index——拖拽会留下 z-index:6，不清则永远压住 DOM 顺序，
// 用户点「上移/置底」会看起来完全没反应。
function layerOp(vid, op) {
  const el = docEl(vid)
  if (!el || !el.parentElement) return 'no-el'
  if (el === docBox().firstElementChild) return 'surface'
  const parent = el.parentElement
  const sibs = [...parent.children].filter((c) => c.hasAttribute('data-vid'))
  if (sibs.length < 2) return 'single'
  const i = sibs.indexOf(el)
  const target = op === 'front' ? sibs[sibs.length - 1]
    : op === 'back' ? sibs[0]
      : op === 'up' ? sibs[i - 1]
        : op === 'down' ? sibs[i + 1] : null
  if (!target || target === el) return 'edge'
  pushHistory()
  sibs.forEach((c) => rawSet(c, 'z-index', null))
  if (op === 'front') parent.appendChild(el)
  else if (op === 'back') parent.insertBefore(el, sibs[0])
  else if (op === 'up') parent.insertBefore(el, sibs[i - 1])
  else parent.insertBefore(el, sibs[i + 1])
  emitHtml()
  return ''
}
// 图层面板拖行重排：仅支持同一父容器内排序（跨容器会改变布局语义，明确拒绝）
function reorderLayer(vid, targetVid, place) {
  const el = docEl(vid)
  const tgt = docEl(targetVid)
  if (!el || !tgt || el === tgt) return 'no-el'
  if (el === docBox().firstElementChild) return 'surface'
  const parent = el.parentElement
  if (!parent || tgt.parentElement !== parent) return 'cross-parent'
  pushHistory()
  ;[...parent.children].forEach((c) => rawSet(c, 'z-index', null))
  parent.insertBefore(el, place === 'after' ? tgt.nextSibling : tgt)
  emitHtml()
  return ''
}

defineExpose({
  getElementHtml,
  getSelectedDescriptor,
  applyElementHtml,
  getElementCss,
  applyElementCss,
  insertWidget,
  widgetDropRect,
  getLayerTree,
  layerOp,
  reorderLayer,
  selectVid,
  deleteElement,
})

onBeforeUnmount(() => {
  flushEmit()
  clearTimeout(emitTimer)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointercancel', onDragUp)
  window.removeEventListener('pointerup', onDragUp)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointercancel', onResizeUp)
  window.removeEventListener('pointerup', onResizeUp)
  window.removeEventListener('resize', syncOverlay)
  drag?.holder?.remove()
  drag?.guideHolder?.remove()
  resize?.layer?.remove()
  drag = null
  resize = null
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
  /* 与真实 .hc-card-holder 一致：不自带背景/圆角/阴影，视觉完全交给卡片壳
     （.hc{overflow:hidden; border-radius}）。否则容器底色会在卡片圆角外透出一圈浅色边 */
  border-radius: 14px;
  display: flex;
  flex-direction: column;
}
.ve-wrap :deep(.hc-code-card) { position: relative; }
.ve-wrap :deep(.hc-code-card [data-vid]) { cursor: move; }

/* 悬停 / 选中 */
.ve-wrap :deep(.ve-hover) {
  outline: 1.5px dashed rgb(var(--c-primary) / 0.85) !important;
  outline-offset: -1px;
}
.ve-wrap :deep(.ve-on) {
  outline: 2px solid rgb(var(--c-primary)) !important;
  outline-offset: -2px;
  box-shadow: inset 0 0 0 1px rgb(var(--c-primary) / 0.35) !important;
}
.ve-tag {
  position: absolute;
  z-index: 8;
  transform: translateY(-100%);
  pointer-events: none;
  font: 600 10px/1 ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-on-primary));
  background: rgb(var(--c-primary));
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
  background: rgb(var(--c-surface) / 0.92);
  border: 1px solid rgb(var(--c-border));
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
  color: rgb(var(--c-muted));
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ve-tbtn:hover:not(:disabled) { background: rgb(var(--c-primary) / 0.14); color: rgb(var(--c-primary)); }
.ve-tbtn.on { background: rgb(var(--c-primary) / 0.18); color: rgb(var(--c-primary)); }

/* 弹窗层设计模式：强制显示弹窗（运行时由 CodeCard 的 .hc-pop 规则隐藏），背板之下透出卡片本体 */
.ve-wrap[data-layer='pop'] :deep(.hc-pop) { display: flex !important; }
.ve-tbtn-del:hover:not(:disabled) { background: rgb(var(--c-error) / 0.16); color: rgb(var(--c-error)); }
.ve-tbtn:disabled { opacity: 0.32; cursor: default; }

/* 添加模型弹层 */
.ve-addpop-mask { position: fixed; inset: 0; z-index: 2147483000; }
.ve-addpop {
  position: fixed;
  width: 252px;
  max-height: 60vh;
  overflow-y: auto;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  padding: 8px 10px 10px;
}
.ve-addpop-gtitle { margin: 6px 0 4px; font-size: 10px; font-weight: 700; color: rgb(var(--c-muted)); letter-spacing: 0.06em; }
.ve-addpop-group:first-child .ve-addpop-gtitle { margin-top: 0; }
.ve-addpop-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.ve-addpop-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 2px 6px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-on-surface) / 0.02);
  color: rgb(var(--c-on-surface));
  cursor: pointer;
}
.ve-addpop-item .material-symbols-outlined { font-size: 18px; color: rgb(var(--c-muted)); }
.ve-addpop-item em { font-style: normal; font-size: 10px; white-space: nowrap; }
.ve-addpop-item:hover { border-color: rgb(var(--c-primary) / 0.45); background: rgb(var(--c-primary) / 0.1); }
.ve-addpop-item:hover .material-symbols-outlined { color: rgb(var(--c-primary)); }
.ve-tbtn .material-symbols-outlined { font-size: 17px; }
.ve-tools-divider { width: 1px; height: 18px; background: rgb(var(--c-border)); margin: 0 2px; }

/* 帮助卡片 */
.ve-hint-card {
  position: absolute;
  z-index: 9;
  top: 54px;
  left: 10px;
  width: 308px;
  max-width: calc(100% - 20px);
  padding: 13px 14px 11px;
  background: rgb(var(--c-surface) / 0.96);
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
  color: rgb(var(--c-on-surface));
  font-size: 12px;
  line-height: 1.5;
}
.ve-hint-card p { margin: 0 0 8px; color: rgb(var(--c-on-background)); font-size: 12.5px; }
.ve-hint-card ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ve-hint-card li { display: flex; align-items: flex-start; gap: 7px; }
.ve-hint-card .material-symbols-outlined { font-size: 14px; color: rgb(var(--c-primary)); margin-top: 1px; flex: none; }
.ve-hint-close {
  margin-top: 10px;
  width: 100%;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-primary) / 0.4);
  background: rgb(var(--c-primary) / 0.14);
  color: rgb(var(--c-primary));
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
  background: rgb(var(--c-background) / 0.82);
  backdrop-filter: blur(2px);
  border-radius: 12px;
  text-align: center;
  padding: 20px;
}
.ve-ne-icon { font-size: 34px; color: rgb(var(--c-muted)); }

/* ============ 缩放句柄（挂 body 层） ============ */
.ve-hz-layer {
  position: fixed;
  pointer-events: none;
  z-index: 2147483001;
}
.ve-hz {
  position: absolute;
  width: 11px;
  height: 11px;
  margin: -5.5px 0 0 -5.5px;
  border-radius: 2px;
  background: rgb(var(--c-primary));
  border: 1.5px solid rgb(var(--c-background));
  box-sizing: border-box;
  pointer-events: auto;
  touch-action: none;
}
.hz-nw { left: 0; top: 0; cursor: nwse-resize; }
.hz-n { left: 50%; top: 0; cursor: ns-resize; }
.hz-ne { left: 100%; top: 0; cursor: nesw-resize; }
.hz-e { left: 100%; top: 50%; cursor: ew-resize; }
.hz-se { left: 100%; top: 100%; cursor: nwse-resize; }
.hz-s { left: 50%; top: 100%; cursor: ns-resize; }
.hz-sw { left: 0; top: 100%; cursor: nesw-resize; }
.hz-w { left: 0; top: 50%; cursor: ew-resize; }
/* 触屏放大的命中区 */
@media (pointer: coarse) {
  .ve-hz { width: 16px; height: 16px; margin: -8px 0 0 -8px; }
}
.ve-needentity p { margin: 0; font-size: 12.5px; color: rgb(var(--c-muted)); max-width: 260px; }
.ve-ne-btn {
  margin-top: 4px;
  height: 34px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  border: 1px solid rgb(var(--c-primary) / 0.45);
  background: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
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
  color: rgb(var(--c-primary));
  padding-bottom: 8px;
  border-bottom: 1px solid rgb(var(--c-border));
}
.ve-bar-title .material-symbols-outlined { font-size: 15px; }
/* ---- 数据来源实体区块 ---- */
.ve-src {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 10px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 9px;
  background: rgb(var(--c-surface));
}
.ve-src-head { display: flex; align-items: center; gap: 6px; }
.ve-src-head > .material-symbols-outlined { font-size: 14px; color: rgb(var(--c-info)); flex: none; }
.ve-src-title { font: 700 11px/1 ui-monospace, Menlo, Consolas, monospace; color: rgb(var(--c-on-surface)); }
.ve-src-auto {
  flex: none;
  font: 600 9.5px/1 ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-primary));
  background: rgb(var(--c-primary) / 0.12);
  border: 1px solid rgb(var(--c-primary) / 0.3);
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
  color: rgb(var(--c-info));
  background: rgb(var(--c-info) / 0.12);
  border: 1px solid rgb(var(--c-info) / 0.25);
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
  color: rgb(var(--c-on-background));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ve-src-id {
  flex: none;
  font: 10px/1 ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-muted));
  background: rgb(var(--c-border));
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
  color: rgb(var(--c-muted));
}
.ve-src-empty .material-symbols-outlined { font-size: 13px; }
.ve-src-attrs {
  list-style: none;
  margin: 0;
  padding: 6px 0 0;
  border-top: 1px dashed rgb(var(--c-border));
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
  color: rgb(var(--c-muted));
}
.ve-src-a-val {
  font-size: 11px;
  color: rgb(var(--c-on-surface));
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
/* 属性条底部的操作提示（拖动吸附 / 键盘微调 / 句柄缩放） */
.ve-bar-hint {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 2px 0 0;
  color: rgb(var(--c-muted));
  font-size: 11px;
  line-height: 1.5;
}
.ve-bar-hint .material-symbols-outlined { font-size: 14px; color: rgb(var(--c-primary)); flex: none; margin-top: 1px; }
.ve-chip {
  flex: none;
  height: 30px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-border));
  color: rgb(var(--c-on-surface));
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ve-chip:hover { border-color: rgb(var(--c-primary) / 0.5); color: rgb(var(--c-primary)); }
.ve-chip:disabled { opacity: 0.4; cursor: default; }
.ve-chip .material-symbols-outlined { font-size: 15px; }
.ve-chip-accent { border-color: rgb(var(--c-info) / 0.45); color: rgb(var(--c-info)); background: rgb(var(--c-info) / 0.1); }
.ve-chip-danger:hover { border-color: rgb(var(--c-error) / 0.6); color: rgb(var(--c-error)); background: rgb(var(--c-error) / 0.1); }
.ve-chip-mini { padding: 0 8px; font-size: 11px; }
.ve-sep { flex: none; width: 1px; height: 20px; background: rgb(var(--c-border)); }
.ve-ctl {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  color: rgb(var(--c-muted));
  cursor: pointer;
}
.ve-ctl-ic { font-size: 16px !important; }
.ve-ctl input[type='color'] {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid rgb(var(--c-border));
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.ve-ctl-range input[type='range'] { width: 74px; accent-color: rgb(var(--c-primary)); cursor: pointer; }
.ve-ctl-range em { font-style: normal; font-size: 10.5px; color: rgb(var(--c-muted)); width: 22px; text-align: right; }
.ve-ctl-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-border));
  color: rgb(var(--c-muted));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ve-ctl-btn.on { border-color: rgb(var(--c-primary) / 0.6); background: rgb(var(--c-primary) / 0.16); color: rgb(var(--c-primary)); }
.ve-bold-b { font-weight: 800; font-size: 13px; font-family: Georgia, serif; }
.ve-seg {
  flex: none;
  display: inline-flex;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  overflow: hidden;
}
.ve-seg button {
  width: 28px;
  height: 28px;
  border: none;
  background: rgb(var(--c-border));
  color: rgb(var(--c-muted));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ve-seg button + button { border-left: 1px solid rgb(var(--c-border)); }
.ve-seg button.on { background: rgb(var(--c-primary) / 0.18); color: rgb(var(--c-primary)); }
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
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-background));
  color: rgb(var(--c-muted));
}
.ve-text-row .material-symbols-outlined { font-size: 15px; flex: none; }
.ve-text-row input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: rgb(var(--c-on-background));
  font-size: 12.5px;
  font-weight: 600;
}
.ve-text-row:focus-within { border-color: rgb(var(--c-primary)); }
.ve-text-hint {
  flex: 0 0 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: -2px 0 0;
  font-size: 10.5px;
  color: rgb(var(--c-muted));
}
.ve-text-hint .material-symbols-outlined { font-size: 13px; color: rgb(var(--c-primary)); }
.ve-text-hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-primary));
  background: rgb(var(--c-primary) / 0.1);
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
  color: rgb(var(--c-muted));
}
.ve-text-lock .material-symbols-outlined { font-size: 13px; color: rgb(var(--c-muted)); }

/* ============ 文字弹层 ============ */
.ve-pop {
  position: absolute;
  z-index: 20;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
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
  color: rgb(var(--c-on-background));
  padding: 2px 4px 4px;
}
.ve-pop-head .material-symbols-outlined { font-size: 14px; color: rgb(var(--c-primary)); }
.ve-pop-head-label { flex: none; }
.ve-pop-head-desc {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--c-info));
  background: rgb(var(--c-info) / 0.12);
  padding: 1px 6px;
  border-radius: 4px;
}
.ve-text-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-background));
  padding: 6px 9px;
  outline: none;
  font-family: 'Source Sans 3', system-ui, sans-serif;
  font-weight: 600;
}
.ve-text-input:focus { border-color: rgb(var(--c-primary)); }
.ve-pop-foot { display: flex; align-items: center; gap: 8px; }
.ve-token-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: rgb(var(--c-muted));
}
.ve-token-hint .material-symbols-outlined { font-size: 13px; color: rgb(var(--c-primary)); }
.ve-token-hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-primary));
  background: rgb(var(--c-primary) / 0.1);
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
.ve-btn-ghost { background: transparent; border: 1px solid rgb(var(--c-border)); color: rgb(var(--c-muted)); }
.ve-btn-ghost:hover { border-color: rgb(var(--c-border)); color: rgb(var(--c-on-background)); }
.ve-btn-primary { background: rgb(var(--c-primary)); border: 1px solid rgb(var(--c-primary)); color: rgb(var(--c-on-primary)); }
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
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
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
  border-bottom: 1px solid rgb(var(--c-border));
}
.ve-icon-title { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; color: rgb(var(--c-on-background)); flex: none; }
.ve-icon-title .material-symbols-outlined { font-size: 16px; color: rgb(var(--c-primary)); }
.ve-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 9px;
  border-radius: 8px;
  background: rgb(var(--c-background));
  border: 1px solid rgb(var(--c-border));
}
.ve-search .material-symbols-outlined { font-size: 15px; color: rgb(var(--c-muted)); }
.ve-search-input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-size: 12.5px; color: rgb(var(--c-on-surface)); }
.ve-icon-close { width: 28px; height: 28px; border: none; border-radius: 7px; background: transparent; color: rgb(var(--c-muted)); cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
.ve-icon-close:hover { background: rgb(var(--c-on-surface) / 0.07); color: rgb(var(--c-on-background)); }
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
  border: 1px solid rgb(var(--c-border));
  border-radius: 9px;
  background: rgb(var(--c-surface));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s, background 0.12s, transform 0.08s;
}
.ve-icon-cell:hover { border-color: rgb(var(--c-primary) / 0.6); background: rgb(var(--c-primary) / 0.08); transform: translateY(-1px); }
.ve-icon-cell.on { border-color: rgb(var(--c-primary)); background: rgb(var(--c-primary) / 0.16); }
.ve-ic-swatch {
  width: 20px;
  height: 20px;
  background: rgb(var(--c-on-surface));
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.ve-icon-empty { grid-column: 1 / -1; text-align: center; color: rgb(var(--c-muted)); font-size: 12px; padding: 20px 0; }
.ve-icon-foot {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgb(var(--c-border));
}
.ve-custom-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
  font-size: 12px;
  outline: none;
}
.ve-custom-input:focus { border-color: rgb(var(--c-primary)); }
</style>

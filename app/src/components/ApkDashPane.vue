<template>
  <!-- Web 端双栏编辑：右侧手机 App 仪表盘面板。
       独立加载/保存 dashboard_apk_<deviceId>，接收左侧电脑仪表盘拖入的卡片（复制，新 uid）。 -->
  <section
    class="hc-apk-pane flex flex-col rounded-2xl border bg-surface-alt/40 overflow-hidden transition-shadow"
    :class="dragOver ? 'border-primary ring-2 ring-primary/40 shadow-xl shadow-primary/10' : 'border-border'"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- 面板头部：标题 + 设备选择（紧随标题之后）+ 保存/撤销 -->
    <header class="shrink-0 px-3.5 pt-3 pb-3 border-b border-border/70">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-xl shrink-0" aria-hidden="true">smartphone</span>
        <h2 class="text-sm font-semibold text-on-surface whitespace-nowrap">手机 App 仪表盘</h2>
        <select
          v-if="devices.length"
          v-model="deviceId"
          class="min-w-0 flex-1 h-9 px-2 rounded-lg bg-surface border border-border text-xs text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
          title="选择要编辑的手机设备"
        >
          <option v-for="d in devices" :key="d.device_id" :value="d.device_id">{{ d.name }}</option>
        </select>
        <!-- 操作按钮区固定宽度（v-show 占位）：dirty 出现/消失时下拉框宽度不抖动 -->
        <div class="shrink-0 w-24 flex items-center justify-end gap-2">
          <button
            v-show="dirty"
            @click="save"
            class="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold shadow-sm hover:opacity-90 active:scale-95 transition"
            title="保存到选中手机，该机 App 将自动刷新"
          >保存</button>
          <button
            v-show="dirty"
            @click="revert"
            class="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border border-border text-muted hover:text-on-surface active:scale-95 transition"
            title="撤销未保存的修改" aria-label="撤销修改"
          >
            <span class="material-symbols-outlined text-lg">undo</span>
          </button>
        </div>
      </div>
    </header>

    <!-- 无设备空态 -->
    <div v-if="!devices.length" class="px-5 py-10 text-center">
      <span class="material-symbols-outlined text-4xl text-faint" aria-hidden="true">phone_iphone</span>
      <p class="mt-2 text-sm text-muted">暂无手机设备</p>
      <p class="mt-1 text-xs text-faint leading-relaxed">在手机 App 登录本账号后，<br>即可把左侧卡片拖到这里复制到手机</p>
    </div>

    <template v-else>
      <!-- 页签行：切换/新增/删除手机端页面 -->
      <div class="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-border/70 overflow-x-auto hc-apk-tabs">
        <button
          v-for="(p, i) in pages" :key="p.id"
          @click="switchPage(i)"
          class="group shrink-0 flex items-center gap-1 max-w-[9rem] h-8 pl-2.5 pr-1 rounded-full border text-xs transition-colors"
          :class="i === pageIndex ? 'bg-primary/15 border-primary/40 text-primary font-semibold' : 'bg-surface border-border text-muted hover:text-on-surface'"
          :title="p.name"
        >
          <span class="truncate">{{ p.name }}</span>
          <span
            v-if="pages.length > 1"
            @click.stop="removePage(i)"
            class="w-6 h-6 flex items-center justify-center rounded-full text-faint hover:text-error hover:bg-error/10 transition"
            role="button" aria-label="删除该页"
          ><span class="material-symbols-outlined text-sm">close</span></span>
        </button>
        <button
          @click="addPage"
          class="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-primary hover:bg-primary/10 transition"
          title="新增页" aria-label="新增页"
        >
          <span class="material-symbols-outlined text-lg">add</span>
        </button>
        <span class="ml-auto shrink-0 text-[11px] text-faint tabular-nums">{{ cols }} 列</span>
      </div>

      <!-- 手机屏框：内部按真机列数渲染，所见即所得。滚动容器供拖到边缘时自动滚动 -->
      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto hc-apk-scroll p-3">
        <div
          ref="frameEl"
          class="mx-auto rounded-[26px] border border-border bg-background p-2 shadow-[0_0_0_4px_rgba(128,128,128,0.07),0_14px_36px_rgba(0,0,0,0.16)]"
          :style="{ maxWidth: frameMaxWidth + 'px' }"
        >
          <div class="relative rounded-[20px] overflow-hidden" :class="!displayCards.length ? 'min-h-[16rem]' : ''">
            <div ref="gridEl" class="hc-apk-grid" :class="{ 'hc-apk-grid-dragging': !!dragCard }" :style="gridStyle">
              <template v-for="card in displayCards" :key="card.__ghost ? '__drop_ghost__' : card.uid">
                <!-- 跨栏拖放插入占位符：由网格自动排版，位置即松手后的插入位 -->
                <div
                  v-if="card.__ghost"
                  class="hc-apk-drop-slot"
                  :style="holderStyle(card)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">add</span>
                </div>
                <div
                  v-else
                  :id="'apk-card-' + card.uid"
                  class="hc-apk-card"
                  :class="{
                    'hc-apk-card-sel': selectedUid === card.uid,
                    'hc-apk-card-drag': dragCard === card,
                  }"
                  :data-type="card.type"
                  :style="holderStyle(card)"
                  @pointerdown="onPanePointerDown($event, card)"
                  @click.stop="onPaneCardClick(card)"
                >
                  <!-- 编辑面板内禁用卡片内部交互（pointer-events-none），避免调开关误触 -->
                  <div class="hc-apk-zoom" :style="zoomStyle(card)">
                    <CodeCard :card="card" :scope-id="'apk-card-' + card.uid" @device-drawer="(f) => $emit('device-drawer', f)" />
                  </div>
                </div>
              </template>
            </div>

            <!-- 空页引导（无卡片且无拖放进行时；点按提示用左栏手柄复制） -->
            <button
              v-if="!displayCards.length"
              class="absolute inset-0 w-full min-h-[16rem] flex flex-col items-center justify-center gap-1.5 text-muted hover:text-primary hover:bg-primary/5 transition-colors"
              @click="quickCopyHint"
            >
              <span class="material-symbols-outlined text-3xl" aria-hidden="true">download_for_offline</span>
              <span class="text-xs font-medium">把左侧卡片拖到这里</span>
              <span class="text-[11px] text-faint">自动复制一份到手机（原电脑卡片保留）</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 选中卡片操作条：宽度调整 + 排序 + 删除（代码编辑请在左侧电脑端完成后再拖入） -->
      <transition name="hc-apk-bar">
        <div v-if="selectedCard" class="shrink-0 border-t border-border/70 px-2 py-1.5 flex items-center gap-1 bg-surface/60">
          <span class="min-w-0 flex-1 truncate pl-1.5 text-xs text-on-surface font-medium">{{ cardLabel(selectedCard) }}</span>
          <button @click="resizeCard(selectedCard, -1)" :disabled="selectedCard.w <= 1"
            class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/10 active:scale-90 transition disabled:opacity-25"
            title="缩窄" aria-label="缩窄卡片">
            <span class="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <span class="text-[11px] text-muted tabular-nums shrink-0">{{ selectedCard.w }}×{{ Math.min(3, selectedCard.h || 1) }}</span>
          <button @click="resizeCard(selectedCard, 1)" :disabled="selectedCard.w >= cols"
            class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/10 active:scale-90 transition disabled:opacity-25"
            title="加宽" aria-label="加宽卡片">
            <span class="material-symbols-outlined text-lg">chevron_right</span>
          </button>
          <span class="w-px h-6 bg-border mx-0.5"></span>
          <button @click="move(selectedCard, -1)" :disabled="indexOf(selectedCard) === 0"
            class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/10 active:scale-90 transition disabled:opacity-25"
            title="前移" aria-label="前移">
            <span class="material-symbols-outlined text-lg">arrow_back</span>
          </button>
          <button @click="move(selectedCard, 1)" :disabled="indexOf(selectedCard) === cards.length - 1"
            class="w-10 h-10 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/10 active:scale-90 transition disabled:opacity-25"
            title="后移" aria-label="后移">
            <span class="material-symbols-outlined text-lg">arrow_forward</span>
          </button>
          <button @click="remove(selectedCard)"
            class="w-10 h-10 flex items-center justify-center rounded-xl text-error hover:bg-error/10 active:scale-90 transition"
            title="删除" aria-label="删除卡片">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
          <button @click="selectedUid = ''"
            class="w-9 h-10 flex items-center justify-center rounded-xl text-muted hover:text-on-surface active:scale-90 transition"
            title="取消选中" aria-label="取消选中">
            <span class="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </transition>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import CodeCard from '@/components/cards/CodeCard.vue'
import { cardDefaults } from '@/components/cards/defaults'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { useDashGrid } from '@/composables/useDashGrid'
import {
  newCard, newPage, migrateDashboard, serializeDashboard,
  layoutKeyFor, colsKeyFor,
} from '@/utils/dashboard'

// 本账号已注册设备列表（由 HomeView 传入）；切换设备即切换编辑的 dashboard_apk_<deviceId>
const props = defineProps({
  devices: { type: Array, default: () => [] },
  // 左栏手柄 HTML5 拖拽中的源卡快照（dragover 阶段读不到 dataTransfer，用它显示占位符）
  dragPayload: { type: Object, default: null },
})
const emit = defineEmits(['device-drawer', 'toast'])

// 拖拽数据 MIME：左栏卡片 dragstart 写入，本面板 drop 读取（只传白名单字段，克隆后生成新 uid）
const MIME = 'application/x-hc-card'
const CARD_FIELDS = ['w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar', 'title']
const frameMaxWidth = 392

const deviceId = ref('')
const pages = ref([])
const pageIndex = ref(0)
const cols = ref(3)
const loaded = ref(false)
const selectedUid = ref('')
const dragOver = ref(false)
let snapshot = '' // 最近一次加载/保存后的序列化值：dirty 检测与撤销回滚

const cards = computed(() => pages.value[pageIndex.value]?.cards ?? [])
const selectedCard = computed(() => cards.value.find((c) => c.uid === selectedUid.value) || null)
const dirty = computed(() => loaded.value && serializeDashboard(pages.value) !== snapshot)
const deviceName = computed(() => props.devices.find((d) => d.device_id === deviceId.value)?.name || deviceId.value.slice(0, 8))

// ---- 布局加载：回退链 dashboard_apk_<id> → dashboard_apk → dashboard；读取该机真实列数 ----
async function load(force = false) {
  if (!deviceId.value) { pages.value = []; loaded.value = false; return }
  clearDropPreview()
  selectedUid.value = ''
  loaded.value = false
  try {
    const { data } = await getPrefs(force ? { force: true } : undefined)
    const raw = data[layoutKeyFor(deviceId.value)] || data.dashboard_apk || data.dashboard || ''
    let next
    if (raw) {
      const r = migrateDashboard(JSON.parse(raw))
      next = r?.pages?.length ? r.pages : [newPage('首页')]
    } else {
      next = [newPage('首页')] // 该手机尚无独立布局：以空页起步，拖入卡片保存后即独立
    }
    pages.value = next
    pageIndex.value = 0
    const cv = parseInt(data[colsKeyFor(deviceId.value)] || '', 10)
    cols.value = (cv >= 2 && cv <= 8) ? cv : 3
  } catch {
    pages.value = [newPage('首页')]
    pageIndex.value = 0
  }
  loaded.value = true
  snapshot = serializeDashboard(pages.value)
  await nextTick()
  measure()
}

async function save() {
  if (!deviceId.value) return
  const json = serializeDashboard(pages.value)
  try {
    await putPrefs({ [layoutKeyFor(deviceId.value)]: json })
    snapshot = json
    emit('toast', `${deviceName.value} 仪表盘已保存，该机 App 将自动刷新`)
  } catch {
    emit('toast', '保存失败：后端不可达', true)
  }
}

function revert() {
  if (!snapshot) return
  const r = migrateDashboard(JSON.parse(snapshot))
  if (r?.pages?.length) { pages.value = r.pages; pageIndex.value = Math.min(pageIndex.value, r.pages.length - 1) }
  selectedUid.value = ''
}

// ---- 设备切换（未保存修改先确认）----
watch(deviceId, async (v, old) => {
  if (!v || v === old) return
  if (dirty.value && !window.confirm('当前手机布局有未保存的修改，切换设备将丢弃，确定继续？')) {
    deviceId.value = old // 回退下拉显示
    return
  }
  await load(true)
})

// 设备列表到位后默认选第一台；frameEl 此刻才渲染，补绑 RO 并重测
watch(() => props.devices, (list) => {
  if (list.length && !list.some((d) => d.device_id === deviceId.value)) deviceId.value = list[0].device_id
  nextTick(() => { ensureRO(); measure() })
}, { immediate: true })

// ---- 页操作 ----
function switchPage(i) { if (i !== pageIndex.value) { pageIndex.value = i; selectedUid.value = '' } }
function addPage() {
  pages.value.push(newPage(`第 ${pages.value.length + 1} 页`))
  pageIndex.value = pages.value.length - 1
}
function removePage(i) {
  if (pages.value.length <= 1) return
  if (!window.confirm(`确定删除「${pages.value[i].name}」页及其全部卡片吗？`)) return
  pages.value.splice(i, 1)
  if (pageIndex.value >= pages.value.length) pageIndex.value = pages.value.length - 1
  selectedUid.value = ''
}

// ---- 接收左栏卡片：按白名单克隆（新 uid，与电脑端卡片互不影响），宽度钳制到手机列数 ----
function cloneFrom(src) {
  if (!src || !src.type || !cardDefaults[src.type]) return null
  const extra = {}
  for (const k of CARD_FIELDS) if (src[k] !== undefined) extra[k] = src[k]
  const c = newCard(src.type, extra)
  c.w = Math.min(Math.max(1, c.w || 1), cols.value)
  c.h = Math.min(3, Math.max(1, c.h || 1))
  return c
}

// ---- 拖放插入占位符：跨栏 pointer 拖拽与 HTML5 手柄拖拽共用 ----
// ghost 为临时网格项（{__ghost:true,w,h}），displayCards 把它拼在 ghostIndex 处，
// 由 CSS grid 自动排版，松手后在同一索引插入真实克隆卡，所见即所得。
const gridEl = ref(null)
const frameEl = ref(null) // 手机外框：网格可用宽取自它（自带 p-2 内边距，padX:16）
// 网格测量/缩放与电脑端共用 useDashGrid；手机端按真机列数、框宽固定上限 392
const {
  cellSize, measure, zoomStyle, gridStyle, holderStyle, spanSize,
} = useDashGrid({ el: frameEl, cols, padX: 16, minInner: 80 })
const ghostCard = ref(null)
const ghostIndex = ref(0)
const displayCards = computed(() => {
  const arr = cards.value
  const g = ghostCard.value
  if (!g) return arr
  const i = Math.max(0, Math.min(ghostIndex.value, arr.length))
  return [...arr.slice(0, i), g, ...arr.slice(i)]
})
function clearDropPreview() {
  ghostCard.value = null
  dragOver.value = false
  stopEdgeScroll()
}
// 给定指针坐标，返回在当前页 cards（不含占位符）中的插入索引；
// 命中卡片时按指针相对卡片中心的位置决定插前/插后，空白处按行/列就近推断。
function indexAt(x, y, exclude = null) {
  const arr = cards.value
  if (!arr.length || !gridEl.value) return arr.length
  const gridRect = gridEl.value.getBoundingClientRect()
  const rects = []
  for (const c of arr) {
    if (c === exclude) continue
    const el = document.getElementById('apk-card-' + c.uid)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0) rects.push({ c, r })
  }
  if (!rects.length) return 0
  // 1) 命中某张卡片：越过中心即插到其后
  for (let i = 0; i < rects.length; i++) {
    const { c, r } = rects[i]
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const before = (y < r.top + r.height / 2)
        || (Math.abs(y - (r.top + r.height / 2)) < 8 && x < r.left + r.width / 2)
      return before ? arr.indexOf(c) : arr.indexOf(c) + 1
    }
  }
  // 2) 网格内空白：同行指针右侧最近的卡之前 → 下一行首卡之前 → 末尾
  if (x >= gridRect.left && x <= gridRect.right && y >= gridRect.top && y <= gridRect.bottom) {
    const sameRow = rects.filter(o => o.r.top <= y && y <= o.r.bottom)
    if (sameRow.length) {
      const rowTop = Math.min(...sameRow.map(o => o.r.top))
      const right = sameRow.filter(o => Math.abs(o.r.top - rowTop) < 4 && o.r.left >= x)
        .sort((a, b) => a.r.left - b.r.left)
      if (right.length) return arr.indexOf(right[0].c)
    }
    const below = rects.filter(o => o.r.top > y)
    if (below.length) {
      const nextTop = Math.min(...below.map(o => o.r.top))
      const first = below.filter(o => Math.abs(o.r.top - nextTop) < 4)
        .sort((a, b) => a.r.left - b.r.left)[0]
      if (first) return arr.indexOf(first.c)
    }
  }
  return arr.length
}
// 左栏 pointer 跨栏拖拽：实时更新占位符位置（span 按手机列数钳制）
function previewDrop(x, y, src) {
  if (!deviceId.value || !src?.type) return
  const w = Math.min(Math.max(1, src.w || 1), cols.value)
  const h = Math.min(3, Math.max(1, src.h || 1))
  if (!ghostCard.value) ghostCard.value = { __ghost: true, w, h }
  ghostIndex.value = indexAt(x, y)
  edgeAutoScroll(x, y, src)
}
// 左栏松手在右栏：在占位符位置插入克隆卡。
// 返回 true 表示已插入（供调用方判断是否需要提示）
function commitDrop(src) {
  // 防御：无设备（网格未渲染）时不得写入，避免“假成功”后数据无处保存
  if (!deviceId.value) { clearDropPreview(); return false }
  const idx = ghostCard.value ? Math.max(0, Math.min(ghostIndex.value, cards.value.length)) : cards.value.length
  clearDropPreview()
  const c = cloneFrom(src)
  if (!c) return false
  if (!pages.value[pageIndex.value]) { pages.value = [newPage('首页')]; pageIndex.value = 0 }
  // 每个保存周期只在首张复制时提示一次，避免连续拖入 toast 刷屏（保存按钮常驻提示未保存状态）
  const wasDirty = dirty.value
  cards.value.splice(idx, 0, c)
  selectedUid.value = c.uid
  revealCard(c.uid)
  if (!wasDirty) emit('toast', `已复制到${deviceName.value}：${cardLabel(c)}，点「保存」生效`)
  return true
}
function getGridRect() {
  return gridEl.value?.getBoundingClientRect() || null
}
// 跨栏浮动幽灵在手机栏内应呈现的像素尺寸：按手机列数与格子钳制，避免电脑大卡压小框
function ghostSize(src) {
  if (!deviceId.value || !cellSize.value) return null
  return spanSize(src)
}

// 暴露给父组件：dropCard=点手柄追加末尾；preview/commit/rect=跨栏定位拖放；
// ghostSize=浮动幽灵按手机格子钳制后的尺寸；dirty/save 供左栏「完成/取消」联动检查
function dropCard(src) {
  if (!deviceId.value) {
    // 无设备时不克隆不提示成功：引导用户先在手机端登录本账号
    emit('toast', '暂无手机设备：请先在手机 App 登录本账号', true)
    return
  }
  const c = cloneFrom(src)
  if (!c) return
  if (!pages.value[pageIndex.value]) { pages.value = [newPage('首页')]; pageIndex.value = 0 }
  const wasDirty = dirty.value
  cards.value.push(c)
  selectedUid.value = c.uid
  revealCard(c.uid)
  if (!wasDirty) emit('toast', `已复制到${deviceName.value}：${cardLabel(c)}，点「保存」生效`)
}
// 插入的卡片可能在滚动区视口外：待渲染后滚到最近位置，让用户看到落位点与选中操作条
function revealCard(uid) {
  nextTick(() => {
    document.getElementById('apk-card-' + uid)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}
defineExpose({ dropCard, save, dirty, previewDrop, commitDrop, clearDropPreview, getGridRect, ghostSize })

// HTML5 手柄拖放（桌面端兜底路径）：dragover 同样显示定位占位符。
// dragover 阶段读不到 dataTransfer 数据，源卡快照由左栏经 dragPayload prop 传入。
function onDragOver(e) {
  // 无设备：不 preventDefault，浏览器显示“禁止放置”光标，也不会产生 drop
  if (!deviceId.value) return
  e.preventDefault()
  dragOver.value = true
  if (props.dragPayload) previewDrop(e.clientX, e.clientY, props.dragPayload)
}
function onDrop(e) {
  if (!deviceId.value) return
  e.preventDefault()
  try {
    const raw = e.dataTransfer?.getData(MIME)
    if (raw) commitDrop(JSON.parse(raw))
  } catch { /* 非法载荷忽略 */ } finally {
    clearDropPreview()
  }
}
function onDragLeave(e) {
  // 只在离开整个面板时取消高亮（经过子元素的 dragleave 不取消）
  if (e.currentTarget.contains(e.relatedTarget)) return
  clearDropPreview()
}
function quickCopyHint() {
  emit('toast', '直接把左侧卡片拖到这里任意位置即可复制（也可点卡片右上角手柄）')
}

// ---- 拖到滚动区边缘自动滚动：跨栏拖放与栏内拖动共用 ----
// 指针进入上下边缘 48px 内时按距离给 1~8px/帧 的滚动速度；占位符/换位随滚动帧实时跟随。
const scrollEl = ref(null)
const EDGE_PX = 48
let edgeRaf = 0
let edgeSpeed = 0
let edgeX = 0
let edgeY = 0
let edgeSrc = null // 跨栏拖放的源卡快照（栏内拖动为 null，换位用 paneDrag.card）
function edgeAutoScroll(x, y, src = null) {
  edgeX = x; edgeY = y
  if (src) edgeSrc = src
  const sc = scrollEl.value
  if (!sc) { stopEdgeScroll(); return }
  const r = sc.getBoundingClientRect()
  let speed = 0
  if (y < r.top + EDGE_PX) speed = -Math.min(8, Math.ceil((r.top + EDGE_PX - y) / 6))
  else if (y > r.bottom - EDGE_PX) speed = Math.min(8, Math.ceil((y - (r.bottom - EDGE_PX)) / 6))
  edgeSpeed = speed
  if (speed && !edgeRaf) edgeRaf = requestAnimationFrame(edgeScrollTick)
}
function edgeScrollTick() {
  const sc = scrollEl.value
  if (!sc || !edgeSpeed) { edgeRaf = 0; return }
  const before = sc.scrollTop
  sc.scrollTop += edgeSpeed
  if (sc.scrollTop === before) {
    // 已到顶/底：自停；指针仍在边缘时后续 pointermove 会重新启动
    edgeSpeed = 0; edgeRaf = 0
    return
  }
  // 滚动后插入点可能已变：栏内拖动重排，跨栏拖放移动占位符
  if (paneDrag?.active) reorderInPane()
  else if (ghostCard.value && edgeSrc) ghostIndex.value = indexAt(edgeX, edgeY)
  edgeRaf = requestAnimationFrame(edgeScrollTick)
}
function stopEdgeScroll() {
  edgeSpeed = 0
  edgeSrc = null
  if (edgeRaf) { cancelAnimationFrame(edgeRaf); edgeRaf = 0 }
}

// ---- 右栏内部：按住卡片拖动换位（鼠标/触控笔 pointer 方案）----
const dragCard = ref(null)
let paneDrag = null // { card, el, uid, grabX/Y, startX/Y }
let paneDragEndAt = 0
function onPanePointerDown(e, card) {
  if (e.button !== 0 && e.pointerType === 'mouse') return
  // 触屏：垂直手势让给手机框滚动（CSS 端 touch-action: pan-y，见 @media pointer:coarse），
  // 卡片排序改用选中操作条的前移/后移按钮；鼠标/触控笔仍支持按住自由拖动
  if (e.pointerType === 'touch') return
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  paneDrag = {
    card, el, uid: card.uid,
    grabX: e.clientX - rect.left, grabY: e.clientY - rect.top,
    startX: e.clientX, startY: e.clientY,
    active: false, moved: false,
  }
  window.addEventListener('pointermove', onPanePointerMove)
  window.addEventListener('pointerup', onPanePointerUp)
  window.addEventListener('pointercancel', onPanePointerUp)
}
// 按指针位置实时换位（pointermove 与边缘自动滚动帧共用）
function reorderInPane(x = null, y = null) {
  const px = x ?? edgeX, py = y ?? edgeY
  const arr = cards.value
  let idx = indexAt(px, py, paneDrag.card)
  const from = arr.indexOf(paneDrag.card)
  if (idx > from) idx-- // 移除自身后修正插入点
  if (from >= 0 && idx !== from) {
    arr.splice(from, 1)
    arr.splice(idx, 0, paneDrag.card)
  }
}
function onPanePointerMove(e) {
  if (!paneDrag) return
  if (!paneDrag.active) {
    if (Math.hypot(e.clientX - paneDrag.startX, e.clientY - paneDrag.startY) < 6) return
    paneDrag.active = true
    paneDrag.moved = true
    dragCard.value = paneDrag.card
  }
  e.preventDefault()
  const grid = gridEl.value
  if (!grid) return
  const gridRect = grid.getBoundingClientRect()
  const left = gridRect.left + paneDrag.el.offsetLeft
  const top = gridRect.top + paneDrag.el.offsetTop
  paneDrag.el.style.transform =
    `translate(${e.clientX - paneDrag.grabX - left}px, ${e.clientY - paneDrag.grabY - top}px) scale(1.04)`
  reorderInPane(e.clientX, e.clientY)
  edgeAutoScroll(e.clientX, e.clientY) // 拖到手机框上下边缘时自动滚动，滚动帧内继续换位
}
function onPanePointerUp() {
  // 轻触选中统一交给随后的 click（onPaneCardClick）处理，避免两处各切一次导致选不中；
  // 这里仅收尾拖拽并记录时刻，让 350ms 内的 click 被识别为拖拽副产物
  stopEdgeScroll()
  if (paneDrag?.moved) paneDragEndAt = Date.now()
  if (paneDrag?.el) paneDrag.el.style.transform = ''
  paneDrag = null
  dragCard.value = null
  window.removeEventListener('pointermove', onPanePointerMove)
  window.removeEventListener('pointerup', onPanePointerUp)
  window.removeEventListener('pointercancel', onPanePointerUp)
}
function onPaneCardClick(card) {
  // 拖拽收尾 350ms 内的 click 视为拖拽副产物，吞掉；否则为轻触选中/取消
  if (Date.now() - paneDragEndAt < 350) return
  selectedUid.value = selectedUid.value === card.uid ? '' : card.uid
  try { navigator.vibrate?.(12) } catch { /* 不支持则忽略 */ }
}

// ---- 选中卡片操作 ----
function indexOf(card) { return cards.value.indexOf(card) }
function cardLabel(card) { return cardDefaults[card.type]?.label || card.title || card.type }
function move(card, dir) {
  const arr = cards.value
  const i = arr.indexOf(card)
  const t = i + dir
  if (i < 0 || t < 0 || t >= arr.length) return
  ;[arr[i], arr[t]] = [arr[t], arr[i]]
}
function resizeCard(card, delta) {
  const next = Math.min(cols.value, Math.max(1, (card.w || 1) + delta))
  card.w = next
}
function remove(card) {
  const i = cards.value.indexOf(card)
  if (i >= 0) cards.value.splice(i, 1)
  if (selectedUid.value === card.uid) selectedUid.value = ''
}

// ---- 手机框尺寸监听：measure/gridStyle/zoomStyle/holderStyle 均由 useDashGrid 提供 ----
let ro = null
// frameEl 位于 v-else 分支：设备列表异步到位时 onMounted 可能还拿不到元素，
// 故 RO 绑定做成幂等函数，由 onMounted 与 devices watcher 各尝试一次
function ensureRO() {
  if (ro || typeof ResizeObserver === 'undefined' || !frameEl.value) return
  ro = new ResizeObserver(() => measure())
  ro.observe(frameEl.value)
}
onMounted(() => {
  ensureRO()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  stopEdgeScroll()
  window.removeEventListener('resize', measure)
  // 拖拽进行中卸载：摘掉 window 级监听，避免泄漏
  window.removeEventListener('pointermove', onPanePointerMove)
  window.removeEventListener('pointerup', onPanePointerUp)
  window.removeEventListener('pointercancel', onPanePointerUp)
})
watch(cols, () => nextTick(measure))
</script>

<style scoped>
.hc-apk-tabs { scrollbar-width: none; }
.hc-apk-tabs::-webkit-scrollbar { display: none; }
.hc-apk-scroll { scrollbar-width: thin; scrollbar-color: rgb(var(--c-border) / .5) transparent; }
.hc-apk-scroll::-webkit-scrollbar { width: 4px; }
.hc-apk-scroll::-webkit-scrollbar-thumb { border-radius: 2px; background: rgb(var(--c-border) / .4); }
.hc-apk-grid {
  position: relative;
  display: grid;
  gap: 12px;
  align-content: start;
}
/* 空页：网格本身高度塌陷，撑出放置区，使整块引导区都能接收跨栏拖放 */
.hc-apk-grid:empty {
  min-height: 16rem;
}
.hc-apk-card {
  position: relative;
  border-radius: 14px;
  cursor: pointer;
  touch-action: none; /* 面板内卡片以拖拽为核心交互：阻止触摸滚动/缩放手势 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition: box-shadow .16s ease, outline-color .16s ease;
}
.hc-apk-card:hover { outline: 1.5px dashed rgb(var(--c-primary) / .5); outline-offset: -1.5px; }
.hc-apk-card-sel { outline: 2px solid rgb(var(--c-primary) / .9); outline-offset: -2px; z-index: 2; }
/* 触屏设备：垂直滑动让给手机框滚动（卡片拖动排序改用操作条按钮；见 onPanePointerDown） */
@media (pointer: coarse) {
  .hc-apk-card { touch-action: pan-y; }
}
/* 双栏时右栏为双份卡片渲染：视口外卡片跳过布局/绘制以降低开销
   （行高为固定格距，跳过渲染不塌行，拖拽命中仍按网格盒计算）。
   地图卡除外：其内部按容器尺寸测量定位，初始被跳过会拿到 0 尺寸 */
.hc-apk-card:not([data-type="map"]) {
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
}
/* 栏内拖拽中的卡片：抬起阴影 + 关闭过渡（位置由 transform 即时跟随） */
.hc-apk-card-drag {
  z-index: 12;
  cursor: grabbing;
  box-shadow: 0 14px 30px rgba(0, 0, 0, .24);
  transition: none;
}
/* 跨栏插入占位符：虚线框 + 呼吸底色，明确松手落位处 */
.hc-apk-drop-slot {
  border-radius: 14px;
  border: 2px dashed rgb(var(--c-primary) / .75);
  background: rgb(var(--c-primary) / .08);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-primary));
  pointer-events: none;
  animation: hc-apk-slot-pulse .9s ease-in-out infinite alternate;
}
.hc-apk-drop-slot .material-symbols-outlined { font-size: 28px; }
@keyframes hc-apk-slot-pulse {
  from { background: rgb(var(--c-primary) / .05); }
  to { background: rgb(var(--c-primary) / .16); }
}
.hc-apk-zoom {
  pointer-events: none; /* 编辑面板只做布局预览，卡片内部控件不可点（防误触开关/执行场景） */
  transform-origin: top left;
  flex: none;
}
/* 选中操作条滑入/滑出 */
.hc-apk-bar-enter-active { transition: opacity .18s ease, transform .18s cubic-bezier(.2,.8,.2,1); }
.hc-apk-bar-leave-active { transition: opacity .14s ease, transform .14s ease; }
.hc-apk-bar-enter-from, .hc-apk-bar-leave-to { opacity: 0; transform: translateY(6px); }
</style>

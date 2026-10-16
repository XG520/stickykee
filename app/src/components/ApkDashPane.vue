<template>
  <!-- Web 端双栏编辑：右侧手机 App 仪表盘面板。
       独立加载/保存 dashboard_apk_<deviceId>，接收左侧电脑仪表盘拖入的卡片（复制，新 uid）。 -->
  <section
    class="hc-apk-pane flex flex-col rounded-2xl border bg-surface-alt/40 overflow-hidden transition-shadow"
    :class="dragOver ? 'border-primary ring-2 ring-primary/40 shadow-xl shadow-primary/10' : 'border-border'"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 面板头部：标题 + 设备选择 + 保存/撤销 -->
    <header class="shrink-0 px-3.5 pt-3 pb-2 border-b border-border/70">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-xl shrink-0" aria-hidden="true">smartphone</span>
        <h2 class="text-sm font-semibold text-on-surface truncate">手机 App 仪表盘</h2>
        <button
          v-if="dirty"
          @click="save"
          class="ml-auto shrink-0 h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold shadow-sm hover:opacity-90 active:scale-95 transition"
          title="保存到选中手机，该机 App 将自动刷新"
        >保存</button>
        <button
          v-if="dirty"
          @click="revert"
          class="shrink-0 h-9 w-9 flex items-center justify-center rounded-lg border border-border text-muted hover:text-on-surface active:scale-95 transition"
          title="撤销未保存的修改" aria-label="撤销修改"
        >
          <span class="material-symbols-outlined text-lg">undo</span>
        </button>
      </div>
      <select
        v-if="devices.length"
        v-model="deviceId"
        class="mt-2 w-full h-10 px-2.5 rounded-xl bg-surface border border-border text-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        title="选择要编辑的手机设备"
      >
        <option v-for="d in devices" :key="d.device_id" :value="d.device_id">{{ d.name }}</option>
      </select>
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

      <!-- 手机屏框：内部按真机列数渲染，所见即所得 -->
      <div class="min-h-0 flex-1 overflow-y-auto hc-apk-scroll p-3">
        <div
          ref="frameEl"
          class="mx-auto rounded-[26px] border border-border bg-background p-2 shadow-[0_0_0_4px_rgba(128,128,128,0.07),0_14px_36px_rgba(0,0,0,0.16)]"
          :style="{ maxWidth: frameMaxWidth + 'px' }"
        >
          <div class="relative rounded-[20px] overflow-hidden" :class="!cards.length ? 'min-h-[16rem]' : ''">
            <div class="hc-apk-grid" :style="gridStyle">
              <div
                v-for="card in cards" :key="card.uid"
                :id="'apk-card-' + card.uid"
                class="hc-apk-card"
                :class="{ 'hc-apk-card-sel': selectedUid === card.uid }"
                :data-type="card.type"
                :style="holderStyle(card)"
                @click.stop="selectedUid = selectedUid === card.uid ? '' : card.uid"
              >
                <!-- 编辑面板内禁用卡片内部交互（pointer-events-none），避免调开关误触 -->
                <div class="hc-apk-zoom" :style="zoomStyle(card)">
                  <CodeCard :card="card" :scope-id="'apk-card-' + card.uid" @device-drawer="(f) => $emit('device-drawer', f)" />
                </div>
              </div>
            </div>

            <!-- 空页引导（无卡片时整块是放置区） -->
            <button
              v-if="!cards.length"
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
import {
  newCard, newPage, migrateDashboard, serializeDashboard,
  layoutKeyFor, colsKeyFor,
} from '@/utils/dashboard'

// 本账号已注册设备列表（由 HomeView 传入）；切换设备即切换编辑的 dashboard_apk_<deviceId>
const props = defineProps({
  devices: { type: Array, default: () => [] },
})
const emit = defineEmits(['device-drawer', 'toast'])

// 拖拽数据 MIME：左栏卡片 dragstart 写入，本面板 drop 读取（只传白名单字段，克隆后生成新 uid）
const MIME = 'application/x-hc-card'
const CARD_FIELDS = ['w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar', 'title']
const baseCell = 120
const gridGap = 12
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

// 暴露给父组件：点击左栏卡片的「复制」手柄时直接追加到当前页末尾；
// dirty/save 供左栏「完成/取消」时联动检查，避免手机端未保存修改被静默丢弃
function dropCard(src) {
  const c = cloneFrom(src)
  if (!c) return
  if (!pages.value[pageIndex.value]) { pages.value = [newPage('首页')]; pageIndex.value = 0 }
  pages.value[pageIndex.value].cards.push(c)
  selectedUid.value = c.uid
  emit('toast', `已复制到${deviceName.value}：${cardLabel(c)}，点「保存」生效`)
}
defineExpose({ dropCard, save, dirty })

function onDrop(e) {
  dragOver.value = false
  try {
    const raw = e.dataTransfer?.getData(MIME)
    if (raw) dropCard(JSON.parse(raw))
  } catch { /* 非法载荷忽略 */ }
}
function onDragLeave(e) {
  // 只在离开整个面板时取消高亮（经过子元素的 dragleave 不取消）
  if (e.currentTarget.contains(e.relatedTarget)) return
  dragOver.value = false
}
function quickCopyHint() {
  emit('toast', '点击左侧卡片右上角的复制图标，也可直接复制到这里')
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

// ---- 网格测量：手机框宽度 → 单格像素（行高=列宽，正方形格），卡片基准 120px 等比缩放 ----
const frameEl = ref(null)
const cellSize = ref(0)
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
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('resize', measure) })
watch(cols, () => nextTick(measure))
function measure() {
  const w = frameEl.value?.clientWidth
  if (!w) return
  // 手机框自带 p-2（8px）内边距，内容宽需减去两侧
  const inner = Math.max(80, w - 16)
  cellSize.value = (inner - gridGap * (cols.value - 1)) / cols.value
}

const zoomFactor = computed(() => (cellSize.value > 0 ? cellSize.value / baseCell : 1))
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, minmax(0, 1fr))`,
  gridAutoRows: cellSize.value ? cellSize.value + 'px' : 'auto',
}))
function zoomStyle(card) {
  const cw = Math.min(Math.max(1, card.w || 1), cols.value)
  const rh = Math.min(3, card.h || 1)
  const z = zoomFactor.value
  return {
    transform: `scale(${z})`,
    width: cw * baseCell + (cw - 1) * gridGap / z + 'px',
    height: rh * baseCell + (rh - 1) * gridGap / z + 'px',
    display: 'flex',
    flexDirection: 'column',
    flex: 'none',
  }
}
function holderStyle(card) {
  const cw = Math.min(Math.max(1, card.w || 1), cols.value)
  return {
    gridColumn: `span ${cw}`,
    gridRow: `span ${Math.min(3, card.h || 1)}`,
    borderRadius: (14 * (zoomFactor.value || 1)).toFixed(2) + 'px',
  }
}
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
.hc-apk-card {
  position: relative;
  border-radius: 14px;
  cursor: pointer;
  transition: box-shadow .16s ease, outline-color .16s ease;
}
.hc-apk-card:hover { outline: 1.5px dashed rgb(var(--c-primary) / .5); outline-offset: -1.5px; }
.hc-apk-card-sel { outline: 2px solid rgb(var(--c-primary) / .9); outline-offset: -2px; z-index: 2; }
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

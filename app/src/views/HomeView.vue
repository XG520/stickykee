<template>
  <div class="min-h-0">
    <!-- 位置同步 Toast -->
    <div v-if="locMsg" class="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-body animate-slide-in"
      :class="locErr ? 'bg-error/10 border border-error/30 text-error' : 'bg-success/10 border border-success/30 text-success'">
      <span class="material-symbols-outlined text-lg">{{ locErr ? 'location_off' : 'location_on' }}</span>
      <span class="min-w-0">{{ locMsg }}</span>
    </div>

    <!-- 折叠工具栏（非沉浸态、非编辑态）：平时折叠隐藏，占位导航栏下方；
         鼠标移到这一行（导航栏下面一点）即自动弹出，移开 3 秒后收起 -->
    <template v-if="!immersive && !editing">
      <div class="relative z-20" @mouseenter="toolbarEnter" @mouseleave="toolbarLeave">
        <div class="flex items-center justify-between mb-4 flex-wrap gap-3 transition-all duration-300"
          :class="toolbarShow ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'">
          <p class="text-muted text-sm font-body"></p>
          <div class="flex items-center gap-2">
            <button
              @click="manualLocate"
              :disabled="locating"
              class="px-3.5 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 border border-primary/25 text-sm font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-60"
              title="获取当前设备定位并同步到 Home Assistant"
            >
              <span v-if="locating" class="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span>
              <span v-else class="material-symbols-outlined text-base">my_location</span>
              {{ locating ? '定位中…' : '更新位置' }}
            </button>
            <button @click="editing = true" class="px-4 py-2 rounded-lg bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-colors flex items-center gap-1.5">
              <span class="material-symbols-outlined text-base">edit_square</span> 编辑仪表盘
            </button>
            <button @click="enterImmersive"
              class="px-3 py-2 rounded-lg bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-colors flex items-center gap-1.5"
              title="全屏显示：折叠导航栏、隐藏编辑按钮">
              <span class="material-symbols-outlined text-base">fullscreen</span> 全屏
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 编辑态悬浮操作条：编辑模式下一直悬浮显示（不受弹窗状态影响）；
         卡片工作室为全屏遮罩（z-70 > z-40），打开时自然盖住此条，不会显示在卡片编辑页面 -->
    <div v-if="editing && !immersive" class="fixed top-16 right-4 z-40 flex items-center gap-2">
      <button @click="resetLayout" class="px-3 py-2 rounded-lg bg-surface/95 backdrop-blur border border-border text-muted hover:text-on-surface text-sm transition-colors shadow-lg">重置</button>
      <button @click="saveLayout" class="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors flex items-center gap-1.5 shadow-lg">
        <span class="material-symbols-outlined text-base">check</span> 完成
      </button>
    </div>

    <!-- 沉浸模式由全局浮动退出按钮接管（App.vue） -->

    <!-- 添加卡片（编辑态） -->
    <div v-if="editing" class="mb-4 bg-surface-alt border border-border rounded-2xl p-4 animate-slide-in">
      <p class="text-muted text-xs font-body uppercase tracking-wider mb-3">添加卡片</p>
      <div v-for="g in addGroups" :key="g.name" class="mb-3">
        <p class="text-muted text-[11px] font-body mb-1.5">{{ g.name }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="opt in g.items"
            :key="opt.type"
            @click="addCard(opt)"
            class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-sm text-on-surface"
          >
            <span class="material-symbols-outlined text-lg" :class="opt.colorCls">{{ opt.icon }}</span>
            {{ opt.label }}
            <span class="material-symbols-outlined text-base text-primary">add</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 网格仪表盘：卡片从左向右排列，放不下的自动换到下一行；贴合视口不滚动
         加载完成（loaded）后才渲染，避免先闪现默认仪表盘 -->
    <div v-if="loaded" ref="gridEl" class="dashboard-grid" :style="gridStyle">
      <div
        v-for="card in cards"
        :key="card.uid"
        class="hc-card-holder"
        :id="'card-' + card.uid"
        :data-type="card.type"
        :style="holderStyle(card)"
      >
        <!-- 编辑态操作条 -->
        <div v-if="editing"
          class="absolute z-30 top-2 right-2 flex items-center gap-1 bg-surface-alt/95 backdrop-blur border border-border rounded-full px-1.5 py-1 shadow-lg">
          <button @click="moveCard(card, -1)" :disabled="isFirst(card)" class="p-1 rounded-full hover:bg-surface active:scale-95 transition disabled:opacity-30" title="左移">
            <span class="material-symbols-outlined text-lg text-on-surface">arrow_back</span>
          </button>
          <button @click="moveCard(card, 1)" :disabled="isLast(card)" class="p-1 rounded-full hover:bg-surface active:scale-95 transition disabled:opacity-30" title="右移">
            <span class="material-symbols-outlined text-lg text-on-surface">arrow_forward</span>
          </button>
          <button @click="openEditor(card)" class="p-1 rounded-full hover:bg-primary/10 transition" title="编辑尺寸与代码">
            <span class="material-symbols-outlined text-lg text-on-surface">tune</span>
          </button>
          <button @click="removeCard(card)" class="p-1 rounded-full hover:bg-error/10 text-muted hover:text-error active:scale-95 transition" title="删除">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>

        <!-- 卡片实际内容：基准尺寸渲染 + zoom 等比缩放（窗口缩放不影响内部布局/换行） -->
        <div class="hc-card-zoom" :style="zoomStyle(card)">
          <CodeCard :card="card" :scope-id="'card-' + card.uid" />
        </div>
      </div>
    </div>

    <!-- 卡片工作室：全屏编辑器（实时预览 + 实体/尺寸配置 + HTML/CSS/JS 代码编辑） -->
    <CardEditor
      :open="editorOpen"
      :card="editingCard"
      :cell-size="cellSize"
      :cols="cols"
      @close="editorOpen = false"
      @save="onEditorSave"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import api from '@/api'
import { ui, entityStates } from '@/store'
import { useEntities } from '@/composables/useLive'
import { useAutoHide } from '@/composables/useAutoHide'
import { syncCurrentLocation } from '@/utils/location'
import CodeCard from '@/components/cards/CodeCard.vue'
import CardEditor from '@/components/cards/CardEditor.vue'
import { cardDefaults } from '@/components/cards/defaults'
import { CTL_CSS } from '@/components/cards/templates'

function meta(type) { return cardDefaults[type] || cardDefaults.greeting }

let uidSeq = 0
function uid() { return (++uidSeq).toString(36) + Date.now().toString(36) }

// 人员卡旧模板升级：早期模板没有「第二实体（子属性）」元素，加载时自动注入，
// 使已存在的人员卡也能显示第二个实体的图标+值（幂等，已含 h-sub 则跳过）。
function upgradePersonCard(card) {
  if (!card || card.type !== 'person' || !card.html || card.html.includes('h-sub')) return
  card.html = String(card.html).replace(
    /(<\/div>\s*)$/,
    '\n  <div class="h-sub{{subCls}}"><span class="material-symbols-outlined h-sub-ic">{{subGlyph}}</span><span class="h-sub-v">{{subValue}}</span></div>\n$1',
  )
  card.css = (card.css || '') + '\n.h-sub{display:flex;align-items:center;justify-content:center;gap:3px;margin-top:auto}\n.h-sub.is-hide{display:none}\n.h-sub-ic{font-size:10px;color:var(--hc-color,#5EC4B0);flex-shrink:0}\n.h-sub-v{font-size:9px;font-weight:600;color:#F2F0EB;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}'
}

// 实体卡旧模板升级：早期开关卡只在「有当前值」时渲染一个滑条（{{rangeHtml}}，如灯关闭时
// 没有亮度条）。改为能力模型输出的 {{controlsHtml}}——与设备页「更多信息」面板同源，
// 属性缺失也能操作，并覆盖风扇档位/窗帘位置等更多能力（幂等，已迁移过则跳过）。
function upgradeToggleCard(card) {
  if (!card || !card.html || !String(card.html).includes('{{rangeHtml}}')) return
  card.html = String(card.html)
    .replace(/<div class="h-row">\s*\{\{rangeHtml\}\}\s*<\/div>/g,
      '<div class="h-ctl" style="flex-direction:column;gap:3px;align-items:stretch">{{controlsHtml}}</div>')
    .replace(/\{\{rangeHtml\}\}/g, '{{controlsHtml}}')
  // 卡片 CSS 是创建时的快照，需要补上实体控件样式
  if (!String(card.css || '').includes('.h-ctl{')) card.css = (card.css || '') + CTL_CSS
}

function newCard(type, extra = {}) {
  const d = cardDefaults[type] || cardDefaults.generic
  const o = { type, uid: uid(), w: d.w, h: d.h, html: d.html, css: d.css, js: d.js, entity_id: '', entity_ids: [], icon: '', avatar: '' }
  for (const k of ['w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar']) {
    if (extra[k] !== undefined) o[k] = extra[k]
  }
  // 多实体卡（通用卡/人员位置卡）：实体列表以 entity_ids 为准，entity_id 始终同步为第一个（兼容单实体链路）
  if (type === 'generic' || type === 'person') {
    o.entity_ids = Array.isArray(o.entity_ids) ? o.entity_ids.filter(Boolean) : []
    if (!o.entity_ids.length && o.entity_id) o.entity_ids = [o.entity_id] // 旧数据迁移
  }
  return o
}

const defaultTypes = ['greeting', 'weather', 'map']
// 布局：初始为空，加载完成后一次填充（避免先渲染默认仪表盘再替换的闪现）
const cards = ref([])
const loaded = ref(false)
const editing = ref(false)
// 折叠工具栏：初始隐藏（折叠在导航栏下方），鼠标移到该行自动弹出，移开 3 秒后收起
const { visible: toolbarShow, enter: toolbarEnter, leave: toolbarLeave } = useAutoHide(3000, false)
// ---- 卡片工作室（独立组件：实时预览 + 代码编辑，内部维护草稿） ----
const editorOpen = ref(false)
const editingCard = ref(null)
function openEditor(card) {
  editingCard.value = card
  editorOpen.value = true
}
// 新增卡片时预选实体用：按卡片类型的 entityDomains 过滤（null 表示任意域）
function entityOptionsFor(type) {
  const domains = meta(type).entityDomains
  return Object.values(entityStates)
    .filter((e) => !domains || domains.includes(e.domain))
    .map((e) => ({ id: e.entity_id, label: `${e.friendly_name || e.entity_id}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
}
function onEditorSave(p) {
  const c = cards.value.find((x) => x.uid === p.uid)
  if (!c) return
  c.w = p.w
  c.h = p.h
  c.html = p.html
  c.css = p.css
  c.js = p.js
  if (c.type === 'generic' || c.type === 'person') {
    // 多实体卡（通用卡/人员位置卡）：保存完整列表，entity_id 同步为首项
    c.entity_ids = Array.isArray(p.entity_ids) ? [...p.entity_ids] : []
    c.entity_id = c.entity_ids[0] || ''
  } else if (meta(c.type).needEntity) {
    c.entity_id = p.entity_id
  }
  c.icon = p.icon
  c.avatar = p.avatar
  editorOpen.value = false
}

// ---- 网格：列数随宽度变化，卡片自动换行 ----
const gridEl = ref(null)
const cols = ref(8)
const gridH = ref(600)
const cellSize = ref(0)
const gridGap = 12
// 基准格子尺寸：卡片内容按此固定尺寸布局，再整体 zoom 到实际格子，
// 因此窗口缩放时内部元素等比例变化、相对位置与换行不变。
const baseCell = 120
const zoomFactor = computed(() => (cellSize.value > 0 ? cellSize.value / baseCell : 1))
function zoomStyle(card) {
  const cw = Math.min(Math.max(1, card.w || 1), cols.value)
  return {
    zoom: zoomFactor.value,
    width: cw * baseCell + 'px',
    height: Math.min(3, card.h || 1) * baseCell + 'px',
    display: 'flex',
    flexDirection: 'column',
    flex: 'none',
  }
}
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, minmax(0, 1fr))`,
  // 行高 = 列宽：1×1 仍为正方形，格子尺寸约为原来的 1/2（列数翻倍）
  gridAutoRows: cellSize.value ? cellSize.value + 'px' : 'auto',
  minHeight: gridH.value + 'px',
}))
function holderStyle(card) {
  const cw = Math.min(Math.max(1, card.w || 1), cols.value)
  return {
    gridColumn: `span ${cw}`,
    gridRow: `span ${Math.min(3, card.h || 1)}`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  }
}
function updateCols() {
  if (!gridEl.value) return
  const w = gridEl.value.clientWidth
  cols.value = Math.max(1, Math.min(8, Math.floor(w / 120)))
  // 减去列间距后单列的实际宽度 = 单格行高（正方形），约为原来的 1/2
  cellSize.value = (w - gridGap * (cols.value - 1)) / cols.value
}
function measure() {
  if (!gridEl.value) return
  const top = gridEl.value.getBoundingClientRect().top
  gridH.value = Math.max(200, Math.floor(window.innerHeight - top - 20))
  updateCols()
}

// ---- 布局状态：可添加卡片（按领域分组，每组展示全部卡片类型） ----
const addGroups = computed(() => {
  const map = {}
  for (const [type, m] of Object.entries(cardDefaults)) {
    if (!m.group) continue
    ;(map[m.group] ||= []).push({ type, label: m.label, icon: m.icon, colorCls: m.colorCls })
  }
  return Object.entries(map).map(([name, items]) => ({ name, items }))
})
function addCard(opt) {
  const card = newCard(opt.type, { entity_id: '' })
  // 自动预选该组第一个可用实体，用户可在编辑弹窗里更换（通用卡可继续添加任意数量）
  const opts = entityOptionsFor(opt.type)
  if (opts.length) {
    card.entity_id = opts[0].id
    if (['generic', 'person'].includes(opt.type)) card.entity_ids = [opts[0].id]
  }
  cards.value.push(card)
  openEditor(card)
}
function removeCard(card) { const i = cards.value.indexOf(card); if (i >= 0) cards.value.splice(i, 1) }
function moveCard(card, dir) {
  const i = cards.value.indexOf(card)
  const t = i + dir
  if (i < 0 || t < 0 || t >= cards.value.length) return
  const arr = cards.value
  ;[arr[i], arr[t]] = [arr[t], arr[i]]
}
const isFirst = (c) => cards.value.indexOf(c) === 0
const isLast = (c) => cards.value.indexOf(c) === cards.value.length - 1

async function loadLayout() {
  let has = false
  try {
    const { data } = await api.getPrefs()
    if (data?.dashboard) {
      try {
        const arr = JSON.parse(data.dashboard)
        if (Array.isArray(arr) && arr.length) {
          const list = arr
            .map((item) => (typeof item === 'string' ? newCard(item) : newCard(item.type, { w: item.w, h: item.h, html: item.html, css: item.css, js: item.js, entity_id: item.entity_id, entity_ids: item.entity_ids, icon: item.icon, avatar: item.avatar })))
            .filter((c) => cardDefaults[c.type])
          if (list.length) {
            list.forEach(upgradePersonCard)
            list.forEach(upgradeToggleCard)
            cards.value = list
            has = true
          }
        }
      } catch { /* 用默认 */ }
    }
    if (data?.map_config) {
      try { cfg.map_config = JSON.parse(data.map_config) } catch { cfg.map_config = null }
    }
  } catch { /* 后端离线静默 */ }
  // 无保存布局时填充默认仪表盘；加载完成前不渲染，避免闪现
  if (!has) cards.value = defaultTypes.map((t) => newCard(t))
  loaded.value = true
}
async function saveLayout() {
  try {
    await api.putPrefs({ dashboard: JSON.stringify(cards.value.map(({ type, w, h, html, css, js, entity_id, entity_ids, icon, avatar }) => ({ type, w, h, html, css, js, entity_id, entity_ids, icon, avatar }))) })
    editing.value = false
  } catch { /* 静默 */ }
}
function resetLayout() {
  cards.value = defaultTypes.map((t) => newCard(t))
  editing.value = false
}

// 配置与定位
const cfg = reactive({ map_config: null })
const locating = ref(false)
const locMsg = ref('')
const locErr = ref(false)
let locToastTimer = null
function toast(msg, err = false) {
  locMsg.value = msg; locErr.value = err
  if (locToastTimer) clearTimeout(locToastTimer)
  locToastTimer = setTimeout(() => (locMsg.value = ''), 6000)
}
function autoLocateRan() { try { return sessionStorage.getItem('hc_autolocate_ran') === '1' } catch { return true } }
function markAutoLocateRan() { try { sessionStorage.setItem('hc_autolocate_ran', '1') } catch {} }
async function locate(silent) {
  locating.value = true
  try {
    const mc = cfg.map_config || {}
    const target = mc.sync_target || ''
    const res = await syncCurrentLocation(target)
    const where = res.address || `${res.lat.toFixed(5)}, ${res.lng.toFixed(5)}`
    if (!silent) toast(`${res.name} 位置已同步（${where}）`)
  } catch (e) {
    if (!silent) toast(e.message || '定位同步失败', true)
  } finally { locating.value = false }
}
function manualLocate() { locate(false) }

// 沉浸/全屏模式
const immersive = computed(() => ui.immersive)
async function enterImmersive() {
  ui.immersive = true
  try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen() } catch {}
}
function onFsChange() { if (!document.fullscreenElement) ui.immersive = false }

// 沉浸/编辑状态改变会改变网格可用高度，重新测量
watch(() => ui.immersive, () => nextTick(measure))
watch(() => editing.value, () => nextTick(measure))

// 首次进入确保实体已加载
const { ensureLoaded } = useEntities()

onMounted(async () => {
  ensureLoaded()
  await loadLayout()
  await nextTick()
  measure()
  window.addEventListener('resize', measure)
  document.addEventListener('fullscreenchange', onFsChange)
  // 自动定位：每会话一次
  if (!autoLocateRan()) {
    markAutoLocateRan()
    toast('正在自动定位，请允许浏览器位置授权…')
    locate(false)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  document.removeEventListener('fullscreenchange', onFsChange)
})
</script>

<style scoped>
.dashboard-grid {
  display: grid;
  gap: 12px;
  overflow: hidden;
  align-content: start;
}
.hc-card-holder {
  position: relative;
  overflow: hidden;
  container-type: inline-size;
}
.hc-card-zoom {
  position: relative;
  flex: none;
  transform-origin: top left;
}
</style>

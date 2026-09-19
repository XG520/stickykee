<template>
  <div class="min-h-0">
    <!-- 位置同步 Toast -->
    <div v-if="locMsg" class="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-body animate-slide-in"
      :class="locErr ? 'bg-error/10 border border-error/30 text-error' : 'bg-success/10 border border-success/30 text-success'">
      <span class="material-symbols-outlined text-lg">{{ locErr ? 'location_off' : 'location_on' }}</span>
      <span class="min-w-0">{{ locMsg }}</span>
    </div>

    <!-- 未配置个人 HA Token 提示 -->
    <div v-if="!haTokenConfigured && auth.user"
      class="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-body bg-warning/10 border border-warning/30 text-warning animate-slide-in">
      <span class="material-symbols-outlined text-lg shrink-0">key_off</span>
      <span class="min-w-0">尚未配置你的 Home Assistant 个人 Token，HA 实体访问已禁用。请到「设置 → Home Assistant 连接 → 我的 HA Token」填写后立即生效。</span>
    </div>

    <!-- 顶部工具条：左侧是固定宽度的「页签框」（页多了在框内左右滑动选择），右侧是操作按钮。
         非编辑态按钮感应式自动隐藏（鼠标移到本行即弹出）；页签框在有多个页时始终可见
         （沉浸模式也保留，否则无法切页）。窄屏自动换行：页签框占满一行，按钮换行到下一行右对齐。 -->
    <div v-if="!immersive || (loaded && pages.length > 1)"
      class="relative z-20 mb-4 flex flex-wrap items-center gap-2"
      @mouseenter="toolbarEnter" @mouseleave="toolbarLeave">

      <!-- 页签区：外层不加边框/底色（只保留固定宽度与横向滚动），页签自身是胶囊样式 -->
      <div v-if="loaded && (editing || pages.length > 1)"
        class="flex w-full sm:w-80 shrink-0 items-center gap-1 min-w-0">
        <div ref="tabsEl" class="hc-tabs flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto">
          <div v-for="(p, i) in pages" :key="p.id"
            :data-active="i === currentPageIndex ? '1' : null"
            class="flex shrink-0 items-center gap-0.5 rounded-full border px-1 py-0.5 transition-colors"
            :class="i === currentPageIndex ? 'bg-primary/15 border-primary/40' : 'bg-surface border-border'">
            <input v-if="editing && renamingIndex === i" :value="p.name"
              :ref="focusEl"
              aria-label="页面名称"
              name="hc-page-name"
              autocomplete="off"
              spellcheck="false"
              @blur="commitRename(i, $event.target.value)"
              @keydown.enter="$event.target.blur()"
              @keydown.esc="renamingIndex = -1"
              class="w-20 px-1.5 py-1 rounded-lg bg-surface border border-primary/40 text-sm text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
            <button v-else @click="switchPage(i)"
              :aria-current="i === currentPageIndex ? 'true' : undefined"
              class="px-2.5 py-1 rounded-full text-sm transition-colors truncate max-w-[8rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              :class="i === currentPageIndex ? 'text-primary font-semibold' : 'text-muted hover:text-on-surface'"
              :title="p.name">{{ p.name }}</button>
            <button v-if="editing && renamingIndex !== i" @click="renamingIndex = i"
              class="p-0.5 rounded-full text-muted hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title="重命名" aria-label="重命名本页">
              <span class="material-symbols-outlined text-sm" aria-hidden="true">edit</span>
            </button>
            <button v-if="editing" @click="movePage(i, -1)" :disabled="i === 0"
              class="p-0.5 rounded-full text-muted hover:text-on-surface transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title="左移" aria-label="本页左移">
              <span class="material-symbols-outlined text-sm" aria-hidden="true">chevron_left</span>
            </button>
            <button v-if="editing" @click="movePage(i, 1)" :disabled="i === pages.length - 1"
              class="p-0.5 rounded-full text-muted hover:text-on-surface transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title="右移" aria-label="本页右移">
              <span class="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>
            </button>
            <button v-if="editing" @click="removePage(i)" :disabled="pages.length <= 1"
              class="p-0.5 rounded-full text-muted hover:text-error transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              title="删除本页" aria-label="删除本页">
              <span class="material-symbols-outlined text-sm" aria-hidden="true">close</span>
            </button>
          </div>
        </div>
        <button v-if="editing" @click="addPage"
          class="shrink-0 flex items-center gap-0.5 px-1.5 py-1 rounded-full text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="新增页" aria-label="新增页">
          <span class="material-symbols-outlined text-base" aria-hidden="true">add</span>
          <span class="hidden sm:inline text-sm">新增页</span>
        </button>
      </div>

      <!-- 操作按钮：编辑态常显，非编辑态感应式自动隐藏；
           键盘 Tab 进入本组按钮时（focus-within）强制显示，避免焦点落在不可见按钮上 -->
      <div v-if="!immersive"
        class="ml-auto flex flex-wrap items-center gap-2 transition-opacity duration-300"
        :class="(editing || toolbarShow) ? 'opacity-100' : 'opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto'">
        <template v-if="editing">
          <button @click="onExport" class="px-3 py-2 rounded-lg bg-surface-alt border border-border text-muted hover:text-on-surface text-sm transition-colors flex items-center gap-1.5" title="把当前仪表盘导出为 JSON 文件">
            <span class="material-symbols-outlined text-base" aria-hidden="true">download</span> 导出
          </button>
          <button @click="pickImportFile" class="px-3 py-2 rounded-lg bg-surface-alt border border-border text-muted hover:text-on-surface text-sm transition-colors flex items-center gap-1.5" title="从 JSON 文件导入仪表盘">
            <span class="material-symbols-outlined text-base" aria-hidden="true">upload</span> 导入
          </button>
          <button @click="resetLayout" class="px-3 py-2 rounded-lg bg-surface-alt border border-border text-muted hover:text-on-surface text-sm transition-colors">重置</button>
          <button @click="saveLayout" class="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base" aria-hidden="true">check</span> 完成
          </button>
        </template>
        <template v-else>
          <button
            @click="manualLocate"
            :disabled="locating"
            class="px-3.5 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/15 border border-primary/25 text-sm font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-60"
            title="获取当前设备定位并同步到 Home Assistant"
          >
            <span v-if="locating" class="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" aria-hidden="true"></span>
            <span v-else class="material-symbols-outlined text-base" aria-hidden="true">my_location</span>
            {{ locating ? '定位中…' : '更新位置' }}
          </button>
          <button @click="editing = true" class="px-4 py-2 rounded-lg bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base" aria-hidden="true">edit_square</span> 编辑仪表盘
          </button>
          <button @click="enterImmersive"
            class="px-3 py-2 rounded-lg bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-colors flex items-center gap-1.5"
            title="全屏显示：折叠导航栏、隐藏编辑按钮">
            <span class="material-symbols-outlined text-base" aria-hidden="true">fullscreen</span> 全屏
          </button>
        </template>
      </div>
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
    <div v-if="loaded" ref="gridEl" class="dashboard-grid" :style="gridStyle"
      @touchstart.passive="onSwipeStart" @touchend="onSwipeEnd">
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

    <!-- 导入文件选择 -->
    <input ref="fileEl" type="file" accept="application/json,.json" class="hidden" @change="onImportFile" />

    <!-- 导入方式选择：新建一页 / 覆盖整个仪表盘 -->
    <div v-if="importInfo" class="fixed inset-0 z-[75] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="importInfo = null"></div>
      <div class="relative w-full max-w-md bg-surface-alt border border-border rounded-2xl p-5 shadow-2xl animate-slide-in">
        <h3 class="font-headline text-on-background font-semibold text-base flex items-center gap-2">
          <span class="material-symbols-outlined text-primary">upload</span> 导入仪表盘
        </h3>
        <p class="mt-2 text-muted text-xs font-body break-all">{{ importInfo.fileName }}</p>
        <p class="mt-1 text-on-surface text-sm font-body">{{ importInfo.pages.length }} 页 / {{ importCardCount }} 张卡片</p>
        <p v-if="importInfo.warnings.length" class="mt-2 text-warning text-xs font-body">{{ importInfo.warnings.join('；') }}</p>

        <label class="mt-4 block text-muted text-xs font-body mb-1.5">新页名称（选择「新建一页」时使用）</label>
        <input v-model="importInfo.newName" type="text"
          class="w-full px-3 py-2 rounded-xl bg-surface border border-border text-sm text-on-surface outline-none focus:border-primary/50" />

        <div class="mt-5 flex items-center gap-2 flex-wrap">
          <button @click="importAsNewPage" class="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors">新建一页</button>
          <button @click="importOverwrite" class="px-3.5 py-2 rounded-lg border border-error/40 text-error hover:bg-error/10 text-sm font-semibold transition-colors">覆盖当前仪表盘</button>
          <button @click="importInfo = null" class="ml-auto px-3.5 py-2 rounded-lg border border-border text-muted hover:text-on-surface text-sm transition-colors">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import api from '@/api'
import { ui, entityStates, haTokenConfigured, auth } from '@/store'
import { useEntities } from '@/composables/useLive'
import { useAutoHide } from '@/composables/useAutoHide'
import { syncCurrentLocation } from '@/utils/location'
import CodeCard from '@/components/cards/CodeCard.vue'
import CardEditor from '@/components/cards/CardEditor.vue'
import { cardDefaults } from '@/components/cards/defaults'
import { newCard, newPage, migrateDashboard, serializeDashboard, downloadDashboard, parseImportPayload } from '@/utils/dashboard'

function meta(type) { return cardDefaults[type] || cardDefaults.greeting }

const defaultTypes = ['greeting', 'weather', 'map']
function defaultPage() { return newPage('首页', defaultTypes.map((t) => newCard(t))) }

// 布局：多页结构。pages 为真实数据源，cards 是当前页的只读视图（同一份 reactive 引用，
// 卡片的就地增删改无需改任何现有代码）。
const pages = ref([])
const currentPageIndex = ref(0)
const cards = computed(() => pages.value[currentPageIndex.value]?.cards ?? [])
const loaded = ref(false)
const editing = ref(false)
// 折叠工具栏：初始隐藏（折叠在导航栏下方），鼠标移到该行自动弹出，移开 3 秒后收起
const { visible: toolbarShow, enter: toolbarEnter, leave: toolbarLeave } = useAutoHide(3000, false)
// 页签框内的横向滚动容器：切页后把当前页 chip 滚进可视区
const tabsEl = ref(null)
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
  let migrated = false
  try {
    const { data } = await api.getPrefs()
    if (data?.dashboard) {
      try {
        const r = migrateDashboard(JSON.parse(data.dashboard))
        if (r && r.pages.length) {
          pages.value = r.pages
          currentPageIndex.value = 0
          has = true
          migrated = r.migrated
        }
      } catch { /* 用默认 */ }
    }
    if (data?.map_config) {
      try { cfg.map_config = JSON.parse(data.map_config) } catch { cfg.map_config = null }
    }
  } catch { /* 后端离线静默 */ }
  // 无保存布局时填充默认仪表盘；加载完成前不渲染，避免闪现
  if (!has) { pages.value = [defaultPage()]; currentPageIndex.value = 0 }
  loaded.value = true
  // 旧结构迁移后落库一次（只在确实迁移过时写，避免与「完成」保存竞争）
  if (migrated) api.putPrefs({ dashboard: serializeDashboard(pages.value) }).catch(() => {})
}
async function saveLayout() {
  try {
    await api.putPrefs({ dashboard: serializeDashboard(pages.value) })
    editing.value = false
  } catch { /* 静默 */ }
}
function resetLayout() {
  pages.value = [defaultPage()]
  currentPageIndex.value = 0
  editing.value = false
}

// ---- 页级操作 ----
const renamingIndex = ref(-1)
const focusEl = (el) => el && el.focus()
// 页签框宽度固定、内容横向滚动：切页后把当前页 chip 滚到框内可视区中间。
// 只滚动页签框自身（scrollTo），不用 scrollIntoView，避免连带滚动整页。
function revealActivePage() {
  const box = tabsEl.value
  const el = box?.querySelector('[data-active="1"]')
  if (!box || !el) return
  const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  box.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
}
function switchPage(i) {
  if (i < 0 || i >= pages.value.length || i === currentPageIndex.value) return
  currentPageIndex.value = i
  nextTick(() => { measure(); revealActivePage() })
}
function addPage() {
  pages.value.push(newPage(`第 ${pages.value.length + 1} 页`))
  currentPageIndex.value = pages.value.length - 1
  nextTick(() => { measure(); revealActivePage() })
}
function removePage(i) {
  if (pages.value.length <= 1) return
  pages.value.splice(i, 1)
  if (currentPageIndex.value >= pages.value.length) currentPageIndex.value = pages.value.length - 1
  if (renamingIndex.value === i) renamingIndex.value = -1
  nextTick(() => { measure(); revealActivePage() })
}
function renamePage(i, name) {
  const p = pages.value[i]
  if (!p) return
  const t = String(name ?? '').trim()
  p.name = t || `第 ${i + 1} 页`
}
function commitRename(i, v) { renamePage(i, v); renamingIndex.value = -1 }
function movePage(i, dir) {
  const t = i + dir
  if (i < 0 || t < 0 || t >= pages.value.length) return
  const arr = pages.value
  ;[arr[i], arr[t]] = [arr[t], arr[i]]
  currentPageIndex.value = t
}

// ---- 左右滑动切页：手写触摸事件（不用横向滚动容器，避免所有页同时挂载） ----
let swipe = null
function onSwipeStart(e) {
  if (editing.value || e.touches.length !== 1) { swipe = null; return }
  // 排除卡片内交互（滑条拖动、地图平移、输入框选择）以免误切页
  if (e.target.closest('[data-hc], [data-type="map"], input, select, textarea')) { swipe = null; return }
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY }
}
function onSwipeEnd(e) {
  if (!swipe) return
  const t = e.changedTouches?.[0]
  const s = swipe
  swipe = null
  if (!t || editing.value) return
  const dx = t.clientX - s.x
  const dy = t.clientY - s.y
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    switchPage(currentPageIndex.value + (dx < 0 ? 1 : -1))
  }
}

// ---- 导出 / 导入 ----
const fileEl = ref(null)
const importInfo = ref(null)
function onExport() {
  try {
    downloadDashboard(pages.value)
    toast('已导出仪表盘文件')
  } catch { toast('导出失败', true) }
}
function pickImportFile() { fileEl.value?.click() }
async function onImportFile(e) {
  const f = e.target.files?.[0]
  e.target.value = '' // 允许重复选择同一文件
  if (!f) return
  if (f.size > 2 * 1024 * 1024) { toast('文件过大（超过 2 MB）', true); return }
  let text = ''
  try { text = await f.text() } catch { toast('读取文件失败', true); return }
  const r = parseImportPayload(text)
  if (!r.ok) { toast(r.error, true); return }
  importInfo.value = { pages: r.pages, warnings: r.warnings, fileName: f.name, newName: r.pages[0]?.name || '导入页' }
}
const importCardCount = computed(() => (importInfo.value?.pages || []).reduce((n, p) => n + p.cards.length, 0))
// 跨环境导入：统计绑定实体在本地不存在的卡片数（未配置 HA Token 时无从判断，跳过）
function missingEntityCount(list) {
  let n = 0
  for (const p of list) {
    for (const c of p.cards) {
      if (meta(c.type).needEntity && c.entity_id && !entityStates[c.entity_id]) n++
    }
  }
  return n
}
// 导入落库：失败回滚为原布局，成功则退出编辑态（与其他保存路径一致）
async function applyImport(nextPages, nextIndex, okMsg) {
  const backupPages = pages.value
  const backupIndex = currentPageIndex.value
  const info = importInfo.value
  pages.value = nextPages
  currentPageIndex.value = nextIndex
  try {
    await api.putPrefs({ dashboard: serializeDashboard(pages.value) })
    importInfo.value = null
    editing.value = false
    nextTick(measure)
    const notes = [...(info?.warnings || [])]
    if (haTokenConfigured.value) {
      const miss = missingEntityCount(pages.value)
      if (miss > 0) notes.push(`${miss} 张卡片绑定的实体在本地不存在，已显示为空态`)
    }
    toast(okMsg + (notes.length ? `（${notes.join('；')}）` : ''))
  } catch (e) {
    pages.value = backupPages
    currentPageIndex.value = backupIndex
    toast('导入失败：' + (e.message || '保存失败'), true)
  }
}
async function importAsNewPage() {
  const info = importInfo.value
  if (!info) return
  const name = String(info.newName || '').trim() || info.pages[0]?.name || `第 ${pages.value.length + 1} 页`
  info.pages[0].name = name
  const start = pages.value.length
  await applyImport([...pages.value, ...info.pages], start, '已导入为新页')
}
async function importOverwrite() {
  const info = importInfo.value
  if (!info) return
  await applyImport(info.pages, 0, '已覆盖当前仪表盘')
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
    const res = await syncCurrentLocation()
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
/* 页签框内的横向滚动容器：隐藏滚动条，滚动不传递给整页，移动端可左右拖拽选择 */
.hc-tabs {
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior-x: contain;
  touch-action: manipulation;
  -webkit-overflow-scrolling: touch;
  scroll-padding-inline: 6px;
}
.hc-tabs::-webkit-scrollbar {
  display: none;
}
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

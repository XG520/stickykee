<template>
  <div class="min-h-0">
    <!-- 位置同步 Toast：悬浮抽屉（fixed 顶部居中，从页头下缘滑出）。
         不占文档流、不挤压页面任何元素；展示 TOAST_MS 后自动收起，进出均有平滑过渡；
         pointer-events-none 使悬浮期间不遮挡头部与页面交互，仅抽屉本体可点 -->
    <transition name="hc-drawer">
      <div v-if="locMsg" class="fixed inset-x-0 z-[80] flex justify-center pointer-events-none"
        :class="ui.immersive ? 'top-2' : 'top-14'">
        <div class="pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-body border shadow-xl backdrop-blur-xl w-fit max-w-[calc(100vw-2rem)] sm:max-w-md"
          :class="locErr ? 'bg-error/15 border-error/40 text-error' : 'bg-success/15 border-success/40 text-success'">
          <span class="material-symbols-outlined text-lg shrink-0">{{ locErr ? 'location_off' : 'location_on' }}</span>
          <span class="min-w-0">{{ locMsg }}</span>
        </div>
      </div>
    </transition>

    <!-- 未配置个人 HA Token 提示：只在确实取到后端权威值（haTokenKnown）且为否时才提示，
         否则刷新时首帧会误报 -->
    <div v-if="haTokenKnown && !haTokenConfigured && auth.user"
      class="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-body bg-warning/10 border border-warning/30 text-warning animate-slide-in">
      <span class="material-symbols-outlined text-lg shrink-0">key_off</span>
      <span class="min-w-0">尚未配置你的 Home Assistant 个人 Token，HA 实体访问已禁用。请到「设置 → Home Assistant 连接 → 我的 HA Token」填写后立即生效。</span>
    </div>

    <!-- 顶部工具条：左侧是固定宽度的「页签框」（页多了在框内左右滑动选择），右侧是操作按钮。
         非编辑态按钮感应式自动隐藏（鼠标移到本行即弹出）；页签框在有多个页时始终可见
         （沉浸模式也保留，否则无法切页）。桌面端整条工具条 Teleport 进顶部导航栏（TheNavBar
         的 #hc-nav-slot）；窄屏与沉浸模式下回落到此处原地渲染，页签框占满一行、按钮换行右对齐。 -->
    <Teleport to="#hc-nav-slot" :disabled="!teleportToNav">
      <div v-if="!immersive || (loaded && pages.length > 1)"
        class="relative z-20 flex flex-wrap items-center gap-2"
        :class="teleportToNav ? '' : 'mb-4'"
        @mouseenter="toolbarEnter" @mouseleave="toolbarLeave">

        <!-- 页签区：手机端 flex-1 与右侧图标按钮同行（消除独占一行的空档），sm 起固定宽度 -->
        <div v-if="loaded && (editing || pages.length > 1)"
          class="flex w-auto flex-1 sm:w-80 sm:flex-none shrink-0 items-center gap-1 min-w-0">
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
                class="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                title="重命名" aria-label="重命名本页">
                <span class="material-symbols-outlined text-base" aria-hidden="true">edit</span>
              </button>
              <button v-if="editing" @click="movePage(i, -1)" :disabled="i === 0"
                class="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-on-surface hover:bg-surface-alt transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                title="左移" aria-label="本页左移">
                <span class="material-symbols-outlined text-base" aria-hidden="true">chevron_left</span>
              </button>
              <button v-if="editing" @click="movePage(i, 1)" :disabled="i === pages.length - 1"
                class="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-on-surface hover:bg-surface-alt transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                title="右移" aria-label="本页右移">
                <span class="material-symbols-outlined text-base" aria-hidden="true">chevron_right</span>
              </button>
              <button v-if="editing" @click="removePage(i)" :disabled="pages.length <= 1"
                class="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-error hover:bg-error/10 transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                title="删除本页" aria-label="删除本页">
                <span class="material-symbols-outlined text-base" aria-hidden="true">close</span>
              </button>
            </div>
          </div>
          <button v-if="editing" @click="addPage"
            class="shrink-0 flex items-center gap-0.5 h-8 px-2 rounded-full text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            title="新增页" aria-label="新增页">
            <span class="material-symbols-outlined text-lg" aria-hidden="true">add</span>
            <span class="hidden sm:inline text-sm">新增页</span>
          </button>
        </div>

        <!-- 操作按钮：编辑态常显，非编辑态感应式自动隐藏（仅桌面端导航栏内）；
             键盘 Tab 进入本组按钮时（focus-within）强制显示，避免焦点落在不可见按钮上 -->
        <div v-if="!immersive && (editing || canEdit)"
          class="ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2 transition-opacity duration-300"
          :class="btnVisible ? 'opacity-100' : 'opacity-0 pointer-events-none focus-within:opacity-100 focus-within:pointer-events-auto'">
          <template v-if="editing">
            <!-- 触控规范：统一 44px 高度、圆角与按压反馈；导出/导入/排版为次级动作（浅底描边），完成为主色实心。
                 手机窄屏压缩为单行：导出/导入/重置仅图标（w-11 保持触控面积），sm 起恢复图标+文字；
                 智能排版/完成保留文字但收窄内边距，避免「完成」被挤到第二行 -->
            <button @click="onExport" class="inline-flex items-center justify-center h-11 w-11 sm:w-auto sm:px-3.5 rounded-xl bg-surface-alt border border-border text-muted hover:text-on-surface hover:border-primary/40 text-sm transition-all active:scale-95" title="把当前仪表盘导出为 JSON 文件">
              <span class="material-symbols-outlined text-lg" aria-hidden="true">download</span><span class="hidden sm:inline">导出</span>
            </button>
            <button @click="pickImportFile" class="inline-flex items-center justify-center h-11 w-11 sm:w-auto sm:px-3.5 rounded-xl bg-surface-alt border border-border text-muted hover:text-on-surface hover:border-primary/40 text-sm transition-all active:scale-95" title="从 JSON 文件导入仪表盘">
              <span class="material-symbols-outlined text-lg" aria-hidden="true">upload</span><span class="hidden sm:inline">导入</span>
            </button>
            <button @click="smartArrange" class="inline-flex items-center justify-center h-11 px-2 sm:px-3.5 rounded-xl bg-surface-alt border border-border text-muted hover:text-on-surface hover:border-primary/40 text-sm transition-all active:scale-95" title="按当前 HA 实体自动设计并摆放卡片">
              <span class="material-symbols-outlined text-lg" aria-hidden="true">auto_awesome_mosaic</span>智能排版
            </button>
            <button @click="resetLayout" class="inline-flex items-center justify-center h-11 w-11 sm:w-auto sm:px-3.5 rounded-xl bg-surface-alt border border-border text-muted hover:text-on-surface hover:border-error/40 hover:text-error text-sm transition-all active:scale-95" title="恢复默认仪表盘布局">
              <span class="material-symbols-outlined text-lg" aria-hidden="true">restart_alt</span><span class="hidden sm:inline">重置</span>
            </button>
            <button @click="saveLayout" class="inline-flex items-center justify-center h-11 px-2.5 sm:px-4 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold shadow-sm shadow-primary/25 transition-all active:scale-95">
              <span class="material-symbols-outlined text-lg" aria-hidden="true">check</span>完成
            </button>
          </template>
          <template v-else>
            <!-- 非编辑态：定位自动执行（onMounted 每会话一次），全屏用顶栏按钮，这里只留编辑入口 -->
            <button v-if="canEdit" @click="editing = true" class="inline-flex items-center justify-center h-11 px-4 rounded-xl bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-all active:scale-95" title="编辑仪表盘" aria-label="编辑仪表盘">
              <span class="material-symbols-outlined text-lg" aria-hidden="true">edit_square</span>
              <span class="hidden sm:inline">编辑仪表盘</span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 沉浸模式由全局浮动退出按钮接管（App.vue） -->

    <!-- 编辑态底部操作栏：点按卡片选中后在此统一操作（替代旧「每卡悬浮工具条」——
         悬浮条会遮挡卡片内容且在窄卡片上溢出截断）。所有按钮触控区 ≥44px，
         深浅主题跟随 token，底部避让安全区（iOS / 手势条）。 -->
    <div v-if="editing" class="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
      <!-- 添加卡片面板：从操作栏上方弹出，不占画布空间 -->
      <Transition name="hc-panel">
        <div v-if="addPanel" class="pointer-events-auto absolute bottom-full left-3 right-3 mx-auto max-w-[24rem] mb-2 bg-surface-alt border border-border rounded-2xl shadow-2xl p-3">
          <div class="flex items-center justify-between px-1 mb-2">
            <p class="text-muted text-xs font-body uppercase tracking-wider">添加卡片</p>
            <button @click="addPanel = false" class="w-9 h-9 -mr-1 flex items-center justify-center rounded-full text-muted hover:text-on-surface active:scale-90 transition-colors" title="收起" aria-label="收起添加面板">
              <span class="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <div class="max-h-[48vh] overflow-y-auto -mx-1 px-1 pb-1 hc-panel-scroll">
            <div v-for="g in addGroups" :key="g.name" class="mb-2.5">
              <p class="text-muted text-[11px] font-body mb-1.5">{{ g.name }}</p>
              <div class="flex flex-col gap-1.5">
                <button
                  v-for="opt in g.items"
                  :key="opt.type"
                  @click="addCard(opt)"
                  class="min-h-[44px] flex items-center gap-2.5 px-3 py-2 rounded-xl bg-surface border border-border hover:border-primary/50 hover:bg-primary/5 active:scale-[.98] transition-all text-sm text-on-surface text-left"
                >
                  <span class="material-symbols-outlined text-lg shrink-0" :class="opt.colorCls">{{ opt.icon }}</span>
                  <span class="min-w-0 flex-1 truncate">{{ opt.label }}</span>
                  <span class="material-symbols-outlined text-base text-primary shrink-0">add</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 操作栏主体：未选中显示「添加 + 引导提示」；选中后显示卡片名与操作按钮 -->
      <div class="pointer-events-auto mx-3 mb-3 rounded-2xl bg-surface-alt/95 backdrop-blur-md border border-border shadow-lg shadow-black/20"
        style="padding-bottom: env(safe-area-inset-bottom)">
        <div class="flex items-center gap-1.5 px-2 py-2">
          <!-- 添加卡片入口：常驻（选中态压缩为纯图标，给操作按钮让位） -->
          <button @click="addPanel = !addPanel"
            class="shrink-0 flex items-center gap-1 h-11 rounded-xl bg-primary/12 text-primary font-semibold active:scale-95 transition-all"
            :class="selectedCard ? 'w-11 justify-center' : 'px-3.5'"
            :aria-expanded="addPanel ? 'true' : 'false'"
            title="添加卡片" aria-label="添加卡片">
            <span class="material-symbols-outlined text-[22px]">{{ addPanel ? 'arrow_downward' : 'add' }}</span>
            <span v-if="!selectedCard" class="text-sm">添加卡片</span>
          </button>

          <!-- 未选中：操作引导 -->
          <p v-if="!selectedCard" class="min-w-0 flex-1 text-muted text-xs leading-snug pl-1">
            点按卡片选中进行编辑，按住卡片拖动可调整位置
          </p>

          <!-- 已选中：卡片名 + 分组操作 -->
          <template v-else>
            <div class="min-w-0 flex-1 flex items-center gap-2 pl-1.5">
              <span class="material-symbols-outlined text-lg text-primary shrink-0">{{ selectedMeta.icon }}</span>
              <span class="min-w-0 truncate text-sm text-on-surface font-medium">{{ selectedMeta.label }}</span>
              <span class="shrink-0 text-[11px] text-muted font-body tabular-nums">{{ selectedCard.w }}×{{ selectedCard.h }}</span>
            </div>
            <span class="w-px h-6 bg-border shrink-0 mx-0.5"></span>
            <button @click="moveCard(selectedCard, -1)" :disabled="isFirst(selectedCard)"
              class="w-11 h-11 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/10 active:scale-90 transition disabled:opacity-25 disabled:active:scale-100"
              title="前移" aria-label="卡片前移">
              <span class="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <button @click="moveCard(selectedCard, 1)" :disabled="isLast(selectedCard)"
              class="w-11 h-11 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/10 active:scale-90 transition disabled:opacity-25 disabled:active:scale-100"
              title="后移" aria-label="卡片后移">
              <span class="material-symbols-outlined text-[22px]">arrow_forward</span>
            </button>
            <button @click="openEditor(selectedCard)"
              class="w-11 h-11 flex items-center justify-center rounded-xl text-on-surface hover:bg-primary/15 active:scale-90 transition"
              title="编辑尺寸与代码" aria-label="编辑卡片">
              <span class="material-symbols-outlined text-[22px]">tune</span>
            </button>
            <button @click="removeCard(selectedCard)"
              class="w-11 h-11 flex items-center justify-center rounded-xl text-error hover:bg-error/12 active:scale-90 transition"
              title="删除卡片" aria-label="删除卡片">
              <span class="material-symbols-outlined text-[22px]">delete</span>
            </button>
            <button @click="selectedUid = ''"
              class="w-9 h-11 flex items-center justify-center rounded-xl text-muted hover:text-on-surface active:scale-90 transition"
              title="取消选中" aria-label="取消选中">
              <span class="material-symbols-outlined text-xl">close</span>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- 网格仪表盘：卡片从左向右排列，放不下的自动换到下一行；贴合视口不滚动
         加载完成（loaded）后才渲染，避免先闪现默认仪表盘 -->
    <div v-if="loaded" ref="gridEl" class="dashboard-grid" :class="{ 'hc-grid-editing': editing }" :style="gridStyle"
      @touchstart.passive="onSwipeStart" @touchend="onSwipeEnd">
      <div
        v-for="card in cards"
        :key="card.uid"
        class="hc-card-holder"
        :class="{
          'hc-card-editable': editing,
          'hc-card-dragging': dragCard === card,
          'hc-card-selected': editing && selectedUid === card.uid,
        }"
        :id="'card-' + card.uid"
        :data-type="card.type"
        :style="holderStyle(card)"
        @pointerdown="onCardPointerDown($event, card)"
        @contextmenu="onCardContextMenu"
        @click.capture="onHolderClickCapture"
      >
        <!-- 卡片实际内容：基准尺寸渲染 + zoom 等比缩放（窗口缩放不影响内部布局/换行） -->
        <div class="hc-card-zoom" :style="zoomStyle(card)">
          <CodeCard :card="card" :scope-id="'card-' + card.uid" @device-drawer="openDeviceDrawer" />
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
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, onUpdated, onActivated, nextTick } from 'vue'
import { ui, entityStates, entityList, registryDevices, loadRegistry, haTokenConfigured, haTokenKnown, auth, openDeviceDrawer, dashboardRev } from '@/store'
import { useEntities } from '@/composables/useLive'
import { useAutoHide } from '@/composables/useAutoHide'
import { mark, count, measure as perfMeasure } from '@/utils/perf'
import { saveKV, loadKV } from '@/utils/snapshotCache'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { isApk } from '@/utils/serverConfig'
import { syncCurrentLocation, locErrorMessage, trackingEnabled } from '@/utils/location'
import CodeCard from '@/components/cards/CodeCard.vue'
import CardEditor from '@/components/cards/CardEditor.vue'
import { cardDefaults } from '@/components/cards/defaults'
import { newCard, newPage, migrateDashboard, serializeDashboard, downloadDashboard, parseImportPayload, autoComposeHomepage, layoutKey } from '@/utils/dashboard'

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
// 添加卡片悬浮面板开关：收起为底部操作栏入口，展开为浮层面板（不占用画布纵向空间）
const addPanel = ref(false)
// 编辑态选中的卡片：底部操作栏针对该卡片操作（点按卡片选中/切换/取消，见 onCardPointerUp）
const selectedUid = ref('')
const selectedCard = computed(() => cards.value.find((c) => c.uid === selectedUid.value) || null)
const selectedMeta = computed(() => meta(selectedCard.value ? selectedCard.value.type : 'greeting'))
// 设备概览抽屉：Overview 卡片点击触发，携带点击格子的过滤条件（全局抽屉，见 App.vue）
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
  const rh = Math.min(3, card.h || 1)
  const z = zoomFactor.value
  // 用 transform:scale 而非 zoom：zoom 会触发同步重排，且与卡片的
  // container-type/content-visibility 组合在窄屏下产生反复失效重排（画面跳动）
  // holder 跨 cw 列/rh 行，其盒尺寸含轨道间距（cw*cellSize+(cw-1)*gap）；
  // zoom 盒缩放后必须恰好覆盖 holder，否则右侧/底部会残留空白条
  // （悬停空白条也触发 hover，阴影盒大于可见卡片，出现「宽高不是卡片边界」）
  return {
    transform: `scale(${z})`,
    width: cw * baseCell + (cw - 1) * gridGap / z + 'px',
    height: rh * baseCell + (rh - 1) * gridGap / z + 'px',
    display: 'flex',
    flexDirection: 'column',
    flex: 'none',
  }
}
const gridStyle = computed(() => ({
  // 卡片被 zoom 等比放大，1px 边框会被同步放大；按缩放系数反向补偿，
  // 使边框最终渲染厚度恒定 ≈1px（卡片外壳 border-width:var(--card-bw,1px)）
  '--card-bw': (1 / (zoomFactor.value || 1)).toFixed(3) + 'px',
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
    // 圆角对齐卡片壳视觉圆角（.hc 基础 14px × zoom 缩放）：holder 裁剪/悬停
    // 边界与卡片圆角曲线重合，避免角部被平切出弦线或留缝透出页面底色
    borderRadius: (14 * (zoomFactor.value || 1)).toFixed(2) + 'px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  }
}

// ---- 编辑态拖拽换位（手机桌面式：按住卡片拖动，实时让位，松手落位）----
const dragCard = ref(null)
let drag = null // { card, el, uid, grabX, grabY, startX, startY, active, moved }
let lastDragEnd = 0 // 最近一次拖动结束时刻：用于抑制随后的 click（自失效，不会泄漏）
function holderEl(card) { return document.getElementById('card-' + card.uid) }
let lastPointerType = ''
function onCardPointerDown(e, card) {
  lastPointerType = e.pointerType || ''
  onCardLongPressStart(e) // 非编辑态触屏：长按卡片进入编辑模式
  if (!editing.value || e.button !== 0) return
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  drag = {
    card, el, uid: card.uid,
    grabX: e.clientX - rect.left, grabY: e.clientY - rect.top,
    startX: e.clientX, startY: e.clientY,
    active: false, moved: false,
  }
  window.addEventListener('pointermove', onCardPointerMove)
  window.addEventListener('pointerup', onCardPointerUp)
  window.addEventListener('pointercancel', onCardPointerUp)
}
function onCardPointerMove(e) {
  if (!drag) return
  if (!drag.active) {
    // 超过阈值才进入拖拽，避免与点击/轻触混淆
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return
    drag.active = true
    dragCard.value = drag.card
  }
  e.preventDefault()
  drag.moved = true
  const grid = gridEl.value
  if (!grid) return
  const gridRect = grid.getBoundingClientRect()
  // offsetLeft/Top 为布局位置（不受 transform 影响），据此算出让拖拽块跟随指针的位移
  const baseLeft = gridRect.left + drag.el.offsetLeft
  const baseTop = gridRect.top + drag.el.offsetTop
  const tx = e.clientX - drag.grabX - baseLeft
  const ty = e.clientY - drag.grabY - baseTop
  drag.el.style.transform = `translate(${tx}px, ${ty}px) scale(1.04)`
  // 命中检测：指针落在哪张其它卡片上，就把拖拽卡实时移动到该位置
  const arr = cards.value
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i]
    if (c === drag.card) continue
    const el = holderEl(c)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const from = arr.indexOf(drag.card)
      if (from >= 0 && from !== i) {
        arr.splice(from, 1)
        arr.splice(i, 0, drag.card)
        // 换位后布局位置已变：按新位置立即重算位移，避免拖拽块跳一帧
        const nl = gridRect.left + drag.el.offsetLeft
        const nt = gridRect.top + drag.el.offsetTop
        drag.el.style.transform = `translate(${e.clientX - drag.grabX - nl}px, ${e.clientY - drag.grabY - nt}px) scale(1.04)`
      }
      break
    }
  }
}
function onCardPointerUp() {
  // 编辑态轻触（未拖动）：选中/切换/取消该卡片，操作交给底部操作栏（旧悬浮工具条会
  // 遮挡卡片内容且在窄卡片上溢出）。选中与拖拽由 6px 移动阈值区分，互不干扰。
  if (editing.value && drag && !drag.moved && !drag.active) {
    const uid = drag.uid
    selectedUid.value = selectedUid.value === uid ? '' : uid
    try { navigator.vibrate?.(12) } catch { /* 不支持则忽略 */ }
  }
  // 拖动过则记录时刻：随后派发的 click 会被抑制，避免松手时误触发卡片内部交互（开关等）
  if (drag && drag.moved) lastDragEnd = Date.now()
  if (drag?.el) drag.el.style.transform = ''
  drag = null
  dragCard.value = null
  window.removeEventListener('pointermove', onCardPointerMove)
  window.removeEventListener('pointerup', onCardPointerUp)
  window.removeEventListener('pointercancel', onCardPointerUp)
}
function onHolderClickCapture(e) {
  // 拖动结束 350ms 内的 click 视为拖拽副产物，吞掉一次
  if (Date.now() - lastDragEnd < 350) {
    e.preventDefault()
    e.stopPropagation()
  }
}
// ---- 手机端长按卡片进入编辑模式 ----
// 非编辑态下按住卡片 500ms 触发：震动反馈 + 提示引导；移动/松手即取消，
// 触发后吞掉随后的 click，避免长按误触发卡片内部交互（开关/滑条等）。
let lp = null // { timer, x, y, fired }
function onCardLongPressStart(e) {
  if (editing.value || e.pointerType !== 'touch') return
  clearLongPress()
  lp = { timer: 0, x: e.clientX, y: e.clientY, fired: false }
  lp.timer = setTimeout(() => {
    if (!lp) return
    lp.fired = true
    lastDragEnd = Date.now() // 吞掉随后派发的 click
    editing.value = true
    try { navigator.vibrate?.(30) } catch { /* 不支持则忽略 */ }
    toast('已进入编辑模式：按住卡片拖动可调整位置，点「完成」保存')
  }, 500)
  window.addEventListener('pointermove', onCardLongPressMove)
  window.addEventListener('pointerup', onCardLongPressEnd)
  window.addEventListener('pointercancel', onCardLongPressEnd)
}
function onCardLongPressMove(e) {
  // 手指移动超过 10px 视为滑动/滚动意图，取消长按
  if (lp && !lp.fired && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) clearLongPress()
}
function onCardLongPressEnd() { clearLongPress() }
function clearLongPress() {
  if (lp) clearTimeout(lp.timer)
  lp = null
  window.removeEventListener('pointermove', onCardLongPressMove)
  window.removeEventListener('pointerup', onCardLongPressEnd)
  window.removeEventListener('pointercancel', onCardLongPressEnd)
}
function onCardContextMenu(e) {
  // 触屏长按期间 / 编辑态拖拽时不弹系统右键菜单（与长按进编辑、拖拽冲突）；桌面右键不受影响
  if (lp || (editing.value && lastPointerType === 'touch')) e.preventDefault()
}
function updateCols() {
  if (!gridEl.value) return
  const w = gridEl.value.clientWidth
  // 手机窄屏按「物理宽度」定列数：不同厂商 DPR 策略不同（同为 6 寸屏 CSS 视口
  // 可能在 360~443px 间浮动，系统「显示大小」缩放也会改变 CSS 宽度），按 CSS
  // 宽度 ÷120 算列数会出现一台 3 列、一台 2 列的机型差异。物理宽度
  // （CSS 宽 × devicePixelRatio）只取决于屏幕面板（≈1200px），跨机型稳定：
  // ÷360 即等价于 CSS@3x 密度下 ÷120 的原口径。桌面宽屏维持 CSS 宽度口径
  // （现网桌面布局已按 8 列上限适配，不受影响）。
  const dpr = window.devicePixelRatio || 1
  const basis = w < 480 ? (w * dpr) / 3 : w
  cols.value = Math.max(1, Math.min(8, Math.floor(basis / 120)))
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
function removeCard(card) {
  const i = cards.value.indexOf(card)
  if (i < 0) return
  cards.value.splice(i, 1)
  // 移除的卡片若正处于选中态，同步取消选中（底部操作栏回到引导态）
  if (selectedUid.value === card.uid) selectedUid.value = ''
}
function moveCard(card, dir) {
  const i = cards.value.indexOf(card)
  const t = i + dir
  if (i < 0 || t < 0 || t >= cards.value.length) return
  const arr = cards.value
  ;[arr[i], arr[t]] = [arr[t], arr[i]]
}
const isFirst = (c) => cards.value.indexOf(c) === 0
const isLast = (c) => cards.value.indexOf(c) === cards.value.length - 1

// 双端独立布局：Web 端存 dashboard，手机端存 dashboard_apk，各自读写互不影响。
// 手机端自身键为空时回退读 dashboard（升级过渡：首启两端从同一布局起步）。
const DASH_KEY = layoutKey(isApk)
const LAYOUT_CACHE_KEY = isApk ? 'dashboard-layout-apk' : 'dashboard-layout-web'
const LEGACY_CACHE_KEY = 'dashboard-layout' // 升级前双端共用的旧缓存键，只读回退一次

// 解析并应用一份布局 JSON（后端权威值与本地缓存走同一条路径：迁移 → 应用）。
// 返回 { migrated } 表示应用成功，null 表示结构不可用。
function applyDashboardJson(json, mapJson) {
  let applied = null
  try {
    const r = migrateDashboard(JSON.parse(json))
    if (r && r.pages.length) {
      pages.value = r.pages
      currentPageIndex.value = 0
      applied = r
    }
  } catch { /* 结构损坏：忽略 */ }
  if (mapJson) {
    try { cfg.map_config = JSON.parse(mapJson) } catch { cfg.map_config = null }
  }
  return applied
}

function cacheLayout(dashboardJson, mapJson) {
  saveKV(LAYOUT_CACHE_KEY, { at: Date.now(), dashboard: dashboardJson, map_config: mapJson || '' })
    .catch(() => { /* 配额/隐私模式：忽略 */ })
}

async function loadLayout() {
  // 布局请求先发出去，再读本地缓存——两条线并行，缓存读取不会推迟网络请求
  const prefsPromise = getPrefs().catch(() => null)
  // 1) 本地缓存布局：先出画面，不等 /prefs 往返（与实体快照同一策略）。
  //    本端缓存为空时读一次升级前的旧共享缓存（随后会写入本端新键）。
  //    这一步决定「网格就绪」的时刻——原先它必须等布局请求回来才开始渲染。
  let cached = await loadKV(LAYOUT_CACHE_KEY).catch(() => null)
  if (!cached?.dashboard) {
    const legacy = await loadKV(LEGACY_CACHE_KEY).catch(() => null)
    if (legacy?.dashboard) cached = legacy
  }
  if (cached?.dashboard && !pages.value.length) {
    if (applyDashboardJson(cached.dashboard, cached.map_config)) mark('boot:layoutCached')
  }
  // 2) 后端权威值：到达后覆盖（正在编辑时不覆盖，避免打断操作）
  const res = await prefsPromise
  const data = res?.data || {}
  // 本端布局键优先；手机端为空时回退旧共享键 dashboard（升级后首次打开）
  let dash = data[DASH_KEY] || ''
  if (!dash && isApk) dash = data.dashboard || ''
  const mapJson = data.map_config || ''
  let has = false
  let migrated = false
  if (dash && !editing.value) {
    const r = applyDashboardJson(dash, mapJson)
    if (r) { has = true; migrated = r.migrated }
  }
  // 后端没有布局且本地也没有（首次使用）：填充默认仪表盘；加载完成前不渲染，避免闪现
  if (!has && !pages.value.length) { pages.value = [defaultPage()]; currentPageIndex.value = 0 }
  loaded.value = true
  // 后端确有布局：落一份本地缓存，供下次打开即时绘制
  if (has) cacheLayout(dash, mapJson)
  // 旧结构迁移后落库一次到本端键（只在确实迁移过时写，避免与「完成」保存竞争）
  if (migrated) putPrefs({ [DASH_KEY]: serializeDashboard(pages.value) }).catch(() => {})
}
async function saveLayout() {
  const json = serializeDashboard(pages.value)
  lastLocalSave = Date.now() // 本端刚保存：抑制随后服务端广播触发的重载，避免打断当前界面
  try {
    await putPrefs({ [DASH_KEY]: json })
    cacheLayout(json)
    editing.value = false
  } catch { /* 静默 */ }
}
// 重置为默认仪表盘：必须立即落库，否则刷新后又从后端读到旧布局
async function resetLayout() {
  pages.value = [defaultPage()]
  currentPageIndex.value = 0
  editing.value = false
  const json = serializeDashboard(pages.value)
  lastLocalSave = Date.now()
  try {
    await putPrefs({ [DASH_KEY]: json })
    cacheLayout(json)
  } catch { /* 离线：仅本次重置生效 */ }
}

// ---- 跨端热刷新：本人在其它设备保存/接受分享仪表盘后，这里自动重载 ----
// 刚在本地保存（4s 内）或正在编辑时忽略广播，避免打断当前操作；
// 广播按布局键过滤（store 层已保证只有本端键变更才递增 dashboardRev）
let lastLocalSave = 0
watch(dashboardRev, () => {
  if (editing.value || Date.now() - lastLocalSave < 4000) return
  loadLayout() // 服务端权威值覆盖本地（含缓存落盘），与首启同一条路径
})

// 智能排版：用当前真实实体自动设计当前页（不直接落库，用户点「完成」才保存）
const arranging = ref(false)
async function smartArrange() {
  if (!entityList.value.length) { toast('暂未读取到实体，请先连接 Home Assistant', true); return }
  if (arranging.value) return
  arranging.value = true
  try {
    // 拉取设备注册表（物理设备 → 实体归属），失败则退化为无设备聚合（仅质量筛选）
    let devices = registryDevices.value
    if (!devices.length) {
      try { devices = (await loadRegistry(true)) || [] } catch { devices = [] }
    }
    const { page, stats } = autoComposeHomepage(entityList.value, devices)
    const cur = pages.value[currentPageIndex.value]
    if (cur) cur.cards = page.cards
    else { pages.value.push(page); currentPageIndex.value = pages.value.length - 1 }
    nextTick(measure)
    // 反馈：聚合了多少设备卡 + 质量筛选剔除明细
    const reasonName = { unavailable: '不可用', domain: '内部实体', hidden: '已隐藏', diagnostic: '诊断信息', offline: '离线', duplicate: '重复', stale: '长期失联' }
    const parts = Object.entries(stats.rejected)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${reasonName[k] || k} ${n}`)
    const tail = parts.length ? `；剔除：${parts.join('、')}` : ''
    toast(`智能编排：${stats.total} 个可用实体聚合为 ${stats.devices} 张设备卡片${tail}，点「完成」保存`)
  } catch (e) {
    toast('智能排版失败：' + (e?.message || '未知错误'), true)
  } finally {
    arranging.value = false
  }
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
    const json = serializeDashboard(pages.value)
    lastLocalSave = Date.now() // 抑制本端广播触发的重载
    await putPrefs({ [DASH_KEY]: json })
    cacheLayout(json)
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
const TOAST_MS = 6000 // 悬浮抽屉展示时长：到期自动收起隐藏
function toast(msg, err = false) {
  locMsg.value = msg; locErr.value = err
  if (locToastTimer) clearTimeout(locToastTimer)
  locToastTimer = setTimeout(() => (locMsg.value = ''), TOAST_MS)
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
    if (!silent) toast(locErrorMessage(e), true)
  } finally { locating.value = false }
}

// 沉浸/全屏模式：进入由顶栏全屏按钮（App.vue toggleFullscreen）负责，这里只跟随状态
const immersive = computed(() => ui.immersive)
function onFsChange() { if (!document.fullscreenElement) ui.immersive = false }

// 顶部工具条落位：桌面端（≥768px，与导航栏的 hidden md:flex 同断点）Teleport 进导航栏右侧槽位；
// 窄屏时导航栏不渲染、沉浸模式下导航栏整体折叠，两种情况都回落为原地渲染，自动隐藏行为不变。
// 初始值同步取一次，避免首帧先原地渲染再跳进导航栏。
const isDesktop = ref(window.matchMedia('(min-width: 768px)').matches)
let mqDesktop = null
function onMqDesktop(e) { isDesktop.value = e.matches }
const teleportToNav = computed(() => isDesktop.value && !ui.immersive)
// 原地渲染（窄屏/沉浸回落）时按钮常显：触屏没有 hover 感应，「隐藏」只是 opacity-0
// 仍占布局，会在顶栏与卡片之间撑出一条空白；桌面端整条 Teleport 进导航栏，保留感应隐藏。
const btnVisible = computed(() => !teleportToNav.value || editing.value || toolbarShow.value)

// 手机与平板（<1024px）禁用仪表盘编辑：触屏拖拽排版体验差，且窄屏下编辑工具条
// 回落布局拥挤错位。桌面缩窗到平板宽度同样禁用，与响应式断点语义一致；
// 断点跨越时强制退出编辑态，避免残留编辑 UI（FAB/编辑页签等均由 editing 门控）。
const canEdit = ref(window.matchMedia('(min-width: 1024px)').matches)
let mqCanEdit = null
function onMqCanEdit(e) {
  canEdit.value = e.matches
  if (!e.matches) { editing.value = false; addPanel.value = false }
}

// 沉浸/编辑状态改变会改变网格可用高度，重新测量
watch(() => ui.immersive, () => nextTick(measure))
watch(() => editing.value, () => {
  if (!editing.value) { addPanel.value = false; selectedUid.value = '' } // 退出编辑同步清掉面板与选中态
  nextTick(measure)
})

// ---- 性能基准：首屏网格就绪时刻 + 本组件重渲染次数（与卡片重渲染次数对比可看出扇出规模）----
watch(loaded, (v) => {
  if (!v) return
  nextTick(() => { mark('boot:gridReady'); perfMeasure('boot:gridReady', 'boot:js') })
})
onUpdated(() => count('ui:homeUpdate'))

// 首次进入确保实体已加载
const { ensureLoaded } = useEntities()

onMounted(async () => {
  ensureLoaded()
  await loadLayout()
  await nextTick()
  measure()
  // resize 用 rAF 合帧：devtools 拖拽手机视口/旋转屏幕时连续 resize 事件
  // 每次都全网格重测重排，节流到每帧一次避免抖动
  window.addEventListener('resize', onResize)
  document.addEventListener('fullscreenchange', onFsChange)
  mqDesktop = window.matchMedia('(min-width: 768px)')
  isDesktop.value = mqDesktop.matches
  mqDesktop.addEventListener('change', onMqDesktop)
  mqCanEdit = window.matchMedia('(min-width: 1024px)')
  canEdit.value = mqCanEdit.matches
  mqCanEdit.addEventListener('change', onMqCanEdit)
  // 自动定位：每会话一次；受「设备追踪开关」控制（APK 默认开、网页端默认关），
  // 关闭时不自动上报（手动点同步位置按钮仍可用）
  if (autoLocateRan()) {
    markAutoLocateRan()
    if (trackingEnabled()) {
      toast('正在自动定位，请允许浏览器位置授权…')
      locate(false)
    }
  }
})

// keep-alive 缓存本页（App.vue include="HomeView"）：切回时 DOM 被重新插入，
// 视口可能在缓存期间变化（旋转/缩放），重新测量网格；隐藏期间 resize 事件仍会
// 到达但 clientWidth 为 0，测量无意义且会写入错误的 cols，直接跳过。
defineOptions({ name: 'HomeView' })
onActivated(() => { nextTick(measure) })
let measurePending = false
function onResize() {
  if (measurePending) return
  const el = gridEl.value
  if (!el || el.clientWidth === 0) return // 页面被 keep-alive 缓存（隐藏）时不测量
  measurePending = true
  requestAnimationFrame(() => { measurePending = false; measure() })
}
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('fullscreenchange', onFsChange)
  if (mqDesktop) mqDesktop.removeEventListener('change', onMqDesktop)
  if (mqCanEdit) mqCanEdit.removeEventListener('change', onMqCanEdit)
  clearLongPress() // 长按手势进行中卸载：摘掉 window 级监听
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
  position: relative; /* 拖拽时作为卡片 offsetLeft/Top 的定位参照 */
  display: grid;
  gap: 12px;
  overflow: hidden;
  align-content: start;
}
.hc-card-holder {
  position: relative;
  /* 不设 overflow:hidden：卡片壳自带贴边柔和落影，在此裁剪会把阴影在卡片边界
     外硬切成一条暗带，与 1px 边框叠成「双线」观感；内容裁剪由卡片壳自身
     （.hc{overflow:hidden}）负责，holder 无需重复裁剪 */
  container-type: inline-size;
  /* 圆角由 holderStyle 按缩放系数动态对齐卡片壳视觉圆角（14px×zoom）：
     固定 16px 在缩放后要么平切卡片圆角（z>1，角部出弦线）、要么留缝透底色 */
  border-radius: 14px;
  -webkit-touch-callout: none; /* 触屏长按不弹系统预览菜单（长按进编辑模式的交互依赖） */
  /* 保留 transform 过渡：编辑模式拖拽换位时其余卡片让位仍靠它平滑动画 */
  transition: transform .16s ease, box-shadow .16s ease;
}
/* 卡片悬停不做任何效果（按需求移除微抬升/阴影） */
/* 编辑态：卡片可拖拽换位（手机桌面式）。禁用文字选中与触摸滚动，避免拖拽误操作 */
.hc-card-editable {
  cursor: grab;
  user-select: none;
  touch-action: none;
}
/* 拖拽中的卡片：抬起效果 + 即时跟随指针（关闭过渡）；
   其余卡片让位时仍走 holder 的 transform 过渡，形成平滑换位动画 */
.hc-card-dragging {
  z-index: 40;
  cursor: grabbing;
  transition: none !important;
  box-shadow: 0 18px 44px -8px rgb(0 0 0 / .45) !important;
}
/* 编辑态选中卡片：主色描边 + 轻微抬升，与底部操作栏联动（tap 选中 / 取消）。
   用 outline 而非 box-shadow，避免与拖拽阴影互相覆盖 */
.hc-card-selected {
  outline: 2px solid rgb(var(--c-primary) / .9);
  outline-offset: -2px;
  z-index: 5;
}
/* 编辑态网格底部预留操作栏空间：滚动到最底部时最后一排卡片不被操作栏遮挡 */
.dashboard-grid.hc-grid-editing {
  padding-bottom: 96px;
}
/* 卡片过多时跳过视口外卡片的布局与绘制（滚入视口才渲染，滚出即回收渲染开销）。
   地图卡除外：其内部按容器尺寸测量定位，初始隐藏会导致尺寸为 0 */
.hc-card-holder:not([data-type="map"]) {
  content-visibility: auto;
  contain-intrinsic-size: auto 150px;
}
.hc-card-zoom {
  position: relative;
  flex: none;
  transform-origin: top left;
}
/* 添加卡片面板展开/收起动画 */
.hc-panel-enter-active { transition: opacity .16s ease, transform .16s cubic-bezier(.2,.8,.2,1); }
.hc-panel-leave-active { transition: opacity .12s ease, transform .12s ease; }
.hc-panel-enter-from, .hc-panel-leave-to { opacity: 0; transform: translateY(6px) scale(.98); }
/* 添加卡片面板列表滚动条：细样式跟随主题边框色 */
.hc-panel-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--c-border) / .5) transparent;
  -webkit-overflow-scrolling: touch;
}
.hc-panel-scroll::-webkit-scrollbar { width: 4px; }
.hc-panel-scroll::-webkit-scrollbar-thumb { border-radius: 2px; background: rgb(var(--c-border) / .4); }
.hc-panel-scroll::-webkit-scrollbar-track { background: transparent; }

/* 位置同步 Toast 悬浮抽屉：弹出自页头下缘滑入（带轻微上浮回落），收起反向淡出上移 */
.hc-drawer-enter-active { transition: opacity .28s ease-out, transform .28s cubic-bezier(.21, 1.02, .73, 1); }
.hc-drawer-leave-active { transition: opacity .22s ease-in, transform .22s ease-in; }
.hc-drawer-enter-from, .hc-drawer-leave-to { opacity: 0; transform: translateY(-16px); }

</style>

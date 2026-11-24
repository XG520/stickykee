<template>
  <div class="space-y-4 md:space-y-5 py-2 pb-20 md:pb-2">
    <h1 class="sr-only">生活</h1>

    <!-- 页面头部：移动端纵向堆叠，桌面端标题与页签同一行 -->
    <header class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 text-sm font-body text-muted">
          <span class="text-on-background font-medium">生活</span>
          <span class="mx-1.5 text-faint">·</span>
          <span>家里的物品、采购与开销</span>
        </div>
        <span class="md:hidden shrink-0 text-[11px] text-muted font-body">{{ locations.length }} 个位置</span>
      </div>

      <div class="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-surface-alt border border-border md:inline-grid md:min-w-[336px]">
        <button
          class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-body transition-colors"
          :class="activeTab === 'stock' ? 'bg-surface text-primary shadow-sm border border-border' : 'text-muted hover:text-on-surface'"
          @click="activeTab = 'stock'"
        >
          <span class="material-symbols-outlined hidden sm:inline-flex text-base">inventory_2</span>库存
        </button>
        <button
          class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-body transition-colors"
          :class="activeTab === 'shopping' ? 'bg-surface text-primary shadow-sm border border-border' : 'text-muted hover:text-on-surface'"
          @click="activeTab = 'shopping'"
        >
          <span class="material-symbols-outlined hidden sm:inline-flex text-base">shopping_cart</span>购物清单
        </button>
        <button
          class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-body transition-colors"
          :class="activeTab === 'finance' ? 'bg-surface text-primary shadow-sm border border-border' : 'text-muted hover:text-on-surface'"
          @click="activeTab = 'finance'"
        >
          <span class="material-symbols-outlined hidden sm:inline-flex text-base">account_balance_wallet</span>账本
        </button>
      </div>
    </header>

    <template v-if="activeTab === 'stock'">
    <!-- 位置筛选 -->
    <div class="flex items-center gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: none">
      <button
        class="px-3 py-1.5 rounded-full text-xs font-body border whitespace-nowrap shrink-0"
        :class="selectedLocation === 0 ? 'bg-primary text-white border-primary' : 'bg-surface-alt text-muted border-border'"
        @click="selectLocation(0)"
      >全部</button>
      <button
        v-for="l in locations"
        :key="l.id"
        class="px-3 py-1.5 rounded-full text-xs font-body border whitespace-nowrap shrink-0"
        :class="selectedLocation === l.id ? 'bg-primary text-white border-primary' : 'bg-surface-alt text-muted border-border'"
        @click="selectLocation(l.id)"
      >{{ l.name }}</button>
      <button
        class="shrink-0 flex items-center gap-0.5 px-2.5 py-1.5 rounded-full text-xs font-body border border-dashed border-border text-muted hover:text-on-surface"
        title="管理位置"
        @click="locManager = true"
      >
        <span class="material-symbols-outlined text-base">tune</span>
      </button>
    </div>

    <!-- 搜索 + 添加 -->
    <div class="flex items-center gap-2">
      <div class="relative flex-1 min-w-0">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted text-lg pointer-events-none">search</span>
        <input
          v-model="query"
          placeholder="搜索名称 / 条码"
          class="w-full pl-9 pr-8 py-2 rounded-xl bg-surface border border-border text-sm font-body text-on-background placeholder:text-faint outline-none focus:border-primary transition-colors"
          @input="onQueryInput"
        />
        <button
          v-if="query"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-on-surface"
          aria-label="清除搜索"
          @click="clearQuery"
        >
          <span class="material-symbols-outlined text-base">close</span>
        </button>
      </div>
      <button
        class="shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-xl bg-primary text-white text-sm font-body"
        @click="openCreate"
      >
        <span class="material-symbols-outlined text-base">add</span>添加
      </button>
    </div>

    <!-- 快捷操作 -->
    <div class="flex items-center gap-2 overflow-x-auto pb-0.5" style="scrollbar-width: none">
      <button
        class="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-alt border border-border text-xs font-body text-muted hover:text-on-surface"
        @click="openStocktake"
      >
        <span class="material-symbols-outlined text-base">fact_check</span>盘点
      </button>
      <button
        class="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-alt border border-border text-xs font-body text-muted hover:text-on-surface"
        @click="exportCsv"
      >
        <span class="material-symbols-outlined text-base">download</span>导出
      </button>
      <button
        class="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-alt border border-border text-xs font-body text-muted hover:text-on-surface"
        @click="scanBarcode"
      >
        <span class="material-symbols-outlined text-base">qr_code_scanner</span>扫码
      </button>
      <label
        class="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full bg-surface-alt border border-border text-xs font-body text-muted cursor-pointer hover:text-on-surface"
      >
        <span class="material-symbols-outlined text-base">photo_camera</span>拍照
        <input type="file" accept="image/*" capture="environment" class="hidden" @change="onPickImage" />
      </label>
    </div>

    <!-- 概览 -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-2.5 md:gap-3">
      <div class="col-span-2 md:col-span-1 bg-surface border border-border rounded-2xl px-4 py-3.5">
        <div class="text-[11px] text-muted font-body">在库总数</div>
        <div class="mt-1 font-headline text-2xl md:text-xl font-semibold tabular-nums">{{ fmt(stats.total) }}</div>
      </div>
      <div class="bg-surface border border-border rounded-2xl px-4 py-3.5">
        <div class="text-[11px] text-muted font-body">库存价值</div>
        <div class="mt-1 font-headline text-xl font-semibold tabular-nums">{{ fmt(stats.total_value) }}</div>
      </div>
      <div class="bg-surface border border-border rounded-2xl px-4 py-3.5">
        <div class="text-[11px] text-muted font-body">临期</div>
        <div class="mt-1 font-headline text-xl font-semibold tabular-nums text-error">{{ stats.expiring || 0 }}</div>
      </div>
      <div class="bg-surface border border-border rounded-2xl px-4 py-3.5">
        <div class="text-[11px] text-muted font-body">已过期</div>
        <div class="mt-1 font-headline text-xl font-semibold tabular-nums text-error">{{ stats.expired || 0 }}</div>
      </div>
      <div class="bg-surface border border-border rounded-2xl px-4 py-3.5">
        <div class="text-[11px] text-muted font-body">需补货</div>
        <div class="mt-1 font-headline text-xl font-semibold tabular-nums text-primary">{{ stats.low_stock || 0 }}</div>
      </div>
    </div>

    <!-- 筛选 + 结果数 -->
    <div class="flex items-center gap-2 text-xs font-body">
      <button
        class="px-3 py-1 rounded-full border"
        :class="expiringOnly ? 'bg-error/10 text-error border-error/30' : 'bg-surface-alt text-muted border-border'"
        @click="toggleExpiring"
      >仅看临期</button>
      <button
        class="px-3 py-1 rounded-full border"
        :class="lowStockOnly ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface-alt text-muted border-border'"
        @click="toggleLowStock"
      >仅看需补货</button>
      <span class="ml-auto whitespace-nowrap text-muted">{{ items.length }} 件</span>
    </div>
    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 列表 -->
    <div v-if="items.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
      <article
        v-for="it in items"
        :key="it.id"
        class="group relative bg-surface border rounded-2xl p-4 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
        :class="it.low_stock ? 'border-error/40' : 'border-border hover:border-primary/40'"
        @click="openDetail(it)"
      >
        <span v-if="it.low_stock" class="absolute left-0 top-4 bottom-4 w-0.5 rounded-full bg-error/60"></span>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-headline font-semibold text-[15px] truncate text-on-background">{{ it.name }}</div>
            <div class="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-alt text-muted font-body">{{ it.category || '未分类' }}</span>
              <span v-if="it.low_stock" class="text-[10px] px-1.5 py-0.5 rounded-full bg-error/10 text-error font-body">需补货</span>
            </div>
          </div>
          <div class="text-right shrink-0">
            <div class="font-headline text-xl font-semibold leading-none tabular-nums">
              {{ fmt(it.total_quantity) }}<span class="text-[11px] text-muted font-body ml-0.5">{{ it.unit }}</span>
            </div>
          </div>
        </div>
        <div class="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2 text-xs font-body">
          <span :class="expiryView(it.nearest_expiry).cls">{{ expiryView(it.nearest_expiry).text }}</span>
          <span class="text-muted truncate flex items-center gap-0.5 min-w-0">
            <span class="material-symbols-outlined text-sm">place</span>{{ locationText(it) }}
          </span>
        </div>
      </article>
    </div>
    <div v-else class="py-14 text-center">
      <div class="w-12 h-12 mx-auto rounded-full bg-surface-alt flex items-center justify-center text-muted">
        <span class="material-symbols-outlined">inventory_2</span>
      </div>
      <p class="mt-3 text-sm text-muted font-body">{{ loading ? '加载中…' : '还没有记录物品' }}</p>
      <button
        v-if="!loading"
        class="mt-3 px-4 py-2 rounded-xl bg-primary text-white text-xs font-body"
        @click="openCreate"
      >添加第一件物品</button>
    </div>
    </template>

    <ShoppingListView v-else-if="activeTab === 'shopping'" @changed="refresh" />

    <FinanceHome v-else />

    <!-- 物品详情 -->
    <div
      v-if="detailItem"
      class="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      @click.self="detailItem = null"
    >
      <div class="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
        <div class="flex items-start justify-between">
          <div>
            <h3 class="font-headline text-lg font-semibold">{{ detailItem.name }}</h3>
            <div class="text-xs text-muted font-body mt-0.5">
              {{ detailItem.category || '未分类' }} · {{ fmt(detailItem.total_quantity) }} {{ detailItem.unit }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button class="text-muted hover:text-primary" @click="openEdit(detailItem)">
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button class="text-muted hover:text-primary" title="加入购物清单" @click="toShopping(detailItem)">
              <span class="material-symbols-outlined">add_shopping_cart</span>
            </button>
            <button class="text-muted hover:text-error" @click="removeItem(detailItem)">
              <span class="material-symbols-outlined">delete</span>
            </button>
            <button class="text-muted hover:text-on-surface" @click="detailItem = null">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div class="text-xs font-medium text-muted font-body">在库批次</div>
        <div v-if="detailItem.batches && detailItem.batches.length" class="space-y-2">
          <div v-for="b in detailItem.batches" :key="b.id" class="rounded-xl border border-border p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium">{{ b.location_name || '未指定位置' }}</span>
              <span>{{ fmt(b.quantity) }} {{ detailItem.unit }}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span :class="expiryView(b.expiry_date).cls">{{ expiryView(b.expiry_date).text }}</span>
              <span v-if="b.opened" class="text-primary">已开封</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <button class="px-2 py-1 rounded-md border border-border text-xs text-muted hover:text-primary" @click="consume(b, 1)">消耗 1</button>
              <button class="px-2 py-1 rounded-md border border-border text-xs text-muted hover:text-primary" @click="consume(b, 0)">全部消耗</button>
              <button v-if="!b.opened" class="px-2 py-1 rounded-md border border-border text-xs text-muted hover:text-primary" @click="openBatch(b)">开封</button>
              <button class="px-2 py-1 rounded-md border border-border text-xs text-muted hover:text-error" @click="discard(b)">丢弃</button>
              <select
                class="px-2 py-1 rounded-md border border-border text-xs bg-surface-alt text-on-surface"
                @change="moveBatch(b, $event)"
              >
                <option value="">移库到…</option>
                <option
                  v-for="l in locations"
                  :key="l.id"
                  :value="l.id"
                  :disabled="l.id === b.location_id"
                >{{ l.name }}</option>
              </select>
            </div>
          </div>
        </div>
        <div v-else class="text-xs text-muted font-body py-3">暂无在库批次，可在编辑中补充。</div>
      </div>
    </div>

    <!-- 位置管理 -->
    <div
      v-if="locManager"
      class="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/50"
      @click.self="locManager = false"
    >
      <div class="w-full max-w-md bg-surface border border-border rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-headline text-lg font-semibold">管理位置</h3>
          <button class="text-muted hover:text-on-surface" @click="locManager = false">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="space-y-2 max-h-56 overflow-y-auto">
          <div v-for="l in locations" :key="l.id" class="flex items-center justify-between text-sm">
            <span>{{ l.name }}<span class="text-xs text-muted ml-2">{{ kindLabel(l.kind) }}</span></span>
            <button class="text-muted hover:text-error text-xs" @click="delLocation(l)">删除</button>
          </div>
          <div v-if="!locations.length" class="text-xs text-muted">还没有位置，先添加一个吧。</div>
        </div>
        <div class="flex items-center gap-2">
          <input
            v-model="newLocName"
            placeholder="新位置名称"
            class="flex-1 px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
          />
          <select v-model="newLocKind" class="px-2 py-2 rounded-lg bg-surface-alt border border-border text-sm">
            <option value="fridge">冷藏</option>
            <option value="freezer">冷冻</option>
            <option value="pantry">常温</option>
            <option value="medicine">药箱</option>
            <option value="other">其他</option>
          </select>
          <button class="px-3 py-2 rounded-lg bg-primary text-white text-sm" @click="addLocation">添加</button>
        </div>
        <div v-if="locError" class="text-xs text-error">{{ locError }}</div>
      </div>
    </div>

    <!-- 盘点 -->
    <div
      v-if="stocktakeOpen"
      class="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/50"
      @click.self="stocktakeOpen = false"
    >
      <div class="w-full max-w-lg max-h-[85vh] flex flex-col bg-surface border border-border rounded-2xl p-5 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-headline text-lg font-semibold">盘点</h3>
          <button class="text-muted hover:text-on-surface" @click="stocktakeOpen = false">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="text-xs text-muted font-body">填写实际数量，提交后自动生成调整流水。</div>
        <div class="flex-1 overflow-y-auto space-y-2 min-h-0">
          <div v-for="row in stocktakeRows" :key="row.key" class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ row.name }}</div>
              <div class="text-[10px] text-muted">{{ row.locationName }}</div>
            </div>
            <input
              v-model.number="row.quantity"
              type="number"
              step="0.01"
              min="0"
              class="w-20 px-2 py-1 rounded-md bg-surface-alt border border-border text-sm text-right outline-none focus:border-primary"
            />
            <span class="text-xs text-muted w-8">{{ row.unit }}</span>
          </div>
          <div v-if="!stocktakeRows.length" class="text-xs text-muted">没有可盘点的物品</div>
        </div>
        <div v-if="stocktakeError" class="text-xs text-error">{{ stocktakeError }}</div>
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-lg text-sm text-muted border border-border" @click="stocktakeOpen = false">取消</button>
          <button
            class="px-4 py-2 rounded-lg text-sm bg-primary text-white disabled:opacity-50"
            :disabled="stocktakeSaving"
            @click="submitStocktake"
          >{{ stocktakeSaving ? '提交中…' : '提交盘点' }}</button>
        </div>
      </div>
    </div>

    <ItemEditorDialog
      v-model="editorOpen"
      :item="editingItem"
      :locations="locations"
      :initial-barcode="initialBarcode"
      :initial="initialItem"
      :barcode-state="barcodeState"
      @saved="refresh"
    />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '@/api'
import ItemEditorDialog from '@/components/inventory/ItemEditorDialog.vue'
import ShoppingListView from '@/components/inventory/ShoppingListView.vue'
import FinanceHome from '@/components/finance/FinanceHome.vue'

const locations = ref([])
const items = ref([])
const stats = ref({})
const selectedLocation = ref(0)
const query = ref('')
const expiringOnly = ref(false)
const lowStockOnly = ref(false)
const loading = ref(false)
const error = ref('')

const activeTab = ref('stock')
const detailItem = ref(null)
const editorOpen = ref(false)
const editingItem = ref(null)
const initialBarcode = ref('')
const initialItem = ref(null)
const barcodeState = ref('')

const stocktakeOpen = ref(false)
const stocktakeRows = ref([])
const stocktakeSaving = ref(false)
const stocktakeError = ref('')

const locManager = ref(false)
const newLocName = ref('')
const newLocKind = ref('fridge')
const locError = ref('')

let queryTimer = null

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function daysLeft(dateStr) {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  return Math.round((d - today) / 86400000)
}

function expiryView(dateStr) {
  const n = daysLeft(dateStr)
  if (n === null) return { text: '无保质期', cls: 'text-muted' }
  if (n < 0) return { text: `已过期 ${-n} 天`, cls: 'text-error' }
  if (n === 0) return { text: '今天到期', cls: 'text-error' }
  if (n <= 3) return { text: `${n} 天后到期`, cls: 'text-error' }
  if (n <= 7) return { text: `${n} 天后到期`, cls: 'text-primary' }
  return { text: `${dateStr} 到期`, cls: 'text-muted' }
}

function locationText(it) {
  const names = [...new Set((it.batches || []).map((b) => b.location_name).filter(Boolean))]
  return names.length ? names.join(' / ') : '未入库'
}

function kindLabel(kind) {
  return { fridge: '冷藏', freezer: '冷冻', pantry: '常温', medicine: '药箱', other: '其他' }[kind] || '其他'
}

async function loadStats() {
  try {
    const res = await api.inventoryStats(3)
    stats.value = res.data || {}
  } catch (e) {
    error.value = e.message || ''
  }
}

async function loadItems() {
  error.value = ''
  const q = {}
  if (selectedLocation.value) q.location = selectedLocation.value
  if (query.value.trim()) q.q = query.value.trim()
  if (expiringOnly.value) q.expiring_days = 3
  if (lowStockOnly.value) q.low_stock = 1
  try {
    const res = await api.inventoryItems(q)
    items.value = res.data || []
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

async function loadAll() {
  loading.value = true
  try {
    const res = await api.inventoryLocations()
    locations.value = res.data || []
  } catch (e) {
    error.value = e.message || ''
  }
  await Promise.all([loadStats(), loadItems()])
  loading.value = false
}

async function refresh() {
  await loadAll()
}

function onQueryInput() {
  clearTimeout(queryTimer)
  queryTimer = setTimeout(loadItems, 300)
}

function clearQuery() {
  query.value = ''
  loadItems()
}

function selectLocation(id) {
  selectedLocation.value = id
  loadItems()
}

function toggleExpiring() {
  expiringOnly.value = !expiringOnly.value
  loadItems()
}

function toggleLowStock() {
  lowStockOnly.value = !lowStockOnly.value
  loadItems()
}

function openCreate() {
  editingItem.value = null
  initialBarcode.value = ''
  initialItem.value = null
  barcodeState.value = ''
  editorOpen.value = true
}

function openEdit(it) {
  editingItem.value = it
  barcodeState.value = ''
  editorOpen.value = true
}

async function openDetail(it) {
  try {
    const res = await api.inventoryItem(it.id)
    detailItem.value = res.data
  } catch (e) {
    error.value = e.message || ''
  }
}

async function afterBatch() {
  if (detailItem.value) {
    try {
      const res = await api.inventoryItem(detailItem.value.id)
      detailItem.value = res.data
    } catch (e) {
      error.value = e.message || ''
    }
  }
  await Promise.all([loadStats(), loadItems()])
}

async function consume(batch, qty) {
  try {
    await api.consumeInventoryBatch(batch.id, qty)
    await afterBatch()
  } catch (e) {
    error.value = e.message || ''
  }
}

async function openBatch(batch) {
  try {
    await api.openInventoryBatch(batch.id)
    await afterBatch()
  } catch (e) {
    error.value = e.message || ''
  }
}

async function discard(batch) {
  if (!window.confirm('确认丢弃这个批次？')) return
  try {
    await api.discardInventoryBatch(batch.id)
    await afterBatch()
  } catch (e) {
    error.value = e.message || ''
  }
}

async function moveBatch(batch, event) {
  const id = Number(event.target.value)
  if (!id) return
  try {
    await api.moveInventoryBatch(batch.id, id)
    event.target.value = ''
    await afterBatch()
  } catch (e) {
    error.value = e.message || ''
  }
}

async function removeItem(it) {
  if (!window.confirm(`删除物品「${it.name}」及其全部批次？`)) return
  try {
    await api.deleteInventoryItem(it.id)
    detailItem.value = null
    await refresh()
  } catch (e) {
    error.value = e.message || ''
  }
}

async function addLocation() {
  locError.value = ''
  if (!newLocName.value.trim()) {
    locError.value = '请填写位置名称'
    return
  }
  try {
    await api.createInventoryLocation({ name: newLocName.value.trim(), kind: newLocKind.value })
    newLocName.value = ''
    await loadAll()
  } catch (e) {
    locError.value = e.message || ''
  }
}

async function delLocation(l) {
  locError.value = ''
  if (!window.confirm(`删除位置「${l.name}」？`)) return
  try {
    await api.deleteInventoryLocation(l.id)
    if (selectedLocation.value === l.id) selectedLocation.value = 0
    await loadAll()
  } catch (e) {
    locError.value = e.message || ''
  }
}

async function handleScanned(code) {
  if (!code) return
  error.value = ''
  try {
    const res = await api.inventoryBarcode(code)
    if (res.data && res.data.item_id) {
      barcodeState.value = ''
      await openDetail({ id: res.data.item_id })
      return
    }
  } catch (e) {
    // 本地未命中，转在线商品库识别
  }
  // 立即跳转新增表单（条码已填），商品名称由在线识别异步补全
  initialItem.value = null
  initialBarcode.value = code
  editingItem.value = null
  barcodeState.value = 'loading'
  editorOpen.value = true
  lookupProduct(code)
}

// 本地条码库只记录用户绑定过的商品；未收录时查询公开商品库补全名称
// （微信扫商品条码能出名称，走的也是商品数据库，而非手机本地数据）
async function lookupProduct(code) {
  try {
    const res = await api.inventoryBarcodeProduct(code)
    const p = res.data
    if (!p || !p.name) return
    // 期间用户可能已关闭弹窗或改扫了别的条码，只在同一张表单上回填
    if (!editorOpen.value || editingItem.value || initialBarcode.value !== code) return
    initialItem.value = {
      name: p.name,
      category: p.category || '',
      unit: '件',
      barcode: p.barcode || code,
    }
    initialBarcode.value = ''
    barcodeState.value = 'found'
  } catch (e) {
    // 商品库未收录或网络不可用：保留空表单，用户可手动填写
    barcodeState.value = String(e.message || '').includes('未收录') ? 'miss' : 'unavailable'
  }
}

function scanBarcode() {
  const bridge = window.StickyKeeNative
  if (!bridge || typeof bridge.scanBarcode !== 'function') {
    error.value = '当前环境不支持原生扫码，请手动输入条码或使用 APK'
    return
  }
  const req = String(Date.now())
  const handler = (ev) => {
    window.removeEventListener('stickykee-scan', handler)
    const d = (ev && ev.detail) || {}
    if (!d.ok || !d.value) {
      error.value = d.message || '未识别到条码'
      return
    }
    handleScanned(d.value)
  }
  window.addEventListener('stickykee-scan', handler)
  try {
    bridge.scanBarcode(req)
  } catch (e) {
    window.removeEventListener('stickykee-scan', handler)
    error.value = '扫码启动失败'
  }
}

function compressImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('读取图片失败'))
    }
    img.src = url
  })
}

async function onPickImage(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  error.value = ''
  try {
    const dataUrl = await compressImage(file, 1024)
    const res = await api.recognizeInventoryImage(dataUrl)
    const c = res.data && res.data.candidate
    if (!c) {
      error.value = '未能识别出物品，请手动填写'
      return
    }
    initialBarcode.value = ''
    initialItem.value = {
      name: c.name || '',
      category: c.category || '',
      unit: c.unit || '件',
      barcode: c.barcode || '',
    }
    editingItem.value = null
    editorOpen.value = true
  } catch (e) {
    error.value = e.message || '识别失败'
  }
}

async function toShopping(it) {
  try {
    await api.itemToShopping(it.id, 1)
    error.value = ''
    detailItem.value = null
    activeTab.value = 'shopping'
  } catch (e) {
    error.value = e.message || '加入购物清单失败'
  }
}

function openStocktake() {
  stocktakeError.value = ''
  if (!locations.value.length) {
    error.value = '请先在「管理位置」中添加存放位置'
    return
  }
  const nameOf = (id) => (locations.value.find((l) => l.id === id) || {}).name || ''
  stocktakeRows.value = items.value.map((it) => {
    const first = (it.batches || [])[0]
    const locationId = first ? first.location_id : locations.value[0].id
    return {
      key: it.id,
      item_id: it.id,
      name: it.name,
      unit: it.unit,
      location_id: locationId,
      locationName: nameOf(locationId),
      quantity: Number(it.total_quantity) || 0,
    }
  })
  stocktakeOpen.value = true
}

async function submitStocktake() {
  stocktakeSaving.value = true
  stocktakeError.value = ''
  try {
    const lines = stocktakeRows.value
      .filter((r) => r.location_id)
      .map((r) => ({
        item_id: r.item_id,
        location_id: r.location_id,
        quantity: Number(r.quantity) || 0,
      }))
    await api.inventoryStocktake(lines)
    stocktakeOpen.value = false
    await refresh()
  } catch (e) {
    stocktakeError.value = e.message || '盘点提交失败'
  } finally {
    stocktakeSaving.value = false
  }
}

async function exportCsv() {
  try {
    const res = await api.inventoryExport()
    const { filename, content } = res.data || {}
    const blob = new Blob([content || ''], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'inventory.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e.message || '导出失败'
  }
}

onMounted(loadAll)
</script>

<template>
  <div class="space-y-4">
    <!-- 月份切换 + 记一笔：窄屏保持同一行，主操作不被挤走 -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1 min-w-0">
        <button class="p-1 rounded-lg text-muted hover:text-primary" @click="shiftMonth(-1)">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <div class="text-sm font-medium font-body min-w-[90px] text-center">{{ monthLabel }}</div>
        <button class="p-1 rounded-lg text-muted hover:text-primary" @click="shiftMonth(1)">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
        <button
          v-if="month !== currentMonthValue"
          class="ml-1 shrink-0 px-2 py-1 rounded-lg text-xs text-muted border border-border whitespace-nowrap"
          @click="goCurrentMonth"
        >本月</button>
      </div>
      <button
        class="shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-body"
        @click="openAdd"
      >
        <span class="material-symbols-outlined text-base">add</span>
        记一笔
      </button>
    </div>

    <!-- 工具按钮：手机横向滑动，宽屏自动换行 -->
    <div class="hc-finance-tools">
      <button
        class="hc-finance-tool px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted font-body"
        @click="budgetOpen = true"
      >预算</button>
      <button
        class="hc-finance-tool px-3 py-1.5 rounded-lg text-xs font-body border"
        :class="showCalendar ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface-alt text-muted border-border'"
        @click="showCalendar = !showCalendar"
      >日历</button>
      <button
        class="hc-finance-tool px-3 py-1.5 rounded-lg text-xs font-body border"
        :class="showReport ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface-alt text-muted border-border'"
        @click="showReport = !showReport"
      >报表</button>
      <button
        class="hc-finance-tool px-2.5 py-1.5 rounded-lg bg-surface-alt border border-border text-muted"
        title="导出 CSV"
        @click="exportCsv"
      >
        <span class="material-symbols-outlined text-base leading-none">download</span>
      </button>
      <button
        class="hc-finance-tool px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted font-body"
        @click="importOpen = true"
      >导入</button>
      <button
        class="hc-finance-tool px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted font-body"
        @click="openManager('account')"
      >账户 / 分类</button>
      <button
        class="hc-finance-tool px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted font-body"
        @click="openManager('recurring')"
      >周期</button>
    </div>

    <!-- 搜索 -->
    <div class="flex items-center gap-2">
      <div class="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border focus-within:border-primary/50">
        <span class="material-symbols-outlined text-base text-muted">search</span>
        <input
          v-model="searchQuery"
          class="flex-1 min-w-0 bg-transparent outline-none text-sm text-on-surface placeholder:text-muted"
          placeholder="搜索备注 / 标签 / 金额（全部月份）"
        />
        <button v-if="searchQuery" class="text-muted hover:text-on-surface" @click="clearSearch">
          <span class="material-symbols-outlined text-base">close</span>
        </button>
      </div>
      <UiSelect v-model="filterCategoryId" class="w-32 flex-shrink-0 text-sm" :options="categoryFilterOptions" />
    </div>

    <!-- 标签筛选 -->
    <div v-if="allTags.length" class="flex flex-wrap items-center gap-1.5">
      <button
        class="px-2.5 py-1 rounded-full text-xs font-body border"
        :class="!tagFilter ? 'bg-primary text-white border-primary' : 'bg-surface-alt text-muted border-border'"
        @click="setTag('')"
      >全部</button>
      <button
        v-for="t in allTags"
        :key="t"
        class="px-2.5 py-1 rounded-full text-xs font-body border"
        :class="tagFilter === t ? 'bg-primary text-white border-primary' : 'bg-surface-alt text-muted border-border'"
        @click="setTag(tagFilter === t ? '' : t)"
      >#{{ t }}</button>
    </div>

    <!-- 概览 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div class="bg-surface border border-border rounded-2xl p-4">
        <div class="text-xs text-muted font-body">本月支出</div>
        <div class="font-headline text-xl font-semibold text-on-background">{{ money(stats.expense) }}</div>
      </div>
      <div class="bg-surface border border-border rounded-2xl p-4">
        <div class="text-xs text-muted font-body">本月收入</div>
        <div class="font-headline text-xl font-semibold text-primary">{{ money(stats.income) }}</div>
      </div>
      <div class="bg-surface border border-border rounded-2xl p-4">
        <div class="text-xs text-muted font-body">结余</div>
        <div class="font-headline text-xl font-semibold" :class="balance >= 0 ? 'text-on-background' : 'text-error'">
          {{ money(balance) }}
        </div>
      </div>
      <div class="bg-surface border border-border rounded-2xl p-4">
        <div class="text-xs text-muted font-body">总资产</div>
        <div class="font-headline text-xl font-semibold text-on-background">{{ money(stats.balance) }}</div>
      </div>
    </div>

    <!-- 收支日历 -->
    <section v-if="showCalendar" class="bg-surface border border-border rounded-2xl p-3 space-y-2">
      <div class="flex items-center justify-between px-1">
        <div class="text-sm font-medium font-body">收支日历</div>
        <div class="flex items-center gap-2 text-[10px] font-body text-muted">
          <span class="flex items-center gap-1">
            <i class="w-1.5 h-1.5 rounded-full bg-primary inline-block"></i>支出
          </span>
          <button v-if="dayFilter" class="text-primary" @click="clearDay">取消筛选</button>
        </div>
      </div>
      <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-body text-muted">
        <span v-for="w in weekLabels" :key="w">{{ w }}</span>
      </div>
      <div class="grid grid-cols-7 gap-1">
        <button
          v-for="(c, i) in calendarCells"
          :key="i"
          type="button"
          class="h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 font-body text-[11px] transition-colors"
          :class="c
            ? [c.key === dayFilter ? 'bg-primary text-white' : 'bg-surface-alt/50 text-on-surface hover:bg-surface-alt',
               c.isToday && c.key !== dayFilter ? 'ring-1 ring-primary/40' : '']
            : 'opacity-0 pointer-events-none'"
          :disabled="!c"
          @click="c && selectDay(c.key)"
        >
          <template v-if="c">
            <span class="leading-none">{{ c.day }}</span>
            <span
              v-if="c.expense > 0"
              class="text-[9px] leading-none"
              :class="c.key === dayFilter ? 'text-white/80' : 'text-muted'"
            >{{ shortMoney(c.expense) }}</span>
            <span
              v-else-if="c.income > 0"
              class="text-[9px] leading-none"
              :class="c.key === dayFilter ? 'text-white/80' : 'text-primary'"
            >+{{ shortMoney(c.income) }}</span>
          </template>
        </button>
      </div>
    </section>

    <!-- 预算进度 -->
    <div v-if="Number(stats.budget_total) > 0" class="bg-surface border border-border rounded-2xl p-4 space-y-2">
      <div class="flex items-center justify-between text-xs font-body">
        <span class="text-muted">本月预算</span>
        <span :class="Number(stats.budget_left) < 0 ? 'text-error' : 'text-muted'">
          已用 {{ money(stats.expense) }} / {{ money(stats.budget_total) }}
        </span>
      </div>
      <div class="h-2 rounded-full bg-surface-alt overflow-hidden">
        <div
          class="h-full rounded-full"
          :class="Number(stats.budget_left) < 0 ? 'bg-error' : 'bg-primary'"
          :style="{ width: Math.min(100, Math.max(0, Number(stats.budget_pct) || 0)) + '%' }"
        ></div>
      </div>
      <div class="text-[11px] font-body" :class="Number(stats.budget_left) < 0 ? 'text-error' : 'text-muted'">
        {{ Number(stats.budget_left) < 0 ? '已超支 ' + money(-stats.budget_left) : '剩余 ' + money(stats.budget_left) }}
      </div>
    </div>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <FinanceReport v-if="showReport" :stats="stats" :trend="trend" />

    <div v-if="searching" class="text-[11px] text-muted font-body px-1">
      全部月份 · 找到 {{ total }} 条
    </div>

    <!-- 按日流水 -->
    <div v-if="groups.length" class="space-y-4">
      <div v-for="g in groups" :key="g.date" class="space-y-1.5">
        <div class="flex items-center justify-between text-xs font-body text-muted px-1">
          <span>{{ g.label }}</span>
          <span v-if="g.expense > 0">支出 {{ money(g.expense) }}</span>
        </div>
        <div class="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
          <div
            v-for="tx in g.items"
            :key="tx.id"
            class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt cursor-pointer"
            @click="openEdit(tx)"
          >
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              :class="tx.type === 'income' ? 'bg-primary/10 text-primary' : 'bg-surface-alt text-muted'"
            >
              <span class="material-symbols-outlined text-lg">{{ iconOf(tx) }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ titleOf(tx) }}</div>
              <div class="text-[11px] text-muted font-body truncate">{{ subtitleOf(tx) }}</div>
            </div>
            <div class="text-right flex-shrink-0">
              <div class="text-sm font-medium" :class="tx.type === 'income' ? 'text-primary' : 'text-on-background'">
                {{ signedAmount(tx) }}
              </div>
            </div>
            <button class="text-muted hover:text-error flex-shrink-0" title="删除" @click.stop="remove(tx)">
              <span class="material-symbols-outlined text-base">delete</span>
            </button>
          </div>
        </div>
      </div>
      <button
        v-if="items.length < total"
        class="w-full py-2 rounded-xl border border-border text-xs text-muted font-body"
        @click="loadMore"
      >加载更多（{{ items.length }} / {{ total }}）</button>
    </div>
    <div v-else class="text-center py-16 text-sm text-muted font-body">
      {{ emptyHint }}
    </div>

    <TransactionDialog
      v-model="dialogOpen"
      :accounts="accounts"
      :categories="categories"
      :transaction="editing"
      @saved="reload"
      @reload="loadCategories"
    />
    <AccountManager
      v-model="managerOpen"
      :accounts="allAccounts"
      :categories="categories"
      :initial-tab="managerTab"
      @changed="reloadAll"
      @import="importOpen = true"
    />
    <ImportDialog
      v-model="importOpen"
      :accounts="allAccounts"
      @changed="reloadAll"
    />
    <BudgetDialog
      v-model="budgetOpen"
      :month="month"
      :categories="categories"
      @saved="reload"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import api from '@/api'
import UiSelect from '@/components/ui/UiSelect.vue'
import TransactionDialog from './TransactionDialog.vue'
import AccountManager from './AccountManager.vue'
import BudgetDialog from './BudgetDialog.vue'
import FinanceReport from './FinanceReport.vue'
import ImportDialog from './ImportDialog.vue'
import { confirmAction } from '@/composables/useConfirm'
import { syncAutoFinanceConfig } from '@/utils/autoFinance'

const PAGE_SIZE = 60

const month = ref(currentMonth())
const stats = ref({})
const accounts = ref([])
const allAccounts = ref([])
const categories = ref([])
const items = ref([])
const total = ref(0)
const page = ref(1)
const tagFilter = ref('')
const loading = ref(false)
const error = ref('')

const dialogOpen = ref(false)
const editing = ref(null)
const managerOpen = ref(false)
const managerTab = ref('account')
const budgetOpen = ref(false)
const importOpen = ref(false)
const showReport = ref(false)
const showCalendar = ref(true)
const trend = ref([])

const searchQuery = ref('')
const filterCategoryId = ref(0)
const dayFilter = ref('')
const weekLabels = ['一', '二', '三', '四', '五', '六', '日']

function pad(n) {
  return String(n).padStart(2, '0')
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

const currentMonthValue = currentMonth()

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-')
  return `${y}年${Number(m)}月`
})

const balance = computed(() => Number(stats.value.income || 0) - Number(stats.value.expense || 0))

const searching = computed(() => !!searchQuery.value.trim())

const emptyHint = computed(() => {
  if (loading.value) return '加载中…'
  if (searching.value) return '没有找到匹配的账目'
  if (dayFilter.value) return '这一天没有账目'
  return '本月还没有账目，点击右上角「记一笔」开始'
})

const categoryFilterOptions = computed(() => [
  { label: '全部分类', value: 0 },
  ...categories.value.map((c) => ({ label: `${c.type === 'income' ? '收入' : '支出'} · ${c.name}`, value: c.id })),
])

const todayKey = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})()

const dayStatMap = computed(() => {
  const m = {}
  for (const d of stats.value.by_day || []) m[d.day] = d
  return m
})

const calendarCells = computed(() => {
  const [y, mo] = month.value.split('-').map(Number)
  if (!y || !mo) return []
  const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7
  const days = new Date(y, mo, 0).getDate()
  const cells = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d += 1) {
    const key = `${month.value}-${pad(d)}`
    const s = dayStatMap.value[key] || {}
    cells.push({
      day: d,
      key,
      expense: Number(s.expense || 0),
      income: Number(s.income || 0),
      isToday: key === todayKey,
    })
  }
  return cells
})

const categoryMap = computed(() => {
  const m = {}
  for (const c of categories.value) {
    m[c.id] = c
    for (const ch of c.children || []) m[ch.id] = ch
  }
  return m
})

const groups = computed(() => {
  const map = new Map()
  for (const tx of items.value) {
    const d = (tx.occurred_at || '').slice(0, 10)
    if (!map.has(d)) map.set(d, { date: d, label: dateLabel(d), expense: 0, items: [] })
    const g = map.get(d)
    g.items.push(tx)
    if (tx.type === 'expense') g.expense += Number(tx.amount || 0)
  }
  return [...map.values()]
})

const tagPool = ref([])
const allTags = computed(() => tagPool.value)

function collectTags(list) {
  const set = new Set()
  for (const tx of list) {
    for (const raw of String(tx.tags || '').split(',')) {
      const t = raw.trim()
      if (t) set.add(t)
    }
  }
  return [...set].slice(0, 20)
}

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function shortMoney(cents) {
  const v = Number(cents || 0) / 100
  if (!v) return ''
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  if (v >= 100) return String(Math.round(v))
  return v.toFixed(v % 1 ? 1 : 0)
}

function selectDay(key) {
  dayFilter.value = dayFilter.value === key ? '' : key
  loadTransactions()
}

function clearDay() {
  dayFilter.value = ''
  loadTransactions()
}

function clearSearch() {
  searchQuery.value = ''
}

function signedAmount(tx) {
  const v = money(tx.amount)
  if (tx.type === 'income') return '+' + v
  if (tx.type === 'transfer') return v
  return '-' + v
}

function iconOf(tx) {
  if (tx.type === 'transfer') return 'swap_horiz'
  const c = categoryMap.value[tx.category_id]
  return (c && c.icon) || (tx.type === 'income' ? 'payments' : 'label')
}

function titleOf(tx) {
  if (tx.type === 'transfer') return '转账'
  const c = categoryMap.value[tx.category_id]
  return (c && c.name) || tx.category_name || (tx.note || '未分类')
}

function subtitleOf(tx) {
  if (tx.type === 'transfer') {
    return `${tx.account_name || ''} → ${tx.to_account_name || ''}`
  }
  const parts = []
  if (tx.currency && tx.currency !== 'CNY' && Number(tx.orig_amount) > 0) {
    parts.push(`${tx.currency} ${(Number(tx.orig_amount) / 100).toFixed(2)} @${tx.fx_rate}`)
  }
  if (tx.note) parts.push(tx.note)
  if (tx.tags) {
    const ts = String(tx.tags).split(',').map((x) => x.trim()).filter(Boolean)
    if (ts.length) parts.push(ts.map((t) => `#${t}`).join(' '))
  }
  const account = tx.account_name || ''
  return [account, ...parts].filter(Boolean).join(' · ')
}

function dateLabel(d) {
  if (!d) return ''
  const today = new Date()
  const t = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const yest = new Date(today.getTime() - 86400000)
  const y = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`
  if (d === t) return '今天'
  if (d === y) return '昨天'
  const dt = new Date(d + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return d
  return `${dt.getMonth() + 1}月${dt.getDate()}日 周${'日一二三四五六'[dt.getDay()]}`
}

async function loadStats() {
  try {
    const res = await api.financeStats(month.value)
    stats.value = res.data || {}
  } catch (e) {
    error.value = e.message || ''
  }
}

async function loadAccounts() {
  try {
    const [active, all] = await Promise.all([api.financeAccounts(), api.financeAccounts(true)])
    accounts.value = active.data || []
    allAccounts.value = all.data || []
  } catch (e) {
    error.value = e.message || ''
  }
}

async function loadCategories() {
  try {
    const res = await api.financeCategories()
    categories.value = res.data || []
  } catch (e) {
    error.value = e.message || ''
  }
}

async function loadTransactions(reset = true) {
  if (reset) page.value = 1
  try {
    const params = { page: page.value, page_size: PAGE_SIZE }
    // 有关键词时跨全部月份搜索，否则只看当前月。
    if (!searching.value) params.month = month.value
    else params.q = searchQuery.value.trim()
    if (filterCategoryId.value) params.category = filterCategoryId.value
    if (dayFilter.value) params.day = dayFilter.value
    if (tagFilter.value) params.tag = tagFilter.value
    const res = await api.financeTransactions(params)
    const d = res.data || {}
    items.value = reset ? (d.items || []) : items.value.concat(d.items || [])
    total.value = d.total || 0
    if (reset && !tagFilter.value && !searching.value) tagPool.value = collectTags(items.value)
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

async function loadTrend() {
  try {
    const res = await api.financeTrend(6)
    trend.value = res.data || []
  } catch (e) {
    error.value = e.message || ''
  }
}

async function reload() {
  error.value = ''
  loading.value = true
  try {
    await Promise.all([loadStats(), loadAccounts(), loadCategories(), loadTransactions(), loadTrend()])
  } finally {
    loading.value = false
  }
}

async function reloadAll() {
  await reload()
}

function loadMore() {
  page.value += 1
  loadTransactions(false)
}

function setTag(tag) {
  tagFilter.value = tag
  loadTransactions()
}

function shiftMonth(n) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  month.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  tagFilter.value = ''
  dayFilter.value = ''
  tagPool.value = []
  loadStats()
  loadTransactions()
}

function goCurrentMonth() {
  month.value = currentMonthValue
  tagFilter.value = ''
  dayFilter.value = ''
  tagPool.value = []
  loadStats()
  loadTransactions()
}

function openAdd() {
  editing.value = null
  dialogOpen.value = true
}

function openManager(tab = 'account') {
  managerTab.value = tab
  managerOpen.value = true
}

function openEdit(tx) {
  if (tx.type === 'transfer') return
  editing.value = tx
  dialogOpen.value = true
}

async function remove(tx) {
  const ok = await confirmAction({
    title: '删除账目',
    message: `删除这笔「${titleOf(tx)}」账目？`,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteFinanceTransaction(tx.id)
    await reload()
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function exportCsv() {
  try {
    const res = await api.financeExport(month.value)
    const { filename, content } = res.data || {}
    const blob = new Blob([content || ''], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `finance-${month.value}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e.message || '导出失败'
  }
}

let searchTimer = null
watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadTransactions(), 300)
})
watch(filterCategoryId, () => loadTransactions())
onBeforeUnmount(() => clearTimeout(searchTimer))

onMounted(() => {
  syncAutoFinanceConfig()
  reload()
})
</script>

<style scoped>
/* 工具按钮行：窄屏横向滚动（不换行、不挤压），宽屏自动换行铺满 */
.hc-finance-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.hc-finance-tools::-webkit-scrollbar {
  display: none;
}
.hc-finance-tool {
  flex-shrink: 0;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
@media (min-width: 768px) {
  .hc-finance-tools {
    flex-wrap: wrap;
    overflow: visible;
  }
}
</style>

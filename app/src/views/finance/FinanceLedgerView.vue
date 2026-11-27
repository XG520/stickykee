<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto lg:max-w-none">
    <FinanceHeader title="账本" subtitle="记好每一笔，心里有数">
      <button class="hc-ic" :class="searchOpen ? 'text-primary' : ''" aria-label="搜索" @click="toggleSearch">
        <span class="material-symbols-outlined">search</span>
      </button>
      <button class="hc-ic" aria-label="收支日历" @click="calOpen = true">
        <span class="material-symbols-outlined">calendar_month</span>
      </button>
      <button class="hc-ic relative" :class="hasFilters ? 'text-primary' : ''" aria-label="筛选" @click="filterOpen = true">
        <span class="material-symbols-outlined">tune</span>
        <span v-if="hasFilters" class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary"></span>
      </button>
    </FinanceHeader>

    <!-- 搜索：跨全部月份 -->
    <div v-if="searchOpen" class="flex items-center gap-2">
      <div class="flex-1 min-w-0 flex items-center gap-2 h-11 px-3 rounded-xl bg-surface border border-border focus-within:border-primary/60">
        <span class="material-symbols-outlined text-base text-muted">search</span>
        <input
          ref="searchInput"
          v-model="searchQuery"
          class="flex-1 min-w-0 bg-transparent outline-none text-sm text-on-surface placeholder:text-faint"
          placeholder="搜索备注 / 标签 / 金额（全部月份）"
        />
        <button v-if="searchQuery" class="text-muted" @click="clearSearch">
          <span class="material-symbols-outlined text-base">close</span>
        </button>
      </div>
      <button class="text-xs text-muted font-body whitespace-nowrap px-1" @click="closeSearch">取消</button>
    </div>

    <!-- 月份条 -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-0.5 min-w-0">
        <button class="hc-ic-sm" aria-label="上个月" @click="shiftFinanceMonth(-1)">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <div class="text-sm font-medium font-body min-w-[92px] text-center">{{ monthText(financeMonth) }}</div>
        <button class="hc-ic-sm" aria-label="下个月" @click="shiftFinanceMonth(1)">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
        <button
          v-if="financeMonth !== currentMonthValue"
          class="ml-1 h-7 px-2.5 rounded-full text-[11px] text-primary border border-primary/35 bg-primary/5 font-body whitespace-nowrap"
          @click="goCurrentMonth"
        >本月</button>
      </div>
      <span class="text-[11px] text-muted font-body whitespace-nowrap">
        {{ searching ? '全部月份' : '' }} {{ items.length }}<template v-if="total > items.length"> / {{ total }}</template> 笔
      </span>
    </div>

    <!-- 桌面端：左侧流水、右侧吸顶汇总 -->
    <div class="space-y-3 lg:grid lg:grid-cols-12 lg:gap-5 lg:space-y-0 lg:items-start">
    <!-- 汇总卡 -->
    <section class="rounded-2xl lg:rounded-3xl bg-surface border border-border p-4 lg:p-5 lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:sticky lg:top-20">
      <div class="text-[11px] text-muted font-body">{{ monthText(financeMonth) }}支出</div>
      <div class="mt-1 font-headline text-[30px] lg:text-[34px] leading-none font-semibold tabular-nums">{{ money(stats.expense) }}</div>
      <div class="mt-2.5 flex items-center gap-3 text-[11px] font-body text-muted">
        <span>收入 <span class="text-accent font-medium">{{ money(stats.income) }}</span></span>
        <span>结余 <span :class="balance >= 0 ? 'text-accent' : 'text-error'" class="font-medium">{{ money(balance) }}</span></span>
      </div>

      <div v-if="Number(stats.budget_total) > 0" class="mt-3 space-y-1.5">
        <div class="h-2 rounded-full bg-surface-alt overflow-hidden">
          <div
            class="h-full rounded-full"
            :class="Number(stats.budget_left) < 0 ? 'bg-error' : 'bg-primary'"
            :style="{ width: Math.min(100, Math.max(0, Number(stats.budget_pct) || 0)) + '%' }"
          ></div>
        </div>
        <div class="text-[11px] font-body" :class="Number(stats.budget_left) < 0 ? 'text-error' : 'text-muted'">
          {{ Number(stats.budget_left) < 0 ? '已超支 ' + money(-stats.budget_left) : '预算剩余 ' + money(stats.budget_left) }}
          · 已用 {{ Number(stats.budget_pct || 0).toFixed(0) }}%
        </div>
      </div>
    </section>

    <!-- 右侧主列：筛选 + 流水 -->
    <div class="space-y-3 lg:col-span-8 lg:col-start-1 lg:row-start-1">
    <!-- 生效筛选 -->
    <div v-if="hasFilters || dayFilter" class="flex flex-wrap items-center gap-1.5">
      <button v-if="dayFilter" class="hc-fchip" @click="clearDay">
        {{ dayFilter.slice(5) }} <span class="material-symbols-outlined text-sm">close</span>
      </button>
      <button v-if="filterType" class="hc-fchip" @click="filterType = ''">
        {{ filterType === 'income' ? '收入' : '支出' }} <span class="material-symbols-outlined text-sm">close</span>
      </button>
      <button v-if="filterCategory" class="hc-fchip" @click="filterCategory = 0">
        {{ categoryName(filterCategory) }} <span class="material-symbols-outlined text-sm">close</span>
      </button>
      <button v-if="filterAccount" class="hc-fchip" @click="filterAccount = 0">
        {{ accountName(filterAccount) }} <span class="material-symbols-outlined text-sm">close</span>
      </button>
      <button v-if="filterTag" class="hc-fchip" @click="filterTag = ''">
        #{{ filterTag }} <span class="material-symbols-outlined text-sm">close</span>
      </button>
      <button class="text-[11px] text-muted font-body underline underline-offset-2 ml-1" @click="resetFilters">清除</button>
    </div>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 按日流水 -->
    <div v-if="groups.length" class="space-y-3">
      <div v-for="g in groups" :key="g.date" class="space-y-1.5">
        <div class="hc-day-head flex items-center justify-between text-[11px] font-body text-muted px-1">
          <span>{{ g.label }}</span>
          <span v-if="g.expense > 0">支出 {{ money(g.expense) }}</span>
        </div>
        <div class="bg-surface border border-border rounded-2xl lg:rounded-3xl divide-y divide-border overflow-hidden">
          <div
            v-for="tx in g.items"
            :key="tx.id"
            class="flex items-center gap-3 px-3 py-2.5 lg:px-4 lg:py-3 cursor-pointer active:bg-surface-alt hover:bg-surface-alt/60 transition-colors"
            @click="editTx(tx)"
          >
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              :class="tx.type === 'income' ? 'bg-accent/10 text-accent' : 'bg-surface-alt text-muted'"
            >
              <span class="material-symbols-outlined text-lg">{{ iconOf(tx) }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ titleOf(tx) }}</div>
              <div class="text-[11px] text-muted font-body truncate">{{ subtitleOf(tx) }}</div>
            </div>
            <div class="text-right flex-shrink-0">
              <div class="text-sm font-medium tabular-nums" :class="tx.type === 'income' ? 'text-accent' : 'text-on-background'">
                {{ signedAmount(tx) }}
              </div>
            </div>
            <button class="w-8 h-8 flex items-center justify-center text-muted" aria-label="更多操作" @click.stop="menuTx = tx">
              <span class="material-symbols-outlined text-base">more_horiz</span>
            </button>
          </div>
        </div>
      </div>
      <button
        v-if="items.length < total"
        class="w-full py-2.5 rounded-xl border border-border text-xs text-muted font-body"
        @click="loadMore"
      >加载更多（{{ items.length }} / {{ total }}）</button>
    </div>
    <div v-else class="text-center py-16 text-sm text-muted font-body">
      {{ emptyHint }}
    </div>
    </div>
    </div>

    <!-- 收支日历 Sheet -->
    <div v-if="calOpen" class="fixed inset-0 z-[86] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" @click.self="calOpen = false">
      <div class="w-full max-w-lg bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-3" style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))">
        <div class="flex items-center justify-between">
          <h3 class="font-headline text-lg font-semibold">{{ monthText(financeMonth) }}收支日历</h3>
          <button class="text-muted hover:text-on-surface" @click="calOpen = false">
            <span class="material-symbols-outlined">close</span>
          </button>
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
              ? [c.key === dayFilter ? 'bg-primary text-on-primary' : 'bg-surface-alt/50 text-on-surface hover:bg-surface-alt',
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
                :class="c.key === dayFilter ? 'text-on-primary/80' : 'text-muted'"
              >{{ shortMoney(c.expense) }}</span>
              <span
                v-else-if="c.income > 0"
                class="text-[9px] leading-none"
                :class="c.key === dayFilter ? 'text-on-primary/80' : 'text-accent'"
              >+{{ shortMoney(c.income) }}</span>
            </template>
          </button>
        </div>
        <div class="flex items-center justify-between text-[11px] text-muted font-body">
          <span>点选日期筛选流水</span>
          <button v-if="dayFilter" class="text-primary" @click="clearDay">取消筛选</button>
        </div>
      </div>
    </div>

    <!-- 筛选 Sheet -->
    <div v-if="filterOpen" class="fixed inset-0 z-[87] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" @click.self="filterOpen = false">
      <div class="w-full max-w-lg max-h-[86vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4" style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))">
        <div class="flex items-center justify-between">
          <h3 class="font-headline text-lg font-semibold">筛选</h3>
          <button class="text-muted hover:text-on-surface" @click="filterOpen = false">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="space-y-2">
          <div class="text-[11px] text-muted font-body">类型</div>
          <div class="flex flex-wrap gap-1.5">
            <button class="hc-chip" :class="!filterType ? 'hc-chip--on' : ''" @click="filterType = ''">全部</button>
            <button class="hc-chip" :class="filterType === 'expense' ? 'hc-chip--on' : ''" @click="filterType = 'expense'">支出</button>
            <button class="hc-chip" :class="filterType === 'income' ? 'hc-chip--on' : ''" @click="filterType = 'income'">收入</button>
          </div>
        </div>

        <div class="space-y-2">
          <div class="text-[11px] text-muted font-body">分类</div>
          <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
            <button class="hc-chip" :class="!filterCategory ? 'hc-chip--on' : ''" @click="filterCategory = 0">全部分类</button>
            <button
              v-for="c in flatCategories"
              :key="c.id"
              class="hc-chip"
              :class="filterCategory === c.id ? 'hc-chip--on' : ''"
              @click="filterCategory = filterCategory === c.id ? 0 : c.id"
            >{{ c.name }}</button>
          </div>
        </div>

        <div class="space-y-2">
          <div class="text-[11px] text-muted font-body">账户</div>
          <div class="flex flex-wrap gap-1.5">
            <button class="hc-chip" :class="!filterAccount ? 'hc-chip--on' : ''" @click="filterAccount = 0">全部账户</button>
            <button
              v-for="a in allAccounts"
              :key="a.id"
              class="hc-chip"
              :class="filterAccount === a.id ? 'hc-chip--on' : ''"
              @click="filterAccount = filterAccount === a.id ? 0 : a.id"
            >{{ a.name }}</button>
          </div>
        </div>

        <div v-if="allTags.length" class="space-y-2">
          <div class="text-[11px] text-muted font-body">标签</div>
          <div class="flex flex-wrap gap-1.5">
            <button class="hc-chip" :class="!filterTag ? 'hc-chip--on' : ''" @click="filterTag = ''">全部标签</button>
            <button
              v-for="t in allTags"
              :key="t"
              class="hc-chip"
              :class="filterTag === t ? 'hc-chip--on' : ''"
              @click="filterTag = filterTag === t ? '' : t"
            >#{{ t }}</button>
          </div>
        </div>

        <div class="flex gap-2 pt-1">
          <button class="flex-1 h-11 rounded-xl border border-border text-sm text-muted font-body" @click="resetFilters">重置</button>
          <button class="flex-1 h-11 rounded-xl bg-primary text-on-primary text-sm font-body font-medium" @click="filterOpen = false">完成</button>
        </div>
      </div>
    </div>

    <!-- 流水操作 Sheet -->
    <div v-if="menuTx" class="fixed inset-0 z-[88] flex items-end justify-center bg-black/50" @click.self="menuTx = null">
      <div class="w-full max-w-lg bg-surface border-t border-border rounded-t-2xl p-2" style="padding-bottom: calc(0.5rem + env(safe-area-inset-bottom))">
        <div class="px-3 py-2 text-[11px] text-muted font-body truncate">
          {{ titleOf(menuTx) }} · {{ signedAmount(menuTx) }}
        </div>
        <button class="hc-sheet-row" @click="editTx(menuTx)">
          <span class="material-symbols-outlined text-base">edit</span>编辑
        </button>
        <button class="hc-sheet-row" @click="copyTx(menuTx)">
          <span class="material-symbols-outlined text-base">content_copy</span>复制一笔
        </button>
        <button class="hc-sheet-row text-error" @click="remove(menuTx)">
          <span class="material-symbols-outlined text-base">delete</span>删除
        </button>
        <button class="hc-sheet-row text-muted" @click="menuTx = null">
          <span class="material-symbols-outlined text-base">close</span>取消
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import { financeCopy, financeEditing, financeMonth, shiftFinanceMonth } from '@/store/finance'
import { currentMonth, money, monthText, payMethodLabel, shortMoney } from '@/utils/finance'
import { confirmAction } from '@/composables/useConfirm'
import { syncAutoFinanceConfig } from '@/utils/autoFinance'

defineOptions({ name: 'FinanceLedgerView' })

const router = useRouter()
const PAGE_SIZE = 60
const currentMonthValue = currentMonth()

const stats = ref({})
const accounts = ref([])
const allAccounts = ref([])
const categories = ref([])
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')

const searchOpen = ref(false)
const searchQuery = ref('')
const searchInput = ref(null)
const filterOpen = ref(false)
const calOpen = ref(false)
const menuTx = ref(null)

const filterType = ref('')
const filterCategory = ref(0)
const filterAccount = ref(0)
const filterTag = ref('')
const dayFilter = ref('')
const tagPool = ref([])

const weekLabels = ['一', '二', '三', '四', '五', '六', '日']

const searching = computed(() => !!searchQuery.value.trim())
const balance = computed(() => Number(stats.value.income || 0) - Number(stats.value.expense || 0))
const hasFilters = computed(() => !!(filterType.value || filterCategory.value || filterAccount.value || filterTag.value))
const allTags = computed(() => tagPool.value)

const flatCategories = computed(() => {
  const out = []
  for (const c of categories.value) {
    out.push(c)
    for (const ch of c.children || []) out.push(ch)
  }
  return out
})

const categoryMap = computed(() => {
  const m = {}
  for (const c of categories.value) {
    m[c.id] = c
    for (const ch of c.children || []) m[ch.id] = ch
  }
  return m
})

const todayKey = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

const dayStatMap = computed(() => {
  const m = {}
  for (const d of stats.value.by_day || []) m[d.day] = d
  return m
})

const calendarCells = computed(() => {
  const [y, mo] = financeMonth.value.split('-').map(Number)
  if (!y || !mo) return []
  const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7
  const days = new Date(y, mo, 0).getDate()
  const cells = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d += 1) {
    const key = `${financeMonth.value}-${String(d).padStart(2, '0')}`
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

const emptyHint = computed(() => {
  if (loading.value) return '加载中…'
  if (searching.value) return '没有找到匹配的账目'
  if (dayFilter.value) return '这一天没有账目'
  return '本月还没有账目，点下方「＋」记一笔'
})

function dateLabel(d) {
  if (!d) return ''
  const today = new Date()
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const yest = new Date(today.getTime() - 86400000)
  const y = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
  if (d === t) return '今天'
  if (d === y) return '昨天'
  const dt = new Date(d + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return d
  return `${dt.getMonth() + 1}月${dt.getDate()}日 周${'日一二三四五六'[dt.getDay()]}`
}

function categoryName(id) {
  return (categoryMap.value[id] || {}).name || '分类'
}

function accountName(id) {
  return (allAccounts.value.find((a) => a.id === id) || {}).name || '账户'
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
  return (c && c.name) || tx.category_name || tx.note || '未分类'
}

function subtitleOf(tx) {
  if (tx.type === 'transfer') return `${tx.account_name || ''} → ${tx.to_account_name || ''}`
  const parts = []
  if (tx.account_name) parts.push(tx.account_name)
  if (tx.note) parts.push(tx.note)
  if (tx.tags) {
    const ts = String(tx.tags).split(',').map((x) => x.trim()).filter(Boolean)
    if (ts.length) parts.push(ts.map((t) => `#${t}`).join(' '))
  }
  const pay = payMethodLabel(tx.pay_method)
  if (pay) parts.push(pay)
  return parts.join(' · ') || '未填写备注'
}

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

async function loadStats() {
  try {
    const res = await api.financeStats(financeMonth.value)
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
    if (!searching.value) params.month = financeMonth.value
    else params.q = searchQuery.value.trim()
    if (filterType.value) params.type = filterType.value
    if (filterCategory.value) params.category = filterCategory.value
    if (filterAccount.value) params.account = filterAccount.value
    if (dayFilter.value) params.day = dayFilter.value
    if (filterTag.value) params.tag = filterTag.value
    const res = await api.financeTransactions(params)
    const d = res.data || {}
    items.value = reset ? (d.items || []) : items.value.concat(d.items || [])
    total.value = d.total || 0
    if (reset && !filterTag.value && !searching.value) tagPool.value = collectTags(items.value)
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

async function reload() {
  error.value = ''
  loading.value = true
  try {
    await Promise.all([loadStats(), loadAccounts(), loadCategories(), loadTransactions()])
  } finally {
    loading.value = false
  }
}

function loadMore() {
  page.value += 1
  loadTransactions(false)
}

function goCurrentMonth() {
  financeMonth.value = currentMonthValue
  dayFilter.value = ''
  filterTag.value = ''
}

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) nextTick(() => searchInput.value?.focus())
  else clearSearch()
}

function closeSearch() {
  searchOpen.value = false
  clearSearch()
}

function clearSearch() {
  searchQuery.value = ''
}

function selectDay(key) {
  dayFilter.value = dayFilter.value === key ? '' : key
  calOpen.value = false
  loadTransactions()
}

function clearDay() {
  dayFilter.value = ''
  loadTransactions()
}

function resetFilters() {
  filterType.value = ''
  filterCategory.value = 0
  filterAccount.value = 0
  filterTag.value = ''
  dayFilter.value = ''
  loadTransactions()
}

function editTx(tx) {
  menuTx.value = null
  if (!tx || tx.type === 'transfer') return
  financeCopy.value = null
  financeEditing.value = tx
  router.push('/inventory/finance/add')
}

function copyTx(tx) {
  menuTx.value = null
  if (!tx || tx.type === 'transfer') return
  financeEditing.value = null
  financeCopy.value = tx
  router.push('/inventory/finance/add')
}

async function remove(tx) {
  menuTx.value = null
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

let searchTimer = null
watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadTransactions(), 300)
})

watch([filterType, filterCategory, filterAccount, filterTag], () => loadTransactions())

watch(financeMonth, () => {
  dayFilter.value = ''
  filterTag.value = ''
  tagPool.value = []
  loadStats()
  loadTransactions()
})

let activatedOnce = false
let savedScroll = 0
onMounted(() => {
  syncAutoFinanceConfig()
  reload()
})
onDeactivated(() => {
  savedScroll = window.scrollY
})
onActivated(async () => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  await reload()
  nextTick(() => requestAnimationFrame(() => window.scrollTo({ top: savedScroll })))
})
</script>

<style scoped>
.hc-ic {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-on-surface));
  flex-shrink: 0;
  transition: background-color .15s ease, color .15s ease;
}
.hc-ic:hover { background: rgb(var(--c-surface-alt)); }
.hc-ic-sm {
  width: 34px;
  height: 34px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-muted));
  flex-shrink: 0;
}
.hc-ic-sm:hover { background: rgb(var(--c-surface-alt)); color: rgb(var(--c-on-surface)); }

.hc-chip {
  height: 32px;
  padding: 0 12px;
  border-radius: 9999px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  font-size: 12px;
  font-family: var(--font-body);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}
.hc-chip--on {
  background: rgb(var(--c-primary));
  border-color: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
}
.hc-fchip {
  height: 28px;
  padding: 0 10px;
  border-radius: 9999px;
  background: rgb(var(--c-primary) / .12);
  border: 1px solid rgb(var(--c-primary) / .35);
  color: rgb(var(--c-primary));
  font-size: 11px;
  font-family: var(--font-body);
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
/* 日头吸顶在全局顶栏（约 64px）下方 */
.hc-day-head {
  position: sticky;
  top: calc(64px + env(safe-area-inset-top));
  z-index: 10;
  padding-top: 4px;
  padding-bottom: 4px;
  background: rgb(var(--c-background) / .92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.hc-sheet-row {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-family: var(--font-body);
  color: rgb(var(--c-on-surface));
}
.hc-sheet-row:hover { background: rgb(var(--c-surface-alt)); }
</style>

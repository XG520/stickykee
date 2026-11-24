<template>
  <div class="space-y-4">
    <!-- 月份切换与操作 -->
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-1">
        <button class="p-1 rounded-lg text-muted hover:text-primary" @click="shiftMonth(-1)">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <div class="text-sm font-medium font-body min-w-[92px] text-center">{{ monthLabel }}</div>
        <button class="p-1 rounded-lg text-muted hover:text-primary" @click="shiftMonth(1)">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
        <button
          v-if="month !== currentMonthValue"
          class="ml-1 px-2 py-1 rounded-lg text-xs text-muted border border-border"
          @click="goCurrentMonth"
        >本月</button>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted font-body"
          @click="managerOpen = true"
        >账户 / 分类</button>
        <button
          class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-body"
          @click="openAdd"
        >
          <span class="material-symbols-outlined text-base">add</span>
          记一笔
        </button>
      </div>
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
      {{ loading ? '加载中…' : '本月还没有账目，点击右上角「记一笔」开始' }}
    </div>

    <TransactionDialog
      v-model="dialogOpen"
      :accounts="accounts"
      :categories="categories"
      :transaction="editing"
      @saved="reload"
    />
    <AccountManager
      v-model="managerOpen"
      :accounts="allAccounts"
      :categories="categories"
      @changed="reloadAll"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import TransactionDialog from './TransactionDialog.vue'
import AccountManager from './AccountManager.vue'

const PAGE_SIZE = 60

const month = ref(currentMonth())
const stats = ref({})
const accounts = ref([])
const allAccounts = ref([])
const categories = ref([])
const items = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref('')

const dialogOpen = ref(false)
const editing = ref(null)
const managerOpen = ref(false)

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

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
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
  const account = tx.account_name || ''
  return tx.note ? `${account} · ${tx.note}` : account
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
    const res = await api.financeTransactions({ month: month.value, page: page.value, page_size: PAGE_SIZE })
    const d = res.data || {}
    items.value = reset ? (d.items || []) : items.value.concat(d.items || [])
    total.value = d.total || 0
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

async function reloadAll() {
  await reload()
}

function loadMore() {
  page.value += 1
  loadTransactions(false)
}

function shiftMonth(n) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  month.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  loadStats()
  loadTransactions()
}

function goCurrentMonth() {
  month.value = currentMonthValue
  loadStats()
  loadTransactions()
}

function openAdd() {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(tx) {
  if (tx.type === 'transfer') return
  editing.value = tx
  dialogOpen.value = true
}

async function remove(tx) {
  if (!window.confirm(`删除这笔「${titleOf(tx)}」账目？`)) return
  try {
    await api.deleteFinanceTransaction(tx.id)
    await reload()
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

onMounted(reload)
</script>

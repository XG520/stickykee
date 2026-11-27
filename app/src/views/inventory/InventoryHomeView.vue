<template>
  <div class="py-2 space-y-4 max-w-3xl mx-auto lg:max-w-none">
    <!-- 标题 -->
    <header class="flex items-end justify-between gap-3">
      <div>
        <h1 class="font-headline text-2xl font-semibold leading-tight">
          <span class="lg:hidden">生活</span>
          <span class="hidden lg:inline">概览</span>
        </h1>
        <p class="mt-0.5 text-[11px] text-muted font-body">
          <span class="lg:hidden">{{ todayLabel }}</span>
          <span class="hidden lg:inline">库存、购物与账本总览</span>
        </p>
      </div>
      <button
        v-if="auth.financeView"
        class="h-9 md:h-10 px-3 md:px-4 rounded-full bg-surface-alt border border-border text-[11px] md:text-xs text-muted font-body flex items-center gap-1 hover:text-on-surface hover:border-primary/40 transition-colors"
        @click="go('/inventory/finance/ledger')"
      >
        <span class="material-symbols-outlined text-base">account_balance_wallet</span>
        账本明细
      </button>
    </header>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 仪表盘栅格：移动端保持「主卡 → 库存/购物 → 快捷操作」，桌面端重排为 8/4 分栏 -->
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-4">
      <!-- 账本主卡：视觉焦点（需管理员授权的记账查看权限） -->
      <button
        v-if="auth.financeView"
        class="col-span-2 order-1 lg:col-span-8 lg:col-start-1 lg:row-start-1 w-full text-left rounded-3xl bg-surface border border-border p-5 lg:p-6 transition-transform active:scale-[.99] hover:border-primary/35"
        @click="go('/inventory/finance/ledger')"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[11px] text-muted font-body">{{ monthText(financeMonth) }}支出</div>
            <div class="mt-1 font-headline text-[32px] lg:text-[40px] leading-none font-semibold tabular-nums truncate">
              {{ money(stats.expense) }}
            </div>
          </div>
          <span class="material-symbols-outlined text-muted text-xl">chevron_right</span>
        </div>

        <div class="mt-3 flex items-center gap-3 text-[11px] font-body">
          <span class="text-muted">收入 <span class="text-accent font-medium">{{ money(stats.income) }}</span></span>
          <span class="text-muted">结余 <span :class="balance >= 0 ? 'text-accent' : 'text-error'" class="font-medium">{{ money(balance) }}</span></span>
        </div>

        <!-- 近 7 天支出迷你折线 -->
        <div class="mt-3 lg:mt-4 flex items-end gap-3">
          <svg class="flex-1 h-10 lg:h-16" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              :points="sparkPoints"
              fill="none"
              stroke="rgb(var(--c-primary))"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <span class="text-[10px] text-faint font-body whitespace-nowrap">近 7 天</span>
        </div>

        <div v-if="Number(stats.budget_total) > 0" class="mt-3">
          <div class="h-1.5 rounded-full bg-surface-alt overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="Number(stats.budget_left) < 0 ? 'bg-error' : 'bg-primary'"
              :style="{ width: Math.min(100, Math.max(0, Number(stats.budget_pct) || 0)) + '%' }"
            ></div>
          </div>
          <div class="mt-1 text-[10px] font-body" :class="Number(stats.budget_left) < 0 ? 'text-error' : 'text-muted'">
            {{ Number(stats.budget_left) < 0 ? '已超支 ' + money(-stats.budget_left) : '预算剩余 ' + money(stats.budget_left) }}
          </div>
        </div>
      </button>

      <!-- 快捷操作：移动端仍为四宫格，桌面端升为独立卡片 -->
      <div class="col-span-2 order-4 lg:col-span-4 lg:col-start-9 lg:row-start-1 pt-1 lg:pt-0 rounded-2xl lg:rounded-3xl lg:bg-surface lg:border lg:border-border lg:p-4 lg:flex lg:flex-col">
        <div class="hidden lg:flex items-center justify-between mb-3">
          <span class="text-sm font-medium font-body">快捷操作</span>
          <span class="material-symbols-outlined text-muted text-base">bolt</span>
        </div>
        <div class="grid grid-cols-4 lg:grid-cols-2 gap-2 lg:gap-3 lg:flex-1 lg:content-center">
          <button class="hc-quick" @click="go('/inventory/stock?scan=1')">
            <span class="hc-quick__icon"><span class="material-symbols-outlined text-xl">qr_code_scanner</span></span>
            <span class="hc-quick__label">扫码入库</span>
          </button>
          <button v-if="auth.financeOperate" class="hc-quick" @click="go('/inventory/finance/add')">
            <span class="hc-quick__icon hc-quick__icon--primary"><span class="material-symbols-outlined text-xl">add</span></span>
            <span class="hc-quick__label">记一笔</span>
          </button>
          <button class="hc-quick" @click="go('/inventory/stock?stocktake=1')">
            <span class="hc-quick__icon"><span class="material-symbols-outlined text-xl">fact_check</span></span>
            <span class="hc-quick__label">盘点</span>
          </button>
          <button class="hc-quick" @click="go('/inventory/shopping')">
            <span class="hc-quick__icon"><span class="material-symbols-outlined text-xl">add_shopping_cart</span></span>
            <span class="hc-quick__label">加购物项</span>
          </button>
        </div>
      </div>

      <!-- 库存 / 购物 卡 -->
      <button
        class="col-span-1 order-2 lg:col-span-6 lg:col-start-1 lg:row-start-2 text-left rounded-2xl bg-surface border p-4 lg:p-5 transition-transform active:scale-[.98] hover:border-primary/35"
        :class="hasStockAlert ? 'border-error/30' : 'border-border'"
        @click="go('/inventory/stock')"
      >
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted font-body">库存</span>
          <span class="material-symbols-outlined text-base text-muted">inventory_2</span>
        </div>
        <div class="mt-2 font-headline text-2xl lg:text-3xl font-semibold tabular-nums leading-none">
          {{ inv.total || 0 }}<span class="text-[11px] text-muted font-body ml-1">件</span>
        </div>
        <div class="mt-2 text-[10px] font-body" :class="hasStockAlert ? 'text-error' : 'text-muted'">
          临期 {{ inv.expiring || 0 }} · 补货 {{ inv.low_stock || 0 }}
        </div>
      </button>

      <button
        class="col-span-1 order-3 lg:col-span-6 lg:col-start-7 lg:row-start-2 text-left rounded-2xl bg-surface border border-border p-4 lg:p-5 transition-transform active:scale-[.98] hover:border-primary/35"
        @click="go('/inventory/shopping')"
      >
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted font-body">购物清单</span>
          <span class="material-symbols-outlined text-base text-muted">shopping_cart</span>
        </div>
        <div class="mt-2 font-headline text-2xl lg:text-3xl font-semibold tabular-nums leading-none">
          {{ shopCount }}<span class="text-[11px] text-muted font-body ml-1">项待买</span>
        </div>
        <div class="mt-2 text-[10px] text-muted font-body">
          {{ shopCount ? '缺什么就加什么' : '清单是空的' }}
        </div>
      </button>
    </div>

    <!-- 最近账目（参照原型图，仅账本可见权限用户展示） -->
    <section
      v-if="auth.financeView"
      class="rounded-2xl bg-surface border border-border overflow-hidden lg:rounded-3xl"
    >
      <div class="flex items-center justify-between px-4 py-3 lg:px-5 lg:py-3.5">
        <div class="text-sm font-medium font-body">最近账目</div>
        <button
          class="text-[11px] text-primary font-body flex items-center gap-0.5 hover:text-primary/80"
          @click="go('/inventory/finance/ledger')"
        >
          全部
          <span class="material-symbols-outlined text-base">chevron_right</span>
        </button>
      </div>

      <div v-if="recent.length" class="divide-y divide-border">
        <button
          v-for="tx in recent"
          :key="tx.id"
          class="w-full hc-tx-row"
          @click="go(`/inventory/finance/ledger?open=${tx.id}`)"
        >
          <span class="hc-tx-row__icon" :class="tx.type === 'expense' ? '' : 'hc-tx-row__icon--income'">
            <span class="material-symbols-outlined text-base">{{ hcIcon(tx) }}</span>
          </span>
          <div class="flex-1 min-w-0 text-left">
            <div class="hc-tx-row__title">{{ hcTitle(tx) }}</div>
            <div class="hc-tx-row__sub">{{ hcSub(tx) }}</div>
          </div>
          <div class="text-right shrink-0 ml-2">
            <div class="font-headline text-[15px] font-semibold tabular-nums leading-none" :class="tx.type === 'income' ? 'text-accent' : 'text-on-surface'">
              {{ tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : '' }}{{ money(tx.amount) }}
            </div>
            <div v-if="hcCreator(tx)" class="mt-1 text-[10px] text-faint font-body truncate max-w-[5rem] ml-auto">{{ hcCreator(tx) }}</div>
          </div>
        </button>
      </div>
      <div v-else class="px-4 py-5 text-center text-[11px] text-muted font-body">还没有账目记录</div>
    </section>

    <p v-if="loading" class="text-center text-[11px] text-muted font-body py-2">加载中…</p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import { auth } from '@/store'
import { financeMonth } from '@/store/finance'
import { money, monthText, pad2 } from '@/utils/finance'

const router = useRouter()

const stats = ref({})
const inv = ref({})
const shopCount = ref(0)
const recent = ref([])
const loading = ref(false)
const error = ref('')

const balance = computed(() => Number(stats.value.income || 0) - Number(stats.value.expense || 0))
const hasStockAlert = computed(() => Number(inv.value.expiring || 0) > 0 || Number(inv.value.low_stock || 0) > 0)

const todayLabel = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`
})

// 主卡折线：本月最后 7 天（无数据时画平线）
const sparkPoints = computed(() => {
  const byDay = {}
  for (const d of stats.value.by_day || []) byDay[d.day] = Number(d.expense || 0)
  const now = new Date()
  const values = []
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000)
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    values.push(byDay[key] || 0)
  }
  const max = Math.max(1, ...values)
  return values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${26 - (v / max) * 20}`)
    .join(' ')
})

function go(path) {
  router.push(path)
}

// 最近账目 helper（与 FinanceLedgerView 保持一致）
function hcIcon(tx) {
  if (tx.type === 'transfer') return 'sync_alt'
  if (tx.type === 'income') return 'payments'
  return 'receipt_long'
}
function hcTitle(tx) {
  const c = tx.category_name ? String(tx.category_name).trim() : ''
  return c || String(tx.note || '').trim() || '未分类'
}
function hcSub(tx) {
  const parts = []
  const when = formatWhen(tx.occurred_at)
  if (when) parts.push(when)
  if (tx.type === 'transfer') {
    if (tx.account_name) parts.push(tx.account_name)
    if (tx.to_account_name) parts.push('→ ' + tx.to_account_name)
  } else {
    if (tx.account_name) parts.push(tx.account_name)
  }
  return parts.join(' · ')
}
function hcCreator(tx) {
  return String(tx.created_by || '').trim() || ''
}
function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d)) return ''
  const now = new Date()
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay(d, now)) return `今天 ${hh}:${mm}`
  const yest = new Date(now.getTime() - 86400000)
  if (sameDay(d, yest)) return `昨天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    // 无记账查看权限时不请求账本数据（后端也会 403），避免首页报错。
    const finPromise = auth.financeView ? api.financeStats(financeMonth.value) : Promise.resolve({ data: {} })
    const recentPromise = auth.financeView
      ? api.financeTransactions({ page: 1, page_size: 5, type: 'all' })
      : Promise.resolve({ data: [] })
    const [fin, invRes, shop, rec] = await Promise.all([
      finPromise,
      api.inventoryStats(3),
      api.inventoryShopping(false),
      recentPromise,
    ])
    stats.value = fin.data || {}
    inv.value = invRes.data || {}
    shopCount.value = (shop.data || []).length
    recent.value = rec.data || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hc-tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  transition: background-color .12s ease;
  color: rgb(var(--c-on-surface));
}
.hc-tx-row:hover { background: rgb(var(--c-surface-alt) / .6); }
.hc-tx-row:active { background: rgb(var(--c-surface-alt)); }
.hc-tx-row__icon {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  flex-shrink: 0;
}
.hc-tx-row__icon--income { color: rgb(var(--c-accent)); }
.hc-tx-row__title {
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hc-tx-row__sub {
  margin-top: 2px;
  font-size: 11px;
  font-family: var(--font-body);
  color: rgb(var(--c-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (min-width: 1024px) {
  .hc-tx-row { padding: 14px 20px; gap: 14px; }
  .hc-tx-row__icon { width: 40px; height: 40px; }
  .hc-tx-row__title { font-size: 15px; }
}
.hc-quick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}
.hc-quick__icon {
  width: 52px;
  height: 52px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  color: rgb(var(--c-on-surface));
  transition: transform .12s ease, background-color .15s ease;
}
.hc-quick__icon--primary {
  background: rgb(var(--c-primary));
  border-color: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
  box-shadow: 0 8px 20px rgb(var(--c-primary) / .22);
}
.hc-quick:active .hc-quick__icon {
  transform: scale(.94);
}
.hc-quick__label {
  font-size: 11px;
  color: rgb(var(--c-muted));
  font-family: var(--font-body);
}
@media (min-width: 1024px) {
  .hc-quick__icon {
    width: 56px;
    height: 56px;
  }
  .hc-quick__label {
    font-size: 12px;
  }
}
</style>

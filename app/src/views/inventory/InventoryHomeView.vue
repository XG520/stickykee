<template>
  <div class="py-2 space-y-4 max-w-3xl mx-auto">
    <!-- 标题 -->
    <header class="flex items-end justify-between gap-3">
      <div>
        <h1 class="font-headline text-2xl font-semibold leading-tight">生活</h1>
        <p class="mt-0.5 text-[11px] text-muted font-body">{{ todayLabel }}</p>
      </div>
      <button
        class="h-9 px-3 rounded-full bg-surface-alt border border-border text-[11px] text-muted font-body flex items-center gap-1"
        @click="go('/inventory/finance/ledger')"
      >
        <span class="material-symbols-outlined text-base">account_balance_wallet</span>
        账本明细
      </button>
    </header>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 账本主卡：视觉焦点 -->
    <button
      class="w-full text-left rounded-3xl bg-surface border border-border p-5 transition-transform active:scale-[.98]"
      @click="go('/inventory/finance/ledger')"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[11px] text-muted font-body">{{ monthText(financeMonth) }}支出</div>
          <div class="mt-1 font-headline text-[32px] leading-none font-semibold tabular-nums truncate">
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
      <div class="mt-3 flex items-end gap-3">
        <svg class="flex-1 h-10" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
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

    <!-- 库存 / 购物 两列卡 -->
    <div class="grid grid-cols-2 gap-3">
      <button
        class="text-left rounded-2xl bg-surface border p-4 transition-transform active:scale-[.98]"
        :class="hasStockAlert ? 'border-error/30' : 'border-border'"
        @click="go('/inventory/stock')"
      >
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted font-body">库存</span>
          <span class="material-symbols-outlined text-base text-muted">inventory_2</span>
        </div>
        <div class="mt-2 font-headline text-2xl font-semibold tabular-nums leading-none">
          {{ inv.total || 0 }}<span class="text-[11px] text-muted font-body ml-1">件</span>
        </div>
        <div class="mt-2 text-[10px] font-body" :class="hasStockAlert ? 'text-error' : 'text-muted'">
          临期 {{ inv.expiring || 0 }} · 补货 {{ inv.low_stock || 0 }}
        </div>
      </button>

      <button
        class="text-left rounded-2xl bg-surface border border-border p-4 transition-transform active:scale-[.98]"
        @click="go('/inventory/shopping')"
      >
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted font-body">购物清单</span>
          <span class="material-symbols-outlined text-base text-muted">shopping_cart</span>
        </div>
        <div class="mt-2 font-headline text-2xl font-semibold tabular-nums leading-none">
          {{ shopCount }}<span class="text-[11px] text-muted font-body ml-1">项待买</span>
        </div>
        <div class="mt-2 text-[10px] text-muted font-body">
          {{ shopCount ? '缺什么就加什么' : '清单是空的' }}
        </div>
      </button>
    </div>

    <!-- 快捷操作 -->
    <div class="grid grid-cols-4 gap-2 pt-1">
      <button class="hc-quick" @click="go('/inventory/stock?scan=1')">
        <span class="hc-quick__icon"><span class="material-symbols-outlined text-xl">qr_code_scanner</span></span>
        <span class="hc-quick__label">扫码入库</span>
      </button>
      <button class="hc-quick" @click="go('/inventory/finance/add')">
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

    <p v-if="loading" class="text-center text-[11px] text-muted font-body py-2">加载中…</p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import { financeMonth } from '@/store/finance'
import { money, monthText, pad2 } from '@/utils/finance'

const router = useRouter()

const stats = ref({})
const inv = ref({})
const shopCount = ref(0)
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

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [fin, invRes, shop] = await Promise.all([
      api.financeStats(financeMonth.value),
      api.inventoryStats(3),
      api.inventoryShopping(false),
    ])
    stats.value = fin.data || {}
    inv.value = invRes.data || {}
    shopCount.value = (shop.data || []).length
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
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
</style>

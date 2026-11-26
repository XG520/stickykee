<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto">
    <FinanceHeader title="计划" subtitle="预算与周期账单">
      <button class="hc-ic" aria-label="预算设置" @click="budgetOpen = true">
        <span class="material-symbols-outlined">savings</span>
      </button>
    </FinanceHeader>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 月份切换：预算按所选月份展示 -->
    <div class="flex items-center gap-0.5">
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
        @click="financeMonth = currentMonthValue"
      >本月</button>
    </div>

    <!-- 本月预算 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium font-body">{{ monthText(financeMonth) }}预算</div>
        <button class="text-[11px] text-primary font-body" @click="budgetOpen = true">调整</button>
      </div>

      <template v-if="Number(stats.budget_total) > 0">
        <div class="flex items-end justify-between gap-3">
          <div>
            <div class="font-headline text-[26px] leading-none font-semibold tabular-nums">{{ money(stats.expense) }}</div>
            <div class="mt-1 text-[11px] text-muted font-body">已用 / 预算 {{ money(stats.budget_total) }}</div>
          </div>
          <div class="text-right text-[11px] font-body" :class="Number(stats.budget_left) < 0 ? 'text-error' : 'text-muted'">
            {{ Number(stats.budget_left) < 0 ? '已超支 ' + money(-stats.budget_left) : '剩余 ' + money(stats.budget_left) }}
          </div>
        </div>
        <div class="h-2.5 rounded-full bg-surface-alt overflow-hidden">
          <div
            class="h-full rounded-full"
            :class="Number(stats.budget_left) < 0 ? 'bg-error' : 'bg-primary'"
            :style="{ width: Math.min(100, Math.max(0, Number(stats.budget_pct) || 0)) + '%' }"
          ></div>
        </div>
        <div class="text-[11px] text-muted font-body">已用 {{ Number(stats.budget_pct || 0).toFixed(0) }}%</div>
      </template>
      <template v-else>
        <p class="text-xs text-muted font-body">还没有设置本月预算，设置后可随时查看使用进度。</p>
        <button class="h-10 px-4 rounded-xl bg-primary text-on-primary text-sm font-body" @click="budgetOpen = true">设置预算</button>
      </template>
    </section>

    <!-- 分类预算 -->
    <section v-if="budgets.length" class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="text-sm font-medium font-body">分类预算进度</div>
      <div v-for="b in budgets" :key="b.category_id" class="space-y-1">
        <div class="flex items-center justify-between text-xs font-body">
          <span class="truncate">{{ b.name }}</span>
          <span :class="Number(b.left) < 0 ? 'text-error' : 'text-muted'" class="flex-shrink-0 ml-2">
            {{ money(b.spent) }} / {{ money(b.budget) }}
          </span>
        </div>
        <div class="h-1.5 rounded-full bg-surface-alt overflow-hidden">
          <div
            class="h-full rounded-full"
            :class="Number(b.left) < 0 ? 'bg-error' : 'bg-primary'"
            :style="{ width: Math.min(100, Math.max(0, Number(b.pct) || 0)) + '%' }"
          ></div>
        </div>
        <div class="text-[10px] font-body" :class="Number(b.left) < 0 ? 'text-error' : 'text-muted'">
          {{ Number(b.left) < 0 ? '超支 ' + money(-b.left) : '剩余 ' + money(b.left) }}
        </div>
      </div>
    </section>

    <!-- 周期账单 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium font-body">周期账单</div>
        <button class="text-[11px] text-primary font-body" @click="openManager('recurring')">新增</button>
      </div>

      <div v-if="recurring.length" class="divide-y divide-border">
        <div v-for="x in recurring" :key="x.id" class="flex items-center gap-3 py-2.5">
          <div class="w-9 h-9 rounded-full bg-surface-alt flex items-center justify-center flex-shrink-0 text-muted">
            <span class="material-symbols-outlined text-lg">{{ x.type === 'income' ? 'payments' : 'receipt_long' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-sm truncate">{{ x.name }}</span>
              <span v-if="!x.enabled" class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-alt text-muted font-body">已暂停</span>
            </div>
            <div class="text-[11px] text-muted font-body truncate">
              {{ money(x.amount) }} · 每月 {{ x.day_of_month }} 日 · {{ x.account_name || '账户已删除' }}
            </div>
          </div>
          <button class="h-8 px-2.5 rounded-full border text-[11px] font-body" :class="x.enabled ? 'border-border text-muted' : 'border-primary/40 text-primary'" @click="toggleRecurring(x)">
            {{ x.enabled ? '暂停' : '启用' }}
          </button>
          <button class="w-8 h-8 flex items-center justify-center text-muted hover:text-error" aria-label="删除" @click="removeRecurring(x)">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body py-3 text-center">暂无周期账单</div>
    </section>

    <BudgetDialog v-model="budgetOpen" :month="financeMonth" :categories="categories" @saved="load" />
    <AccountManager
      v-model="managerOpen"
      :accounts="allAccounts"
      :categories="categories"
      initial-tab="recurring"
      @changed="load"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import BudgetDialog from '@/components/finance/BudgetDialog.vue'
import AccountManager from '@/components/finance/AccountManager.vue'
import { financeMonth, shiftFinanceMonth } from '@/store/finance'
import { currentMonth, money, monthText } from '@/utils/finance'
import { confirmAction } from '@/composables/useConfirm'

const currentMonthValue = currentMonth()

const stats = ref({})
const categories = ref([])
const allAccounts = ref([])
const recurring = ref([])
const budgetOpen = ref(false)
const managerOpen = ref(false)
const error = ref('')

const budgets = computed(() => (stats.value.budgets || []).filter((b) => Number(b.budget) > 0))

function openManager() {
  managerOpen.value = true
}

function recurringPayload(x, enabled) {
  return {
    name: x.name,
    type: x.type,
    amount: x.amount,
    account_id: x.account_id,
    category_id: x.category_id,
    day_of_month: x.day_of_month,
    enabled,
  }
}

async function toggleRecurring(x) {
  try {
    await api.updateFinanceRecurring(x.id, recurringPayload(x, !x.enabled))
    await load()
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

async function removeRecurring(x) {
  const ok = await confirmAction({
    title: '删除周期账单',
    message: `删除周期账单「${x.name}」？`,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteFinanceRecurring(x.id)
    await load()
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function load() {
  error.value = ''
  try {
    const [st, cats, rec, accs] = await Promise.all([
      api.financeStats(financeMonth.value),
      api.financeCategories(),
      api.financeRecurring(),
      api.financeAccounts(true),
    ])
    stats.value = st.data || {}
    categories.value = cats.data || []
    recurring.value = rec.data || []
    allAccounts.value = accs.data || []
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

watch(financeMonth, load)
onMounted(load)
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
</style>

<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto">
    <FinanceHeader title="图表" subtitle="看清钱花在哪里">
      <button class="hc-ic" aria-label="切到我的" @click="router.push('/inventory/finance/me')">
        <span class="material-symbols-outlined">person</span>
      </button>
    </FinanceHeader>

    <!-- 月份 -->
    <div class="flex items-center justify-between gap-2">
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
          @click="goCurrentMonth"
        >本月</button>
      </div>
    </div>

    <!-- 收支切换 -->
    <div class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-surface-alt">
      <button
        class="hc-seg"
        :class="type === 'expense' ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
        @click="type = 'expense'"
      >支出</button>
      <button
        class="hc-seg"
        :class="type === 'income' ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
        @click="type = 'income'"
      >收入</button>
    </div>

    <!-- 时间维度：P0 仅月，周/年置灰 -->
    <div class="flex items-center gap-1.5">
      <button class="hc-chip" disabled title="即将支持">周</button>
      <button class="hc-chip hc-chip--on">月</button>
      <button class="hc-chip" disabled title="即将支持">年</button>
      <span class="ml-auto text-[11px] text-muted font-body">{{ monthText(financeMonth) }}</span>
    </div>

    <!-- 总额 -->
    <section class="rounded-2xl bg-surface border border-border p-4">
      <div class="text-[11px] text-muted font-body">总{{ type === 'income' ? '收入' : '支出' }}</div>
      <div class="mt-1 font-headline text-[30px] leading-none font-semibold tabular-nums" :class="type === 'income' ? 'text-accent' : ''">
        {{ money(total) }}
      </div>
      <div class="mt-2 text-[11px] text-muted font-body">日均 {{ money(dailyAvg) }} · 共 {{ count }} 笔</div>
    </section>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 分类占比 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="text-sm font-medium font-body">分类{{ type === 'income' ? '收入' : '支出' }}</div>

      <div v-if="catRows.length" class="flex justify-center">
        <svg viewBox="0 0 100 100" class="w-32 h-32 -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r="40" fill="none" stroke="rgb(var(--c-surface-alt))" stroke-width="14" />
          <circle
            v-for="(s, i) in donut"
            :key="i"
            cx="50"
            cy="50"
            r="40"
            fill="none"
            :stroke="s.color"
            stroke-width="14"
            :stroke-dasharray="s.dash"
            :stroke-dashoffset="s.offset"
            stroke-linecap="butt"
          />
        </svg>
      </div>

      <div v-if="catRows.length" class="space-y-2.5">
        <div v-for="(c, i) in catRows" :key="c.id" class="space-y-1">
          <div class="flex items-center justify-between gap-2 text-xs font-body">
            <span class="flex items-center gap-1.5 min-w-0">
              <i class="w-2 h-2 rounded-full inline-block flex-shrink-0" :style="{ background: colorOf(i) }"></i>
              <span class="truncate">{{ c.name }}</span>
            </span>
            <span class="text-muted flex-shrink-0">{{ money(c.amount) }} · {{ Number(c.percent || 0).toFixed(0) }}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-surface-alt overflow-hidden">
            <div class="h-full rounded-full" :style="{ width: Math.min(100, Number(c.percent) || 0) + '%', background: colorOf(i) }"></div>
          </div>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body py-4 text-center">本月暂无{{ type === 'income' ? '收入' : '支出' }}</div>
    </section>

    <!-- 趋势 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium font-body">近 6 月趋势</div>
        <span class="text-[11px] text-muted font-body">{{ type === 'income' ? '收入' : '支出' }}</span>
      </div>
      <div v-if="trend.length" class="relative">
        <svg viewBox="0 0 300 120" class="w-full h-[140px]" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="100" x2="300" y2="100" stroke="rgb(var(--c-border))" stroke-width="1" />
          <polyline
            :points="trendPoints"
            fill="none"
            :stroke="type === 'income' ? 'rgb(var(--c-accent))' : 'rgb(var(--c-primary))'"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
          <circle
            v-for="(p, i) in trendDots"
            :key="i"
            :cx="p.x"
            :cy="p.y"
            r="2.6"
            :fill="type === 'income' ? 'rgb(var(--c-accent))' : 'rgb(var(--c-primary))'"
          >
            <title>{{ p.month }} {{ money(p.value) }}</title>
          </circle>
        </svg>
        <div class="flex justify-between mt-1 text-[10px] text-muted font-body">
          <span v-for="p in trend" :key="p.month">{{ p.month.slice(5) }}月</span>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body py-4 text-center">暂无趋势数据</div>
    </section>

    <!-- 预算 -->
    <section v-if="Number(stats.budget_total) > 0" class="rounded-2xl bg-surface border border-border p-4 space-y-2">
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
    </section>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import { financeMonth, shiftFinanceMonth } from '@/store/finance'
import { currentMonth, money, monthText } from '@/utils/finance'

defineOptions({ name: 'FinanceChartsView' })

const router = useRouter()
const currentMonthValue = currentMonth()

const type = ref('expense')
const stats = ref({})
const trend = ref([])
const incomeRows = ref([])
const expenseCount = ref(0)
const incomeCount = ref(0)
const error = ref('')

const segmentColors = [
  'rgb(var(--c-primary))',
  'rgb(var(--c-accent))',
  'rgb(var(--c-info))',
  'rgb(var(--c-warning))',
  'rgb(var(--c-error))',
  'rgb(var(--c-success))',
]

const total = computed(() => Number(type.value === 'income' ? stats.value.income : stats.value.expense) || 0)
const count = computed(() => (type.value === 'income' ? incomeCount.value : expenseCount.value))
const daysInMonth = computed(() => {
  const [y, m] = financeMonth.value.split('-').map(Number)
  if (!y || !m) return 30
  return new Date(y, m, 0).getDate()
})
const dailyAvg = computed(() => {
  const now = new Date()
  const isCurrent = financeMonth.value === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const days = isCurrent ? Math.max(1, now.getDate()) : daysInMonth.value
  return Math.round(total.value / days)
})

const catRows = computed(() => {
  if (type.value === 'expense') return (stats.value.by_category || []).slice(0, 8)
  return incomeRows.value.slice(0, 8)
})

const donut = computed(() => {
  const rows = catRows.value
  const sum = rows.reduce((n, r) => n + Number(r.amount || 0), 0) || 1
  const C = 2 * Math.PI * 40
  let acc = 0
  return rows.map((r, i) => {
    const len = (Number(r.amount || 0) / sum) * C
    const seg = {
      color: segmentColors[i % segmentColors.length],
      dash: `${len} ${C - len}`,
      offset: -acc,
    }
    acc += len
    return seg
  })
})

const trendPoints = computed(() => {
  if (!trend.value.length) return ''
  const key = type.value === 'income' ? 'income' : 'expense'
  const values = trend.value.map((p) => Number(p[key] || 0))
  const max = Math.max(1, ...values)
  const n = values.length
  return values
    .map((v, i) => {
      const x = n === 1 ? 150 : (i / (n - 1)) * 290 + 5
      const y = 100 - (v / max) * 88
      return `${x},${y}`
    })
    .join(' ')
})

const trendDots = computed(() => {
  if (!trend.value.length) return []
  const key = type.value === 'income' ? 'income' : 'expense'
  const values = trend.value.map((p) => Number(p[key] || 0))
  const max = Math.max(1, ...values)
  const n = values.length
  return trend.value.map((p, i) => ({
    month: p.month,
    value: Number(p[key] || 0),
    x: n === 1 ? 150 : (i / (n - 1)) * 290 + 5,
    y: 100 - (Number(p[key] || 0) / max) * 88,
  }))
})

function colorOf(i) {
  return segmentColors[i % segmentColors.length]
}

async function loadStats() {
  try {
    const res = await api.financeStats(financeMonth.value)
    stats.value = res.data || {}
  } catch (e) {
    error.value = e.message || ''
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

// 收入分类占比：stats 仅返回支出分类，收入按月拉取流水后在前端聚合（每月收入笔数通常很少）。
async function loadIncome() {
  const all = []
  let page = 1
  try {
    for (;;) {
      const res = await api.financeTransactions({ month: financeMonth.value, type: 'income', page, page_size: 200 })
      const d = res.data || {}
      all.push(...(d.items || []))
      if (all.length >= (d.total || 0) || page >= 5) break
      page += 1
    }
    const map = new Map()
    for (const tx of all) {
      const key = tx.category_id || 0
      const row = map.get(key) || { id: key, name: tx.category_name || '未分类', amount: 0 }
      row.amount += Number(tx.amount || 0)
      map.set(key, row)
    }
    const sum = all.reduce((n, tx) => n + Number(tx.amount || 0), 0) || 1
    incomeRows.value = [...map.values()]
      .map((r) => ({ ...r, percent: (r.amount / sum) * 100 }))
      .sort((a, b) => b.amount - a.amount)
  } catch (e) {
    error.value = e.message || ''
  }
}

async function loadCounts() {
  try {
    const [exp, inc] = await Promise.all([
      api.financeTransactions({ month: financeMonth.value, type: 'expense', page: 1, page_size: 1 }),
      api.financeTransactions({ month: financeMonth.value, type: 'income', page: 1, page_size: 1 }),
    ])
    expenseCount.value = (exp.data || {}).total || 0
    incomeCount.value = (inc.data || {}).total || 0
  } catch { /* 计数失败不影响图表主体 */ }
}

async function load() {
  error.value = ''
  await Promise.all([loadStats(), loadTrend(), loadIncome(), loadCounts()])
}

function goCurrentMonth() {
  financeMonth.value = currentMonthValue
}

watch(financeMonth, load)

let activatedOnce = false
onMounted(load)
onActivated(() => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  load()
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

.hc-seg {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  border-radius: 12px;
  font-size: 13px;
  font-family: var(--font-body);
  transition: background-color .18s, color .18s;
}

.hc-chip {
  height: 30px;
  padding: 0 14px;
  border-radius: 9999px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  font-size: 12px;
  font-family: var(--font-body);
}
.hc-chip--on {
  background: rgb(var(--c-primary));
  border-color: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
}
.hc-chip:disabled { opacity: .4; }
</style>

<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto">
    <FinanceHeader title="图表" subtitle="看清每个周期的钱花在哪里" />

    <!-- 时间维度 -->
    <div class="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-surface-alt">
      <button
        v-for="d in dims"
        :key="d.value"
        class="hc-seg"
        :class="dim === d.value ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
        @click="dim = d.value"
      >{{ d.label }}</button>
    </div>

    <!-- 周期切换 -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-0.5 min-w-0">
        <button class="hc-ic-sm" aria-label="上一周期" @click="movePeriod(-1)">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <div class="text-sm font-medium font-body min-w-[104px] text-center truncate">{{ rangeLabel }}</div>
        <button class="hc-ic-sm" aria-label="下一周期" @click="movePeriod(1)">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
        <button
          v-if="!isCurrentPeriod"
          class="ml-1 h-7 px-2.5 rounded-full text-[11px] text-primary border border-primary/35 bg-primary/5 font-body whitespace-nowrap"
          @click="goCurrent"
        >本期</button>
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

    <!-- 总额 -->
    <section class="rounded-2xl bg-surface border border-border p-4">
      <div class="text-[11px] text-muted font-body">总{{ type === 'income' ? '收入' : '支出' }}</div>
      <div class="mt-1 font-headline text-[30px] leading-none font-semibold tabular-nums" :class="type === 'income' ? 'text-accent' : ''">
        {{ money(total) }}
      </div>
      <div class="mt-2 text-[11px] text-muted font-body">
        日均 {{ money(dailyAvg) }} · 共 {{ count }} 笔 · {{ avgDays }} 天
      </div>
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
        <div v-for="(c, i) in catRows" :key="c.category_id || c.name" class="space-y-1">
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
      <div v-else class="text-xs text-muted font-body py-4 text-center">当前周期暂无{{ type === 'income' ? '收入' : '支出' }}</div>
    </section>

    <!-- 趋势 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium font-body">{{ dim === 'year' ? '月度' : '每日' }}趋势</div>
        <span class="text-[11px] text-muted font-body">{{ type === 'income' ? '收入' : '支出' }}</span>
      </div>
      <div v-if="seq.length" class="relative">
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
            <title>{{ p.label }} {{ money(p.value) }}</title>
          </circle>
        </svg>
        <div class="relative h-3 mt-1">
          <span
            v-for="(l, i) in xLabels"
            :key="i"
            class="absolute -translate-x-1/2 text-[9px] text-muted font-body whitespace-nowrap"
            :style="{ left: l.pct + '%' }"
          >{{ l.text }}</span>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body py-4 text-center">暂无趋势数据</div>
    </section>

    <!-- 预算（仅月） -->
    <section v-if="dim === 'month' && Number(budgetStats.budget_total) > 0" class="rounded-2xl bg-surface border border-border p-4 space-y-2">
      <div class="flex items-center justify-between text-xs font-body">
        <span class="text-muted">本月预算</span>
        <span :class="Number(budgetStats.budget_left) < 0 ? 'text-error' : 'text-muted'">
          已用 {{ money(budgetStats.expense) }} / {{ money(budgetStats.budget_total) }}
        </span>
      </div>
      <div class="h-2 rounded-full bg-surface-alt overflow-hidden">
        <div
          class="h-full rounded-full"
          :class="Number(budgetStats.budget_left) < 0 ? 'bg-error' : 'bg-primary'"
          :style="{ width: Math.min(100, Math.max(0, Number(budgetStats.budget_pct) || 0)) + '%' }"
        ></div>
      </div>
      <div class="text-[11px] font-body" :class="Number(budgetStats.budget_left) < 0 ? 'text-error' : 'text-muted'">
        {{ Number(budgetStats.budget_left) < 0 ? '已超支 ' + money(-budgetStats.budget_left) : '剩余 ' + money(budgetStats.budget_left) }}
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, watch } from 'vue'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import { financeMonth, shiftFinanceMonth } from '@/store/finance'
import { currentMonth, money, monthText, pad2 } from '@/utils/finance'

defineOptions({ name: 'FinanceChartsView' })

const dims = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
]

const type = ref('expense')
const dim = ref('month')
const anchor = ref(new Date())
const report = ref({})
const budgetStats = ref({})
const error = ref('')

const currentMonthValue = currentMonth()

const segmentColors = [
  'rgb(var(--c-primary))',
  'rgb(var(--c-accent))',
  'rgb(var(--c-info))',
  'rgb(var(--c-warning))',
  'rgb(var(--c-error))',
  'rgb(var(--c-success))',
]

function parseDate(s) {
  return new Date(s + 'T00:00:00')
}
function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function startOfWeek(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // 周一为 0
  x.setDate(x.getDate() - day)
  return x
}
function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

const range = computed(() => {
  if (dim.value === 'month') {
    const [y, m] = financeMonth.value.split('-').map(Number)
    const end = new Date(y, m, 0)
    return { start: `${financeMonth.value}-01`, end: dateStr(end), days: end.getDate() }
  }
  if (dim.value === 'week') {
    const start = startOfWeek(anchor.value)
    const end = addDays(start, 6)
    return { start: dateStr(start), end: dateStr(end), days: 7 }
  }
  const y = anchor.value.getFullYear()
  return { start: `${y}-01-01`, end: `${y}-12-31`, days: isLeap(y) ? 366 : 365 }
})

const rangeLabel = computed(() => {
  if (dim.value === 'month') return monthText(financeMonth.value)
  if (dim.value === 'year') return `${anchor.value.getFullYear()}年`
  const s = parseDate(range.value.start)
  const e = parseDate(range.value.end)
  const sameYear = s.getFullYear() === e.getFullYear()
  const left = `${sameYear ? '' : s.getFullYear() + '年'}${s.getMonth() + 1}月${s.getDate()}日`
  const right = `${e.getMonth() + 1}月${e.getDate()}日`
  return `${left} - ${right}`
})

const isCurrentPeriod = computed(() => {
  if (dim.value === 'month') return financeMonth.value === currentMonthValue
  if (dim.value === 'year') return anchor.value.getFullYear() === new Date().getFullYear()
  return startOfWeek(new Date()).getTime() === startOfWeek(anchor.value).getTime()
})

const total = computed(() => Number(type.value === 'income'
  ? (report.value.summary || {}).income
  : (report.value.summary || {}).expense) || 0)
const count = computed(() => Number((report.value.summary || {}).count) || 0)

// 日均按「已经过去的天数」计算，避免月初把未来天数算进分母。
const avgDays = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = parseDate(range.value.start)
  const end = parseDate(range.value.end)
  if (start > today) return 1
  const effEnd = end < today ? end : today
  return Math.max(1, Math.floor((effEnd - start) / 86400000) + 1)
})
const dailyAvg = computed(() => Math.round(total.value / avgDays.value))

const catRows = computed(() => (report.value.by_category || []).slice(0, 8))

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

// 序列：年 → 12 个月；周/月 → 每日（服务端已零值填充）
const seq = computed(() => {
  const key = type.value === 'income' ? 'income' : 'expense'
  if (dim.value === 'year') {
    const map = {}
    for (const m of report.value.by_month || []) map[m.month] = m
    const y = anchor.value.getFullYear()
    return Array.from({ length: 12 }, (_, i) => {
      const row = map[`${y}-${pad2(i + 1)}`] || {}
      return Number(row[key] || 0)
    })
  }
  const map = {}
  for (const d of report.value.by_day || []) map[d.day] = d
  const start = parseDate(range.value.start)
  return Array.from({ length: range.value.days }, (_, i) => {
    const row = map[dateStr(addDays(start, i))] || {}
    return Number(row[key] || 0)
  })
})

const points = computed(() => {
  const values = seq.value
  const n = values.length
  const max = Math.max(1, ...values)
  const start = dim.value === 'year' ? null : parseDate(range.value.start)
  return values.map((v, i) => {
    let label
    if (dim.value === 'year') {
      label = `${i + 1}月`
    } else {
      const d = addDays(start, i)
      label = `${d.getMonth() + 1}/${d.getDate()}`
    }
    return {
      x: n === 1 ? 150 : (i / (n - 1)) * 290 + 5,
      y: 100 - (v / max) * 88,
      value: v,
      label,
    }
  })
})
const trendPoints = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))
const trendDots = computed(() => (seq.value.length <= 12 ? points.value : []))

const xLabels = computed(() => {
  const len = seq.value.length
  if (!len) return []
  const pct = (i) => (len === 1 ? 50 : (i / (len - 1)) * 100)
  if (dim.value === 'year') {
    return seq.value.map((_, i) => ({ text: String(i + 1), pct: pct(i) }))
  }
  if (dim.value === 'week') {
    const start = parseDate(range.value.start)
    return seq.value.map((_, i) => {
      const d = addDays(start, i)
      return { text: `${d.getMonth() + 1}/${d.getDate()}`, pct: pct(i) }
    })
  }
  const start = parseDate(range.value.start)
  const picks = len <= 7
    ? seq.value.map((_, i) => i)
    : [0, Math.round((len - 1) * 0.25), Math.round((len - 1) * 0.5), Math.round((len - 1) * 0.75), len - 1]
  const seen = new Set()
  return picks
    .filter((i) => (seen.has(i) ? false : seen.add(i)))
    .map((i) => ({ text: String(addDays(start, i).getDate()), pct: pct(i) }))
})

function colorOf(i) {
  return segmentColors[i % segmentColors.length]
}

async function load() {
  error.value = ''
  try {
    const filters = { start: range.value.start, end: range.value.end, types: [type.value] }
    const tasks = [api.financeReportData(filters)]
    if (dim.value === 'month') tasks.push(api.financeStats(financeMonth.value))
    const [dataRes, statsRes] = await Promise.all(tasks)
    report.value = dataRes.data || {}
    if (statsRes) budgetStats.value = statsRes.data || {}
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

function movePeriod(dir) {
  if (dim.value === 'month') {
    shiftFinanceMonth(dir)
    return
  }
  if (dim.value === 'week') {
    anchor.value = addDays(anchor.value, dir * 7)
  } else {
    anchor.value = new Date(anchor.value.getFullYear() + dir, 0, 1)
  }
  load()
}

function goCurrent() {
  if (dim.value === 'month') {
    financeMonth.value = currentMonthValue
    return
  }
  if (dim.value === 'week') {
    anchor.value = new Date()
  } else {
    anchor.value = new Date(new Date().getFullYear(), 0, 1)
  }
  load()
}

watch(type, load)
watch(dim, (v) => {
  if (v === 'week') anchor.value = new Date()
  else if (v === 'year') anchor.value = new Date(Number(financeMonth.value.slice(0, 4)), 0, 1)
  load()
})
watch(financeMonth, () => {
  if (dim.value === 'month') load()
})

let savedScroll = 0
let activatedOnce = false
onMounted(load)
onDeactivated(() => { savedScroll = window.scrollY })
onActivated(async () => {
  if (!activatedOnce) {
    activatedOnce = true
    return
  }
  await load()
  nextTick(() => requestAnimationFrame(() => window.scrollTo({ top: savedScroll })))
})
</script>

<style scoped>
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
</style>

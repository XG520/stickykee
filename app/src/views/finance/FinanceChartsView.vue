<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto lg:max-w-none">
    <FinanceHeader title="图表" subtitle="看清每个周期的钱花在哪里" />

    <!-- 桌面端双栏：左侧控制+趋势，右侧占比/预算/报表 -->
    <div class="space-y-3 lg:grid lg:grid-cols-12 lg:gap-5 lg:space-y-0 lg:items-start">
    <div class="space-y-3 lg:col-span-7 lg:col-start-1 lg:row-start-1">
    <!-- 时间维度 -->
    <div class="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-surface-alt">
      <button
        v-for="d in dims"
        :key="d.value"
        class="hc-seg"
        :class="dim === d.value ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
        @click="dim = d.value"
      >{{ d.label }}</button>
    </div>

    <!-- 自定义时间段选择器 -->
    <div v-if="dim === 'custom'" class="rounded-2xl bg-surface border border-border p-3 space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <label class="block min-w-0">
          <span class="text-[11px] text-muted font-body">开始日期</span>
          <input
            v-model="customStart"
            type="date"
            class="hc-date"
            aria-label="统计开始日期"
            @change="onCustomDateChange('start')"
          />
        </label>
        <label class="block min-w-0">
          <span class="text-[11px] text-muted font-body">结束日期</span>
          <input
            v-model="customEnd"
            type="date"
            class="hc-date"
            aria-label="统计结束日期"
            @change="onCustomDateChange('end')"
          />
        </label>
      </div>
      <div v-if="customDays > 62" class="text-[11px] text-muted font-body">区间较长，趋势按「月」展示</div>
    </div>

    <!-- 周期切换（自定义模式由日期选择器接管） -->
    <div v-if="dim !== 'custom'" class="flex items-center justify-between gap-2">
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

    <!-- 分类筛选：选定后总额与趋势只统计该分类 -->
    <div v-if="allCats.length" class="hc-scroll flex gap-1.5 overflow-x-auto pb-0.5">
      <button
        class="hc-catchip"
        :class="!selectedCategory ? 'hc-catchip--on' : ''"
        :aria-pressed="!selectedCategory"
        @click="clearCategory"
      >全部分类</button>
      <button
        v-for="(c, i) in allCats"
        :key="categoryIdOf(c) + '-' + (c.name || '')"
        class="hc-catchip"
        :class="isSelected(c) ? 'hc-catchip--on' : ''"
        :aria-pressed="isSelected(c)"
        @click="toggleCategory(c)"
      >
        <i class="w-2 h-2 rounded-full flex-shrink-0" :style="{ background: colorOf(i) }"></i>
        <span class="truncate max-w-[88px]">{{ c.name || '未分类' }}</span>
      </button>
    </div>

    <!-- 总额 -->
    <section class="min-w-0 rounded-2xl bg-surface border border-border p-4">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 text-[11px] text-muted font-body truncate">
          <template v-if="selectedCategory">{{ selectedCategory.name }} · </template>总{{ type === 'income' ? '收入' : '支出' }}
        </div>
        <div v-if="selectedCategory" class="flex items-center gap-1 flex-shrink-0">
          <button class="hc-mini" @click="openSelectedDetail">明细</button>
          <button class="hc-mini hc-mini--icon" aria-label="清除分类筛选" @click="clearCategory">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>
      <div class="mt-1 font-headline text-[30px] lg:text-[34px] leading-none font-semibold tabular-nums truncate" :class="type === 'income' ? 'text-accent' : ''">
        {{ money(total) }}
      </div>
      <div class="mt-2 text-[11px] text-muted font-body">
        日均 {{ money(dailyAvg) }} · 共 {{ count }} 笔 · {{ avgDays }} 天
      </div>
      <div v-if="selectedCategory" class="mt-1 text-[10px] text-muted font-body">
        仅统计「{{ selectedCategory.name }}」，可继续切换时间段
      </div>
    </section>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>
    </div>

    <!-- 分类占比：点击扇区筛选分类，点击列表查看该分类明细 -->
    <section class="rounded-2xl lg:rounded-3xl bg-surface border border-border p-4 lg:p-5 space-y-3 lg:col-span-5 lg:col-start-8 lg:row-start-1">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-medium font-body">分类{{ type === 'income' ? '收入' : '支出' }}</div>
        <span class="text-[10px] text-muted font-body flex-shrink-0">点扇区筛选 · 点列表看明细</span>
      </div>

      <div v-if="catRows.length" class="flex justify-center py-0.5">
        <div class="hc-donut relative w-32 h-32" :class="{ 'hc-donut--zoom': selectedInDonut }">
          <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90" role="img" :aria-label="`分类${type === 'income' ? '收入' : '支出'}占比环图`">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgb(var(--c-surface-alt))" stroke-width="14" />
            <circle
              v-for="(s, i) in donut"
              :key="i"
              cx="50"
              cy="50"
              r="40"
              fill="none"
              :stroke="s.color"
              :stroke-width="isSelected(catRows[i]) ? 17 : 14"
              :stroke-dasharray="s.dash"
              :stroke-dashoffset="s.offset"
              :opacity="selectedInDonut && !isSelected(catRows[i]) ? 0.28 : 1"
              stroke-linecap="butt"
              class="donut-seg cursor-pointer"
              tabindex="0"
              role="button"
              :aria-pressed="isSelected(catRows[i])"
              :aria-label="`${catRows[i].name || '未分类'} ${money(catRows[i].amount)}，${isSelected(catRows[i]) ? '取消筛选' : '筛选该分类'}`"
              @click="selectDonutCategory(i)"
              @keydown.enter="selectDonutCategory(i)"
            >
              <title>{{ (catRows[i].name || '未分类') + ' ' + money(catRows[i].amount) }}</title>
            </circle>
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
            <div class="text-[10px] text-muted font-body max-w-full truncate">{{ selectedCategory ? selectedCategory.name : '分类' }}</div>
            <div class="text-base font-semibold tabular-nums leading-tight">
              {{ selectedCategory ? selectedPct + '%' : allCats.length + ' 类' }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="allCats.length" class="space-y-1">
        <button
          v-for="(c, i) in allCats"
          :key="categoryIdOf(c) + '-' + (c.name || '')"
          class="hc-catrow"
          :class="isSelected(c) ? 'hc-catrow--on' : ''"
          :aria-label="`查看${c.name || '未分类'}明细，${money(c.amount)}`"
          @click="openCategoryDetail(c, i)"
        >
          <div class="flex items-center justify-between gap-2 text-xs font-body">
            <span class="flex items-center gap-1.5 min-w-0">
              <i class="w-2 h-2 rounded-full inline-block flex-shrink-0" :style="{ background: colorOf(i) }"></i>
              <span class="truncate">{{ c.name || '未分类' }}</span>
            </span>
            <span class="text-muted flex-shrink-0 tabular-nums">{{ money(c.amount) }} · {{ Number(c.percent || 0).toFixed(0) }}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-surface-alt overflow-hidden mt-1">
            <div class="hc-bar h-full rounded-full" :style="{ width: Math.min(100, Number(c.percent) || 0) + '%', background: colorOf(i) }"></div>
          </div>
        </button>
      </div>
      <div v-else class="text-xs text-muted font-body py-4 text-center">当前区间暂无{{ type === 'income' ? '收入' : '支出' }}</div>
    </section>

    <!-- 趋势（数据点可点击看当日/当月明细） -->
    <section class="rounded-2xl lg:rounded-3xl bg-surface border border-border p-4 lg:p-5 space-y-3 lg:col-span-7 lg:col-start-1 lg:row-start-2">
      <div class="flex items-center justify-between gap-2">
        <div class="text-sm font-medium font-body min-w-0 truncate">
          <template v-if="selectedCategory">{{ selectedCategory.name }} · </template>{{ trendUnit === 'month' ? '月度' : '每日' }}趋势
        </div>
        <span class="text-[11px] text-muted font-body flex-shrink-0">点击图形查看明细</span>
      </div>
      <div v-if="seq.length" class="relative">
        <svg viewBox="0 0 300 120" class="w-full h-[140px] lg:h-[220px]" preserveAspectRatio="none" role="img" :aria-label="`每日${type === 'income' ? '收入' : '支出'}趋势折线图`">
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
          <g v-for="(p, i) in points" :key="i">
            <circle
              v-if="showDots"
              :cx="p.x"
              :cy="p.y"
              r="2.6"
              :fill="type === 'income' ? 'rgb(var(--c-accent))' : 'rgb(var(--c-primary))'"
            />
            <circle
              v-if="showHits"
              :cx="p.x"
              :cy="p.y"
              :r="hitR"
              class="trend-hit cursor-pointer"
              tabindex="0"
              role="button"
              :aria-label="`${p.label} ${money(p.value)}，点击查看明细`"
              @click="openPoint(i)"
              @keydown.enter="openPoint(i)"
            >
              <title>{{ p.label }} {{ money(p.value) }}</title>
            </circle>
          </g>
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
    <section v-if="dim === 'month' && Number(budgetStats.budget_total) > 0" class="rounded-2xl bg-surface border border-border p-4 space-y-2 lg:col-span-5 lg:col-start-8 lg:row-start-2">
      <div class="flex items-center justify-between text-xs font-body">
        <span class="text-muted">本月预算</span>
        <span :class="Number(budgetStats.budget_left) < 0 ? 'text-error' : 'text-muted'">
          已用 {{ money(budgetStats.expense) }} / {{ money(budgetStats.budget_total) }}
        </span>
      </div>
      <div class="h-2 rounded-full bg-surface-alt overflow-hidden">
        <div
          class="hc-bar h-full rounded-full"
          :class="Number(budgetStats.budget_left) < 0 ? 'bg-error' : 'bg-primary'"
          :style="{ width: Math.min(100, Math.max(0, Number(budgetStats.budget_pct) || 0)) + '%' }"
        ></div>
      </div>
      <div class="text-[11px] font-body" :class="Number(budgetStats.budget_left) < 0 ? 'text-error' : 'text-muted'">
        {{ Number(budgetStats.budget_left) < 0 ? '已超支 ' + money(-budgetStats.budget_left) : '剩余 ' + money(budgetStats.budget_left) }}
      </div>
    </section>

    <!-- 已保存报表入口 -->
    <router-link
      to="/inventory/finance/reports"
      class="flex items-center justify-between gap-2 rounded-2xl bg-surface border border-border p-4 hover:border-primary/35 transition-colors lg:col-span-5 lg:col-start-8 lg:row-start-3"
    >
      <span class="flex items-center gap-2 text-sm font-body">
        <span class="material-symbols-outlined text-muted">bookmarks</span>
        已保存报表
      </span>
      <span class="material-symbols-outlined text-muted">chevron_right</span>
    </router-link>
    </div>
  </div>

  <!-- 分类/日期 明细弹窗 -->
  <div
    v-if="detail"
    class="fixed inset-0 z-[86] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="closeDetail"
  >
    <div
      ref="detailBody"
      class="w-full max-w-lg max-h-[86vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
      role="dialog"
      aria-modal="true"
      :aria-label="detail.title + ' 明细'"
      style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="font-headline text-lg font-semibold truncate flex items-center gap-2">
            <i v-if="detail.color" class="w-3 h-3 rounded-full inline-block flex-shrink-0" :style="{ background: detail.color }"></i>
            {{ detail.title }}
          </h3>
          <div class="mt-0.5 text-[11px] text-muted font-body">{{ detail.subtitle }}</div>
        </div>
        <button
          class="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-muted hover:text-on-surface hover:bg-surface-alt transition-colors flex-shrink-0"
          aria-label="关闭明细"
          @click="closeDetail"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-xl bg-surface-alt p-2.5">
          <div class="text-[10px] text-muted font-body">合计</div>
          <div class="mt-1 text-sm font-semibold tabular-nums truncate" :class="type === 'income' ? 'text-accent' : ''">{{ money(detail.amount) }}</div>
        </div>
        <div class="rounded-xl bg-surface-alt p-2.5">
          <div class="text-[10px] text-muted font-body">笔数</div>
          <div class="mt-1 text-sm font-semibold tabular-nums">{{ detail.total }} 笔</div>
        </div>
      </div>

      <div v-if="detail.loading" class="py-6 text-center text-xs text-muted font-body">加载中…</div>
      <div v-else-if="detail.error" class="text-xs text-error font-body">{{ detail.error }}</div>
      <div v-else-if="!detail.items.length" class="py-6 text-center text-xs text-muted font-body">该时间段内暂无记录</div>
      <div v-else class="space-y-1.5">
        <div v-for="tx in detail.items" :key="tx.id" class="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
          <div
            class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            :class="type === 'income' ? 'bg-accent/10 text-accent' : 'bg-surface-alt text-muted'"
          >
            <span class="material-symbols-outlined text-lg">{{ type === 'income' ? 'arrow_upward' : 'arrow_downward' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-sm font-body truncate">{{ tx.note || tx.category_name || (type === 'income' ? '收入' : '支出') }}</span>
              <!-- 记录创建者：辅助信息，字号为主内容的 71%（10px），柔和次要色 -->
              <span
                v-if="creatorOf(tx)"
                class="shrink-0 max-w-[6rem] truncate text-[10px] leading-4 text-faint font-body"
              >{{ creatorOf(tx) }}</span>
            </div>
            <div class="text-[11px] text-muted font-body truncate">
              {{ timeLabel(tx.occurred_at) }}
              <template v-if="tx.category_name"> · {{ tx.category_name }}</template>
              <template v-if="payMethodLabel(tx.pay_method)"> · {{ payMethodLabel(tx.pay_method) }}</template>
              <template v-if="tx.account_name"> · {{ tx.account_name }}</template>
            </div>
          </div>
          <div class="text-sm font-semibold tabular-nums flex-shrink-0" :class="type === 'income' ? 'text-accent' : ''">{{ money(tx.amount) }}</div>
        </div>
      </div>

      <div v-if="!detail.loading && detail.totalPages > 1" class="flex items-center justify-between gap-2 pt-1">
        <button class="hc-page" :disabled="detail.page <= 1" aria-label="上一页" @click="gotoPage(detail.page - 1)">
          <span class="material-symbols-outlined text-lg">chevron_left</span> 上一页
        </button>
        <span class="text-[11px] text-muted font-body tabular-nums">{{ detail.page }} / {{ detail.totalPages }}</span>
        <button class="hc-page" :disabled="detail.page >= detail.totalPages" aria-label="下一页" @click="gotoPage(detail.page + 1)">
          下一页 <span class="material-symbols-outlined text-lg">chevron_right</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import { financeMonth, shiftFinanceMonth } from '@/store/finance'
import { currentMonth, money, monthText, pad2, payMethodLabel } from '@/utils/finance'

defineOptions({ name: 'FinanceChartsView' })

const dims = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
  { value: 'custom', label: '自定义' },
]

const type = ref('expense')
const dim = ref('month')
const anchor = ref(new Date())
const customStart = ref(`${currentMonth()}-01`)
const customEnd = ref(todayStr())
const report = ref({})
const filteredReport = ref({})
const selectedCategory = ref(null) // { id, name }；null = 全部分类
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

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
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
function daysBetween(a, b) {
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

// 周/月/年 维度的自然日区间（自定义维度单独处理）。
function periodOf(d) {
  if (d === 'month') {
    const [y, m] = financeMonth.value.split('-').map(Number)
    return { start: `${financeMonth.value}-01`, end: dateStr(new Date(y, m, 0)) }
  }
  if (d === 'week') {
    const s = startOfWeek(anchor.value)
    return { start: dateStr(s), end: dateStr(addDays(s, 6)) }
  }
  const y = anchor.value.getFullYear()
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

const range = computed(() => {
  if (dim.value === 'custom') {
    const start = customStart.value
    const end = customEnd.value
    if (!start || !end) return { start: todayStr(), end: todayStr(), days: 1 }
    return { start, end, days: daysBetween(parseDate(start), parseDate(end)) }
  }
  const p = periodOf(dim.value)
  return { ...p, days: daysBetween(parseDate(p.start), parseDate(p.end)) }
})

const customDays = computed(() => range.value.days)

// 趋势粒度：年维度或较长自定义区间按月，其余按日。
const trendUnit = computed(() => (dim.value === 'year' || (dim.value === 'custom' && range.value.days > 62)) ? 'month' : 'day')

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
  if (dim.value === 'custom') return false
  if (dim.value === 'month') return financeMonth.value === currentMonthValue
  if (dim.value === 'year') return anchor.value.getFullYear() === new Date().getFullYear()
  return startOfWeek(new Date()).getTime() === startOfWeek(anchor.value).getTime()
})

// 选中分类时总额/趋势使用过滤后的数据；环形图与分类列表仍用全量数据以便切换。
const view = computed(() => (selectedCategory.value ? filteredReport.value : report.value))

const total = computed(() => Number(type.value === 'income'
  ? (view.value.summary || {}).income
  : (view.value.summary || {}).expense) || 0)
const count = computed(() => Number((view.value.summary || {}).count) || 0)

// 日均按「已经过去的天数」计算，避免月初把未来天数算进分母。
const avgDays = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = parseDate(range.value.start)
  const end = parseDate(range.value.end)
  if (start > today) return 1
  const effEnd = end < today ? end : today
  return daysBetween(start, effEnd)
})
const dailyAvg = computed(() => Math.round(total.value / avgDays.value))

const allCats = computed(() => report.value.by_category || [])
const catRows = computed(() => allCats.value.slice(0, 8))
const selectedInDonut = computed(() => catRows.value.some((c) => isSelected(c)))
const selectedPct = computed(() => {
  const sel = selectedCategory.value
  if (!sel) return 0
  const row = allCats.value.find((c) => categoryIdOf(c) === sel.id)
  return row ? Math.round(Number(row.percent) || 0) : 0
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

// 序列：年 → 12 个月；较长自定义区间 → 逐月（服务端零值填充）；周/月/短自定义 → 逐日。
const seq = computed(() => {
  const key = type.value === 'income' ? 'income' : 'expense'
  if (trendUnit.value === 'month') {
    const rows = view.value.by_month || []
    if (dim.value === 'year') {
      const map = {}
      for (const m of rows) map[m.month] = m
      const y = anchor.value.getFullYear()
      return Array.from({ length: 12 }, (_, i) => Number((map[`${y}-${pad2(i + 1)}`] || {})[key] || 0))
    }
    return rows.map((m) => Number(m[key] || 0))
  }
  const map = {}
  for (const d of view.value.by_day || []) map[d.day] = d
  const start = parseDate(range.value.start)
  return Array.from({ length: range.value.days }, (_, i) => Number((map[dateStr(addDays(start, i))] || {})[key] || 0))
})

// 趋势数值平滑过渡：数据变化时用 rAF 从旧值缓动到新值。
const dispSeq = ref([])
let tweenRaf = 0
function tweenTo(values) {
  const from = dispSeq.value.length === values.length ? [...dispSeq.value] : values.map(() => 0)
  const t0 = performance.now()
  const dur = 420
  cancelAnimationFrame(tweenRaf)
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur)
    const e = 1 - Math.pow(1 - p, 3)
    dispSeq.value = values.map((v, i) => from[i] + (v - from[i]) * e)
    if (p < 1) tweenRaf = requestAnimationFrame(step)
  }
  tweenRaf = requestAnimationFrame(step)
}
watch(() => seq.value, tweenTo)

const pointLabels = computed(() => {
  const n = seq.value.length
  if (trendUnit.value === 'month') {
    const rows = view.value.by_month || []
    return Array.from({ length: n }, (_, i) => {
      if (dim.value === 'year') return `${i + 1}月`
      const m = rows[i] || {}
      return `${Number(String(m.month || '0').slice(5))}月`
    })
  }
  const start = parseDate(range.value.start)
  return seq.value.map((_, i) => {
    const d = addDays(start, i)
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
})

const points = computed(() => {
  const values = dispSeq.value
  const n = values.length
  const max = Math.max(1, ...seq.value)
  return values.map((v, i) => ({
    x: n === 1 ? 150 : (i / (n - 1)) * 290 + 5,
    y: 100 - (v / max) * 88,
    value: seq.value[i] || 0,
    label: pointLabels.value[i],
  }))
})
const trendPoints = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))

// 数据点多时缩小红点/扩大热区，保证移动端可点。
const showDots = computed(() => seq.value.length <= 32)
const showHits = computed(() => seq.value.length <= 62)
const hitR = computed(() => {
  const n = seq.value.length
  if (n < 2) return 9
  return Math.min(9, 290 / (n - 1) / 2 + 2)
})

const xLabels = computed(() => {
  const len = seq.value.length
  if (!len) return []
  const pct = (i) => (len === 1 ? 50 : (i / (len - 1)) * 100)
  if (trendUnit.value === 'month') {
    const stride = len > 12 ? 2 : 1
    return seq.value
      .map((_, i) => ({ text: pointLabels.value[i], pct: pct(i) }))
      .filter((_, i) => i % stride === 0)
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

function rangeText(f) {
  if (!f || !f.start) return '—'
  return f.start === f.end ? f.start : `${f.start} ~ ${f.end}`
}
function timeLabel(s) {
  const v = String(s || '')
  if (v.length < 10) return v
  return v.slice(5, 16)
}

// 记录创建者用户名；历史流水或自动记账没有创建者时不展示
function creatorOf(tx) {
  return String((tx && tx.created_by) || '').trim()
}

function categoryFilter(sel) {
  if (!sel) return null
  return sel.id ? { categories: [sel.id] } : { no_category: true }
}

async function load() {
  if (dim.value === 'custom' && (!customStart.value || !customEnd.value)) return
  error.value = ''
  try {
    const filters = { start: range.value.start, end: range.value.end, types: [type.value] }
    const cat = categoryFilter(selectedCategory.value)
    const tasks = [
      api.financeReportData(filters),
      cat ? api.financeReportData({ ...filters, ...cat }) : Promise.resolve(null),
    ]
    if (dim.value === 'month') tasks.push(api.financeStats(financeMonth.value))
    const [dataRes, catRes, statsRes] = await Promise.all(tasks)
    report.value = dataRes.data || {}
    filteredReport.value = catRes ? (catRes.data || {}) : {}
    if (statsRes) budgetStats.value = statsRes.data || {}
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

function movePeriod(dir) {
  if (dim.value === 'custom') return
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
  if (dim.value === 'custom') {
    financeMonth.value = currentMonthValue
    dim.value = 'month'
    return
  }
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

let lastCustomField = 'start'
function onCustomDateChange(which) {
  lastCustomField = which
  if (!customStart.value || !customEnd.value) return
  if (customStart.value > customEnd.value) {
    // 自动校正，保证开始 ≤ 结束
    if (lastCustomField === 'start') customEnd.value = customStart.value
    else customStart.value = customEnd.value
  }
  if (dim.value === 'custom') load()
}

watch(type, () => {
  selectedCategory.value = null
  filteredReport.value = {}
  load()
})
watch(dim, (v, old) => {
  if (v === 'week') anchor.value = new Date()
  else if (v === 'year') anchor.value = new Date(Number(financeMonth.value.slice(0, 4)), 0, 1)
  else if (v === 'custom') {
    const p = periodOf(old)
    customStart.value = p.start
    customEnd.value = p.end
  }
  load()
})
watch(financeMonth, () => {
  if (dim.value === 'month') load()
})

// ── 明细弹窗 ─────────────────────────────────────────────────────

const PAGE_SIZE = 20
const detail = ref(null)
const detailBody = ref(null)
let detailToken = 0

function openDetail(opts) {
  detailToken += 1
  detail.value = {
    ...opts,
    token: detailToken,
    page: 1,
    totalPages: 1,
    items: [],
    total: 0,
    loading: true,
    error: '',
  }
  nextTick(() => detailBody.value?.scrollTo?.({ top: 0 }))
  loadDetailPage()
}

async function loadDetailPage() {
  const d = detail.value
  if (!d) return
  const token = d.token
  d.loading = true
  d.error = ''
  try {
    const res = await api.financeReportTransactions(d.filters, d.page, PAGE_SIZE)
    if (detailToken !== token) return
    const p = res.data || {}
    d.items = p.items || []
    d.total = p.total || 0
    d.totalPages = Math.max(1, Math.ceil(d.total / PAGE_SIZE))
  } catch (e) {
    if (detailToken !== token) return
    d.error = e.message || '加载失败'
  } finally {
    if (detailToken === token) d.loading = false
  }
  nextTick(() => detailBody.value?.scrollTo?.({ top: 0 }))
}

function gotoPage(p) {
  const d = detail.value
  if (!d || d.loading || p === d.page || p < 1 || p > d.totalPages) return
  d.page = p
  loadDetailPage()
}

function closeDetail() {
  detailToken += 1
  detail.value = null
}

// 分类扇区点击：筛选/取消筛选该分类（明细通过列表项或总额卡「明细」查看）。
function selectDonutCategory(i) {
  const c = catRows.value[i]
  if (c) toggleCategory(c)
}

function categoryIdOf(c) {
  return Number(c && c.category_id) || 0
}

function isSelected(c) {
  return !!selectedCategory.value && categoryIdOf(c) === selectedCategory.value.id
}

function toggleCategory(c) {
  if (!c) return
  const id = categoryIdOf(c)
  if (selectedCategory.value && selectedCategory.value.id === id) {
    clearCategory()
    return
  }
  selectedCategory.value = { id, name: c.name || '未分类' }
  load()
}

function clearCategory() {
  if (!selectedCategory.value) return
  selectedCategory.value = null
  filteredReport.value = {}
  load()
}

// 分类列表点击：弹出该分类在当前区间的明细。
function openCategoryDetail(c, i) {
  if (!c) return
  const id = categoryIdOf(c)
  openDetail({
    title: c.name || '未分类',
    color: colorOf(i),
    amount: Number(c.amount) || 0,
    subtitle: `${rangeText(range.value)} · ${type.value === 'income' ? '收入' : '支出'}`,
    filters: {
      start: range.value.start,
      end: range.value.end,
      types: [type.value],
      ...(id ? { categories: [id] } : { no_category: true }),
    },
  })
}

// 总额卡「明细」：查看当前已选分类的流水。
function openSelectedDetail() {
  const sel = selectedCategory.value
  if (!sel) return
  const i = allCats.value.findIndex((c) => categoryIdOf(c) === sel.id)
  const row = i >= 0 ? allCats.value[i] : { category_id: sel.id, name: sel.name, amount: total.value }
  openCategoryDetail(row, i >= 0 ? i : 0)
}

// 趋势数据点点击：弹出当日（或当月）的明细。
function openPoint(i) {
  const label = pointLabels.value[i]
  if (!label) return
  const catFilter = categoryFilter(selectedCategory.value) || {}
  let title
  let filters
  if (trendUnit.value === 'month') {
    let y, m
    if (dim.value === 'year') {
      y = anchor.value.getFullYear()
      m = i + 1
    } else {
      const row = (view.value.by_month || [])[i] || {}
      y = Number(String(row.month || '0').slice(0, 4))
      m = Number(String(row.month || '0').slice(5))
    }
    title = `${y}年${m}月`
    filters = { start: `${y}-${pad2(m)}-01`, end: dateStr(new Date(y, m, 0)), types: [type.value], ...catFilter }
  } else {
    const d = addDays(parseDate(range.value.start), i)
    title = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
    const ds = dateStr(d)
    filters = { start: ds, end: ds, types: [type.value], ...catFilter }
  }
  if (selectedCategory.value) title += ` · ${selectedCategory.value.name}`
  openDetail({
    title,
    amount: Number(seq.value[i] || 0),
    subtitle: `${rangeText(filters)} · ${type.value === 'income' ? '收入' : '支出'}`,
    filters,
  })
}

function onKeydown(e) {
  if (e.key === 'Escape' && detail.value) closeDetail()
}

let savedScroll = 0
let activatedOnce = false
onMounted(() => {
  load()
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  cancelAnimationFrame(tweenRaf)
})
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

/* 分类筛选 chips：横向滚动但隐藏滚动条 */
.hc-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.hc-scroll::-webkit-scrollbar { display: none; }

.hc-catchip {
  height: 30px;
  padding: 0 10px;
  border-radius: 9999px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  font-size: 11px;
  font-family: var(--font-body);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  transition: background-color .15s, color .15s, border-color .15s;
}
.hc-catchip:hover { color: rgb(var(--c-on-surface)); }
.hc-catchip--on {
  background: rgb(var(--c-primary));
  border-color: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
}

/* 总额卡迷你操作按钮 */
.hc-mini {
  height: 28px;
  padding: 0 9px;
  border-radius: 9999px;
  border: 1px solid rgb(var(--c-border));
  color: rgb(var(--c-muted));
  background: rgb(var(--c-surface-alt));
  font-size: 10px;
  font-family: var(--font-body);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.hc-mini:hover { color: rgb(var(--c-on-surface)); }
.hc-mini--icon { width: 28px; padding: 0; }

/* 自定义日期选择器：44px 高度保证移动端触控热区 */
.hc-date {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 10px;
  margin-top: 4px;
  border-radius: 10px;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  font-size: 13px;
  font-family: var(--font-body);
  color: rgb(var(--c-on-surface));
  outline: none;
  transition: border-color .15s;
}
.hc-date:focus { border-color: rgb(var(--c-primary)); }

/* 分类列表项：整行可点 */
.hc-catrow {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  transition: background-color .15s;
}
.hc-catrow:hover { background: rgb(var(--c-surface-alt)); }
.hc-catrow--on { background: rgb(var(--c-primary) / .08); }

/* 环形图扇区与进度条的平滑过渡 */
.donut-seg {
  transition: stroke-dasharray .55s ease, stroke-dashoffset .55s ease, opacity .18s ease;
  /* 去掉移动端 WebView 点击时的黄色方块高亮，并让点按立即响应 */
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  outline: none;
}
.donut-seg:hover { opacity: .75; }
/* 点击扇区后整体放大：提高后续点选的精准度，放大期间仍可正常点选与查看明细 */
.hc-donut {
  transform: scale(1);
  transform-origin: center;
  transition: transform .28s cubic-bezier(.22, .61, .36, 1);
  -webkit-tap-highlight-color: transparent;
}
.hc-donut--zoom { transform: scale(1.15); }
.hc-donut svg { -webkit-tap-highlight-color: transparent; }
.hc-bar { transition: width .55s ease; }

/* 趋势数据点热区：平时透明，悬停高亮 */
.trend-hit {
  fill: rgb(var(--c-primary));
  fill-opacity: 0;
  transition: fill-opacity .15s;
}
.trend-hit:hover { fill-opacity: .18; }

/* 明细弹窗翻页按钮 */
.hc-page {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  font-size: 13px;
  font-family: var(--font-body);
  transition: background-color .15s, opacity .15s;
}
.hc-page:hover:not(:disabled) { background: rgb(var(--c-surface-alt)); }
.hc-page:disabled { opacity: .4; cursor: default; }
</style>

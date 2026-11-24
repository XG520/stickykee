<template>
  <div class="space-y-4">
    <!-- 分类占比 -->
    <div class="bg-surface border border-border rounded-2xl p-4 space-y-3">
      <div class="text-sm font-medium font-body">本月分类支出</div>
      <div v-if="topCategories.length" class="space-y-2">
        <div v-for="c in topCategories" :key="c.category_id" class="space-y-1">
          <div class="flex items-center justify-between text-xs font-body">
            <span class="truncate">{{ c.name }}</span>
            <span class="text-muted flex-shrink-0 ml-2">{{ money(c.amount) }} · {{ c.percent }}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-surface-alt overflow-hidden">
            <div class="h-full rounded-full bg-primary" :style="{ width: Math.min(100, Number(c.percent) || 0) + '%' }"></div>
          </div>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body">本月暂无支出</div>
    </div>

    <!-- 分类预算 -->
    <div v-if="budgets.length" class="bg-surface border border-border rounded-2xl p-4 space-y-3">
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
        <div class="text-[11px] font-body" :class="Number(b.left) < 0 ? 'text-error' : 'text-muted'">
          {{ Number(b.left) < 0 ? '超支 ' + money(-b.left) : '剩余 ' + money(b.left) }}
        </div>
      </div>
    </div>

    <!-- 近 6 月趋势 -->
    <div class="bg-surface border border-border rounded-2xl p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium font-body">近 6 月趋势</div>
        <div class="flex items-center gap-3 text-[11px] font-body text-muted">
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-sm bg-primary inline-block"></i>支出</span>
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-sm bg-primary/30 inline-block"></i>收入</span>
        </div>
      </div>
      <div v-if="trend.length" class="flex items-end justify-between gap-2 h-32">
        <div v-for="p in trend" :key="p.month" class="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div class="flex items-end justify-center gap-0.5 h-24 w-full">
            <div
              class="w-2.5 rounded-t-sm bg-primary"
              :style="{ height: barH(p.expense) + '%' }"
              :title="'支出 ' + money(p.expense)"
            ></div>
            <div
              class="w-2.5 rounded-t-sm bg-primary/30"
              :style="{ height: barH(p.income) + '%' }"
              :title="'收入 ' + money(p.income)"
            ></div>
          </div>
          <div class="text-[10px] text-muted font-body">{{ p.month.slice(5) }}月</div>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body">暂无趋势数据</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  stats: { type: Object, default: () => ({}) },
  trend: { type: Array, default: () => [] },
})

const topCategories = computed(() => (props.stats.by_category || []).slice(0, 8))
const budgets = computed(() => props.stats.budgets || [])

const trendMax = computed(() => {
  let max = 0
  for (const p of props.trend) {
    max = Math.max(max, Number(p.expense || 0), Number(p.income || 0))
  }
  return max || 1
})

function barH(cents) {
  return Math.max(2, Math.round((Number(cents || 0) / trendMax.value) * 100))
}

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
</script>

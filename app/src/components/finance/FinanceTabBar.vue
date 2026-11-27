<template>
  <!-- 桌面端的账本导航由「生活」工作台左侧二级导航承担，这里只保留移动端专属 5 位底栏 -->

  <nav
    class="md:hidden fixed bottom-0 left-0 right-0 z-[60] bg-surface/95 backdrop-blur-md border-t border-border"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <div class="max-w-lg mx-auto grid grid-cols-5 items-end h-16">
      <router-link
        v-for="t in leftTabs"
        :key="t.to"
        :to="t.to"
        class="flex flex-col items-center justify-end gap-0.5 pb-1.5"
        :class="isActive(t) ? 'text-primary' : 'text-muted'"
      >
        <span
          class="material-symbols-outlined text-2xl leading-none"
          :style="fillStyle(t)"
        >{{ t.icon }}</span>
        <span class="text-[10px] font-body" :class="isActive(t) ? 'font-medium' : ''">{{ t.label }}</span>
      </router-link>

      <div class="relative flex flex-col items-center justify-end h-full pb-1.5">
        <router-link
          v-if="canOperate"
          to="/inventory/finance/add"
          aria-label="记一笔"
          class="absolute -top-6 w-14 h-14 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          style="box-shadow: 0 10px 26px rgb(var(--c-primary) / .35)"
        >
          <span class="material-symbols-outlined text-2xl">add</span>
        </router-link>
        <span class="text-[10px] font-body text-muted">记账</span>
      </div>

      <router-link
        v-for="t in rightTabs"
        :key="t.to"
        :to="t.to"
        class="flex flex-col items-center justify-end gap-0.5 pb-1.5"
        :class="isActive(t) ? 'text-primary' : 'text-muted'"
      >
        <span
          class="material-symbols-outlined text-2xl leading-none"
          :style="fillStyle(t)"
        >{{ t.icon }}</span>
        <span class="text-[10px] font-body" :class="isActive(t) ? 'font-medium' : ''">{{ t.label }}</span>
      </router-link>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { auth } from '@/store'

const route = useRoute()
// 只有获得「操作」权限才显示记一笔入口（查看权限不可写）
const canOperate = computed(() => auth.financeOperate)

const leftTabs = [
  { to: '/inventory/finance/ledger', label: '明细', icon: 'receipt_long', name: 'finance-ledger' },
  { to: '/inventory/finance/charts', label: '图表', icon: 'donut_small', name: 'finance-charts' },
]
const rightTabs = [
  { to: '/inventory/finance/plan', label: '计划', icon: 'savings', name: 'finance-plan' },
  { to: '/inventory/finance/me', label: '我的', icon: 'person', name: 'finance-me' },
]

function isActive(t) {
  return route.name === t.name
}

function fillStyle(t) {
  return isActive(t) ? { fontVariationSettings: "'FILL' 1" } : {}
}
</script>

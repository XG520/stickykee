<template>
  <!-- 桌面端：顶部横向页签 -->
  <nav class="hidden md:flex items-center gap-1 p-1 mb-4 rounded-2xl bg-surface-alt border border-border w-fit">
    <router-link
      v-for="t in tabs"
      :key="t.to"
      :to="t.to"
      class="px-4 py-2 rounded-xl text-sm font-body transition-colors"
      :class="isActive(t) ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-on-surface'"
    >{{ t.label }}</router-link>
    <router-link
      v-if="canOperate"
      to="/inventory/finance/add"
      class="ml-1 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-body font-medium flex items-center gap-1"
    >
      <span class="material-symbols-outlined text-base">add</span>记一笔
    </router-link>
  </nav>

  <!-- 移动端：专属 5 位底栏，中间为记账 FAB -->
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

const tabs = [
  { to: '/inventory/finance/ledger', label: '明细', name: 'finance-ledger' },
  { to: '/inventory/finance/charts', label: '图表', name: 'finance-charts' },
  { to: '/inventory/finance/plan', label: '计划', name: 'finance-plan' },
  { to: '/inventory/finance/me', label: '我的', name: 'finance-me' },
]

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

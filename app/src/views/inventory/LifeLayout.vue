<template>
  <!-- 桌面端「生活」工作台外壳：左侧二级导航 + 右侧内容区；移动端保持原有单列页面 -->
  <div class="lg:flex lg:items-start lg:gap-6 xl:gap-8">
    <aside class="hidden lg:flex lg:w-[218px] xl:w-[236px] shrink-0 lg:sticky lg:top-20 self-start flex-col">
      <div class="rounded-3xl bg-surface border border-border px-3 py-4">
        <div class="px-2 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h1 class="font-headline text-xl font-semibold leading-tight">生活</h1>
            <p class="mt-1 text-[11px] text-muted font-body truncate">{{ todayLabel }}</p>
          </div>
          <span class="material-symbols-outlined text-primary text-xl leading-none">cottage</span>
        </div>

        <nav class="mt-4 space-y-1">
          <router-link
            v-for="item in mainItems"
            :key="item.to"
            :to="item.to"
            class="hc-life-nav"
            :class="{ 'hc-life-nav--on': route.name === item.name }"
          >
            <span class="material-symbols-outlined text-lg leading-none">{{ item.icon }}</span>
            <span class="flex-1 truncate">{{ item.label }}</span>
            <span v-if="route.name === item.name" class="w-1.5 h-1.5 rounded-full bg-primary"></span>
          </router-link>
        </nav>

        <template v-if="auth.financeView">
          <div class="mt-5 px-2 flex items-center justify-between">
            <span class="text-[10px] tracking-[0.16em] uppercase text-faint font-body">账本</span>
            <span class="text-[10px] text-faint font-body">{{ financeMonth }}</span>
          </div>
          <nav class="mt-1.5 space-y-1">
            <router-link
              v-for="item in financeItems"
              :key="item.to"
              :to="item.to"
              class="hc-life-nav"
              :class="{ 'hc-life-nav--on': route.name === item.name }"
            >
              <span class="material-symbols-outlined text-lg leading-none">{{ item.icon }}</span>
              <span class="flex-1 truncate">{{ item.label }}</span>
            </router-link>
          </nav>

          <router-link
            v-if="auth.financeOperate"
            to="/inventory/finance/add"
            class="mt-3 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center gap-1 font-body text-[13px] font-medium shadow-sm hover:opacity-90 transition-opacity"
          >
            <span class="material-symbols-outlined text-base">add</span>
            记一笔
          </router-link>
        </template>
      </div>
    </aside>

    <div class="flex-1 min-w-0 pb-2">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { auth } from '@/store'
import { financeMonth } from '@/store/finance'

const route = useRoute()

const mainItems = [
  { to: '/inventory', name: 'inventory', icon: 'space_dashboard', label: '概览' },
  { to: '/inventory/stock', name: 'inventory-stock', icon: 'inventory_2', label: '库存' },
  { to: '/inventory/shopping', name: 'inventory-shopping', icon: 'shopping_cart', label: '购物清单' },
]

const financeItems = [
  { to: '/inventory/finance/ledger', name: 'finance-ledger', icon: 'receipt_long', label: '明细' },
  { to: '/inventory/finance/charts', name: 'finance-charts', icon: 'donut_small', label: '图表' },
  { to: '/inventory/finance/plan', name: 'finance-plan', icon: 'savings', label: '计划' },
  { to: '/inventory/finance/me', name: 'finance-me', icon: 'person', label: '我的' },
]

const todayLabel = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`
})
</script>

<style scoped>
.hc-life-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 13px;
  font-family: var(--font-body);
  color: rgb(var(--c-muted));
  transition: background-color .15s ease, color .15s ease;
}
.hc-life-nav:hover {
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
}
.hc-life-nav--on {
  background: rgb(var(--c-primary) / .12);
  color: rgb(var(--c-primary));
  font-weight: 500;
}
</style>

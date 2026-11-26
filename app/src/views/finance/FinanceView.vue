<template>
  <div class="pb-24 md:pb-0">
    <router-view v-slot="{ Component }">
      <keep-alive :include="['FinanceLedgerView', 'FinanceChartsView']">
        <component :is="Component" />
      </keep-alive>
    </router-view>
    <FinanceTabBar v-if="showTab" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import FinanceTabBar from '@/components/finance/FinanceTabBar.vue'

const route = useRoute()
// 记一笔为全屏页，不渲染账本底栏。
const showTab = computed(() => route.name !== 'finance-add')
</script>

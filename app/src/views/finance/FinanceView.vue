<template>
  <div>
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
// 记一笔为全屏页，已保存报表为独立子页，均不渲染账本底栏。
const showTab = computed(() => !['finance-add', 'finance-reports'].includes(route.name))
</script>

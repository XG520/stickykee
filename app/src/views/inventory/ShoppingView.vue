<template>
  <div class="py-2 pb-4 space-y-3 max-w-3xl mx-auto lg:max-w-none">
    <header class="flex items-center gap-2 min-h-12 lg:min-h-14">
      <button class="hc-icon-btn -ml-2 lg:hidden" aria-label="返回生活" @click="router.push('/inventory')">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <h1 class="flex-1 min-w-0 font-headline text-lg lg:text-2xl font-semibold truncate">购物清单</h1>
    </header>

    <ShoppingListView @changed="onChanged" />
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import ShoppingListView from '@/components/inventory/ShoppingListView.vue'

const router = useRouter()

function onChanged() {
  // 购物清单在独立页面内自洽；保留事件位以便后续联动库存角标。
}
</script>

<style scoped>
.hc-icon-btn {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-on-surface));
  transition: background-color .15s ease, color .15s ease;
}
.hc-icon-btn:hover { background: rgb(var(--c-surface-alt)); }
</style>

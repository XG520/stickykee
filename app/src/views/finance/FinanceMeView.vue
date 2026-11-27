<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto">
    <FinanceHeader title="我的" subtitle="资产、账户与数据" />

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 资产总览 -->
    <section class="rounded-2xl bg-surface border border-border p-4">
      <div class="text-[11px] text-muted font-body">总资产</div>
      <div class="mt-1 font-headline text-[30px] leading-none font-semibold tabular-nums">{{ money(stats.balance) }}</div>
      <div class="mt-2 text-[11px] text-muted font-body">{{ activeAccounts.length }} 个在用账户</div>
    </section>

    <!-- 账户列表 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-2.5">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium font-body">账户</div>
        <button class="text-[11px] text-primary font-body" @click="openManager('account')">管理</button>
      </div>
      <div v-if="allAccounts.length" class="divide-y divide-border">
        <div v-for="a in allAccounts" :key="a.id" class="flex items-center gap-3 py-2">
          <div class="w-9 h-9 rounded-full bg-surface-alt flex items-center justify-center flex-shrink-0 text-muted">
            <span class="material-symbols-outlined text-lg">{{ iconOf(a.kind) }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-sm truncate">{{ a.name }}</span>
              <span v-if="a.archived" class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-alt text-muted font-body">已归档</span>
            </div>
            <div class="text-[11px] text-muted font-body">{{ kindLabel(a.kind) }}</div>
          </div>
          <div class="text-sm font-medium tabular-nums flex-shrink-0">{{ money(a.balance) }}</div>
        </div>
      </div>
      <div v-else class="text-xs text-muted font-body py-2">还没有账户</div>
    </section>

    <!-- 功能入口 -->
    <section class="rounded-2xl bg-surface border border-border overflow-hidden divide-y divide-border">
      <button class="hc-row" @click="openManager('account')">
        <span class="material-symbols-outlined text-base text-muted">account_balance_wallet</span>
        <span class="flex-1 text-left">账户管理</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="openManager('category')">
        <span class="material-symbols-outlined text-base text-muted">category</span>
        <span class="flex-1 text-left">分类管理</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="router.push('/inventory/finance/plan')">
        <span class="material-symbols-outlined text-base text-muted">receipt_long</span>
        <span class="flex-1 text-left">周期账单</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="router.push('/inventory/finance/reports')">
        <span class="material-symbols-outlined text-base text-muted">bookmarks</span>
        <span class="flex-1 text-left">已保存报表</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="importOpen = true">
        <span class="material-symbols-outlined text-base text-muted">upload_file</span>
        <span class="flex-1 text-left">导入账单</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="exportCsv">
        <span class="material-symbols-outlined text-base text-muted">download</span>
        <span class="flex-1 text-left">导出本月 CSV</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="openManager('auto')">
        <span class="material-symbols-outlined text-base text-muted">notifications_active</span>
        <span class="flex-1 text-left">自动记账</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
      <button class="hc-row" @click="router.push('/inventory')">
        <span class="material-symbols-outlined text-base text-muted">cottage</span>
        <span class="flex-1 text-left">返回生活</span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>
    </section>

    <AccountManager
      v-model="managerOpen"
      :accounts="allAccounts"
      :categories="categories"
      :initial-tab="managerTab"
      @changed="load"
      @import="openImport"
    />
    <ImportDialog v-model="importOpen" :accounts="allAccounts" @changed="load" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import AccountManager from '@/components/finance/AccountManager.vue'
import ImportDialog from '@/components/finance/ImportDialog.vue'
import { financeMonth } from '@/store/finance'
import { money } from '@/utils/finance'

const router = useRouter()

const stats = ref({})
const allAccounts = ref([])
const categories = ref([])
const managerOpen = ref(false)
const managerTab = ref('account')
const importOpen = ref(false)
const error = ref('')

const activeAccounts = computed(() => allAccounts.value.filter((a) => !a.archived))

const kinds = { cash: '现金', debit: '储蓄卡', credit: '信用卡', alipay: '支付宝', wechat: '微信', other: '其他' }
const icons = { cash: 'payments', debit: 'account_balance', credit: 'credit_card', alipay: 'qr_code', wechat: 'chat', other: 'wallet' }

function kindLabel(kind) {
  return kinds[kind] || '其他'
}
function iconOf(kind) {
  return icons[kind] || 'wallet'
}

function openManager(tab) {
  managerTab.value = tab || 'account'
  managerOpen.value = true
}

function openImport() {
  importOpen.value = true
}

async function load() {
  error.value = ''
  try {
    const [st, cats, accs] = await Promise.all([
      api.financeStats(financeMonth.value),
      api.financeCategories(),
      api.financeAccounts(true),
    ])
    stats.value = st.data || {}
    categories.value = cats.data || []
    allAccounts.value = accs.data || []
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

async function exportCsv() {
  try {
    const res = await api.financeExport(financeMonth.value)
    const { filename, content } = res.data || {}
    const blob = new Blob([content || ''], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `finance-${financeMonth.value}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e.message || '导出失败'
  }
}

onMounted(load)
</script>

<style scoped>
.hc-row {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-family: var(--font-body);
  color: rgb(var(--c-on-surface));
  transition: background-color .15s ease;
}
.hc-row:hover { background: rgb(var(--c-surface-alt)); }
</style>

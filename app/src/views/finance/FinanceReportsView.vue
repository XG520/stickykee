<template>
  <div class="py-2 space-y-3 max-w-3xl mx-auto lg:max-w-none">
    <FinanceHeader
      title="已保存报表"
      subtitle="固化筛选条件，随时回看"
      to="/inventory/finance/me"
      back-label="返回我的"
      use-history
    />

    <!-- 桌面端双栏：左侧新建、右侧已保存 -->
    <div class="space-y-3 lg:grid lg:grid-cols-12 lg:gap-5 lg:space-y-0 lg:items-start">
    <div class="space-y-3 lg:col-span-5 lg:col-start-1 lg:row-start-1 lg:sticky lg:top-20">
    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <!-- 新建报表 -->
    <section class="rounded-2xl bg-surface border border-border p-4 space-y-3">
      <div class="text-sm font-medium font-body">新建报表</div>

      <input
        v-model="form.name"
        maxlength="40"
        placeholder="报表名称（留空自动生成）"
        class="w-full h-11 px-3 rounded-xl bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary placeholder:text-faint"
      />

      <div class="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
        <label class="block text-xs text-muted font-body">
          开始日期
          <input
            v-model="form.start"
            type="date"
            class="mt-1 w-full min-w-0 h-11 px-2.5 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="block text-xs text-muted font-body">
          结束日期
          <input
            v-model="form.end"
            type="date"
            class="mt-1 w-full min-w-0 h-11 px-2.5 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
      </div>

      <div class="space-y-1.5">
        <div class="text-[11px] text-muted font-body">类型</div>
        <div class="flex flex-wrap gap-1.5">
          <button class="hc-chip" :class="!form.type ? 'hc-chip--on' : ''" @click="form.type = ''">全部</button>
          <button class="hc-chip" :class="form.type === 'expense' ? 'hc-chip--on' : ''" @click="form.type = 'expense'">支出</button>
          <button class="hc-chip" :class="form.type === 'income' ? 'hc-chip--on' : ''" @click="form.type = 'income'">收入</button>
        </div>
      </div>

      <div v-if="formError" class="text-xs text-error font-body">{{ formError }}</div>

      <button class="hc-primary" :disabled="creating" @click="create">
        <span>{{ creating ? '保存中…' : '保存报表' }}</span>
        <span v-if="!creating" class="material-symbols-outlined text-lg">bookmark_add</span>
      </button>
    </section>

    </div>

    <!-- 已保存列表 -->
    <section class="space-y-2 lg:col-span-7 lg:col-start-6 lg:row-start-1">
      <div class="flex items-center justify-between px-1">
        <div class="text-sm font-medium font-body">已保存</div>
        <div class="text-[11px] text-muted font-body">{{ reports.length }} 份</div>
      </div>

      <div v-if="loading" class="py-8 text-center text-xs text-muted font-body">加载中…</div>
      <div
        v-else-if="!reports.length"
        class="rounded-2xl border border-dashed border-border py-10 text-center text-xs text-muted font-body"
      >还没有保存报表，先用上方表单保存一份吧</div>
      <div v-else class="space-y-2">
        <article
          v-for="r in reports"
          :key="r.id"
          class="rounded-2xl bg-surface border border-border p-4 cursor-pointer active:bg-surface-alt transition-colors"
          @click="openReport(r)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">{{ r.name }}</div>
              <div class="mt-0.5 text-[11px] text-muted font-body truncate">
                {{ rangeText(r.filters) }} · {{ typeLabel(r.filters && r.filters.types) }}
                <template v-if="r.created_at"> · {{ r.created_at.slice(0, 10) }}</template>
              </div>
            </div>
            <span class="material-symbols-outlined text-muted">chevron_right</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-body text-muted">
            <span>支出 <b class="text-on-surface font-medium">{{ money(r.summary && r.summary.expense) }}</b></span>
            <span>收入 <b class="text-accent font-medium">{{ money(r.summary && r.summary.income) }}</b></span>
            <span>结余 <b :class="balanceClass(r.summary && r.summary.balance)">{{ money(r.summary && r.summary.balance) }}</b></span>
          </div>
        </article>
      </div>
    </section>
    </div>

    <!-- 详情 Sheet -->
    <div
      v-if="detail"
      class="fixed inset-0 z-[86] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      @click.self="closeDetail"
    >
      <div
        class="w-full max-w-lg max-h-[86vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
        style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="font-headline text-lg font-semibold truncate">{{ detail.name }}</h3>
            <div class="mt-0.5 text-[11px] text-muted font-body">
              {{ rangeText(detail.filters) }} · {{ typeLabel(detail.filters && detail.filters.types) }}
            </div>
          </div>
          <button
            class="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-muted hover:text-on-surface hover:bg-surface-alt transition-colors flex-shrink-0"
            aria-label="关闭"
            @click="closeDetail"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="grid grid-cols-3 gap-2">
          <div class="rounded-xl bg-surface-alt p-2.5">
            <div class="text-[10px] text-muted font-body">支出</div>
            <div class="mt-1 text-sm font-semibold tabular-nums truncate">{{ money(detail.summary && detail.summary.expense) }}</div>
          </div>
          <div class="rounded-xl bg-surface-alt p-2.5">
            <div class="text-[10px] text-muted font-body">收入</div>
            <div class="mt-1 text-sm font-semibold tabular-nums text-accent truncate">{{ money(detail.summary && detail.summary.income) }}</div>
          </div>
          <div class="rounded-xl bg-surface-alt p-2.5">
            <div class="text-[10px] text-muted font-body">结余</div>
            <div class="mt-1 text-sm font-semibold tabular-nums truncate" :class="balanceClass(detail.summary && detail.summary.balance)">
              {{ money(detail.summary && detail.summary.balance) }}
            </div>
          </div>
        </div>
        <div class="text-[11px] text-muted font-body">共 {{ (detail.summary && detail.summary.count) || 0 }} 笔</div>

        <div v-if="detailLoading" class="py-6 text-center text-xs text-muted font-body">加载中…</div>
        <div v-else-if="detailError" class="text-xs text-error font-body">{{ detailError }}</div>
        <div v-else class="space-y-2">
          <div class="text-sm font-medium font-body">分类占比</div>
          <div v-if="(detail.by_category || []).length" class="space-y-2">
            <div v-for="(c, i) in (detail.by_category || []).slice(0, 10)" :key="i" class="space-y-1">
              <div class="flex items-center justify-between gap-2 text-xs font-body">
                <span class="flex items-center gap-1.5 min-w-0">
                  <i class="w-2 h-2 rounded-full inline-block flex-shrink-0" :class="c.type === 'income' ? 'bg-accent' : 'bg-primary'"></i>
                  <span class="truncate">{{ c.name }}</span>
                  <span class="text-[10px] text-muted flex-shrink-0">{{ c.type === 'income' ? '收' : '支' }}</span>
                </span>
                <span class="text-muted flex-shrink-0">{{ money(c.amount) }} · {{ Number(c.percent || 0).toFixed(0) }}%</span>
              </div>
              <div class="h-1.5 rounded-full bg-surface-alt overflow-hidden">
                <div
                  class="h-full rounded-full"
                  :class="c.type === 'income' ? 'bg-accent' : 'bg-primary'"
                  :style="{ width: Math.min(100, Number(c.percent) || 0) + '%' }"
                ></div>
              </div>
            </div>
          </div>
          <div v-else class="text-xs text-muted font-body">暂无分类数据</div>
        </div>

        <div class="flex gap-2 pt-1">
          <button class="flex-1 h-11 rounded-xl border border-border text-sm text-muted font-body" @click="exportReport(detail)">
            导出 CSV
          </button>
          <button class="flex-1 h-11 rounded-xl border border-error/35 bg-error/10 text-error text-sm font-body" @click="removeReport(detail)">
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '@/api'
import FinanceHeader from '@/components/finance/FinanceHeader.vue'
import { money, pad2 } from '@/utils/finance'
import { confirmAction } from '@/composables/useConfirm'

defineOptions({ name: 'FinanceReportsView' })

const reports = ref([])
const loading = ref(false)
const error = ref('')
const creating = ref(false)
const formError = ref('')

const now = new Date()
const form = ref({
  name: '',
  start: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`,
  end: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
  type: '',
})

const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')

function rangeText(filters) {
  if (!filters || !filters.start) return '—'
  return `${filters.start} ~ ${filters.end || filters.start}`
}

function typeLabel(types) {
  if (!types || types.length === 0 || types.length > 1) return '全部'
  return types[0] === 'income' ? '收入' : '支出'
}

function balanceClass(v) {
  return Number(v) < 0 ? 'text-error' : 'text-accent'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.financeReports()
    reports.value = res.data || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function create() {
  formError.value = ''
  if (!form.value.start || !form.value.end) {
    formError.value = '请选择开始和结束日期'
    return
  }
  if (form.value.start > form.value.end) {
    formError.value = '开始日期不能晚于结束日期'
    return
  }
  creating.value = true
  try {
    const name = form.value.name.trim() || `${form.value.start} ~ ${form.value.end}`
    const res = await api.createFinanceReport({
      name,
      filters: {
        start: form.value.start,
        end: form.value.end,
        types: form.value.type ? [form.value.type] : [],
      },
    })
    form.value.name = ''
    await load()
    if (res.data && res.data.id) openReport(res.data)
  } catch (e) {
    formError.value = e.message || '保存失败'
  } finally {
    creating.value = false
  }
}

async function openReport(r) {
  detail.value = { ...r }
  detailLoading.value = true
  detailError.value = ''
  try {
    const res = await api.financeReport(r.id)
    detail.value = res.data || detail.value
  } catch (e) {
    detailError.value = e.message || '加载失败'
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  detail.value = null
  detailError.value = ''
}

async function removeReport(r) {
  const ok = await confirmAction({
    title: '删除报表',
    message: `删除已保存报表「${r.name}」？`,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteFinanceReport(r.id)
    if (detail.value && detail.value.id === r.id) closeDetail()
    await load()
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function exportReport(r) {
  try {
    const res = await api.financeReportExport(r.id)
    const { filename, content } = res.data || {}
    const blob = new Blob([content || ''], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `report-${r.id}.csv`
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
.hc-chip {
  height: 32px;
  padding: 0 12px;
  border-radius: 9999px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  font-size: 12px;
  font-family: var(--font-body);
  display: inline-flex;
  align-items: center;
  transition: background-color .15s, color .15s, border-color .15s;
}
.hc-chip--on {
  background: rgb(var(--c-primary));
  border-color: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
}

.hc-primary {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: 12px;
  background: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: 500;
  transition: opacity .15s, transform .08s;
}
.hc-primary:disabled { opacity: .45; }
.hc-primary:active:not(:disabled) { transform: scale(.99); }
</style>

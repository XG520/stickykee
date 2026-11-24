<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="close"
  >
    <div class="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-headline text-lg font-semibold">账户与分类</h3>
        <button class="text-muted hover:text-on-surface" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="grid grid-cols-4 gap-2 p-1 rounded-xl bg-surface-alt">
        <button
          class="py-2 rounded-lg text-xs font-body"
          :class="tab === 'account' ? 'bg-primary text-white' : 'text-muted'"
          @click="tab = 'account'"
        >账户</button>
        <button
          class="py-2 rounded-lg text-xs font-body"
          :class="tab === 'category' ? 'bg-primary text-white' : 'text-muted'"
          @click="tab = 'category'"
        >分类</button>
        <button
          class="py-2 rounded-lg text-xs font-body"
          :class="tab === 'recurring' ? 'bg-primary text-white' : 'text-muted'"
          @click="tab = 'recurring'"
        >周期账单</button>
        <button
          class="py-2 rounded-lg text-xs font-body"
          :class="tab === 'auto' ? 'bg-primary text-white' : 'text-muted'"
          @click="tab = 'auto'"
        >自动记账</button>
      </div>

      <!-- 账户 -->
      <template v-if="tab === 'account'">
        <div class="space-y-2">
          <div v-for="a in accounts" :key="a.id" class="flex items-center justify-between gap-2 text-sm">
            <div class="min-w-0">
              <div class="truncate">
                {{ a.name }}
                <span v-if="a.archived" class="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-surface-alt text-muted">已归档</span>
              </div>
              <div class="text-[11px] text-muted font-body">{{ kindLabel(a.kind) }} · {{ money(a.balance) }}</div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button class="text-xs text-muted hover:text-primary" @click="editAccount(a)">编辑</button>
              <button class="text-xs text-muted hover:text-error" @click="removeAccount(a)">删除</button>
            </div>
          </div>
          <div v-if="!accounts.length" class="text-xs text-muted">暂无账户</div>
        </div>

        <div class="border-t border-border pt-3 space-y-2">
          <div class="text-xs font-medium text-muted font-body">{{ editingId ? '编辑账户' : '新增账户' }}</div>
          <div class="grid grid-cols-2 gap-2">
            <input
              v-model="accountForm.name"
              placeholder="账户名称"
              class="col-span-2 px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
            <UiSelect v-model="accountForm.kind" class="text-sm" :options="kinds" />
            <input
              v-model="accountForm.opening"
              type="number"
              step="0.01"
              placeholder="初始余额（元）"
              class="px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
          </div>
          <div class="flex justify-end gap-2">
            <button v-if="editingId" class="px-3 py-1.5 rounded-lg text-xs text-muted border border-border" @click="cancelEdit">取消</button>
            <button class="px-4 py-1.5 rounded-lg text-xs bg-primary text-white" @click="saveAccount">
              {{ editingId ? '保存' : '添加' }}
            </button>
          </div>
          <div v-if="error" class="text-xs text-error">{{ error }}</div>
        </div>
      </template>

      <!-- 分类 -->
      <template v-else-if="tab === 'category'">
        <div class="space-y-3">
          <div v-for="t in ['expense', 'income']" :key="t" class="space-y-1.5">
            <div class="text-xs font-medium text-muted font-body">{{ t === 'expense' ? '支出分类' : '收入分类' }}</div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="c in categories.filter((x) => x.type === t)"
                :key="c.id"
                class="group inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-alt border border-border text-xs"
              >
                <span class="material-symbols-outlined text-sm">{{ c.icon || 'label' }}</span>
                {{ c.name }}
                <button class="text-muted hover:text-error" title="删除" @click="removeCategory(c)">
                  <span class="material-symbols-outlined text-sm">close</span>
                </button>
              </span>
              <span v-if="!categories.filter((x) => x.type === t).length" class="text-xs text-muted">暂无</span>
            </div>
          </div>
        </div>

        <div class="border-t border-border pt-3 space-y-2">
          <div class="text-xs font-medium text-muted font-body">新增分类</div>
          <div class="flex items-center gap-2">
            <input
              v-model="categoryForm.name"
              placeholder="分类名称"
              class="flex-1 px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
            <UiSelect v-model="categoryForm.type" class="text-sm" :options="typeOptions" />
            <button class="px-4 py-2 rounded-lg text-sm bg-primary text-white" @click="addCategory">添加</button>
          </div>
          <div v-if="error" class="text-xs text-error">{{ error }}</div>
        </div>
      </template>

      <!-- 周期账单 -->
      <template v-else-if="tab === 'recurring'">
        <div class="space-y-2">
          <div v-for="x in recurring" :key="x.id" class="flex items-center justify-between gap-2 text-sm">
            <div class="min-w-0">
              <div class="truncate">
                {{ x.name }}
                <span class="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-surface-alt text-muted">
                  {{ x.type === 'income' ? '收入' : '支出' }}
                </span>
                <span v-if="!x.enabled" class="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-surface-alt text-muted">已暂停</span>
              </div>
              <div class="text-[11px] text-muted font-body">
                {{ money(x.amount) }} · 每月 {{ x.day_of_month }} 日 · {{ x.account_name || '账户已删除' }}
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button class="text-xs text-muted hover:text-primary" @click="toggleRecurring(x)">
                {{ x.enabled ? '暂停' : '启用' }}
              </button>
              <button class="text-xs text-muted hover:text-error" @click="removeRecurring(x)">删除</button>
            </div>
          </div>
          <div v-if="!recurring.length" class="text-xs text-muted">暂无周期账单</div>
        </div>

        <div class="border-t border-border pt-3 space-y-2">
          <div class="text-xs font-medium text-muted font-body">新增周期账单</div>
          <input
            v-model="recurringForm.name"
            placeholder="名称，如：房租 / 会员"
            class="w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
          />
          <div class="grid grid-cols-2 gap-2">
            <UiSelect v-model="recurringForm.type" class="text-sm" :options="typeOptions" />
            <input
              v-model="recurringForm.amount"
              type="number"
              step="0.01"
              placeholder="金额（元）"
              class="px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
            <UiSelect v-model="recurringForm.account_id" class="text-sm" :options="accountOptions" />
            <UiSelect v-model="recurringForm.category_id" class="text-sm" :options="recurringCategoryOptions" />
            <label class="text-xs text-muted font-body flex items-center gap-2 px-1">
              每月
              <input
                v-model.number="recurringForm.day_of_month"
                type="number"
                min="1"
                max="31"
                class="w-16 px-2 py-1.5 rounded-lg bg-surface-alt border border-border text-sm text-right outline-none focus:border-primary"
              />
              日
            </label>
            <label class="text-xs text-muted font-body flex items-center gap-1.5">
              <input v-model="recurringForm.enabled" type="checkbox" />
              启用
            </label>
          </div>
          <div class="flex justify-end">
            <button class="px-4 py-1.5 rounded-lg text-xs bg-primary text-white" @click="addRecurring">添加</button>
          </div>
          <div v-if="error" class="text-xs text-error">{{ error }}</div>
        </div>
      </template>

      <!-- 自动记账 -->
      <template v-else>
        <div class="space-y-3">
          <div v-if="!auto.supported" class="text-xs text-muted font-body leading-relaxed">
            网页版无法监听手机通知。安装糯米 APK 后，在「自动记账」中开启系统「通知使用权」，
            微信 / 支付宝的支付通知即可自动入账。
          </div>
          <template v-else>
            <div class="rounded-xl border border-border p-3 space-y-1.5">
              <div class="flex items-center justify-between text-sm">
                <span>通知监听</span>
                <span :class="auto.enabled ? 'text-primary' : 'text-error'">
                  {{ auto.enabled ? '已开启' : '未开启' }}
                </span>
              </div>
              <div class="flex items-center justify-between text-xs text-muted font-body">
                <span>待同步</span><span>{{ auto.pending || 0 }} 条</span>
              </div>
              <div class="flex items-center justify-between text-xs text-muted font-body">
                <span>服务配置</span><span>{{ auto.configured ? '已连接' : '未连接' }}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="px-3 py-1.5 rounded-lg bg-primary text-white text-xs" @click="enableNotifyAccess">
                {{ auto.enabled ? '系统设置' : '开启通知使用权' }}
              </button>
              <button class="px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted" @click="refreshAuto">刷新状态</button>
              <button class="px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted" @click="syncNow">立即同步</button>
            </div>
            <p class="text-[11px] text-muted font-body leading-relaxed">
              仅读取微信、支付宝通知的标题与正文用于识别金额，其他应用通知不会被读取或上传；识别失败不会入账。
              开启后回到本页点「刷新状态」即可查看结果。
            </p>
          </template>

          <div class="border-t border-border pt-3 space-y-2">
            <div class="text-xs font-medium text-muted font-body">官方账单 CSV 导入</div>
            <p class="text-[11px] text-muted font-body">支付宝 / 微信导出的官方账单可直接导入，重复交易自动跳过。</p>
            <button class="px-3 py-1.5 rounded-lg bg-surface-alt border border-border text-xs text-muted" @click="openImport">
              打开导入
            </button>
          </div>
          <div v-if="error" class="text-xs text-error">{{ error }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import UiSelect from '@/components/ui/UiSelect.vue'
import { confirmAction } from '@/composables/useConfirm'
import { toast } from '@/utils/browserCommands'
import {
  autoFinanceStatus,
  autoFinanceSupported,
  flushAutoFinance,
  openNotificationAccess,
  syncAutoFinanceConfig,
} from '@/utils/autoFinance'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
  initialTab: { type: String, default: 'account' },
})
const emit = defineEmits(['update:modelValue', 'changed', 'import'])

const tab = ref('account')
const error = ref('')
const editingId = ref(0)
const auto = ref({ supported: false, enabled: false, configured: false, pending: 0 })

const kinds = [
  { value: 'cash', label: '现金' },
  { value: 'debit', label: '储蓄卡' },
  { value: 'credit', label: '信用卡' },
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信' },
  { value: 'other', label: '其他' },
]

const kindIcons = {
  cash: 'payments',
  debit: 'account_balance',
  credit: 'credit_card',
  alipay: 'qr_code',
  wechat: 'chat',
  other: 'wallet',
}

const accountForm = reactive({ name: '', kind: 'cash', opening: '' })
const categoryForm = reactive({ name: '', type: 'expense' })
const recurring = ref([])
const recurringForm = reactive({
  name: '',
  type: 'expense',
  amount: '',
  account_id: 0,
  category_id: 0,
  day_of_month: 1,
  enabled: true,
})

const typeOptions = [
  { label: '支出', value: 'expense' },
  { label: '收入', value: 'income' },
]

const accountOptions = computed(() => [
  { label: '选择账户', value: 0 },
  ...(props.accounts || [])
    .filter((a) => !a.archived)
    .map((a) => ({ label: a.name, value: a.id })),
])

const recurringCategoryOptions = computed(() => [
  { label: '不指定分类', value: 0 },
  ...(props.categories || [])
    .filter((c) => c.type === recurringForm.type)
    .map((c) => ({ label: c.name, value: c.id })),
])

function kindLabel(kind) {
  return (kinds.find((k) => k.value === kind) || {}).label || '其他'
}

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

function close() {
  emit('update:modelValue', false)
}

function resetAccountForm() {
  editingId.value = 0
  accountForm.name = ''
  accountForm.kind = 'cash'
  accountForm.opening = ''
  error.value = ''
}

function editAccount(a) {
  editingId.value = a.id
  accountForm.name = a.name
  accountForm.kind = a.kind
  accountForm.opening = (Number(a.opening_balance || 0) / 100).toString()
  error.value = ''
}

function cancelEdit() {
  resetAccountForm()
}

async function saveAccount() {
  error.value = ''
  if (!accountForm.name.trim()) {
    error.value = '请填写账户名称'
    return
  }
  const payload = {
    name: accountForm.name.trim(),
    kind: accountForm.kind,
    currency: 'CNY',
    opening_balance: Math.round(Number(accountForm.opening || 0) * 100),
    icon: kindIcons[accountForm.kind] || 'wallet',
    sort: 0,
  }
  try {
    if (editingId.value) {
      await api.updateFinanceAccount(editingId.value, payload)
    } else {
      await api.createFinanceAccount(payload)
    }
    resetAccountForm()
    emit('changed')
  } catch (e) {
    error.value = e.message || '保存失败'
  }
}

async function removeAccount(a) {
  const ok = await confirmAction({
    title: '删除账户',
    message: `删除账户「${a.name}」？\n已有流水时将转为归档。`,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    const res = await api.deleteFinanceAccount(a.id)
    if (res.data && res.data.archived) {
      toast('该账户已有流水，已转为归档（不再出现在记账账户中）。')
    }
    emit('changed')
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function addCategory() {
  error.value = ''
  if (!categoryForm.name.trim()) {
    error.value = '请填写分类名称'
    return
  }
  try {
    await api.createFinanceCategory({
      name: categoryForm.name.trim(),
      type: categoryForm.type,
      icon: categoryForm.type === 'income' ? 'payments' : 'label',
    })
    categoryForm.name = ''
    emit('changed')
  } catch (e) {
    error.value = e.message || '添加失败'
  }
}

async function removeCategory(c) {
  const ok = await confirmAction({
    title: '删除分类',
    message: `删除分类「${c.name}」？`,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteFinanceCategory(c.id)
    emit('changed')
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function loadRecurring() {
  try {
    const res = await api.financeRecurring()
    recurring.value = res.data || []
  } catch (e) {
    error.value = e.message || '加载周期账单失败'
  }
}

function recurringPayload(x, enabled) {
  return {
    name: x.name,
    type: x.type,
    amount: x.amount,
    account_id: x.account_id,
    category_id: x.category_id,
    day_of_month: x.day_of_month,
    enabled,
  }
}

async function addRecurring() {
  error.value = ''
  if (!recurringForm.name.trim()) {
    error.value = '请填写名称'
    return
  }
  if (!recurringForm.account_id) {
    error.value = '请选择账户'
    return
  }
  const amount = Math.round(Number(recurringForm.amount || 0) * 100)
  if (amount <= 0) {
    error.value = '请填写金额'
    return
  }
  try {
    await api.createFinanceRecurring({
      name: recurringForm.name.trim(),
      type: recurringForm.type,
      amount,
      account_id: recurringForm.account_id,
      category_id: recurringForm.category_id,
      day_of_month: Number(recurringForm.day_of_month) || 1,
      enabled: recurringForm.enabled,
    })
    recurringForm.name = ''
    recurringForm.amount = ''
    recurringForm.day_of_month = 1
    recurringForm.enabled = true
    await loadRecurring()
    emit('changed')
  } catch (e) {
    error.value = e.message || '添加失败'
  }
}

async function toggleRecurring(x) {
  try {
    await api.updateFinanceRecurring(x.id, recurringPayload(x, !x.enabled))
    await loadRecurring()
    emit('changed')
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

async function removeRecurring(x) {
  const ok = await confirmAction({
    title: '删除周期账单',
    message: `删除周期账单「${x.name}」？`,
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await api.deleteFinanceRecurring(x.id)
    await loadRecurring()
    emit('changed')
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

watch(tab, (v) => {
  if (v === 'recurring') loadRecurring()
  if (v === 'auto') refreshAuto()
})

function refreshAuto() {
  if (!autoFinanceSupported()) {
    auto.value = { supported: false, enabled: false, configured: false, pending: 0 }
    return
  }
  syncAutoFinanceConfig()
  auto.value = autoFinanceStatus()
}

function enableNotifyAccess() {
  syncAutoFinanceConfig()
  openNotificationAccess()
}

function syncNow() {
  syncAutoFinanceConfig()
  flushAutoFinance()
  window.setTimeout(refreshAuto, 1200)
}

function openImport() {
  emit('update:modelValue', false)
  emit('import')
}

watch(() => props.modelValue, (v) => {
  if (v) {
    resetAccountForm()
    tab.value = props.initialTab || 'account'
  }
})
</script>

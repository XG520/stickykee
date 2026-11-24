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

      <div class="grid grid-cols-2 gap-2 p-1 rounded-xl bg-surface-alt">
        <button
          class="py-2 rounded-lg text-sm font-body"
          :class="tab === 'account' ? 'bg-primary text-white' : 'text-muted'"
          @click="tab = 'account'"
        >账户</button>
        <button
          class="py-2 rounded-lg text-sm font-body"
          :class="tab === 'category' ? 'bg-primary text-white' : 'text-muted'"
          @click="tab = 'category'"
        >分类</button>
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
            <select v-model="accountForm.kind" class="px-2 py-2 rounded-lg bg-surface-alt border border-border text-sm">
              <option v-for="k in kinds" :key="k.value" :value="k.value">{{ k.label }}</option>
            </select>
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
      <template v-else>
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
            <select v-model="categoryForm.type" class="px-2 py-2 rounded-lg bg-surface-alt border border-border text-sm">
              <option value="expense">支出</option>
              <option value="income">收入</option>
            </select>
            <button class="px-4 py-2 rounded-lg text-sm bg-primary text-white" @click="addCategory">添加</button>
          </div>
          <div v-if="error" class="text-xs text-error">{{ error }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import api from '@/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const tab = ref('account')
const error = ref('')
const editingId = ref(0)

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
  if (!window.confirm(`删除账户「${a.name}」？已有流水时将转为归档。`)) return
  try {
    const res = await api.deleteFinanceAccount(a.id)
    if (res.data && res.data.archived) {
      window.alert('该账户已有流水，已转为归档（不再出现在记账账户中）。')
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
  if (!window.confirm(`删除分类「${c.name}」？`)) return
  try {
    await api.deleteFinanceCategory(c.id)
    emit('changed')
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

watch(() => props.modelValue, (v) => {
  if (v) {
    resetAccountForm()
    tab.value = 'account'
  }
})
</script>

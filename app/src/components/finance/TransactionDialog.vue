<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="close"
  >
    <div class="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-headline text-lg font-semibold">{{ transaction ? '编辑账目' : '记一笔' }}</h3>
        <button class="text-muted hover:text-on-surface" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <!-- 收支类型 -->
      <div class="grid grid-cols-2 gap-2 p-1 rounded-xl bg-surface-alt">
        <button
          class="py-2 rounded-lg text-sm font-body"
          :class="type === 'expense' ? 'bg-primary text-white' : 'text-muted'"
          @click="setType('expense')"
        >支出</button>
        <button
          class="py-2 rounded-lg text-sm font-body"
          :class="type === 'income' ? 'bg-primary text-white' : 'text-muted'"
          @click="setType('income')"
        >收入</button>
      </div>

      <!-- 金额 -->
      <div class="text-right">
        <span class="text-sm text-muted font-body">{{ currencySymbol }}</span>
        <span class="font-headline text-4xl font-semibold ml-1" :class="type === 'income' ? 'text-primary' : 'text-on-background'">
          {{ amount || '0' }}
        </span>
        <div v-if="currency !== 'CNY' && cnyPreview > 0" class="text-[11px] text-muted font-body">
          ≈ ¥{{ (cnyPreview / 100).toFixed(2) }}
        </div>
      </div>

      <!-- 分类九宫格 -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="text-xs text-muted font-body">分类</div>
          <button
            class="flex items-center gap-1 text-xs text-primary disabled:opacity-50"
            :disabled="recognizing"
            @click="pickImage"
          >
            <span class="material-symbols-outlined text-base">photo_camera</span>
            {{ recognizing ? '识别中…' : '识图记账' }}
          </button>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onImage" />
        </div>
        <div v-if="candidates.length" class="space-y-1">
          <button
            v-for="(c, i) in candidates"
            :key="i"
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-border bg-surface-alt text-xs text-left"
            @click="applyCandidate(c)"
          >
            <span class="truncate">{{ c.type === 'income' ? '收入' : '支出' }} · {{ c.category || '未分类' }}{{ c.note ? ' · ' + c.note : '' }}</span>
            <span class="flex-shrink-0 text-muted">¥{{ (c.amount / 100).toFixed(2) }}</span>
          </button>
        </div>
        <div v-if="recognizeError" class="text-xs text-error">{{ recognizeError }}</div>
        <div class="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-44 overflow-y-auto">
          <button
            v-for="c in flatCategories"
            :key="c.id"
            class="flex flex-col items-center gap-1 py-2 rounded-xl border text-[11px] font-body"
            :class="categoryId === c.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted'"
            @click="categoryId = c.id"
          >
            <span class="material-symbols-outlined text-xl">{{ c.icon || 'label' }}</span>
            <span class="truncate max-w-full px-0.5">{{ c.name }}</span>
          </button>
          <div v-if="!flatCategories.length" class="col-span-4 text-xs text-muted py-2">暂无分类，请在「分类管理」中添加</div>
        </div>
      </div>

      <!-- 账户 / 日期 / 备注 -->
      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs text-muted font-body">
          账户
          <select
            v-model.number="accountId"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          >
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="text-xs text-muted font-body">
          日期
          <input
            v-model="date"
            type="date"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body">
          币种
          <select
            v-model="currency"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          >
            <option v-for="c in currencies" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label v-if="currency !== 'CNY'" class="text-xs text-muted font-body">
          汇率（1 {{ currency }} = ? 元）
          <input
            v-model="fxRate"
            type="number"
            step="0.0001"
            min="0"
            placeholder="如 7.20"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body col-span-2">
          备注
          <input
            v-model="note"
            placeholder="如：午饭 / 地铁 / 工资"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body col-span-2">
          标签
          <input
            v-model="tags"
            placeholder="逗号分隔，如：出差,报销"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
      </div>

      <!-- 自定义数字键盘 -->
      <div class="grid grid-cols-3 gap-1.5">
        <button v-for="k in ['1','2','3','4','5','6','7','8','9','.','0','del']" :key="k"
          class="py-2.5 rounded-xl bg-surface-alt border border-border text-base font-body text-on-surface active:bg-primary/10"
          @click="press(k)"
        >
          <span v-if="k === 'del'" class="material-symbols-outlined text-xl align-middle">backspace</span>
          <span v-else>{{ k }}</span>
        </button>
      </div>

      <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

      <div class="flex justify-end gap-2">
        <button class="px-4 py-2 rounded-lg text-sm text-muted border border-border" @click="close">取消</button>
        <button
          class="px-5 py-2 rounded-lg text-sm bg-primary text-white disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import api from '@/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
  transaction: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const type = ref('expense')
const amount = ref('')
const accountId = ref(0)
const categoryId = ref(0)
const date = ref('')
const note = ref('')
const tags = ref('')
const currency = ref('CNY')
const fxRate = ref('')
const saving = ref(false)
const error = ref('')

const currencies = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'GBP']
const currencySymbols = { CNY: '¥', USD: '$', EUR: '€', JPY: 'JP¥', HKD: 'HK$', GBP: '£' }
const currencySymbol = computed(() => currencySymbols[currency.value] || currency.value)

const candidates = ref([])
const recognizing = ref(false)
const recognizeError = ref('')
const fileInput = ref(null)

const cnyPreview = computed(() => {
  if (currency.value === 'CNY') return 0
  const rate = Number(fxRate.value)
  if (!(rate > 0)) return 0
  return Math.round(Number(amount.value || 0) * 100 * rate)
})

const flatCategories = computed(() => {
  const out = []
  for (const c of props.categories) {
    if (c.type !== type.value) continue
    out.push(c)
    for (const ch of c.children || []) out.push(ch)
  }
  return out
})

function pad(n) {
  return String(n).padStart(2, '0')
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function reset() {
  error.value = ''
  candidates.value = []
  recognizeError.value = ''
  const tx = props.transaction
  if (tx) {
    type.value = tx.type === 'income' ? 'income' : 'expense'
    const cents = Number(tx.orig_amount) > 0 ? Number(tx.orig_amount) : Number(tx.amount || 0)
    amount.value = (cents / 100).toFixed(2).replace(/\.?0+$/, '') || '0'
    accountId.value = tx.account_id || 0
    categoryId.value = tx.category_id || 0
    date.value = (tx.occurred_at || '').slice(0, 10) || todayString()
    note.value = tx.note || ''
    tags.value = tx.tags || ''
    currency.value = tx.currency || 'CNY'
    fxRate.value = Number(tx.fx_rate) > 0 ? String(tx.fx_rate) : ''
    return
  }
  type.value = 'expense'
  amount.value = ''
  const last = Number(localStorage.getItem('hc_fin_last_account') || 0)
  const found = props.accounts.find((a) => a.id === last)
  accountId.value = found ? found.id : (props.accounts[0] || {}).id || 0
  const food = flatCategories.value.find((c) => c.name === '餐饮')
  categoryId.value = food ? food.id : (flatCategories.value[0] || {}).id || 0
  date.value = todayString()
  note.value = ''
  tags.value = ''
  currency.value = 'CNY'
  fxRate.value = ''
}

function setType(t) {
  if (type.value === t) return
  type.value = t
  const first = flatCategories.value[0]
  categoryId.value = first ? first.id : 0
}

function press(k) {
  if (k === 'del') {
    amount.value = amount.value.slice(0, -1)
    return
  }
  if (k === '.') {
    if (!amount.value) amount.value = '0'
    if (!amount.value.includes('.')) amount.value += '.'
    return
  }
  if (amount.value.includes('.') && amount.value.split('.')[1].length >= 2) return
  if (amount.value === '0') amount.value = k
  else amount.value += k
  if (amount.value.replace('.', '').length > 9) amount.value = amount.value.slice(0, amount.value.length - 1)
}

function close() {
  emit('update:modelValue', false)
}

function pickImage() {
  if (recognizing.value) return
  fileInput.value?.click()
}

function applyCandidate(c) {
  type.value = c.type === 'income' ? 'income' : 'expense'
  amount.value = (Number(c.amount || 0) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'
  const exact = flatCategories.value.find((x) => x.name === c.category)
  const loose = flatCategories.value.find((x) => c.category && (x.name.includes(c.category) || c.category.includes(x.name)))
  if (exact || loose) categoryId.value = (exact || loose).id
  if (c.note) note.value = c.note
  if (c.tags) tags.value = c.tags
  if (c.occurred_at) date.value = String(c.occurred_at).slice(0, 10)
}

async function onImage(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  recognizeError.value = ''
  recognizing.value = true
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const res = await api.financeRecognize(dataUrl)
    candidates.value = (res.data && res.data.items) || []
    if (!candidates.value.length) {
      recognizeError.value = '未识别到账目，可手动填写'
    } else {
      applyCandidate(candidates.value[0])
    }
  } catch (err) {
    recognizeError.value = err.message || '识别失败'
  } finally {
    recognizing.value = false
    e.target.value = ''
  }
}

async function save() {
  error.value = ''
  const cents = Math.round(Number(amount.value || 0) * 100)
  if (!cents || cents <= 0) {
    error.value = '请输入金额'
    return
  }
  let cnyCents = cents
  if (currency.value !== 'CNY') {
    const rate = Number(fxRate.value)
    if (!(rate > 0)) {
      error.value = '请填写汇率'
      return
    }
    cnyCents = Math.round(cents * rate)
  }
  if (!accountId.value) {
    error.value = '请选择账户'
    return
  }
  if (!date.value) {
    error.value = '请选择日期'
    return
  }
  const now = new Date()
  const time = props.transaction && (props.transaction.occurred_at || '').length > 10
    ? props.transaction.occurred_at.slice(11, 16)
    : `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const payload = {
    type: type.value,
    amount: cnyCents,
    account_id: accountId.value,
    category_id: categoryId.value,
    currency: currency.value,
    orig_amount: currency.value === 'CNY' ? 0 : cents,
    fx_rate: currency.value === 'CNY' ? 0 : Number(fxRate.value),
    note: note.value.trim(),
    tags: tags.value.trim(),
    occurred_at: `${date.value} ${time}`,
  }
  saving.value = true
  try {
    if (props.transaction) {
      await api.updateFinanceTransaction(props.transaction.id, payload)
    } else {
      await api.createFinanceTransaction(payload)
    }
    localStorage.setItem('hc_fin_last_account', String(accountId.value))
    emit('saved')
    close()
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.modelValue, (v) => {
  if (v) reset()
})
</script>

<template>
  <div class="hc-add-root" :style="{ paddingTop: 'env(safe-area-inset-top)' }">
    <!-- 头部 -->
    <header class="flex items-center gap-2 px-3 h-14 shrink-0 border-b border-border/60">
      <button class="hc-ic" :aria-label="editing ? '取消编辑' : '关闭'" @click="close">
        <span class="material-symbols-outlined">{{ editing ? 'close' : 'arrow_back' }}</span>
      </button>
      <div class="flex-1 min-w-0">
        <div class="text-[10px] tracking-[0.14em] uppercase text-muted font-body">{{ editing ? '编辑账目' : '记一笔' }}</div>
        <h1 class="font-headline text-base font-semibold leading-tight truncate">{{ editing ? '修改这一笔' : '快速记一笔' }}</h1>
      </div>
      <button
        class="h-9 px-3 rounded-full border border-border bg-surface-alt text-[11px] text-muted font-body flex items-center gap-1 disabled:opacity-50"
        :disabled="recognizing"
        @click="pickImage"
      >
        <span class="material-symbols-outlined text-base">photo_camera</span>
        {{ recognizing ? '识别中…' : '识图' }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onImage" />
    </header>

    <!-- 分类与识图结果 -->
    <div class="flex-1 min-h-0 overflow-y-auto px-4 pt-3">
      <div class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-surface-alt">
        <button
          class="hc-type"
          :class="type === 'expense' ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
          @click="setType('expense')"
        >
          <span class="material-symbols-outlined text-base" :class="type === 'expense' ? 'text-primary' : ''">south_west</span>
          支出
        </button>
        <button
          class="hc-type"
          :class="type === 'income' ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
          @click="setType('income')"
        >
          <span class="material-symbols-outlined text-base" :class="type === 'income' ? 'text-primary' : ''">north_east</span>
          收入
        </button>
      </div>

      <div v-if="candidates.length > 1" class="mt-3 space-y-1">
        <div class="text-[11px] text-muted font-body">识别到 {{ candidates.length }} 笔，点选填入</div>
        <button
          v-for="(c, i) in candidates"
          :key="i"
          class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-primary/25 bg-primary/5 text-xs text-left"
          @click="applyCandidate(c)"
        >
          <span class="truncate">{{ c.type === 'income' ? '收入' : '支出' }} · {{ c.category || '未分类' }}{{ c.note ? ' · ' + c.note : '' }}</span>
          <span class="flex-shrink-0 font-medium text-primary">¥{{ (Number(c.amount || 0) / 100).toFixed(2) }}</span>
        </button>
      </div>

      <div v-if="recognizeError" class="mt-2 text-xs text-error font-body">{{ recognizeError }}</div>

      <!-- 分类九宫格 -->
      <div class="mt-3 grid grid-cols-4 gap-2">
        <button
          v-for="c in topCategories"
          :key="c.id"
          class="relative flex flex-col items-center gap-1.5 pt-3 pb-2.5 rounded-2xl border transition-colors"
          :class="isTopActive(c)
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-surface-alt/50 text-on-surface active:border-primary/40'"
          @click="chooseCategory(c)"
        >
          <span
            class="w-10 h-10 rounded-full flex items-center justify-center"
            :class="isTopActive(c) ? 'bg-primary text-on-primary' : 'bg-surface-alt text-muted'"
          >
            <span class="material-symbols-outlined text-[22px]">{{ c.icon || 'label' }}</span>
          </span>
          <span class="text-[11px] font-body truncate max-w-full px-1">{{ c.name }}</span>
          <span
            v-if="isTopActive(c)"
            class="absolute top-1.5 right-1.5 material-symbols-outlined text-[15px] text-primary"
          >check_circle</span>
          <span
            v-else-if="hasChildren(c)"
            class="absolute top-1.5 right-1.5 material-symbols-outlined text-[15px] text-muted"
          >chevron_right</span>
        </button>
        <div v-if="!topCategories.length" class="col-span-4 text-xs text-muted py-6 text-center font-body">
          暂无分类
          <button class="block mx-auto mt-2 text-primary" @click="loadCategories">重新加载分类</button>
        </div>
      </div>

      <!-- 子分类 -->
      <div v-if="drillParent" class="mt-3">
        <div class="text-[11px] text-muted font-body mb-1.5">{{ drillParent.name }} 子分类</div>
        <div class="flex flex-wrap gap-1.5">
          <button
            class="hc-chip"
            :class="categoryId === drillParent.id ? 'hc-chip--on' : ''"
            @click="selectCategory(drillParent)"
          >直接用「{{ drillParent.name }}」</button>
          <button
            v-for="ch in drillParent.children"
            :key="ch.id"
            class="hc-chip"
            :class="categoryId === ch.id ? 'hc-chip--on' : ''"
            @click="selectCategory(ch)"
          >{{ ch.name }}</button>
        </div>
      </div>

      <div class="mt-3 pb-2 text-[11px] text-muted font-body text-center">
        {{ categoryId ? '已选：' + selectedCategoryPath : '请选择一个分类' }}
      </div>
    </div>

    <!-- 金额 + 键盘 + 操作 -->
    <div class="shrink-0 px-4 pb-3" :style="{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }">
      <div v-if="error" class="text-xs text-error font-body mb-1.5">{{ error }}</div>

      <div class="flex items-end justify-between gap-3">
        <div class="flex items-baseline gap-1 min-w-0" :class="type === 'income' ? 'text-accent' : 'text-on-background'">
          <span class="text-base font-body">{{ currencySymbol }}</span>
          <span class="font-headline text-[40px] leading-none font-semibold tracking-tight tabular-nums truncate">{{ amount || '0' }}</span>
          <span class="hc-caret"></span>
        </div>
        <div class="text-right text-[10px] font-body text-muted shrink-0">
          {{ type === 'income' ? '收入' : '支出' }}
          <template v-if="currency !== 'CNY' && cnyPreview > 0"> · ≈ ¥{{ (cnyPreview / 100).toFixed(2) }}</template>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 mt-3">
        <button v-for="k in keys" :key="k" class="hc-key" @click="press(k)">
          <span v-if="k === 'del'" class="material-symbols-outlined text-xl align-middle">backspace</span>
          <span v-else>{{ k }}</span>
        </button>
      </div>

      <button class="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-alt border border-border text-left" @click="moreOpen = true">
        <span class="material-symbols-outlined text-base text-muted">tune</span>
        <span class="flex-1 min-w-0 text-[11px] text-muted font-body truncate">
          {{ accountName }} · {{ payMethodLabel(payMethod) || '支付方式' }} · {{ date }}
        </span>
        <span class="material-symbols-outlined text-base text-muted">chevron_right</span>
      </button>

      <button class="hc-primary mt-2" :disabled="saving" @click="save">
        <span>{{ saving ? '保存中…' : (editing ? '保存修改' : '保存这一笔') }}</span>
        <span v-if="!saving" class="material-symbols-outlined text-lg">check</span>
      </button>
    </div>

    <!-- 补充信息 Sheet -->
    <div v-if="moreOpen" class="fixed inset-0 z-20 flex items-end justify-center bg-black/50" @click.self="moreOpen = false">
      <div class="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-surface border border-border rounded-t-2xl p-5 space-y-3" style="padding-bottom: calc(1.25rem + env(safe-area-inset-bottom))">
        <div class="flex items-center justify-between">
          <h3 class="font-headline text-lg font-semibold">补充信息</h3>
          <button class="text-muted hover:text-on-surface" @click="moreOpen = false">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs text-muted font-body">
            账户
            <UiSelect v-model="accountId" class="mt-1 w-full text-sm" :options="accountOptions" />
          </label>
          <label class="text-xs text-muted font-body">
            日期
            <input
              v-model="date"
              type="date"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
        </div>

        <div class="space-y-1.5">
          <div class="text-xs text-muted font-body">支付方式</div>
          <div class="flex flex-wrap gap-1.5">
            <button class="hc-chip" :class="!payMethod ? 'hc-chip--on' : ''" @click="payMethod = ''">不记录</button>
            <button
              v-for="p in PAY_METHOD_OPTIONS"
              :key="p.value"
              class="hc-chip"
              :class="payMethod === p.value ? 'hc-chip--on' : ''"
              @click="payMethod = p.value"
            >{{ p.label }}</button>
          </div>
        </div>

        <label class="block text-xs text-muted font-body">
          备注
          <input
            v-model="note"
            placeholder="如：午饭 / 地铁 / 工资"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs text-muted font-body">
            币种
            <UiSelect v-model="currency" class="mt-1 w-full text-sm" :options="currencyOptions" />
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
            标签
            <input
              v-model="tags"
              placeholder="逗号分隔，如：出差,报销"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
        </div>

        <button class="hc-primary" @click="moreOpen = false">完成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import UiSelect from '@/components/ui/UiSelect.vue'
import { financeEditing, bumpFinanceVersion } from '@/store/finance'
import { PAY_METHOD_OPTIONS, pad2, payMethodLabel } from '@/utils/finance'

defineOptions({ name: 'FinanceAddView' })

const router = useRouter()
const editing = financeEditing.value

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']
const currencies = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'GBP']
const currencySymbols = { CNY: '¥', USD: '$', EUR: '€', JPY: 'JP¥', HKD: 'HK$', GBP: '£' }
const currencyOptions = currencies.map((c) => ({ label: c, value: c }))

const categories = ref([])
const accounts = ref([])
const type = ref('expense')
const amount = ref('')
const accountId = ref(0)
const categoryId = ref(0)
const date = ref('')
const note = ref('')
const tags = ref('')
const currency = ref('CNY')
const fxRate = ref('')
const payMethod = ref('')
const drillParent = ref(null)
const moreOpen = ref(false)
const saving = ref(false)
const error = ref('')

const candidates = ref([])
const recognizing = ref(false)
const recognizeError = ref('')
const fileInput = ref(null)

const currencySymbol = computed(() => currencySymbols[currency.value] || currency.value)
const accountOptions = computed(() => (accounts.value || []).map((a) => ({ label: a.name, value: a.id })))
const accountName = computed(() => {
  const a = accounts.value.find((x) => x.id === accountId.value)
  return a ? a.name : '未选账户'
})

const topCategories = computed(() => categories.value.filter((c) => c.type === type.value))

const flatCategories = computed(() => {
  const out = []
  for (const c of categories.value) {
    if (c.type !== type.value) continue
    out.push(c)
    for (const ch of c.children || []) out.push({ ...ch, parent_id: ch.parent_id || c.id })
  }
  return out
})

const selectedCategory = computed(() => flatCategories.value.find((c) => c.id === categoryId.value) || null)
const selectedCategoryPath = computed(() => {
  const c = selectedCategory.value
  if (!c) return ''
  if (c.parent_id) {
    const p = topCategories.value.find((x) => x.id === c.parent_id)
    if (p) return `${p.name} · ${c.name}`
  }
  return c.name
})

const cnyPreview = computed(() => {
  if (currency.value === 'CNY') return 0
  const rate = Number(fxRate.value)
  if (!(rate > 0)) return 0
  return Math.round(Number(amount.value || 0) * 100 * rate)
})

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function hasChildren(c) {
  return !!(c && c.children && c.children.length)
}

function isTopActive(c) {
  if (categoryId.value === c.id) return true
  return (c.children || []).some((ch) => ch.id === categoryId.value)
}

function defaultCategory(t) {
  const tops = categories.value.filter((c) => c.type === t)
  const preferred = tops.find((c) => c.name === '餐饮') || tops[0]
  if (!preferred) return 0
  if (hasChildren(preferred)) {
    const ch = preferred.children[0]
    return ch ? ch.id : preferred.id
  }
  return preferred.id
}

function syncDrill() {
  const c = selectedCategory.value
  if (c && c.parent_id) {
    drillParent.value = topCategories.value.find((x) => x.id === c.parent_id) || null
  } else {
    drillParent.value = null
  }
}

function setType(t) {
  if (type.value === t) return
  type.value = t
  drillParent.value = null
  categoryId.value = defaultCategory(t)
  error.value = ''
}

function chooseCategory(c) {
  categoryId.value = c.id
  error.value = ''
  drillParent.value = hasChildren(c) ? c : null
}

function selectCategory(c) {
  categoryId.value = c.id
  error.value = ''
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

async function loadCategories() {
  try {
    const res = await api.financeCategories()
    categories.value = res.data || []
    if (!categoryId.value) {
      const id = defaultCategory(type.value)
      if (id) categoryId.value = id
    }
    syncDrill()
  } catch (e) {
    error.value = e.message || '分类加载失败'
  }
}

async function loadAccounts() {
  try {
    const res = await api.financeAccounts()
    accounts.value = res.data || []
    if (!accountId.value) {
      const last = Number(localStorage.getItem('hc_fin_last_account') || 0)
      const found = accounts.value.find((a) => a.id === last)
      accountId.value = found ? found.id : ((accounts.value[0] || {}).id || 0)
    }
  } catch (e) {
    error.value = e.message || '账户加载失败'
  }
}

function resetFromEditing() {
  const tx = editing
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
    payMethod.value = tx.pay_method || ''
    return
  }
  type.value = 'expense'
  amount.value = ''
  date.value = todayString()
  note.value = ''
  tags.value = ''
  currency.value = 'CNY'
  fxRate.value = ''
  payMethod.value = ''
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
  drillParent.value = null
  error.value = ''
  candidates.value = []
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

function close() {
  if (editing) {
    financeEditing.value = null
    router.back()
    return
  }
  if (window.history.length > 1) router.back()
  else router.replace('/inventory/finance/ledger')
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
      moreOpen.value = true
      return
    }
    cnyCents = Math.round(cents * rate)
  }
  if (!accountId.value) {
    error.value = '请选择账户'
    moreOpen.value = true
    return
  }
  if (!date.value) {
    error.value = '请选择日期'
    moreOpen.value = true
    return
  }
  const now = new Date()
  const time = editing && (editing.occurred_at || '').length > 10
    ? editing.occurred_at.slice(11, 16)
    : `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
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
    pay_method: payMethod.value || '',
    occurred_at: `${date.value} ${time}`,
  }
  saving.value = true
  try {
    if (editing) await api.updateFinanceTransaction(editing.id, payload)
    else await api.createFinanceTransaction(payload)
    localStorage.setItem('hc_fin_last_account', String(accountId.value))
    bumpFinanceVersion()
    financeEditing.value = null
    router.replace('/inventory/finance/ledger')
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

function onKeydown(e) {
  if (saving.value) return
  if (e.key >= '0' && e.key <= '9') {
    press(e.key)
    e.preventDefault()
  } else if (e.key === '.') {
    press('.')
    e.preventDefault()
  } else if (e.key === 'Backspace') {
    press('del')
    e.preventDefault()
  } else if (e.key === 'Enter') {
    save()
    e.preventDefault()
  }
}

onMounted(async () => {
  resetFromEditing()
  await Promise.all([loadCategories(), loadAccounts()])
  if (editing) syncDrill()
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  financeEditing.value = null
})
</script>

<style scoped>
.hc-add-root {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-background));
}
.hc-ic {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-on-surface));
  flex-shrink: 0;
}
.hc-ic:hover { background: rgb(var(--c-surface-alt)); }

.hc-type {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 0;
  border-radius: 12px;
  font-size: 13px;
  font-family: var(--font-body);
  transition: background-color .18s, color .18s, box-shadow .18s;
}

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

.hc-key {
  height: 46px;
  border-radius: 14px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-family: var(--font-headline);
  font-size: 19px;
  font-weight: 500;
  transition: background-color .12s, transform .08s, border-color .12s;
}
.hc-key:hover { border-color: rgb(var(--c-primary) / .4); }
.hc-key:active { background: rgb(var(--c-primary) / .12); transform: scale(.97); }

.hc-primary {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 48px;
  border-radius: 14px;
  background: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: 500;
  box-shadow: 0 8px 22px rgb(var(--c-primary) / .22);
  transition: opacity .15s, transform .08s;
}
.hc-primary:disabled { opacity: .45; box-shadow: none; }
.hc-primary:active:not(:disabled) { transform: scale(.99); }

.hc-caret {
  display: inline-block;
  width: 2px;
  height: 28px;
  margin-left: 1px;
  border-radius: 1px;
  background: rgb(var(--c-primary));
  animation: hc-blink 1.1s steps(1, end) infinite;
}
@keyframes hc-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
</style>

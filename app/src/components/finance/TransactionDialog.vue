<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="close"
  >
    <div class="w-full max-w-md max-h-[92vh] bg-surface border border-border rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden">
      <!-- 头部：返回 / 标题 / 识图 -->
      <header class="px-5 pt-4 pb-3 shrink-0">
        <div class="flex items-center gap-2">
          <button
            class="tx-icon-btn"
            :title="step === 1 && !drillParent ? '关闭' : '返回'"
            @click="back"
          >
            <span class="material-symbols-outlined text-xl">{{ step === 1 && !drillParent ? 'close' : 'arrow_back' }}</span>
          </button>
          <div class="flex-1 min-w-0">
            <div class="text-[10px] tracking-[0.14em] uppercase text-muted font-body">
              {{ transaction ? '编辑账目' : '记一笔' }}
            </div>
            <h3 class="font-headline text-lg font-semibold leading-tight truncate">{{ stepTitle }}</h3>
          </div>
          <button
            v-if="step === 1"
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-border bg-surface-alt text-[11px] text-muted font-body disabled:opacity-50"
            :disabled="recognizing"
            @click="pickImage"
          >
            <span class="material-symbols-outlined text-base">photo_camera</span>
            {{ recognizing ? '识别中…' : '识图' }}
          </button>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onImage" />
        </div>

        <!-- 步骤条 -->
        <div class="mt-3 grid grid-cols-3 gap-1.5">
          <button
            v-for="s in steps"
            :key="s.n"
            class="text-left"
            :class="s.n < step ? 'cursor-pointer' : 'cursor-default'"
            :disabled="s.n >= step"
            @click="goStep(s.n)"
          >
            <div
              class="h-1 rounded-full transition-colors duration-300"
              :class="step >= s.n ? 'bg-primary' : 'bg-surface-alt'"
            ></div>
            <div
              class="mt-1.5 flex items-center gap-1 text-[10px] font-body transition-colors"
              :class="step === s.n ? 'text-on-surface' : 'text-muted'"
            >
              <span
                class="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] leading-none"
                :class="step > s.n ? 'bg-primary text-white' : step === s.n ? 'bg-primary/15 text-primary' : 'bg-surface-alt text-muted'"
              >{{ step > s.n ? '✓' : s.n }}</span>
              {{ s.label }}
            </div>
          </button>
        </div>
      </header>

      <!-- 步骤内容 -->
      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 pb-2">
        <Transition :name="transitionName" mode="out-in">
          <!-- ① 分类 -->
          <section v-if="step === 1" key="s1" class="space-y-3">
            <div class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-surface-alt">
              <button
                class="tx-type-btn"
                :class="type === 'expense' ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
                @click="setType('expense')"
              >
                <span class="material-symbols-outlined text-base" :class="type === 'expense' ? 'text-primary' : ''">south_west</span>
                支出
              </button>
              <button
                class="tx-type-btn"
                :class="type === 'income' ? 'bg-surface text-on-surface shadow-sm' : 'text-muted'"
                @click="setType('income')"
              >
                <span class="material-symbols-outlined text-base" :class="type === 'income' ? 'text-primary' : ''">north_east</span>
                收入
              </button>
            </div>

            <!-- 识图结果 -->
            <div v-if="candidates.length" class="space-y-1">
              <div class="text-[11px] text-muted font-body">识别到 {{ candidates.length }} 笔，点选直接填入</div>
              <button
                v-for="(c, i) in candidates"
                :key="i"
                class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-primary/25 bg-primary/5 text-xs text-left"
                @click="applyCandidate(c)"
              >
                <span class="truncate">{{ c.type === 'income' ? '收入' : '支出' }} · {{ c.category || '未分类' }}{{ c.note ? ' · ' + c.note : '' }}</span>
                <span class="flex-shrink-0 font-medium text-primary">¥{{ (c.amount / 100).toFixed(2) }}</span>
              </button>
            </div>
            <div v-if="recognizeError" class="text-xs text-error">{{ recognizeError }}</div>

            <!-- 子分类层级 -->
            <template v-if="drillParent">
              <div class="flex items-center gap-1 text-xs font-body text-muted">
                <button class="hover:text-on-surface" @click="drillParent = null">全部分类</button>
                <span class="material-symbols-outlined text-sm">chevron_right</span>
                <span class="text-on-surface">{{ drillParent.name }}</span>
              </div>
              <div class="rounded-2xl border border-border overflow-hidden divide-y divide-border">
                <button class="tx-cat-row" @click="selectCategory(drillParent)">
                  <span
                    class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    :class="categoryId === drillParent.id ? 'bg-primary text-white' : 'bg-surface-alt text-muted'"
                  >
                    <span class="material-symbols-outlined text-lg">{{ drillParent.icon || 'label' }}</span>
                  </span>
                  <span class="flex-1 min-w-0">
                    <span class="block text-sm truncate">直接用「{{ drillParent.name }}」</span>
                    <span class="block text-[11px] text-muted">不细分子类</span>
                  </span>
                  <span v-if="categoryId === drillParent.id" class="material-symbols-outlined text-primary">check_circle</span>
                </button>
                <button v-for="ch in drillParent.children" :key="ch.id" class="tx-cat-row" @click="selectCategory(ch)">
                  <span
                    class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    :class="categoryId === ch.id ? 'bg-primary text-white' : 'bg-surface-alt text-muted'"
                  >
                    <span class="material-symbols-outlined text-lg">{{ ch.icon || drillParent.icon || 'label' }}</span>
                  </span>
                  <span class="flex-1 min-w-0 text-sm truncate">{{ ch.name }}</span>
                  <span v-if="categoryId === ch.id" class="material-symbols-outlined text-primary">check_circle</span>
                </button>
              </div>
            </template>

            <!-- 一级分类宫格 -->
            <div v-else class="grid grid-cols-4 gap-2">
              <button
                v-for="c in topCategories"
                :key="c.id"
                class="relative flex flex-col items-center gap-1.5 pt-3 pb-2.5 rounded-2xl border transition-colors"
                :class="isTopActive(c)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface-alt/50 text-on-surface hover:border-primary/40'"
                @click="chooseCategory(c)"
              >
                <span
                  class="w-10 h-10 rounded-full flex items-center justify-center"
                  :class="isTopActive(c) ? 'bg-primary text-white' : 'bg-surface-alt text-muted'"
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
                暂无分类，请先在「账户 / 分类」中添加
              </div>
            </div>

            <div class="text-[11px] text-muted font-body text-center pt-1">
              {{ categoryId ? '已选：' + selectedCategoryPath : '请选择一个分类' }}
            </div>
          </section>

          <!-- ② 金额 -->
          <section v-else-if="step === 2" key="s2" class="pt-2">
            <button
              class="mx-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-alt border border-border text-xs font-body text-muted max-w-full"
              @click="goStep(1)"
            >
              <span class="material-symbols-outlined text-base">{{ selectedCategoryIcon }}</span>
              <span class="truncate">{{ selectedCategoryPath || '未分类' }}</span>
              <span class="material-symbols-outlined text-sm">edit</span>
            </button>

            <div class="mt-5 flex items-baseline justify-end gap-1.5" :class="type === 'income' ? 'text-primary' : 'text-on-background'">
              <span class="text-lg font-body">{{ currencySymbol }}</span>
              <span class="font-headline text-[46px] leading-none font-semibold tracking-tight tabular-nums">{{ amount || '0' }}</span>
              <span class="tx-caret"></span>
            </div>
            <div class="text-right text-[11px] font-body h-4" :class="type === 'income' ? 'text-primary' : 'text-muted'">
              {{ type === 'income' ? '收入' : '支出' }}<template v-if="currency !== 'CNY' && cnyPreview > 0"> · ≈ ¥{{ (cnyPreview / 100).toFixed(2) }}</template>
            </div>

            <div class="grid grid-cols-3 gap-2 mt-5">
              <button
                v-for="k in keys"
                :key="k"
                class="tx-key"
                @click="press(k)"
              >
                <span v-if="k === 'del'" class="material-symbols-outlined text-xl align-middle">backspace</span>
                <span v-else>{{ k }}</span>
              </button>
            </div>
          </section>

          <!-- ③ 确认与补充 -->
          <section v-else key="s3" class="space-y-3 pt-1">
            <div class="flex items-center gap-3 p-3 rounded-2xl border border-primary/25 bg-primary/5">
              <div class="w-11 h-11 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                <span class="material-symbols-outlined text-xl">{{ selectedCategoryIcon }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">{{ selectedCategoryPath || '未分类' }}</div>
                <div class="text-[11px] text-muted font-body">{{ type === 'income' ? '收入' : '支出' }} · {{ accountName }}</div>
              </div>
              <div class="text-right flex-shrink-0">
                <div class="font-headline text-lg font-semibold tabular-nums" :class="type === 'income' ? 'text-primary' : 'text-on-background'">
                  {{ type === 'income' ? '+' : '-' }}{{ currencySymbol }}{{ amountDisplay }}
                </div>
                <button class="text-[11px] text-primary font-body" @click="goStep(1)">修改</button>
              </div>
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

            <label class="block text-xs text-muted font-body">
              备注
              <input
                v-model="note"
                placeholder="如：午饭 / 地铁 / 工资"
                class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
              />
            </label>

            <div class="flex items-center gap-2 pt-1 text-[11px] text-muted font-body">
              <span class="h-px flex-1 bg-border"></span>
              更多（可选）
              <span class="h-px flex-1 bg-border"></span>
            </div>

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
          </section>
        </Transition>
      </div>

      <!-- 底部操作 -->
      <footer class="px-5 pt-3 pb-5 shrink-0 border-t border-border/60">
        <div v-if="error" class="text-xs text-error font-body mb-2">{{ error }}</div>
        <button
          class="tx-primary"
          :disabled="saving || !canNext"
          @click="step < 3 ? next() : save()"
        >
          <span>{{ step === 1 ? '下一步 · 填金额' : step === 2 ? '下一步 · 补充信息' : saving ? '保存中…' : (transaction ? '保存修改' : '保存这一笔') }}</span>
          <span v-if="!saving" class="material-symbols-outlined text-lg">{{ step < 3 ? 'arrow_forward' : 'check' }}</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import api from '@/api'
import UiSelect from '@/components/ui/UiSelect.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
  transaction: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const steps = [
  { n: 1, label: '分类' },
  { n: 2, label: '金额' },
  { n: 3, label: '确认' },
]
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']

const step = ref(1)
const dir = ref(1)
const drillParent = ref(null)

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
const currencyOptions = currencies.map((c) => ({ label: c, value: c }))
const accountOptions = computed(() =>
  (props.accounts || []).map((a) => ({ label: a.name, value: a.id })))
const accountName = computed(() => {
  const a = props.accounts.find((x) => x.id === accountId.value)
  return a ? a.name : '未选账户'
})

const candidates = ref([])
const recognizing = ref(false)
const recognizeError = ref('')
const fileInput = ref(null)

const transitionName = computed(() => (dir.value > 0 ? 'step-next' : 'step-prev'))

const topCategories = computed(() =>
  props.categories.filter((c) => c.type === type.value))

const flatCategories = computed(() => {
  const out = []
  for (const c of props.categories) {
    if (c.type !== type.value) continue
    out.push(c)
    for (const ch of c.children || []) out.push({ ...ch, parent_id: ch.parent_id || c.id })
  }
  return out
})

const selectedCategory = computed(() =>
  flatCategories.value.find((c) => c.id === categoryId.value) || null)

const selectedCategoryIcon = computed(() => (selectedCategory.value && selectedCategory.value.icon) || 'label')

const selectedCategoryPath = computed(() => {
  const c = selectedCategory.value
  if (!c) return ''
  if (c.parent_id) {
    const p = topCategories.value.find((x) => x.id === c.parent_id)
    if (p) return `${p.name} · ${c.name}`
  }
  return c.name
})

const stepTitle = computed(() => {
  if (step.value === 1) return drillParent.value ? drillParent.value.name : '选择分类'
  if (step.value === 2) return '输入金额'
  return '确认与补充'
})

const hasCategories = computed(() => flatCategories.value.length > 0)
const canNext = computed(() => {
  if (step.value === 1) return !hasCategories.value || categoryId.value > 0
  if (step.value === 2) return Math.round(Number(amount.value || 0) * 100) > 0
  return true
})

const amountDisplay = computed(() => {
  const v = Number(amount.value || 0)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
})

const cnyPreview = computed(() => {
  if (currency.value === 'CNY') return 0
  const rate = Number(fxRate.value)
  if (!(rate > 0)) return 0
  return Math.round(Number(amount.value || 0) * 100 * rate)
})

function pad(n) {
  return String(n).padStart(2, '0')
}

function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function hasChildren(c) {
  return !!(c && c.children && c.children.length)
}

function isTopActive(c) {
  if (categoryId.value === c.id) return true
  return (c.children || []).some((ch) => ch.id === categoryId.value)
}

function defaultCategory(t) {
  const tops = props.categories.filter((c) => c.type === t)
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

function reset() {
  error.value = ''
  candidates.value = []
  recognizeError.value = ''
  drillParent.value = null
  dir.value = 1
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
    step.value = 3
    syncDrill()
    return
  }
  type.value = 'expense'
  amount.value = ''
  const last = Number(localStorage.getItem('hc_fin_last_account') || 0)
  const found = props.accounts.find((a) => a.id === last)
  accountId.value = found ? found.id : (props.accounts[0] || {}).id || 0
  categoryId.value = defaultCategory('expense')
  date.value = todayString()
  note.value = ''
  tags.value = ''
  currency.value = 'CNY'
  fxRate.value = ''
  step.value = 1
}

function setType(t) {
  if (type.value === t) return
  type.value = t
  drillParent.value = null
  categoryId.value = defaultCategory(t)
  error.value = ''
}

function chooseCategory(c) {
  if (hasChildren(c)) {
    drillParent.value = c
    return
  }
  categoryId.value = c.id
}

function selectCategory(c) {
  categoryId.value = c.id
  error.value = ''
}

function goStep(n) {
  if (n >= step.value) return
  error.value = ''
  dir.value = n < step.value ? -1 : 1
  step.value = n
  if (n === 1) syncDrill()
}

function back() {
  error.value = ''
  if (step.value === 1) {
    if (drillParent.value) {
      drillParent.value = null
      return
    }
    close()
    return
  }
  dir.value = -1
  step.value -= 1
  if (step.value === 1) syncDrill()
}

function next() {
  error.value = ''
  if (step.value === 1) {
    if (hasCategories.value && !categoryId.value) {
      error.value = '请选择分类'
      return
    }
    dir.value = 1
    step.value = 2
    return
  }
  if (step.value === 2) {
    if (!(Math.round(Number(amount.value || 0) * 100) > 0)) {
      error.value = '请输入金额'
      return
    }
    dir.value = 1
    step.value = 3
  }
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
  drillParent.value = null
  error.value = ''
  dir.value = 1
  step.value = 3
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
    step.value = 2
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

function onKeydown(e) {
  if (!props.modelValue) return
  if (step.value !== 2 || saving.value) return
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
    next()
    e.preventDefault()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

watch(() => props.modelValue, (v) => {
  if (v) reset()
})
</script>

<style scoped>
.tx-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-muted));
  transition: background-color .15s, color .15s;
}
.tx-icon-btn:hover { background: rgb(var(--c-surface-alt)); color: rgb(var(--c-on-surface)); }

.tx-type-btn {
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

.tx-cat-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: rgb(var(--c-surface));
  transition: background-color .15s;
}
.tx-cat-row:hover { background: rgb(var(--c-surface-alt)); }

.tx-key {
  height: 48px;
  border-radius: 14px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-family: var(--font-headline);
  font-size: 19px;
  font-weight: 500;
  transition: background-color .12s, transform .08s, border-color .12s;
}
.tx-key:hover { border-color: rgb(var(--c-primary) / .4); }
.tx-key:active { background: rgb(var(--c-primary) / .12); transform: scale(.97); }

.tx-primary {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
  font-size: 14px;
  font-family: var(--font-body);
  font-weight: 500;
  box-shadow: 0 8px 22px rgb(var(--c-primary) / .22);
  transition: opacity .15s, transform .08s;
}
.tx-primary:disabled { opacity: .45; box-shadow: none; }
.tx-primary:active:not(:disabled) { transform: scale(.99); }

.tx-caret {
  display: inline-block;
  width: 2px;
  height: 30px;
  margin-left: 1px;
  border-radius: 1px;
  background: rgb(var(--c-primary));
  animation: tx-blink 1.1s steps(1, end) infinite;
}
@keyframes tx-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

/* 步骤切换：横向滑动 + 淡入 */
.step-next-enter-active,
.step-next-leave-active,
.step-prev-enter-active,
.step-prev-leave-active {
  transition: opacity .16s ease, transform .22s cubic-bezier(.22, .61, .36, 1);
}
.step-next-enter-from { opacity: 0; transform: translateX(18px); }
.step-next-leave-to { opacity: 0; transform: translateX(-18px); }
.step-prev-enter-from { opacity: 0; transform: translateX(-18px); }
.step-prev-leave-to { opacity: 0; transform: translateX(18px); }
</style>

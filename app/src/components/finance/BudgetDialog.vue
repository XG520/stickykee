<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[92] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="close"
  >
    <div class="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-headline text-lg font-semibold">{{ month }} 预算</h3>
        <button class="text-muted hover:text-on-surface" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="text-xs text-muted font-body">留空或填 0 表示不设预算；分类预算用于超支提醒。</div>

      <label class="text-xs text-muted font-body block">
        总预算（元）
        <input
          v-model="overall"
          type="number"
          step="0.01"
          min="0"
          placeholder="本月总预算"
          class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
        />
      </label>

      <div class="space-y-2">
        <div class="text-xs font-medium text-muted font-body">分类预算</div>
        <div v-for="c in expenseCategories" :key="c.id" class="flex items-center gap-2">
          <span class="material-symbols-outlined text-base text-muted">{{ c.icon || 'label' }}</span>
          <span class="flex-1 text-sm">{{ c.name }}</span>
          <input
            v-model="perCategory[c.id]"
            type="number"
            step="0.01"
            min="0"
            placeholder="不限"
            class="w-24 px-2 py-1 rounded-md bg-surface-alt border border-border text-sm text-right outline-none focus:border-primary"
          />
          <span class="text-xs text-muted">元</span>
        </div>
        <div v-if="!expenseCategories.length" class="text-xs text-muted">暂无支出分类</div>
      </div>

      <div v-if="error" class="text-xs text-error">{{ error }}</div>

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
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  month: { type: String, default: '' },
  categories: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const overall = ref('')
const perCategory = reactive({})
const saving = ref(false)
const error = ref('')

const expenseCategories = computed(() => props.categories.filter((c) => c.type === 'expense'))

function centsOf(v) {
  return Math.round(Number(v || 0) * 100)
}

function close() {
  emit('update:modelValue', false)
}

async function load() {
  error.value = ''
  overall.value = ''
  for (const k of Object.keys(perCategory)) delete perCategory[k]
  try {
    const res = await api.financeBudgets(props.month)
    for (const b of res.data || []) {
      if (b.category_id === 0) overall.value = (b.amount / 100).toString()
      else perCategory[b.category_id] = (b.amount / 100).toString()
    }
  } catch (e) {
    error.value = e.message || '加载预算失败'
  }
}

async function save() {
  error.value = ''
  const items = []
  if (centsOf(overall.value) > 0) items.push({ category_id: 0, amount: centsOf(overall.value) })
  for (const c of expenseCategories.value) {
    const amount = centsOf(perCategory[c.id])
    if (amount > 0) items.push({ category_id: c.id, amount })
  }
  saving.value = true
  try {
    await api.setFinanceBudgets(props.month, items)
    emit('saved')
    close()
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

watch(() => props.modelValue, (v) => {
  if (v) load()
})
</script>

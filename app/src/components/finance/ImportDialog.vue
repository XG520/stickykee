<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="close"
  >
    <div class="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-headline text-lg font-semibold">导入官方账单</h3>
        <button class="text-muted hover:text-on-surface" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <p class="text-xs text-muted font-body leading-relaxed">
        支持支付宝 / 微信官方账单 CSV。支付宝在「我的 → 账单 → 开具交易流水证明」导出（GBK），
        微信在「我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单」导出（UTF-8）。重复交易会自动跳过。
      </p>

      <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFile" />
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="px-3 py-2 rounded-lg bg-surface-alt border border-border text-xs text-muted font-body"
          @click="pickFile"
        >选择 CSV 文件</button>
        <span class="text-xs font-body text-muted truncate max-w-[240px]">{{ fileName || '未选择文件' }}</span>
        <span v-if="encodingLabel" class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-alt text-muted">
          {{ encodingLabel }}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <select v-model.number="accountId" class="px-2 py-2 rounded-lg bg-surface-alt border border-border text-sm">
          <option :value="0">默认账户</option>
          <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <button
          class="px-3 py-2 rounded-lg border border-border bg-surface-alt text-xs text-muted font-body disabled:opacity-50"
          :disabled="!content || loading"
          @click="run(false)"
        >{{ loading && !commitMode ? '解析中…' : '预览' }}</button>
      </div>

      <div v-if="result" class="space-y-2">
        <div class="grid grid-cols-4 gap-2 text-center">
          <div class="bg-surface-alt rounded-xl py-2">
            <div class="text-[11px] text-muted font-body">共</div>
            <div class="text-sm font-semibold">{{ result.total }}</div>
          </div>
          <div class="bg-surface-alt rounded-xl py-2">
            <div class="text-[11px] text-muted font-body">可导入</div>
            <div class="text-sm font-semibold text-primary">{{ result.importable }}</div>
          </div>
          <div class="bg-surface-alt rounded-xl py-2">
            <div class="text-[11px] text-muted font-body">已存在</div>
            <div class="text-sm font-semibold">{{ result.duplicates }}</div>
          </div>
          <div class="bg-surface-alt rounded-xl py-2">
            <div class="text-[11px] text-muted font-body">跳过</div>
            <div class="text-sm font-semibold">{{ result.skipped }}</div>
          </div>
        </div>

        <div v-if="commitMode && result.imported > 0" class="text-xs text-primary font-body">
          已成功导入 {{ result.imported }} 条账单。
        </div>
        <div v-if="result.errors?.length" class="text-xs text-error font-body">{{ result.errors.join('；') }}</div>

        <div v-if="result.items?.length" class="border border-border rounded-xl divide-y divide-border max-h-60 overflow-y-auto">
          <div
            v-for="(it, i) in result.items"
            :key="i"
            class="px-3 py-2 text-xs font-body flex items-center justify-between gap-2"
          >
            <div class="min-w-0">
              <div class="truncate">{{ it.note || it.counterparty || '未命名' }}</div>
              <div class="text-[10px] text-muted">{{ it.occurred_at }} · {{ it.category_name || '未分类' }}</div>
            </div>
            <div class="text-right flex-shrink-0">
              <div :class="it.type === 'income' ? 'text-primary' : ''">
                {{ it.type === 'income' ? '+' : '-' }}{{ money(it.amount) }}
              </div>
              <div v-if="it.duplicate" class="text-[10px] text-muted">已存在</div>
              <div v-else-if="it.skipped" class="text-[10px] text-muted">{{ it.reason || '跳过' }}</div>
            </div>
          </div>
        </div>

        <button
          v-if="!commitMode || result.imported === 0"
          class="w-full py-2 rounded-xl bg-primary text-white text-sm disabled:opacity-50"
          :disabled="loading || !result.importable"
          @click="run(true)"
        >{{ loading && commitMode ? '导入中…' : `确认导入 ${result.importable} 条` }}</button>
        <button
          v-else
          class="w-full py-2 rounded-xl border border-border text-xs text-muted font-body"
          @click="close"
        >完成</button>
      </div>

      <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import api from '@/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  accounts: { type: Array, default: () => [] },
  defaultAccountId: { type: Number, default: 0 },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const fileInput = ref(null)
const fileName = ref('')
const encodingLabel = ref('')
const content = ref('')
const accountId = ref(0)
const result = ref(null)
const loading = ref(false)
const commitMode = ref(false)
const error = ref('')

const activeAccounts = computed(() => (props.accounts || []).filter((a) => !a.archived))

function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toFixed(2)
}

function close() {
  emit('update:modelValue', false)
}

function reset() {
  fileName.value = ''
  encodingLabel.value = ''
  content.value = ''
  result.value = null
  error.value = ''
  commitMode.value = false
  const first = activeAccounts.value[0]
  accountId.value = props.defaultAccountId || (first ? first.id : 0)
  if (fileInput.value) fileInput.value.value = ''
}

function pickFile() {
  fileInput.value?.click()
}

// 支付宝导出为 GBK，微信为 UTF-8（带 BOM）：先严格按 UTF-8 解码，失败再回退 GBK。
function decodeCsv(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), label: 'UTF-8' }
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(buf), label: 'GBK' }
    } catch {
      return { text: new TextDecoder('utf-8').decode(buf), label: 'UTF-8' }
    }
  }
}

async function onFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  error.value = ''
  result.value = null
  fileName.value = file.name
  try {
    const buf = await file.arrayBuffer()
    const { text, label } = decodeCsv(buf)
    content.value = text
    encodingLabel.value = label
  } catch {
    error.value = '读取文件失败'
  }
}

async function run(commit) {
  if (!content.value || loading.value) return
  loading.value = true
  commitMode.value = commit
  error.value = ''
  try {
    const res = await api.financeImport({
      content: content.value,
      account_id: accountId.value,
      commit,
    })
    result.value = res.data || {}
    if (commit && Number(result.value.imported || 0) > 0) emit('changed')
  } catch (e) {
    error.value = e.message || '导入失败'
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (v) => {
  if (v) reset()
})
</script>

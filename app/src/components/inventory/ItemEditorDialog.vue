<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50"
    @click.self="close"
  >
    <div class="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface border border-border rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-headline text-lg font-semibold text-on-background">
          {{ item ? '编辑物品' : '添加物品' }}
        </h3>
        <button class="text-muted hover:text-on-surface" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="text-xs text-muted font-body sm:col-span-2">
          名称 *
          <input
            v-model="form.name"
            placeholder="如：纯牛奶"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body">
          分类
          <button
            type="button"
            class="mt-1 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-left outline-none focus:border-primary"
            @click="categoryOpen = true"
          >
            <span class="truncate" :class="form.category ? 'text-on-surface' : 'text-muted'">
              {{ form.category || '请选择分类' }}
            </span>
            <span class="material-symbols-outlined text-base text-muted flex-shrink-0">expand_more</span>
          </button>
        </label>
        <label class="text-xs text-muted font-body">
          单位
          <input
            v-model="form.unit"
            placeholder="件 / 盒 / 瓶 / g"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body">
          条码
          <input
            v-model="form.barcode"
            placeholder="可选"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
          <span v-if="barcodeState === 'loading'" class="mt-1 block text-[10px] text-muted leading-relaxed">
            正在识别商品…
          </span>
          <span v-else-if="barcodeState === 'miss'" class="mt-1 block text-[10px] text-muted leading-relaxed">
            商品库未收录该条码，填写名称保存后，下次扫码会直接打开这件物品。
          </span>
          <span v-else-if="barcodeState === 'unavailable'" class="mt-1 block text-[10px] text-muted leading-relaxed">
            商品库暂时不可用，可先手动填写名称。
          </span>
        </label>
        <label class="text-xs text-muted font-body">
          补货点（低于则提醒）
          <input
            v-model.number="form.min_quantity"
            type="number"
            step="0.01"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body">
          开封后保质（天）
          <input
            v-model.number="form.after_open_days"
            type="number"
            min="0"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
        <label class="text-xs text-muted font-body">
          默认保质期（天）
          <input
            v-model.number="form.default_shelf_life_days"
            type="number"
            min="0"
            class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
          />
        </label>
      </div>

      <!-- 首批次：仅新建时出现 -->
      <div v-if="!item" class="border-t border-border pt-3 space-y-3">
        <div class="text-xs font-medium text-muted font-body">首次入库（可选）</div>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs text-muted font-body">
            存放位置
            <UiSelect v-model="batch.location_id" class="mt-1 w-full text-sm" :options="locationOptions" />
          </label>
          <label class="text-xs text-muted font-body">
            数量
            <input
              v-model.number="batch.quantity"
              type="number"
              step="0.01"
              min="0"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
          <label class="text-xs text-muted font-body">
            生产日期
            <input
              v-model="batch.production_date"
              type="date"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
          <label class="text-xs text-muted font-body">
            过期日期
            <input
              v-model="batch.expiry_date"
              type="date"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
        </div>
      </div>

      <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

      <div class="flex justify-end gap-2 pt-1">
        <button
          class="px-4 py-2 rounded-lg text-sm font-body text-muted hover:text-on-surface border border-border"
          @click="close"
        >
          取消
        </button>
        <button
          class="px-4 py-2 rounded-lg text-sm font-body bg-primary text-white disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <CategoryPickerDialog
      v-model="categoryOpen"
      :value="form.category"
      @select="form.category = $event"
    />
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import UiSelect from '@/components/ui/UiSelect.vue'
import CategoryPickerDialog from './CategoryPickerDialog.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  item: { type: Object, default: null },
  locations: { type: Array, default: () => [] },
  initialBarcode: { type: String, default: '' },
  initial: { type: Object, default: null },
  barcodeState: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const emptyForm = () => ({
  name: '',
  category: '',
  unit: '件',
  barcode: '',
  min_quantity: 0,
  after_open_days: 0,
  default_shelf_life_days: 0,
})
const form = reactive(emptyForm())
const batch = reactive({ location_id: 0, quantity: 1, production_date: '', expiry_date: '' })
const saving = ref(false)
const error = ref('')
const categoryOpen = ref(false)

const locationOptions = computed(() => [
  { label: '暂不入库', value: 0 },
  ...(props.locations || []).map((l) => ({ label: l.name, value: l.id })),
])

function reset() {
  Object.assign(form, emptyForm())
  Object.assign(batch, { location_id: 0, quantity: 1, production_date: '', expiry_date: '' })
  error.value = ''
  if (props.item) {
    Object.assign(form, {
      name: props.item.name || '',
      category: props.item.category || '',
      unit: props.item.unit || '件',
      barcode: props.item.barcode || '',
      min_quantity: props.item.min_quantity || 0,
      after_open_days: props.item.after_open_days || 0,
      default_shelf_life_days: props.item.default_shelf_life_days || 0,
    })
  } else if (props.initial) {
    form.name = props.initial.name || ''
    form.category = props.initial.category || ''
    form.unit = props.initial.unit || '件'
    form.barcode = props.initial.barcode || ''
  } else if (props.initialBarcode) {
    form.barcode = props.initialBarcode
  }
}

watch(() => props.modelValue, (v) => {
  if (v) reset()
  else categoryOpen.value = false
})

watch(() => props.item, () => { if (props.modelValue) reset() })
// 扫码识别是异步的：弹窗先打开，商品库结果稍后到达，仅回填用户尚未填写的字段
watch(() => props.initial, (v) => {
  if (!v || !props.modelValue || props.item) return
  if (!form.name.trim() && v.name) form.name = v.name
  if (!form.category && v.category) form.category = v.category
  if (!form.unit && v.unit) form.unit = v.unit
})

function close() {
  emit('update:modelValue', false)
}

async function save() {
  if (!form.name.trim()) {
    error.value = '请填写物品名称'
    return
  }
  saving.value = true
  error.value = ''
  const payload = {
    name: form.name.trim(),
    barcode: form.barcode.trim(),
    category: form.category,
    unit: form.unit || '件',
    min_quantity: Number(form.min_quantity) || 0,
    after_open_days: Number(form.after_open_days) || 0,
    default_shelf_life_days: Number(form.default_shelf_life_days) || 0,
  }
  if (!props.item) {
    payload.first_batch = {
      location_id: Number(batch.location_id) || 0,
      quantity: Number(batch.quantity) || 0,
      production_date: batch.production_date,
      expiry_date: batch.expiry_date,
    }
  }
  try {
    if (props.item) {
      await api.updateInventoryItem(props.item.id, payload)
    } else {
      await api.createInventoryItem(payload)
    }
    emit('saved')
    close()
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

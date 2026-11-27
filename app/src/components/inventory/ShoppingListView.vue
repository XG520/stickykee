<template>
  <div class="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-5 lg:items-start">
    <!-- 添加表单：桌面端为右侧常驻卡片，移动端保持顶部输入区 -->
    <div class="space-y-2 lg:order-2 lg:col-span-4 lg:sticky lg:top-20 lg:rounded-3xl lg:bg-surface lg:border lg:border-border lg:p-4">
      <div class="hidden lg:block text-sm font-medium font-body pb-1">添加购物项</div>
      <input
        v-model="name"
        placeholder="添加到购物清单…"
        class="w-full px-3 py-2.5 rounded-xl bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary transition-colors"
        @keyup.enter="add"
      />
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-muted font-body whitespace-nowrap">数量</label>
        <input
          v-model.number="qty"
          type="number"
          min="1"
          step="1"
          class="w-16 px-2 py-2 rounded-xl bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
        />
        <button class="px-4 py-2 lg:h-10 rounded-xl bg-primary text-white text-sm font-body" @click="add">添加</button>
        <label class="text-xs text-muted font-body flex items-center gap-1.5 ml-auto whitespace-nowrap lg:ml-0 lg:w-full">
          <input v-model="showDone" type="checkbox" @change="load" />
          显示已完成
        </label>
      </div>
    </div>

    <!-- 清单：桌面端为左侧宽列表 -->
    <div class="lg:order-1 lg:col-span-8 space-y-2">
      <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

      <div v-if="items.length" class="space-y-2">
        <div
          v-for="it in items"
          :key="it.id"
          class="flex items-center gap-3 bg-surface border border-border rounded-xl px-3 py-2 lg:px-4 lg:py-3 hover:bg-surface-alt/50 transition-colors"
        >
          <label class="shrink-0 flex items-center justify-center cursor-pointer lg:w-9 lg:h-9 lg:rounded-full lg:hover:bg-surface-alt lg:transition-colors">
            <input type="checkbox" class="w-4 h-4" style="accent-color: rgb(var(--c-primary))" :checked="it.done" @change="toggle(it)" />
          </label>
          <div class="flex-1 min-w-0">
            <span class="text-sm font-body break-words" :class="it.done ? 'line-through text-muted' : 'text-on-background'">{{ it.name }}</span>
            <span class="text-xs text-muted font-body ml-2 whitespace-nowrap">{{ fmt(it.quantity) }} {{ it.unit }}</span>
            <span v-if="it.note" class="text-xs text-muted font-body ml-2 break-words">· {{ it.note }}</span>
          </div>
          <button v-if="!it.done" class="text-muted hover:text-primary lg:w-9 lg:h-9 lg:rounded-full lg:flex lg:items-center lg:justify-center lg:hover:bg-surface-alt lg:transition-colors" title="入库" @click="openPurchase(it)">
            <span class="material-symbols-outlined text-base">inventory_2</span>
          </button>
          <button class="text-muted hover:text-error lg:w-9 lg:h-9 lg:rounded-full lg:flex lg:items-center lg:justify-center lg:hover:bg-error/10 lg:transition-colors" @click="remove(it)">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </div>
      <div v-else class="text-center py-16 text-sm text-muted font-body">
        {{ loading ? '加载中…' : '清单是空的，缺什么就加什么' }}
      </div>
    </div>

    <!-- 入库 -->
    <div
      v-if="purchaseItem"
      class="fixed inset-0 z-[92] flex items-center justify-center p-4 bg-black/50"
      @click.self="purchaseItem = null"
    >
      <div class="w-full max-w-md bg-surface border border-border rounded-2xl p-5 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-headline text-lg font-semibold">入库：{{ purchaseItem.name }}</h3>
          <button class="text-muted hover:text-on-surface" @click="purchaseItem = null">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-xs text-muted font-body col-span-2">
            存放位置
            <select
              v-model.number="purchaseForm.location_id"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            >
              <option :value="0">请选择位置</option>
              <option v-for="l in locations" :key="l.id" :value="l.id">{{ l.name }}</option>
            </select>
          </label>
          <label class="text-xs text-muted font-body">
            数量（{{ purchaseItem.unit }}）
            <input
              v-model.number="purchaseForm.quantity"
              type="number"
              step="0.01"
              min="0"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
          </label>
          <label class="text-xs text-muted font-body">
            单价（元）
            <input
              v-model="purchaseForm.entry_price"
              type="number"
              step="0.01"
              min="0"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
          </label>
          <label class="text-xs text-muted font-body col-span-2">
            过期日期（可选）
            <input
              v-model="purchaseForm.expiry_date"
              type="date"
              class="mt-1 w-full px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            />
          </label>
        </div>
        <div class="text-[11px] text-muted font-body">填写单价后会自动记一笔采购支出。</div>
        <div v-if="purchaseError" class="text-xs text-error">{{ purchaseError }}</div>
        <div class="flex justify-end gap-2">
          <button class="px-4 py-2 rounded-lg text-sm text-muted border border-border" @click="purchaseItem = null">取消</button>
          <button
            class="px-4 py-2 rounded-lg text-sm bg-primary text-white disabled:opacity-50"
            :disabled="purchasing"
            @click="submitPurchase"
          >{{ purchasing ? '入库中…' : '确认入库' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import api from '@/api'

const emit = defineEmits(['changed'])

const items = ref([])
const name = ref('')
const qty = ref(1)
const showDone = ref(false)
const loading = ref(false)
const error = ref('')

const purchaseItem = ref(null)
const locations = ref([])
const purchasing = ref(false)
const purchaseError = ref('')
const purchaseForm = reactive({ location_id: 0, quantity: 1, entry_price: '', expiry_date: '' })

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.inventoryShopping(showDone.value)
    items.value = res.data || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function add() {
  if (!name.value.trim()) return
  try {
    await api.addInventoryShopping({
      name: name.value.trim(),
      quantity: Number(qty.value) || 1,
      unit: '件',
    })
    name.value = ''
    qty.value = 1
    await load()
    emit('changed')
  } catch (e) {
    error.value = e.message || '添加失败'
  }
}

async function toggle(it) {
  try {
    await api.checkInventoryShopping(it.id, !it.done)
    await load()
    emit('changed')
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

async function remove(it) {
  try {
    await api.deleteInventoryShopping(it.id)
    await load()
    emit('changed')
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function openPurchase(it) {
  purchaseError.value = ''
  purchaseItem.value = it
  purchaseForm.quantity = Number(it.quantity) || 1
  purchaseForm.entry_price = ''
  purchaseForm.expiry_date = ''
  try {
    const res = await api.inventoryLocations()
    locations.value = res.data || []
    purchaseForm.location_id = locations.value.length ? locations.value[0].id : 0
  } catch (e) {
    purchaseError.value = e.message || '加载位置失败'
  }
}

async function submitPurchase() {
  purchaseError.value = ''
  if (!purchaseForm.location_id) {
    purchaseError.value = '请选择存放位置'
    return
  }
  purchasing.value = true
  try {
    await api.purchaseShoppingItem(purchaseItem.value.id, {
      location_id: purchaseForm.location_id,
      quantity: Number(purchaseForm.quantity) || 1,
      entry_price: Number(purchaseForm.entry_price) || 0,
      expiry_date: purchaseForm.expiry_date || '',
    })
    purchaseItem.value = null
    await load()
    emit('changed')
  } catch (e) {
    purchaseError.value = e.message || '入库失败'
  } finally {
    purchasing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 flex-wrap">
      <input
        v-model="name"
        placeholder="添加到购物清单…"
        class="flex-1 min-w-40 px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
        @keyup.enter="add"
      />
      <input
        v-model.number="qty"
        type="number"
        min="1"
        step="1"
        class="w-16 px-2 py-2 rounded-lg bg-surface-alt border border-border text-sm text-on-surface outline-none focus:border-primary"
      />
      <button class="px-3 py-2 rounded-lg bg-primary text-white text-sm font-body" @click="add">添加</button>
      <label class="text-xs text-muted font-body flex items-center gap-1.5 ml-auto">
        <input v-model="showDone" type="checkbox" @change="load" />
        显示已完成
      </label>
    </div>

    <div v-if="error" class="text-xs text-error font-body">{{ error }}</div>

    <div v-if="items.length" class="space-y-2">
      <div
        v-for="it in items"
        :key="it.id"
        class="flex items-center gap-3 bg-surface border border-border rounded-xl px-3 py-2"
      >
        <input type="checkbox" :checked="it.done" @change="toggle(it)" />
        <div class="flex-1 min-w-0">
          <span class="text-sm font-body" :class="it.done ? 'line-through text-muted' : 'text-on-background'">{{ it.name }}</span>
          <span class="text-xs text-muted font-body ml-2">{{ fmt(it.quantity) }} {{ it.unit }}</span>
          <span v-if="it.note" class="text-xs text-muted font-body ml-2">· {{ it.note }}</span>
        </div>
        <button class="text-muted hover:text-error" @click="remove(it)">
          <span class="material-symbols-outlined text-base">delete</span>
        </button>
      </div>
    </div>
    <div v-else class="text-center py-16 text-sm text-muted font-body">
      {{ loading ? '加载中…' : '清单是空的，缺什么就加什么' }}
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '@/api'

const emit = defineEmits(['changed'])

const items = ref([])
const name = ref('')
const qty = ref(1)
const showDone = ref(false)
const loading = ref(false)
const error = ref('')

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

onMounted(load)
</script>

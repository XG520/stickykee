<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
    @click.self="close"
  >
    <div class="w-full max-w-md max-h-[85vh] overflow-y-auto bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-headline text-base font-semibold">选择分类</h3>
        <button class="text-muted hover:text-on-surface" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <button
        class="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-body"
        :class="!value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface-alt text-muted'"
        @click="pick('')"
      >
        <span>不分类</span>
        <span v-if="!value" class="material-symbols-outlined text-base">check</span>
      </button>

      <div v-for="g in tree" :key="g.name" class="space-y-1.5">
        <div class="flex items-center gap-1.5 text-xs text-muted font-body">
          <span class="material-symbols-outlined text-base">{{ g.icon }}</span>
          {{ g.name }}
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="c in g.children"
            :key="c"
            class="px-2 py-2 rounded-lg border text-xs font-body truncate"
            :class="value === c ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface-alt text-on-background'"
            @click="pick(c)"
          >{{ c }}</button>
        </div>
      </div>

      <div class="border-t border-border pt-3 space-y-2">
        <div class="text-xs text-muted font-body">自定义分类</div>
        <div class="flex items-center gap-2">
          <input
            v-model="custom"
            placeholder="输入分类名称"
            class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface-alt border border-border text-sm outline-none focus:border-primary"
            @keyup.enter="useCustom"
          />
          <button
            class="px-3 py-2 rounded-lg text-sm bg-primary text-white disabled:opacity-50"
            :disabled="!custom.trim()"
            @click="useCustom"
          >使用</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { INVENTORY_CATEGORY_TREE, isPresetInventoryCategory } from '@/utils/inventoryCategories'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  value: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'select'])

const tree = INVENTORY_CATEGORY_TREE
const custom = ref('')

watch(() => props.modelValue, (v) => {
  if (!v) return
  // 编辑旧数据时，非预设值填入自定义输入框，方便直接沿用或修改。
  custom.value = props.value && !isPresetInventoryCategory(props.value) ? props.value : ''
})

function close() {
  emit('update:modelValue', false)
}

function pick(name) {
  emit('select', name)
  close()
}

function useCustom() {
  const name = custom.value.trim()
  if (!name) return
  pick(name)
}
</script>

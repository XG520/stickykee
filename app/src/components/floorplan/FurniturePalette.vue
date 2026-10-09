<!-- 编辑态家具面板（桌面侧栏）：家具目录按分类 tab 展示，拖到画布放置或点击放置到画布中央。
     家具是与智能设备区分的普通家具（沙发/床/桌椅等），走 floor.furniture 独立数据。 -->
<template>
  <div class="flex flex-col min-h-0 h-full">
    <div class="flex items-center gap-2 px-1 pb-2">
      <span class="material-symbols-outlined text-primary text-base" aria-hidden="true">chair</span>
      <p class="text-xs font-body text-muted">选择家具拖到画布放置</p>
    </div>

    <!-- 分类 tab -->
    <div class="flex gap-1 flex-wrap pb-2" role="tablist" aria-label="家具分类">
      <button
        v-for="c in categories" :key="c.key"
        class="flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="cat === c.key ? 'border-primary/60 text-primary bg-primary/10' : 'border-border text-muted hover:text-on-surface'"
        role="tab" :aria-selected="cat === c.key" @click="cat = c.key"
      >
        <span class="material-symbols-outlined text-sm" aria-hidden="true">{{ c.icon }}</span>
        {{ c.name }}
      </button>
    </div>

    <!-- 目录格 -->
    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1">
      <p v-if="!list.length" class="text-xs font-body text-muted px-1 py-4">该分类暂无家具</p>
      <div class="grid grid-cols-2 gap-1.5">
        <div
          v-for="it in list" :key="it.id"
          class="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface-alt/70 px-2 py-2 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors touch-none select-none"
          :title="it.name + '（拖到画布，或点击放置到中央）'"
          role="button" tabindex="0"
          @pointerdown.prevent="onDragStart(it, $event)"
          @click="$emit('add', it)"
          @keydown.enter.prevent="$emit('add', it)"
        >
          <span class="material-symbols-outlined text-xl text-primary" aria-hidden="true">{{ it.icon }}</span>
          <span class="text-[11px] font-body text-on-surface truncate">{{ it.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { FURNITURE_CATEGORIES, FURNITURE_CATALOG } from '@/utils/floorplanDoc'

const emit = defineEmits(['drag-start', 'add'])
const categories = FURNITURE_CATEGORIES
const cat = ref(FURNITURE_CATEGORIES[0]?.key || 'living')
const list = computed(() => FURNITURE_CATALOG.filter((f) => f.category === cat.value))

function onDragStart(item, e) {
  // 仅鼠标（编辑模式只在桌面启用，触屏不触发）
  if (e.pointerType && e.pointerType !== 'mouse') return
  emit('drag-start', { item, x: e.clientX, y: e.clientY })
}
</script>
<!-- 编辑态设备面板（桌面侧栏）：设备注册表按区域分组，按住设备拖到画布放置。
     拖放由父级统一处理：本组件 pointerdown 时 emit drag-start（携带客户端坐标），
     父级渲染跟随指针的幽灵元素，pointerup 落在画布内则写入文档。 -->
<template>
  <div class="flex flex-col min-h-0 h-full">
    <div class="flex items-center gap-2 px-1 pb-2">
      <span class="material-symbols-outlined text-primary text-base" aria-hidden="true">drag_indicator</span>
      <p class="text-xs font-body text-muted">按住设备拖到画布放置</p>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3 pr-1">
      <div v-if="!groups.length" class="text-xs font-body text-muted px-1 py-4">
        暂无可放置的设备（需先接入 Home Assistant 实例）
      </div>
      <div v-for="g in groups" :key="g.name">
        <div class="flex items-center gap-2 mb-1.5">
          <div class="w-1 h-4 rounded-full bg-primary/70"></div>
          <h3 class="text-xs font-body font-semibold text-on-surface truncate">{{ g.name }}</h3>
          <span class="ml-auto text-[10px] font-body text-muted">{{ g.list.length }}</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <div
            v-for="d in g.list" :key="keyOf(d)"
            class="flex items-center gap-1.5 rounded-lg border border-border bg-surface-alt/70 px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors touch-none select-none"
            :title="d.display_name + '（拖到画布，或点击放置到中央）'"
            role="button" tabindex="0"
            @pointerdown.prevent="onDragStart(d, $event)"
            @click="$emit('add', d)"
            @keydown.enter.prevent="$emit('add', d)"
          >
            <span class="material-symbols-outlined text-base text-primary shrink-0" aria-hidden="true">{{ glyphOf(d) }}</span>
            <span class="text-[11px] font-body text-on-surface truncate">{{ d.display_name }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { registryDevices } from '@/store'
import { iconFor, domainGlyph } from '@/utils/entities'

const emit = defineEmits(['drag-start', 'add'])

// 按区域分组（未分配区域归「未分配」）
const groups = computed(() => {
  const map = new Map()
  for (const d of registryDevices.value) {
    const name = (d.area_name || '').trim() || '未分配'
    if (!map.has(name)) map.set(name, [])
    map.get(name).push(d)
  }
  return [...map.entries()].map(([name, list]) => ({ name, list }))
})

function keyOf(d) { return d.device?.id || d.display_name }
function glyphOf(d) { return iconFor({ icon: d.main_icon }, domainGlyph[d.domain] || 'widgets') }

function onDragStart(d, e) {
  // 仅鼠标（编辑模式只在桌面启用，触屏不触发）
  if (e.pointerType && e.pointerType !== 'mouse') return
  emit('drag-start', { device: d, x: e.clientX, y: e.clientY })
}
</script>

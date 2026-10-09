<template>
  <!-- 紧凑单行设备条目（参考设备页实体行样式）：图标 + 名称 + 状态值 + 开关，
       不再显示状态行/滑条等占高的内容，避免右侧面板被拉得很长 -->
  <div class="flex items-center gap-3 rounded-xl border bg-surface-alt/60 px-3 py-2 mb-1.5 transition-colors hover:border-primary/40"
    :class="device.on ? 'border-primary/30' : 'border-border'">
    <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" :class="device.bg">
      <span class="material-symbols-outlined text-base" :class="device.color" aria-hidden="true">{{ device.icon }}</span>
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-on-surface text-sm font-body font-medium truncate">{{ device.name }}</p>
      <p class="text-[11px] text-muted font-body truncate">
        <template v-if="device.altText">{{ device.on ? device.altText : '关闭' }}</template>
        <template v-else-if="device.unit">{{ device.on ? `${device.value}${device.unit}` : `关闭` }}</template>
        <template v-else>{{ device.on ? '开启' : '关闭' }}</template>
      </p>
    </div>
    <button
      class="relative w-10 h-6 rounded-full shrink-0 cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      :class="device.on ? 'bg-primary' : 'bg-faint'"
      role="switch"
      :aria-checked="device.on"
      :aria-label="`${device.name} 开关`"
      @click="toggle"
    >
      <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-on-primary shadow transition-transform duration-200" :class="device.on ? 'translate-x-4' : ''"></span>
    </button>
  </div>
</template>

<script setup>
const props = defineProps({ device: Object })
const emit = defineEmits(['update:modelValue'])

function toggle() {
  emit('update:modelValue', !props.device.on)
}
</script>

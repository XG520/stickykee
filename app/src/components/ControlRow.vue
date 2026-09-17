<template>
  <div class="bg-surface-alt rounded-xl border p-4 mb-3 hover:border-border/80 transition-colors" :class="device.on ? 'border-border' : 'border-border'">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-full flex items-center justify-center" :class="device.bg">
        <span class="material-symbols-outlined text-xl" :class="device.color">{{ device.icon }}</span>
      </div>
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <span class="text-on-surface text-sm font-medium font-body">{{ device.name }}</span>
          <button
            class="relative w-10 h-6 rounded-full shrink-0 cursor-pointer transition-colors duration-200"
            :class="device.on ? 'bg-primary' : 'bg-faint'"
            @click="toggle"
          >
            <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-on-primary shadow transition-transform duration-200" :class="device.on ? 'translate-x-4' : ''"></span>
          </button>
        </div>
        <div v-if="device.stat" class="flex items-center justify-between mt-2">
          <span class="text-muted text-xs font-body">状态</span>
          <span text-xs font-body class="text-success font-medium bg-success/10 px-2 py-0.5 rounded-full border border-success/20">{{ device.stat }}</span>
        </div>
        <div v-else class="flex items-center justify-between mt-2">
          <span class="text-muted text-xs font-body">数值 <span class="font-medium" :class="device.color" v-if="!device.altText"> {{ device.on ? device.value : 0 }}{{ device.unit }}</span></span>
          <span class="text-muted text-xs font-body" v-if="device.altText">{{ device.on ? device.altText : '关闭' }}</span>
        </div>
        <input
          v-if="device.slider !== false && device.unit"
          type="range" min="0" max="100" :value="device.on ? device.value : 0"
          class="w-full mt-2 h-1 rounded-full bg-faint accent-primary cursor-pointer"
        >
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({ device: Object })
const emit = defineEmits(['update:modelValue'])

function toggle() {
  emit('update:modelValue', !props.device.on)
}
</script>
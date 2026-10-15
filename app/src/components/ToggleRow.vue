<template>
  <div class="flex items-center justify-between py-3 px-3 rounded-xl hover:bg-surface transition-colors" :class="{ 'opacity-55': disabled }">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg flex items-center justify-center" :class="color">
        <span class="material-symbols-outlined text-lg">{{ icon }}</span>
      </div>
      <div>
        <p class="text-on-surface text-sm font-medium">{{ title }}</p>
        <p class="text-muted text-xs">{{ desc }}</p>
      </div>
    </div>
    <button
      class="relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200"
      :class="[modelValue ? 'bg-primary' : 'bg-faint', disabled ? 'cursor-not-allowed' : 'cursor-pointer']"
      :disabled="disabled"
      @click="!disabled && $emit('update:modelValue', !modelValue)"
    >
      <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-on-primary shadow transition-transform duration-200" :class="modelValue ? 'translate-x-4' : ''"></span>
    </button>
  </div>
</template>

<script setup>
defineProps({
  modelValue: Boolean,
  icon: String,
  title: String,
  desc: String,
  color: String,
  disabled: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])
</script>

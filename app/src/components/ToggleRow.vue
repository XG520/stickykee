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
      class="relative w-[42px] h-[25px] rounded-full shrink-0 transition-colors duration-200 before:absolute before:-inset-2.5 before:content-['']"
      :class="[modelValue ? 'bg-primary' : 'bg-faint', disabled ? 'cursor-not-allowed' : 'cursor-pointer']"
      :disabled="disabled"
      role="switch"
      :aria-checked="modelValue"
      @click="!disabled && $emit('update:modelValue', !modelValue)"
    >
      <span class="absolute top-[3px] left-[3px] w-[19px] h-[19px] rounded-full bg-[#e9e6df] shadow transition-transform duration-200"
        :class="modelValue ? 'translate-x-[17px] !bg-on-primary' : ''"></span>
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

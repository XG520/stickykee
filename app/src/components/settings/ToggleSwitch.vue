<template>
  <button
    type="button"
    role="switch"
    class="hc-switch"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click.stop="$emit('update:modelValue', !modelValue)"
  >
    <span class="hc-switch-thumb"></span>
  </button>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])
</script>

<style scoped>
.hc-switch {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 25px;
  border-radius: 999px;
  background: rgb(var(--c-border));
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
/* 触控热区补足到 44px 高，视觉尺寸不变 */
.hc-switch::before {
  content: '';
  position: absolute;
  inset: -10px -2px;
}
.hc-switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.hc-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: #e9e6df;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.28);
  transition: transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1), background 180ms ease;
}
.hc-switch.on {
  background: rgb(var(--c-primary));
}
.hc-switch.on .hc-switch-thumb {
  transform: translateX(17px);
  background: rgb(var(--c-on-primary));
}
</style>

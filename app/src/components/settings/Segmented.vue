<template>
  <div class="hc-seg" role="tablist">
    <button
      v-for="o in options"
      :key="o.key"
      type="button"
      role="tab"
      class="hc-seg-btn"
      :class="{ on: o.key === modelValue }"
      :aria-selected="o.key === modelValue"
      @click="$emit('update:modelValue', o.key)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, default: () => [] },
})
defineEmits(['update:modelValue'])
</script>

<style scoped>
.hc-seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 12px;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
}
.hc-seg-btn {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  padding: 6px 8px;
  border-radius: 9px;
  font-family: var(--font-body, inherit);
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  text-align: center;
  transition: color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}
.hc-seg-btn:active {
  transform: scale(0.97);
}
.hc-seg-btn.on {
  color: rgb(var(--c-on-primary));
  background: rgb(var(--c-primary));
  box-shadow: 0 2px 8px rgb(var(--c-primary) / 0.22);
}
</style>

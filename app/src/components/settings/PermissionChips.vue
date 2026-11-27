<template>
  <div class="hc-perm" :class="{ disabled }">
    <button
      type="button"
      class="hc-perm-chip"
      :class="{ on: view }"
      :disabled="disabled"
      @click="$emit('change', 'view')"
    >查看</button>
    <button
      type="button"
      class="hc-perm-chip"
      :class="{ on: operate }"
      :disabled="disabled"
      @click="$emit('change', 'operate')"
    >操作</button>
  </div>
</template>

<script setup>
defineProps({
  view: { type: Boolean, default: false },
  operate: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
defineEmits(['change'])
</script>

<style scoped>
.hc-perm {
  display: inline-flex;
  border: 1px solid rgb(var(--c-border));
  border-radius: 9px;
  overflow: hidden;
  background: rgb(var(--c-background));
}
.hc-perm.disabled {
  opacity: 0.45;
}
.hc-perm-chip {
  min-height: 30px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  background: transparent;
  transition: color 140ms ease, background 140ms ease;
}
.hc-perm-chip + .hc-perm-chip {
  border-left: 1px solid rgb(var(--c-border));
}
.hc-perm-chip:not(:disabled):active {
  transform: scale(0.97);
}
.hc-perm-chip.on {
  color: rgb(var(--c-on-primary));
  background: rgb(var(--c-primary));
}
</style>

<template>
  <div
    class="hc-row"
    :class="{ tappable, disabled }"
    @click="onClick"
  >
    <div v-if="icon" class="hc-row-icon">
      <span class="material-symbols-outlined">{{ icon }}</span>
    </div>
    <div class="hc-row-main">
      <div class="hc-row-label">{{ title }}</div>
      <div v-if="desc" class="hc-row-desc">{{ desc }}</div>
    </div>
    <span v-if="value" class="hc-row-val" :title="value">{{ value }}</span>
    <slot />
    <span v-if="chevron" class="material-symbols-outlined hc-row-chev">chevron_right</span>
  </div>
</template>

<script setup>
const props = defineProps({
  icon: { type: String, default: '' },
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  value: { type: String, default: '' },
  chevron: { type: Boolean, default: false },
  clickable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['click'])
function onClick(e) {
  if (props.disabled) return
  emit('click', e)
}
</script>

<style scoped>
.hc-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 2px;
  cursor: default;
}
.hc-row + .hc-row {
  border-top: 1px solid rgb(var(--c-border) / 0.45);
}
.hc-row.tappable {
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.hc-row.tappable:active {
  transform: scale(0.985);
  background: rgb(var(--c-surface-alt) / 0.6);
}
.hc-row.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.hc-row-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-primary));
}
.hc-row-icon .material-symbols-outlined {
  font-size: 16px;
  line-height: 1;
}
.hc-row-main {
  flex: 1;
  min-width: 0;
}
.hc-row-label {
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--c-on-surface));
  line-height: 1.3;
}
.hc-row-desc {
  font-size: 11.5px;
  color: rgb(var(--c-faint));
  line-height: 1.4;
  margin-top: 1px;
}
.hc-row-val {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  color: rgb(var(--c-muted));
  font-variant-numeric: tabular-nums;
}
.hc-row-chev {
  font-size: 16px;
  color: rgb(var(--c-faint));
  flex: 0 0 auto;
}
</style>

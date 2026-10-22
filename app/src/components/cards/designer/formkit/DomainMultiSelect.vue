<template>
  <div class="fk-dms">
    <div class="fk-dms-chips">
      <button
        v-for="d in DOMAINS"
        :key="d"
        type="button"
        class="fk-dms-chip"
        :class="{ 'is-on': selected.includes(d) }"
        @click="toggle(d)"
      >
        <span v-if="selected.includes(d)" class="material-symbols-outlined">check</span>
        <span>{{ d }}</span>
      </button>
    </div>
    <div v-if="selected.length === 0" class="fk-dms-hint">点击选择实体域（多选）</div>
  </div>
</template>

<script setup>
const DOMAINS = [
  'light', 'switch', 'binary_sensor', 'sensor', 'climate', 'cover', 'fan',
  'media_player', 'lock', 'camera', 'vacuum', 'person', 'device_tracker',
  'script', 'automation', 'scene', 'input_button', 'input_select', 'number',
  'select', 'text', 'counter', 'timer', 'calendar', 'update', 'group',
]

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const selected = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])

function toggle(d) {
  const cur = new Set(selected.value)
  if (cur.has(d)) cur.delete(d)
  else cur.add(d)
  emit('update:modelValue', Array.from(cur))
}
</script>

<style scoped>
.fk-dms {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fk-dms-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fk-dms-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 500;
  font-family: monospace;
  border-radius: 4px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-muted));
  cursor: pointer;
  transition: all .15s;
  line-height: 1.3;
}
.fk-dms-chip:hover {
  border-color: var(--hc-color, var(--hc-primary));
  color: rgb(var(--c-on-surface));
}
.fk-dms-chip .material-symbols-outlined {
  font-size: 12px;
  width: 12px;
  height: 12px;
}
.fk-dms-chip.is-on {
  background: var(--hc-color, var(--hc-primary));
  border-color: var(--hc-color, var(--hc-primary));
  color: #000;
  font-weight: 700;
}
.fk-dms-chip.is-on .material-symbols-outlined {
  color: #000;
}
.fk-dms-hint {
  font-size: 10px;
  color: rgb(var(--c-muted));
  font-style: italic;
}
</style>

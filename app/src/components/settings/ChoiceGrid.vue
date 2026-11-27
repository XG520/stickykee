<template>
  <div class="hc-choice" :style="{ '--hc-choice-cols': cols }">
    <button
      v-for="it in items"
      :key="it.key"
      type="button"
      class="hc-choice-item"
      :class="{ on: it.key === modelValue }"
      :title="it.desc || it.name"
      @click="$emit('update:modelValue', it.key)"
    >
      <span class="hc-choice-bar" :style="barStyle(it)"></span>
      <span class="hc-choice-name">{{ it.name }}</span>
    </button>
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: [String, Number], required: true },
  items: { type: Array, default: () => [] },
  cols: { type: Number, default: 4 },
})
defineEmits(['update:modelValue'])

// 色卡底色：优先用主题 swatches（[主色, 点缀色, 底色]）拼渐变，缺省回落到 surface-alt
function barStyle(it) {
  const s = Array.isArray(it.swatches) ? it.swatches : []
  if (!s.length) return { background: 'rgb(var(--c-surface-alt))' }
  if (s.length === 1) return { background: s[0] }
  return { background: `linear-gradient(140deg, ${s[0]}, ${s[1] || s[0]} 58%, ${s[2] || s[0]})` }
}
</script>

<style scoped>
.hc-choice {
  display: grid;
  grid-template-columns: repeat(var(--hc-choice-cols, 4), minmax(0, 1fr));
  gap: 7px;
}
.hc-choice-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 5px;
  border-radius: 10px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface-alt));
  text-align: center;
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 120ms ease;
}
.hc-choice-item:active {
  transform: scale(0.97);
}
.hc-choice-item.on {
  border-color: rgb(var(--c-primary));
  box-shadow: 0 0 0 1px rgb(var(--c-primary) / 0.5);
}
.hc-choice-bar {
  display: block;
  height: 34px;
  border-radius: 7px;
  overflow: hidden;
  position: relative;
}
.hc-choice-bar::after {
  content: '';
  position: absolute;
  left: 5px;
  right: 5px;
  bottom: 5px;
  height: 7px;
  border-radius: 3px;
  background: rgb(255 255 255 / 0.18);
}
.hc-choice-name {
  font-size: 10px;
  color: rgb(var(--c-muted));
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hc-choice-item.on .hc-choice-name {
  color: rgb(var(--c-primary));
  font-weight: 600;
}
</style>

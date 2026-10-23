<template>
  <!-- Canva 风左侧窄 rail：图标竖排，点击展开/收起对应 flyout -->
  <nav class="hc-rail">
    <button
      v-for="it in ITEMS"
      :key="it.key"
      class="hc-rail-item"
      :class="{ 'is-on': active === it.key }"
      @click="$emit('select', it.key)"
    >
      <span class="material-symbols-outlined">{{ it.icon }}</span>
      <span class="hc-rail-lb">{{ it.label }}</span>
    </button>
  </nav>
</template>

<script setup>
defineProps({ active: { type: String, default: '' } })
defineEmits(['select'])

const ITEMS = [
  { key: 'template', label: '模板', icon: 'dashboard_customize' },
  { key: 'ai', label: 'AI', icon: 'auto_awesome' },
  { key: 'assets', label: '素材', icon: 'shapes' },
  { key: 'text', label: '文字', icon: 'text_fields' },
  { key: 'entity', label: '实体', icon: 'monitor_heart' },
  { key: 'code', label: '代码', icon: 'code' },
]
</script>

<style scoped>
.hc-rail {
  width: 54px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 5px;
  background: rgb(var(--c-surface));
  border-right: 1px solid rgb(var(--c-border));
  overflow-y: auto;
}
.hc-rail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 2px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--c-muted));
  cursor: pointer;
  transition: color .15s, background .15s;
}
.hc-rail-item .material-symbols-outlined { font-size: 20px; }
.hc-rail-lb { font-size: 9px; }
.hc-rail-item:hover { color: rgb(var(--c-on-surface)); background: rgb(var(--c-surface-alt)); }
.hc-rail-item.is-on {
  color: var(--hc-color, var(--hc-primary));
  background: color-mix(in srgb, var(--hc-primary) 12%, transparent);
}
</style>

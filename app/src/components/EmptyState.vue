<template>
  <!-- 空状态占位：图标 + 标题 + 描述 + 可选 CTA 按钮。用于设备/场景/仪表盘等无数据场景 -->
  <div class="flex flex-col items-center justify-center text-center px-6"
    :class="compact ? 'py-6' : 'py-12'">
    <div class="flex items-center justify-center mb-2 rounded-lg"
      :class="[compact ? 'w-10 h-10' : 'w-14 h-14 mb-3', tone === 'error' ? 'bg-error/10' : 'bg-surface-alt border border-border']">
      <span class="material-symbols-outlined" :class="[compact ? 'text-xl' : 'text-2xl', tone === 'error' ? 'text-error' : 'text-faint']">{{ icon }}</span>
    </div>
    <h3 class="font-headline font-semibold text-sm text-on-surface mb-0.5">{{ title }}</h3>
    <p v-if="desc" class="text-muted text-xs font-body max-w-xs leading-relaxed">{{ desc }}</p>
    <button v-if="ctaLabel"
      class="mt-3 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-surface-alt border border-border hover:border-primary/40 text-sm text-on-surface transition-all active:scale-95"
      @click="$emit('cta')">
      <span v-if="ctaIcon" class="material-symbols-outlined text-lg">{{ ctaIcon }}</span>
      {{ ctaLabel }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: String, default: 'inbox' },      // Material Symbols 图标名
  title: { type: String, required: true },        // 标题
  desc: { type: String, default: '' },            // 描述文字
  tone: { type: String, default: 'default' },     // 'default' 或 'error'
  compact: { type: Boolean, default: false },    // 紧凑模式：缩小图标与内边距
  ctaLabel: { type: String, default: '' },        // CTA 按钮文字，为空则不显示
  ctaIcon: { type: String, default: '' },          // CTA 按钮图标
})
defineEmits(['cta'])
</script>

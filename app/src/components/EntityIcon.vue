<script setup>
// 实体/设备图标统一渲染：
// - mdi 图标（mdi:xxx 或连字符名）一律走后端 SVG（CSS mask + currentColor），
//   不经 iconFor 字体映射，杜绝映射未命中时把图标名当文字渲染出乱码；
// - 其余（Material 下划线名 / 空）沿用 iconFor 字体映射，未命中回退领域默认图标。
import { computed } from 'vue'
import { iconFor, domainGlyph } from '@/utils/entities'
import { iconUrl } from '@/utils/hcIcons'

const props = defineProps({
  icon: { type: String, default: '' },
  domain: { type: String, default: '' },
})

const mdiName = computed(() => {
  const raw = (props.icon || '').trim().toLowerCase()
  if (!raw) return ''
  const hasPrefix = raw.startsWith('mdi:')
  const base = hasPrefix ? raw.slice(4) : raw
  if (!base) return ''
  // mdi 命名风格：带 mdi: 前缀或含连字符；下划线名留给 Material 字体链路
  if (hasPrefix || base.includes('-')) {
    const n = base.replace(/[^a-z0-9_-]/g, '')
    return n || ''
  }
  return ''
})

const mdiStyle = computed(() => {
  if (!mdiName.value) return null
  const u = iconUrl(mdiName.value)
  return { '-webkit-mask-image': `url("${u}")`, 'mask-image': `url("${u}")` }
})

const fontName = computed(() => {
  const fallback = domainGlyph[props.domain] || 'widgets'
  if (mdiName.value) return fallback
  if (props.icon) return iconFor({ icon: props.icon }, fallback)
  return fallback
})
</script>

<template>
  <span v-if="mdiName" class="hc-iconsvg" :style="mdiStyle" aria-hidden="true" />
  <span v-else class="material-symbols-outlined">{{ fontName }}</span>
</template>

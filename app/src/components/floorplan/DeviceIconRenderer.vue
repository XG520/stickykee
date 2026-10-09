<!-- 户型图设备图标渲染器：三种模式。
     - material：Material Symbols 字形（内置图标）
     - image：用户上传的图片（dataURL）
     - code：用户代码（html+css+js），复用卡片的 renderTemplate/scopeCss/new Function 体系，
       data 注入实体实时状态（state/on/brightness/temperature 等），支持动态效果。
     外层容器由调用方定位（2D 画布 foreignObject / 3D CSS2DObject），本组件只负责内容。 -->
<template>
  <div class="fp-icon" :style="wrapStyle">
    <!-- code 模式：v-html 渲染模板，CSS 按 #fp-dev-<id> 作用域注入（完全由用户控制样式/动效，不加状态底片） -->
    <div v-if="icon.kind === 'code' && icon.code && icon.code.html" :id="scopeId" class="fp-icon-code" v-html="codeHtml"></div>
    <!-- material / image 模式：状态色底片 + 光晕 + 图标（Home Assistant Floorplan 热力着色风格） -->
    <div v-else class="fp-badge" :style="badgeStyle">
      <img v-if="icon.kind === 'image' && icon.dataUrl" :src="icon.dataUrl" class="fp-icon-img" alt="" draggable="false" />
      <span v-else class="material-symbols-outlined fp-icon-glyph" aria-hidden="true">{{ glyphName }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { renderTemplate, scopeCss } from '@/components/cards/defaults'
import { isOn, isAvailable, numVal } from '@/utils/entities'

const props = defineProps({
  // 文档中的设备放置项（含 icon/stateMap）
  device: { type: Object, required: true },
  // 实时实体对象（可为空：未绑定或离线）
  entity: { type: Object, default: null },
  // 尺寸（px），由画布按 viewBox 比例换算后传入
  size: { type: Number, default: 44 },
})

const icon = computed(() => props.device.icon || {})
const stateMap = computed(() => props.device.stateMap || {})
const on = computed(() => isOn(props.entity))
const available = computed(() => isAvailable(props.entity))

// 状态配色：开启用 stateMap.on.color，关闭用 off.color；不可用置灰
const color = computed(() => {
  if (!available.value) return '#5C5B58'
  const m = on.value ? stateMap.value.on : stateMap.value.off
  return (m && m.color) || (on.value ? '#F5A623' : '#8A8986')
})

// 字形名：状态映射可覆盖图标（stateMap.on.icon / off.icon），其次图标配置名
const glyphName = computed(() => {
  const m = on.value ? stateMap.value.on : stateMap.value.off
  if (m && m.icon) return m.icon
  return icon.value.name || 'widgets'
})

const wrapStyle = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  opacity: available.value ? 1 : 0.45,
}))

// 状态色底片：开启时高亮背景 + 外发光，关闭时淡底；不可用置灰。
// Home Assistant Floorplan 的 state-to-color 热力着色：颜色随状态映射，视觉一眼可辨。
const badgeStyle = computed(() => {
  const c = color.value
  const glow = on.value && available.value
  const r = props.size / 2
  return {
    color: c,
    background: glow ? hexToRgba(c, 0.28) : 'rgba(120,120,120,0.10)',
    borderColor: glow ? hexToRgba(c, 0.75) : 'rgba(120,120,120,0.35)',
    boxShadow: glow
      ? `0 0 ${Math.max(8, r / 2)}px ${hexToRgba(c, 0.55)}, 0 0 ${Math.max(2, r / 6)}px ${hexToRgba(c, 0.8)}`
      : 'none',
  }
})

// hex(#RGB/#RRGGBB) → rgba()；非法色回退中性灰
function hexToRgba(hex, alpha) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return `rgba(128,128,128,${alpha})`
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ---- code 模式 ----
const scopeId = computed(() => 'fp-dev-' + (props.device.id || 'x'))

// 注入模板的数据：实体实时状态 + 常用属性
const codeData = computed(() => {
  const e = props.entity
  const a = e?.attributes || {}
  return {
    state: e ? String(e.state ?? '') : 'unknown',
    on: on.value ? '1' : '0',
    available: available.value ? '1' : '0',
    color: color.value,
    name: e?.friendly_name || props.device.name || '',
    brightness: String(numVal(a.brightness) != null ? Math.round((numVal(a.brightness) / 255) * 100) : ''),
    temperature: String(a.current_temperature ?? a.temperature ?? ''),
    humidity: String(a.humidity ?? ''),
    power: String(a.current_power_w ?? a.power ?? ''),
  }
})

const codeHtml = computed(() => renderTemplate(icon.value.code?.html || '', codeData.value))

// CSS 注入：<style> 追加到 head，选择器以 #fp-dev-<id> 作用域；卸载时移除
const styleEl = ref(null)
function applyCss() {
  const css = icon.value.code?.css || ''
  if (!css) {
    if (styleEl.value) styleEl.value.textContent = ''
    return
  }
  if (!styleEl.value) {
    styleEl.value = document.createElement('style')
    document.head.appendChild(styleEl.value)
  }
  styleEl.value.textContent = scopeCss(css, '#' + scopeId.value)
}

// JS 执行：渲染后以 (el, card, data) 调用，与 CodeCard 一致
function applyJs() {
  const js = icon.value.code?.js || ''
  if (!js) return
  nextTick(() => {
    const el = document.getElementById(scopeId.value)
    if (!el) return
    try {
      new Function('el', 'card', 'data', js)(el, { id: props.device.id, entityId: props.device.entityId }, codeData.value)
    } catch (err) {
      console.error('[floorplan-icon-js]', props.device.id, err)
    }
  })
}

// 代码或状态变化 → 重新注入样式并执行 JS（v-html 由 codeHtml 自动重渲染）
watch([codeHtml, () => icon.value.code?.css, () => icon.value.code?.js], () => {
  nextTick(() => { applyCss(); applyJs() })
}, { deep: false })

onMounted(() => { applyCss(); applyJs() })
onBeforeUnmount(() => {
  if (styleEl.value) { styleEl.value.remove(); styleEl.value = null }
})
</script>

<style scoped>
.fp-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  transition: opacity 0.25s;
}
.fp-badge {
  width: 100%;
  height: 100%;
  border-radius: 9999px;
  border: 1.5px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: color 0.25s, background 0.25s, border-color 0.25s, box-shadow 0.3s;
}
.fp-icon-glyph {
  font-size: calc(100% * 0.66);
  line-height: 1;
}
.fp-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}
.fp-icon-code {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .fp-badge { transition: none; }
}
</style>

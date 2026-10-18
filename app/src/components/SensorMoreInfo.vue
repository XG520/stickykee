<!-- 传感器「更多信息」弹窗：对齐 HA 点击传感器后的 more-info 对话框——
     图标/名称/相对更新时间 + 当前读数 + 近 24 小时历史阶梯曲线（SVG 手绘，无图表库依赖）。
     外壳与 EntityMoreInfo 同风格（遮罩、sticky 头部、ESC/遮罩点击关闭）。 -->
<template>
  <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" data-mi="sensor">
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')"></div>

    <div class="relative w-full sm:max-w-md max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-background border border-border shadow-2xl">
      <!-- 头部 -->
      <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-background/95 backdrop-blur border-b border-border">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-surface-alt border border-border">
          <span class="material-symbols-outlined text-xl text-primary">{{ glyph }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-headline font-bold text-base text-on-background truncate leading-tight">{{ name }}</h2>
          <p class="font-body text-xs text-muted truncate">{{ entityId }}</p>
        </div>
        <button class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors" @click="$emit('close')" aria-label="关闭">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>

      <div class="px-4 py-4 space-y-4">
        <!-- 信息行：图标 + 名称/相对时间 + 当前读数 -->
        <div class="flex items-center gap-3 rounded-2xl bg-surface-alt border border-border px-4 py-3">
          <div class="w-11 h-11 rounded-full shrink-0 flex items-center justify-center bg-primary/15 text-primary">
            <span class="material-symbols-outlined text-2xl">{{ glyph }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-body text-sm font-semibold text-on-background truncate">{{ name }}</p>
            <p class="font-body text-xs text-muted">{{ relTime }}</p>
          </div>
          <p class="shrink-0 font-body text-base font-semibold text-on-background">
            {{ stateText }}<span v-if="unit" class="ml-0.5 text-xs font-normal text-muted">{{ unit }}</span>
          </p>
        </div>

        <!-- 历史曲线 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-headline text-sm font-semibold text-on-background">历史</h3>
            <span class="font-body text-xs text-muted">近 24 小时</span>
          </div>

          <div v-if="histLoading" class="h-44 rounded-xl bg-surface-alt border border-border flex items-center justify-center">
            <span class="font-body text-xs text-muted">加载中…</span>
          </div>
          <p v-else-if="histError" class="font-body text-xs px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-warning">{{ histError }}</p>
          <p v-else-if="!numeric" class="font-body text-xs px-3 py-2 rounded-xl bg-surface-alt border border-border text-muted flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">show_chart</span>该传感器状态不是数值，暂无历史曲线
          </p>
          <p v-else-if="points.length < 2" class="font-body text-xs px-3 py-2 rounded-xl bg-surface-alt border border-border text-muted flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">show_chart</span>近 24 小时暂无足够的历史数据
          </p>

          <!-- SVG 阶梯折线（step-after：状态保持到下一时刻再跳变，与 HA 一致） -->
          <div v-else class="rounded-xl bg-surface-alt border border-border px-2 py-2">
            <svg :viewBox="`0 0 ${W} ${H}`" class="w-full h-44 text-primary" preserveAspectRatio="none" style="display:block">
              <!-- Y 网格线 + 标签 -->
              <g v-for="(g, i) in yGrid" :key="i">
                <line :x1="padL" :x2="W - padR" :y1="g.y" :y2="g.y" class="stroke-border" stroke-width="1" opacity="0.5" />
                <text :x="padL - 6" :y="g.y + 3" text-anchor="end" class="fill-muted" style="font-size:9px">{{ g.label }}</text>
              </g>
              <!-- X 时间刻度 -->
              <text v-for="(t, i) in xTicks" :key="'x' + i" :x="t.x" :y="H - 6" text-anchor="middle" class="fill-muted" style="font-size:9px">{{ t.label }}</text>
              <!-- 单位 -->
              <text v-if="unit" :x="padL" :y="12" class="fill-muted" style="font-size:9px">{{ unit }}</text>
              <!-- 折线 -->
              <path :d="linePath" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { store, entityStates } from '@/store'
import { iconFor, domainGlyph, attr } from '@/utils/entities'

const props = defineProps({
  entityId: { type: String, required: true },
})
const emit = defineEmits(['close'])

const entity = computed(() => entityStates[props.entityId] || null)
const name = computed(() => entity.value?.friendly_name || props.entityId)
const glyph = computed(() => iconFor(entity.value || {}, domainGlyph.sensor || 'sensors'))
const stateText = computed(() => String(entity.value?.state ?? '—'))
const unit = computed(() => String(attr(entity.value, 'unit_of_measurement') || ''))

// ---- 相对时间（每分钟刷新） ----
const nowTick = ref(Date.now())
let tickTimer = null
const relTime = computed(() => {
  const t = Date.parse(entity.value?.last_changed || '')
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, nowTick.value - t)
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`
  return `${Math.floor(diff / 86400e3)} 天前`
})

// ---- 历史数据 ----
const histLoading = ref(true)
const histError = ref('')
const points = ref([]) // [{ t, v }] 升序
const numeric = computed(() => Number.isFinite(parseFloat(stateText.value)))

async function loadHistory() {
  histLoading.value = true
  histError.value = ''
  try {
    const { data } = await api.history(store.activeID, { entity: props.entityId })
    const list = Array.isArray(data?.[0]) ? data[0] : []
    let pts = []
    for (const it of list) {
      const v = parseFloat(it?.state)
      const t = Date.parse(it?.last_changed || '')
      if (Number.isFinite(v) && Number.isFinite(t)) pts.push({ t, v })
    }
    // 抽稀到 ≤600 点（保首尾），避免超长 path
    if (pts.length > 600) {
      const step = (pts.length - 1) / 599
      const out = []
      for (let i = 0; i < 599; i++) out.push(pts[Math.round(i * step)])
      out.push(pts[pts.length - 1])
      pts = out
    }
    points.value = pts
  } catch (e) {
    histError.value = e.message || '历史数据加载失败'
  } finally {
    histLoading.value = false
  }
}

// ---- SVG 几何 ----
const W = 640
const H = 190
const padL = 40
const padR = 8
const padT = 16
const padB = 22

const xRange = computed(() => {
  const end = Date.now()
  return { min: end - 24 * 3600e3, max: end }
})
const yRange = computed(() => {
  let lo = Infinity, hi = -Infinity
  for (const p of points.value) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1 }
  if (lo === hi) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.08
  return { min: lo - pad, max: hi + pad }
})

const xOf = (t) => padL + ((t - xRange.value.min) / (xRange.value.max - xRange.value.min)) * (W - padL - padR)
const yOf = (v) => padT + (1 - (v - yRange.value.min) / (yRange.value.max - yRange.value.min)) * (H - padT - padB)

const linePath = computed(() => {
  const pts = points.value
  if (pts.length < 2) return ''
  let d = `M ${xOf(pts[0].t).toFixed(1)} ${yOf(pts[0].v).toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const x = xOf(pts[i].t).toFixed(1)
    d += ` L ${x} ${yOf(pts[i - 1].v).toFixed(1)} L ${x} ${yOf(pts[i].v).toFixed(1)}`
  }
  // 末尾水平延伸到当前时刻（状态保持）
  d += ` L ${xOf(xRange.value.max).toFixed(1)} ${yOf(pts[pts.length - 1].v).toFixed(1)}`
  return d
})

function fmtY(v) {
  const a = Math.abs(v)
  if (a >= 10000) return `${Math.round(v / 1000)}k`
  if (a >= 100) return String(Math.round(v))
  if (a >= 1) return String(Math.round(v * 10) / 10)
  return String(Math.round(v * 100) / 100)
}
const yGrid = computed(() => {
  const { min, max } = yRange.value
  const out = []
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4
    out.push({ y: yOf(v).toFixed(1), label: fmtY(v) })
  }
  return out
})
const xTicks = computed(() => {
  const { min, max } = xRange.value
  const out = []
  for (let i = 0; i <= 4; i++) {
    const t = new Date(min + ((max - min) * i) / 4)
    const hh = String(t.getHours()).padStart(2, '0')
    const mm = String(t.getMinutes()).padStart(2, '0')
    const label = (hh === '00' && mm === '00') ? `${t.getMonth() + 1}月${t.getDate()}日` : `${hh}:${mm}`
    out.push({ x: xOf(t.getTime()).toFixed(1), label })
  }
  return out
})

// ---- ESC 关闭 ----
function escHandler(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => {
  window.addEventListener('keydown', escHandler)
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 60000)
  loadHistory()
})
onUnmounted(() => {
  window.removeEventListener('keydown', escHandler)
  clearInterval(tickTimer)
})
</script>

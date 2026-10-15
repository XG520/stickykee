<!-- 实体「更多信息」面板：对齐 Home Assistant 点击实体后弹出的 more-info 对话框。
     控件由 utils/entityControls 的能力模型推导（按 supported_features + 属性存在性），
     因此同一实体在设备页与首页卡片上暴露的能力完全一致。 -->
<template>
  <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" data-mi="panel">
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')"></div>

    <div class="relative w-full sm:max-w-md max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-background border border-border shadow-2xl">
      <!-- 头部 -->
      <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-background/95 backdrop-blur border-b border-border">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-surface-alt border border-border">
          <span class="material-symbols-outlined text-xl" :class="accentText">{{ glyph }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-headline font-bold text-base text-on-background truncate leading-tight">{{ name }}</h2>
          <p class="font-body text-xs text-muted truncate">{{ entity.entity_id }}</p>
        </div>
        <button class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors" @click="$emit('close')" aria-label="关闭">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>

      <div class="px-4 py-4 space-y-4">
        <p v-if="!writable" class="font-body text-xs px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-warning">
          该实体当前不可用（{{ entity.state }}），控件已锁定。
        </p>

        <!-- 大开关 -->
        <div
          v-if="power"
          data-mi="toggle"
          class="flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors cursor-pointer select-none"
          :class="[toggleOn ? 'bg-primary/10 border-primary/40' : 'bg-surface-alt border-border', writable ? '' : 'opacity-50 cursor-default']"
          @click="onToggle"
        >
          <span class="material-symbols-outlined text-2xl" :class="toggleOn ? accentText : 'text-faint'">{{ glyph }}</span>
          <div class="flex-1 min-w-0">
            <p class="font-body text-sm font-semibold text-on-background truncate">{{ power.label }}</p>
            <p class="font-body text-xs text-muted truncate">{{ stateLabel }}</p>
          </div>
          <span class="relative w-12 h-7 rounded-full shrink-0 transition-colors duration-200" :class="toggleOn ? accentBg : 'bg-faint'">
            <span class="absolute top-1 left-1 w-5 h-5 rounded-full bg-on-primary shadow transition-transform duration-200" :class="toggleOn ? 'translate-x-5' : ''"></span>
          </span>
        </div>

        <!-- 只读读数（如空调当前温度） -->
        <div v-if="readouts.length" class="flex flex-wrap gap-2">
          <div v-for="r in readouts" :key="r.id" class="flex-1 min-w-[45%] rounded-xl bg-surface-alt border border-border px-3 py-2">
            <p class="font-body text-[11px] text-muted truncate">{{ r.label }}</p>
            <p class="font-body text-lg font-semibold text-on-background">{{ fmt(r.value) }}{{ r.unit || '' }}</p>
          </div>
        </div>

        <!-- 控件区 -->
        <div v-for="c in writableControls" :key="c.id" class="space-y-1.5">
          <template v-if="c.kind === 'range'">
            <div class="flex items-center justify-between gap-2" data-mi="range">
              <span class="font-body text-sm text-muted">{{ c.label }}</span>
              <span class="font-body text-sm font-semibold text-on-background">{{ fmt(rangeVal(c)) }}{{ c.unit || '' }}</span>
            </div>
            <input
              type="range" class="w-full accent-primary cursor-pointer"
              :min="c.min" :max="c.max" :step="c.step" :value="rangeVal(c)" :disabled="!writable"
              @input="onRangeInput(c, $event)" @change="onRangeCommit(c, $event)"
            />
          </template>

          <template v-else-if="c.kind === 'select'">
            <div class="flex items-center justify-between gap-3" data-mi="select">
              <span class="font-body text-sm text-muted shrink-0">{{ c.label }}</span>
              <select
                class="flex-1 min-w-0 px-2 py-1.5 rounded-xl bg-surface-alt border border-border text-sm font-body text-on-background outline-none focus:border-primary"
                :value="c.value" :disabled="!writable" @change="onSelect(c, $event)"
              >
                <option v-if="!hasOption(c, c.value)" value="">—</option>
                <option v-for="o in c.options" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </template>

          <template v-else-if="c.kind === 'chips'">
            <p class="font-body text-sm text-muted">{{ c.label }}</p>
            <div class="flex flex-wrap gap-2" data-mi="chips">
              <button
                v-for="o in c.options" :key="o.value"
                class="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                :class="[String(o.value) === String(c.value) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:text-on-surface',
                         writable ? '' : 'opacity-50']"
                :disabled="!writable" @click="call(c, o.value)"
              >{{ o.label }}</button>
            </div>
          </template>

          <template v-else-if="c.kind === 'buttons'">
            <p class="font-body text-sm text-muted">{{ c.label }}</p>
            <div class="flex flex-wrap gap-2" data-mi="buttons">
              <button
                v-for="(a, i) in c.actions" :key="i"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors"
                :class="[a.active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface-alt text-on-surface hover:border-primary/50',
                         writable ? '' : 'opacity-50']"
                :disabled="!writable" @click="call(c, a)"
              >
                <span v-if="a.icon" class="material-symbols-outlined text-base">{{ a.icon }}</span>{{ a.label }}
              </button>
            </div>
          </template>

          <template v-else-if="c.kind === 'text'">
            <p class="font-body text-sm text-muted">{{ c.label }}</p>
            <div class="flex items-center gap-2" data-mi="text">
              <input
                v-model="drafts[c.id]"
                :type="c.numeric ? 'number' : 'text'"
                :min="c.min" :max="c.max" :maxlength="c.maxlength" :disabled="!writable"
                class="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-surface-alt border border-border text-sm font-body text-on-background outline-none focus:border-primary"
              />
              <button class="px-3 py-1.5 rounded-xl border border-primary bg-primary/10 text-primary text-xs font-medium" :disabled="!writable" @click="call(c, drafts[c.id])">确定</button>
            </div>
          </template>

          <template v-else-if="c.kind === 'datetime'">
            <p class="font-body text-sm text-muted">{{ c.label }}</p>
            <div class="flex items-center gap-2" data-mi="datetime">
              <input
                v-model="drafts[c.id]" :type="c.inputType" :disabled="!writable"
                class="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-surface-alt border border-border text-sm font-body text-on-background outline-none focus:border-primary"
              />
              <button class="px-3 py-1.5 rounded-xl border border-primary bg-primary/10 text-primary text-xs font-medium" :disabled="!writable" @click="call(c, drafts[c.id])">确定</button>
            </div>
          </template>
        </div>

        <!-- 属性明细 -->
        <details class="rounded-xl bg-surface-alt border border-border overflow-hidden" data-mi="props">
          <summary class="px-3 py-2 font-body text-sm text-muted cursor-pointer select-none">属性明细（{{ propRows.length }}）</summary>
          <div class="px-3 pb-3 divide-y divide-border/60">
            <div v-for="p in propRows" :key="p.key" class="flex items-start justify-between gap-3 py-1.5">
              <span class="font-body text-xs text-muted shrink-0">{{ p.key }}</span>
              <span class="font-body text-xs text-on-background text-right break-all">{{ p.value }}</span>
            </div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { store, requestEntityRefresh } from '@/store'
import { iconFor, domainGlyph, domainColorCls, isAvailable } from '@/utils/entities'
import { buildControls, buildServiceCall, stateLabelOf } from '@/utils/entityControls'

const props = defineProps({
  entity: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const controls = computed(() => buildControls(props.entity))
const power = computed(() => controls.value.find((c) => c.kind === 'toggle') || null)
const readonly = computed(() => controls.value.filter((c) => c.kind === 'readonly'))
const writableControls = computed(() => controls.value.filter((c) => c.kind !== 'toggle' && c.kind !== 'readonly'))
// 只读读数：优先用显式 readonly 控件，其次用可写 range 的当前值已在控件内展示，不重复
const readouts = computed(() => readonly.value)

const writable = computed(() => isAvailable(props.entity))

const glyph = computed(() => iconFor(props.entity, domainGlyph[props.entity.domain] || 'widgets'))
const name = computed(() => props.entity.friendly_name || props.entity.entity_id)
const stateLabel = computed(() => stateLabelOf(props.entity))
const cls = computed(() => domainColorCls[props.entity.domain] || 'text-primary')
const accentText = computed(() => cls.value)
const accentBg = computed(() => ({
  'text-warning': 'bg-warning',
  'text-primary': 'bg-primary',
  'text-info': 'bg-info',
  'text-success': 'bg-success',
  'text-accent': 'bg-accent',
  'text-muted': 'bg-faint',
}[cls.value] || 'bg-primary'))

// ---- 本地编辑态：拖动滑条/输入框时不与实时推送互相打架 ----
const localVals = reactive({})
const drafts = reactive({})
const toggleOverride = ref(null)

watch(() => props.entity.entity_id, () => {
  for (const k of Object.keys(localVals)) delete localVals[k]
  for (const k of Object.keys(drafts)) delete drafts[k]
  toggleOverride.value = null
  for (const c of controls.value) {
    if (c.kind === 'text' || c.kind === 'datetime') drafts[c.id] = c.value
  }
}, { immediate: true })

function rangeVal(c) {
  return localVals[c.id] != null ? localVals[c.id] : c.value
}
function fmt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v == null ? '' : v)
  return String(Math.round(n * 100) / 100)
}
function hasOption(c, v) { return (c.options || []).some((o) => String(o.value) === String(v)) }

// ---- 写入：统一经 buildServiceCall 生成服务载荷 ----
function send(control, value) {
  const payload = buildServiceCall(control, value)
  if (!payload) return Promise.resolve()
  const { domain, service, data } = payload
  return api.callService(store.activeID, {
    domain, service, entity_id: props.entity.entity_id, service_data: data || {},
  }).then(() => requestEntityRefresh(300)).catch(() => {})
}

function call(control, value) { send(control, value) }

// 滑条：immediate 控件拖动即上报（120ms 节流），其余松手（change）才上报
const rangeTimers = new Map()
function onRangeInput(c, e) {
  const v = Number(e.target.value)
  localVals[c.id] = v
  if (!c.immediate) return
  clearTimeout(rangeTimers.get(c.id))
  rangeTimers.set(c.id, setTimeout(() => send(c, v), 120))
}
function onRangeCommit(c, e) {
  const v = Number(e.target.value)
  localVals[c.id] = v
  clearTimeout(rangeTimers.get(c.id))
  send(c, v)
}

// ---- 大开关：乐观更新，失败回滚；实时状态确认后清除覆盖 ----
const toggleOn = computed(() => (toggleOverride.value != null ? toggleOverride.value : !!(power.value && power.value.on)))
watch(() => props.entity.state, (s) => {
  if (toggleOverride.value == null) return
  const expect = toggleOverride.value ? 'on' : 'off'
  if (String(s || '').toLowerCase() === expect) toggleOverride.value = null
})
function onToggle() {
  const c = power.value
  if (!c || !writable.value) return
  const next = !toggleOn.value
  toggleOverride.value = next
  const payload = buildServiceCall(c, null)
  api.callService(store.activeID, {
    domain: payload.domain, service: payload.service, entity_id: props.entity.entity_id, service_data: payload.data || {},
  }).then(() => requestEntityRefresh(300)).catch(() => { toggleOverride.value = null })
}

// ---- 属性明细：跳过内部实现键 ----
const PROP_SKIP = new Set([
  'supported_features', 'supported_color_modes', 'friendly_name', 'icon',
  'device_class', 'entity_picture', 'editable', 'restored',
])
const propRows = computed(() => {
  const a = props.entity.attributes || {}
  const out = []
  for (const [k, v] of Object.entries(a)) {
    if (PROP_SKIP.has(k) || v === null || v === undefined || v === '') continue
    if (typeof v === 'object' && !Array.isArray(v)) continue
    out.push({ key: k, value: Array.isArray(v) ? v.join(', ') : String(v) })
  }
  return out
})

// ---- ESC 关闭 ----
function escHandler(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', escHandler))
onUnmounted(() => {
  window.removeEventListener('keydown', escHandler)
  rangeTimers.forEach((t) => clearTimeout(t))
  rangeTimers.clear()
})
</script>
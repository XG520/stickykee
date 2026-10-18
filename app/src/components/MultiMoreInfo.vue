<!-- 多实体卡「更多信息」弹窗：点击绑了多个实体的卡片（如通用卡）后弹出——
     列出全部实体（图标/名称/状态），可控实体行内直接开关，点击行再堆叠打开该实体的
     完整控制面板（EntityMoreInfo，z 层级更高，关闭后回到本列表）。
     外壳与 EntityMoreInfo 同风格（遮罩、sticky 头部、ESC/遮罩点击关闭）。 -->
<template>
  <div class="fixed inset-0 z-[65] flex items-end sm:items-center justify-center" data-mi="multi">
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')"></div>

    <div class="relative w-full sm:max-w-md max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-background border border-border shadow-2xl">
      <!-- 头部 -->
      <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-background/95 backdrop-blur border-b border-border">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-surface-alt border border-border">
          <span class="material-symbols-outlined text-xl text-primary">{{ cardIcon }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-headline font-bold text-base text-on-background truncate leading-tight">{{ cardTitle }}</h2>
          <p class="font-body text-xs text-muted truncate">{{ rows.length }} 个实体</p>
        </div>
        <button class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors" @click="$emit('close')" aria-label="关闭">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>

      <!-- 实体列表 -->
      <div class="px-4 py-4 space-y-2">
        <p v-if="!rows.length" class="font-body text-xs px-3 py-2 rounded-xl bg-surface-alt border border-border text-muted">
          该卡片尚未绑定实体，请在编辑弹窗中添加
        </p>
        <div v-for="r in rows" :key="r.id"
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-alt border border-border transition-colors"
          :class="r.available ? 'hover:border-primary/40 cursor-pointer' : 'opacity-60'"
          @click="r.available && openSub(r.id)">
          <span class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-background border border-border">
            <span class="material-symbols-outlined text-lg" :class="r.colorCls">{{ r.glyph }}</span>
          </span>
          <div class="flex-1 min-w-0">
            <p class="font-body text-sm font-medium text-on-background truncate">{{ r.name }}</p>
            <p class="font-body text-xs text-muted truncate">{{ r.stateLabel }}</p>
          </div>
          <!-- 可控实体：行内开关（点击不进入子面板） -->
          <span v-if="r.hasPower" @click.stop="toggle(r)"
            class="relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200 cursor-pointer"
            :class="[r.on ? 'bg-primary' : 'bg-faint', r.available ? '' : 'pointer-events-none']">
            <span class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-on-primary shadow transition-transform duration-200" :class="r.on ? 'translate-x-5' : ''"></span>
          </span>
          <span v-else class="shrink-0 font-body text-sm text-on-surface">{{ r.stateText }}<span v-if="r.unit" class="text-xs text-muted">{{ r.unit }}</span></span>
          <span class="material-symbols-outlined text-muted text-base shrink-0">chevron_right</span>
        </div>
      </div>

      <!-- 单实体完整控制面板（堆叠在上层，关闭回到列表） -->
      <EntityMoreInfo v-if="subEntity" :entity="subEntity" @close="subId = ''" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { store, entityStates, requestEntityRefresh } from '@/store'
import { iconFor, domainGlyph, domainColorCls, isAvailable, attr } from '@/utils/entities'
import { buildControls, buildServiceCall, stateLabelOf } from '@/utils/entityControls'
import { cardDefaults } from '@/components/cards/defaults'
import EntityMoreInfo from '@/components/EntityMoreInfo.vue'

const props = defineProps({
  card: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const cardTitle = computed(() => props.card.title || cardDefaults[props.card.type]?.label || '卡片')
const cardIcon = computed(() => props.card.icon || cardDefaults[props.card.type]?.icon || 'widgets')

// 实体行：实时状态直读 entityStates（WS 推送自动刷新，含开关态）
const rows = computed(() => {
  const ids = (props.card.entity_ids || []).filter(Boolean)
  const list = ids.length ? ids : (props.card.entity_id ? [props.card.entity_id] : [])
  return list
    .map((id) => {
      const e = entityStates[id]
      if (!e) return null
      const ctrls = buildControls(e)
      const power = ctrls.find((c) => c.kind === 'toggle') || null
      return {
        id,
        entity: e,
        name: e.friendly_name || id,
        glyph: iconFor(e, domainGlyph[e.domain] || 'widgets'),
        colorCls: domainColorCls[e.domain] || 'text-primary',
        available: isAvailable(e),
        stateLabel: stateLabelOf(e),
        stateText: String(e.state ?? '—'),
        unit: String(attr(e, 'unit_of_measurement') || ''),
        hasPower: !!power,
        on: !!(power && power.on),
        power,
      }
    })
    .filter(Boolean)
})

// 行内开关：与 EntityMoreInfo 同一链路（能力模型生成服务载荷）
function toggle(r) {
  if (!r.power || !r.available) return
  const payload = buildServiceCall(r.power, null)
  if (!payload) return
  api.callService(store.activeID, {
    domain: payload.domain, service: payload.service, entity_id: r.id, service_data: payload.data || {},
  }).then(() => requestEntityRefresh(300)).catch(() => {})
}

// 点击行：堆叠打开该实体的完整控制面板
const subId = ref('')
const subEntity = computed(() => (subId.value ? entityStates[subId.value] || null : null))
function openSub(id) { subId.value = id }

// ---- ESC：有子面板时先关子面板，否则关本弹窗 ----
function escHandler(e) {
  if (e.key !== 'Escape') return
  if (subId.value) subId.value = ''
  else emit('close')
}
onMounted(() => window.addEventListener('keydown', escHandler))
onUnmounted(() => window.removeEventListener('keydown', escHandler))
</script>

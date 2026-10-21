<template>
  <Teleport to="body">
    <Transition name="im-fade">
      <div v-if="open" class="fixed inset-0 z-[80]">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-[2px]" @click="close"></div>
        <div class="absolute inset-y-0 right-0 w-full md:max-w-3xl bg-surface shadow-2xl flex flex-col">
          <!-- 头部 -->
          <div class="flex items-center gap-3 px-5 py-3.5 border-b border-border">
            <span class="material-symbols-outlined text-primary text-xl">devices</span>
            <h3 class="font-headline text-on-background font-semibold text-base">设备</h3>
            <span v-if="activeFilter !== 'all'" class="flex items-center gap-1 text-[11px] font-body px-2 py-0.5 rounded-full bg-primary/15 border border-primary/40 text-primary">
              {{ filterLabel(activeFilter) }}
              <button @click="activeFilter = 'all'" title="清除筛选" class="hover:text-on-surface transition-colors">
                <span class="material-symbols-outlined text-xs">close</span>
              </button>
            </span>
            <span class="text-muted text-xs font-body">共 {{ totalCount }} 台<template v-if="activeFilter === 'all'"> · {{ onlineCount }} 在线</template></span>
            <button @click="reload" title="刷新" class="ml-auto w-10 h-10 rounded-full hover:bg-surface-hover flex items-center justify-center text-muted hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-base" :class="{ 'animate-spin': loading }">refresh</span>
            </button>
            <button @click="close" title="关闭" class="w-10 h-10 rounded-full hover:bg-surface-hover flex items-center justify-center text-muted hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-base">close</span>
            </button>
          </div>

          <!-- 主体：左列表 + 右侧详情（桌面双列；小屏详情为覆盖整个主体区的全屏面板） -->
          <div class="flex-1 min-h-0 flex relative">
            <!-- 左：设备分组列表 -->
            <div class="flex-1 lg:flex-1 min-w-0 flex flex-col lg:max-w-sm border-r border-border/60">
              <div class="hc-hide-bar flex-1 overflow-y-auto">
                <div v-if="loading && !loadedOnce" class="py-12 text-center">
                  <span class="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin inline-block"></span>
                </div>
                <div v-else-if="!devices.length" class="py-12 text-center text-muted text-sm font-body">{{ activeFilter === 'all' ? '未获取到设备' : '没有符合条件的设备' }}</div>
                <div v-for="room in rooms" :key="room.id" class="border-b border-border/50 last:border-b-0">
                  <button class="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-hover/60 transition-colors" @click="toggleRoom(room)">
                    <span class="material-symbols-outlined text-base text-muted" :class="isRoomCollapsed(room) ? 'chevron_right' : 'expand_more'">expand_more</span>
                    <span class="text-sm text-on-surface font-medium truncate flex-1">{{ room.name }}</span>
                    <span class="text-muted text-[11px] font-body shrink-0">{{ room.devices.length }} 台 · {{ onRoomCount(room) }} 在线</span>
                  </button>
                  <div v-if="!isRoomCollapsed(room)" class="px-3 pb-2 space-y-1.5">
                    <button v-for="d in room.devices" :key="d.device.id"
                      @click="openDetail(d)"
                      class="w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors text-left"
                      :class="selected(d) ? 'border-primary/60 bg-primary/5' : 'border-border bg-surface-alt/60 hover:border-primary/40'">
                      <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        :class="deviceOnline(d) ? iconBox(d) : 'bg-faint/15 border border-border'">
                        <span class="material-symbols-outlined text-lg" :class="deviceOnline(d) ? iconColor(d) : 'text-faint'">{{ deviceGlyph(d) }}</span>
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="text-sm text-on-surface font-medium truncate">{{ d.display_name }}</p>
                        <p class="text-[11px] text-muted font-body truncate">
                          {{ d.area_name || '未分配区域' }}<template v-if="domainBadge(d)"> · {{ domainBadge(d) }}</template>
                        </p>
                      </div>
                      <div class="shrink-0 flex items-center gap-1">
                        <span v-if="deviceOnline(d)" class="w-1.5 h-1.5 rounded-full bg-success"></span>
                        <span v-else class="w-1.5 h-1.5 rounded-full bg-faint"></span>
                        <span class="material-symbols-outlined text-sm text-muted pl-0.5">chevron_right</span>
                      </div>
                    </button>
                  </div>
                </div>
                <div v-if="unassigned.length" class="border-b border-border/50">
                  <button class="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-hover/60 transition-colors" @click="toggleRoomUnassigned">
                    <span class="material-symbols-outlined text-base text-muted">chevron_down</span>
                    <span class="text-sm text-on-surface font-medium truncate flex-1">{{ unassigned.length }} 个未分配实体</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 右侧：详情（无 device 时不显示；小屏为覆盖层，带返回按钮） -->
            <aside v-if="detail" class="flex flex-col lg:flex-1 lg:min-w-0 border-l border-border/60 max-lg:absolute max-lg:inset-0 max-lg:z-10 max-lg:bg-surface max-lg:border-l-0">
              <!-- 小屏返回栏 -->
              <div class="lg:hidden flex items-center gap-1 px-2 py-2 border-b border-border">
                <button @click="detail = null" title="返回设备列表"
                  class="w-10 h-10 rounded-full hover:bg-surface-hover flex items-center justify-center text-muted hover:text-on-surface transition-colors">
                  <span class="material-symbols-outlined text-lg">arrow_back</span>
                </button>
                <span class="text-sm text-on-surface font-medium truncate">{{ detail.display_name }}</span>
              </div>
              <div class="hc-hide-bar flex-1 overflow-y-auto">
                <div class="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
                  <span class="hidden lg:inline-block font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-on-surface">{{ detail.display_name }}</span>
                  <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-on-surface">{{ detail.area_name || '未分配区域' }}</span>
                  <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-on-surface">{{ (detail.entities || []).filter((e) => !e.disabled).length }} 个实体</span>
                </div>
                <div class="px-4 pt-4 pb-2"><span class="font-body text-xs font-semibold text-muted uppercase tracking-wide">实体</span></div>
                <div class="px-4 pb-6 grid grid-cols-1 gap-2.5">
                  <div v-for="e in liveEntities" :key="e.entity_id"
                    class="flex items-center gap-3 bg-surface-alt border rounded-xl p-2.5 min-w-0 cursor-pointer hover:border-primary/60 transition-colors"
                    :class="isOn(e) ? 'border-primary/40' : 'border-border'" @click="e.hasMore ? openMore(e) : noop">
                    <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" :class="isOn(e) ? iconBox(detail) : 'bg-faint/15 border border-border'">
                      <span class="material-symbols-outlined text-lg" :class="isOn(e) ? iconColor(detail) : 'text-faint'">{{ glyph(e.domain) || 'widgets' }}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-on-background font-medium truncate">{{ e.friendly_name || e.entity_id }}</p>
                      <p class="text-[11px] text-muted font-body truncate">{{ e.entity_id }}</p>
                    </div>
                    <div class="shrink-0 flex items-center gap-1.5">
                      <span v-if="sensorValue(e)" class="text-sm font-semibold whitespace-nowrap" :class="isOn(e) ? iconColor(detail) : 'text-on-surface'">{{ sensorValue(e) }}</span>
                      <button v-if="canToggle(e) && !e.disabled"
                        class="relative w-10 h-6 rounded-full shrink-0 transition-colors duration-200"
                        :class="isOn(e) ? accentToggle(detail) : 'bg-faint'" @click.stop="onToggleEntity(e)">
                        <span class="absolute top-1 left-1 w-4 h-4 rounded-full bg-on-primary shadow transition-transform duration-200"
                          :class="isOn(e) ? 'translate-x-4' : ''"></span>
                      </button>
                    </div>
                  </div>
                  <div v-if="!(detail.entities || []).length" class="px-5 py-8 text-center font-body text-sm text-faint">该设备没有关联实体</div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import api from '@/api'
import { store, entityStates, refreshEntities, loadRegistry, registryDevices as regDevices, registryUnassigned as regUnassigned, registryLoaded, deviceDrawer } from '@/store'
import { isOn, isAvailable, iconFor, domainGlyph, powerOf } from '@/utils/entities'
import { buildControls, buildServiceCall } from '@/utils/entityControls'
import { setOptimistic, clearOptimistic, effectiveOn, applyOptimistic, setServiceOptimistic } from '@/composables/useOptimistic'

const emit = defineEmits(['close'])

// 打开状态与过滤条件来自全局 store（deviceDrawer），任何页面调用 openDeviceDrawer(filter) 即可打开。
const open = computed(() => deviceDrawer.open)
const FILTER_LABELS = { active: '开启的设备', inactive: '关闭的设备', lights_on: '开启的灯光', power: '有功耗设备' }
const DOMAIN_CN = { light: '灯光', climate: '空调', switch: '开关', media_player: '影音', cover: '窗帘', lock: '门锁', camera: '摄像头', sensor: '传感器', fan: '风扇', humidifier: '加湿', vacuum: '扫地' }
// 过滤条件：all / active / inactive / lights_on / power / area:房间名 / domain:领域
function filterLabel(f) {
  if (!f || f === 'all') return ''
  if (f.startsWith('area:')) return `房间 · ${f.slice(5)}`
  if (f.startsWith('domain:')) { const d = f.slice(7); return `${DOMAIN_CN[d] || d}设备` }
  return FILTER_LABELS[f] || ''
}

const loading = ref(false)
const loadedOnce = ref(false)
// 打开时同步外部过滤条件；抽屉内可清除过滤回到全量列表
const activeFilter = ref('all')
watch(() => [open.value, deviceDrawer.filter, deviceDrawer.seq], ([o, f]) => {
  if (o) { activeFilter.value = f || 'all'; detail.value = null }
})
// 设备列表改用全局共享缓存（与概览卡片同一数据源，保证数量口径一致）。
// 不在此处合并实时状态：抽屉常驻挂载，避免每次 WS 推送都重算整个设备列表；
// 实时状态由渲染路径上的 liveEntityOf / activeCount / deviceOnline 按需读取。
// 带过滤条件时例外：online/offline/lights_on 需读实时状态，列表小、代价可控。
const devices = computed(() => {
  const f = activeFilter.value
  const list = regDevices.value
  let out = list
  if (f === 'active') out = list.filter(deviceActive)
  else if (f === 'inactive') out = list.filter((d) => !deviceActive(d))
  else if (f === 'lights_on') out = list.filter(deviceLightOn)
  else if (f === 'power') out = list.filter(devicePower)
  else if (f.startsWith('domain:')) {
    const dom = f.slice(7)
    out = list.filter((d) => (d.entities || []).some((e) => !e.disabled && e.domain === dom))
  }
  else if (f.startsWith('area:')) {
    const target = f.slice(5).trim()
    out = list.filter((d) => {
      const a = (d.area_name || '').trim()
      return a === target || (target && a.includes(target)) || (a && target.includes(a))
    })
  }
  return out
})
const unassigned = computed(() => regUnassigned.value)
const detail = ref(null)
const collapsed = ref(new Set())
const moreEntityId = ref('')

// 详情实体：经 liveEntityOf 取全局 entityStates 实时状态，toggle 后按钮/开关即时联动。
const liveEntities = computed(() => {
  if (!detail.value || !Array.isArray(detail.value.entities)) return []
  return detail.value.entities.map(liveEntityOf)
})

function close() { detail.value = null; moreEntityId.value = ''; deviceDrawer.open = false; emit('close') }
function reload() { load(1) }
function isRoomCollapsed(room) { return collapsed.value.has(room.id) }
function toggleRoom(room) {
  const s = new Set(collapsed.value)
  if (s.has(room.id)) s.delete(room.id); else s.add(room.id)
  collapsed.value = s
}
let collapseAll = false
function toggleRoomUnassigned() { collapseAll = !collapseAll }
function onRoomCount(room) { return room.devices.filter(deviceOnline).length }

const rooms = computed(() => {
  const map = new Map()
  for (const d of devices.value) {
    const key = d.area_id || '__none__'
    const name = d.area_name || '未分配房间'
    if (!map.has(key)) map.set(key, { id: key, name, devices: [] })
    map.get(key).devices.push(d)
  }
  const out = [...map.values()]
  out.sort((a, b) => (a.id === '__none__' ? 1 : 0) - (b.id === '__none__' ? 1 : 0))
  return out
})

function deviceOnline(d) { return (d.entities || []).some((e) => { const l = liveEntityOf(e); return !e.disabled && isAvailable(l) }) }
// 设备「开启」：至少一个未禁用实体处于 on/open/playing 等开启态（与概览卡格子同口径）
function deviceActive(d) { return (d.entities || []).some((e) => !e.disabled && isOn(liveEntityOf(e))) }
function deviceLightOn(d) { return (d.entities || []).some((e) => !e.disabled && e.domain === 'light' && isOn(liveEntityOf(e))) }
function devicePower(d) { return (d.entities || []).some((e) => { const l = liveEntityOf(e); return !e.disabled && (powerOf(l) ?? 0) > 0 }) }
function deviceVia(e) { return e }
function domainBadge(d) {
  if (d.disabled || !d.domain) return ''
  const map = { light: '灯光', climate: '空调', switch: '开关', media_player: '影音', cover: '窗帘', lock: '门锁', camera: '摄像头', sensor: '传感器', fan: '风扇', humidifier: '加湿', vacuum: '扫地' }
  return map[d.domain] || ''
}
function glyph(domain) { return domainGlyph[domain] || 'widgets' }
function deviceGlyph(d) { return iconFor({ icon: d && d.main_icon }, glyph(d && d.domain)) }
function selected(d) { return detail.value && detail.value.device && detail.value.device.id === d.device.id }

// 详情面板配色（基于主域）
function domainPal(d) {
  const map = {
    light: { color: 'text-warning', box: 'bg-warning/15 border border-warning/30', toggle: 'bg-warning' },
    climate: { color: 'text-info', box: 'bg-info/15 border border-info/30', toggle: 'bg-info' },
    switch: { color: 'text-primary', box: 'bg-primary/15 border border-primary/30', toggle: 'bg-primary' },
    media_player: { color: 'text-accent', box: 'bg-accent/15 border border-accent/30', toggle: 'bg-accent' },
    cover: { color: 'text-warning', box: 'bg-warning/15 border border-warning/30', toggle: 'bg-warning' },
    lock: { color: 'text-success', box: 'bg-success/15 border border-success/30', toggle: 'bg-success' },
    camera: { color: 'text-accent', box: 'bg-accent/15 border border-accent/30', toggle: 'bg-accent' },
    sensor: { color: 'text-info', box: 'bg-info/15 border border-info/30', toggle: 'bg-info' },
  }
  return map[d.domain] || { color: 'text-on-surface', box: 'bg-surface-alt border border-border', toggle: 'bg-primary' }
}
function iconBox(d) { return domainPal(d).box }
function iconColor(d) { return domainPal(d).color }
function accentToggle(d) { return domainPal(d).toggle }

function sensorValue(e) {
  if (!isOn(e) && e.domain !== 'sensor' && e.domain !== 'binary_sensor' && e.domain !== 'number') return ''
  const unit = e.unit || (e.attributes && e.attributes.unit_of_measurement) || ''
  if (e.state === '' || e.state === null || e.state === undefined) return ''
  return `${e.state}${unit ? ' ' + unit : ''}`
}

// 实体控制能力（同源 entityControls）
function liveEntityOf(e) {
  const live = entityStates[e.entity_id]
  const merged = !live ? e : {
    ...e,
    state: live.state !== undefined ? live.state : e.state,
    attributes: { ...(e.attributes || {}), ...(live.attributes || {}) },
    domain: e.domain || live.domain,
  }
  // 乐观覆盖：点击后立即以目标态渲染，确认/超时/回滚由 useOptimistic 统一管理
  return applyOptimistic(merged)
}
function controlsOf(e) { return buildControls(liveEntityOf(e)) }
function canToggle(e) { return controlsOf(e).some((c) => c.kind === 'toggle') }

function openMore(e) { moreEntityId.value = e.entity_id }

function openDetail(d) {
  detail.value = d
  // 桌面选中；手机端由父级提供给覆盖面板，这里保持选中态
}
function onToggleEntity(e) {
  // 乐观更新：useOptimistic 统一管理（WS 确认 / 8s 超时回退 / 失败回滚）。
  // 不再直接写 entityStates.state——污染真实缓存会与 WS 原地更新互相覆盖，行为不可控；
  // override 是独立 reactive，liveEntities/设备状态计数经 liveEntityOf 天然即时联动。
  // 优先按能力模型取开关服务载荷精确覆盖（空调→目标模式、媒体→播放态…），兜底布尔开态。
  const id = e.entity_id
  const live = liveEntityOf(e)
  const t = buildControls(live).find((c) => c.kind === 'toggle')
  const payload = t ? buildServiceCall(t, null) : null
  if (!(payload && setServiceOptimistic(id, payload.domain, payload.service, payload.data || {}))) {
    setOptimistic(id, !effectiveOn(live))
  }
  api.toggle(store.activeID, id).catch(() => clearOptimistic(id))
}
function noop() {}

// 加载注册表（走全局共享缓存；失败重试两次）
async function load(attempt = 0) {
  if (!store.ready || store.activeID <= 0) return
  loading.value = true
  try {
    await loadRegistry(attempt > 0)
    loadedOnce.value = registryLoaded.value
    if (!registryLoaded.value && attempt < 2) {
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)))
      return load(attempt + 1)
    }
  } finally { loading.value = false }
}

const totalCount = computed(() => devices.value.length)
const onlineCount = computed(() => devices.value.filter(deviceOnline).length)

function onEsc(e) {
  if (e.key !== 'Escape') return
  if (moreEntityId.value) moreEntityId.value = ''
  else if (detail.value && isNarrow.value) detail.value = null
  else close()
}

// 小屏（<1024px）详情为覆盖层，Esc 先返回列表再关抽屉。
const isNarrow = ref(false)
function onResize() { isNarrow.value = window.matchMedia('(max-width: 1023px)').matches }

onMounted(() => {
  document.addEventListener('keydown', onEsc)
  onResize()
  window.addEventListener('resize', onResize)
  refreshEntities()
  load()
})
// 抽屉现在挂在 App 外壳（登录后即挂载），可能早于 store.ready；就绪后补一次加载
watch(() => store.ready, (r) => { if (r) load() })
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEsc)
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.im-fade-enter-active, .im-fade-leave-active { transition: opacity .2s ease; }
.im-fade-enter-from, .im-fade-leave-to { opacity: 0; }
.hc-hide-bar { scrollbar-width: none; -ms-overflow-style: none; }
.hc-hide-bar::-webkit-scrollbar { display: none; }
</style>
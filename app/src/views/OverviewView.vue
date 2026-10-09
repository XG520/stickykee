<template>
  <div class="space-y-5">
    <!-- 页面标题只保留给屏读器（可见标题行占的垂直空间已省掉）；时间范围切换保留并右对齐。
         标题放在本行内部，避免成为 space-y-5 的多余子项而多出一段间距 -->
    <div class="flex items-center justify-end gap-4 flex-wrap">
      <h2 class="sr-only">能耗总览</h2>
      <div class="flex items-center gap-1 p-1 bg-surface rounded-xl border border-border">
        <button
          v-for="r in ranges"
          :key="r"
          @click="activeRange = r"
          :class="[
            'px-3.5 py-1.5 rounded-lg font-body text-xs font-medium transition-all duration-200',
            activeRange === r
              ? 'text-on-background bg-surface-alt border border-border'
              : 'text-muted hover:text-on-surface hover:bg-surface-alt',
          ]"
        >
          {{ r }}
        </button>
      </div>
    </div>

    <!-- Overview Cards（点击打开设备抽屉，按对应条件过滤；温湿度为环境读数，不可点） -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <button class="text-left bg-surface border border-border rounded-2xl p-4 transition-colors duration-200 hover:border-primary/50" @click="openDeviceDrawer('power')" title="点击查看有功耗的设备">
        <div class="flex items-center justify-between mb-3">
          <div class="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
            <span class="material-symbols-outlined text-primary text-lg">bolt</span>
          </div>
        </div>
        <p class="font-headline text-on-background font-semibold text-2xl leading-none">{{ hasData ? totalPowerKW.toFixed(2) : '—' }}<span class="text-base font-normal text-muted ml-1">kW</span></p>
        <p class="text-muted font-body text-sm mt-1">当前功率</p>
      </button>

      <button class="text-left bg-surface border border-border rounded-2xl p-4 transition-colors duration-200 hover:border-primary/50" @click="openDeviceDrawer('active')" title="点击查看开启中的设备">
        <div class="flex items-center justify-between mb-3">
          <div class="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <span class="material-symbols-outlined text-accent text-lg">devices</span>
          </div>
        </div>
        <p class="font-headline text-on-background font-semibold text-2xl leading-none">{{ activeDeviceCount }}<span class="text-base font-normal text-muted ml-1">台</span></p>
        <p class="text-muted font-body text-sm mt-1">设备开启</p>
      </button>

      <button class="text-left bg-surface border border-border rounded-2xl p-4 transition-colors duration-200 hover:border-primary/50" @click="openDeviceDrawer('all')" title="点击查看全部设备">
        <div class="flex items-center justify-between mb-3">
          <div class="w-9 h-9 rounded-xl bg-info/15 flex items-center justify-center">
            <span class="material-symbols-outlined text-info text-lg">category</span>
          </div>
        </div>
        <p class="font-headline text-on-background font-semibold text-2xl leading-none">{{ all.length }}<span class="text-base font-normal text-muted ml-1">台</span></p>
        <p class="text-muted font-body text-sm mt-1">接入实体</p>
      </button>

      <div class="bg-surface border border-border rounded-2xl p-4 transition-colors duration-200">
        <div class="flex items-center justify-between mb-3">
          <div class="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
            <span class="material-symbols-outlined text-success text-lg">thermostat</span>
          </div>
        </div>
        <p class="font-headline text-on-background font-semibold text-2xl leading-none">{{ indoorTemp != null ? indoorTemp + '°' : '—' }}<span v-if="indoorHumidity != null" class="text-base font-normal text-muted ml-1">{{ indoorHumidity }}%</span></p>
        <p class="text-muted font-body text-sm mt-1">室内温湿度</p>
      </div>
    </div>

    <!-- Main Chart + Rooms -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- 实时功耗分布 -->
      <div class="lg:col-span-2 bg-surface border border-border rounded-2xl p-5">
        <div class="flex items-center justify-between mb-5">
          <div>
            <h3 class="font-headline text-on-background font-semibold text-base">实时功耗分布</h3>
            <p class="text-muted font-body text-sm mt-0.5">按设备 current_power_w 实时排序</p>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-0.5 rounded-full bg-primary"></span>
            <span class="text-muted font-body text-xs">设备功率</span>
          </div>
        </div>
        <template v-if="powerDevices.length">
          <div class="flex items-end justify-between gap-2 h-48 px-2">
            <div v-for="b in powerDevices" :key="b._entity" class="flex flex-col items-center gap-2 flex-1 min-w-0" :title="b.name + ' · ' + b.kw.toFixed(2) + ' kW'">
              <div class="w-full max-w-[40px] bg-surface rounded-t-lg border border-border relative overflow-hidden" :style="{ height: b.height }">
                <div class="absolute bottom-0 left-0 right-0 rounded-t-lg bg-primary transition-all" :style="{ height: b.height }"></div>
              </div>
              <span class="text-xs font-body text-muted truncate w-full text-center">{{ b.name }}</span>
            </div>
          </div>
        </template>
        <p v-else class="py-10 text-center text-muted font-body text-sm">暂无功耗数据</p>
      </div>

      <!-- Room Energy -->
      <div class="bg-surface border border-border rounded-2xl p-5">
        <div class="flex items-center justify-between mb-5">
          <div>
            <h3 class="font-headline text-on-background font-semibold text-base">房间能耗分布</h3>
            <p class="text-muted font-body text-sm mt-0.5">按 area 聚合功耗占比</p>
          </div>
          <span class="material-symbols-outlined text-muted text-lg">house</span>
        </div>
        <template v-if="rooms.length">
          <div class="space-y-2.5">
            <div v-for="room in rooms" :key="room.name" class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full" :class="room.dot"></span>
                <span class="text-on-surface font-body text-sm">{{ room.name }}</span>
              </div>
              <span class="text-on-background font-headline text-sm font-semibold">{{ room.percent }}</span>
            </div>
          </div>
        </template>
        <p v-else class="py-10 text-center text-muted font-body text-sm">暂无房间能耗数据</p>
      </div>
    </div>

    <!-- Device Ranking -->
    <div class="bg-surface border border-border rounded-2xl p-5">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="font-headline text-on-background font-semibold text-base">设备功耗排行</h3>
          <p class="text-muted font-body text-sm mt-0.5">按实时功耗从高到低排序</p>
        </div>
      </div>
      <template v-if="devices.length">
        <div class="space-y-3">
          <div
            v-for="d in devices"
            :key="d._entity"
            class="flex items-center gap-4 p-3 rounded-xl border transition-colors duration-200"
            :class="d.top ? 'bg-surface-alt/60 border-border/60' : 'bg-surface-alt/30 border-border/30'"
          >
            <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" :class="d.iconBg">
              <span class="material-symbols-outlined text-lg" :class="d.iconColor">{{ d.icon }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-on-background font-body text-sm font-semibold truncate">{{ d.name }}</span>
                <span v-if="d.top" class="px-1.5 py-0.5 rounded bg-primary/15 text-primary font-body text-[10px] font-semibold">TOP</span>
              </div>
              <div class="mt-1.5 h-1.5 bg-surface rounded-full overflow-hidden">
                <div class="h-full rounded-full" :class="d.barColor" :style="{ width: d.width }"></div>
              </div>
            </div>
            <div class="text-right flex-shrink-0">
              <p class="font-headline text-on-background font-semibold text-base">{{ d.kw.toFixed(2) }} <span class="text-xs font-normal text-muted">kW</span></p>
              <div class="flex items-center justify-end gap-1 mt-0.5">
                <span class="text-muted font-body text-xs">{{ d.percent }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <p v-else class="py-8 text-center text-muted font-body text-sm">暂无功耗数据</p>
    </div>

    <!-- Quick Stats -->
    <div class="bg-surface border border-border rounded-2xl p-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div v-for="s in stats" :key="s.label" class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" :class="s.iconBg">
            <span class="material-symbols-outlined text-sm" :class="s.iconColor">{{ s.icon }}</span>
          </div>
          <div>
            <p class="text-muted font-body text-xs">{{ s.label }}</p>
            <p class="font-headline text-on-background font-semibold text-base" v-html="s.value"></p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, backendOnline, entityStates, refreshEntities, onEntityChange, registryDevices, loadRegistry, openDeviceDrawer } from '@/store'
import { iconFor, isOn, attr, numVal, powerOf, totalPower } from '@/utils/entities'

const ranges = ['今日', '本周', '本月', '自定义']
const activeRange = ref('今日')

const all = computed(() => Object.values(entityStates))
const hasData = computed(() => backendOnline.value && all.value.length > 0)
const onCount = computed(() => (hasData.value ? all.value.filter((e) => isOn(e)).length : 0))
// 开启中的「设备」数：至少一个未禁用实体处于开启态（与设备抽屉 active 过滤同口径）
const activeDeviceCount = computed(() => registryDevices.value.filter((d) =>
  (d.entities || []).some((e) => {
    if (e.disabled) return false
    const live = entityStates[e.entity_id]
    return isOn({ state: live && live.state !== undefined ? live.state : e.state, domain: e.domain })
  }))).length

const totalPowerW = computed(() => totalPower(all.value))
const totalPowerKW = computed(() => totalPowerW.value / 1000)

const indoorTemp = computed(() => {
  if (!hasData.value) return null
  const c = all.value.find((e) => e.domain === 'climate')
  const t = c && numVal(attr(c, 'current_temperature'))
  if (t != null) return Math.round(t)
  const s = all.value.find((e) => (e.device_class || '').toLowerCase().includes('temperature') && numVal(e.state) != null)
  return s ? Math.round(numVal(s.state)) : null
})
const indoorHumidity = computed(() => {
  if (!hasData.value) return null
  const s = all.value.find((e) => (e.device_class || '').toLowerCase().includes('humidity') && numVal(e.state) != null)
  return s ? Math.round(numVal(s.state)) : null
})

// 实时功耗分布（柱状条）
const powerDevices = computed(() => {
  const list = (hasData.value ? all.value.filter((e) => powerOf(e) != null && powerOf(e) > 0) : [])
    .map((e) => ({ name: e.friendly_name || e.entity_id, _entity: e.entity_id, kw: powerOf(e) / 1000 }))
    .sort((a, b) => b.kw - a.kw)
    .slice(0, 6)
  const max = list.length ? Math.max(...list.map((x) => x.kw)) : 1
  return list.map((b) => ({ ...b, height: Math.max(8, Math.round((b.kw / max) * 100)) + '%' }))
})

// 房间能耗分布（按 area 聚合）
const roomDots = ['bg-primary', 'bg-accent', 'bg-info', 'bg-warning', 'bg-faint']
const rooms = computed(() => {
  if (!hasData.value) return []
  const areas = new Map()
  for (const e of all.value) {
    const p = powerOf(e)
    if (p == null || p === 0) continue
    const area = (e.area && e.area.trim()) || '其他'
    areas.set(area, (areas.get(area) || 0) + p)
  }
  const total = [...areas.values()].reduce((a, b) => a + b, 0)
  if (!total) return []
  return [...areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, val], i) => ({ name, percent: Math.round((val / total) * 100) + '%', dot: roomDots[i % 5], _kw: (val / 1000).toFixed(2) }))
})

// 设备功耗排行
function glyphFor(e) {
  switch (e.domain) {
    case 'light': return 'lightbulb'
    case 'climate': return 'ac_unit'
    case 'cover': return 'curtains'
    case 'switch': case 'plug': return 'power'
    case 'media_player': return 'tv'
    default: return 'widgets'
  }
}
const devices = computed(() => {
  const list = (hasData.value ? all.value.filter((e) => powerOf(e) != null && powerOf(e) > 0) : [])
    .map((e) => ({ name: e.friendly_name || e.entity_id, _entity: e.entity_id, w: powerOf(e), e }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 5)
  const max = list.length ? Math.max(...list.map((x) => x.w)) : 1
  const sum = list.reduce((s, x) => s + x.w, 0) || 1
  const colors = ['bg-primary', 'bg-accent', 'bg-info', 'bg-warning', 'bg-faint']
  return list.map((r, i) => ({
    name: r.name,
    _entity: r._entity,
    top: i === 0,
    icon: iconFor(r.e, glyphFor(r.e)),
    iconBg: colors[i] + '/15',
    iconColor: 'text-' + colors[i].replace('bg-', ''),
    width: Math.max(6, Math.round((r.w / max) * 100)) + '%',
    barColor: colors[i],
    kw: r.w / 1000,
    percent: Math.round((r.w / sum) * 100) + '%',
  }))
})

const stats = computed(() => [
  { icon: 'bolt', iconBg: 'bg-primary/10', iconColor: 'text-primary', label: '当前功率', value: hasData.value ? `${totalPowerKW.value.toFixed(2)} kW` : '—' },
  { icon: 'devices', iconBg: 'bg-accent/10', iconColor: 'text-accent', label: '设备在线', value: `${onCount.value} 台` },
  { icon: 'thermostat', iconBg: 'bg-info/10', iconColor: 'text-info', label: '室内温度', value: indoorTemp.value != null ? `${indoorTemp.value}°C` : '—' },
  { icon: 'water_drop', iconBg: 'bg-warning/10', iconColor: 'text-warning', label: '室内湿度', value: indoorHumidity.value != null ? `${indoorHumidity.value}%` : '—' },
])

let off = null
onMounted(async () => {
  if (store.ready && store.activeID > 0) { await refreshEntities(store.activeID); loadRegistry() }
  off = onEntityChange(() => {})
})
</script>
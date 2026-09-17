<template>
  <div class="flex flex-col h-full">
    <!-- 工具条 -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-primary text-xl">map</span>
        <h3 class="font-headline font-semibold text-on-background text-base">{{ title }}</h3>
      </div>
      <div class="flex items-center gap-2">
        <slot name="actions">
          <button
            @click="fitView"
            class="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs text-on-surface transition-colors flex items-center gap-1"
            title="聚焦家的范围与所有成员"
          >
            <span class="material-symbols-outlined text-base">center_focus</span>
          </button>
        </slot>
        <button
          @click="refreshLocation"
          :disabled="locating"
          class="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-60"
        >
          <span v-if="locating" class="w-3.5 h-3.5 border-2 border-on-primary/40 border-t-on-primary rounded-full animate-spin"></span>
          <span v-else class="material-symbols-outlined text-base">my_location</span>
          {{ locating ? '定位中…' : '更新位置' }}
        </button>
      </div>
    </div>

    <!-- 未配置 Key 引导 -->
    <div v-if="!configured" class="flex-1 min-h-[260px] flex flex-col items-center justify-center text-center gap-3 rounded-xl bg-surface border border-dashed border-border">
      <span class="material-symbols-outlined text-4xl text-faint">map</span>
      <div>
        <p class="text-on-surface text-sm font-medium">尚未配置高德地图 Key</p>
        <p class="text-muted text-xs mt-1 max-w-[280px]">请在「设置 → 高德地图」中填入你的高德 Web 端 Key，即可查看家的范围、家人位置并刷新定位。</p>
      </div>
      <router-link to="/settings" class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">
        前往设置
      </router-link>
    </div>

    <!-- 地图容器 -->
    <div v-show="configured" class="map-shell w-full rounded-xl overflow-hidden relative bg-surface"
      :style="{ height: height === 'flex' ? undefined : height, flex: height === 'flex' ? '1 1 auto' : undefined, minHeight: height === 'flex' ? 0 : undefined }">
      <div ref="mapEl" class="w-full h-full"></div>
      <div v-if="mapStatus !== 'ready'" class="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center text-sm font-body text-muted">
        <span v-if="mapStatus === 'loading'" class="flex items-center gap-2">
          <span class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span> 地图加载中…
        </span>
        <span v-else-if="mapStatus === 'error'" class="text-error">{{ mapError }}</span>
      </div>
    </div>

    <!-- 状态栏 -->
    <div class="flex items-center gap-2 mt-3 text-xs font-body">
      <span class="material-symbols-outlined text-base" :class="statusOk ? 'text-success' : 'text-muted'">{{ statusIcon }}</span>
      <span class="text-muted min-w-0 break-words">{{ statusText }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { store } from '@/store'
import { loadAMap } from '@/utils/amap'
import { syncCurrentLocation } from '@/utils/location'
import { wgs84ToGcj02 } from '@/utils/gcj02'
import { usePersonMarkers, useZones } from '@/composables/useLive'

// HA / 浏览器定位都是 WGS-84，放置到高德时转换为 GCJ-02。
const gcjPt = (lng, lat) => { const p = wgs84ToGcj02(lng, lat); return [p.lng, p.lat] }

const props = defineProps({
  title: { type: String, default: '地图定位' },
  height: { type: String, default: '320px' },
})

const markers = usePersonMarkers()
const zones = useZones()
const mapEl = ref(null)

const cfg = ref({ amap_key: '', dev_id: 'homecanvas', location_name: '', sync_target: '' })
const configured = computed(() => !!cfg.value.amap_key)

const mapStatus = ref('idle')
const mapError = ref('')
const locating = ref(false)

const statusText = ref('等待定位')
const statusOk = ref(true)
const statusIcon = computed(() => (statusOk.value ? 'location_on' : 'location_off'))

let map = null
let personMarks = [] // 成员标记
let homeMark = null // 家的标记
let circles = [] // 家的范围圆
let myMarker = null

async function loadConfig() {
  try {
    const { data } = await api.getPrefs()
    let mc = {}
    if (data?.map_config) { try { mc = JSON.parse(data.map_config) } catch {} }
    cfg.value = {
      amap_key: (mc.amap_key || '').trim(),
      dev_id: mc.dev_id || 'homecanvas',
      location_name: mc.location_name || '',
      sync_target: mc.sync_target || '',
    }
  } catch { /* 后端离线静默 */ }
}

function avatarHTML(mk) {
  const pic = mk.picture ? api.pictureUrl(store.activeID, mk.entity_id) : ''
  const initial = (mk.name || '?').slice(0, 1)
  const bg = mk.away ? '#94a3b8' : '#22c55e'
  const img = pic ? `<img src="${pic}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">` : ''
  return `<div style="width:38px;height:38px;border-radius:50%;overflow:hidden;border:2px solid #fff;background:${bg};box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:600;font-size:16px;position:relative">${img}<span style="position:relative;z-index:0">${initial}</span></div>`
}

const homeZone = computed(() => zones.value.find((z) => z.home) || zones.value[0] || null)

function fitView() {
  if (!map) return
  const all = personMarks.slice()
  if (homeMark) all.push(homeMark)
  if (myMarker) all.push(myMarker)
  if (all.length) { map.setFitView(all, false, [60, 60, 60, 60]); return }
  const hz = homeZone.value
  if (hz) { map.setCenter([hz.lng, hz.lat]); map.setZoom(13) }
}

async function initMap() {
  if (!configured.value || mapStatus.value === 'ready') return
  mapStatus.value = 'loading'
  try {
    const AMap = await loadAMap(cfg.value.amap_key)
    map = new AMap.Map(mapEl.value, { zoom: 12 })
    new AMap.Scale({ offset: new AMap.Pixel(10, 10) }).addTo(map)
    mapStatus.value = 'ready'
    renderHome()
    renderMarkers()
    fitView()
  } catch (e) {
    mapStatus.value = 'error'
    mapError.value = e.message
  }
}

// 家的位置标记 + 范围圆（与 HA zone 一致）。
function renderHome() {
  if (!map || mapStatus.value !== 'ready') return
  circles.forEach((c) => { try { c.remove() } catch {} }); circles = []
  if (homeMark) { try { homeMark.remove() } catch {} homeMark = null }
  const AMap = window.AMap
  zones.value.forEach((z) => {
    const circle = new AMap.Circle({
      center: gcjPt(z.lng, z.lat),
      radius: z.radius || 100,
      strokeColor: z.home ? '#F59E0B' : '#38bdf8',
      strokeWeight: 2,
      strokeOpacity: 0.9,
      strokeStyle: 'dashed',
      fillColor: z.home ? '#F59E0B' : '#38bdf8',
      fillOpacity: 0.08,
    })
    map.add(circle)
    circles.push(circle)
  })
  if (homeZone.value) {
    const m = new AMap.Marker({
      position: gcjPt(homeZone.value.lng, homeZone.value.lat),
      title: homeZone.value.name,
      content: '<div style="background:#F59E0B;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">🏠</div>',
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, -2),
    })
    m.on('click', () => {
      statusOk.value = true
      statusText.value = `${homeZone.value.name}（半径 ${homeZone.value.radius} 米）`
    })
    m.addTo(map)
    homeMark = m
  }
}

function renderMarkers() {
  if (!map || mapStatus.value !== 'ready') return
  personMarks.forEach((m) => { try { m.remove() } catch {} })
  personMarks = []
  markers.value.forEach((mk) => {
    const m = new AMap.Marker({
      position: gcjPt(mk.lng, mk.lat),
      title: mk.name,
      content: avatarHTML(mk),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, -2),
    })
    m.on('click', () => {
      statusOk.value = true
      statusText.value = `${mk.name} · ${mk.away ? '离家' : '在家'} · ${mk.location}`
    })
    m.addTo(map)
    personMarks.push(m)
  })
}

async function refreshLocation() {
  if (!configured.value) return
  locating.value = true
  statusOk.value = true
  statusText.value = '正在定位并同步…'
  try {
    const mc = cfg.value
    const target = mc.sync_target || ''
    // 同步到当前设备自己的 tracker（别名），可选同时同步到关联的家人。
    const res = await syncCurrentLocation(target)
    updateMyMarker(res.lat, res.lng, res.name || '当前设备')
    statusOk.value = true
    statusText.value = res.address ? `${res.name} 位置已同步：${res.address}` : `${res.name} 位置已同步（device_tracker.${res.dev_id}）`
  } catch (e) {
    statusOk.value = false
    statusText.value = e.message || '位置同步失败（请确认已连接 Home Assistant 并允许定位）'
  } finally {
    locating.value = false
  }
}

function updateMyMarker(lat, lng, name) {
  if (!map) return
  const AMap = window.AMap
  const [gLng, gLat] = gcjPt(lng, lat)
  if (!myMarker) {
    myMarker = new AMap.Marker({
      position: [gLng, gLat],
      content: '<div style="width:20px;height:20px;border-radius:50%;background:#6366f1;border:3px solid #fff;box-shadow:0 0 0 6px rgba(99,102,241,.25)"></div>',
      anchor: 'center',
    })
    myMarker.addTo(map)
  } else myMarker.setPosition([gLng, gLat])
  myMarker.setLabel({ content: name || '当前设备', direction: 'top' })
  map.setZoomAndCenter(15, [gLng, gLat])
}

const stopA = watch(markers, () => { renderMarkers(); fitView() }, { deep: true })
const stopB = watch(zones, () => { renderHome(); fitView() }, { deep: true })

onUnmounted(() => {
  stopA(); stopB()
  if (myMarker) { try { myMarker.remove() } catch {} }
  if (homeMark) { try { homeMark.remove() } catch {} }
  personMarks.forEach((m) => { try { m.remove() } catch {} })
  circles.forEach((c) => { try { c.remove() } catch {} })
  if (map) { try { map.destroy() } catch {} }
  map = null; personMarks = []; homeMark = null; circles = []; myMarker = null
})

onMounted(async () => {
  await loadConfig()
  if (configured.value) initMap()
})
</script>

<style scoped>
/* 高德 SDK 注入的 Logo / 版权元素默认 z-index 极高，会盖在卡片内容上层；
   此处压低层级并缩小淡化，保留合规标识但不干扰内容。 */
.map-shell :deep(.amap-logo) {
  left: 4px !important;
  bottom: 4px !important;
  z-index: 10 !important;
  opacity: 0.55;
  transform: scale(0.8);
  transform-origin: left bottom;
}
.map-shell :deep(.amap-copyright) {
  z-index: 10 !important;
  opacity: 0.45;
  font-size: 10px !important;
}
</style>
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
    <div v-show="configured" class="map-shell w-full overflow-hidden relative bg-surface"
      :class="flat ? '' : 'rounded-xl'"
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
import { ref, computed, watch, onMounted, onUnmounted, onActivated } from 'vue'
import api from '@/api'
import { store } from '@/store'
import { loadAMap } from '@/utils/amap'
import { getPrefs } from '@/utils/prefs'
import { syncCurrentLocation } from '@/utils/location'
import { wgs84ToGcj02 } from '@/utils/gcj02'
import { usePersonMarkers, useZones } from '@/composables/useLive'

// HA / 浏览器定位都是 WGS-84，放置到高德时转换为 GCJ-02。
const gcjPt = (lng, lat) => { const p = wgs84ToGcj02(lng, lat); return [p.lng, p.lat] }

const props = defineProps({
  title: { type: String, default: '地图定位' },
  height: { type: String, default: '320px' },
  // flat：去掉容器圆角（全幅页面用，圆角会切掉贴边的地图四角）
  flat: { type: Boolean, default: false },
})

const markers = usePersonMarkers()
const zones = useZones()
const mapEl = ref(null)

const cfg = ref({ amap_key: '' })
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
const personMarkMap = new Map() // entity_id -> marker，用于增量更新
let firstFitDone = false // 首次有数据后自动 fitView 一次，之后不再自动重置缩放

async function loadConfig() {
  try {
    const { data } = await getPrefs()
    let mc = {}
    if (data?.map_config) { try { mc = JSON.parse(data.map_config) } catch {} }
    cfg.value = {
      amap_key: (mc.amap_key || '').trim(),
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
  const AMap = window.AMap
  const seen = new Set()
  markers.value.forEach((mk) => {
    const pos = gcjPt(mk.lng, mk.lat)
    let m = personMarkMap.get(mk.entity_id)
    if (m) {
      // 已存在：只更新位置与外观，不重建（避免标记闪烁）
      m.setPosition(pos)
      m.setContent(avatarHTML(mk))
      m.setExtData(mk)
    } else {
      m = new AMap.Marker({
        position: pos,
        title: mk.name,
        content: avatarHTML(mk),
        anchor: 'bottom-center',
        offset: new AMap.Pixel(0, -2),
      })
      m.setExtData(mk)
      m.on('click', () => {
        const d = m.getExtData() || mk
        statusOk.value = true
        statusText.value = `${d.name} · ${d.away ? '离家' : '在家'} · ${d.location}`
      })
      m.addTo(map)
      personMarkMap.set(mk.entity_id, m)
    }
    seen.add(mk.entity_id)
  })
  // 移除不再存在的成员
  for (const [id, m] of personMarkMap) {
    if (!seen.has(id)) {
      try { m.remove() } catch {}
      personMarkMap.delete(id)
    }
  }
  personMarks = Array.from(personMarkMap.values())
}

async function refreshLocation() {
  if (!configured.value) return
  locating.value = true
  statusOk.value = true
  statusText.value = '正在定位并同步…'
  try {
    // 经 HA 官方 mobile_app webhook 上报本机定位，HA 自动绑定到该注册设备的 device_tracker。
    const res = await syncCurrentLocation()
    updateMyMarker(res.lat, res.lng, res.name || '当前设备')
    statusOk.value = true
    statusText.value = res.address ? `${res.name} 位置已同步：${res.address}` : `${res.name} 位置已同步`
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

// 首次拿到数据后自动 fitView 一次；之后用户手动缩放/拖动不被打断。
// 实时数据更新只增量刷新标记位置，不再重置视图（避免"放大后自动缩小"）。
function maybeFit() {
  if (firstFitDone) return
  if (personMarks.length || homeMark || zones.value.length) {
    fitView()
    firstFitDone = true
  }
}
const stopA = watch(markers, () => { renderMarkers(); maybeFit() }, { deep: true })
const stopB = watch(zones, () => { renderHome(); maybeFit() }, { deep: true })

onUnmounted(() => {
  stopA(); stopB()
  if (myMarker) { try { myMarker.remove() } catch {} }
  if (homeMark) { try { homeMark.remove() } catch {} }
  personMarkMap.forEach((m) => { try { m.remove() } catch {} })
  personMarkMap.clear()
  personMarks = []
  circles.forEach((c) => { try { c.remove() } catch {} })
  if (map) { try { map.destroy() } catch {} }
  map = null; homeMark = null; circles = []; myMarker = null; firstFitDone = false
})

onMounted(async () => {
  await loadConfig()
  if (configured.value) initMap()
})

// keep-alive 缓存的页面重新激活：容器尺寸可能已随窗口变化，通知地图重算
onActivated(() => { try { map?.resize?.() } catch { /* 忽略 */ } })
</script>

<style scoped>
/* 隐藏高德 SDK 注入的「高德地图」Logo 文字（按需求完全隐藏）。 */
.map-shell :deep(.amap-logo) {
  display: none !important;
}
/* 版权标识压低层级并缩小淡化，保留但不干扰内容。 */
.map-shell :deep(.amap-copyright) {
  z-index: 10 !important;
  opacity: 0.45;
  font-size: 10px !important;
}
</style>
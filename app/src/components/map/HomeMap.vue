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
            @click="toggleRoutePanel"
            class="px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs text-on-surface transition-colors flex items-center gap-1"
            title="路线规划（驾车/骑行/公交/步行）"
          >
            <span class="material-symbols-outlined text-base">route</span>
          </button>
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

      <!-- 路线规划面板：浮在地图上方。起点=我的位置（未定位自动定位），终点=家（默认）或地图点选；
           驾车/骑行/公交/步行四种方式，经高德 JS 插件画线并展示距离与耗时 -->
      <div v-if="configured && routePanel"
        class="absolute left-3 right-3 top-3 z-10 rounded-xl bg-surface-alt/95 backdrop-blur-md border border-border shadow-lg p-3">
        <div class="flex items-center gap-2 mb-2">
          <span class="material-symbols-outlined text-primary text-lg">route</span>
          <p class="flex-1 text-sm font-semibold text-on-surface">路线规划</p>
          <button @click="toggleRoutePanel" class="w-10 h-10 rounded-lg flex items-center justify-center text-muted hover:text-on-surface hover:bg-primary/10 transition-colors" title="收起">
            <span class="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div class="flex items-center gap-1.5 mb-2 flex-wrap">
          <button v-for="m in routeModes" :key="m.key" @click="setRouteMode(m.key)"
            class="h-9 px-2.5 rounded-lg text-xs flex items-center gap-1 border transition-colors"
            :class="routeMode === m.key ? 'bg-primary text-on-primary border-primary font-semibold' : 'bg-surface border-border text-muted hover:text-on-surface'">
            <span class="material-symbols-outlined text-base">{{ m.icon }}</span>{{ m.label }}
          </button>
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted mb-2 min-w-0">
          <span class="material-symbols-outlined text-base text-primary shrink-0">trip_origin</span>
          <span class="shrink-0">我的位置</span>
          <button @click="togglePickEnd" class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
            :class="pickEnd ? 'text-primary bg-primary/10' : 'text-muted hover:text-on-surface hover:bg-primary/10'"
            :title="pickEnd ? '取消选点' : '在地图上点选终点'">
            <span class="material-symbols-outlined text-base">{{ pickEnd ? 'close' : 'adjust' }}</span>
          </button>
          <span class="material-symbols-outlined text-base text-amber-500 shrink-0">place</span>
          <button @click="resetEnd" class="min-w-0 truncate hover:text-on-surface transition-colors"
            :title="endPt ? '点击恢复终点为家' : '终点'">
            {{ endPt ? '地图选点（点此恢复为家）' : (homeZone?.name || '家') }}
          </button>
        </div>
        <button @click="planRoute" :disabled="routeLoading || pickEnd"
          class="w-full h-10 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60">
          <span v-if="routeLoading" class="w-4 h-4 border-2 border-on-primary/40 border-t-on-primary rounded-full animate-spin"></span>
          <span v-else class="material-symbols-outlined text-base">navigation</span>
          {{ pickEnd ? '在地图上点击选择终点' : (routeLoading ? '规划中…' : '重新规划') }}
        </button>
        <p v-if="routeSummary" class="text-xs text-on-surface font-medium mt-2">{{ routeSummary }}</p>
        <p v-if="routeError" class="text-xs text-error mt-2 break-words">{{ routeError }}</p>
      </div>
      <div v-if="mapStatus !== 'ready'" class="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center text-sm font-body text-muted p-6">
        <span v-if="mapStatus === 'loading'" class="flex items-center gap-2">
          <span class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span> 地图加载中…
        </span>
        <div v-else-if="mapStatus === 'error'" class="flex flex-col items-center gap-3 text-center">
          <span class="material-symbols-outlined text-3xl text-error">map</span>
          <span class="text-error break-words max-w-[320px]">{{ mapError }}</span>
          <div class="flex items-center gap-2">
            <button
              class="px-3.5 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold"
              @click="retryMap"
            >重试</button>
            <router-link
              to="/settings"
              class="px-3.5 py-1.5 rounded-lg border border-border text-xs text-muted"
            >检查地图 Key</router-link>
          </div>
        </div>
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
import { isCapDevice, locateOnly, syncCurrentLocation, locErrorMessage } from '@/utils/location'
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
  mapError.value = ''
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

// 加载失败后手动/切页重试：销毁残留地图实例，重新读配置并加载 SDK
async function retryMap() {
  if (map) { try { map.destroy() } catch { /* 忽略 */ } }
  map = null
  personMarkMap.forEach((m) => { try { m.remove() } catch { /* 忽略 */ } })
  personMarkMap.clear()
  personMarks = []
  circles.forEach((c) => { try { c.remove() } catch { /* 忽略 */ } })
  circles = []
  homeMark = null
  myMarker = null
  firstFitDone = false
  mapStatus.value = 'idle'
  await loadConfig()
  if (configured.value) initMap()
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
  myGCJ = gcjPt(lng, lat) // 同步记录 GCJ-02 坐标，供路线规划作起点
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

// ---- 路线规划（驾车/骑行/公交/步行）：高德 JS 插件画线，起点=我的位置，终点=家/地图选点 ----
const routeModes = [
  { key: 'driving', icon: 'directions_car', label: '驾车' },
  { key: 'riding', icon: 'directions_bike', label: '骑行' },
  { key: 'transfer', icon: 'directions_bus', label: '公交' },
  { key: 'walking', icon: 'directions_walk', label: '步行' },
]
const ROUTE_PLUGINS = { driving: 'AMap.Driving', riding: 'AMap.Riding', transfer: 'AMap.Transfer', walking: 'AMap.Walking' }
const routePanel = ref(false)
const routeMode = ref('driving')
const routeLoading = ref(false)
const routeSummary = ref('')
const routeError = ref('')
const pickEnd = ref(false)
const endPt = ref(null) // {lng,lat}（GCJ-02）；null=终点为家
let routePlanner = null
let myGCJ = null // 当前设备位置（GCJ-02），updateMyMarker 时同步
let routeCity = '' // 公交规划用起点城市缓存

const routeModeLabel = () => routeModes.find((m) => m.key === routeMode.value)?.label || ''

function fmtDist(m) {
  if (m == null) return ''
  return m < 1000 ? `${Math.round(m)} 米` : `${(m / 1000).toFixed(1)} 公里`
}

function fmtDur(s) {
  if (s == null) return ''
  const min = Math.round(s / 60)
  return min < 60 ? `${min} 分钟` : `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`
}

function clearRoute() {
  if (routePlanner) { try { routePlanner.clear() } catch { /* 忽略 */ } }
  routeSummary.value = ''
  routeError.value = ''
}

function toggleRoutePanel() {
  routePanel.value = !routePanel.value
  if (routePanel.value) planRoute()
  else stopPickEnd(false) // 收起时取消选点模式，但保留已选终点
}

function stopPickEnd(clearFlag) {
  if (map) map.off('click', onMapPickEnd)
  pickEnd.value = false
  if (clearFlag) endPt.value = null
}

function onMapPickEnd(e) {
  stopPickEnd(false)
  if (!e?.lnglat) return
  endPt.value = { lng: e.lnglat.getLng(), lat: e.lnglat.getLat() }
  planRoute()
}

function togglePickEnd() {
  if (!map) return
  if (pickEnd.value) { stopPickEnd(false); return }
  pickEnd.value = true
  statusOk.value = true
  statusText.value = '请在地图上点击选择终点'
  map.on('click', onMapPickEnd)
}

function resetEnd() {
  endPt.value = null
  planRoute()
}

// 起点所在城市（公交规划必需）：Geocoder 逆地理取 city，直辖市 city 为空时退回 province。
function routeCityOf(lngLat) {
  if (routeCity) return Promise.resolve(routeCity)
  return new Promise((resolve) => {
    window.AMap.plugin('AMap.Geocoder', () => {
      try {
        new window.AMap.Geocoder().getAddress(lngLat, (status, result) => {
          if (status !== 'complete' || !result?.regeocode) return resolve('')
          const comp = result.regeocode.addressComponent || {}
          let c = comp.city
          if (Array.isArray(c) || !c) c = comp.province || ''
          routeCity = c
          resolve(c)
        })
      } catch { resolve('') }
    })
  })
}

function setRouteMode(key) {
  if (routeMode.value === key) return
  routeMode.value = key
  planRoute()
}

async function planRoute() {
  if (!map || mapStatus.value !== 'ready' || routeLoading.value || pickEnd.value) return
  const AMap = window.AMap
  // 起点：我的位置（未定位则先定位一次）。
  // APP 端原生卫星定位精度高，定位即上报 HA（对齐官方 App，device_tracker 实时更新）；
  // Web 端浏览器定位精度差（Wi-Fi 级常漂出 zone），不上报以免把在家用户误判为离家。
  if (!myGCJ) {
    try {
      const res = isCapDevice() ? await syncCurrentLocation() : await locateOnly()
      updateMyMarker(res.lat, res.lng, res.name || '当前设备')
    } catch (e) {
      routeError.value = '无法获取当前位置：' + locErrorMessage(e)
      return
    }
  }
  // 终点：地图选点（已是 GCJ-02）或家（WGS-84 需转换）
  let endGCJ = null
  if (endPt.value) endGCJ = [endPt.value.lng, endPt.value.lat]
  else if (homeZone.value) endGCJ = gcjPt(homeZone.value.lng, homeZone.value.lat)
  if (!endGCJ) {
    routeError.value = '没有可用的终点（未找到家的位置）'
    return
  }

  routeLoading.value = true
  routeError.value = ''
  routeSummary.value = ''
  clearRoute()
  try {
    const pluginName = ROUTE_PLUGINS[routeMode.value]
    await new Promise((r) => AMap.plugin(pluginName, () => r()))
    const Ctor = AMap[pluginName.split('.')[1]]
    const opts = { map }
    if (routeMode.value === 'transfer') {
      const city = await routeCityOf(myGCJ)
      if (!city) {
        routeError.value = '无法识别起点所在城市，公交规划失败'
        return
      }
      opts.city = city
    }
    routePlanner = new Ctor(opts)
    const o = new AMap.LngLat(myGCJ[0], myGCJ[1])
    const d = new AMap.LngLat(endGCJ[0], endGCJ[1])
    await new Promise((resolve) => {
      routePlanner.search(o, d, (status, result) => {
        if (status !== 'complete' || !result) {
          routeError.value = `${routeModeLabel()}路线规划失败（${result?.info || status}）`
          return resolve()
        }
        const seg = result.routes?.[0] || result.plans?.[0]
        if (!seg) {
          routeError.value = '未找到可用路线'
          return resolve()
        }
        routeSummary.value = `${fmtDist(seg.distance)} · 约 ${fmtDur(seg.time)}`
        statusOk.value = true
        statusText.value = `${routeModeLabel()}路线：${fmtDist(seg.distance)} · 约 ${fmtDur(seg.time)}`
        try { if (seg.bounds || result.bounds) map.setBounds(seg.bounds || result.bounds) } catch { /* 忽略 */ }
        resolve()
      })
    })
  } finally {
    routeLoading.value = false
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

// keep-alive 缓存的页面重新激活：失败态自动重试一次；已就绪则通知地图重算尺寸
onActivated(() => {
  if (configured.value && mapStatus.value === 'error') { retryMap(); return }
  try { map?.resize?.() } catch { /* 忽略 */ }
})
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
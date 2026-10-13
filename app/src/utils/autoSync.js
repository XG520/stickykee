// 自动同步：进入应用（登录态）即常驻运行，无需手动操作。
// 1) 自动定位：周期上报浏览器坐标到该设备的 device_tracker（HA 依据家 zone 判定在家/离家）。
//    受「设备追踪开关」控制（utils/location.js trackingEnabled：APK 默认开、网页端默认关），
//    关闭时不启动 watch/周期定位、不上报任何位置（手动同步按钮不受限）。
// 2) 自动传感器：按后端 sensor_config 启用的项周期采集并上报（沿用 mobile_app 协议）。
// 定位/传感器在页面回到前台时补一次，保证离开标签页回来能及时刷新。
import { watch } from 'vue'
import api from '@/api'
import { auth, store } from '@/store'
import { getDeviceId } from '@/utils/device'
import { getPrefs } from '@/utils/prefs'
import { syncCurrentLocation, reportLocation, nativeGps, trackingEnabled } from '@/utils/location'
import { buildReportPayload } from '@/utils/sensors'

const LOC_INTERVAL = 5 * 60 * 1000 // 定位兜底周期：5 分钟
const SENSOR_INTERVAL = 60 * 1000  // 传感器周期：60s
const MOVE_THRESHOLD_M = 40        // 位置移动超过 ~40m 才上报（去抖动，避免静置反复上报）

let locTimer = null
let sensorTimer = null
let unwatchActive = null
let watchId = null
let nativeWatchId = null // 原生 GPS 连续监听已启动标记
let stopped = false
let lastLoc = null   // 上一次已上报坐标 { lat, lng }
let inFlight = { location: false, sensors: false }

function activeID() {
  return store.activeID && store.activeID > 0 ? store.activeID : null
}
function canRun() {
  return !stopped && !!auth.user && !!activeID()
}

// 两坐标点距离（米，Haversine）。
function distM(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// 本机设备当前启用的传感器 key 列表（来自后端 sensor_config）。
async function enabledSensorKeys() {
  try {
    const { data } = await getPrefs()
    const all = JSON.parse((data && data.sensor_config) || '{}') || {}
    const mine = all[getDeviceId()] || {}
    return Object.keys(mine).filter((k) => mine[k])
  } catch { return [] }
}

// 高德 Key（geocoded_location 逆地理需要；无则跳过该传感器）。
async function mapKey() {
  try {
    const { data } = await getPrefs()
    const mc = JSON.parse((data && data.map_config) || '{}') || {}
    return (mc.amap_key || '').trim()
  } catch { return '' }
}

// 位置变化时上报：超过阈值才更新（go-location 去抖动）。
async function reportMoved(lat, lng, accuracy) {
  if (inFlight.location || !canRun() || !trackingEnabled()) return
  const cur = { lat, lng }
  if (lastLoc && distM(cur, lastLoc) < MOVE_THRESHOLD_M) return // 移动不足，跳过
  lastLoc = cur
  inFlight.location = true
  try {
    await reportLocation(lat, lng, accuracy)
  } catch (e) {
    console.warn('[autoSync] location:', e && e.message ? e.message : e)
  } finally {
    inFlight.location = false
  }
}

// 周期兜底：主动定位并上报（覆盖 watchPosition 在后台暂停、静止不回调的场景）。
async function syncLocation() {
  if (inFlight.location || !canRun() || !trackingEnabled()) return
  inFlight.location = true
  try {
    const res = await syncCurrentLocation()
    if (res && Number.isFinite(res.lat) && Number.isFinite(res.lng)) lastLoc = { lat: res.lat, lng: res.lng }
  } catch (e) {
    if (e && e.code !== 1) console.warn('[autoSync] location:', e && e.message ? e.message : e)
  } finally {
    inFlight.location = false
  }
}

async function syncSensors() {
  if (inFlight.sensors || !canRun()) return
  const enabled = await enabledSensorKeys()
  if (!enabled.length) return // 未启用任何传感器则不采集（尊重用户配置）
  inFlight.sensors = true
  const id = activeID()
  try {
    const { payload } = await buildReportPayload(id, enabled, { trigger: 'periodic', amapKey: await mapKey(), debug: false })
    await api.reportSensors(id, payload)
  } catch (e) {
    console.warn('[autoSync] sensors:', e && e.message ? e.message : e)
  } finally {
    inFlight.sensors = false
  }
}

function onVisible() {
  if (!document.hidden) {
    syncLocation()
    syncSensors()
  }
}

// 位置变化实时监听：APK 内优先原生 GPS/北斗连续监听（stickykee-gps req='watch' 事件），
// 无原生桥时回退 watchPosition（Android WebView 默认 FUSED 网络混合定位，精度几十米）。
function onNativeGpsWatch(e) {
  const d = e && e.detail
  if (!d || d.req !== 'watch' || !d.ok) return
  reportMoved(d.lat, d.lng, d.acc)
}
function startWatching() {
  if (watchId != null || nativeWatchId != null) return
  const n = nativeGps()
  if (n) {
    try {
      window.addEventListener('stickykee-gps', onNativeGpsWatch)
      n.startGpsWatch()
      nativeWatchId = true
      return
    } catch {
      window.removeEventListener('stickykee-gps', onNativeGpsWatch)
      nativeWatchId = null
    }
  }
  if (!navigator.geolocation) return
  watchId = navigator.geolocation.watchPosition(
    (p) => reportMoved(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    (e) => console.warn('[autoSync] watchPosition:', e && e.message ? e.message : e),
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
  )
}
function stopWatching() {
  if (nativeWatchId != null) {
    nativeWatchId = null
    window.removeEventListener('stickykee-gps', onNativeGpsWatch)
    try { nativeGps()?.stopGpsWatch() } catch {}
  }
  if (watchId != null) {
    try { navigator.geolocation.clearWatch(watchId) } catch {}
    watchId = null
  }
}

// 启动自动同步；重复调用返回已存在的 stop。
export function startAutoSync() {
  if (locTimer || sensorTimer) return stopAutoSync
  stopped = false
  syncSensors()
  applyTrackingPref() // 追踪开启（APK 默认）才启动定位链路；网页端默认关闭，不生成 device_tracker
  sensorTimer = setInterval(syncSensors, SENSOR_INTERVAL)
  document.addEventListener('visibilitychange', onVisible)
  // 实例就绪后才真正上报；activeID 变化时补跑一次
  unwatchActive = watch(() => store.activeID, (v) => { if (v) { syncSensors(); applyTrackingPref() } })
  return stopAutoSync
}

// 设备追踪开关应用：按 trackingEnabled() 启/停「定位链路」（GPS watch + 周期兜底）。
// 传感器链路独立（由 sensor_config 控制），不受此开关影响。设置页切换后调用，即时生效。
export function applyTrackingPref() {
  if (!canRun()) { stopLocSync(); return }
  if (!trackingEnabled()) { stopLocSync(); return }
  if (locTimer) return // 已在运行
  startWatching()
  syncLocation() // watchPosition 首次回调前先主动定位一次
  locTimer = setInterval(syncLocation, LOC_INTERVAL)
}

function stopLocSync() {
  if (locTimer) { clearInterval(locTimer); locTimer = null }
  stopWatching()
  lastLoc = null
}

export function stopAutoSync() {
  stopped = true
  clearInterval(sensorTimer); sensorTimer = null
  stopLocSync()
  document.removeEventListener('visibilitychange', onVisible)
  if (unwatchActive) { unwatchActive(); unwatchActive = null }
}
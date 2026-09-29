// 自动同步：进入应用（登录态）即常驻运行，无需手动操作。
// 1) 自动定位：周期上报浏览器坐标到该设备的 device_tracker（HA 依据家 zone 判定在家/离家）。
// 2) 自动传感器：按后端 sensor_config 启用的项周期采集并上报（沿用 mobile_app 协议）。
// 定位/传感器在页面回到前台时补一次，保证离开标签页回来能及时刷新。
import { watch } from 'vue'
import api from '@/api'
import { auth, store } from '@/store'
import { getDeviceId } from '@/utils/device'
import { getPrefs } from '@/utils/prefs'
import { syncCurrentLocation, reportLocation } from '@/utils/location'
import { buildReportPayload } from '@/utils/sensors'

const LOC_INTERVAL = 5 * 60 * 1000 // 定位兜底周期：5 分钟
const SENSOR_INTERVAL = 60 * 1000  // 传感器周期：60s
const MOVE_THRESHOLD_M = 40        // 位置移动超过 ~40m 才上报（去抖动，避免静置反复上报）

let locTimer = null
let sensorTimer = null
let unwatchActive = null
let watchId = null
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
  if (inFlight.location || !canRun()) return
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
  if (inFlight.location || !canRun()) return
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

// 位置变化实时监听：watchPosition 持续回调，移动超阈值即上报。
function startWatching() {
  if (watchId != null || !navigator.geolocation) return
  watchId = navigator.geolocation.watchPosition(
    (p) => reportMoved(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    (e) => console.warn('[autoSync] watchPosition:', e && e.message ? e.message : e),
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 },
  )
}
function stopWatching() {
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
  startWatching()
  syncLocation() // watchPosition 首次回调前先主动定位一次
  locTimer = setInterval(syncLocation, LOC_INTERVAL)
  sensorTimer = setInterval(syncSensors, SENSOR_INTERVAL)
  document.addEventListener('visibilitychange', onVisible)
  // 实例就绪后才真正上报；activeID 变化时补跑一次
  unwatchActive = watch(() => store.activeID, (v) => { if (v) { syncSensors(); syncLocation() } })
  return stopAutoSync
}

export function stopAutoSync() {
  stopped = true
  clearInterval(locTimer); locTimer = null
  clearInterval(sensorTimer); sensorTimer = null
  stopWatching()
  document.removeEventListener('visibilitychange', onVisible)
  if (unwatchActive) { unwatchActive(); unwatchActive = null }
  lastLoc = null
}
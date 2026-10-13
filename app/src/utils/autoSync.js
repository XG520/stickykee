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
// 传感器周期：默认 60s，可在设置页修改（prefs sensor_config.<deviceId>._interval，
// 10~3600 秒）；APK 退后台后 JS 定时器冻结，由保活服务原生心跳按同间隔注入接管
let sensorIntervalMs = 60 * 1000
let lastSensorRun = 0              // 最近一次传感器上报发起时刻（后台 tick 防频次重合）
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

// 本机设备当前启用的传感器 key 列表（来自后端 sensor_config；`_` 开头为配置项非传感器）。
async function enabledSensorKeys() {
  try {
    const { data } = await getPrefs()
    const all = JSON.parse((data && data.sensor_config) || '{}') || {}
    const mine = all[getDeviceId()] || {}
    return Object.keys(mine).filter((k) => mine[k] && !k.startsWith('_'))
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
  lastSensorRun = Date.now()
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
  applySensorInterval() // 读取用户配置的上报间隔并同步给原生保活服务（APK 后台心跳）
  sensorTimer = setInterval(syncSensors, sensorIntervalMs)
  document.addEventListener('visibilitychange', onVisible)
  // 实例就绪后才真正上报；activeID 变化时补跑一次
  unwatchActive = watch(() => store.activeID, (v) => { if (v) { syncSensors(); applyTrackingPref() } })
  // APK 后台心跳入口：保活服务按配置间隔经 evaluateJavascript 注入调用
  // （退后台后 WebView 定时器全部冻结，原生显式注入不受影响，传感器因此实时更新）。
  // 前台时与本地 timer 重合由频次校验吸收（半个间隔内的重复 tick 跳过）。
  try {
    window.__skSensorTick = () => {
      if (!canRun()) return
      const now = Date.now()
      if (now - lastSensorRun < sensorIntervalMs / 2) return
      syncSensors()
    }
  } catch { /* 非浏览器环境忽略 */ }
  return stopAutoSync
}

// ---- 传感器上报间隔（设置页可配，10~3600 秒） ----
function nativeBridge() {
  return typeof window !== 'undefined' ? window.StickyKeeNative : null
}

// 重排本地周期 timer（间隔变化时调用；未启动时跳过，startAutoSync 会按新值建）
function rescheduleSensorTimer() {
  if (!sensorTimer) return
  clearInterval(sensorTimer)
  sensorTimer = setInterval(syncSensors, sensorIntervalMs)
}

// 读取用户配置的上报间隔（prefs sensor_config.<deviceId>._interval），
// 应用到本地 timer，并同步给原生保活服务（APK 后台心跳用同间隔）。
async function applySensorInterval() {
  try {
    const { data } = await getPrefs()
    const all = JSON.parse((data && data.sensor_config) || '{}') || {}
    const mine = all[getDeviceId()] || {}
    const sec = parseInt(mine._interval, 10)
    if (Number.isFinite(sec) && sec >= 10) sensorIntervalMs = Math.min(sec, 3600) * 1000
  } catch { /* 拉取失败用当前值 */ }
  rescheduleSensorTimer()
  const nv = nativeBridge()
  if (nv && typeof nv.setSensorInterval === 'function') {
    try { nv.setSensorInterval(Math.round(sensorIntervalMs / 1000)) } catch { /* 非 APK 忽略 */ }
  }
}

// 设置页修改上报间隔：立即生效（本地 timer 重排 + 原生心跳重排）并持久化到 prefs。
// _interval 下划线前缀与传感器 key 空间隔离（enabledSensorKeys/collect 均不消费它）。
export async function setSensorIntervalPref(sec) {
  const s = Math.max(10, Math.min(3600, parseInt(sec, 10) || 60))
  sensorIntervalMs = s * 1000
  lastSensorRun = 0
  rescheduleSensorTimer()
  try {
    // 读-改-写 prefs（绕过本地缓存），避免覆盖其他设备的传感器配置
    const { data } = await getPrefs({ force: true })
    const all = (data && data.sensor_config ? JSON.parse(data.sensor_config) : {}) || {}
    const id = getDeviceId()
    const mine = all[id] || {}
    mine._interval = s
    all[id] = mine
    await putPrefs({ sensor_config: JSON.stringify(all) })
  } catch { /* 离线时仅本地生效，下次进入重试 */ }
  const nv = nativeBridge()
  if (nv && typeof nv.setSensorInterval === 'function') {
    try { nv.setSensorInterval(s) } catch { /* 非 APK 忽略 */ }
  }
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
  try { delete window.__skSensorTick } catch { /* 忽略 */ }
}
// 设备传感器：检测设备类型与浏览器能力，按启用项采集传感器值，
// 并启动监听（状态变化立即回调 + 60s 周期兜底）。数据经后端 HA mobile_app 协议上报。
import { getDeviceId, currentDevice } from '@/utils/device'
import { getCurrentPosition } from '@/utils/location'
import { wgs84ToGcj02 } from '@/utils/gcj02'

// ---- 设备类型 ----
export function detectDeviceType() {
  const ua = navigator.userAgent || ''
  const data = navigator.userAgentData
  if (data && data.mobile) return 'mobile'
  if (/iPad/.test(ua)) return 'tablet'
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet'
  if (/Android|iPhone|iPod|Mobile/.test(ua)) return 'mobile'
  return 'desktop'
}

// ---- 浏览器能力探测 ----
export function detectCapabilities() {
  const type = detectDeviceType()
  return {
    battery: typeof navigator.getBattery === 'function', // 桌面 Chrome 也支持（Secure Context）
    connection: !!(navigator.connection && typeof navigator.connection.addEventListener === 'function'),
    light: lightAvailable(), // APK 原生环境光优先，其次浏览器 Generic Sensor（仅安全上下文）
    wakeLock: (typeof navigator.wakeLock === 'object' && typeof navigator.wakeLock.request === 'function')
      || nativeKeepScreenOn(), // APK 原生常亮兜底（http 下 Web WakeLock 不可用）
    visibility: true, // 页面可见性所有浏览器都支持
    geolocation: typeof navigator.geolocation !== 'undefined',
    mobile: type === 'mobile' || type === 'tablet',
  }
}

// 按设备类型 + 能力计算可用传感器 key 集。
// 规则：电池/网络/屏幕按能力；环境光仅移动端（桌面浏览器基本拿不到 lux）；
// 公网 IP/时区/触发原因/版本 浏览器均可用；位置需定位能力。
export function availableSensors() {
  const cap = detectCapabilities()
  const keys = new Set()
  if (cap.battery) { keys.add('battery_level'); keys.add('battery_state') }
  if (cap.connection) { keys.add('connection_type'); keys.add('network_quality'); keys.add('wifi_ssid'); keys.add('bssid') }
  if (cap.visibility) keys.add('screen_state')
  if (cap.mobile && cap.light) keys.add('light_sensor')
  if (cap.mobile && cap.light) keys.add('proximity')
  keys.add('public_ip')
  keys.add('current_time_zone')
  keys.add('last_update_trigger')
  keys.add('app_version')
  if (cap.geolocation) keys.add('geocoded_location')
  return keys
}

// 能力说明（设置页置灰时展示原因）。
export function unavailableReason(key) {
  const cap = detectCapabilities()
  switch (key) {
    case 'battery_level':
    case 'battery_state':
      return cap.battery ? '' : '当前浏览器不支持读取电池信息'
    case 'connection_type':
    case 'network_quality':
    case 'wifi_ssid':
    case 'bssid':
      return cap.connection ? '' : '当前浏览器不提供网络连接信息'
    case 'light_sensor':
      if (!cap.mobile) return '环境光传感器仅移动端可用'
      return cap.light ? '' : '当前浏览器不支持环境光传感器'
    case 'proximity':
      if (!cap.mobile) return '接近感应仅移动端可用'
      if (!cap.light) return '接近感应依赖环境光传感器'
      return cap.wakeLock ? '' : '当前浏览器不支持接近自动亮屏（需屏幕唤醒锁）'
    case 'geocoded_location':
      return cap.geolocation ? '' : '当前浏览器不支持定位'
    case 'screen_state':
    case 'public_ip':
    case 'current_time_zone':
    case 'last_update_trigger':
    case 'app_version':
      return ''
    default:
      return ''
  }
}

// ---- 采集 ----
let batteryManager = null

// ---- 环境光（APK 原生优先，Web Generic Sensor 兜底；引用计数供多模块共用） ----
function nativeLight() {
  const n = typeof window !== 'undefined' ? window.StickyKeeNative : null
  return n && typeof n.hasLightSensor === 'function' && typeof n.startLight === 'function'
    && typeof n.stopLight === 'function' && typeof n.lightLux === 'function' && n.hasLightSensor() ? n : null
}

// 原生屏幕常亮（http 下 Web WakeLock 不可用时的接近自动亮屏兜底）
function nativeKeepScreenOn() {
  const n = typeof window !== 'undefined' ? window.StickyKeeNative : null
  return !!(n && typeof n.keepScreenOn === 'function')
}

// 设备是否具备环境光读取能力（原生或浏览器）
export function lightAvailable() {
  return !!nativeLight() || typeof window.AmbientLightSensor === 'function' || typeof window.DeviceLightEvent === 'function'
}

let luxUsers = 0
let luxMode = ''          // '' | 'native' | 'web'
let webLuxSensor = null
const luxHandlers = new Set()

function dispatchLux(lux) {
  luxHandlers.forEach((h) => { try { h(lux) } catch { /* 单个处理器异常不影响其他 */ } })
}

function onNativeLightEvt(e) {
  const lux = e && e.detail ? Number(e.detail.lux) : NaN
  if (Number.isFinite(lux)) dispatchLux(Math.round(lux))
}

function onWebLightReading() {
  if (!webLuxSensor || typeof webLuxSensor.illuminance !== 'number') return
  dispatchLux(Math.round(webLuxSensor.illuminance))
}

// 获取环境光监听（引用计数，handler(lux) 接收整数 lux）。返回是否成功启动。
export function acquireLight(handler) {
  if (handler) luxHandlers.add(handler)
  luxUsers += 1
  if (luxMode) return true
  const n = nativeLight()
  if (n) {
    try {
      n.startLight()
      window.addEventListener('stickykee-light', onNativeLightEvt)
      luxMode = 'native'
      return true
    } catch { /* 回退浏览器实现 */ }
  }
  if (typeof window.AmbientLightSensor === 'function') {
    try {
      webLuxSensor = new window.AmbientLightSensor({ frequency: 5 })
      webLuxSensor.addEventListener('reading', onWebLightReading)
      webLuxSensor.start()
      luxMode = 'web'
      return true
    } catch { webLuxSensor = null }
  }
  luxUsers -= 1
  return false
}

// 释放环境光监听（可选移除 handler；引用归零才真正停掉传感器）
export function releaseLight(handler) {
  if (handler) luxHandlers.delete(handler)
  luxUsers = Math.max(0, luxUsers - 1)
  if (luxUsers > 0 || !luxMode) return
  if (luxMode === 'native') {
    try { nativeLight()?.stopLight() } catch { /* 忽略 */ }
    window.removeEventListener('stickykee-light', onNativeLightEvt)
  } else if (luxMode === 'web') {
    try { webLuxSensor?.stop() } catch { /* 忽略 */ }
    try { webLuxSensor?.removeEventListener('reading', onWebLightReading) } catch { /* 忽略 */ }
    webLuxSensor = null
  }
  luxMode = ''
}

// 当前 lux 读数：原生缓存优先（无需事件在跑），其次 Web 传感器实例
export function currentLux() {
  const n = nativeLight()
  if (n) {
    try {
      const v = Number(n.lightLux())
      if (Number.isFinite(v) && v >= 0) return Math.round(v)
    } catch { /* 忽略 */ }
  }
  if (webLuxSensor && typeof webLuxSensor.illuminance === 'number') return Math.round(webLuxSensor.illuminance)
  return undefined
}

// 与后端 mobile_app 注册的 app_version 保持一致
const SN_VERSION = '1.0.0'

let cachedIP = ''
let cachedIPAt = 0
// 公网 IP：官方 App 用 ipify 生成；多源回退（ipify 在部分网络不可达），5 分钟缓存，避免频繁外网请求
const IP_SOURCES = [
  'https://api.ipify.org?format=json',
  'https://ipinfo.io/ip',
  'https://myip.ipip.net',
  'https://4.ipw.cn',
]
async function fetchSource(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 3000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return ''
    const text = await res.text()
    let ip = ''
    try {
      const j = JSON.parse(text)
      ip = (j && (j.ip || j.data)) || ''
    } catch { ip = text }
    const m = String(ip).match(/\d{1,3}(\.\d{1,3}){3}/)
    return m ? m[0] : ''
  } catch {
    clearTimeout(t)
    return ''
  }
}
async function fetchPublicIP() {
  const now = Date.now()
  if (cachedIP && now - cachedIPAt < 300000) return cachedIP
  for (const url of IP_SOURCES) {
    const ip = await fetchSource(url)
    if (ip) { cachedIP = ip; cachedIPAt = now; break }
  }
  return cachedIP
}

// 设备时区（Intl API）
function timeZoneInfo() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    return { tz, offset: -new Date().getTimezoneOffset() / 60 }
  } catch { return { tz: '', offset: 0 } }
}

// 高德逆地理（REST API 支持浏览器跨域）。
// APK 优先走系统 Geocoder：国内 ROM 的系统定位与系统地理编码同坐标系（GCJ-02），
// 与官方 App 同源、无需转换、免 key；REST 高德仅作 Web 端回退（先转 GCJ-02）。
async function reverseGeocode(lng, lat, amapKey) {
  try {
    const nv = window.StickyKeeNative
    if (nv && typeof nv.geocode === 'function') {
      const r = JSON.parse(nv.geocode(lat, lng) || '{}')
      return r.ok && r.address ? r.address : ''
    }
  } catch { /* 原生不可用则走 REST */ }
  if (!amapKey) return ''
  try {
    const gc02 = wgs84ToGcj02(lng, lat)
    const url = `https://restapi.amap.com/v3/geocode/regeo?location=${gc02.lng},${gc02.lat}&key=${amapKey}&extensions=base&output=json`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    const j = await res.json()
    if (j && j.status === '1' && j.regeocode && j.regeocode.formatted_address) {
      return j.regeocode.formatted_address
    }
  } catch { /* 忽略 */ }
  return ''
}

// 设备定位：复用 location.js 的统一定位（APK 内原生 GPS/北斗卫星定位，15s 超时，
// 与 device_tracker 坐标同源同刻——保证 geocoded_location 的地址文字与地图坐标一致）。
// 失败/拒绝授权/无卫星 fix 时返回 null（不上报，避免网络定位产生的错位地址）。
async function currentPosition() {
  try {
    const pos = await getCurrentPosition()
    return { lng: pos.coords.longitude, lat: pos.coords.latitude }
  } catch { return null }
}

async function getBattery() {
  try {
    if (!batteryManager) batteryManager = await navigator.getBattery()
  } catch { batteryManager = null }
  return batteryManager
}

function connType() {
  const c = navigator.connection || {}
  const raw = c.type || ''
  if (raw === 'wifi' || raw === 'wired') return 'wifi'
  if (raw === 'cellular') return 'cellular'
  if (raw === 'ethernet') return 'ethernet'
  if (raw === 'none') return 'unavailable'
  // 无 type 字段的浏览器按 effectiveType 推断
  const et = c.effectiveType || ''
  return /slow-2g|2g|3g|4g/.test(et) ? 'cellular' : 'unavailable'
}

// ---- 接近感应（Browser_mod 同款思路：用环境光阴影检测是否有人靠近） ----
// 当有人站在面前（遮挡光线，lux 明显低于最近基线）判定为 near，
// 屏幕被唤醒锁点亮；人离开（光线恢复）回 far，释放唤醒锁让屏幕可按时间熄灭。
const PROXIMITY = {
  state: 'far',       // 'near' | 'far'
  lux: 0,             // 最近一次环境光
  baseline: 0,        // 近 2 分钟 lux 中位数（对短暂阴影鲁棒）
  readings: [],       // [{t, v}] 时间窗内的 lux 样本
  wakeLock: null,     // 当前持有的屏幕唤醒锁
  active: false,      // 是否已接入监听（monitor 持有期间为 true）
}
const PROX_BASELINE_WINDOW = 120000 // 基线取近 2 分钟
const PROX_NEAR_RATIO = 0.5         // lux < 基线×0.5 视为被遮挡（有人靠近）
const PROX_MIN_BASELINE = 10        // 基线过低（全暗环境）时不判断，避免开屏无效

// 喂入一次 lux，刷新接近状态；返回 'near'|'far'。
function feedProximityLux(lux) {
  const now = Date.now()
  PROXIMITY.lux = lux
  PROXIMITY.readings.push({ t: now, v: lux })
  const cutoff = now - PROX_BASELINE_WINDOW
  while (PROXIMITY.readings.length && PROXIMITY.readings[0].t < cutoff) PROXIMITY.readings.shift()
  if (PROXIMITY.readings.length >= 3) {
    const vals = PROXIMITY.readings.map((r) => r.v).sort((a, b) => a - b)
    PROXIMITY.baseline = vals[Math.floor(vals.length / 2)]
    PROXIMITY.state = (PROXIMITY.baseline >= PROX_MIN_BASELINE && lux < PROXIMITY.baseline * PROX_NEAR_RATIO) ? 'near' : 'far'
  } else {
    PROXIMITY.state = 'far'
  }
  return PROXIMITY.state
}

// 按接近状态请求/释放屏幕常亮：near 时保持屏幕点亮。返回是否成功改变状态。
async function syncProximityWakeLock(state) {
  const want = state === 'near'
  // APK 原生常亮兜底（http 下 Web WakeLock 不可用）
  const n = typeof window !== 'undefined' ? window.StickyKeeNative : null
  if (n && typeof n.keepScreenOn === 'function') {
    try { n.keepScreenOn(want); return true } catch { /* 忽略 */ }
  }
  if (typeof navigator.wakeLock !== 'object') return false
  try {
    if (want && !PROXIMITY.wakeLock) {
      PROXIMITY.wakeLock = await navigator.wakeLock.request('screen')
      PROXIMITY.wakeLock.addEventListener('release', () => { PROXIMITY.wakeLock = null })
      return true
    }
    if (!want && PROXIMITY.wakeLock) {
      await PROXIMITY.wakeLock.release()
      PROXIMITY.wakeLock = null
      return true
    }
  } catch { /* 忽略（权限拒绝/重入异常） */ }
  return false
}

// 全局「人接近自动亮屏」：不依赖设置页，应用常驻期间持续监听环境光阴影。
// 靠近（遮挡光线）→ 请求屏幕唤醒锁点亮；离开 → 释放。返回 stop 函数。
export function startProximityScreenWake() {
  const cap = detectCapabilities()
  if (!cap.mobile || !cap.light || !cap.wakeLock) return null
  let stopped = false
  const onLux = (lux) => {
    if (lux === undefined) return
    PROXIMITY.active = true
    const next = feedProximityLux(lux)
    syncProximityWakeLock(next)
  }
  if (!acquireLight(onLux)) return null
  return () => {
    if (stopped) return
    stopped = true
    releaseLight(onLux)
    PROXIMITY.active = false
    PROXIMITY.readings = []
    syncProximityWakeLock('far')
  }
}

// 采集启用项的当前值 → { key: { state, attributes? } }
// trigger：本次上报触发原因（manual/event/periodic）；amapKey：高德 key（geocoded_location 需要）
export async function collect(enabled, trigger = 'manual', amapKey = '') {
  const sensors = {}
  const has = (k) => (enabled instanceof Set ? enabled.has(k) : enabled.includes(k))

  if (has('battery_level') || has('battery_state')) {
    const b = await getBattery()
    if (b) {
      if (has('battery_level')) sensors.battery_level = { state: Math.round((b.level || 0) * 100) }
      if (has('battery_state')) {
        const st = b.charging ? (b.level === 1 ? 'full' : 'charging') : (b.level === 1 ? 'full' : 'discharging')
        sensors.battery_state = { state: st }
      }
    }
  }

  if (has('connection_type') || has('network_quality') || has('wifi_ssid')) {
    const c = navigator.connection || {}
    if (has('connection_type')) sensors.connection_type = { state: connType() }
    if (has('network_quality')) {
      sensors.network_quality = {
        state: c.effectiveType || 'unknown',
        attributes: {
          downlink: typeof c.downlink === 'number' ? c.downlink : undefined,
          rtt: typeof c.rtt === 'number' ? c.rtt : undefined,
          save_data: !!c.saveData,
        },
      }
    }
    if (has('wifi_ssid')) {
      const ssid = c.ssid || ''
      if (ssid) sensors.wifi_ssid = { state: ssid }
    }
  }

  if (has('screen_state')) {
    sensors.screen_state = { state: document.visibilityState === 'visible' ? 'on' : 'off' }
  }

  if (has('light_sensor')) {
    const lux = currentLux()
    if (typeof lux === 'number') sensors.light_sensor = { state: lux }
  }

  if (has('proximity')) {
    // 状态由监听持续刷新；此处只做一次实时采样兜底并上报缓存状态
    const lux = currentLux()
    if (typeof lux === 'number' && !PROXIMITY.active) feedProximityLux(lux)
    sensors.proximity = {
      state: PROXIMITY.state,
      attributes: { lux: Math.round(PROXIMITY.lux), baseline: Math.round(PROXIMITY.baseline) },
    }
  }

  if (has('public_ip')) {
    const ip = await fetchPublicIP()
    if (ip) sensors.public_ip = { state: ip }
  }

  if (has('current_time_zone')) {
    const { tz, offset } = timeZoneInfo()
    if (tz) sensors.current_time_zone = { state: tz, attributes: { offset } }
  }

  if (has('last_update_trigger')) {
    sensors.last_update_trigger = { state: trigger }
  }

  if (has('app_version')) {
    sensors.app_version = { state: SN_VERSION }
  }

  if (has('bssid')) {
    const bssid = (navigator.connection && navigator.connection.bssid) || ''
    if (bssid) sensors.bssid = { state: bssid }
  }

  if (has('geocoded_location')) {
    const pos = await currentPosition()
    if (pos) {
      // 反查由 reverseGeocode 按端处理坐标系（APK 系统 Geocoder 免转换 / Web 转 GCJ-02），
      // attributes 上报设备原始坐标，与官方 App 一致
      const addr = await reverseGeocode(pos.lng, pos.lat, amapKey)
      if (addr) sensors.geocoded_location = { state: addr, attributes: { latitude: pos.lat, longitude: pos.lng } }
    }
  }
  return sensors
}

// 启动监听：状态变化立即触发 onChange('event')，另加 60s 周期兜底 onChange('periodic')。
// opts.scope：启用的传感器 key 集（用于接近感应等需监听并开唤醒锁的项）；opts.onError 接收可上报的错误。
// 返回 stop 函数。
export function startSensorMonitor({ onChange, onError, scope } = {}) {
  const cb = () => onChange && onChange('event')
  const err = (e) => onError && onError(e)
  const stopFns = []
  const wantProximity = scope ? (scope instanceof Set ? scope.has('proximity') : scope.includes('proximity')) : false

  const on = (target, evt, fn) => {
    target && target.addEventListener && target.addEventListener(evt, fn)
    stopFns.push(() => target && target.removeEventListener && target.removeEventListener(evt, fn))
  }

  const onDoc = (evt, fn) => on(document, evt, fn)
  onDoc('visibilitychange', cb)

  // 网络
  if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
    on(navigator.connection, 'change', cb)
  }
  on(window, 'online', cb)
  on(window, 'offline', cb)

  // 电池
  getBattery().then((b) => {
    if (b) { on(b, 'levelchange', cb); on(b, 'chargingchange', cb) }
  }).catch(() => {})

  // 环境光 + 接近感应（移动端）：lux 变化驱动接近判定，并在靠近时用唤醒锁点亮屏幕
  {
    let lastLuxReport = 0 // 纯环境光模式的上报节流（原生光感事件频率高，避免上报风暴）
    const luxHandler = (lux) => {
      if (lux === undefined) return
      if (wantProximity) {
        const prev = PROXIMITY.state
        const next = feedProximityLux(lux)
        syncProximityWakeLock(next)
        if (next !== prev) cb() // 接近状态变化时上报
      } else {
        const now = Date.now()
        if (now - lastLuxReport >= 5000) { lastLuxReport = now; cb() }
      }
    }
    if (acquireLight(luxHandler)) {
      if (wantProximity) PROXIMITY.active = true
      stopFns.push(() => releaseLight(luxHandler))
    } else if (detectCapabilities().mobile) {
      err(new Error('环境光传感器启动失败'))
    }
  }

  // 60s 周期兜底（状态可能变化但事件未触发）
  const timer = setInterval(() => onChange && onChange('periodic'), 60000)
  stopFns.push(() => clearInterval(timer))

  return () => {
    stopFns.forEach((f) => { try { f() } catch {} }); stopFns.length = 0
    // 停止时释放接近唤醒锁，避免监控关闭后屏幕被锁死常亮
    if (wantProximity) { PROXIMITY.active = false; PROXIMITY.readings = []; syncProximityWakeLock('far') }
  }
}

// 组装上报请求体（device_id + 采集值 + 设备信息）。
// opts.trigger：手动/事件/周期；opts.amapKey：高德 key（geocoded_location 需要）；opts.debug：是否打印采集日志（默认 true）。
export async function buildReportPayload(activeID, enabled, opts = {}) {
  const dev = await currentDevice()
  const trigger = opts.trigger || 'manual'
  const sensors = await collect(enabled, trigger, opts.amapKey || '')
  if (opts.debug !== false) {
    console.log('[sensors] enabled:', JSON.stringify(enabled), 'collected:', JSON.stringify(Object.keys(sensors)), 'raw:', JSON.stringify(sensors))
  }
  const ua = navigator.userAgent || 'unknown'
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'web'
  return {
    id: activeID,
    payload: {
      device_id: getDeviceId(),
      device_name: dev.name || dev.dev_id,
      sensors,
      manufacturer: platform,
      model: ua.slice(0, 200),
      os_name: detectDeviceType(),
      os_version: '',
    },
  }
}

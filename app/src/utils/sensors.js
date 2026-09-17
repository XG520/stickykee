// 设备传感器：检测设备类型与浏览器能力，按启用项采集传感器值，
// 并启动监听（状态变化立即回调 + 60s 周期兜底）。数据经后端 HA mobile_app 协议上报。
import { getDeviceId, currentDevice } from '@/utils/device'

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
    light: typeof window.AmbientLightSensor === 'function' || typeof window.DeviceLightEvent === 'function',
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
let luxSensor = null

// 与后端 mobile_app 注册的 app_version 保持一致
const HC_VERSION = '1.0.0'

let cachedIP = ''
let cachedIPAt = 0
// 公网 IP：官方 App 用 ipify 生成；5 分钟缓存，避免频繁外网请求
async function fetchPublicIP() {
  const now = Date.now()
  if (cachedIP && now - cachedIPAt < 300000) return cachedIP
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal })
    clearTimeout(t)
    const j = await res.json()
    cachedIP = (j && j.ip) || ''
    cachedIPAt = now
  } catch { cachedIP = '' }
  return cachedIP
}

// 设备时区（Intl API）
function timeZoneInfo() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    return { tz, offset: -new Date().getTimezoneOffset() / 60 }
  } catch { return { tz: '', offset: 0 } }
}

// 高德逆地理（REST API 支持浏览器跨域）
async function reverseGeocode(lng, lat, amapKey) {
  if (!amapKey) return ''
  try {
    const url = `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${amapKey}&extensions=base&output=json`
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

// 浏览器定位（失败/拒绝授权时返回 null）
function currentPosition() {
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lng: p.coords.longitude, lat: p.coords.latitude }),
        () => resolve(null),
        { timeout: 4000, maximumAge: 60000 },
      )
    } catch { resolve(null) }
  })
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

function currentLux() {
  if (window.AmbientLightSensor && luxSensor && typeof luxSensor.illuminance === 'number') {
    return Math.round(luxSensor.illuminance)
  }
  return undefined
}

function ensureLuxSensor(onChange) {
  if (typeof window.AmbientLightSensor !== 'function') return null
  try {
    const s = new window.AmbientLightSensor({ frequency: 5 })
    s.addEventListener('reading', onChange)
    s.start()
    luxSensor = s
    return s
  } catch { return null }
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
    sensors.app_version = { state: HC_VERSION }
  }

  if (has('bssid')) {
    const bssid = (navigator.connection && navigator.connection.bssid) || ''
    if (bssid) sensors.bssid = { state: bssid }
  }

  if (has('geocoded_location')) {
    const pos = await currentPosition()
    if (pos) {
      const addr = await reverseGeocode(pos.lng, pos.lat, amapKey)
      if (addr) sensors.geocoded_location = { state: addr, attributes: { latitude: pos.lat, longitude: pos.lng } }
    }
  }
  return sensors
}

// 启动监听：状态变化立即触发 onChange('event')，另加 60s 周期兜底 onChange('periodic')。
// 返回 stop 函数。onError 接收可上报的错误（如环境光传感器启动失败）。
export function startSensorMonitor({ onChange, onError } = {}) {
  const cb = () => onChange && onChange('event')
  const err = (e) => onError && onError(e)
  const stopFns = []

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

  // 环境光（移动端）
  if (typeof window.AmbientLightSensor === 'function') {
    const s = ensureLuxSensor(() => { if (currentLux() !== undefined) cb() })
    if (s) stopFns.push(() => { try { s.stop() } catch {} })
    else err(new Error('环境光传感器启动失败'))
  }

  // 60s 周期兜底（状态可能变化但事件未触发）
  const timer = setInterval(() => onChange && onChange('periodic'), 60000)
  stopFns.push(() => clearInterval(timer))

  return () => { stopFns.forEach((f) => { try { f() } catch {} }); stopFns.length = 0 }
}

// 组装上报请求体（device_id + 采集值 + 设备信息）。
// opts.trigger：手动/事件/周期；opts.amapKey：高德 key（geocoded_location 需要）。
export async function buildReportPayload(activeID, enabled, opts = {}) {
  const dev = await currentDevice()
  const trigger = opts.trigger || 'manual'
  const sensors = await collect(enabled, trigger, opts.amapKey || '')
  console.log('[sensors] enabled:', JSON.stringify(enabled), 'collected:', JSON.stringify(Object.keys(sensors)), 'raw:', JSON.stringify(sensors))
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

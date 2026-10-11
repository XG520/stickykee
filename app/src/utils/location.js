// 定位同步工具：获取浏览器定位并经 mobile_app webhook 上报到 Home Assistant。
// HA 会自动创建/更新带 unique_id 的 device_tracker 实体并绑定到注册设备（官方行为）。
import api from '@/api'
import { store } from '@/store'
import { ensureDevice } from '@/utils/device'

// ---- 原生 GPS/北斗定位（APK 优先）----
// WebView 的 navigator.geolocation 在 Android 上默认走 FUSED 网络混合定位（WiFi/基站，
// 精度几十米）。APK 内直连原生 LocationManager.GPS_PROVIDER（国产机自动含北斗等星座），
// 实现真正卫星定位；无原生桥或卫星定位失败时回退浏览器定位。
export function nativeGps() {
  const n = typeof window !== 'undefined' ? window.StickyKeeNative : null
  return n && typeof n.gpsOnce === 'function' && typeof n.hasGps === 'function' ? n : null
}

// 单次原生卫星定位。resolve {lat,lng,acc,provider}；reject Error(message=no_permission|no_fix|timeout|...)
export function nativeGpsOnce(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const n = nativeGps()
    if (!n) { reject(new Error('unavailable')); return }
    const req = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      window.removeEventListener('stickykee-gps', onEvt)
      clearTimeout(timer)
      fn(arg)
    }
    const onEvt = (e) => {
      const d = e && e.detail
      if (!d || d.req !== req) return
      if (d.ok) finish(resolve, { lat: d.lat, lng: d.lng, acc: d.acc, provider: d.provider })
      else finish(reject, new Error(d.provider || 'no_fix'))
    }
    // 原生最长等待受其内部 60s 钳制，这里再留 5s 余量兜底
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs + 5000)
    window.addEventListener('stickykee-gps', onEvt)
    try { n.gpsOnce(req, timeoutMs) } catch (err) { finish(reject, err) }
  })
}

// 获取当前定位（Promise 形式，兼容 GeolocationPosition 结构）。APK 内优先原生卫星定位。
async function getCurrentPosition() {
  if (nativeGps()) {
    try {
      const r = await nativeGpsOnce(15000)
      return { coords: { latitude: r.lat, longitude: r.lng, accuracy: r.acc } }
    } catch { /* 卫星无 fix/超时/无权限 → 回退浏览器定位（会触发系统授权弹窗） */ }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('浏览器不支持定位，需 HTTPS 环境')); return }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 30000,
    })
  })
}

// 逆地理编码（可选；无高德则不阻塞）。
async function reverseGeocode(lng, lat) {
  if (!window.AMap || !window.AMap.Geocoder) return ''
  try {
    const gc = new window.AMap.Geocoder({ city: '全国', radius: 1000 })
    return await new Promise((res, rej) => gc.getAddress([lng, lat], (err, d) => err || !d?.regeocode ? rej() : res(d.regeocode.formattedAddress)))
  } catch { return '' }
}

// reportLocation：把指定坐标经官方 webhook 上报到该设备的 device_tracker。
// 不上报 location_name，HA 依据「家」zone 自动判定在家/离家。供位置变化监听（watchPosition）复用。
// 返回 { ok, lat, lng, device_id, dev_id, name, accuracy }
export async function reportLocation(lat, lng, accuracy) {
  const device = await ensureDevice()
  await api.updateLocation(store.activeID, {
    device_id: device.device_id,
    lat,
    lng,
    accuracy: Math.round(accuracy || 0),
  })
  return {
    ok: true,
    lat,
    lng,
    accuracy: Math.round(accuracy || 0),
    device_id: device.device_id,
    dev_id: device.dev_id || '',
    name: device.name,
  }
}

// syncCurrentLocation：注册当前设备→获取定位→逆地理→经官方 webhook 上报到该设备的 tracker。
// HA 会自动创建/更新带 unique_id 的 device_tracker 并绑定到该移动应用设备；
// 家人 person 的关联请在 HA 中「设置 → 人员 → 跟踪设备」勾选本机设备，person 会自动取用其位置。
// 注意：不上报 location_name，否则 HA 会用它直接作为实体状态，导致不显示「在家/离家」；
// 逆地理地址仅用于本应用界面展示。
// 返回 { ok, lat, lng, device_id, dev_id, name, address, accuracy }
export async function syncCurrentLocation() {
  const device = await ensureDevice()
  const pos = await getCurrentPosition()
  const { latitude, longitude, accuracy } = pos.coords
  const address = await reverseGeocode(longitude, latitude)
  await reportLocation(latitude, longitude, accuracy)
  return {
    ok: true,
    lat: latitude,
    lng: longitude,
    accuracy: Math.round(accuracy),
    device_id: device.device_id,
    dev_id: device.dev_id || '',
    name: device.name,
    address,
  }
}

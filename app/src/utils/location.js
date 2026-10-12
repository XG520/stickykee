// 定位同步工具：获取浏览器定位并经 mobile_app webhook 上报到 Home Assistant。
// HA 会自动创建/更新带 unique_id 的 device_tracker 实体并绑定到注册设备（官方行为）。
import api from '@/api'
import { store } from '@/store'
import { ensureDevice } from '@/utils/device'
import { wgs84ToGcj02 } from '@/utils/gcj02'

// ---- 原生 GPS/北斗定位（APK 优先）----
// WebView 的 navigator.geolocation 在 Android 上默认走 FUSED 网络混合定位（WiFi/基站，
// 精度几十米）。APK 内直连原生 LocationManager.GPS_PROVIDER（国产机自动含北斗等星座），
// 实现真正卫星定位；无原生桥或卫星定位失败时回退浏览器定位。
export function nativeGps() {
  const n = typeof window !== 'undefined' ? window.StickyKeeNative : null
  return n && typeof n.gpsOnce === 'function' && typeof n.hasGps === 'function' ? n : null
}

// 等待原生定位授权结果（requestGpsPermission 的 'perm' 事件）。超时/拒绝返回 false。
function waitGpsPermission(n, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const onEvt = (e) => {
      const d = e && e.detail
      if (!d || d.req !== 'perm') return
      window.removeEventListener('stickykee-gps', onEvt)
      clearTimeout(pt)
      resolve(!!d.ok)
    }
    const pt = setTimeout(() => {
      window.removeEventListener('stickykee-gps', onEvt)
      resolve(false)
    }, timeoutMs)
    window.addEventListener('stickykee-gps', onEvt)
    try { n.requestGpsPermission() } catch { resolve(false) }
  })
}

// 单次原生卫星定位。resolve {lat,lng,acc,provider}；reject Error(message=no_permission|denied|no_fix|timeout|...)。
// 未授权时自动发起系统授权弹窗，授权成功后自动重试一次。
export function nativeGpsOnce(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const n = nativeGps()
    if (!n) { reject(new Error('unavailable')); return }
    let permRequested = false // 已经历过一次「申请授权→等待结果」流程

    const attempt = () => {
      const req = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      let settled = false
      const finish = (fn, arg) => {
        if (settled) return
        settled = true
        window.removeEventListener('stickykee-gps', onEvt)
        clearTimeout(timer)
        fn(arg)
      }
      const onEvt = async (e) => {
        const d = e && e.detail
        if (!d || d.req !== req) return
        if (d.ok) {
          finish(resolve, { lat: d.lat, lng: d.lng, acc: d.acc, provider: d.provider })
          return
        }
        if (d.provider === 'no_permission' && !permRequested) {
          // 首次未授权：弹系统授权框，等待结果后重试一次
          permRequested = true
          const ok = await waitGpsPermission(n)
          if (ok) { attempt(); return }
          finish(reject, new Error('denied'))
          return
        }
        finish(reject, new Error(d.provider || 'no_fix'))
      }
      // 原生最长等待受其内部 60s 钳制，这里再留 5s 余量兜底
      const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs + 5000)
      window.addEventListener('stickykee-gps', onEvt)
      try { n.gpsOnce(req, timeoutMs) } catch (err) { finish(reject, err) }
    }
    attempt()
  })
}

// 获取当前定位（Promise 形式，兼容 GeolocationPosition 结构）。
// APK 内一律原生卫星定位（GPS/北斗）：卫星无 fix/超时/无权限时直接报错，
// 绝不静默回退网络定位——否则会出现「文字地址与坐标不一致」的假位置。
// 仅非 APK 的浏览器环境使用 navigator.geolocation。
export async function getCurrentPosition() {
  if (nativeGps()) {
    const r = await nativeGpsOnce(15000)
    return { coords: { latitude: r.lat, longitude: r.lng, accuracy: r.acc } }
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('浏览器不支持定位，需 HTTPS 环境')); return }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 30000,
    })
  })
}

// 定位错误码 → 中文提示（供界面展示；APK 无权限时前端会自动弹系统授权框，denied 即用户拒绝）
export function locErrorMessage(e) {
  const map = {
    no_permission: '尚未授予定位权限，请点击重试并允许',
    denied: '定位权限被拒绝，请在系统设置中允许',
    no_fix: '暂无卫星信号，请到窗边或户外重试',
    timeout: '卫星定位超时，请到空旷处重试',
    unavailable: '当前环境不支持卫星定位',
  }
  const msg = e && e.message
  return map[msg] || msg || '定位同步失败'
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
  // 高德基于 GCJ-02：WGS-84 的 GPS 坐标须先转换再反查，否则地址偏数百米
  // （与官方 App 不一致）；上报 HA 的坐标保持 WGS-84，与官方 App 完全相同。
  const gc = wgs84ToGcj02(longitude, latitude)
  const address = await reverseGeocode(gc.lng, gc.lat)
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

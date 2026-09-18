// 定位同步工具：获取浏览器定位并经 mobile_app webhook 上报到 Home Assistant。
// HA 会自动创建/更新带 unique_id 的 device_tracker 实体并绑定到注册设备（官方行为）。
import api from '@/api'
import { store } from '@/store'
import { ensureDevice } from '@/utils/device'

// 获取当前浏览器定位（Promise 形式）。
function getCurrentPosition() {
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

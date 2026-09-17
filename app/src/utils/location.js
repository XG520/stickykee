// 定位同步工具：获取浏览器定位并推送到 Home Assistant，供自动/手动更新复用。
import api from '@/api'
import { store } from '@/store'
import { attr } from '@/utils/entities'
import { ensureDevice } from '@/utils/device'

// 根据同步目标实体解析 HA device_tracker 的 dev_id。
// targetEntityID 可为 "device_tracker.xxx" 或 "person.xxx"；person 取其 source 跟踪设备。
export function resolveDevID(targetEntityID, entities = []) {
  if (!targetEntityID) return ''
  if (targetEntityID.startsWith('device_tracker.')) return targetEntityID.split('.').pop()
  if (!targetEntityID.startsWith('person.')) return ''
  const person = entities.find((e) => e.entity_id === targetEntityID)
  if (!person) return ''
  const src = attr(person, 'source')
  if (src) return String(src).split('.').pop()
  const trackers = attr(person, 'device_trackers')
  if (Array.isArray(trackers) && trackers.length) return String(trackers[0]).split('.').pop()
  return ''
}

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

// syncCurrentLocation：注册当前设备→获取定位→逆地理→推送到该设备自己的 tracker（别名），
// 若给定了关联的家人 person，则同时写入其 source tracker。
// 返回 { ok, lat, lng, dev_id, name, address, accuracy, reason }
export async function syncCurrentLocation(targetEntityID) {
  // 1) 读取实体，用于解析关联目标。
  let entities = []
  try {
    const { data } = await api.entities({ instance: store.activeID })
    entities = Array.isArray(data?.data) ? data.data : []
  } catch { /* 忽略，仍可推送 */ }

  // 2) 获取定位 + 逆地理。
  const pos = await getCurrentPosition()
  const { latitude, longitude, accuracy } = pos.coords
  const address = await reverseGeocode(longitude, latitude)
  const base = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy), location_name: address || 'updated' }

  // 3) 确定写入 HA 的目标实体：
  //    - 配置了同步目标（某位家人 person / 已有 device_tracker）→ 只更新该“已有、带 unique_id 可管理”的实体，
  //      避免额外创建没有 unique_id 的新实体（这正是 HA 报“无法在 UI 管理”的来源）。
  //    - 未配置目标（自动）→ 写入本机设备自己的 tracker（会通过 see 创建新实体）。
  const targetDevID = targetEntityID ? resolveDevID(targetEntityID, entities) : ''
  if (targetDevID) {
    const targetEntity = entities.find((e) => e.entity_id === targetEntityID)
    const hostName = (targetEntity && (targetEntity.friendly_name || targetEntity.attributes?.friendly_name)) || ''
    await api.updateLocation(store.activeID, { ...base, dev_id: targetDevID, host_name: hostName })
    return { ok: true, ...base, dev_id: targetDevID, name: hostName || targetDevID, address }
  }

  // 自动模式：注册本机设备（去重、别名），写入其自己的 tracker。
  const device = await ensureDevice()
  await api.updateLocation(store.activeID, { ...base, dev_id: device.dev_id, host_name: device.name })
  return { ok: true, ...base, dev_id: device.dev_id, name: device.name, address }
}
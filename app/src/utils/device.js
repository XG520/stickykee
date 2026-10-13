// 设备身份与注册：每个运行本应用的浏览器/设备用一个持久化唯一 ID 自动识别，
// 注册到后端设备表（按 device_id 去重，不重复添加），并支持设置别名。
import api from '@/api'

const DEV_ID_KEY = 'hc_device_id'
const DEV_CACHE_KEY = 'hc_device'

// 本地唯一标识：APK 内优先系统级 ANDROID_ID（原生桥 deviceUid）——卸载重装、
// 清应用数据后不变，避免多次安装产生重复设备；取不到再回退 localStorage UUID。
// Web 端无原生桥，用 localStorage 持久化 UUID（同设备各浏览器独立）。
function genId() {
  return (crypto.randomUUID && crypto.randomUUID())
    ? crypto.randomUUID()
    : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2)
}
export function getDeviceId() {
  try {
    const n = window.StickyKeeNative
    if (n && typeof n.deviceUid === 'function') {
      const uid = (n.deviceUid() || '').trim()
      if (uid) {
        // 原生 UID 每次都稳定，但仍落一次 localStorage 作为原生桥异常时的兜底
        if (localStorage.getItem(DEV_ID_KEY) !== uid) localStorage.setItem(DEV_ID_KEY, uid)
        return uid
      }
    }
    let id = localStorage.getItem(DEV_ID_KEY)
    if (!id) { id = genId(); localStorage.setItem(DEV_ID_KEY, id) }
    return id
  } catch { return genId() }
}

// 根据 UA 生成友好的设备默认名（可被用户改名）。
export function friendlyDeviceLabel() {
  const ua = navigator.userAgent || ''
  if (/iPad/.test(ua)) return 'iPad'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android 手机'
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  if (/Win/i.test(p)) return 'Windows 电脑'
  if (/Mac/i.test(p)) return 'Mac'
  if (/Linux/i.test(p)) return 'Linux 设备'
  return '浏览器设备'
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(DEV_CACHE_KEY) || 'null') } catch { return null }
}
function writeCache(d) { try { localStorage.setItem(DEV_CACHE_KEY, JSON.stringify(d)) } catch {} }

// 确保当前设备已注册，返回 device { device_id, name, dev_id }。
// 已注册过则沿用既有别名，不做重复添加。
export async function ensureDevice() {
  const id = getDeviceId()
  const cached = readCache()
  if (cached && cached.device_id === id && cached.name) return cached
  let existing = null
  try {
    const { data } = await api.getDevices()
    const arr = Array.isArray(data) ? data : (data && data.data) || []
    existing = arr.find((d) => d.device_id === id) || null
  } catch { /* 后端离线时仍用缓存 */ }
  const name = (existing && existing.name) || (cached && cached.name) || friendlyDeviceLabel()
  const { data: device } = await api.registerDevice({ device_id: id, name })
  writeCache(device)
  return device
}

// 获取本机设备（可能调用后端列表，保证别名是最新的）。
export async function currentDevice() {
  const id = getDeviceId()
  try {
    const { data } = await api.getDevices()
    const arr = Array.isArray(data) ? data : (data && data.data) || []
    const found = arr.find((d) => d.device_id === id)
    if (found) return found
  } catch { /* 忽略 */ }
  const cached = readCache()
  return cached || { device_id: id, name: friendlyDeviceLabel(), dev_id: id }
}

export async function listDevices() {
  const { data } = await api.getDevices()
  return Array.isArray(data) ? data : (data && data.data) || []
}
export async function renameDevice(deviceId, name) {
  const { data } = await api.renameDevice(deviceId, name)
  if (deviceId === getDeviceId()) writeCache(data)
  return data
}
export async function deleteDevice(deviceId) {
  const { data } = await api.deleteDevice(deviceId)
  if (deviceId === getDeviceId()) try { localStorage.removeItem(DEV_CACHE_KEY) } catch {}
  return data
}
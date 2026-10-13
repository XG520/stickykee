// 高德地图 JS SDK 动态加载（单例，避免重复注入 script）。
import { getPrefs } from '@/utils/prefs'

let cache = null
let promise = null

// 瓦片离线缓存：SDK 首次加载成功后注册 SW（仅 https；http 内网/本地自动跳过）。
// SW 按域名只拦瓦片 CDN，应用资源与 API 不受影响。
let swRegistered = false
function registerTileSW() {
  if (swRegistered) return
  swRegistered = true
  try {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  } catch { /* 忽略 */ }
}

// loadAMap(key) → Promise<window.AMap>。key 变化时强制重新加载。
export function loadAMap(rawKey) {
  const key = (rawKey || '').trim()
  if (!key) return Promise.reject(new Error('未配置高德地图 Key'))
  if (cache === key && window.AMap) return Promise.resolve(window.AMap)
  cache = key
  promise = null
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      registerTileSW()
      resolve(window.AMap)
      return
    }
    const existing = document.querySelector(`script[data-amap-key]`)
    if (existing && existing.dataset.amapKey === key) {
      waitReady(resolve, reject)
      return
    }
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.Marker,AMap.Scale`
    script.async = true
    script.dataset.amapKey = key
    script.onerror = () => reject(new Error('高德地图 SDK 加载失败，请检查 Key 与网络'))
    document.head.appendChild(script)
    waitReady((am) => { registerTileSW(); resolve(am) }, reject)
  })
}

function waitReady(resolve, reject) {
  const t0 = Date.now()
  const check = () => {
    if (window.AMap) { resolve(window.AMap); return }
    if (Date.now() - t0 > 20000) { reject(new Error('高德地图 SDK 加载超时')); return }
    setTimeout(check, 100)
  }
  check()
}

// 读取实例配置里的高德 Key（prefs.map_config.amap_key），进程内缓存。
let keyCache = null
export async function getAmapKey() {
  if (keyCache !== null) return keyCache
  try {
    const { data } = await getPrefs()
    let mc = {}
    if (data && data.map_config) { try { mc = JSON.parse(data.map_config) } catch { /* 忽略坏 JSON */ } }
    keyCache = (mc.amap_key || '').trim()
  } catch { keyCache = '' }
  return keyCache
}

// 卡片 js（new Function 环境，无模块 import 能力）经 window 使用以上能力：
//   window.skAmapKey()  → Promise<string> 当前配置的高德 Key
//   window.skLoadAMap(k) → Promise<AMap> 加载 SDK
if (typeof window !== 'undefined') {
  window.skAmapKey = getAmapKey
  window.skLoadAMap = loadAMap
}
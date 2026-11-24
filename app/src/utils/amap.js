// 高德地图 JS SDK 动态加载（单例，避免重复注入 script）。
import { getPrefs } from '@/utils/prefs'

let cache = null

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
// 失败后再次调用会重新注入 script（失败脚本会被移除），因此支持「重试」。
export function loadAMap(rawKey) {
  const key = (rawKey || '').trim()
  if (!key) return Promise.reject(new Error('未配置高德地图 Key'))
  if (cache === key && window.AMap) return Promise.resolve(window.AMap)
  cache = key
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      registerTileSW()
      resolve(window.AMap)
      return
    }
    const existing = document.querySelector('script[data-amap-key]')
    if (existing && existing.dataset.amapKey === key) {
      // 上一次已失败/超时的脚本不能复用，先移除再重新加载
      if (existing.dataset.state === 'error') existing.remove()
      else if (existing.dataset.state === 'loading') {
        waitReady(resolve, (err) => {
          existing.dataset.state = 'error'
          try { existing.remove() } catch { /* 忽略 */ }
          reject(err)
        })
        return
      }
    }

    let settled = false
    const fail = (msg) => {
      if (settled) return
      settled = true
      reject(new Error(msg))
    }

    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.Marker,AMap.Scale`
    script.async = true
    script.dataset.amapKey = key
    script.dataset.state = 'loading'
    script.onerror = () => {
      script.dataset.state = 'error'
      try { script.remove() } catch { /* 忽略 */ }
      fail('无法连接高德地图服务器（webapi.amap.com）。若手机连着不能上外网的局域网 WiFi，请切换到移动数据后重试')
    }
    // Key 不正确时高德仍返回 200，但脚本不产生 window.AMap，需在这里明确报错而不是干等超时
    script.onload = () => {
      script.dataset.state = window.AMap ? 'ok' : 'error'
      if (!window.AMap) {
        try { script.remove() } catch { /* 忽略 */ }
        fail('高德地图 SDK 不可用：请确认 Key 正确、未过期，且类型为「Web端(JS API)」')
        return
      }
      registerTileSW()
      resolve(window.AMap)
      settled = true
    }
    document.head.appendChild(script)
    waitReady((am) => {
      if (settled) return
      settled = true
      registerTileSW()
      resolve(am)
    }, (err) => {
      script.dataset.state = 'error'
      try { script.remove() } catch { /* 忽略 */ }
      fail(err.message)
    })
  })
}

function waitReady(resolve, reject) {
  const t0 = Date.now()
  const check = () => {
    if (window.AMap) { resolve(window.AMap); return }
    if (Date.now() - t0 > 20000) { reject(new Error('高德地图 SDK 加载超时，请检查网络后重试')); return }
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

// 高德地图 JS SDK 动态加载（单例，避免重复注入 script）。
let cache = null
let promise = null

// loadAMap(key) → Promise<window.AMap>。key 变化时强制重新加载。
export function loadAMap(rawKey) {
  const key = (rawKey || '').trim()
  if (!key) return Promise.reject(new Error('未配置高德地图 Key'))
  if (cache === key && window.AMap) return Promise.resolve(window.AMap)
  cache = key
  promise = null
  return new Promise((resolve, reject) => {
    if (window.AMap) {
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
    waitReady(resolve, reject)
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
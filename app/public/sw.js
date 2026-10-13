// 高德地图瓦片离线缓存 Service Worker：
// cache-first——命中缓存直接回，未命中回源并写入缓存，实现"看过的地方离线也能看"。
// 仅拦截瓦片 CDN 域名（autonavi / vdata.amap.com），应用自身资源与接口完全不经此处理。
const CACHE = 'amap-tiles-v1'
const MAX = 2500 // 缓存条目上限，超出按先进先出淘汰，防止无限膨胀

const TILE_HOSTS = [
  /\.is\.autonavi\.com$/i, // 高德瓦片 CDN（wprd*/webst*）
  /^vdata\.amap\.com$/i,   // JS API 2.0 矢量瓦片
]

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  let url
  try { url = new URL(e.request.url) } catch { return }
  if (!TILE_HOSTS.some((re) => re.test(url.hostname))) return
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(e.request)
    if (hit) return hit
    try {
      const res = await fetch(e.request)
      // ok=正常 CORS 响应；opaque=瓦片 <img> 无 CORS 的不透明响应，同样可缓存
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(e.request, res.clone()).then(trim).catch(() => {})
      }
      return res
    } catch {
      // 离线且未缓存：返回 504，地图该块留白但不报错刷屏
      return new Response('', { status: 504, statusText: 'offline' })
    }
  })())
})

async function trim() {
  const cache = await caches.open(CACHE)
  const keys = await cache.keys()
  if (keys.length <= MAX) return
  for (const k of keys.slice(0, keys.length - MAX)) await cache.delete(k)
}

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(
      names.filter((n) => n.startsWith('amap-tiles-') && n !== CACHE).map((n) => caches.delete(n)),
    )
    await self.clients.claim()
  })())
})

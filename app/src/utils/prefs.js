// 统一的 /prefs 访问层。
//
// 背景：启动时有三处各自请求同一份偏好（HA token 状态、主题、首页仪表盘布局），
// 加上 autoSync/设置页/消息中心/地图等零散调用，实测启动阶段同一份数据被请求多次。
// 这里提供：
//   1) 进行中合并：同时发起的调用共享同一个请求；
//   2) 短 TTL 缓存：紧接着的第二次调用直接复用（避免「布局请求」又一次往返）；
//   3) 写后失效：任何写入都立刻作废缓存，保证读到的不会是本地刚改过之前的值。
//
// TTL 只影响「别的设备改过、我这边还没写」这种跨端场景，窗口 2 秒，可接受。
import api from '@/api'

const TTL = 2000
let cache = null      // 最近一次成功的 data
let at = 0            // 缓存写入时间
let inflight = null   // 进行中的请求

// 读取偏好。force=true 绕过缓存（需要绝对新鲜值时使用）。
export function getPrefs({ force = false } = {}) {
  if (!force && cache && Date.now() - at < TTL) return Promise.resolve({ data: cache })
  if (inflight) return inflight
  inflight = api.getPrefs()
    .then((res) => {
      cache = res?.data || {}
      at = Date.now()
      return res
    })
    .finally(() => { inflight = null })
  return inflight
}

// 写入偏好：成功后立即失效本地缓存。
export async function putPrefs(body) {
  const res = await api.putPrefs(body)
  invalidate()
  return res
}

export function invalidate() {
  cache = null
  at = 0
}

// 同步读取当前缓存值（无缓存返回 null）；用于不需要等待网络的场景。
export function currentPrefs() {
  return cache
}
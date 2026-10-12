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

const SNAP_KEY = 'prefs_snapshot'

// 最近一次已知偏好的本地快照（localStorage）。服务器不可达（如 APK 离线用
// 本地 TTS）时作为兜底数据源，保证本机已保存的设置仍然可读可写。
function loadSnapshot() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || 'null') || {} } catch { return {} }
}
function saveSnapshot(data) {
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(data || {})) } catch { /* 隐私模式等 */ }
}

// 读取偏好。force=true 绕过缓存（需要绝对新鲜值时使用）。
// 服务器不可达时回退本地快照（不 reject），离线功能依赖此行为。
export function getPrefs({ force = false } = {}) {
  if (!force && cache && Date.now() - at < TTL) return Promise.resolve({ data: cache })
  if (inflight) return inflight
  inflight = api.getPrefs()
    .then((res) => {
      cache = res?.data || {}
      at = Date.now()
      saveSnapshot(cache)
      return res
    })
    .catch(() => {
      if (!cache) { cache = loadSnapshot(); at = 0 }
      return { data: cache || {} }
    })
    .finally(() => { inflight = null })
  return inflight
}

// 写入偏好：成功后立即失效本地缓存。
// 写入失败（离线）时合并进本地快照，保证本机设置离线立即生效；错误向上抛出由调用方静默。
export async function putPrefs(body) {
  try {
    const res = await api.putPrefs(body)
    invalidate()
    saveSnapshot({ ...loadSnapshot(), ...body })
    return res
  } catch (e) {
    cache = { ...(cache || loadSnapshot()), ...body }
    at = Date.now()
    saveSnapshot(cache)
    throw e
  }
}

export function invalidate() {
  cache = null
  at = 0
}

// 同步读取当前缓存值（无缓存返回 null）；用于不需要等待网络的场景。
export function currentPrefs() {
  return cache
}
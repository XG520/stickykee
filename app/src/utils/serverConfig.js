// APK 服务器地址簿：数据统一经原生桥（StickyKeeNative → SharedPreferences）存取，
// 与壳页（localhost 源）共用同一份配置——两者不同源，localStorage 互相不可见，
// 只有原生层能被两端读写。Web 端无 StickyKeeNative，isApk 为 false，所有入口不渲染。
import { ref } from 'vue'

// 仅当原生桥具备新存储接口时才算 APK 环境（旧版 APK 缺接口时隐藏入口，避免写入无效的 localStorage）
export const isApk = typeof window !== 'undefined'
  && !!window.StickyKeeNative
  && typeof window.StickyKeeNative.getServerConfig === 'function'

const EMPTY = { addresses: [], activeId: null, lastConnectedId: null }

// 读取地址簿 { addresses:[{id,name,url,type}], activeId, lastConnectedId }
export function loadConfig() {
  if (!isApk) return { ...EMPTY }
  try {
    const raw = window.StickyKeeNative.getServerConfig()
    if (raw) {
      const cfg = JSON.parse(raw)
      if (cfg && Array.isArray(cfg.addresses)) return cfg
    }
  } catch { /* 桥异常/JSON 损坏：返回空配置 */ }
  return { ...EMPTY }
}

export function saveConfig(cfg) {
  if (!isApk) return
  try { window.StickyKeeNative.setServerConfig(JSON.stringify(cfg)) } catch { /* 存储失败静默 */ }
}

// 当前使用中的地址（activeId 优先，退回第一个）
export function activeAddress() {
  const cfg = loadConfig()
  return cfg.addresses.find(a => a.id === cfg.activeId) || cfg.addresses[0] || null
}

export function genId() {
  return 'srv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
}

// ---- 探测（与壳页同策略：no-cors fetch 不读 body，不受 CORS 限制） ----
// fetch 对非法 URL 会同步抛错，executor 必须 try/catch，否则表现为「点保存无反应」。
export function probe(url, timeout = 3500) {
  return new Promise(resolve => {
    let done = false
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const finish = ok => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => {
      finish(false)
      try { ctrl && ctrl.abort() } catch { /* 已结束 */ }
    }, timeout)
    try {
      fetch(url + '/healthz', { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(() => finish(true))
        .catch(() => finish(false))
    } catch { finish(false) }
  })
}

// 读取后端版本（/healthz 的 {version}，需 CORS 头；拿不到返回 null，界面隐藏徽标）
export function fetchVersion(url, timeout = 3000) {
  return new Promise(resolve => {
    let done = false
    const finish = v => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeout)
    try {
      fetch(url + '/healthz', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          const v = j ? (j.version || (j.data && j.data.version)) : null
          finish(v ? String(v).replace(/^v/i, '') : null)
        })
        .catch(() => finish(null))
    } catch { finish(null) }
  })
}

// 当前网络类型：WiFi/有线 → lan，蜂窝 → wan，未知 → unknown
export function getNetworkType() {
  const c = (typeof navigator !== 'undefined' && navigator.connection) || {}
  if (c.type === 'wifi' || c.type === 'ethernet') return 'lan'
  if (c.type === 'cellular') return 'wan'
  return 'unknown'
}

// 切换服务器：写回 activeId、重启原生连接看门狗、整页跳转（登录态随目标服务器源）
export async function switchTo(addr) {
  const ok = await probe(addr.url)
  if (!ok) return false
  const cfg = loadConfig()
  cfg.activeId = addr.id
  cfg.lastConnectedId = addr.id
  saveConfig(cfg)
  try {
    const n = window.StickyKeeNative
    if (n && typeof n.connWatch === 'function') n.connWatch(addr.url)
  } catch { /* 桥不可用则无看门狗兜底 */ }
  window.location.replace(addr.url + '/')
  return true
}

// ---- 应用内管理抽屉的全局开关（App.vue 挂载 Sheet，任意入口一键打开） ----
export const sheetOpen = ref(false)
export function openServerSheet() { sheetOpen.value = true }
export function closeServerSheet() { sheetOpen.value = false }

// 前端诊断日志采集：仅在管理员开启诊断后启用，采集 console 错误、未捕获异常、
// 请求失败 / 慢请求、WebSocket 连接变化与网络状态；由设置页批量上传给后端。
const MAX_PENDING = 600

let pending = []
let running = false
let originals = null

function push(level, msg) {
  if (!running) return
  const text = String(msg || '').slice(0, 1500)
  if (!text) return
  pending.push({ level, msg: text })
  if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING)
}

function formatArg(a) {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || a.message || String(a)
  try {
    const s = JSON.stringify(a)
    return s && s !== '{}' ? s : String(a)
  } catch {
    return String(a)
  }
}

function formatArgs(args) {
  return Array.from(args || []).map(formatArg).join(' ')
}

function stripQuery(url) {
  try {
    const u = new URL(String(url), window.location.origin)
    return u.origin === window.location.origin ? u.pathname : u.origin + u.pathname
  } catch {
    return String(url || '').split('?')[0]
  }
}

function onWindowError(ev) {
  const target = ev.target
  if (target && target !== window && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
    push('warn', `资源加载失败：<${target.tagName.toLowerCase()}> ${target.src || target.href || ''}`)
    return
  }
  if (ev.message) {
    push('error', `${ev.message} @ ${ev.filename || ''}:${ev.lineno || 0}:${ev.colno || 0}`)
  }
}

function onRejection(ev) {
  const r = ev.reason
  push('error', `未处理的 Promise 拒绝：${formatArg(r)}`)
}

function onOnline() { push('info', '网络恢复在线') }
function onOffline() { push('warn', '网络已离线') }

// 开始采集（重复调用无副作用）
export function startDiagCapture() {
  if (running) return
  running = true
  pending = []
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  const origFetch = window.fetch.bind(window)
  const OrigWS = window.WebSocket

  console.error = (...args) => {
    push('error', formatArgs(args))
    origError(...args)
  }
  console.warn = (...args) => {
    push('warn', formatArgs(args))
    origWarn(...args)
  }

  window.fetch = (...args) => {
    const input = args[0]
    const init = args[1] || {}
    const url = typeof input === 'string' ? input : input?.url || ''
    const method = String(init.method || input?.method || 'GET').toUpperCase()
    const skip = url.includes('/diagnostics/logs')
    const started = performance.now()
    return origFetch(...args)
      .then((res) => {
        const ms = Math.round(performance.now() - started)
        if (!skip) {
          if (!res.ok) push(res.status >= 500 ? 'error' : 'warn', `HTTP ${res.status} ${method} ${stripQuery(url)} (${ms}ms)`)
          else if (ms > 2000) push('warn', `慢请求 ${method} ${stripQuery(url)} (${ms}ms)`)
        }
        return res
      })
      .catch((err) => {
        if (!skip) push('error', `请求失败 ${method} ${stripQuery(url)}：${err?.message || err}`)
        throw err
      })
  }

  // WebSocket 连接状态对诊断 HA 实时连接问题很关键
  class DiagWebSocket extends OrigWS {
    constructor(url, protocols) {
      super(url, protocols)
      const safe = stripQuery(url)
      this.addEventListener('open', () => push('info', `WebSocket 已连接：${safe}`))
      this.addEventListener('error', () => push('error', `WebSocket 连接错误：${safe}`))
      this.addEventListener('close', (e) => push(e.code === 1000 ? 'info' : 'warn', `WebSocket 已关闭：${safe} code=${e.code}${e.reason ? ' ' + e.reason : ''}`))
    }
  }
  window.WebSocket = DiagWebSocket

  window.addEventListener('error', onWindowError, true)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  originals = { origError, origWarn, origFetch, OrigWS }
  push('info', `诊断采集已启动 · ${navigator.userAgent}`)
}

// 停止采集并恢复所有原生方法
export function stopDiagCapture() {
  if (!running) return
  running = false
  if (originals) {
    console.error = originals.origError
    console.warn = originals.origWarn
    window.fetch = originals.origFetch
    window.WebSocket = originals.OrigWS
    originals = null
  }
  window.removeEventListener('error', onWindowError, true)
  window.removeEventListener('unhandledrejection', onRejection)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
}

// 取出尚未上传的日志（并清空缓冲）
export function drainDiagLogs() {
  const out = pending
  pending = []
  return out
}

// 浏览器环境信息（随开始诊断一起上报）
export function diagClientMeta() {
  const nav = navigator
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection
  const mem = performance.memory
  const meta = {
    ua: nav.userAgent,
    platform: nav.platform || '',
    language: nav.language || '',
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}@${window.devicePixelRatio || 1}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    route: window.location.pathname + window.location.hash,
    online: String(nav.onLine),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  }
  if (conn?.effectiveType) meta.connection = `${conn.effectiveType}/${conn.downlink || '?'}Mbps`
  if (mem) meta.js_memory = `${Math.round(mem.usedJSHeapSize / 1048576)}/${Math.round(mem.jsHeapSizeLimit / 1048576)}MB`
  return meta
}

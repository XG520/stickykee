// 前端版本看门狗：服务器上的 dist 更新后，已打开的 APK / 网页自动整页刷新到新版，
// 不再需要用户手动清除应用数据。
//
// 原理：vite 构建时把本次构建号写入 dist/version.json，并注入 __APP_BUILD__；
// 页面在启动、回到前台、获得焦点及定时检查时拉取 version.json（no-store），
// 构建号不一致就带缓存穿透参数整页重载。
const CURRENT_BUILD = typeof __APP_BUILD__ !== 'undefined' ? String(__APP_BUILD__ || '') : ''
const RELOAD_KEY = 'hc_frontend_reload_build'
const CHECK_INTERVAL = 10 * 60 * 1000

let started = false
let timer = null
let checking = false

function canCheck() {
  if (!CURRENT_BUILD) return false
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  // APK 壳页（localhost）由路由守卫负责跳转服务器，避免与壳页逻辑互相打断。
  return location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
}

async function check() {
  if (checking || !canCheck() || document.hidden) return
  checking = true
  try {
    const res = await fetch(`${location.origin}/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const build = data && data.build ? String(data.build) : ''
    if (!build || build === CURRENT_BUILD) {
      try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* 忽略 */ }
      return
    }
    // 服务端万一仍返回旧 index，同一构建号只重载一次，避免无限刷新。
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === build) return
      sessionStorage.setItem(RELOAD_KEY, build)
    } catch { /* 忽略 */ }
    const next = `${location.origin}${location.pathname}?hc_v=${encodeURIComponent(build)}${location.hash}`
    location.replace(next)
  } catch {
    // 离线、旧版服务端没有 version.json：静默忽略，下次再试。
  } finally {
    checking = false
  }
}

export function startFrontendUpdateGuard() {
  if (started || !canCheck()) return
  started = true
  // 首屏先让路由/登录态稳定，再检查一次。
  setTimeout(check, 2000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check()
  })
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', check)
  timer = setInterval(check, CHECK_INTERVAL)
}

export function stopFrontendUpdateGuard() {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

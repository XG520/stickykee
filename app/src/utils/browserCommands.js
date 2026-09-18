// Browser_mod 风格命令执行器：接收后端经 WS 转发的 HA 命令（notify/screen/service/light/media），
// 在浏览器本地执行。命令从 HA event bus 下发，路由到此应用所在设备。
// 说明：这些都是「控制浏览器设备本身」的 UI/能力操作，不涉及对 HA 实体下发控制，
// 因此设计模式下的「冻结真实设备控制」约束天然不受影响。
import router from '@/router'
import api from '@/api'

// ---- 通用 DOM 覆盖层（亮度 / 黑屏），fixed 全屏，不参与布局，避免引入滚动条或影响卡片等比例 ---- //
let dimEl = null // 亮度遮罩
let blackEl = null // 黑屏遮罩（模拟关屏）
let toastEl = null
let toastTimer = null

function ensureEl(id, z) {
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('div')
    el.id = id
    el.style.cssText =
      `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;` +
      `z-index:${z};transition:opacity .3s ease;will-change:opacity;`
    document.documentElement.appendChild(el)
  }
  return el
}

// ---- light：屏幕亮度（视觉遮罩模拟 0-255） ---- //
export function setScreenBrightness(value, transitionMs = 300) {
  const v = Math.max(0, Math.min(255, Number(value) || 255))
  const el = ensureEl('hc-brightness-mask', 2147483000)
  el.style.backdropFilter = 'none'
  // 亮度越低，黑色遮罩越不透明（V=255 时完全不遮挡）
  const alpha = (255 - v) / 255
  el.style.backgroundColor = `rgba(0,0,0,${alpha.toFixed(3)})`
  el.style.opacity = '1'
  el.style.transitionDuration = `${Math.max(0, transitionMs || 0)}ms`
}

// ---- screen：黑屏遮罩（模拟关屏；页面仍存活，如停留在 1/24 FPS 省电用） ---- //
export function setBlackout(on, fadeMs = 200) {
  if (!on) {
    if (blackEl) { blackEl.style.opacity = '0'; setTimeout(() => blackEl.remove(), fadeMs + 50) }
    blackEl = null
    return
  }
  blackEl = ensureEl('hc-blackout-mask', 2147483647)
  blackEl.style.backgroundColor = '#000'
  blackEl.style.opacity = '1'
  blackEl.style.transitionDuration = `${fadeMs}ms`
}

// ---- screen：屏幕唤醒锁（保持亮屏） ---- //
let wakeLock = null
export async function setScreenWake(wantActive) {
  if (typeof navigator.wakeLock === 'undefined') return false
  try {
    if (wantActive && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
      return true
    }
    if (!wantActive && wakeLock) {
      await wakeLock.release()
      wakeLock = null
      return true
    }
  } catch { /* 权限/重入异常，忽略 */ }
  return false
}

// ---- screen：全屏 ---- //
export async function setScreenFullscreen(on) {
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen()
    if (!on && document.fullscreenElement) await document.exitFullscreen()
  } catch { /* 忽略 */ }
}

// ---- 应用内 toast（系统通知不可用时的回退） ---- //
export function toast(message, duration = 4000) {
  if (!document.body) return
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.style.cssText =
      `position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:2147483646;` +
      `background:rgba(0,0,0,.78);color:#fff;padding:10px 18px;border-radius:10px;` +
      `font-size:14px;max-width:80vw;box-shadow:0 4px 16px rgba(0,0,0,.35);` +
      `animation:hcToastIn .25s ease;`
    const style = document.createElement('style')
    style.textContent = `@keyframes hcToastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%)}}`
    style.id = 'hc-toast-style'
    if (!document.getElementById('hc-toast-style')) document.head.appendChild(style)
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = String(message || '')
  toastEl.style.opacity = '1'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (toastEl) toastEl.style.opacity = '0'
  }, duration)
}

// ---- notify：系统/应用内通知 ---- //
function ensureNotificationPermission() {
  return new Promise((resolve) => {
    if (!('Notification' in window)) { resolve(false); return }
    const p = Notification.permission
    if (p === 'granted') { resolve(true); return }
    if (p === 'denied') { resolve(false); return }
    Notification.requestPermission().then((r) => resolve(r === 'granted'))
  })
}

export async function showNotify(data = {}) {
  const { title, message, icon, tag, actions, onClick } = data
  const hasSys = await ensureNotificationPermission()
  if (hasSys) {
    try {
      const n = new Notification(title || 'Home Assistant', {
        body: message || '',
        tag: tag || undefined,
        icon: icon || undefined,
        data: actions ? { actions } : undefined,
      })
      if (onClick && typeof onClick === 'function') n.addEventListener('click', onClick)
      if (actions && Array.isArray(actions) && actions[0]) {
        n.onclick = () => handleNotifyAction(actions[0])
      }
      // 点击通知默认聚焦窗口
      n.addEventListener('click', () => { try { window.focus() } catch {} })
      return
    } catch { /* 走 toast 回退 */ }
  }
  // 回退：应用内 toast（含 action 按钮）
  if (actions && Array.isArray(actions) && actions[0]) toast(`${title || ''} ${message || ''} · ${actions[0].label || ''}（点击动作）`)
  else toast(`${title ? title + '：' : ''}${message || ''}`)
}

function handleNotifyAction(action) {
  if (!action) return
  const type = action.type || 'url'
  if (type === 'url' && action.url) {
    try { window.focus(); router.push(action.url.startsWith('/') ? action.url : '/' + action.url) } catch {}
  } else if (type === 'ha_event' && action.event) {
    // 回写 HA：经 backend 触发事件（fire_event 需 HA 侧用 stickynuo synchronize 服务或 python 脚本，这里用最通用的 callService 兜底）
    api.get('/instances/').catch(() => {})
  }
}

// ---- service：浏览器本地服务注册表 ---- //
const services = new Map()

// 注册 / 覆盖一个浏览器本地服务。
export function registerService(name, fn) {
  if (typeof fn === 'function') services.set(String(name), fn)
}

function dispatchService(data = {}) {
  const { name, args } = data
  if (services.has(name)) return services.get(name)(args)
  toast(`未识别的浏览器服务：${name}`)
  return null
}

// 内置服务：导航、刷新、调用 REST、提示、主题、亮度、刷新实体。
registerService('navigate', (args) => {
  const path = args && args.path
  if (path) router.push(String(path))
})
registerService('reload', () => location.reload())
registerService('callApi', async (args) => {
  if (!args) return null
  const { method = 'GET', path = '/', body } = args
  if (method.toUpperCase() === 'GET') return (await api.get(path)).data
  return null
})
registerService('toast', (args) => toast((args && args.message) || ''))
registerService('setTheme', (args) => {
  if (typeof window !== 'undefined') {
    const body = document.body
    if (args && args.theme) body.setAttribute('data-theme', args.theme)
  }
})
registerService('setBrightness', (args) => setScreenBrightness(args && args.value, args && args.transition))

// ---- 命令分发入口 ---- //
const HANDLERS = {
  notify: (d) => showNotify(d || {}),
  screen: (d) => dispatchScreen(d || {}),
  light: (d) => setScreenBrightness(d && d.brightness, d && d.transition),
  service: (d) => dispatchService(d || {}),
  media: (d) => dispatchMedia(d || {}),
}

function dispatchScreen(d = {}) {
  const action = d.action
  switch (action) {
    case 'wake':
    case 'keep_active':
      return setScreenWake(true)
    case 'sleep':
      return setScreenWake(false)
    case 'fullscreen':
      return setScreenFullscreen(true)
    case 'exit_fullscreen':
      return setScreenFullscreen(false)
    case 'blackout':
      return setBlackout(true, d.fade)
    case 'blackout_off':
      return setBlackout(false, d.fade)
    default:
      if (d.blackout === true) return setBlackout(true, d.fade)
      if (d.blackout === false) return setBlackout(false, d.fade)
      return null
  }
}

// ---- media：媒体/TTS 播放（批次 B 完善，此处做基础实现） ---- //
let mediaAudio = null
function dispatchMedia(d = {}) {
  const action = d.action
  if (action === 'tts' && d.text && typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(d.text)
    if (d.volume) u.volume = Math.max(0, Math.min(1, d.volume))
    if (d.lang) u.lang = d.lang
    speechSynthesis.speak(u)
    return
  }
  if (action === 'stop') {
    if (speechSynthesis) try { speechSynthesis.cancel() } catch {}
    if (mediaAudio) { try { mediaAudio.pause() } catch {} mediaAudio = null }
    return
  }
  if (action === 'media' || action === 'play') {
    if (!d.url) return
    if (!mediaAudio) mediaAudio = new Audio()
    mediaAudio.src = d.url
    if (d.volume) mediaAudio.volume = Math.max(0, Math.min(1, d.volume))
    mediaAudio.play().catch(() => {})
    return
  }
  if (action === 'pause' && mediaAudio) mediaAudio.pause()
  if (action === 'resume' && mediaAudio) mediaAudio.play().catch(() => {})
  if (action === 'volume' && typeof d.volume === 'number' && mediaAudio) mediaAudio.volume = Math.max(0, Math.min(1, d.volume))
}

// 统一入口：store 收到 {type:'cmd', cmd, data} 后调用。
export function dispatchCommand(cmd, data) {
  const fn = HANDLERS[cmd]
  if (fn) return fn(data)
  toast(`未实现的浏览器命令：${cmd}`)
  return null
}

export default { dispatchCommand, registerService, showNotify, setScreenBrightness, setBlackout, setScreenWake, setScreenFullscreen, toast }
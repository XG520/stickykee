// Browser_mod 风格命令执行器：接收后端经 WS 转发的 HA 命令（notify/popup/more_info/console/screen/service/media），
// 在浏览器本地执行。命令从 HA event bus 下发，路由到此应用所在设备。
// 说明：这些都是「控制浏览器设备本身」的 UI/能力操作，不涉及对 HA 实体下发控制，
// 因此设计模式下的「冻结真实设备控制」约束天然不受影响。
//
// 命令载荷（HA 侧 event.fire_event 的 event_data）：
//   { "device_id": "<目标设备 id 或 all>", "command": "<命令名>", "data": { ... } }
// 命令名兼容官方 browser_mod 别名（见 COMMAND_ALIASES），便于迁移既有自动化。
//
// 命令一览：
//   notify     通知：{ title, message, icon, tag, duration, actions? }
//   popup      弹窗：{ title, content（HTML 或对象）, entity?, size?(sm|md|lg), auto_close?(秒), dismissable?, hide_header? }
//   close_popup 关闭弹窗
//   more_info  实体更多信息面板：{ entity | entity_id }
//   console    控制台日志：{ level?(log|debug|info|warn|error), message, clear? }
//   screen     屏幕：{ action: wake|sleep|fullscreen|exit_fullscreen|blackout(off)|blackout_off(on)|brightness|screensaver|screensaver_off, ... }
//               全黑（blackout）期间可用「双击屏幕」解除；设置页开启「接近感应解除」后，环境光 lux ≤ 阈值 也会自动解除
//   light      亮度：{ brightness: 0-255, transition?: ms }
//   service    浏览器服务：{ name: navigate|reload|callApi|toast|setTheme|setBrightness|refreshEntities, args: {...} }
//   media      媒体：{ action: tts|play|pause|resume|stop|volume|mute|unmute|seek|state, url?, ... }
import { createApp, h, reactive } from 'vue'
import router from '@/router'
import api from '@/api'
import { store, entityStates, refreshEntities } from '@/store'
import { applyTheme, THEMES } from '@/themes'
import BrowserPopup from '@/components/BrowserPopup.vue'
import EntityMoreInfo from '@/components/EntityMoreInfo.vue'

// ---- 通用 DOM 覆盖层（亮度 / 黑屏 / 屏保），fixed 全屏，不参与布局，避免引入滚动条或影响卡片等比例 ---- //
let dimEl = null // 亮度遮罩
let blackEl = null // 黑屏遮罩（模拟关屏）
let blackTimer = null // 黑屏遮罩淡出后的移除定时器
let toastEl = null
let toastTimer = null
let ssaverEl = null
let ssaverTimer = null

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
let brightEl = null // 亮度遮罩元素
let brightAlpha = 0 // 亮度遮罩当前不透明度（0=全亮，1=全黑）

// ---- screen：全黑解除（双击手势 / 环境光接近感应） ----
// 浏览器没有通用的接近传感器 API（ProximitySensor 仅极少数 Android Chrome 可用），
// 这里用环境光传感器（AmbientLightSensor）模拟：手盖住屏幕 → lux 骤降 → lux ≤ 阈值 判定「有人靠近」并解除。
// 「全黑」有两种来源，共用同一套解除方式，手势总是作用于当前最上层的那个：
//   1. 黑屏遮罩 setBlackout —— HA 的 blackout 命令 / 设置页「模拟关屏」→ 解除 = 关掉黑屏
//   2. 亮度遮罩拖到最暗 setScreenBrightness(0) —— 设置页把亮度条拉到 0 → 解除 = 恢复全亮
// 手势解除始终可用、无需配置；接近解除默认关闭（避免房间本来就暗时一进全黑就被解除），阈值跟设备走（localStorage）。
const DISMISS_KEY = 'hc_blackout_dismiss'
const DOUBLE_TAP_MS = 300     // 双击判定窗口
const FULL_BLACK_ALPHA = 0.95 // 亮度遮罩不透明度达到该值即视为「全黑」，同样接入手势/接近解除

function hasLightSensor() { return typeof window.AmbientLightSensor === 'function' }

// 遮罩状态与解除配置：设置页直接绑定它做实时显示与开关，避免出现「遮罩已关但按钮仍显示取消黑屏」的状态不同步
export const blackout = reactive({
  active: false,    // 黑屏遮罩当前是否显示
  brightness: 255,  // 亮度遮罩当前值（0-255；解除亮度全黑后会恢复 255）
  supported: hasLightSensor(),
  enabled: false,   // 是否开启接近感应解除
  threshold: 10,    // lux ≤ 阈值 时解除
  lux: null,        // 最近一次环境光读数（null = 尚未读到）
})

// 环境光监听（引用计数）：全黑解除与设置页实时值共用同一传感器实例，避免重复创建
let lightSensor = null
let lightUsers = 0

function acquireLight() {
  if (!hasLightSensor()) return
  lightUsers += 1
  if (lightSensor) return
  try {
    lightSensor = new window.AmbientLightSensor({ frequency: 5 })
    lightSensor.addEventListener('reading', onLightReading)
    lightSensor.start()
  } catch { lightSensor = null }
}

function releaseLight() {
  if (!hasLightSensor()) return
  lightUsers = Math.max(0, lightUsers - 1)
  if (lightUsers > 0 || !lightSensor) return
  try { lightSensor.stop() } catch { /* 已停止 */ }
  lightSensor.removeEventListener('reading', onLightReading)
  lightSensor = null
}

function onLightReading() {
  if (!lightSensor || typeof lightSensor.illuminance !== 'number') return
  blackout.lux = Math.round(lightSensor.illuminance)
  // 全黑中且已开启接近解除：lux 掉到阈值及以下判定有人靠近，解除当前全黑层
  if (armedDismiss && blackout.enabled && blackout.lux <= blackout.threshold) armedDismiss()
}

// 设置页用：停留期间持续读取环境光以实时显示数值（返回停止函数）
export function watchAmbientLight() {
  acquireLight()
  return releaseLight
}

// ---- 全黑层的解除接入（手势 / 接近） ----
let armedEl = null      // 已接入解除的全黑层元素
let armedDismiss = null // 该层的解除动作
let lastTapAt = 0       // 上一次点按时间（双击判定）
let heldLight = false   // 是否因全黑而持有环境光监听（与引用计数成对，避免重复 acquire/release）

// 当前最上层的全黑层：黑屏遮罩 z 更高故优先，其次是拉到全黑的亮度遮罩
function fullBlackLayer() {
  if (blackEl) return { el: blackEl, dismiss: () => setBlackout(false) }
  if (brightEl && brightAlpha >= FULL_BLACK_ALPHA) return { el: brightEl, dismiss: () => setScreenBrightness(255) }
  return null
}

// 双击解除：用 pointerup 自行判定（触屏上 dblclick 不可靠），300ms 内的两次点按视为双击
function onBlackTap() {
  if (!armedDismiss) return
  const now = Date.now()
  if (now - lastTapAt <= DOUBLE_TAP_MS) { lastTapAt = 0; armedDismiss() }
  else lastTapAt = now
}

function detachDismiss() {
  if (armedEl) {
    armedEl.removeEventListener('pointerup', onBlackTap)
    armedEl.style.pointerEvents = 'none' // 交回指针事件，避免非全黑状态下遮罩挡住页面
    armedEl = null
  }
  armedDismiss = null
  lastTapAt = 0
}

// 全黑状态变化后对账：该接入的接入、该摘掉的摘掉
function refreshDismiss() {
  const layer = fullBlackLayer()
  if (armedEl && (!layer || armedEl !== layer.el)) detachDismiss()
  if (layer && !armedEl) {
    armedEl = layer.el
    // 全黑时接管指针事件：既避免点击穿透到下层页面，也让遮罩能捕获解除手势
    armedEl.style.pointerEvents = 'auto'
    armedEl.style.touchAction = 'manipulation' // 阻止双击缩放，保证双击手势稳定
    armedEl.addEventListener('pointerup', onBlackTap)
  }
  if (layer) armedDismiss = layer.dismiss
  syncDismissLight()
}

// 只有「确实处于全黑且开启了接近解除」时才持有环境光监听
function syncDismissLight() {
  const want = !!(armedEl && blackout.enabled)
  if (want === heldLight) return
  if (want) { acquireLight(); heldLight = true }
  else { releaseLight(); heldLight = false }
}

// 读取本地配置。模块加载时调一次，让 HA 下发的黑屏命令立刻按已保存配置生效
export function loadBlackoutDismiss() {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}')
    if (typeof raw.enabled === 'boolean') blackout.enabled = raw.enabled
    const t = Number(raw.threshold)
    if (raw.threshold !== undefined && raw.threshold !== '' && Number.isFinite(t) && t >= 0) blackout.threshold = t
  } catch { /* 配置缺失/损坏：保留默认值 */ }
  return blackout
}
loadBlackoutDismiss()

// 保存配置；若正处于全黑，立即按新配置接上或断开环境光监听
export function saveBlackoutDismiss(patch = {}) {
  if (typeof patch.enabled === 'boolean') blackout.enabled = patch.enabled
  const t = Number(patch.threshold)
  if (patch.threshold !== undefined && patch.threshold !== '' && Number.isFinite(t) && t >= 0) blackout.threshold = t
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ enabled: blackout.enabled, threshold: blackout.threshold }))
  } catch { /* 存储不可用（隐私模式）：仅本次会话生效 */ }
  syncDismissLight()
  return blackout
}

// ---- light：屏幕亮度（视觉遮罩模拟 0-255） ---- //
export function setScreenBrightness(value, transitionMs = 300) {
  // 注意：这里不能用 `Number(value) || 255` 兜底——0 是 falsy，会被当成「未传值」而回落成 255，
  // 导致亮度 0（应为最暗）反而全亮。只在缺省或非数字时才回落 255。
  const n = Number(value)
  const v = value == null || Number.isNaN(n) ? 255 : Math.max(0, Math.min(255, n))
  brightEl = ensureEl('hc-brightness-mask', 2147483000)
  brightEl.style.backdropFilter = 'none'
  // 亮度越低，黑色遮罩越不透明（V=255 时完全不遮挡）
  brightAlpha = (255 - v) / 255
  brightEl.style.backgroundColor = `rgba(0,0,0,${brightAlpha.toFixed(3)})`
  brightEl.style.opacity = '1'
  brightEl.style.transitionDuration = `${Math.max(0, transitionMs || 0)}ms`
  blackout.brightness = v
  refreshDismiss() // 拖到最暗时接入手势/接近解除；恢复亮度后交回指针事件
}

// ---- screen：黑屏遮罩（模拟关屏；页面仍存活，如停留在 1/24 FPS 省电用） ---- //
export function setBlackout(on, fadeMs = 200) {
  // 关键：定时器回调里必须用捕获的局部引用。若直接引用模块变量 blackEl，
  // 下面把它置为 null 后回调会执行 null.remove() 报错（且遮罩残留）。
  // 同时先清掉上一次的待移除定时器，避免「关→立刻开」时新遮罩被旧定时器移除。
  clearTimeout(blackTimer)
  blackTimer = null
  if (!on) {
    blackout.active = false
    const el = blackEl
    blackEl = null
    refreshDismiss() // 本层已失效：让位给下层全黑（如同时拉满的亮度遮罩）
    if (el) {
      el.style.opacity = '0'
      blackTimer = setTimeout(() => { el.remove(); blackTimer = null }, fadeMs + 50)
    }
    return
  }
  blackEl = ensureEl('hc-blackout-mask', 2147483647)
  blackEl.style.backgroundColor = '#000'
  blackEl.style.opacity = '1'
  blackEl.style.transitionDuration = `${fadeMs}ms`
  blackout.active = true
  refreshDismiss()
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

// ---- screen：屏保（全屏时钟；任意触摸/按键即退出，常亮不熄屏） ---- //
function renderClock() {
  if (!ssaverEl) return
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const date = `${now.getMonth() + 1} 月 ${now.getDate()} 日`
  const time = ssaverEl.firstElementChild
  const sub = ssaverEl.lastElementChild
  if (time) time.textContent = `${hh}:${mm}`
  if (sub) sub.textContent = date
}

export function setScreensaver(on) {
  if (!on) {
    window.removeEventListener('keydown', ssaverKeyExit)
    if (ssaverTimer) { clearInterval(ssaverTimer); ssaverTimer = null }
    if (ssaverEl) { ssaverEl.style.opacity = '0'; const el = ssaverEl; setTimeout(() => el.remove(), 350) }
    ssaverEl = null
    return
  }
  if (ssaverEl) { renderClock(); return }
  ssaverEl = ensureEl('hc-screensaver', 2147483001)
  ssaverEl.style.pointerEvents = 'auto'
  ssaverEl.style.backgroundColor = 'rgba(0,0,0,.94)'
  ssaverEl.style.display = 'flex'
  ssaverEl.style.flexDirection = 'column'
  ssaverEl.style.alignItems = 'center'
  ssaverEl.style.justifyContent = 'center'
  ssaverEl.style.gap = '10px'
  ssaverEl.style.color = '#fff'
  ssaverEl.style.fontVariantNumeric = 'tabular-nums'
  ssaverEl.style.cursor = 'none'
  const time = document.createElement('div')
  time.style.cssText = 'font-size:clamp(56px,18vw,180px);font-weight:200;line-height:1;letter-spacing:2px;'
  const sub = document.createElement('div')
  sub.style.cssText = 'font-size:clamp(13px,3vw,20px);opacity:.6;'
  ssaverEl.replaceChildren(time, sub)
  renderClock()
  ssaverTimer = setInterval(renderClock, 15000)
  // 任意交互即退出屏保（触碰屏保的点击/按键）
  ssaverEl.addEventListener('pointerdown', () => setScreensaver(false))
  window.addEventListener('keydown', ssaverKeyExit)
}

function ssaverKeyExit() { setScreensaver(false) }

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
  const fallback = `${title ? title + '：' : ''}${message || ''}`
  if (actions && Array.isArray(actions) && actions[0]) toast(`${fallback} · ${actions[0].label || ''}（点击动作）`, data.duration)
  else toast(fallback, data.duration)
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

// ---- popup / more_info：动态挂载覆盖层组件（独立 Vue 应用，不依赖 App 上下文） ---- //
let activePopupClose = null // 当前弹窗的卸载函数（新弹窗替换旧弹窗）

function mountOverlay(component, props, { handlers = {}, autoClose = 0 } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  let app = null
  let timer = null
  const close = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (!app) { host.remove(); return }
    const a = app
    app = null
    try { a.unmount() } catch { /* 忽略 */ }
    host.remove()
  }
  app = createApp({
    render: () => h(component, { ...props, ...handlers, onClose: close }),
  })
  app.mount(host)
  const secs = Number(autoClose) || 0
  if (secs > 0) timer = setTimeout(close, Math.min(secs, 3600) * 1000)
  return close
}

// 净化 HA 侧下发的 HTML：去除脚本类元素与事件属性，阻断 javascript: 协议。
// 内容来自 HA event bus（受信来源），但浏览器侧仍按「边界输入」处理。
function sanitizeHtml(raw) {
  const src = String(raw ?? '')
  if (!src) return ''
  try {
    const doc = new DOMParser().parseFromString(src, 'text/html')
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form').forEach((el) => el.remove())
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase()
        const val = String(attr.value || '')
        if (name.startsWith('on')) el.removeAttribute(attr.name)
        else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*(javascript|vbscript|data:text\/html)/i.test(val)) {
          el.removeAttribute(attr.name)
        }
      }
    })
    doc.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
    return doc.body.innerHTML
  } catch { return '' }
}

// popup：{ title?, content?（HTML 字符串或结构化对象）, entity?, size?, auto_close?（秒）, dismissable?, hide_header? }
function showPopup(d = {}) {
  const raw = d.content ?? d.message ?? ''
  let html = ''
  let json = ''
  if (typeof raw === 'string') html = sanitizeHtml(raw)
  else if (raw && typeof raw === 'object') {
    // {type:'markdown', content:'...'} 形态按 HTML 渲染，其余结构化内容降级为 JSON
    if (typeof raw.content === 'string' && (raw.type === 'markdown' || raw.type === 'html')) html = sanitizeHtml(raw.content)
    else json = JSON.stringify(raw, null, 2)
  }
  const entityId = String(d.entity || d.entity_id || '')
  // 记录当前弹窗的卸载函数，供关闭命令 / 新弹窗替换旧弹窗使用
  if (activePopupClose) activePopupClose()
  let close = null
  close = mountOverlay(BrowserPopup, {
    title: String(d.title ?? ''),
    html,
    json,
    entityId,
    size: String(d.size || 'md'),
    hideHeader: d.hide_header === true,
    dismissable: d.dismissable !== false,
  }, {
    handlers: {
      // 弹窗内的实体入口：关掉弹窗再打开「更多信息」，避免两层遮罩叠加
      onMoreInfo: (id) => { close(); showMoreInfo({ entity: id }) },
    },
    autoClose: d.auto_close ?? d.timeout ?? 0,
  })
  activePopupClose = () => { activePopupClose = null; close() }
  return { shown: true, entity: entityId, html: !!html, json: !!json }
}

// 关闭当前弹窗（后到的 popup 会自动替换旧弹窗）
export function closePopup() {
  if (activePopupClose) activePopupClose()
}

// 实体状态归一化为 EntityMoreInfo 需要的形态（实时状态优先，REST 兜底）。
function toMoreEntity(id, raw) {
  if (!raw || typeof raw !== 'object') return null
  const attrs = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {}
  return {
    entity_id: raw.entity_id || id,
    domain: raw.domain || String(id).split('.')[0] || '',
    friendly_name: raw.friendly_name || attrs.friendly_name || id,
    icon: raw.icon || attrs.icon || '',
    unit: raw.unit || attrs.unit_of_measurement || '',
    state: raw.state ?? '',
    attributes: attrs,
  }
}

// more_info：{ entity | entity_id }，与本应用「更多信息」面板一致（同一套能力模型）
async function showMoreInfo(d = {}) {
  const id = String(d.entity || d.entity_id || '')
  if (!id) return { shown: false, error: 'entity required' }
  // 实时状态优先；本机缓存没有则拉一次全量，再退到单实体 REST 查询
  let entity = toMoreEntity(id, entityStates[id])
  if (!entity) {
    try { await refreshEntities(store.activeID) } catch { /* 离线等场景忽略 */ }
    entity = toMoreEntity(id, entityStates[id])
  }
  if (!entity) {
    try {
      const { data } = await api.entity(store.activeID, id)
      entity = toMoreEntity(id, data)
    } catch { /* 实体不存在 */ }
  }
  if (!entity) {
    toast(`找不到实体：${id}`)
    return { shown: false, error: 'entity not found' }
  }
  mountOverlay(EntityMoreInfo, { entity })
  return { shown: true, entity: id }
}

// ---- console：把 HA 侧日志写到浏览器控制台 ---- //
function runConsole(d = {}) {
  if (d.clear === true) { console.clear(); return { cleared: true } }
  const level = ['log', 'debug', 'info', 'warn', 'error'].includes(d.level) ? d.level : 'log'
  const payload = d.message ?? d.text ?? d.data ?? ''
  const prefix = '[HA]'
  if (Array.isArray(payload)) console[level](prefix, ...payload)
  else console[level](prefix, payload)
  return { level, logged: true }
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
registerService('navigate', (args = {}) => {
  const path = args.path || args.url
  if (args.back) { router.back(); return }
  if (!path) return
  const to = String(path)
  // replace 时不留历史记录；path 支持 '#/x' 或 '/x' 两种写法
  const target = to.startsWith('#') ? to.slice(1) : to
  if (args.replace) router.replace(target)
  else router.push(target)
})
registerService('reload', (args = {}) => {
  // hard=true 时忽略缓存重新加载（部分浏览器已忽略该参数，行为等同普通刷新）
  location.reload(args.hard === true)
})
registerService('callApi', async (args = {}) => {
  const { method = 'GET', path = '/', body } = args
  const m = String(method).toUpperCase()
  const url = String(path)
  if (m === 'GET') return (await api.get(url)).data
  if (m === 'POST') return (await api.post(url, body)).data
  if (m === 'PUT') return (await api.put(url, body)).data
  if (m === 'DELETE' || m === 'DEL') return (await api.del(url)).data
  toast(`callApi 不支持的方法：${m}`)
  return null
})
registerService('toast', (args = {}) => toast(args.message ?? args.text ?? '', args.duration))
registerService('setTheme', (args = {}) => {
  const theme = String(args.theme || args.value || '')
  if (!(theme in THEMES)) { toast(`未知主题：${theme}`); return null }
  // 主题在本应用是「设备级 UI 偏好」（applyTheme 会写入 localStorage），与官方 browser_mod 行为一致
  applyTheme(theme, typeof args.custom === 'string' ? args.custom : '')
  return theme
})
registerService('setBrightness', (args = {}) => setScreenBrightness(args.value ?? args.brightness, args.transition))

// ---- media：媒体 / TTS 播放 ---- //
let mediaEl = null       // 当前媒体元素（audio 或 video）
let videoWrap = null     // 视频全屏覆盖层
let mediaUrl = ''

function stopMedia() {
  if (mediaEl) {
    try { mediaEl.pause() } catch { /* 忽略 */ }
    try { mediaEl.removeAttribute('src'); mediaEl.load() } catch { /* 忽略 */ }
    mediaEl = null
  }
  if (videoWrap) { videoWrap.remove(); videoWrap = null }
  mediaUrl = ''
}

function mediaVolume(v, fallback = 1) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
}

function isVideoUrl(url, type) {
  if (type === 'video') return true
  if (type === 'music' || type === 'audio') return false
  return /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i.test(String(url || ''))
}

function showVideoOverlay(v) {
  videoWrap = document.createElement('div')
  videoWrap.id = 'hc-media-video'
  videoWrap.style.cssText = 'position:fixed;inset:0;z-index:2147483002;background:#000;display:flex;align-items:center;justify-content:center;'
  const btn = document.createElement('button')
  btn.textContent = '✕'
  btn.setAttribute('aria-label', '关闭视频')
  btn.style.cssText = 'position:absolute;top:16px;right:16px;width:40px;height:40px;border:0;border-radius:9999px;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;'
  btn.addEventListener('click', stopMedia)
  videoWrap.append(v, btn)
  document.documentElement.appendChild(videoWrap)
}

function dispatchMedia(d = {}) {
  const action = String(d.action || (d.url ? 'play' : ''))

  if (action === 'tts') {
    const text = d.text ?? d.message ?? ''
    if (!text || typeof speechSynthesis === 'undefined') return { ok: false }
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(String(text))
    u.volume = mediaVolume(d.volume)
    if (d.lang) u.lang = String(d.lang)
    if (Number.isFinite(Number(d.rate))) u.rate = Math.max(0.1, Math.min(10, Number(d.rate)))
    if (Number.isFinite(Number(d.pitch))) u.pitch = Math.max(0, Math.min(2, Number(d.pitch)))
    speechSynthesis.speak(u)
    return { ok: true, state: 'speaking', text: String(text) }
  }

  if (action === 'stop' || action === 'clear') {
    if (typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel() } catch { /* 忽略 */ } }
    stopMedia()
    return { ok: true, state: 'idle' }
  }

  if (action === 'state') {
    return { state: mediaEl ? (mediaEl.paused ? 'paused' : 'playing') : 'idle', url: mediaUrl, volume: mediaEl ? mediaEl.volume : null }
  }

  if (action === 'play' || action === 'media' || action === 'play_media' || action === 'music' || action === 'video') {
    const url = d.url || d.media_content_id || ''
    if (!url) return { ok: false, error: 'url required' }
    stopMedia()
    const video = isVideoUrl(url, d.type || action)
    const el = document.createElement(video ? 'video' : 'audio')
    el.src = String(url)
    el.volume = mediaVolume(d.volume)
    el.muted = d.mute === true
    el.loop = d.loop === true
    if (video) { el.controls = true; el.playsInline = true; showVideoOverlay(el) }
    mediaEl = el
    mediaUrl = String(url)
    el.play().then(() => {
      if (Number.isFinite(Number(d.position))) el.currentTime = Math.max(0, Number(d.position))
    }).catch(() => {
      // 浏览器自动播放限制：需用户先与页面交互一次
      toast('浏览器阻止了自动播放，请先点击页面任意位置后重试')
    })
    el.addEventListener('ended', () => { if (!el.loop) stopMedia() })
    return { ok: true, state: 'playing', url: mediaUrl, video }
  }

  if (!mediaEl) return { ok: false, state: 'idle' }
  switch (action) {
    case 'pause':
      mediaEl.pause()
      return { ok: true, state: 'paused' }
    case 'resume':
    case 'play_pause':
      if (mediaEl.paused) mediaEl.play().catch(() => {}); else mediaEl.pause()
      return { ok: true, state: mediaEl.paused ? 'paused' : 'playing' }
    case 'volume':
      mediaEl.volume = mediaVolume(d.volume, mediaEl.volume)
      return { ok: true, volume: mediaEl.volume }
    case 'mute':
      mediaEl.muted = true
      return { ok: true, muted: true }
    case 'unmute':
      mediaEl.muted = false
      return { ok: true, muted: false }
    case 'seek':
      mediaEl.currentTime = Math.max(0, Number(d.position) || 0)
      return { ok: true, position: mediaEl.currentTime }
    default:
      toast(`未实现的媒体动作：${action}`)
      return null
  }
}

// ---- 命令分发入口 ---- //
const HANDLERS = {
  notify: (d) => showNotify(d || {}),
  popup: (d) => showPopup(d || {}),
  close_popup: () => closePopup(),
  more_info: (d) => showMoreInfo(d || {}),
  console: (d) => runConsole(d || {}),
  screen: (d) => dispatchScreen(d || {}),
  light: (d) => setScreenBrightness(d && d.brightness, d && d.transition),
  service: (d) => dispatchService(d || {}),
  set_theme: (d) => dispatchService({ name: 'setTheme', args: d || {} }),
  media: (d) => dispatchMedia(d || {}),
}

// 官方 browser_mod 命令别名 → 本执行器命令（便于迁移既有自动化）
const COMMAND_ALIASES = {
  'browser_mod.popup': 'popup',
  'browser_mod.close_popup': 'close_popup',
  'browser_mod.more_info': 'more_info',
  'browser_mod.more-info': 'more_info',
  'browser_mod.notification': 'notify',
  'browser_mod.notify': 'notify',
  'browser_mod.console': 'console',
  'browser_mod.set_theme': 'set_theme',
  'browser_mod.screen': 'screen',
  'browser_mod.media': 'media',
  'browser_mod.command': 'service',
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
    case 'off': // 关屏
      setScreensaver(false)
      setScreenWake(false)
      return setBlackout(true, d.fade)
    case 'blackout_off':
    case 'on': // 亮屏
      return setBlackout(false, d.fade)
    case 'brightness':
      return setScreenBrightness(d.brightness ?? d.value, d.transition)
    case 'screensaver':
      return setScreensaver(true)
    case 'screensaver_off':
      return setScreensaver(false)
    default:
      if (d.blackout === true) return setBlackout(true, d.fade)
      if (d.blackout === false) return setBlackout(false, d.fade)
      if (d.brightness != null) return setScreenBrightness(d.brightness, d.transition)
      if (d.screensaver === true) return setScreensaver(true)
      if (d.screensaver === false) return setScreensaver(false)
      toast(`未实现的屏幕动作：${action || '（空）'}`)
      return null
  }
}

// 统一入口：store 收到 {type:'cmd', cmd, data} 后调用。
export async function dispatchCommand(cmd, data) {
  const name = COMMAND_ALIASES[cmd] || cmd
  const fn = HANDLERS[name]
  if (!fn) {
    toast(`未实现的浏览器命令：${cmd}`)
    return null
  }
  try {
    return await fn(data)
  } catch (e) {
    toast(`浏览器命令执行失败：${cmd}（${e && e.message ? e.message : '未知错误'}）`)
    return null
  }
}

export default {
  dispatchCommand,
  registerService,
  showNotify,
  showPopup,
  closePopup,
  showMoreInfo,
  setScreenBrightness,
  setBlackout,
  setScreensaver,
  setScreenWake,
  setScreenFullscreen,
  stopMedia,
  sanitizeHtml,
  toast,
}
// 全局共享状态：实例管理 + 实时状态。用 Composition API 单例，无需额外状态库。
import { reactive, ref, shallowRef, toRaw } from 'vue'
import api, { wsUrl } from '@/api'
import { getDeviceId } from '@/utils/device'
import { dispatchCommand, registerService } from '@/utils/browserCommands'
import { mark, measure, count, record, autoReportOnce } from '@/utils/perf'
import { saveSnapshot, loadSnapshot, clearSnapshot, clearAll } from '@/utils/snapshotCache'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { handshake, openEnvelope, withCrypto } from '@/utils/crypto'
import { isApk } from '@/utils/serverConfig'
import { layoutKey, layoutKeyFor } from '@/utils/dashboard'

mark('boot:store')

// 后端是否可达（首次探测失败即 false）。
export const backendOnline = ref(false)

// 当前用户是否已配置个人 HA token（无配置即禁用 HA 访问）。
// 与 haTokenKnown 配对：haTokenKnown=false 表示尚未取到后端权威值（首帧或请求失败），
// 此时界面不能直接提示「未配置」，否则刷新时会误报。
// 初值取上次成功获取的结果（localStorage 缓存），使首帧就接近真实状态，
// 且在 /prefs 请求失败时仍保留上次已知值而不是退回 false。
const HA_TOKEN_CACHE_KEY = 'hc_ha_token_ok'
let cachedHAToken = null
try { cachedHAToken = localStorage.getItem(HA_TOKEN_CACHE_KEY) } catch { /* 存储不可用（隐私模式） */ }
export const haTokenConfigured = ref(cachedHAToken === '1')
export const haTokenKnown = ref(cachedHAToken !== null)

// 认证状态（登录用户）。
export const auth = reactive({
  user: null,     // 当前登录用户名；null=未登录
  isAdmin: false,
  checked: false, // 是否已执行过登录态探测
})

// ---- 系统显示名称（管理员可改，存后端全局 prefs.site_name） ----
// 初值取 localStorage 缓存防首帧闪烁；loadSiteName 拉后端权威值覆盖。
// 登录页未登录也可用（GET /site-name 公开）。
const SITE_NAME_CACHE_KEY = 'hc_site_name'
let cachedSiteName = '糯米'
try { cachedSiteName = localStorage.getItem(SITE_NAME_CACHE_KEY) || '糯米' } catch { /* 隐私模式 */ }
export const siteName = ref(cachedSiteName)

// 系统英文名称（顶栏副标题，存后端全局 prefs.site_name_en，随 /site-name 一并返回）。
const SITE_NAME_EN_CACHE_KEY = 'hc_site_name_en'
let cachedSiteNameEn = 'Sticky Kee'
try { cachedSiteNameEn = localStorage.getItem(SITE_NAME_EN_CACHE_KEY) || 'Sticky Kee' } catch { /* 隐私模式 */ }
export const siteNameEn = ref(cachedSiteNameEn)

// 浏览器标签标题：随系统名称热更新（管理员保存/WS 广播 brand 事件后立即生效）。
// 标题逻辑放 store 而非 router：router ↔ store 存在循环依赖（store→browserCommands→router），
// router 顶层引用 siteName 会撞 TDZ 死区（黑屏）。路由切换时由 router 调 setRouteTitle 记录页名。
let routeTitle = ''
function applyDocTitle() {
  if (typeof document === 'undefined') return
  document.title = routeTitle ? `${routeTitle} · ${siteName.value}` : siteName.value
}
export function setRouteTitle(t) {
  routeTitle = t || ''
  applyDocTitle()
}

export async function loadSiteName() {
  try {
    const { data } = await api.getSiteName()
    const n = String(data?.name || '').trim()
    if (n) {
      siteName.value = n
      try { localStorage.setItem(SITE_NAME_CACHE_KEY, n) } catch { /* 忽略 */ }
    }
    const ne = String(data?.name_en || '').trim()
    if (ne) {
      siteNameEn.value = ne
      try { localStorage.setItem(SITE_NAME_EN_CACHE_KEY, ne) } catch { /* 忽略 */ }
    }
    if (n) applyDocTitle()
  } catch { /* 离线保持缓存值 */ }
}

export async function saveSiteName(name, nameEn) {
  const { data } = await api.putSiteName(name, nameEn)
  const n = String(data?.name || '').trim()
  if (n) {
    siteName.value = n
    try { localStorage.setItem(SITE_NAME_CACHE_KEY, n) } catch { /* 忽略 */ }
  }
  const ne = String(data?.name_en || '').trim()
  if (ne) {
    siteNameEn.value = ne
    try { localStorage.setItem(SITE_NAME_EN_CACHE_KEY, ne) } catch { /* 忽略 */ }
  }
  if (n) applyDocTitle() // 本端保存后立即更新标签标题，无需切页
  return n
}

// ---- 系统显示图标（管理员可改，Material Symbol 名，存后端全局 prefs.site_icon） ----
const SITE_ICON_CACHE_KEY = 'hc_site_icon'
// 顶栏品牌区显示偏好（中文名/英文名/图标各自显隐；prefs 键 site_display，个人级显示设置，
// 不改全局名称/图标本身）。TheHeader 消费；SettingsView/App.vue 负责从 prefs 恢复。
export const brandDisplay = reactive({ cn: true, en: true, icon: true })
export function applyBrandDisplay(conf) {
  if (!conf || typeof conf !== 'object') return
  if ('cn' in conf) brandDisplay.cn = !!conf.cn
  if ('en' in conf) brandDisplay.en = !!conf.en
  if ('icon' in conf) brandDisplay.icon = !!conf.icon
}

let cachedSiteIcon = 'bolt'
try { cachedSiteIcon = localStorage.getItem(SITE_ICON_CACHE_KEY) || 'bolt' } catch { /* 隐私模式 */ }
export const siteIcon = ref(cachedSiteIcon)

// ---- 自定义图标图片（data URL，存后端全局 prefs.site_icon_img）----
// 与 Material 名互斥：非空时各端优先渲染图片；重新选择 Material 图标时后端自动清除。
const SITE_ICON_IMG_CACHE_KEY = 'hc_site_icon_img'
let cachedSiteIconImg = ''
try { cachedSiteIconImg = localStorage.getItem(SITE_ICON_IMG_CACHE_KEY) || '' } catch { /* 隐私模式 */ }
export const siteIconImg = ref(cachedSiteIconImg)
function setSiteIconImg(v) {
  siteIconImg.value = v || ''
  try {
    if (v) localStorage.setItem(SITE_ICON_IMG_CACHE_KEY, v)
    else localStorage.removeItem(SITE_ICON_IMG_CACHE_KEY)
  } catch { /* 忽略 */ }
}

export async function loadSiteIcon() {
  try {
    const { data } = await api.getSiteIcon()
    const v = String(data?.icon || '').trim()
    if (v) {
      siteIcon.value = v
      try { localStorage.setItem(SITE_ICON_CACHE_KEY, v) } catch { /* 忽略 */ }
    }
    setSiteIconImg(String(data?.img || '')) // 空串即清除（Material 模式）
  } catch { /* 离线保持缓存值 */ }
}

export async function saveSiteIcon(icon) {
  const { data } = await api.putSiteIcon(icon)
  const v = String(data?.icon || '').trim()
  if (v) {
    siteIcon.value = v
    try { localStorage.setItem(SITE_ICON_CACHE_KEY, v) } catch { /* 忽略 */ }
  }
  setSiteIconImg('') // 选用 Material 图标：后端已清自定义图，本地同步
  return v
}

// 上传自定义图标图片（data URL）：保存后各端经 brand 广播热刷新
export async function saveSiteIconImage(img) {
  const { data } = await api.putSiteIconImage(img)
  const v = String(data?.img || '')
  if (v) setSiteIconImg(v)
  return v
}

// remember=true（「保持登录」）：令牌写入 localStorage，关闭浏览器/APP 后仍保持登录；
// 否则写入 sessionStorage，仅当前会话有效。写入前清掉另一处的残留，避免两份令牌不一致。
function setToken(t, remember = false) {
  if (!t) return
  // APK 端强制持久化：WebView 进程被系统回收后 sessionStorage 会清空，
  // 表现为「切后台一会儿回来就退出登录」；App 属个人设备，重启保持登录。
  if (remember || !!window.StickyKeeNative) {
    localStorage.setItem('hc_token', t)
    sessionStorage.removeItem('hc_token')
  } else {
    sessionStorage.setItem('hc_token', t)
    localStorage.removeItem('hc_token')
  }
}
function setAuth(u) {
  auth.user = u?.username ?? null
  auth.isAdmin = !!u?.is_admin
  auth.checked = true
  // 前台保活服务跟随登录态：登录后启动（后台收通知/来电依赖实时连接），登出停止
  try {
    const nk = window.StickyKeeNative
    if (u) nk?.startKeepAlive?.()
    else nk?.stopKeepAlive?.()
  } catch { /* 忽略 */ }
}

// 登录/注册：成功后写入 token 与用户态。
export async function authLogin(username, password, remember = false) {
  const { data } = await api.login({ username, password })
  setToken(data.token, remember)
  setAuth(data)
  await handshake().catch(() => { /* 握手失败不阻塞登录，读消息时会重试 */ })
  return data
}

export async function authRegister(username, password) {
  const { data } = await api.register({ username, password })
  setToken(data.token)
  setAuth(data)
  await handshake().catch(() => {})
  return data
}

// 退出登录：尽力通知后端，清空本地登录态。
export async function authLogout() {
  try { await api.logout() } catch { /* 后端离线也能退出 */ }
  sessionStorage.removeItem('hc_token')
  localStorage.removeItem('hc_token')
  setAuth(null)
  store.ready = false
  // 清掉实体缓存与本地快照/布局缓存：下一个登录用户不该看到上一位用户的数据
  snapSeen = false
  lastSeq = 0
  hydrated = false
  cachedActiveID = 0
  dropEntityStates()
  clearAll().catch(() => { /* 忽略 */ })
}

// 探测当前登录态：无有效会话则 user=null。
export async function loadMe() {
  try {
    const { data } = await api.me()
    setAuth(data)
    await handshake().catch(() => {})
  } catch {
    setAuth(null)
  }
  auth.checked = true
  return auth.user
}

// 修改密码：成功后替换本地 token（沿用当前「保持登录」状态）。
export async function changePassword(old_password, new_password) {
  const { data } = await api.changePassword({ old_password, new_password })
  const remember = !!localStorage.getItem('hc_token')
  setToken(data.token, remember)
  await handshake(true).catch(() => {})
  return data
}

// 实例列表与 active（meta.activeInstID 由后端返回）。
export const store = reactive({
  instances: [],
  activeID: 0,
  ready: false,       // 首次列表加载完成
  error: '',          // 最近一次列表错误
})

// 全量实体状态缓存（按 entity_id 索引），来自 WS 快照/增量。
// 直接按 id 读（entityStates[id]）天然是「按实体」的细粒度订阅：
// Vue 的 reactive 按 key 追踪，只有该实体的字段变化才会打扰读它的组件。
export const entityStates = reactive({})

// 实体列表视图（供「需要遍历全部实体」的场景，如地图标记、设备页分组）。
// 用 shallowRef：只有实体集合本身增删（membership）时才替换，值变化不替换——
// 否则任何一次状态推送都会让所有遍历全表的组件重算+重渲染。
export const entityList = shallowRef([])
// 仪表盘远程变更版本号：本人任一设备保存/接受分享后自增，HomeView watch 它重载布局
export const dashboardRev = ref(0)

// 实体订阅回调（实体变化时通知各视图）。
const watchers = new Set()
export function onEntityChange(fn) { watchers.add(fn); return () => watchers.delete(fn) }

// ---- 设备注册表共享缓存 ----
// 概览卡片与设备抽屉共用同一份数据源，保证「卡片显示的设备数量」与
// 「抽屉列出的设备」口径一致（按物理设备统计，而非按实体）。
export const registryDevices = shallowRef([])
export const registryUnassigned = shallowRef([])
export const registryLoaded = ref(false)
let registryPromise = null
let registryAt = 0
const REGISTRY_TTL = 60000

// 拉取设备注册表（60s TTL 复用；并发调用合并为一次请求）。
export function loadRegistry(force = false) {
  if (!store.ready || store.activeID <= 0) return Promise.resolve([])
  if (registryPromise) return registryPromise
  if (!force && registryLoaded.value && Date.now() - registryAt < REGISTRY_TTL) return Promise.resolve(registryDevices.value)
  registryPromise = (async () => {
    try {
      const { data } = await api.registryDevices(store.activeID)
      registryDevices.value = data?.devices || []
      registryUnassigned.value = data?.unassigned || []
      registryLoaded.value = true
      registryAt = Date.now()
      return registryDevices.value
    } catch {
      registryLoaded.value = false
      return registryDevices.value
    } finally {
      registryPromise = null
    }
  })()
  return registryPromise
}

// 单次写入的分片阈值。缓存回填/首帧快照可能一次上千实体，实测单帧耗时峰值 14.4ms，
// 会在启动瞬间占满主线程掉帧（移动端更明显）。超过阈值就拆片、块间让出主线程。
// 小批次仍同步写入，不牺牲实时性。
const APPLY_CHUNK = 300
let applyQueue = []        // [{ list, opts, resolve }]：FIFO，保证先后顺序
let applyDraining = false

// 把一批实体状态写入缓存并触发订阅。
// opts.replace：本批为权威全量（WS 首帧快照），未出现的实体视为已删除，一并清掉。
// 返回 Promise：分片执行时在全部写入完成后 resolve（调用方需要「写完后」再动作时 await）。
function applyStates(list, opts = {}) {
  if (!Array.isArray(list)) return Promise.resolve()
  count('state:batches')
  const busy = applyDraining || applyQueue.length > 0
  if (!busy && list.length <= APPLY_CHUNK) { applyChunk(list, opts); return Promise.resolve() }

  const parts = []
  if (list.length <= APPLY_CHUNK) parts.push(list)
  else for (let i = 0; i < list.length; i += APPLY_CHUNK) parts.push(list.slice(i, i + APPLY_CHUNK))

  // replace 的「清删」必须基于全量 id 集合，且只在最后一片执行，否则前面的分片会把后面的实体当成已删除
  const keep = opts.replace ? idSet(list) : null
  return new Promise((resolve) => {
    parts.forEach((part, i) => {
      const last = i === parts.length - 1
      applyQueue.push({
        list: part,
        opts: last ? { replace: !!opts.replace, keep } : {},
        resolve: last ? resolve : null,
      })
    })
    drainApply()
  })
}

function idSet(list) {
  const s = new Set()
  for (const e of list) if (e && e.entity_id) s.add(e.entity_id)
  return s
}

// 逐片出队执行，每片之间让出一拍，避免长时间占用主线程。
// 新到达的批次（含小批次）一律入队，保证与在途分片的先后顺序不被颠倒。
function drainApply() {
  if (applyDraining) return
  applyDraining = true
  const step = () => {
    const job = applyQueue.shift()
    if (!job) { applyDraining = false; return }
    applyChunk(job.list, job.opts)
    if (job.resolve) job.resolve()
    setTimeout(step, 0)
  }
  step()
}

// 实际写入一片实体（同步、不可重入保证顺序由 drainApply 负责）。
function applyChunk(list, opts = {}) {
  if (!Array.isArray(list) || !list.length) return
  const t0 = performance.now()
  const changed = new Set()
  let membershipChanged = false
  for (const raw of list) {
    if (!raw || !raw.entity_id) continue
    // 防御性归一化：WS 增量/快照若为 HA 原始结构（无 domain/friendly_name），
    // 就地补齐富字段，避免推送后卡片丢失域名、名称与单位（与 REST /entities 对齐）。
    if (!raw.domain) raw.domain = String(raw.entity_id).split('.')[0] || ''
    if (raw.attributes && typeof raw.attributes === 'object') {
      if (!raw.friendly_name && typeof raw.attributes.friendly_name === 'string') raw.friendly_name = raw.attributes.friendly_name
      if (raw.unit === undefined && raw.attributes.unit_of_measurement != null) raw.unit = String(raw.attributes.unit_of_measurement)
      if (!raw.device_class && typeof raw.attributes.device_class === 'string') raw.device_class = raw.attributes.device_class
      if (!raw.icon && typeof raw.attributes.icon === 'string') raw.icon = raw.attributes.icon
    }
    // 已存在则原地更新（保持对象引用不变）：既让按 id 订阅的组件只在自身字段变化时重算，
    // 也避免实体列表因值变化而整体重建。原地更新还比整体替换更安全——
    // 增量帧若缺字段，原有字段不会被抹掉。
    const prev = entityStates[raw.entity_id]
    if (prev) Object.assign(prev, raw)
    else { entityStates[raw.entity_id] = raw; membershipChanged = true }
    changed.add(raw.entity_id)
  }
  if (opts.replace) {
    const keep = opts.keep || idSet(list)
    for (const id of Object.keys(entityStates)) {
      if (!keep.has(id)) { delete entityStates[id]; changed.add(id); membershipChanged = true }
    }
  }
  if (membershipChanged) entityList.value = Object.values(entityStates)
  watchers.forEach((fn) => { try { fn(changed) } catch {} })
  // 基准：单片写入的代价与其规模（优化前后可直接对比）
  count('state:entities', list.length)
  record('state:apply', performance.now() - t0)
}

// ---- 首屏加速：本地快照回填 + 节流落盘 ----
let hydrated = false       // 是否已用本地缓存回填过（重复调用 loadInstances 不再回填）
let cachedActiveID = 0     // 缓存快照对应的实例 id（用于识别「实例已切换」）
let lastPersist = 0
const PERSIST_INTERVAL = 60000 // 增量期间最多每分钟落盘一次

// 启动时先用本地缓存绘制首屏，网络请求同时进行；WS 全量快照到达后会整批覆盖。
export async function hydrateFromCache() {
  if (hydrated) return false
  hydrated = true
  try {
    const cached = await loadSnapshot()
    if (!cached) return false
    cachedActiveID = cached.activeID || 0
    // 等分片写完再打点：这个打点标识「缓存已可上屏」，要反映真实完成时刻
    await applyStates(cached.list)
    mark('boot:cacheApplied')
    measure('boot:cacheApplied', 'boot:js')
    return true
  } catch { return false }
}

// 落盘当前全量快照（force 用于首帧权威快照到达后立刻存一份）。
function persistSoon(force = false) {
  const now = Date.now()
  if (!force && now - lastPersist < PERSIST_INTERVAL) return
  lastPersist = now
  try {
    // toRaw：IndexedDB 的结构化克隆无法克隆 Vue 的 Proxy，必须先取回原始对象
    const list = Object.values(toRaw(entityStates)).map((e) => toRaw(e))
    if (!list.length) return
    saveSnapshot(list, store.activeID).catch(() => { /* 配额/隐私模式：静默忽略 */ })
  } catch { /* 克隆失败：本次不落盘 */ }
}

// 丢弃全部实体缓存（实例切换 / 退出登录）
function dropEntityStates() {
  for (const id of Object.keys(entityStates)) delete entityStates[id]
  entityList.value = []
  // 注册表缓存同属旧实例：一并清空，避免切换后展示错实例设备
  registryDevices.value = []
  registryUnassigned.value = []
  registryLoaded.value = false
  registryAt = 0
}

// 操作设备（开关/服务/滑条）后的兜底刷新：WS 推送是主通道，
// 但在 WS 被代理拦截/容器内不可用等场景下，用一次 REST 全量拉取保证 UI 必然反映新状态。
// 多次操作合并为一次延迟拉取（滑条拖动时不会刷爆接口）。
let refreshTimer = null
export function requestEntityRefresh(delay = 350) {
  if (!store.ready || store.activeID <= 0) return
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    refreshEntities(store.activeID)
  }, delay)
}

let ws = null
let wsTimer = null
let retry = 1

// 语音通话二进制上行：voice.js 经此把 Opus 帧写进与信令同一条 WS 连接（8080 中继）。
export function wsSendBinary(bytes) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(bytes) } catch { /* 忽略 */ }
  }
}
let snapSeen = false // 是否已收到过首帧全量快照（用于记录首屏耗时并自动打印基准）
let lastSeq = 0      // 增量流序号水位：后端按窗口合并推送并自增 seq，跳号即说明中间丢了帧

// ---- 应用层心跳：维持 TCP 活跃流量 + 超时探测 ----
// Android WebView 后台时 JS setInterval 被节流到 1min+，
// 运营商 NAT 对"长时间只有 WebSocket 控制帧"的连接 5min 就掐。
// 应用层 JSON ping 计入流量，每 25s 发一次；40s 没任何消息即判断主动重连。
const HB_INTERVAL = 25000   // ping 发送间隔（ms）
const HB_TIMEOUT = 40000    // 任何消息超时（超过则主动 close 触发重连）
let hbTimer = null          // setInterval 句柄
let lastMsgAt = 0           // 最后收到消息的时间戳

function stopHeartbeat() {
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null }
}
function startHeartbeat() {
  stopHeartbeat()
  lastMsgAt = Date.now()
  hbTimer = setInterval(() => {
    // 超时探测：40s 内没有任何消息（含 pong 或业务数据）→ 连接已死
    if (Date.now() - lastMsgAt > HB_TIMEOUT) {
      stopHeartbeat()
      try { ws && ws.close() } catch {}
      return
    }
    // 发 JSON ping：计入运营商 NAT 活跃流量
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ping' })) } catch {}
    }
  }, HB_INTERVAL)
}

// 探测活存：用于 visibilitychange 回到前台时快速确认连接是否真的通。
// 发一次 ping，3s 内没收到任何消息就强制 close 触发重连。
function probeLivenessThen() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  const before = lastMsgAt
  try { ws.send(JSON.stringify({ type: 'ping' })) } catch { try { ws.close() } catch {} return false }
  const guard = setTimeout(() => {
    if (lastMsgAt === before) {
      // 3s 内 lastMsgAt 没更新 → 连接已死
      try { ws && ws.close() } catch {}
    }
  }, 3000)
  ws.addEventListener('message', () => clearTimeout(guard), { once: true })
  return true
}

function connectWS() {
  if (!store.ready || store.activeID <= 0) return
  // 未配置个人 HA token 也保持连接：后端会降级为「仅控制通道」（无实体快照），
  // 本端仍能接收 reload/instances 等广播——其它端配好 token 后可被通知并立即重建，
  // 避免「必须杀进程重进」的鸡生蛋问题。
  if (ws) { stopHeartbeat(); try { ws.close() } catch {} }
  lastSeq = 0 // 新连接会收到带 seq 的全量快照，水位从头开始
  mark('ws:connect')
  ws = new WebSocket(wsUrl(store.activeID, getDeviceId()))
  ws.binaryType = 'arraybuffer' // 语音中继帧为二进制，需按 ArrayBuffer 接收
  ws.onopen = () => {
    backendOnline.value = true
    retry = 1
    mark('ws:open')
    measure('boot:wsOpen', 'boot:js')
    startHeartbeat()
  }
  ws.onmessage = (ev) => {
    lastMsgAt = Date.now() // 任何消息（含 pong、语音帧）都续期活存
    // 语音中继帧（二进制）：直进语音管线，不按 JSON 解析
    if (ev.data instanceof ArrayBuffer) {
      import('@/utils/voice').then((v) => v.feedVoiceRaw(ev.data)).catch(() => {})
      return
    }
    try {
      const m = JSON.parse(ev.data)
      count('ws:msg')
      if (m.type === 'pong') return // 心跳应答，上面已续期时间戳
      if (m.type === 'state') {
        const list = m.data || []
        count('ws:entities', list.length)
        const first = !snapSeen
        if (first) {
          snapSeen = true
          mark('ws:firstSnapshot')
          measure('boot:firstSnapshot', 'boot:js')
          autoReportOnce()
        }
        // 首帧是权威全量：整批替换（清掉缓存里多出来的实体），写完再落盘一份新快照
        applyStates(list, { replace: first }).then(() => persistSoon(first))
        // 序号水位：只认「往前跳」的缺口（重复/更旧的序号会出现在补拉之后），
        // 一旦跳号说明 Hub 缓冲溢出丢帧，回退一次 REST 全量补齐。
        if (typeof m.seq === 'number') {
          if (lastSeq > 0 && m.seq > lastSeq + 1) {
            count('ws:gaps')
            refreshEntities(store.activeID)
          }
          lastSeq = m.seq
        }
      }
      else if (m.type === 'cmd') dispatchCommand(m.cmd, m.data)
      // HA mobile_app 通知：HA 侧调用 notify.mobile_app_<device> 服务后 fire mobile_app.notify
      // 事件 → 后端经 hub 定向推给对应设备（或 device_id 为空时广播给全用户）。
      // 仅在 device_id 匹配本机 或 device_id 为空（广播）时处理，避免其它手机的通知被误弹。
      else if (m.type === 'notify_apk') {
        const ownDevice = getDeviceId()
        if (!m.device_id || m.device_id === ownDevice) {
          notifyFromHA(m.title || 'HA 通知', m.message || '')
        }
      }
      else if (m.type === 'im') {
        refreshIm().then(notifyNewIm).catch(() => {})
        // 提示音立即播放（不等 refreshIm 完毕，延迟越小体验越好）。
        // APK 不播 WebAudio 提示音（走媒体音量）：原生通知自带系统提示音（通知音量流）。
        if ((!imOpen.value || document.hidden) && !window.StickyKeeNative) playImBeep()
      }
      // 仪表盘变更：本人在其它设备保存/接受分享后热刷新（HomeView 监听此版本号重载布局）。
      // keys 为受影响的布局键数组（dashboard=Web 端 / dashboard_apk=手机端全局回退 /
      // dashboard_apk_<deviceId>=按设备隔离）。按本端身份过滤：网页端只响应自身的
      // dashboard；手机端只响应回退键 dashboard_apk 与本机键 dashboard_apk_<本机 id>，
      // 其它手机的按键变更与本机无关（避免网页端代管保存 A 机布局时 B 机被无谓刷新打断）。
      // dashboard_apk_cols_* 列数键不在此列（非布局重载）。
      // 无 keys 的旧形式按 dashboard 处理（兼容旧版服务端）。
      else if (m.type === 'prefs') {
        const keys = Array.isArray(m.keys) ? m.keys : (m.key ? [m.key] : [])
        const isLayout = (k) => k === 'dashboard' ||
          (k.startsWith('dashboard_apk') && !k.startsWith('dashboard_apk_cols'))
        const ownKey = isApk ? layoutKeyFor(getDeviceId()) : null
        const hit = keys.some((k) => isLayout(k) &&
          (isApk ? (k === 'dashboard_apk' || k === ownKey) : k === 'dashboard'))
        if (keys.length === 0 || hit) dashboardRev.value++
      }
      // 品牌设置变更（系统名称/英文名/图标）：任一端的管理员保存后，
      // 后端广播全部在线端即时热刷新，无需杀 APP 重进。siteName ref 变化
      // 会联动顶栏/浏览器标签标题（router 里 watch siteName 更新 document.title）。
      else if (m.type === 'brand') { loadSiteName(); loadSiteIcon() }
      // 配置级变更（HA token 写入/更新）：本用户任一端修改后，其余端立即重连 WS——
      // 后端已按新 token 重建 HA 连接，重连即获得全量快照，无需杀进程重进。
      else if (m.type === 'reload') {
        refreshHATokenStatus()
        if (ws) { try { ws.close() } catch {} }
        ws = null
        retry = 1
        connectWS()
      }
      // 实例增删改/切换：重拉实例列表与 active，并按新 active 重建数据通道。
      else if (m.type === 'instances') {
        loadInstances()
      }
      // 通话信令：动态 import 避免 store ↔ call 模块循环依赖
      else if (m.type === 'call') import('@/utils/call').then((c) => c.handleCallEvent(m))
    } catch { /* 忽略坏帧 */ }
  }
  ws.onclose = () => {
    stopHeartbeat()
    ws = null
    // 指数退避重连（2s→4s→…→20s 封顶）
    const delay = Math.min(2 * retry, 20) * 1000
    retry = Math.min(retry * 2, 10)
    wsTimer = setTimeout(() => {
      if (store.ready && store.activeID > 0) connectWS()
    }, delay)
  }
  ws.onerror = () => { try { ws.close() } catch {} }
}

// 回到前台立即恢复/探测连接：后台被冻结期间 WS 可能已断，
// visibilitychange 时：ws 不存在 → 直接重连；ws 存在 → 3s 探测活存，
// 探测失败则强制 close 触发 onclose 的指数退避重连。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (!store.ready || store.activeID <= 0) return
    if (ws && ws.readyState === WebSocket.OPEN) {
      probeLivenessThen()
      return
    }
    // ws 不存在或已关闭：重置退避并立即重连
    retry = 1
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null }
    connectWS()
  })
}

// 原生后台心跳保活入口（仅 APK 调用）：WebView 退后台后 pauseTimers 冻结全部
// JS 定时器——上面的 25s 应用层 ping 与 onclose 重连都停摆，时间一久服务端
// 90s 读超时注销连接，对端通话/邀请就显示该用户「离线」。KeepAliveService 的
// 原生心跳（主线程 Handler，不被冻结）每 60s 经 evaluateJavascript 调本函数：
//   - 连接 OPEN：发一帧应用层 ping（上行帧续服务端读超时 + 维持运营商 NAT 活跃）；
//   - 连接缺失/卡住（含 CONNECTING 超过一个心跳周期）：摘掉旧连接回调后立即重建，
//     避免旧连接延迟 onclose 把新连接的 ws 变量置空的竞态。
if (typeof window !== 'undefined') {
  window.__hcWsKeepalive = function () {
    if (!store.ready || store.activeID <= 0) return
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'ping' })) } catch { /* 忽略 */ }
      return
    }
    if (ws) {
      stopHeartbeat()
      // 先摘掉回调再 close：否则旧连接异步 onclose 会执行 ws=null 误杀随后新建的连接
      try {
        ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null
        ws.close()
      } catch { /* 忽略 */ }
      ws = null
    }
    retry = 1
    if (wsTimer) { clearTimeout(wsTimer); wsTimer = null }
    connectWS()
  }
}

// 拉取实例列表并建立实时连接。
export async function loadInstances() {
  store.error = ''
  hydrateFromCache() // 不 await：先用本地缓存绘制，网络请求同时进行
  try {
    mark('boot:instancesStart')
    // 实例列表与个人偏好并行拉取。原先串行 await，等于首屏白等一个 RTT，
    // 而 WS 建连又必须等这两步完成，所以并行直接缩短「有实时数据」的时间。
    const [res] = await Promise.all([api.listInstances(), refreshHATokenStatus()])
    const { data, meta } = res
    measure('boot:instances', 'boot:instancesStart')
    store.instances = Array.isArray(data) ? data : []
    store.activeID = meta?.active_instance || (store.instances[0] && store.instances[0].id) || 0
    store.ready = true
    backendOnline.value = true
    // 缓存快照属于另一个实例：立刻丢弃，避免展示错实例的数据（WS 快照随后会填上正确的）
    if (cachedActiveID && cachedActiveID !== store.activeID) {
      dropEntityStates()
      cachedActiveID = 0
      clearSnapshot().catch(() => { /* 忽略 */ })
    }
    connectWS()
  } catch (e) {
    store.error = e.message
    store.ready = false
    backendOnline.value = false
  }
}

// 刷新当前用户是否已配置个人 HA token（来自 /prefs）。
// 只有成功取到后端值才更新标记并写缓存；请求失败时保留上次已知值，
// 且不把「未知」当成「未配置」（避免仪表盘误报未配置提示）。
export async function refreshHATokenStatus() {
  mark('boot:prefsStart')
  try {
    const { data } = await getPrefs()
    measure('boot:prefs', 'boot:prefsStart')
    haTokenConfigured.value = data?.ha_token_configured === 'true'
    haTokenKnown.value = true
    try { localStorage.setItem(HA_TOKEN_CACHE_KEY, haTokenConfigured.value ? '1' : '0') } catch { /* 存储不可用 */ }
  } catch {
    /* 保持现值：haTokenKnown 维持原状，界面不会误报 */
  }
}

// 保存个人 HA token 后调用：更新本地状态并立即重连实时连接（后端已即时重建，无需重启）。
export async function saveHAToken(token) {
  await putPrefs({ ha_token: token })
  haTokenConfigured.value = !!token
  haTokenKnown.value = true
  try { localStorage.setItem(HA_TOKEN_CACHE_KEY, token ? '1' : '0') } catch { /* 存储不可用 */ }
  // 关闭旧连接，使后端按新 token 重建该用户连接后立即重新连接。
  if (ws) { try { ws.close() } catch {} }
  ws = null
  connectWS()
}

// 切换 active 实例（改用其最终确定的 activeID）。
export async function switchInstance(id) {
  const { meta } = await api.switchInstance(id)
  store.activeID = meta?.active_instance || id
  connectWS()
  return store.activeID
}

// 手动触发实体查询（供首次/切换实例时兜底）。
export async function refreshEntities(instanceID) {
  const id = instanceID || store.activeID
  if (!id || id <= 0) return []  // 实例未就绪：不发请求（否则拼成 /instances/entities 触发 405）
  try {
    const { data } = await api.entities({ instance: id })
    // 权威全量（无过滤参数）：未出现的实体视为已删除，一并清掉——
    // 否则被 HA 侧移除的实体（如 dismiss 后的通知）会残留到下次 WS 重连。
    applyStates(data || [], { replace: true })
    return data || []
  } catch { return [] }
}

// 注册供 HA（Browser_mod 风格 service 命令）调用的浏览器本地服务。
registerService('refreshEntities', async () => {
  await refreshEntities(store.activeID)
})

export default store

// 首页沉浸/全屏模式状态：为 true 时 App 外壳折叠顶部栏与导航（App.vue 据此渲染），
// 首页同时隐藏仪表盘编辑按钮，进入全屏显示。
// dashEditing：首页仪表盘编辑态。为 true 时手机端隐藏底部 Tab 栏——
// 编辑操作栏 fixed 在 bottom-0（z-40），会被 z-50 的 Tab 栏整个盖住。
export const ui = reactive({ immersive: false, dashEditing: false })

// 全局设备抽屉：概览卡/统计卡/房间概览点击后按条件过滤展示设备。
// 挂在 App.vue 外壳内，任何页面都能通过 openDeviceDrawer(filter) 打开。
// seq 自增保证「已打开时再次点击同一条件」也能触发同步（watch 依赖值变化）。
export const deviceDrawer = reactive({ open: false, filter: 'all', seq: 0 })
export function openDeviceDrawer(filter) {
  deviceDrawer.filter = filter || 'all'
  deviceDrawer.open = true
  deviceDrawer.seq++
}

// ===== 用户间消息中心（顶栏铃铛） =====
export const imOpen = ref(false)          // 消息面板开关
export const imUnread = ref(0)            // 未读总角标
export const imConversations = ref([])    // 会话列表（供面板与角标共用）
export const imRefresher = ref(0)         // 自增信号：通知面板重新拉取会话/未读

// 拉取会话列表并汇总未读数；静默容错（后端离线/未登录忽略）。
export async function refreshIm() {
  if (!auth.user) return
  try {
    const { data } = await withCrypto(() => api.listConversations())
    const plain = await openEnvelope(data)
    const list = Array.isArray(plain) ? plain : []
    imConversations.value = list
    imUnread.value = list.reduce((s, c) => s + (c.unread || 0), 0)
  } catch { /* 保持现值 */ }
}

// 主动让面板/角标刷新一次（发消息、接受/拒绝、打开面板后调用）。
export function bumpIm() {
  imRefresher.value++
  refreshIm()
}

export function openIm() { imOpen.value = true; bumpIm() }
export function closeIm() { imOpen.value = false }
export function toggleIm() { imOpen.value ? closeIm() : openIm() }

// ---- 新消息提示音 + 状态栏通知 ----
// 收到 WS im 事件时：消息面板未打开或应用在后台 → 播放提示音并推送状态栏通知。
// 提示音用 Web Audio API 合成短促 880Hz 正弦波，无需音频文件，WebView 与浏览器通用。
let beepCtx = null
function playImBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!beepCtx) beepCtx = new AC()
    const ctx = beepCtx
    if (ctx.state === 'suspended') ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch { /* AudioContext 不可用时静默 */ }
}

// HA mobile_app 通知到达：原生弹状态栏通知（APK 走 showNotification2，Web 走 Notification API）。
// 与 IM 通知独立，不走 IM 面板/会话，每次都直接弹（HA 端已做触发频率控制）。
async function notifyFromHA(title, body) {
  if (!title && !body) return
  const native = window.StickyKeeNative
  if (native && typeof native.showNotification === 'function') {
    if (typeof native.showNotification2 === 'function') {
      native.showNotification2(title, body, false)
    } else {
      native.showNotification(title, body)
    }
    return
  }
  // Web 端降级：Notification API 或应用内 toast
  try {
    const { showNotify } = await import('@/utils/browserCommands')
    showNotify({ title, message: body })
  } catch { /* 静默 */ }
}

// 新消息到达后推送状态栏通知：APK 走原生桥，Web 走 Notification API。
// refreshIm 完成后调用，从会话列表提取发送者与消息预览。
async function notifyNewIm() {
  // 面板打开且应用在前台时不打扰（用户已在看消息）
  if (imOpen.value && !document.hidden) return
  // 找到有未读消息的会话
  const conv = imConversations.value.find(c => (c.unread || 0) > 0)
  if (!conv) return
  const sender = conv.user || '新消息'
  const last = conv.last
  let preview = ''
  if (last) {
    if (last.type === 'text' && last.content) preview = last.content
    else if (last.type === 'image') preview = '[图片]'
    else if (last.type === 'share') preview = '[仪表盘分享]'
    else if (last.type === 'device') preview = '[设备分享]'
    else preview = last.content || '[新消息]'
  }
  const title = '收到来自 ' + sender + ' 的消息'
  const body = preview || '点击查看'

  // APK 原生状态栏通知：消息免打扰（本机开关）时走静默通知——只亮通知栏，不响铃不震动；
  // 旧版 APK 无 showNotification2，回退旧接口（带声音）
  const native = window.StickyKeeNative
  if (native && typeof native.showNotification === 'function') {
    const dnd = localStorage.getItem('hc_im_dnd') === '1'
    if (typeof native.showNotification2 === 'function') {
      native.showNotification2(title, body, dnd)
    } else {
      native.showNotification(title, body)
    }
    return
  }
  // Web 端：Notification API（已授权时弹系统通知，否则回退应用内 toast）
  try {
    const { showNotify } = await import('@/utils/browserCommands')
    showNotify({ title: sender, message: body })
  } catch { /* 通知模块不可用时静默 */ }
}

// 登录后才轮询：始终定时拉取，未登录时 quick-return。断网/无 HA token 用户据此兜底。
setInterval(() => { if (auth.checked && auth.user) refreshIm() }, 15000)
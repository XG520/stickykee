// 全局共享状态：实例管理 + 实时状态。用 Composition API 单例，无需额外状态库。
import { reactive, ref } from 'vue'
import api, { wsUrl } from '@/api'
import { getDeviceId } from '@/utils/device'
import { dispatchCommand, registerService } from '@/utils/browserCommands'

// 后端是否可达（首次探测失败即 false）。
export const backendOnline = ref(false)

// 当前用户是否已配置个人 HA token（无配置即禁用 HA 访问）。
export const haTokenConfigured = ref(false)

// 认证状态（登录用户）。
export const auth = reactive({
  user: null,     // 当前登录用户名；null=未登录
  isAdmin: false,
  checked: false, // 是否已执行过登录态探测
})

function setToken(t) { if (t) sessionStorage.setItem('hc_token', t) }
function setAuth(u) {
  auth.user = u?.username ?? null
  auth.isAdmin = !!u?.is_admin
  auth.checked = true
}

// 登录/注册：成功后写入 token 与用户态。
export async function authLogin(username, password) {
  const { data } = await api.login({ username, password })
  setToken(data.token)
  setAuth(data)
  return data
}

export async function authRegister(username, password) {
  const { data } = await api.register({ username, password })
  setToken(data.token)
  setAuth(data)
  return data
}

// 退出登录：尽力通知后端，清空本地登录态。
export async function authLogout() {
  try { await api.logout() } catch { /* 后端离线也能退出 */ }
  sessionStorage.removeItem('hc_token')
  setAuth(null)
  store.ready = false
}

// 探测当前登录态：无有效会话则 user=null。
export async function loadMe() {
  try {
    const { data } = await api.me()
    setAuth(data)
  } catch {
    setAuth(null)
  }
  auth.checked = true
  return auth.user
}

// 修改密码：成功后替换本地 token。
export async function changePassword(old_password, new_password) {
  const { data } = await api.changePassword({ old_password, new_password })
  setToken(data.token)
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
export const entityStates = reactive({})

// 实体订阅回调（实体变化时通知各视图）。
const watchers = new Set()
export function onEntityChange(fn) { watchers.add(fn); return () => watchers.delete(fn) }

// 把一批实体状态写入缓存并触发订阅。
function applyStates(list) {
  if (!Array.isArray(list)) return
  const changed = new Set()
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
    entityStates[raw.entity_id] = raw
    changed.add(raw.entity_id)
  }
  watchers.forEach((fn) => { try { fn(changed) } catch {} })
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

function connectWS() {
  if (!store.ready || store.activeID <= 0) return
  // 未配置个人 HA token：不建立实时连接（后端不会为无 token 用户开连接）。
  if (!haTokenConfigured.value) return
  if (ws) { try { ws.close() } catch {} }
  ws = new WebSocket(wsUrl(store.activeID, getDeviceId()))
  ws.onopen = () => { backendOnline.value = true; retry = 1 }
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data)
      if (m.type === 'state') applyStates(m.data || [])
      else if (m.type === 'cmd') dispatchCommand(m.cmd, m.data)
      else if (m.type === 'im') refreshIm()
    } catch { /* 忽略坏帧 */ }
  }
  ws.onclose = () => {
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

// 拉取实例列表并建立实时连接。
export async function loadInstances() {
  store.error = ''
  try {
    const { data, meta } = await api.listInstances()
    store.instances = Array.isArray(data) ? data : []
    store.activeID = meta?.active_instance || (store.instances[0] && store.instances[0].id) || 0
    store.ready = true
    backendOnline.value = true
    await refreshHATokenStatus()
    connectWS()
  } catch (e) {
    store.error = e.message
    store.ready = false
    backendOnline.value = false
  }
}

// 刷新当前用户是否已配置个人 HA token（来自 /prefs）。
export async function refreshHATokenStatus() {
  try {
    const { data } = await api.getPrefs()
    haTokenConfigured.value = data?.ha_token_configured === 'true'
  } catch {
    /* 保持现值 */
  }
}

// 保存个人 HA token 后调用：更新本地状态并立即重连实时连接（后端已即时重建，无需重启）。
export async function saveHAToken(token) {
  await api.putPrefs({ ha_token: token })
  haTokenConfigured.value = !!token
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
  try {
    const { data } = await api.entities({ instance: instanceID || store.activeID })
    applyStates(data || [])
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
export const ui = reactive({ immersive: false })

// ===== 用户间消息中心（顶栏铃铛） =====
export const imOpen = ref(false)          // 消息面板开关
export const imUnread = ref(0)            // 未读总角标
export const imConversations = ref([])    // 会话列表（供面板与角标共用）
export const imRefresher = ref(0)         // 自增信号：通知面板重新拉取会话/未读

// 拉取会话列表并汇总未读数；静默容错（后端离线/未登录忽略）。
export async function refreshIm() {
  if (!auth.user) return
  try {
    const { data } = await api.listConversations()
    const list = Array.isArray(data) ? data : []
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

// 登录后才轮询：始终定时拉取，未登录时 quick-return。断网/无 HA token 用户据此兜底。
setInterval(() => { if (auth.checked && auth.user) refreshIm() }, 15000)
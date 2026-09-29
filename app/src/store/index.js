// 全局共享状态：实例管理 + 实时状态。用 Composition API 单例，无需额外状态库。
import { reactive, ref, shallowRef, toRaw } from 'vue'
import api, { wsUrl } from '@/api'
import { getDeviceId } from '@/utils/device'
import { dispatchCommand, registerService } from '@/utils/browserCommands'
import { mark, measure, count, record, autoReportOnce } from '@/utils/perf'
import { saveSnapshot, loadSnapshot, clearSnapshot, clearAll } from '@/utils/snapshotCache'
import { getPrefs, putPrefs } from '@/utils/prefs'

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
// 直接按 id 读（entityStates[id]）天然是「按实体」的细粒度订阅：
// Vue 的 reactive 按 key 追踪，只有该实体的字段变化才会打扰读它的组件。
export const entityStates = reactive({})

// 实体列表视图（供「需要遍历全部实体」的场景，如地图标记、设备页分组）。
// 用 shallowRef：只有实体集合本身增删（membership）时才替换，值变化不替换——
// 否则任何一次状态推送都会让所有遍历全表的组件重算+重渲染。
export const entityList = shallowRef([])

// 实体订阅回调（实体变化时通知各视图）。
const watchers = new Set()
export function onEntityChange(fn) { watchers.add(fn); return () => watchers.delete(fn) }

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
let snapSeen = false // 是否已收到过首帧全量快照（用于记录首屏耗时并自动打印基准）
let lastSeq = 0      // 增量流序号水位：后端按窗口合并推送并自增 seq，跳号即说明中间丢了帧

function connectWS() {
  if (!store.ready || store.activeID <= 0) return
  // 未配置个人 HA token：不建立实时连接（后端不会为无 token 用户开连接）。
  if (!haTokenConfigured.value) return
  if (ws) { try { ws.close() } catch {} }
  lastSeq = 0 // 新连接会收到带 seq 的全量快照，水位从头开始
  mark('ws:connect')
  ws = new WebSocket(wsUrl(store.activeID, getDeviceId()))
  ws.onopen = () => {
    backendOnline.value = true
    retry = 1
    mark('ws:open')
    measure('boot:wsOpen', 'boot:js')
  }
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data)
      count('ws:msg')
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
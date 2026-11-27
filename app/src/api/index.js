// 统一的 API 客户端：封装 /api/v1 前缀、鉴权头、数据解包与错误规范化。
import { sealJSON } from '@/utils/crypto'

const BASE = '/api/v1'

// 读取会话令牌：优先 sessionStorage（未勾「保持登录」的会话级令牌），
// 其次 localStorage（勾了「保持登录」的持久令牌）
export function getToken() {
  return sessionStorage.getItem('hc_token') || localStorage.getItem('hc_token') || ''
}

// 后端返回统一结构 { data, meta }；错误结构 { error: { code, message } }。
async function request(method, path, body) {
  const opts = { method, headers: {} }
  const token = getToken()
  if (token) opts.headers.Authorization = `Bearer ${token}`
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(BASE + path, opts)
  } catch (e) {
    throw err('network', '无法连接到后端服务，请确认 server 已启动')
  }
  let payload = {}
  try {
    payload = await res.json()
  } catch {
    /* 空响应 */
  }
  if (!res.ok) {
    const code = payload?.error?.code || 'http_' + res.status
    const message = payload?.error?.message || `请求失败 (${res.status})`
    throw err(code, message, res.status)
  }
  return { data: payload.data, meta: payload.meta }
}

function err(code, message, status) {
  const e = new Error(message)
  e.code = code
  e.status = status
  return e
}

// FormData 上传：不做 JSON 序列化，浏览器自动携带 multipart 边界与鉴权头。
async function postForm(path, form) {
  const token = getToken()
  let res
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
  } catch {
    throw err('network', '无法连接到后端服务，请确认 server 已启动')
  }
  let payload = {}
  try { payload = await res.json() } catch { /* 空响应 */ }
  if (!res.ok) {
    const code = payload?.error?.code || 'http_' + res.status
    const message = payload?.error?.message || `请求失败 (${res.status})`
    throw err(code, message, res.status)
  }
  return { data: payload.data, meta: payload.meta }
}

// 获取二进制流（如 TTS 音频）：返回 { blob, contentType }。
async function fetchBlob(method, path) {
  const token = getToken()
  const opts = { method, headers: {} }
  if (token) opts.headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(BASE + path, opts)
  } catch {
    throw err('network', '无法连接到后端服务，请确认 server 已启动')
  }
  if (!res.ok) {
    let message = `请求失败 (${res.status})`
    try {
      const p = await res.json()
      message = p?.error?.message || message
    } catch { /* 非 JSON 错误 */ }
    throw err('http_' + res.status, message, res.status)
  }
  const blob = await res.blob()
  return { blob, contentType: res.headers.get('content-type') || 'audio/wav' }
}

// 通用的实例路径：缺省用 active（url 空时后端走 active）。
function insPath(id) {
  return id && id > 0 ? `/instances/${id}` : '/instances'
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),

  // 健康检查（公开、无鉴权）：返回 {status, version}，设置页展示后端版本。
  // 响应走统一信封 {data:{...}}，此处拆包返回 data 部分。
  health: async () => {
    let res
    try {
      res = await fetch('/healthz', { cache: 'no-store' })
    } catch {
      throw err('network', '无法连接到后端服务')
    }
    if (!res.ok) throw err('http_' + res.status, `请求失败 (${res.status})`, res.status)
    const j = await res.json().catch(() => ({}))
    return (j && j.data) || {}
  },

  // App 安装包（需登录）：info 查可用性，download 经 fetch 携带令牌取流保存——
  // 浏览器导航下载无法携带 Authorization 头，未登录会被 401 拒绝。
  appInfo: () => api.get('/app/info'),
  appDownload: () => fetchBlob('GET', '/app/download'),

  // 认证
  authStatus: () => api.get('/auth/status'),
  register: (b) => api.post('/auth/register', b),
  login: (b) => api.post('/auth/login', b),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  changePassword: (b) => api.post('/auth/change-password', b),

  // 实例
  listInstances: () => api.get('/instances/'),
  createInstance: (p) => api.post('/instances/', p),
  updateInstance: (id, p) => api.put(`/instances/${id}`, p),
  deleteInstance: (id) => api.del(`/instances/${id}`),
  switchInstance: (id) => api.post(`/instances/${id}/switch`),
  instanceStatus: (id) => api.get(`/instances/${id}/status`),
  updateLocation: (id, p) => api.post(insPath(id) + '/location', p),
  pictureUrl: (id, entityId) => insPath(id) + '/picture?entity=' + encodeURIComponent(entityId),
  iconUrl: (name) => '/api/v1/icons/' + encodeURIComponent(name) + '.svg',
  iconList: () => api.get('/api/v1/icons'),
  getDevices: () => api.get('/devices'),
  registerDevice: (device) => api.post('/devices', device),
  renameDevice: (deviceId, name) => api.put(`/devices/${deviceId}`, { name }),
  deleteDevice: (deviceId) => api.del(`/devices/${deviceId}`),

  // 设备传感器
  sensorDefinitions: () => api.get('/sensors/definitions'),
  reportSensors: (id, p) => api.post(insPath(id) + '/sensors/report', p),

  // 实体
  entities: (opts = {}) => {
    const q = new URLSearchParams()
    if (opts.domain) q.set('domain', opts.domain)
    if (opts.type) q.set('type', opts.type)
    if (opts.room) q.set('room', opts.room)
    if (opts.q) q.set('q', opts.q)
    const s = q.toString()
    return api.get(insPath(opts.instance) + `/entities${s ? '?' + s : ''}`)
  },
  // 设备注册表（官方设备管理页：以设备为单位聚合其下实体 + 实时状态）
  registryDevices: (id = 0) => api.get(insPath(id) + '/registry/devices'),
  // 实体图标覆盖（本系统生效，不写回 HA）；icon 空串恢复默认
  setEntityIcon: (id, entityId, icon) =>
    api.put(insPath(id) + `/registry/entities/${encodeURIComponent(entityId)}/icon`, { icon }),
  entity: (id, entityId) => api.get(insPath(id) + `/entities/${encodeURIComponent(entityId)}`),
  toggle: (id, entityId) => api.post(insPath(id) + `/entities/${encodeURIComponent(entityId)}/toggle`),

  // 服务通用转发
  callService: (id, p) => api.post(insPath(id) + '/services', p),
  // HA 服务目录（含字段定义），供自动化动作编辑器使用。
  serviceCatalog: (id = 0) => api.get(insPath(id) + '/services'),

  // 场景 / 自动化
  scenes: (id = 0) => api.get(insPath(id) + '/scenes'),
  automations: (id = 0) => api.get(insPath(id) + '/automations'),
  automationTurn: (id, entityId, action) =>
    api.post(`${insPath(id)}/automations/${encodeURIComponent(entityId)}/${action}`),
  createAutomation: (id, cfg) => api.post(insPath(id) + '/automations', cfg),
  automationConfig: (id, entityId) =>
    api.get(`${insPath(id)}/automations/${encodeURIComponent(entityId)}/config`),
  updateAutomation: (id, entityId, cfg) =>
    api.put(`${insPath(id)}/automations/${encodeURIComponent(entityId)}`, cfg),
  deleteAutomation: (id, entityId) =>
    api.del(`${insPath(id)}/automations/${encodeURIComponent(entityId)}`),

  // 能耗 / 历史 / 日志
  statistics: (id, q) => api.get(insPath(id) + `/statistics?${new URLSearchParams(q)}`),
  history: (id, q) => api.get(insPath(id) + `/history?${new URLSearchParams(q)}`),
  logs: (id, q) => api.get(insPath(id) + `/logs?${new URLSearchParams(q)}`),

  // 偏好
  getPrefs: () => api.get('/prefs'),
  putPrefs: (body) => api.put('/prefs', body),
  // AI：OpenAI 兼容转发（key 由后端从用户 ai_config / 管理员全局配置注入）
  aiChat: (messages) => api.post('/ai/chat', { messages }),
  aiTest: () => api.post('/ai/test'),
  // AI 诊断（管理员）
  diagStart: (duration_min, client_meta) => api.post('/diagnostics/start', { duration_min, client_meta }),
  diagStop: () => api.post('/diagnostics/stop'),
  diagStatus: () => api.get('/diagnostics/status'),
  diagLogs: (after = 0) => api.get(`/diagnostics/logs?after=${after}`),
  diagClientLogs: (entries) => api.post('/diagnostics/logs', { entries }),
  diagReport: () => api.get('/diagnostics/report'),
  // 运行日志（管理员）：按级别/来源/时间段筛选，可提交 AI 分析
  sysLogs: (q = {}) => api.get(`/logs?${new URLSearchParams(q)}`),
  sysLogAnalysis: () => api.get('/logs/analysis'),
  sysLogAnalyze: (body) => api.post('/logs/analysis', body),
  // 系统显示名称/图标：公开读取；修改需管理员（nameEn 可选，一并修改英文名）
  getSiteName: () => api.get('/site-name'),
  putSiteName: (name, nameEn) => api.put('/site-name', { name, name_en: nameEn }),
  getSiteIcon: () => api.get('/site-icon'),
  putSiteIcon: (icon) => api.put('/site-icon', { icon }),
  // 上传自定义图标图片（data URL，管理员）：与 Material 图标互斥，重新选择 Material 自动清除
  putSiteIconImage: (img) => api.put('/site-icon/image', { img }),

  // 用户管理（仅管理员）
  listUsers: () => api.get('/users'),
  createUser: (b) => api.post('/users', b),
  updateUser: (username, b) => api.put(`/users/${username}`, b),
  setUserMapPolicy: (username, useAdmin) => api.put(`/users/${username}/map`, { use_admin: useAdmin }),
  // 记账模块授权（管理员）：{ view, operate }；operate 隐含 view
  setUserFinancePerm: (username, p) => api.put(`/users/${encodeURIComponent(username)}/finance`, p),
  setUserHAToken: (username, token) => api.put(`/users/${username}/ha`, { token }),
  // 账号级生日（管理员代设）：GET 读列表，PUT 传数组；保存后服务端同步该账号 HA 生日传感器
  getUserBirthdays: (username) => api.get(`/users/${encodeURIComponent(username)}/birthdays`),
  setUserBirthdays: (username, list) => api.put(`/users/${encodeURIComponent(username)}/birthdays`, { birthdays: list }),
  deleteUser: (username) => api.del(`/users/${username}`),

  // 库存 / 食品库
  inventoryLocations: () => api.get('/inventory/locations'),
  createInventoryLocation: (p) => api.post('/inventory/locations', p),
  updateInventoryLocation: (id, p) => api.put(`/inventory/locations/${id}`, p),
  deleteInventoryLocation: (id) => api.del(`/inventory/locations/${id}`),
  inventoryItems: (q = {}) => api.get(`/inventory/items?${new URLSearchParams(q)}`),
  createInventoryItem: (p) => api.post('/inventory/items', p),
  inventoryItem: (id) => api.get(`/inventory/items/${id}`),
  updateInventoryItem: (id, p) => api.put(`/inventory/items/${id}`, p),
  deleteInventoryItem: (id) => api.del(`/inventory/items/${id}`),
  addInventoryBatch: (itemId, p) => api.post(`/inventory/items/${itemId}/batches`, p),
  consumeInventoryBatch: (id, qty) => api.post(`/inventory/batches/${id}/consume`, { qty }),
  discardInventoryBatch: (id) => api.post(`/inventory/batches/${id}/discard`),
  moveInventoryBatch: (id, locationId) => api.post(`/inventory/batches/${id}/move`, { location_id: locationId }),
  openInventoryBatch: (id) => api.post(`/inventory/batches/${id}/open`),
  inventoryStats: (expiringDays = 3) => api.get(`/inventory/stats?expiring_days=${expiringDays}`),
  inventoryLogs: (limit = 100) => api.get(`/inventory/logs?limit=${limit}`),
  inventoryShopping: (all = false) => api.get(`/inventory/shopping-list${all ? '?all=1' : ''}`),
  addInventoryShopping: (p) => api.post('/inventory/shopping-list', p),
  updateInventoryShopping: (id, p) => api.put(`/inventory/shopping-list/${id}`, p),
  checkInventoryShopping: (id, done) => api.post(`/inventory/shopping-list/${id}/check`, { done }),
  deleteInventoryShopping: (id) => api.del(`/inventory/shopping-list/${id}`),
  itemToShopping: (itemId, quantity = 1) => api.post(`/inventory/items/${itemId}/to-shopping`, { quantity }),
  consumeInventoryItem: (itemId, qty = 1) => api.post(`/inventory/items/${itemId}/consume`, { qty }),
  inventoryBarcode: (code) => api.get(`/inventory/barcodes/${encodeURIComponent(code)}`),
  inventoryBarcodeProduct: (code) => api.get(`/inventory/barcodes/${encodeURIComponent(code)}/product`),
  bindInventoryBarcode: (p) => api.post('/inventory/barcodes', p),
  recognizeInventoryImage: (image) => api.post('/inventory/recognize', { image }),
  inventoryStocktake: (lines) => api.post('/inventory/stocktake', { lines }),
  inventoryExport: () => api.get('/inventory/export'),

  // 记账 / 账本
  financeAccounts: (all = false) => api.get(`/finance/accounts${all ? '?all=1' : ''}`),
  createFinanceAccount: (p) => api.post('/finance/accounts', p),
  updateFinanceAccount: (id, p) => api.put(`/finance/accounts/${id}`, p),
  deleteFinanceAccount: (id) => api.del(`/finance/accounts/${id}`),
  financeCategories: (type = '') => api.get(`/finance/categories${type ? `?type=${type}` : ''}`),
  createFinanceCategory: (p) => api.post('/finance/categories', p),
  updateFinanceCategory: (id, p) => api.put(`/finance/categories/${id}`, p),
  deleteFinanceCategory: (id) => api.del(`/finance/categories/${id}`),
  financeTransactions: (q = {}) => api.get(`/finance/transactions?${new URLSearchParams(q)}`),
  createFinanceTransaction: (p) => api.post('/finance/transactions', p),
  updateFinanceTransaction: (id, p) => api.put(`/finance/transactions/${id}`, p),
  deleteFinanceTransaction: (id) => api.del(`/finance/transactions/${id}`),
  restoreFinanceTransaction: (id) => api.post(`/finance/transactions/${id}/restore`),
  financeTransfer: (p) => api.post('/finance/transfer', p),
  financeStats: (month = '') => api.get(`/finance/stats${month ? `?month=${month}` : ''}`),
  financeBudgets: (month = '') => api.get(`/finance/budgets${month ? `?month=${month}` : ''}`),
  setFinanceBudgets: (month, items) => api.put(`/finance/budgets?month=${month}`, { items }),
  financeTrend: (months = 6) => api.get(`/finance/trend?months=${months}`),
  financeReportData: (filters) => api.post('/finance/reports/data', { filters }),
  financeReportTransactions: (filters, page = 1, pageSize = 20) => api.post('/finance/reports/transactions', { filters, page, page_size: pageSize }),
  financeReports: () => api.get('/finance/reports'),
  createFinanceReport: (p) => api.post('/finance/reports', p),
  financeReport: (id) => api.get(`/finance/reports/${id}`),
  deleteFinanceReport: (id) => api.del(`/finance/reports/${id}`),
  financeReportExport: (id) => api.get(`/finance/reports/${id}/export`),
  financeExport: (month = '') => api.get(`/finance/export${month ? `?month=${month}` : ''}`),
  financeRecognize: (image) => api.post('/finance/recognize', { image }),
  financeNotification: (p) => api.post('/finance/notification', p),
  financeImport: (p) => api.post('/finance/import', p),
  financeRecurring: () => api.get('/finance/recurring'),
  createFinanceRecurring: (p) => api.post('/finance/recurring', p),
  updateFinanceRecurring: (id, p) => api.put(`/finance/recurring/${id}`, p),
  deleteFinanceRecurring: (id) => api.del(`/finance/recurring/${id}`),
  purchaseShoppingItem: (id, p) => api.post(`/inventory/shopping-list/${id}/purchase`, p),

  // 用户间 IM & 仪表盘共享
  listConversations: () => api.get('/messages/conversations'),
  listContacts: () => api.get('/messages/contacts'),
  getMessages: (user, limit = 50, before = 0) =>
    api.get(`/messages/${encodeURIComponent(user)}?limit=${limit}${before > 0 ? `&before=${before}` : ''}`),
  sendMessage: async (user, content) => {
    const env = await sealJSON({ content })
    return api.post(`/messages/${encodeURIComponent(user)}`, env)
  },
  sendImage: (user, form) => postForm(`/messages/${encodeURIComponent(user)}/image`, form),
  sendAudio: (user, form) => postForm(`/messages/${encodeURIComponent(user)}/audio`, form),
  assistantTTS: (text, engine) => fetchBlob('GET', `/messages/assistant/tts?text=${encodeURIComponent(text)}${engine ? '&engine=' + encodeURIComponent(engine) : ''}`),
  recallMessage: (id) => api.post(`/messages/${id}/recall`),
  sendShare: (user, dashboard, targets) => api.post(`/messages/${encodeURIComponent(user)}/share`, { dashboard, targets }),
  sendDevice: (user, device) => api.post(`/messages/${encodeURIComponent(user)}/device`, { device }),
  markMessageRead: (user) => api.post(`/messages/${encodeURIComponent(user)}/read`),
  acceptShare: (id) => api.post(`/messages/${id}/accept`),
  declineShare: (id) => api.post(`/messages/${id}/decline`),

  // 智家助手：可用的 HA 对话代理列表（设置页「对话代理」选择器）
  getHaAgents: () => api.get('/messages/assistant/agents'),
  // 智家助手：可用的 HA TTS 引擎列表（朗读下拉动态展示，刷新方式与对话代理一致）
  getHaTtsServices: () => api.get('/messages/tts/services'),

  // 语音通话信令。join/leave/reject 携带本机 device id：
  // 同账号多端在线时，后端事件回传 device 供其它设备识别"已在其他设备操作"。
  callStart: (members, device) => api.post('/call/start', { members, device }),
  callSignal: (room, to, data) => api.post('/call/signal', { room, to, data }),
  callJoin: (room, device) => api.post('/call/join', { room, device }),
  callLeave: (room, device) => api.post('/call/leave', { room, device }),
  callReject: (room, device) => api.post('/call/reject', { room, device }),
}

// WS 也能提供封装的路径拼接（供实时连接使用）。
export const wsUrl = (instanceId, deviceId) => {
  const p = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host
  // 浏览器无法为 WebSocket 设置 Header，随 query 附带会话 token 与设备标识。
  // device_id 供后端将 Browser_mod 命令按设备定向路由到本连接。
  const params = new URLSearchParams()
  if (instanceId) params.set('instance', instanceId)
  const token = getToken()
  if (token) params.set('token', token)
  if (deviceId) params.set('device', deviceId)
  return `${p}://${host}/api/v1/ws?${params.toString()}`
}

export default api
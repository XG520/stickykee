// 统一的 API 客户端：封装 /api/v1 前缀、鉴权头、数据解包与错误规范化。
const BASE = '/api/v1'

// 后端返回统一结构 { data, meta }；错误结构 { error: { code, message } }。
async function request(method, path, body) {
  const opts = { method, headers: {} }
  const token = sessionStorage.getItem('hc_token')
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

// 通用的实例路径：缺省用 active（url 空时后端走 active）。
function insPath(id) {
  return id && id > 0 ? `/instances/${id}` : '/instances'
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),

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
  entity: (id, entityId) => api.get(insPath(id) + `/entities/${encodeURIComponent(entityId)}`),
  toggle: (id, entityId) => api.post(insPath(id) + `/entities/${encodeURIComponent(entityId)}/toggle`),

  // 服务通用转发
  callService: (id, p) => api.post(insPath(id) + '/services', p),

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
}

// WS 也能提供封装的路径拼接（供实时连接使用）。
export const wsUrl = (instanceId) => {
  const p = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const host = window.location.host
  // 浏览器无法为 WebSocket 设置 Header，随 query 附带会话 token。
  const token = sessionStorage.getItem('hc_token') || ''
  return `${p}://${host}/api/v1/ws?instance=${instanceId || ''}&token=${encodeURIComponent(token)}`
}

export default api
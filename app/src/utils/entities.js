// 实体展示映射：把后端 DisplayEntity 转为各视图卡片所需的结构。
// 后端字段：{ entity_id, domain, state, friendly_name, icon, device_class, unit, area, floor, attributes }

// 判断实体是否"开启"（按 domain 语义 + state 文本）。
export function isOn(entity) {
  if (!entity) return false
  const s = String(entity.state || '').toLowerCase()
  if (s === 'on' || s === 'open' || s === 'opening' || s === 'playing') return true
  if (s === 'unlocked' || s === 'disarmed') return true
  return false
}

// 前端 tabs 的 type 归类（与后端 matchesType 对齐）。
export function classifyType(entity) {
  const d = entity.domain
  const name = (entity.friendly_name || '')
  if (d === 'light') return 'lighting'
  if (d === 'climate' || d === 'fan' || d === 'humidifier' || d === 'air_quality' || name.includes('空调') || name.includes('空气净化')) return 'climate'
  if (d === 'lock' || d === 'alarm_control_panel' || d === 'camera' || name.includes('摄像头') || name.includes('门锁')) return 'security'
  if (d === 'cover') return 'curtain'
  if (d === 'switch' || d === 'plug' || d === 'binary_sensor') return 'other'
  return 'other'
}

// tabKey → 展示名（DevicesView tabs 复用）。
export const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'lighting', label: '💡 灯光' },
  { key: 'climate', label: '🌡 环境' },
  { key: 'security', label: '🔒 安防' },
  { key: 'curtain', label: '🪟 窗帘' },
  { key: 'other', label: '⚙ 其他' },
]

// 按 entity_id 分组到房间（取 area 字段，缺省"未分组"；没有 area 信息时按 domain 归入提示）。
export function groupByRoom(entities) {
  const map = new Map()
  for (const e of entities || []) {
    const room = (e.area && e.area.trim()) || '其他设备'
    if (!map.has(room)) map.set(room, [])
    map.get(room).push(e)
  }
  return [...map.entries()].map(([name, list]) => ({ name, devices: list }))
}

// 把 Material Symbols 的 md 图标转换为字体名（去掉 mdi: 前缀；未知时给兜底）。
export function iconFor(entity, fallback = 'widgets') {
  const raw = entity?.icon || ''
  if (!raw) return fallback
  // HA 图标形如 mdi:lightbulb；去掉前缀并处理连字符→下划线。
  const base = raw.split(':').pop() || ''
  if (!base) return fallback
  return base.replace(/-/g, '_')
}

// 提取 attributes 中的字符串/数值字段。
export function attr(entity, key, fallback = '') {
  const a = entity?.attributes
  if (!a) return fallback
  const v = a[key]
  return v === undefined || v === null ? fallback : v
}

// 安全转数值；非有限数返回 null。
export function numVal(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// 单个实体当前功耗(W)：优先 current_power_w，其次 power。
export function powerOf(e) {
  return numVal(attr(e, 'current_power_w')) ?? numVal(attr(e, 'power'))
}

// 一组实体总功耗(W)；kW = W/1000。
export function totalPower(entities) {
  return (entities || []).reduce((s, e) => s + (powerOf(e) || 0), 0)
}

// 生成设备卡片的动态 class 组（前端各卡片复用配色，简单启发式）。
export const palette = {
  light: { iconBox: 'bg-primary/15 border border-primary/30', iconColor: 'text-primary', toggleColor: 'bg-primary' },
  climate: { iconBox: 'bg-info/15 border border-info/30', iconColor: 'text-info', toggleColor: 'bg-info' },
  security: { iconBox: 'bg-success/15 border border-success/30', iconColor: 'text-success', toggleColor: 'bg-success' },
  curtain: { iconBox: 'bg-warning/15 border border-warning/30', iconColor: 'text-warning', toggleColor: 'bg-warning' },
  other: { iconBox: 'bg-accent/15 border border-accent/30', iconColor: 'text-accent', toggleColor: 'bg-accent' },
}

// ---- HA 领域卡片基础规范：domain → 图标/配色/默认字标（与 HA 原生对齐） ----
export const domainColorCls = {
  light: 'text-warning', switch: 'text-primary', plug: 'text-primary', valve: 'text-primary',
  fan: 'text-info', input_boolean: 'text-success', button: 'text-info', input_button: 'text-info',
  sensor: 'text-info', binary_sensor: 'text-success', number: 'text-info', input_number: 'text-info',
  climate: 'text-info', water_heater: 'text-warning', humidifier: 'text-info',
  cover: 'text-warning', media_player: 'text-accent', lock: 'text-success',
  alarm_control_panel: 'text-success', camera: 'text-accent', vacuum: 'text-info',
  scene: 'text-info', script: 'text-info', automation: 'text-info',
  person: 'text-success', device_tracker: 'text-success', zone: 'text-success', sun: 'text-warning',
  weather: 'text-info', update: 'text-warning', select: 'text-info', input_select: 'text-info',
  text: 'text-muted', input_text: 'text-muted', time: 'text-info', input_datetime: 'text-info',
  timer: 'text-warning', calendar: 'text-info', siren: 'text-warning', remote: 'text-primary',
  group: 'text-primary', plant: 'text-success', counter: 'text-info', fan: 'text-info',
  event: 'text-info', image: 'text-accent', lawn_mower: 'text-success', date: 'text-info', datetime: 'text-info',
}

export const domainGlyph = {
  light: 'lightbulb', switch: 'toggle_on', plug: 'power', valve: 'valve',
  fan: 'mode_fan', input_boolean: 'check_circle', button: 'radio_button_checked', input_button: 'radio_button_checked',
  sensor: 'sensors', binary_sensor: 'sensors', number: 'pin', input_number: 'pin',
  climate: 'thermostat', water_heater: 'water_heater', humidifier: 'water_drop',
  cover: 'curtains', media_player: 'tv', lock: 'lock',
  alarm_control_panel: 'shield', camera: 'videocam', vacuum: 'robot',
  scene: 'magic_button', script: 'terminal', automation: 'bolt',
  person: 'person', device_tracker: 'location_on', zone: 'location_on', sun: 'wb_sunny',
  weather: 'partly_cloudy_day', update: 'system_update', select: 'arrow_drop_down_circle', input_select: 'arrow_drop_down_circle',
  text: 'text_fields', input_text: 'text_fields', time: 'schedule', input_datetime: 'calendar_today',
  timer: 'timer', calendar: 'calendar_month', siren: 'notification_important', remote: 'remote_gen',
  group: 'group_work', plant: 'spa', counter: 'counter',
  event: 'event', image: 'image', lawn_mower: 'yard', date: 'calendar_today', datetime: 'calendar_today',
}

// 判断实体是否可一键开关（领域语义 + 当前状态），用于通用卡/开关类卡渲染控制。
export const toggleableDomains = new Set([
  'light', 'switch', 'plug', 'fan', 'valve', 'input_boolean', 'group', 'remote',
  'siren', 'cover', 'media_player', 'lock', 'vacuum', 'humidifier', 'automation',
])
export function canToggle(entity) {
  if (!entity) return false
  return toggleableDomains.has(entity.domain)
}

// 提取用于通用卡片展示的关键属性（优先显示核心数值）。
export function keyAttr(e) {
  if (!e) return []
  const a = e.attributes || {}
  const want = ['current_temperature', 'temperature', 'humidity', 'current_power_w', 'power', 'voltage',
    'battery_level', 'battery', 'brightness', 'illuminance', 'air_quality_index', 'pm2_5', 'pm10',
    'co2', 'pressure', 'wind_speed', 'current', 'energy', 'volume_level', 'media_title', 'device_class']
  const out = []
  for (const k of want) {
    if (a[k] !== undefined && a[k] !== null && a[k] !== '') {
      const u = (k === 'temperature' || k === 'current_temperature') ? (a.unit_of_measurement || '°C')
        : k === 'humidity' ? '%'
        : k === 'battery_level' || k === 'battery' ? '%'
        : k === 'volume_level' ? '%'
        : (a.unit_of_measurement || '')
      out.push({ key: k, label: k, value: a[k], unit: u })
    }
  }
  return out.slice(0, 3)
}
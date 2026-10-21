// 交互乐观更新：任何设备操作（开关 / 服务调用）点击后立即按目标态渲染 UI，不等服务端往返。
// 消除「按下没反应→连点」的同时，保证 UI 与实体状态最终一致（异步校正）。
//
// override 三通道（同一实体可组合，校正时逐通道独立确认）：
//   on    —— 布尔开态（isOn 口径，领域无关；用于 turn_on/turn_off/toggle 类）
//   state —— 精确目标状态（'locked'/'playing'/'armed_away'…；数组时首元素用于展示，
//            全部元素均视为确认态，以容纳 locking/arming 等过渡态）
//   attrs —— 属性目标值（temperature / fan_mode / volume_level…）
//
// 校正三条路径：
//   1. WS 推送真实状态匹配目标 → 对应通道清除（确认成功，无跳变）
//   2. 超时（8s）未确认 → 整条清除，UI 回退真实态
//      （WOL 场景：点 on 后设备未起、HA 不推 on，UI 自动回 off；设备真开后推送 on，UI 再跟随）
//   3. 调用失败（catch）→ 调用方 clearOptimistic 立即回滚
//
// override 独立于 entityStates 存储，不污染全局真实状态缓存（历史实现直接写
// entityStates.state，会波及所有订阅该实体的组件且与 WS 原地更新互相覆盖，行为不可控）。
import { reactive } from 'vue'
import { entityStates, onEntityChange } from '@/store'
import { isOn, numVal } from '@/utils/entities'

// 乐观覆盖有效期：HA 操作一般 1-2s 内状态回推，慢设备（WOL/部分 Zigbee）给足 8s。
const OPTIMISTIC_TTL = 8000

// entity_id → { on?: boolean, state?: string|string[], attrs?: object }。
// 模块级单例：同一实体在仪表盘卡片/设备页/抽屉/更多信息面板间天然联动。
const overrides = reactive({})
const timers = new Map()

// 校正订阅惰性注册：不可在模块顶层调用 onEntityChange——
// 本模块可能经 browserCommands → EntityMoreInfo 链路在 store/index.js 初始化完成前被求值，
// 顶层调用会撞上 store 内部 watchers 的 TDZ（Cannot access 'watchers' before initialization，整站黑屏）。
// 首次写入覆盖时注册，此时 store 必然已就绪（写入只能由用户交互触发）。
let subscribed = false
function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  onEntityChange(correctFromRealState)
}

// 合并写入覆盖：state 与 on 互斥（新操作语义覆盖旧目标），attrs 按 key 合并；每次写入重置有效期。
export function setOverride(id, patch) {
  if (!id || !patch) return
  ensureSubscribed()
  const next = { ...(overrides[id] || {}) }
  if (patch.on !== undefined) { next.on = patch.on; delete next.state }
  if (patch.state !== undefined) { next.state = patch.state; delete next.on }
  if (patch.attrs) next.attrs = { ...(next.attrs || {}), ...patch.attrs }
  overrides[id] = next
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => clearOptimistic(id), OPTIMISTIC_TTL))
}

// 布尔开关语义入口（无法精确到领域状态时的兜底）
export function setOptimistic(id, targetOn) {
  setOverride(id, { on: !!targetOn })
}

export function clearOptimistic(id) {
  if (!(id in overrides)) return
  delete overrides[id]
  clearTimeout(timers.get(id))
  timers.delete(id)
}

function displayState(s) { return Array.isArray(s) ? s[0] : s }

// 实体的有效展示态：覆盖优先（state > on），其次真实状态。
function effectiveState(entity) {
  if (!entity) return ''
  const o = overrides[entity.entity_id]
  if (o) {
    if (o.state != null) return String(displayState(o.state))
    if (o.on != null) return o.on ? 'on' : 'off'
  }
  return String(entity.state || '')
}

// 有效开态：覆盖优先，其次真实状态。点击时据此计算目标态（连点改主意即反转当前目标）。
export function effectiveOn(entity) {
  if (!entity) return false
  const o = overrides[entity.entity_id]
  if (o && o.on != null) return o.on
  return isOn({ ...entity, state: effectiveState(entity) })
}

// 渲染出口统一包层：有覆盖则返回带目标态/目标属性的新对象（不污染传入实体）。
export function applyOptimistic(entity) {
  if (!entity) return entity
  const o = overrides[entity.entity_id]
  if (!o) return entity
  let out = entity
  if (o.state != null) out = { ...out, state: String(displayState(o.state)) }
  else if (o.on != null) out = { ...out, state: o.on ? 'on' : 'off' }
  if (o.attrs) out = { ...out, attributes: { ...(out.attributes || {}), ...o.attrs } }
  return out
}

// ---- 服务 → 目标状态映射：让「所有设备交互」都能点击即显目标态 ----
// 映射不到的服务（场景/脚本触发、媒体切歌等无持续状态变化）返回 null，调用方保留 fired 脉冲反馈。

// 无持续状态语义的域：turn_on 只是一次性动作，不做状态覆盖
const NO_STATE_DOMAINS = new Set(['scene', 'script', 'button', 'input_button'])

// 精确目标状态表：值为数组时首元素为展示态，其余为可接受的过渡确认态
const STATE_TARGETS = {
  'lock.lock': ['locked', 'locking'],
  'lock.unlock': ['unlocked', 'unlocking'],
  'lock.open': ['open', 'opening'],
  'alarm_control_panel.alarm_disarm': 'disarmed',
  'alarm_control_panel.alarm_arm_home': ['armed_home', 'arming', 'pending'],
  'alarm_control_panel.alarm_arm_away': ['armed_away', 'arming', 'pending'],
  'alarm_control_panel.alarm_arm_night': ['armed_night', 'arming', 'pending'],
  'alarm_control_panel.alarm_arm_vacation': ['armed_vacation', 'arming', 'pending'],
  'alarm_control_panel.alarm_arm_custom_bypass': ['armed_custom_bypass', 'arming', 'pending'],
  'timer.start': 'active',
  'timer.pause': 'paused',
  'timer.cancel': 'idle',
  'timer.finish': 'finished',
  'media_player.media_play': 'playing',
  'media_player.media_pause': 'paused',
  // 扫地机新老两套状态族并存（on/off 与 cleaning/paused/docked），全部列为确认态
  'vacuum.start': ['cleaning', 'on'],
  'vacuum.pause': 'paused',
  'vacuum.stop': ['idle', 'off'],
  'vacuum.return_to_base': ['returning', 'docked'],
  'lawn_mower.start_mowing': 'mowing',
  'lawn_mower.pause': 'paused',
  'lawn_mower.dock': ['returning', 'docked'],
  'cover.open_cover': ['open', 'opening'],
  'cover.close_cover': ['closed', 'closing'],
  'update.skip': 'off',
}

// 服务参数 → 实体属性 的直写映射（属性类目标的即时反馈，如 set_temperature → attributes.temperature）
const ATTR_ARGS = {
  temperature: 'temperature',
  humidity: 'humidity',
  fan_mode: 'fan_mode',
  preset_mode: 'preset_mode',
  swing_mode: 'swing_mode',
  swing_horizontal_mode: 'swing_horizontal_mode',
  effect: 'effect',
  source: 'source',
  sound_mode: 'sound_mode',
  fan_speed: 'fan_speed',
  direction: 'direction',
  position: 'current_position',
  tilt_position: 'current_tilt_position',
  volume_level: 'volume_level',
  is_volume_muted: 'is_volume_muted',
  oscillating: 'oscillating',
  away_mode: 'away_mode',
  color_temp_kelvin: 'color_temp_kelvin',
  tone: 'tone',
}

// 计数器 ±/重置：读当前有效值按步进推算（带上下限夹取）
function counterTarget(entity, dir) {
  const cur = numVal(effectiveState(entity)) ?? 0
  const a = (entity && entity.attributes) || {}
  const step = numVal(a.step) ?? 1
  const min = numVal(a.minimum)
  const max = numVal(a.maximum)
  let v = cur + dir * step
  if (min != null) v = Math.max(min, v)
  if (max != null) v = Math.min(max, v)
  return String(Math.round(v * 100) / 100)
}

// HA 状态串格式：日期时间 "YYYY-MM-DD HH:MM:SS"、时间 "HH:MM:SS"、日期 "YYYY-MM-DD"
function normTimeText(t) { return /^\d{2}:\d{2}$/.test(t) ? t + ':00' : t }
function normDatetimeText(v) {
  return String(v).replace('T', ' ').replace(/ (\d{2}:\d{2})$/, ' $1:00')
}
function datetimeStateText(domain, args, entity) {
  if (args.datetime !== undefined) return normDatetimeText(args.datetime)
  if (args.date !== undefined && args.time !== undefined) return `${args.date} ${normTimeText(String(args.time))}`
  if (args.date !== undefined) return String(args.date)
  if (args.time !== undefined) return normTimeText(String(args.time))
  if (args.value !== undefined) {
    const v = String(args.value)
    if (domain === 'time') return normTimeText(v)
    if (domain === 'datetime') return normDatetimeText(v)
    if (domain === 'input_datetime') {
      const a = (entity && entity.attributes) || {}
      const hasDate = a.has_date !== false
      const hasTime = a.has_time === true
      if (hasDate && hasTime) return normDatetimeText(v)
      if (hasTime) return normTimeText(v)
      return v
    }
    return v
  }
  return null
}

function servicePatch(domain, service, args, entity) {
  const key = domain + '.' + service
  if (STATE_TARGETS[key]) return { state: STATE_TARGETS[key] }

  // 播放/暂停二合一：按当前有效态翻转目标
  if (key === 'media_player.media_play_pause') {
    return { state: effectiveState(entity) === 'playing' ? 'paused' : 'playing' }
  }
  // 窗帘 toggle：按当前有效开态决定目标
  if (key === 'cover.toggle') {
    return { state: effectiveOn(entity) ? ['closed', 'closing'] : ['open', 'opening'] }
  }
  // 计数器
  if (key === 'counter.increment') return { state: counterTarget(entity, 1) }
  if (key === 'counter.decrement') return { state: counterTarget(entity, -1) }
  if (key === 'counter.reset') {
    const init = entity && entity.attributes ? numVal(entity.attributes.initial) : null
    return { state: String(init ?? 0) }
  }

  // 运行模式即状态的域：模式切换 = 状态切换
  if (domain === 'climate' && args.hvac_mode !== undefined && (service === 'set_hvac_mode' || service === 'turn_on')) {
    return { state: String(args.hvac_mode) }
  }
  if (domain === 'water_heater' && service === 'set_operation_mode' && args.operation_mode !== undefined) {
    // water_heater 的 operation_mode 同时以属性暴露（卡片模式芯片读属性），两通道都写
    return { state: String(args.operation_mode), attrs: { operation_mode: args.operation_mode } }
  }
  if (domain === 'humidifier' && service === 'set_mode' && args.mode !== undefined) {
    return { attrs: { mode: args.mode } }
  }

  // 状态直写类：数值 / 文本 / 选项 / 日期时间
  if (service === 'set_value' && args.value !== undefined &&
      (domain === 'number' || domain === 'input_number' || domain === 'text' || domain === 'input_text' || domain === 'counter')) {
    return { state: String(args.value) }
  }
  if (service === 'select_option' && args.option !== undefined && (domain === 'select' || domain === 'input_select')) {
    return { state: String(args.option) }
  }
  if ((domain === 'input_datetime' && service === 'set_datetime') ||
      ((domain === 'datetime' || domain === 'date' || domain === 'time') && service === 'set_value')) {
    const s = datetimeStateText(domain, args, entity)
    return s ? { state: s } : null
  }

  // 灯光 turn_on：附带效果/亮度/色温时一并覆盖；开灯动作本身即开态
  if (key === 'light.turn_on') {
    const attrs = {}
    if (args.effect !== undefined) attrs.effect = args.effect
    if (args.color_temp_kelvin !== undefined) attrs.color_temp_kelvin = args.color_temp_kelvin
    if (args.brightness !== undefined) attrs.brightness = args.brightness
    if (args.brightness_pct !== undefined) attrs.brightness = Math.round((Number(args.brightness_pct) / 100) * 255)
    return Object.keys(attrs).length ? { attrs, on: true } : { on: true }
  }
  // 风扇按百分比调速：0% 即关机
  if (key === 'fan.set_percentage' && args.percentage !== undefined) {
    return { attrs: { percentage: args.percentage }, on: Number(args.percentage) > 0 }
  }

  // 通用开/关（一次性动作域除外）
  if (service === 'turn_on' && !NO_STATE_DOMAINS.has(domain)) return { on: true }
  if (service === 'turn_off' && !NO_STATE_DOMAINS.has(domain)) return { on: false }

  // 属性直写兜底：参数名 → 属性名 命中即覆盖
  const attrs = {}
  for (const [argKey, attrKey] of Object.entries(ATTR_ARGS)) {
    if (args[argKey] !== undefined) attrs[attrKey] = args[argKey]
  }
  return Object.keys(attrs).length ? { attrs } : null
}

// 服务调用乐观入口：能映射出目标态则写入覆盖并返回 true（供调用方失败回滚判断）；
// 映射不到返回 false，调用方走既有 fired 反馈。
export function setServiceOptimistic(id, domain, service, args = {}) {
  if (!id || !domain || !service) return false
  const patch = servicePatch(domain, service, args || {}, entityStates[id])
  if (!patch) return false
  setOverride(id, patch)
  return true
}

// 属性确认：字符串全等，或数值容差（亮度 pct→255 换算有取整差；音量浮点有精度噪声）
function attrMatch(key, actual, expected) {
  if (actual === undefined || actual === null) return false
  if (String(actual) === String(expected)) return true
  const a = Number(actual)
  const b = Number(expected)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const tol = key === 'brightness' ? 3 : key === 'volume_level' ? 0.01 : 0
  return Math.abs(a - b) <= tol
}

// 状态确认：文本全等，或数值等价（input_number 设定 22 后 HA 可能回推 '22.0'）
function stateMatch(target, cur) {
  if (target === cur) return true
  const a = Number(target)
  const b = Number(cur)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9
}

// 真实状态校正：changed 中实体被删→整条清；各通道逐一比对，命中的通道清除；
// 全部通道确认完毕才删除条目（未确认的通道继续等待，直至超时回退）。
// 只认「当前目标」：连点改主意后中间态推送不会误清（不匹配新目标则保留）。
// 由 ensureSubscribed 惰性挂到 onEntityChange（见上方注释，不可顶层调用）。
function correctFromRealState(changed) {
  for (const id of changed) {
    const o = overrides[id]
    if (!o) continue
    const e = entityStates[id]
    if (!e) { clearOptimistic(id); continue }
    // 设备失联：目标态已不可能被确认，立即回退真实态（避免不可用设备显示虚假目标）
    if (String(e.state) === 'unavailable') { clearOptimistic(id); continue }
    if (o.on != null && isOn(e) === o.on) delete o.on
    if (o.state != null) {
      const targets = Array.isArray(o.state) ? o.state : [o.state]
      const cur = String(e.state)
      if (targets.some((t) => stateMatch(t, cur))) delete o.state
    }
    if (o.attrs) {
      const attrs = e.attributes || {}
      for (const k of Object.keys(o.attrs)) {
        if (attrMatch(k, attrs[k], o.attrs[k])) delete o.attrs[k]
      }
      if (!Object.keys(o.attrs).length) delete o.attrs
    }
    if (o.on == null && o.state == null && o.attrs == null) {
      clearTimeout(timers.get(id))
      timers.delete(id)
      delete overrides[id]
    }
  }
}

// 实体能力 → 控件模型：把 HA 实体的 supported_features / attributes 翻译成一组
// 统一的「控件描述符」，供设备页「更多信息」面板与首页卡片共用（同一套真相源）。
//
// 设计不变量：能力位（supported_features）只用于「在属性缺失时也能显示控件」，
// 绝不用于「隐藏控件」。这样即使某个位常量有偏差，最坏也只是少一个兜底控件，
// 不会出现「HA 能控、但我们没有入口」的倒退。
import { attr, numVal, isOn } from './entities'

// HA 各域 supported_features 位掩码（对齐 HA 官方 EntityFeature 常量）。
// 注：light 的亮度/色温能力由 supported_color_modes 表达，不在此表；
//     vacuum 实测集成上报值与官方常量不符，故不走位判断（见 vacuumControls）。
export const FEAT = {
  light: { EFFECT: 4, FLASH: 8, TRANSITION: 32 },
  fan: { SET_SPEED: 1, OSCILLATE: 2, DIRECTION: 4, PRESET_MODE: 8, TURN_OFF: 16, TURN_ON: 32 },
  cover: {
    OPEN: 1, CLOSE: 2, SET_POSITION: 4, STOP: 8,
    OPEN_TILT: 16, CLOSE_TILT: 32, STOP_TILT: 64, SET_TILT_POSITION: 128,
  },
  climate: {
    TARGET_TEMPERATURE: 1, TARGET_TEMPERATURE_RANGE: 2, TARGET_HUMIDITY: 4, FAN_MODE: 8,
    PRESET_MODE: 16, SWING_MODE: 32, TURN_OFF: 128, TURN_ON: 256, SWING_HORIZONTAL_MODE: 512,
  },
  media_player: {
    PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS_TRACK: 16, NEXT_TRACK: 32,
    TURN_ON: 128, TURN_OFF: 256, PLAY_MEDIA: 512, VOLUME_STEP: 1024, SELECT_SOURCE: 2048,
    STOP: 4096, PLAY: 16384, SELECT_SOUND_MODE: 65536,
  },
  humidifier: { MODES: 1 },
  water_heater: { TARGET_TEMPERATURE: 1, OPERATION_MODE: 2, AWAY: 4 },
  alarm_control_panel: {
    ARM_HOME: 1, ARM_AWAY: 2, ARM_NIGHT: 4, TRIGGER: 8, ARM_CUSTOM_BYPASS: 16, ARM_VACATION: 32,
  },
  lock: { OPEN: 1 },
}

// ---- 基础工具 ----
function arr(v) { return Array.isArray(v) ? v : [] }
function num(v, fb = null) { const n = numVal(v); return n == null ? fb : n }
function svc(domain, service, data) { return data ? { domain, service, data } : { domain, service } }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
// 能力位掩码：缺省/非法返回 null（用于区分「未上报」与「上报为 0」）
function featMask(entity) { return num(attr(entity, 'supported_features', null)) }
function hasFeat(entity, domain, bit) {
  const m = featMask(entity)
  if (m == null) return false
  const f = FEAT[domain]
  return !!f && (m & (f[bit] || 0)) !== 0
}
function optList(list) { return list.map((v) => ({ value: String(v), label: String(v) })) }
function sameVal(a, b) { return String(a) === String(b) }

// 常见枚举值中文名（未收录的原样展示，与 HA 一致）
const enumLabels = {
  off: '关闭', on: '开启', heat: '制热', cool: '制冷', auto: '自动', dry: '除湿',
  fan_only: '送风', heat_cool: '自动', eco: '节能', boost: '强力', sleep: '睡眠',
  idle: '待机', low: '低', medium: '中', high: '高', strong: '强劲', turbo: '极速',
  electric: '电力', gas: '燃气', heat_pump: '热泵', high_demand: '高需求',
  performance: '高性能', away: '离开', none: '无', forward: '正转', reverse: '反转',
}
function enumLabel(v) { return enumLabels[String(v)] || String(v) }

// ---- 控件构造小工具 ----
function powerControl(entity, domain, { on, onData, offService = 'turn_off', label } = {}) {
  const isOnNow = on != null ? on : isOn(entity)
  return {
    id: 'power', kind: 'toggle', icon: 'power_settings_new',
    label: label || (isOnNow ? '已开启' : '已关闭'),
    on: isOnNow,
    svc: svc(domain, 'turn_on', onData),
    off: svc(domain, offService),
  }
}

// 下拉控件：只有拿到可选值才渲染（否则服务参数无从填写）
function pushSelect(out, entity, { id, label, list, value, service, key }) {
  if (!list.length) return
  const dot = service.indexOf('.')
  out.push({
    id, kind: 'select', label, value: String(value == null ? '' : value),
    options: optList(list), svc: svc(service.slice(0, dot), service.slice(dot + 1)), key,
  })
}

// ================= 各域控件 =================
const BRIGHT_MODES = new Set(['brightness', 'color_temp', 'hs', 'xy', 'rgb', 'rgbw', 'rgbww', 'white'])

function lightControls(e) {
  const out = [powerControl(e, 'light')]
  // 亮度能力由 supported_color_modes 决定（HA 本身如此，与 supported_features 无关）
  if (arr(attr(e, 'supported_color_modes', [])).some((m) => BRIGHT_MODES.has(String(m)))) {
    const br = num(attr(e, 'brightness'))
    out.push({
      id: 'brightness', kind: 'range', label: '亮度', icon: 'brightness_6',
      // 关闭状态下 HA 不上报 brightness，兜底 100 保证滑条可用（HA more-info 同样显示滑条）
      value: br != null ? Math.round((br / 255) * 100) : 100,
      min: 1, max: 100, step: 1, unit: '%', immediate: true,
      svc: svc('light', 'turn_on'), key: 'brightness_pct', decimals: 0,
    })
  }
  const minK = num(attr(e, 'min_color_temp_kelvin'))
  const maxK = num(attr(e, 'max_color_temp_kelvin'))
  if (minK != null && maxK != null && maxK > minK) {
    out.push({
      id: 'color_temp', kind: 'range', label: '色温', icon: 'thermostat',
      value: num(attr(e, 'color_temp_kelvin'), minK), min: minK, max: maxK, step: 100, unit: 'K',
      immediate: true, svc: svc('light', 'turn_on'), key: 'color_temp_kelvin', decimals: 0,
    })
  }
  const effects = arr(attr(e, 'effect_list', []))
  if (effects.length) {
    pushSelect(out, e, {
      id: 'effect', label: '效果', list: effects, value: attr(e, 'effect', ''),
      service: 'light.turn_on', key: 'effect',
    })
  }
  return out
}

function fanControls(e) {
  const out = [powerControl(e, 'fan')]
  if (hasFeat(e, 'fan', 'SET_SPEED') || attr(e, 'percentage') !== '' || attr(e, 'percentage_step') !== '') {
    out.push({
      id: 'percentage', kind: 'range', label: '风速', icon: 'speed',
      value: num(attr(e, 'percentage'), 0), min: 0, max: 100,
      step: num(attr(e, 'percentage_step'), 1), unit: '%', immediate: true,
      svc: svc('fan', 'set_percentage'), key: 'percentage', decimals: 0,
    })
  }
  pushSelect(out, e, {
    id: 'preset_mode', label: '预设', list: arr(attr(e, 'preset_modes', [])),
    value: attr(e, 'preset_mode', ''), service: 'fan.set_preset_mode', key: 'preset_mode',
  })
  if (hasFeat(e, 'fan', 'OSCILLATE') || attr(e, 'oscillating') !== '') {
    out.push({
      id: 'oscillating', kind: 'chips', label: '摆头', bool: true,
      value: attr(e, 'oscillating') === true ? 'on' : 'off',
      options: [{ value: 'on', label: '摆动开' }, { value: 'off', label: '摆动关' }],
      svc: svc('fan', 'oscillate'), key: 'oscillating',
    })
  }
  if (hasFeat(e, 'fan', 'DIRECTION') || attr(e, 'direction') !== '') {
    out.push({
      id: 'direction', kind: 'chips', label: '风向',
      value: String(attr(e, 'direction', 'forward')),
      options: [{ value: 'forward', label: '正转' }, { value: 'reverse', label: '反转' }],
      svc: svc('fan', 'set_direction'), key: 'direction',
    })
  }
  return out
}

function humidifierControls(e) {
  const out = [powerControl(e, 'humidifier')]
  if (attr(e, 'min_humidity') !== '' || attr(e, 'max_humidity') !== '' || attr(e, 'humidity') !== '') {
    out.push({
      id: 'humidity', kind: 'range', label: '目标湿度', icon: 'water_drop',
      value: num(attr(e, 'humidity'), 50),
      min: num(attr(e, 'min_humidity'), 30), max: num(attr(e, 'max_humidity'), 70),
      step: 1, unit: '%', immediate: true,
      svc: svc('humidifier', 'set_humidity'), key: 'humidity', decimals: 0,
    })
  }
  pushSelect(out, e, {
    id: 'mode', label: '模式', list: arr(attr(e, 'available_modes', [])),
    value: attr(e, 'mode', ''), service: 'humidifier.set_mode', key: 'mode',
  })
  return out
}

function climateControls(e) {
  const out = []
  const modes = arr(attr(e, 'hvac_modes', []))
  const modeList = modes.length ? modes : ['off', 'heat', 'cool', 'auto']
  const cur = String(attr(e, 'hvac_mode', e.state || 'off'))
  const onMode = modeList.find((m) => String(m) !== 'off') || 'heat'
  out.push(powerControl(e, 'climate', {
    on: cur !== 'off',
    onData: { hvac_mode: onMode },
    offService: 'set_hvac_mode',
    label: cur === 'off' ? '已关闭' : '运行中',
  }))
  // 关闭态也要发 set_hvac_mode off，覆盖默认的 turn_off
  out[0].off = svc('climate', 'set_hvac_mode', { hvac_mode: 'off' })
  out.push({
    id: 'hvac_mode', kind: 'chips', label: '模式', value: cur,
    options: modeList.map((m) => ({ value: String(m), label: enumLabel(m) })),
    svc: svc('climate', 'set_hvac_mode'), key: 'hvac_mode',
  })
  if (hasFeat(e, 'climate', 'TARGET_TEMPERATURE') || attr(e, 'temperature') !== '') {
    const min = num(attr(e, 'min_temp'), 7)
    const max = num(attr(e, 'max_temp'), 35)
    const mid = Math.round(((min + max) / 2) * 10) / 10
    out.push({
      id: 'temperature', kind: 'range', label: '目标温度', icon: 'thermostat',
      value: num(attr(e, 'temperature'), num(attr(e, 'current_temperature'), mid)),
      min, max, step: num(attr(e, 'target_temp_step'), 0.5), unit: '°', immediate: true,
      svc: svc('climate', 'set_temperature'), key: 'temperature', decimals: 1,
    })
  }
  if (hasFeat(e, 'climate', 'TARGET_HUMIDITY') || attr(e, 'humidity') !== '') {
    out.push({
      id: 'humidity', kind: 'range', label: '目标湿度', icon: 'water_drop',
      value: num(attr(e, 'humidity'), 50),
      min: num(attr(e, 'min_humidity'), 30), max: num(attr(e, 'max_humidity'), 70),
      step: 1, unit: '%', immediate: true,
      svc: svc('climate', 'set_humidity'), key: 'humidity', decimals: 0,
    })
  }
  pushSelect(out, e, {
    id: 'fan_mode', label: '风速档', list: arr(attr(e, 'fan_modes', [])),
    value: attr(e, 'fan_mode', ''), service: 'climate.set_fan_mode', key: 'fan_mode',
  })
  pushSelect(out, e, {
    id: 'preset_mode', label: '预设', list: arr(attr(e, 'preset_modes', [])),
    value: attr(e, 'preset_mode', ''), service: 'climate.set_preset_mode', key: 'preset_mode',
  })
  pushSelect(out, e, {
    id: 'swing_mode', label: '摆风', list: arr(attr(e, 'swing_modes', [])),
    value: attr(e, 'swing_mode', ''), service: 'climate.set_swing_mode', key: 'swing_mode',
  })
  pushSelect(out, e, {
    id: 'swing_horizontal_mode', label: '水平摆风', list: arr(attr(e, 'swing_horizontal_modes', [])),
    value: attr(e, 'swing_horizontal_mode', ''),
    service: 'climate.set_swing_horizontal_mode', key: 'swing_horizontal_mode',
  })
  const ct = num(attr(e, 'current_temperature'))
  if (ct != null) out.push({ id: 'current_temperature', kind: 'readonly', label: '当前温度', value: Math.round(ct * 10) / 10, unit: '°' })
  return out
}

const WH_MODES = ['off', 'eco', 'electric', 'gas', 'heat_pump', 'high_demand', 'performance']
function waterHeaterControls(e) {
  const out = []
  const modes = arr(attr(e, 'operation_modes', []))
  const modeList = modes.length ? modes : WH_MODES
  const cur = String(attr(e, 'operation_mode', e.state || 'off'))
  out.push({
    id: 'operation_mode', kind: 'chips', label: '模式', value: cur,
    options: modeList.map((m) => ({ value: String(m), label: enumLabel(m) })),
    svc: svc('water_heater', 'set_operation_mode'), key: 'operation_mode',
  })
  if (hasFeat(e, 'water_heater', 'TARGET_TEMPERATURE') || attr(e, 'temperature') !== '') {
    const min = num(attr(e, 'min_temp'), 30)
    const max = num(attr(e, 'max_temp'), 60)
    out.push({
      id: 'temperature', kind: 'range', label: '目标温度', icon: 'thermostat',
      value: num(attr(e, 'temperature'), min), min, max, step: 1, unit: '°', immediate: true,
      svc: svc('water_heater', 'set_temperature'), key: 'temperature', decimals: 0,
    })
  }
  if (hasFeat(e, 'water_heater', 'AWAY')) {
    const away = attr(e, 'away_mode') === 'on'
    out.push({
      id: 'away_mode', kind: 'chips', label: '离开模式', value: away ? 'on' : 'off',
      options: [{ value: 'on', label: '开启' }, { value: 'off', label: '关闭' }],
      svc: svc('water_heater', 'set_away_mode'), key: 'away_mode',
    })
  }
  return out
}

function coverControls(e) {
  const out = []
  const m = featMask(e)
  const has = (bit) => hasFeat(e, 'cover', bit)
  const move = []
  // 掩码未上报时按「标准窗帘」全列，避免整个设备没有入口
  if (m == null || has('OPEN')) move.push({ label: '打开', icon: 'open_in_full', svc: svc('cover', 'open_cover') })
  if (m == null || has('CLOSE')) move.push({ label: '关闭', icon: 'close_fullscreen', svc: svc('cover', 'close_cover') })
  if (has('STOP')) move.push({ label: '停止', icon: 'stop', svc: svc('cover', 'stop_cover') })
  if (move.length) out.push({ id: 'move', kind: 'buttons', label: '控制', actions: move })
  if (has('SET_POSITION') || attr(e, 'current_position') !== '') {
    out.push({
      id: 'position', kind: 'range', label: '位置', icon: 'vertical_align_center',
      value: num(attr(e, 'current_position'), 0), min: 0, max: 100, step: 1, unit: '%',
      svc: svc('cover', 'set_cover_position'), key: 'position', decimals: 0,
    })
  }
  const tilt = []
  if (has('OPEN_TILT')) tilt.push({ label: '百叶开', svc: svc('cover', 'open_cover_tilt') })
  if (has('STOP_TILT')) tilt.push({ label: '百叶停', svc: svc('cover', 'stop_cover_tilt') })
  if (has('CLOSE_TILT')) tilt.push({ label: '百叶关', svc: svc('cover', 'close_cover_tilt') })
  if (tilt.length) out.push({ id: 'tilt_move', kind: 'buttons', label: '百叶', actions: tilt })
  if (has('SET_TILT_POSITION') || attr(e, 'current_tilt_position') !== '') {
    out.push({
      id: 'tilt_position', kind: 'range', label: '百叶位置',
      value: num(attr(e, 'current_tilt_position'), 0), min: 0, max: 100, step: 1, unit: '%',
      svc: svc('cover', 'set_cover_tilt_position'), key: 'tilt_position', decimals: 0,
    })
  }
  return out
}

function valveControls(e) {
  const out = [{
    id: 'move', kind: 'buttons', label: '控制',
    actions: [
      { label: '打开', icon: 'open_in_full', svc: svc('valve', 'open_valve') },
      { label: '关闭', icon: 'close_fullscreen', svc: svc('valve', 'close_valve') },
      { label: '停止', icon: 'stop', svc: svc('valve', 'stop_valve') },
    ],
  }]
  if (attr(e, 'current_position') !== '') {
    out.push({
      id: 'position', kind: 'range', label: '位置',
      value: num(attr(e, 'current_position'), 0), min: 0, max: 100, step: 1, unit: '%',
      svc: svc('valve', 'set_valve_position'), key: 'position', decimals: 0,
    })
  }
  return out
}

function sirenControls(e) {
  const out = [powerControl(e, 'siren')]
  pushSelect(out, e, {
    id: 'tone', label: '音调', list: arr(attr(e, 'available_tones', [])),
    value: attr(e, 'tone', ''), service: 'siren.turn_on', key: 'tone',
  })
  if (attr(e, 'volume_level') !== '') {
    out.push({
      id: 'volume_level', kind: 'range', label: '音量',
      value: Math.round(num(attr(e, 'volume_level'), 0) * 100), min: 0, max: 100, step: 1,
      unit: '%', div: 100, immediate: true, decimals: 2,
      svc: svc('siren', 'turn_on'), key: 'volume_level',
    })
  }
  if (attr(e, 'duration') !== '') {
    out.push({
      id: 'duration', kind: 'range', label: '时长', value: num(attr(e, 'duration'), 0),
      min: 0, max: 3600, step: 1, unit: '秒', decimals: 0,
      svc: svc('siren', 'turn_on'), key: 'duration',
    })
  }
  return out
}

const MEDIA_OFF_STATES = new Set(['off', 'standby', 'unavailable', 'unknown', ''])
function mediaControls(e) {
  const out = []
  const m = featMask(e)
  const has = (bit) => hasFeat(e, 'media_player', bit)
  const st = String(e.state || '').toLowerCase()
  const on = !MEDIA_OFF_STATES.has(st)
  if (m == null || has('TURN_ON') || has('TURN_OFF')) {
    out.push(powerControl(e, 'media_player', { on, label: on ? '运行中' : '已关闭' }))
  }
  const acts = []
  if (m == null || has('PREVIOUS_TRACK')) acts.push({ label: '上一曲', icon: 'skip_previous', svc: svc('media_player', 'media_previous_track') })
  if (m == null || has('PLAY')) acts.push({ label: '播放', icon: 'play_arrow', svc: svc('media_player', 'media_play') })
  if (m == null || has('PAUSE')) acts.push({ label: '暂停', icon: 'pause', svc: svc('media_player', 'media_pause') })
  if (has('STOP')) acts.push({ label: '停止', icon: 'stop', svc: svc('media_player', 'media_stop') })
  if (m == null || has('NEXT_TRACK')) acts.push({ label: '下一曲', icon: 'skip_next', svc: svc('media_player', 'media_next_track') })
  if (acts.length) out.push({ id: 'transport', kind: 'buttons', label: '播放控制', actions: acts })
  if (has('VOLUME_SET') || attr(e, 'volume_level') !== '') {
    out.push({
      id: 'volume_level', kind: 'range', label: '音量', icon: 'volume_up',
      value: Math.round(num(attr(e, 'volume_level'), 0) * 100), min: 0, max: 100, step: 1,
      unit: '%', div: 100, immediate: true, decimals: 2,
      svc: svc('media_player', 'volume_set'), key: 'volume_level',
    })
  }
  if (has('VOLUME_MUTE') || attr(e, 'is_volume_muted') !== '') {
    const muted = attr(e, 'is_volume_muted') === true
    out.push({
      id: 'mute', kind: 'chips', label: '静音', value: muted ? 'on' : 'off', bool: true,
      options: [{ value: 'on', label: '静音' }, { value: 'off', label: '取消静音' }],
      svc: svc('media_player', 'volume_mute'), key: 'is_volume_muted',
    })
  }
  pushSelect(out, e, {
    id: 'source', label: '音源', list: arr(attr(e, 'source_list', [])),
    value: attr(e, 'source', ''), service: 'media_player.select_source', key: 'source',
  })
  pushSelect(out, e, {
    id: 'sound_mode', label: '声音模式', list: arr(attr(e, 'sound_mode_list', [])),
    value: attr(e, 'sound_mode', ''), service: 'media_player.select_sound_mode', key: 'sound_mode',
  })
  return out
}

// 扫地机：实测集成上报的 supported_features 与 HA 官方常量不符，故改用状态 + 属性驱动
function vacuumControls(e) {
  const out = [{
    id: 'move', kind: 'buttons', label: '控制',
    actions: [
      { label: '开始', icon: 'play_arrow', svc: svc('vacuum', 'start') },
      { label: '暂停', icon: 'pause', svc: svc('vacuum', 'pause') },
      { label: '停止', icon: 'stop', svc: svc('vacuum', 'stop') },
      { label: '回充', icon: 'home', svc: svc('vacuum', 'return_to_base') },
      { label: '定位', icon: 'my_location', svc: svc('vacuum', 'locate') },
    ],
  }]
  pushSelect(out, e, {
    id: 'fan_speed', label: '吸力', list: arr(attr(e, 'fan_speed_list', [])),
    value: attr(e, 'fan_speed', ''), service: 'vacuum.set_fan_speed', key: 'fan_speed',
  })
  return out
}

function lawnMowerControls() {
  return [{
    id: 'move', kind: 'buttons', label: '控制',
    actions: [
      { label: '开始割草', icon: 'play_arrow', svc: svc('lawn_mower', 'start_mowing') },
      { label: '暂停', icon: 'pause', svc: svc('lawn_mower', 'pause') },
      { label: '回坞', icon: 'home', svc: svc('lawn_mower', 'dock') },
    ],
  }]
}

const LOCK_STATES = { locked: '已上锁', locking: '上锁中', unlocking: '解锁中', unlocked: '已解锁', open: '已打开', opening: '打开中', jammed: '卡住' }
function lockControls(e) {
  const out = [{
    id: 'lock', kind: 'buttons', label: '门锁',
    actions: [
      { label: '上锁', icon: 'lock', svc: svc('lock', 'lock'), active: ['locked', 'locking'].includes(String(e.state)) },
      { label: '解锁', icon: 'lock_open', svc: svc('lock', 'unlock'), active: ['unlocked', 'unlocking'].includes(String(e.state)) },
    ],
  }]
  if (hasFeat(e, 'lock', 'OPEN')) {
    out[0].actions.push({ label: '开门', icon: 'door_open', svc: svc('lock', 'open') })
  }
  return out
}

const ALARM_ARMS = [
  { bit: 'ARM_HOME', service: 'alarm_arm_home', label: '在家', state: 'armed_home' },
  { bit: 'ARM_AWAY', service: 'alarm_arm_away', label: '离家', state: 'armed_away' },
  { bit: 'ARM_NIGHT', service: 'alarm_arm_night', label: '夜间', state: 'armed_night' },
  { bit: 'ARM_VACATION', service: 'alarm_arm_vacation', label: '度假', state: 'armed_vacation' },
  { bit: 'ARM_CUSTOM_BYPASS', service: 'alarm_arm_custom_bypass', label: '旁路', state: 'armed_custom_bypass' },
]
function alarmControls(e) {
  const m = featMask(e)
  const st = String(e.state)
  const actions = [{ label: '撤防', icon: 'shield_off', svc: svc('alarm_control_panel', 'alarm_disarm'), active: st === 'disarmed' }]
  for (const a of ALARM_ARMS) {
    if (m != null && !hasFeat(e, 'alarm_control_panel', a.bit)) continue
    actions.push({ label: a.label, icon: 'shield', svc: svc('alarm_control_panel', a.service), active: st === a.state })
  }
  return [{ id: 'arm', kind: 'buttons', label: '布防', actions }]
}

function numberControls(e) {
  const min = num(attr(e, 'min'), 0)
  const max = num(attr(e, 'max'), 100)
  const step = num(attr(e, 'step'), 1)
  const value = num(e.state, min)
  const domain = e.domain === 'input_number' ? 'input_number' : 'number'
  const base = {
    id: 'value', label: '数值', value, min, max, step,
    unit: String(attr(e, 'unit_of_measurement', '') || e.unit || ''),
    svc: svc(domain, 'set_value'), key: 'value',
  }
  if (String(attr(e, 'mode', 'slider')) === 'box') {
    return [{ ...base, kind: 'text', numeric: true, immediate: false }]
  }
  return [{ ...base, kind: 'range', immediate: false }]
}

function selectControls(e) {
  const opts = arr(attr(e, 'options', []))
  if (!opts.length) return []
  const domain = e.domain === 'input_select' ? 'input_select' : 'select'
  return [{ id: 'option', kind: 'select', label: '选项', value: String(e.state || ''), options: optList(opts), svc: svc(domain, 'select_option'), key: 'option' }]
}

function textControls(e) {
  const domain = e.domain === 'input_text' ? 'input_text' : 'text'
  return [{ id: 'value', kind: 'text', label: '内容', value: String(e.state || ''), maxlength: num(attr(e, 'max'), null), svc: svc(domain, 'set_value'), key: 'value' }]
}

function datetimeControls(e) {
  const d = e.domain
  const s = String(e.state || '')
  if (d === 'input_datetime') {
    const hasDate = attr(e, 'has_date', true) !== false
    const hasTime = attr(e, 'has_time', true) === true
    return [{
      id: 'value', kind: 'datetime', label: '日期时间',
      inputType: hasDate && hasTime ? 'datetime-local' : (hasDate ? 'date' : 'time'),
      value: (s.includes(' ') ? s.replace(' ', 'T') : s).slice(0, hasDate && hasTime ? 16 : (hasDate ? 10 : 5)),
      svc: svc('input_datetime', 'set_datetime'), key: hasDate && hasTime ? 'datetime' : (hasDate ? 'date' : 'time'),
      inputDatetime: hasDate && hasTime ? 'both' : (hasDate ? 'date' : 'time'),
    }]
  }
  const inputType = d === 'date' ? 'date' : d === 'time' ? 'time' : 'datetime-local'
  return [{
    id: 'value', kind: 'datetime', label: d === 'date' ? '日期' : d === 'time' ? '时间' : '日期时间',
    inputType, value: s.slice(0, inputType === 'date' ? 10 : inputType === 'time' ? 5 : 16),
    svc: svc(d, 'set_value'), key: 'value',
  }]
}

function counterControls(e) {
  return [
    {
      id: 'step', kind: 'buttons', label: '计数',
      actions: [
        { label: '减', icon: 'remove', svc: svc('counter', 'decrement') },
        { label: '加', icon: 'add', svc: svc('counter', 'increment') },
        { label: '重置', icon: 'restart_alt', svc: svc('counter', 'reset') },
      ],
    },
    {
      id: 'value', kind: 'text', label: '设定值', numeric: true,
      value: num(e.state, 0), min: num(attr(e, 'minimum'), 0), max: num(attr(e, 'maximum'), null),
      svc: svc('counter', 'set_value'), key: 'value',
    },
  ]
}

const TIMER_STARTABLE = ['idle', 'paused', 'finished']
function timerControls(e) {
  const s = String(e.state)
  const actions = []
  if (TIMER_STARTABLE.includes(s)) actions.push({ label: '开始', icon: 'play_arrow', svc: svc('timer', 'start') })
  if (s === 'active') actions.push({ label: '暂停', icon: 'pause', svc: svc('timer', 'pause') })
  if (s === 'active' || s === 'paused') actions.push({ label: '取消', icon: 'cancel', svc: svc('timer', 'cancel') })
  if (s === 'active') actions.push({ label: '结束', icon: 'stop', svc: svc('timer', 'finish') })
  return actions.length ? [{ id: 'timer', kind: 'buttons', label: '计时器', actions }] : []
}

function updateControls(e) {
  if (String(e.state) !== 'on') return []
  return [{
    id: 'update', kind: 'buttons', label: '固件更新',
    actions: [
      { label: '安装', icon: 'download', svc: svc('update', 'install') },
      { label: '跳过', icon: 'skip_next', svc: svc('update', 'skip') },
    ],
  }]
}

function actionControls(e) {
  switch (e.domain) {
    case 'scene': return [{ id: 'run', kind: 'buttons', label: '场景', actions: [{ label: '激活', icon: 'play_arrow', svc: svc('scene', 'turn_on') }] }]
    case 'script': return [{ id: 'run', kind: 'buttons', label: '脚本', actions: [{ label: '运行', icon: 'play_arrow', svc: svc('script', 'turn_on') }] }]
    case 'automation': return [
      powerControl(e, 'automation'),
      { id: 'trigger', kind: 'buttons', label: '自动化', actions: [{ label: '手动触发', icon: 'bolt', svc: svc('automation', 'trigger') }] },
    ]
    case 'button': case 'input_button': {
      const d = e.domain
      return [{ id: 'press', kind: 'buttons', label: '按钮', actions: [{ label: '按下', icon: 'touch_app', svc: svc(d, 'press') }] }]
    }
    default: return []
  }
}

// 只读域：面板只显示状态与属性明细，没有可写控件
const READONLY_DOMAINS = new Set([
  'camera', 'sensor', 'binary_sensor', 'event', 'person', 'device_tracker', 'zone', 'sun',
  'weather', 'calendar', 'image', 'plant', 'geocoded_location', 'time', 'date', 'datetime',
])

// 未知域兜底：覆盖用户尚未安装的集成 —— options → min/max → step 三级推导
function fallbackControls(e) {
  const opts = arr(attr(e, 'options', []))
  if (opts.length) {
    return [{
      id: 'option', kind: 'select', label: '选项', value: String(e.state || ''),
      options: optList(opts), svc: svc(e.domain, 'select_option'), key: 'option',
    }]
  }
  const min = num(attr(e, 'min'))
  const max = num(attr(e, 'max'))
  const step = num(attr(e, 'step'))
  if (min != null && max != null && max > min) {
    return [{
      id: 'value', kind: 'range', label: '数值', value: num(e.state, min), min, max,
      step: step != null ? step : 1, unit: String(attr(e, 'unit_of_measurement', '') || e.unit || ''),
      immediate: false, svc: svc(e.domain, 'set_value'), key: 'value',
    }]
  }
  if (step != null && numVal(e.state) != null) {
    return [{
      id: 'value', kind: 'range', label: '数值', value: numVal(e.state), min: 0, max: 100,
      step, unit: String(attr(e, 'unit_of_measurement', '') || e.unit || ''),
      immediate: false, svc: svc(e.domain, 'set_value'), key: 'value',
    }]
  }
  return []
}

// 只有「开/关」语义的域：默认给一颗开关控件（light/fan/humidifier/siren 有更多能力，单独处理）
const ONOFF_DOMAINS = new Set([
  'switch', 'plug', 'input_boolean', 'group', 'remote', 'fan', 'humidifier', 'siren',
])

/**
 * 推导实体的全部可操作控件。
 * @param {Object} entity 含 domain / state / attributes 的实体
 * @returns {Array<Object>} 控件描述符数组（kind: toggle|range|select|chips|buttons|text|datetime|readonly）
 */
export function buildControls(entity) {
  if (!entity || !entity.domain) return []
  const d = entity.domain
  if (ONOFF_DOMAINS.has(d)) {
    if (d === 'fan') return fanControls(entity)
    if (d === 'humidifier') return humidifierControls(entity)
    if (d === 'siren') return sirenControls(entity)
    return [powerControl(entity, d)]
  }
  switch (d) {
    case 'light': return lightControls(entity)
    case 'climate': return climateControls(entity)
    case 'water_heater': return waterHeaterControls(entity)
    case 'cover': return coverControls(entity)
    case 'valve': return valveControls(entity)
    case 'media_player': return mediaControls(entity)
    case 'vacuum': return vacuumControls(entity)
    case 'lawn_mower': return lawnMowerControls()
    case 'lock': return lockControls(entity)
    case 'alarm_control_panel': return alarmControls(entity)
    case 'number': case 'input_number': return numberControls(entity)
    case 'select': case 'input_select': return selectControls(entity)
    case 'text': case 'input_text': return textControls(entity)
    case 'date': case 'time': case 'datetime': case 'input_datetime': return datetimeControls(entity)
    case 'counter': return counterControls(entity)
    case 'timer': return timerControls(entity)
    case 'update': return updateControls(entity)
    case 'scene': case 'script': case 'automation': case 'button': case 'input_button': return actionControls(entity)
    default:
      if (READONLY_DOMAINS.has(d)) return []
      return fallbackControls(entity)
  }
}

// 状态文案（面板与卡片共用）
export function stateLabelOf(entity) {
  if (!entity) return ''
  const s = String(entity.state || '')
  const map = {
    on: '开启', off: '关闭', open: '已打开', closed: '已关闭', opening: '打开中',
    closing: '关闭中', stopped: '已停止', unavailable: '不可用', unknown: '未知',
    idle: '待机', playing: '播放中', paused: '已暂停', cleaning: '清扫中', docked: '回充中',
    locked: '已上锁', unlocked: '已解锁', disarmed: '已撤防', home: '在家', not_home: '离家',
  }
  if (entity.domain === 'lock') return LOCK_STATES[s] || map[s] || s
  return map[s] || s
}

// 把控件值换算成服务参数值（div 缩放 + 小数位 + 布尔转换）
function normValue(control, value) {
  if (control.bool) return value === 'on' || value === true
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  const v = n / (control.div || 1)
  const p = Math.pow(10, control.decimals == null ? 2 : control.decimals)
  return Math.round(v * p) / p
}

/**
 * 生成服务调用载荷。
 * @param {Object} control buildControls 返回的控件
 * @param {*} value toggle：忽略；buttons：传入 action 对象；其余：控件的新值
 * @returns {{domain:string, service:string, data?:Object}|null}
 */
export function buildServiceCall(control, value) {
  if (!control) return null
  if (control.kind === 'toggle') return control.on ? control.off : control.svc
  if (control.kind === 'buttons') {
    if (!value || !value.svc) return null
    return value.svc
  }
  if (!control.svc) return null
  // input_datetime 双字段：datetime-local 的 "YYYY-MM-DDTHH:MM" 需拆成 date + time
  if (control.inputDatetime === 'both') {
    const [date, time] = String(value || '').split('T')
    return { ...control.svc, data: { date, time: time || '00:00' } }
  }
  const key = control.key || 'value'
  return { ...control.svc, data: { ...(control.svc.data || {}), [key]: normValue(control, value) } }
}

// ---- 卡片用 HTML 片段（复用 CodeCard 的 data-hc 协议） ----
function fmtValue(c) {
  const n = Number(c.value)
  if (!Number.isFinite(n)) return String(c.value == null ? '' : c.value)
  const p = Math.pow(10, c.decimals == null ? 0 : c.decimals)
  return String(Math.round(n * p) / p) + (c.unit || '')
}

function actionBtnHtml(action, entityId) {
  const eid = entityId ? ` data-entity="${esc(entityId)}"` : ''
  const args = action.svc.data ? ` data-args='${esc(JSON.stringify(action.svc.data))}'` : ''
  const icon = action.icon ? `<span class="material-symbols-outlined" style="font-size:10px">${esc(action.icon)}</span>` : ''
  return `<button class="h-chip${action.active ? ' on' : ''}" data-hc="svc" data-svc="${esc(action.svc.domain + '.' + action.svc.service)}"${args}${eid}>${icon}${esc(action.label)}</button>`
}

function controlHtml(c, entityId, idx) {
  const eid = entityId ? ` data-entity="${esc(entityId)}"` : ''
  const d = c.svc ? esc(c.svc.domain + '.' + c.svc.service) : ''
  const base = c.svc && c.svc.data ? ` data-args='${esc(JSON.stringify(c.svc.data))}'` : ''
  if (c.kind === 'range') {
    return `<div class="h-ctl"><span class="h-lb">${esc(c.label)}</span>` +
      `<input class="h-bar" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"` +
      ` data-hc="range" data-svc="${d}" data-key="${esc(c.key)}" data-div="${c.div || 1}"${eid}>` +
      `<span class="h-vv">${esc(fmtValue(c))}</span></div>`
  }
  if (c.kind === 'select') {
    const opts = (c.options || []).map((o) =>
      `<option value="${esc(o.value)}"${sameVal(o.value, c.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
    const known = (c.options || []).some((o) => sameVal(o.value, c.value))
    const lead = c.value === '' || !known ? '<option value="">—</option>' : ''
    return `<div class="h-ctl"><span class="h-lb">${esc(c.label)}</span>` +
      `<select class="h-sel" data-hc="select" data-svc="${d}" data-key="${esc(c.key)}"${eid}>${lead}${opts}</select></div>`
  }
  if (c.kind === 'chips') {
    const btns = (c.options || []).map((o) =>
      `<button class="h-chip${sameVal(o.value, c.value) ? ' on' : ''}" data-hc="svc" data-svc="${d}"` +
      ` data-args='${esc(JSON.stringify({ ...(c.svc.data || {}), [c.key]: normValue(c, o.value) }))}'${eid}>${esc(o.label)}</button>`).join('')
    return `<div class="h-ctl" style="flex-wrap:wrap"><span class="h-lb">${esc(c.label)}</span>${btns}</div>`
  }
  if (c.kind === 'buttons') {
    return `<div class="h-ctl" style="flex-wrap:wrap">${(c.actions || []).map((a) => actionBtnHtml(a, entityId)).join('')}</div>`
  }
  if (c.kind === 'text') {
    const uid = 'hc-in-' + idx
    const attrs = ` type="${c.numeric ? 'number' : 'text'}"` +
      (c.min != null ? ` min="${c.min}"` : '') + (c.max != null ? ` max="${c.max}"` : '') +
      (c.maxlength != null ? ` maxlength="${c.maxlength}"` : '')
    return `<div class="h-ctl"><span class="h-lb">${esc(c.label)}</span>` +
      `<input class="h-tin"${attrs} data-in="${esc(uid)}" value="${esc(c.value)}">` +
      `<button class="h-chip" data-hc="svc" data-svc="${d}"${base} data-from='[data-in="${esc(uid)}"]'${eid}>确定</button></div>`
  }
  if (c.kind === 'datetime') {
    const uid = 'hc-in-' + idx
    return `<div class="h-ctl"><span class="h-lb">${esc(c.label)}</span>` +
      `<input class="h-tin" type="${c.inputType}" data-in="${esc(uid)}" value="${esc(c.value)}">` +
      `<button class="h-chip" data-hc="svc" data-svc="${d}"${base} data-from='[data-in="${esc(uid)}"]'${eid}>确定</button></div>`
  }
  return ''
}

/**
 * 把控件描述符渲染成卡片用的 HTML 片段（toggle / readonly 不在此输出，
 * 卡片模板已有自己的开关与状态展示）。
 */
export function renderControlsHtml(controls, entityId) {
  return (controls || [])
    .filter((c) => c.kind !== 'toggle' && c.kind !== 'readonly')
    .map((c, i) => controlHtml(c, entityId, i))
    .join('')
}
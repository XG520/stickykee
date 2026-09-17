// 动态数据计算 —— 为模板中的所有 {{占位符}} 提供值。
// computeData(type, ctx)：ctx = { all, hasData, entity, now }
//  - entity 由 CodeCard 按 card.entity_id 从实时实体流中查找
//  - 与 templates.js 的占位符清单一一对应；缺失的占位符会原样保留
import { attr, numVal, isOn, iconFor, domainGlyph, domainColorCls } from '@/utils/entities'
import api from '@/api'
import { store } from '@/store'

// Tailwind 类 → 十六进制色值（模板内联样式与 --hc-color 使用）
const hex = {
  'text-warning': '#E8A84C', 'text-primary': '#F5A623', 'text-info': '#6BA3D9',
  'text-success': '#5EC4B0', 'text-accent': '#5EC4B0', 'text-muted': '#8A8986',
}
function colorOf(entity, fb = 'text-primary') {
  return hex[domainColorCls[entity?.domain] || fb] || '#F5A623'
}

// 每张实体卡都需要的公共字段
function base(entity, hasData, fallbackGlyph = 'widgets') {
  return {
    glyph: entity ? iconFor(entity, domainGlyph[entity.domain] || fallbackGlyph) : fallbackGlyph,
    name: entity ? entity.friendly_name || entity.entity_id : '未绑定实体',
    badge: '',
    onColor: colorOf(entity),
  }
}

function fmtNum(v) {
  const n = numVal(v)
  return n != null ? String(Math.round(n)) : '—'
}

// 动态拼接 HTML 片段时转义实体名等不可信文本
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ================= 公共片段构建 =================
const attrLabels = {
  temperature: '温度', humidity: '湿度', current_power_w: '功率', power: '功率',
  battery_level: '电量', battery: '电量', voltage: '电压', current: '电流',
  pressure: '气压', wind_speed: '风速', illuminance: '光照', pm2_5: 'PM2.5',
  pm10: 'PM10', co2: 'CO₂', energy: '能耗',
}
function attrsBlock(entity, max = 2) {
  const a = entity.attributes || {}
  const want = ['current_power_w', 'power', 'voltage', 'current', 'battery_level', 'battery', 'pressure', 'wind_speed', 'illuminance', 'pm2_5', 'pm10', 'co2', 'energy', 'temperature', 'humidity']
  const rows = []
  for (const k of want) {
    if (a[k] === undefined || a[k] === null) continue
    const n = numVal(a[k])
    const v = n != null ? String(Math.round(n * 10) / 10) : String(a[k])
    const u = a.unit_of_measurement || ''
    rows.push(`<div class="attr"><span>${attrLabels[k] || k}</span><b>${v}${u}</b></div>`)
    if (rows.length >= max) break
  }
  if (!rows.length) return `<div class="h-mid"><span class="h-mut">${String(entity.state)}</span></div>`
  return `<div class="attrs">${rows.join('')}</div>`
}

// 天气条件 → 展示字符
const condIcon = {
  clear_night: '🌙', sunny: '☀️', clear: '☀️', partlycloudy: '⛅', partly_cloudy: '⛅',
  cloudy: '☁️', mostlycloudy: '☁️', fog: '🌫️', haze: '🌫️', snowy: '❄️', snow: '❄️',
  rainy: '🌧️', rain: '🌧️', pouring: '🌧️', drizzly: '🌦️', windy: '🌬️',
  thunderstorm: '⛈️', hail: '🌨️', exceptional: '🌈',
}
function emojiFor(cond, mdi) {
  if (mdi && condIcon[mdi]) return condIcon[mdi]
  const c = String(cond || '').toLowerCase().replace(/\s+/g, '')
  if (condIcon[c]) return condIcon[c]
  if (c.includes('rain')) return '🌧️'
  if (c.includes('snow')) return '❄️'
  if (c.includes('cloud')) return '☁️'
  if (c.includes('sun') || c.includes('clear')) return '☀️'
  return '🌤️'
}
const condMap = {
  clear_night: ['clear_night', '晴夜'], sunny: ['sunny', '晴'], clear: ['sunny', '晴'],
  partlycloudy: ['partly_cloudy_day', '多云'], partly_cloudy: ['partly_cloudy_day', '多云'],
  cloudy: ['cloud', '阴'], mostlycloudy: ['cloud', '阴'], fog: ['foggy', '雾'], haze: ['foggy', '霾'],
  snowy: ['weather_snowy', '雪'], snow: ['weather_snowy', '雪'], rainy: ['weather_rainy', '雨'],
  rain: ['weather_rainy', '雨'], pouring: ['rainy_heavy', '大雨'], drizzly: ['grain', '毛毛雨'],
  windy: ['air', '大风'], windy_variant: ['air', '大风'], thunderstorm: ['thunderstorm', '雷雨'],
  hail: ['weather_hail', '冰雹'], lightning: ['thunderstorm', '雷电'], exceptional: ['warning', '异常'],
}
function weatherIcon(state) { return (condMap[String(state)] || ['partly_cloudy_day', String(state)])[0] }
function weatherCond(state) { return (condMap[String(state)] || [null, String(state)])[1] }
function forecastHtml(entity) {
  const arr = attr(entity, 'forecast', [])
  if (!Array.isArray(arr)) return ''
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return arr.slice(0, 3).map((f) => {
    const d = new Date(f.datetime)
    const day = Number.isNaN(d.getTime()) ? (f.datetime || '').slice(5, 10) : week[d.getDay()]
    const c = String(f.condition || '').toLowerCase()
    const ic = emojiFor(c, (f.icon || '').split(':').pop())
    const low = fmtNum(f.templow)
    const high = fmtNum(f.temperature ?? f.temphigh)
    return `<div class="fc"><span class="d">${day}</span><span>${ic}</span><b>${low}°/${high}°</b></div>`
  }).join('')
}

// ================= 各卡组数据 =================
function toggleData(entity, hasData) {
  const b = base(entity, hasData, 'toggle_on')
  if (!entity) return { ...b, onCls: 'b-off', stateLabel: '', state: '', rangeHtml: '' }
  const on = isOn(entity)
  const d = entity.domain
  let rangeHtml = ''
  if (d === 'light') {
    const br = numVal(attr(entity, 'brightness'))
    if (br != null) {
      const pct = Math.round((br / 255) * 100)
      rangeHtml = `<input class="h-bar" type="range" min="1" max="100" value="${pct}" data-hc="range" data-svc="light.turn_on" data-key="brightness_pct" data-div="1">`
    }
  } else if (d === 'fan') {
    const pct = numVal(attr(entity, 'percentage'))
    if (pct != null) rangeHtml = `<input class="h-bar" type="range" min="1" max="100" value="${Math.round(pct)}" data-hc="range" data-svc="fan.set_percentage" data-key="percentage" data-div="1">`
  }
  return { ...b, onCls: on ? 'b-on' : 'b-off', stateLabel: on ? '已开启' : '已关闭', state: String(entity.state), rangeHtml }
}

function sensorData(entity, hasData) {
  const b = base(entity, hasData, 'sensors')
  if (!entity) return { ...b, mainValue: '—', mainUnit: '', attrsHtml: '', stepHtml: '' }
  const unit = entity.unit || attr(entity, 'unit_of_measurement', '')
  const n = numVal(entity.state)
  const mainValue = n != null ? String(Math.round(n * 10) / 10) : String(entity.state)
  const mainUnit = n != null ? unit : ''
  const d = entity.domain
  let stepHtml = ''
  let attrsHtml = ''
  if (d === 'number' || d === 'input_number') {
    const cur = numVal(entity.state)
    const step = numVal(attr(entity, 'step')) || 1
    if (cur != null) {
      const svc = d === 'input_number' ? 'input_number.set_value' : 'number.set_value'
      const dec = Math.round((cur - step) * 100) / 100
      const inc = Math.round((cur + step) * 100) / 100
      stepHtml = `<div class="step">
        <button class="h-btn h-btn-ghost" data-hc="svc" data-svc="${svc}" data-args='{"value":${dec}}'><span class="material-symbols-outlined" style="font-size:12px">remove</span></button>
        <span class="h-mut">${mainValue}${mainUnit}</span>
        <button class="h-btn h-btn-ghost" data-hc="svc" data-svc="${svc}" data-args='{"value":${inc}}'><span class="material-symbols-outlined" style="font-size:12px">add</span></button>
      </div>`
    }
  } else if (d === 'counter') {
    stepHtml = `<div class="step">
      <button class="h-btn h-btn-ghost" data-hc="svc" data-svc="counter.decrement"><span class="material-symbols-outlined" style="font-size:12px">remove</span></button>
      <span class="h-mut">${mainValue}</span>
      <button class="h-btn h-btn-ghost" data-hc="svc" data-svc="counter.increment"><span class="material-symbols-outlined" style="font-size:12px">add</span></button>
    </div>`
  } else {
    attrsHtml = attrsBlock(entity, 2)
  }
  return { ...b, mainValue, mainUnit, attrsHtml, stepHtml }
}

function binaryData(entity, hasData) {
  const b = base(entity, hasData, 'sensors')
  if (!entity) return { ...b, onCls: 'b-off', stateLabel: '—' }
  const on = isOn(entity)
  return { ...b, onCls: on ? 'b-on' : 'b-off', stateLabel: on ? '正常 / 开启' : '异常 / 关闭' }
}

const hvacMap = { heat: '制热', cool: '制冷', auto: '自动', dry: '除湿', fan_only: '送风', off: '关闭', idle: '待机', heat_cool: '自动', eco: '节能', boost: '强力', sleep: '睡眠' }
function climateData(entity, hasData) {
  const b = base(entity, hasData, 'thermostat')
  if (!entity) {
    return { ...b, temp: '—', tempUnit: '', target: '', hvacHtml: '', setSvc: '', decArgs: '{}', incArgs: '{}', modeLabel: '—' }
  }
  const d = entity.domain
  const unit = d === 'water_heater' ? '°' : (entity.unit || '°C').replace('°C', '°')
  let temp = '—'
  let target = '—'
  let setSvc = 'climate.set_temperature'
  if (d === 'humidifier') {
    const h = numVal(attr(entity, 'humidity'))
    temp = h != null ? String(Math.round(h)) : '—'
    target = temp
    setSvc = 'humidifier.set_humidity'
  } else {
    const t = numVal(attr(entity, 'current_temperature')) ?? numVal(entity.state)
    temp = t != null ? String(Math.round(t * 10) / 10) : '—'
    const tg = numVal(attr(entity, 'temperature')) ?? numVal(attr(entity, 'target_temperature'))
    target = tg != null ? String(Math.round(tg * 10) / 10) : '—'
    if (d === 'water_heater') setSvc = 'water_heater.set_temperature'
  }
  const cur = d === 'humidifier' ? numVal(attr(entity, 'humidity')) : (numVal(attr(entity, 'temperature')) ?? numVal(attr(entity, 'target_temperature')))
  let decArgs = '{}'
  let incArgs = '{}'
  if (cur != null) {
    const key = d === 'humidifier' ? 'humidity' : 'temperature'
    decArgs = JSON.stringify({ [key]: Math.round((cur - 1) * 10) / 10 })
    incArgs = JSON.stringify({ [key]: Math.round((cur + 1) * 10) / 10 })
  }
  const modeKey = d === 'humidifier' ? 'mode' : d === 'water_heater' ? 'operation_mode' : 'hvac_mode'
  const modeSvc = d === 'humidifier' ? 'set_mode' : d === 'water_heater' ? 'set_operation_mode' : 'set_hvac_mode'
  const curMode = attr(entity, 'hvac_mode') || attr(entity, 'operation_mode') || attr(entity, 'mode') || entity.state
  const modes = attr(entity, 'hvac_modes') || attr(entity, 'operation_modes') || attr(entity, 'modes') || []
  const chips = (Array.isArray(modes) ? modes : []).slice(0, 6)
    .map((m) => `<span class="${m === curMode ? 'on' : ''}" data-hc="svc" data-svc="${d}.${modeSvc}" data-args='${JSON.stringify({ [modeKey]: m })}'>${hvacMap[m] || m}</span>`)
    .join('')
  const modeLabel = hvacMap[curMode] || String(curMode || '')
  return { ...b, temp, tempUnit: unit, target, hvacHtml: chips, setSvc, decArgs, incArgs, modeLabel }
}

function coverData(entity, hasData) {
  const b = base(entity, hasData, 'curtains')
  if (!entity) return { ...b, onCls: 'b-off', stateLabel: '—', posText: '—' }
  const s = String(entity.state)
  const map = { open: '已打开', opening: '打开中…', closed: '已关闭', closing: '关闭中…', stopped: '已停止' }
  const on = ['open', 'opening'].includes(s)
  const pos = numVal(attr(entity, 'current_position'))
  return { ...b, onCls: on ? 'b-on' : 'b-off', stateLabel: map[s] || s, posText: pos != null ? pos + '%' : '—' }
}

function mediaData(entity, hasData) {
  const b = base(entity, hasData, 'tv')
  if (!entity) return { ...b, mediaGlyph: 'music_note', mediaTitle: '—', playSvc: 'media_player.media_play', playIcon: 'play_arrow', volumePct: '0' }
  const playing = String(entity.state) === 'playing'
  const title = attr(entity, 'media_title') || attr(entity, 'media_artist') || attr(entity, 'media_album_name') || '暂无播放内容'
  const vol = numVal(attr(entity, 'volume_level'))
  return {
    ...b, mediaGlyph: 'music_note', mediaTitle: title,
    playSvc: playing ? 'media_player.media_pause' : 'media_player.media_play',
    playIcon: playing ? 'pause' : 'play_arrow',
    volumePct: vol != null ? String(Math.round(vol * 100)) : '0',
  }
}

function securityData(entity, hasData) {
  const b = base(entity, hasData, 'lock')
  if (!entity) return { ...b, onCls: 'b-off', stateLabel: '—', secBtns: '' }
  const isLock = entity.domain === 'lock'
  const s = String(entity.state)
  const secure = isLock ? ['locked', 'locking'].includes(s) : ['armed_away', 'armed_home', 'armed_night', 'armed'].includes(s)
  const map = {
    locked: '已上锁', unlocking: '解锁中', locking: '上锁中', unlocked: '已解锁',
    armed_away: '离家布防', armed_home: '在家布防', armed_night: '夜间布防', disarmed: '已撤防', pending: '布防中', triggered: '已触发',
  }
  let btns = ''
  if (isLock) {
    btns = `<button class="secb${secure ? ' on' : ''}" data-hc="svc" data-svc="lock.lock">上锁</button>` +
      `<button class="secb${!secure ? ' on' : ''}" data-hc="svc" data-svc="lock.unlock">解锁</button>`
  } else {
    btns = `<button class="secb${s === 'disarmed' ? ' on' : ''}" data-hc="svc" data-svc="alarm_control_panel.alarm_disarm">撤防</button>` +
      `<button class="secb${s === 'armed_home' ? ' on' : ''}" data-hc="svc" data-svc="alarm_control_panel.alarm_arm_home">在家</button>` +
      `<button class="secb${s === 'armed_away' ? ' on' : ''}" data-hc="svc" data-svc="alarm_control_panel.alarm_arm_away">离家</button>`
  }
  return { ...b, onCls: secure ? 'b-on' : 'b-off', stateLabel: map[s] || s, secBtns: btns }
}

function cameraData(entity, hasData) {
  const b = base(entity, hasData, 'videocam')
  if (!entity) return { ...b, cameraUrl: '', stateLabel: '' }
  return { ...b, cameraUrl: api.pictureUrl(store.activeID, entity.entity_id), stateLabel: String(entity.state) }
}

function vacuumData(entity, hasData) {
  const b = base(entity, hasData, 'robot')
  if (!entity) return { ...b, runCls: 'b-off', stateLabel: '—', detail: '', pauseSvc: 'vacuum.pause', pauseIcon: 'pause' }
  const s = String(entity.state)
  const running = ['cleaning', 'returning', 'spot'].includes(s)
  const map = { cleaning: '清扫中', docked: '回充中', idle: '待机', paused: '已暂停', returning: '回充中', error: '故障', spot: '定点清扫' }
  const bat = numVal(attr(entity, 'battery_level'))
  return {
    ...b, runCls: running ? 'b-on' : 'b-off', stateLabel: map[s] || s,
    detail: bat != null ? `电量 ${bat}%` : (attr(entity, 'fan_speed') || ''),
    pauseSvc: running ? 'vacuum.pause' : 'vacuum.stop',
    pauseIcon: running ? 'pause' : 'stop',
  }
}

const runSvcMap = { scene: 'scene.turn_on', script: 'script.turn_on', automation: 'automation.trigger', button: 'button.press', input_button: 'input_button.press' }
function actionData(entity, hasData) {
  const b = base(entity, hasData, 'play_circle')
  if (!entity) return { ...b, runSvc: '', stateText: '' }
  return { ...b, runSvc: runSvcMap[entity.domain] || entity.domain + '.turn_on', stateText: String(entity.state) }
}

function personData(entities, hasData, ctx) {
  const list = Array.isArray(entities) ? entities.filter(Boolean) : []
  // 主实体：人员/设备跟踪/区域/sensor；可选第二实体：地理编码位置（geocoded_location，提供 address）
  const main = list.find((e) => e.domain !== 'geocoded_location') || list[0] || null
  const geo = list.find((e) => e.domain === 'geocoded_location') || (ctx?.all || []).find((e) => e.domain === 'geocoded_location') || null
  // 第二实体（子属性元素：图标+值，可拖动定位）：优先非地理编码实体（sensor 等），否则用地理编码实体
  const sub = list.find((e) => e !== main && e.domain !== 'geocoded_location') || geo || null
  const b = base(main, hasData, 'person')
  if (!main) return { ...b, avatarHtml: '', onCls: 'b-off', stateLabel: '—', detail: '—', subCls: ' is-hide', subGlyph: '', subValue: '' }
  const home = !['away', 'not_home', 'none'].includes(String(main.state).toLowerCase())
  const s = String(main.state).toLowerCase()
  const label = s === 'home' ? '在家' : (s === 'away' || s === 'not_home') ? '离家' : String(main.state)
  const pic = attr(main, 'entity_picture')
  const custom = ctx?.card?.avatar
  let avatarHtml
  if (custom) {
    avatarHtml = `<img class="avatar" src="${escHtml(custom)}" referrerpolicy="no-referrer" alt="">`
  } else if (pic && String(pic).startsWith('/api/')) {
    avatarHtml = `<img class="avatar" src="${api.pictureUrl(store.activeID, main.entity_id)}" referrerpolicy="no-referrer" alt="">`
  } else {
    avatarHtml = `<div class="avatar-f"><span class="material-symbols-outlined" style="font-size:18px">person</span></div>`
  }
  let detail = '—'
  if (main.domain === 'zone') {
    const r = numVal(attr(main, 'radius'))
    detail = r != null ? `半径 ${r} 米` : (attr(main, 'latitude') != null ? `${attr(main, 'latitude')}, ${attr(main, 'longitude')}` : '')
  } else if (main.domain === 'sensor') {
    // sensor 实体：优先地址/位置属性，其次经纬度，最后回退到状态文本
    const lat = numVal(attr(main, 'latitude'))
    const lng = numVal(attr(main, 'longitude'))
    detail = attr(main, 'address') || attr(main, 'location_name') || attr(main, 'source')
      || (lat != null && lng != null ? `${lat}, ${lng}` : '')
      || (s && s !== 'unknown' && s !== 'unavailable' ? String(main.state) : '—')
  } else if (geo && sub !== geo) {
    // 地理编码位置实体：address 属性为文字地址（由 detail 展示；若已作为子元素展示则不重复）
    detail = attr(geo, 'address') || attr(geo, 'location_name') || attr(geo, 'source') || String(geo.state)
  } else {
    detail = attr(main, 'location_name') || attr(main, 'source') || '—'
  }
  // 子属性：第二实体的图标 + 值（数据值字段，仅用于显示）
  let subCls = ' is-hide'
  let subGlyph = ''
  let subValue = ''
  if (sub) {
    subCls = ''
    if (sub.domain === 'geocoded_location') {
      subGlyph = 'location_on'
      subValue = attr(sub, 'address') || attr(sub, 'location_name') || attr(sub, 'source') || String(sub.state)
    } else if (sub.domain === 'sensor') {
      subGlyph = iconFor(sub, 'sensors')
      const unit = sub.unit || attr(sub, 'unit_of_measurement')
      subValue = String(sub.state) + (unit ? ' ' + unit : '')
    } else {
      subGlyph = iconFor(sub, domainGlyph[sub.domain] || 'widgets')
      subValue = String(sub.state)
    }
  }
  return { ...b, avatarHtml, onCls: home ? 'b-on' : 'b-warn', stateLabel: label, detail, subCls, subGlyph, subValue }
}

function weatherEntityData(entity, hasData) {
  const b = base(entity, hasData, 'partly_cloudy_day')
  if (!entity) return { ...b, icon: '🌤️', temp: '—', unit: '°', condition: '—', feels: '—', humidity: '—', wind: '—', forecastHtml: '' }
  const unit = (entity.unit || '°C').replace('°C', '°')
  const hum = numVal(attr(entity, 'humidity'))
  const wind = fmtNum(attr(entity, 'wind_speed'))
  return {
    ...b,
    icon: emojiFor(String(entity.state), (entity.icon || '').split(':').pop()),
    temp: fmtNum(attr(entity, 'temperature')),
    unit,
    condition: weatherCond(entity.state),
    feels: fmtNum(numVal(attr(entity, 'apparent_temperature')) ?? numVal(attr(entity, 'temperature'))),
    humidity: hum != null ? `${Math.round(hum)}%` : '—',
    wind,
    forecastHtml: forecastHtml(entity),
  }
}

function sunData(entity, hasData) {
  const b = base(entity, hasData, 'wb_sunny')
  if (!entity) return { ...b, stateLabel: '—', elevText: '', rising: '—', setting: '—', elevation: '—' }
  const above = String(entity.state) === 'above_horizon'
  return {
    ...b,
    stateLabel: above ? '已升起' : '已落下',
    elevText: above ? '太阳在地平线上方' : '太阳在地平线下方',
    rising: hm(attr(entity, 'next_rising')),
    setting: hm(attr(entity, 'next_setting')),
    elevation: fmtNum(attr(entity, 'elevation')),
  }
}

function selectData(entity, hasData) {
  const b = base(entity, hasData, 'arrow_drop_down_circle')
  if (!entity) return { ...b, stateText: '', selSvc: '', optionsHtml: '' }
  const opts = attr(entity, 'options', [])
  const optionsHtml = (Array.isArray(opts) ? opts : []).map((o) => {
    const v = typeof o === 'string' ? o : (o?.label ?? o?.value ?? String(o))
    const sel = v === String(entity.state) ? ' selected' : ''
    return `<option value="${v}"${sel}>${v}</option>`
  }).join('')
  return { ...b, stateText: String(entity.state), selSvc: entity.domain + '.select_option', optionsHtml }
}

function textData(entity, hasData) {
  const b = base(entity, hasData, 'text_fields')
  if (!entity) return { ...b, stateText: '', setSvc: '' }
  return { ...b, stateText: String(entity.state), setSvc: entity.domain + '.set_value' }
}

const weekCn = ['日', '一', '二', '三', '四', '五', '六']
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '')
  if (!m) return s || ''
  const dt = new Date(+m[1], +m[2] - 1, +m[3])
  return `${+m[2]}月${+m[3]}日 周${weekCn[dt.getDay()]}`
}
function datetimeData(entity, hasData) {
  const b = base(entity, hasData, 'calendar_today')
  if (!entity) return { ...b, mainText: '—', subText: '', inputType: 'datetime-local', draftVal: '', setSvc: '' }
  const d = entity.domain
  const s = String(entity.state)
  const hasDate = d !== 'time' && (d !== 'input_datetime' || attr(entity, 'has_date', true))
  const hasTime = d !== 'date' && (d !== 'input_datetime' || attr(entity, 'has_time', false))
  let mainText = '—'
  let subText = ''
  if (d === 'time') {
    mainText = s.slice(0, 5)
    subText = '时间'
  } else if (d === 'date') {
    mainText = fmtDate(s)
    subText = '日期'
  } else {
    const [dt, tm] = s.split(' ')
    mainText = (hasTime ? fmtDate(dt) + (tm ? ' ' + tm.slice(0, 5) : '') : fmtDate(dt))
    subText = hasDate && hasTime ? '日期时间' : (hasDate ? '日期' : '时间')
  }
  const inputType = d === 'time' ? 'time' : d === 'date' ? 'date' : 'datetime-local'
  let draftVal = ''
  if (d === 'time') draftVal = s.slice(0, 5)
  else if (d === 'date') draftVal = s.slice(0, 10)
  else {
    const [dt, tm] = s.split(' ')
    draftVal = (dt ? dt.slice(0, 10) : '') + 'T' + (tm ? tm.slice(0, 5) : '00:00')
  }
  const setSvc = d === 'input_datetime' ? 'input_datetime.set_datetime' : d === 'datetime' ? 'datetime.set_value' : d === 'time' ? 'time.set_value' : ''
  return { ...b, mainText, subText, inputType, draftVal, setSvc }
}

function timerData(entity, hasData) {
  const b = base(entity, hasData, 'timer')
  if (!entity) return { ...b, remainText: '—', stateLabel: '—', onCls: 'b-off', timerBtns: '' }
  const s = String(entity.state)
  let remainSec = numVal(attr(entity, 'remaining'))
  if (remainSec == null) {
    const f = attr(entity, 'finish_at') || attr(entity, 'finish_time')
    if (f && s === 'active') {
      const ms = new Date(f).getTime() - Date.now()
      if (Number.isFinite(ms)) remainSec = Math.max(0, Math.round(ms / 1000))
    } else {
      remainSec = numVal(attr(entity, 'duration')) || 0
    }
  }
  const remainText = ['idle', 'finished'].includes(s)
    ? (s === 'finished' ? '完成' : '—')
    : `${Math.floor(remainSec / 60)}:${String(Math.floor(remainSec % 60)).padStart(2, '0')}`
  const map = { idle: '未启动', active: '计时中', paused: '已暂停', finished: '已完成' }
  const stateLabel = map[s] || s
  const onCls = s === 'active' ? 'b-on' : s === 'paused' ? 'b-warn' : s === 'finished' ? 'b-on' : 'b-off'
  let btns = ''
  if (['idle', 'finished', 'paused'].includes(s)) btns += `<button class="tbtn on" data-hc="svc" data-svc="timer.start">开始</button>`
  if (s === 'active') btns += `<button class="tbtn" data-hc="svc" data-svc="timer.pause">暂停</button>`
  if (['active', 'paused'].includes(s)) btns += `<button class="tbtn" data-hc="svc" data-svc="timer.cancel">取消</button>`
  if (!btns) btns = '<span class="h-mut">—</span>'
  return { ...b, remainText, stateLabel, onCls, timerBtns: btns }
}

function calendarData(entity, hasData) {
  const b = base(entity, hasData, 'calendar_month')
  if (!entity) return { ...b, stateLabel: '—', onCls: 'b-off', timeRange: '—', summary: '', location: '', description: '' }
  const has = String(entity.state) === 'on'
  const allDay = attr(entity, 'all_day', false) === true
  const s = attr(entity, 'start_time', '')
  const e = attr(entity, 'end_time', '')
  let timeRange = '—'
  if (s) {
    const fmtT = (v) => { const m = /(\d{1,2}):(\d{2})/.exec(String(v)); return m ? `${m[1]}:${m[2]}` : String(v).slice(0, 16) }
    timeRange = allDay ? fmtDate(s) : fmtT(s) + (e ? ' – ' + fmtT(e) : '')
  }
  return {
    ...b, stateLabel: has ? '进行中' : '空闲', onCls: has ? 'b-on' : 'b-off', timeRange,
    summary: attr(entity, 'message') || (entity.friendly_name || entity.entity_id),
    location: attr(entity, 'location', ''),
    description: attr(entity, 'description', ''),
  }
}

function updateData(entity, hasData) {
  const b = base(entity, hasData, 'system_update')
  if (!entity) return { ...b, stateLabel: '—', onCls: 'b-off', inProgress: '', installed: '—', latest: '—', latestColor: 'var(--hc-sub)', release: '', installBtn: '' }
  const avail = String(entity.state) === 'on'
  const inProgress = attr(entity, 'in_progress', false) === true
  return {
    ...b,
    stateLabel: avail ? '有可用更新' : '已是最新',
    onCls: avail ? 'b-warn' : 'b-on',
    inProgress: inProgress ? '更新中…' : '',
    installed: attr(entity, 'installed_version', '—'),
    latest: avail ? attr(entity, 'latest_version', '—') : '—',
    latestColor: avail ? 'var(--hc-warn)' : 'var(--hc-sub)',
    release: attr(entity, 'release_summary', ''),
    installBtn: avail ? '立即更新' : '',
  }
}

function eventData(entity, hasData) {
  const b = base(entity, hasData, 'event')
  if (!entity) return { ...b, stateLabel: '—', onCls: 'b-off', deviceClass: '', eventType: '—', onColor: 'var(--hc-sub)' }
  const fired = String(entity.state) === 'on'
  const dc = attr(entity, 'device_class', '')
  const glyphMap = { motion: 'sensors', button: 'radio_button_checked', doorbell: 'doorbell', lock: 'lock' }
  return {
    ...b, glyph: glyphMap[dc] || 'event',
    stateLabel: fired ? '已触发' : '未触发',
    onCls: fired ? 'b-warn' : 'b-off',
    deviceClass: dc,
    eventType: attr(entity, 'event_type', '—'),
    onColor: fired ? 'var(--hc-warn)' : 'var(--hc-sub)',
  }
}

function plantData(entity, hasData) {
  const b = base(entity, hasData, 'spa')
  if (!entity) return { ...b, stateLabel: '—', onCls: 'b-off', battery: '', plantRows: '', problems: '' }
  const ok = String(entity.state) === 'ok'
  const bat = numVal(attr(entity, 'battery'))
  const a = entity.attributes || {}
  const defs = [['moisture', '湿度', '%'], ['light', '光照', ' lx'], ['temperature', '温度', '°C'], ['conductivity', '电导率', ' µS/cm']]
  const rows = []
  for (const [k, label, unit] of defs) {
    const v = numVal(a[k])
    if (v == null) continue
    const min = numVal(a[k + '_min'])
    const max = numVal(a[k + '_max'])
    const bad = (min != null && v < min) || (max != null && v > max)
    rows.push(`<div class="prow"><span>${label}</span><b style="color:${bad ? 'var(--hc-warn)' : 'var(--hc-text)'}">${Math.round(v)}${unit}</b></div>`)
    if (rows.length >= 4) break
  }
  const problems = attr(entity, 'problem', [])
  const pList = Array.isArray(problems) ? problems : problems ? [String(problems)] : []
  return {
    ...b, stateLabel: ok ? '健康' : '需关注', onCls: ok ? 'b-on' : 'b-warn',
    battery: bat != null ? `🔋${bat}%` : '', plantRows: rows.join(''), problems: pList.join('；'),
  }
}

function lawnMowerData(entity, hasData) {
  const b = base(entity, hasData, 'yard')
  if (!entity) return { ...b, runCls: 'b-off', stateLabel: '—', detail: '' }
  const s = String(entity.state)
  const running = ['mowing', 'returning', 'error'].includes(s)
  const map = { mowing: '割草中', docked: '已停泊', paused: '已暂停', returning: '回坞中', error: '故障', idle: '待机' }
  const bat = numVal(attr(entity, 'battery_level'))
  return { ...b, runCls: running ? 'b-on' : 'b-off', stateLabel: map[s] || s, detail: bat != null ? `电量 ${bat}%` : '' }
}

function imageData(entity, hasData) {
  const b = base(entity, hasData, 'image')
  if (!entity) return { ...b, imageUrl: '' }
  const st = String(entity.state)
  return { ...b, imageUrl: st.startsWith('/api/') ? api.pictureUrl(store.activeID, entity.entity_id) : '' }
}

function genericData(entities, hasData) {
  const list = Array.isArray(entities) ? entities : entities ? [entities] : []
  const first = list[0] || null
  const b = base(first, hasData, 'widgets')
  if (!first) return { ...b, count: '', rowsHtml: '', stateText: '', onCls: 'b-off', attrsHtml: '' }

  const map = { on: '开启', off: '关闭', open: '已打开', closed: '已关闭', home: '在家', not_home: '离家', away: '离家', playing: '播放中', paused: '已暂停', idle: '待机', unavailable: '不可用', unknown: '未知' }
  // 可直接开关的域：行尾渲染开关按钮，点击调用对应域的 toggle
  const toggleDomains = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren', 'valve', 'remote', 'group'])

  const rows = list.map((e) => {
    const on = isOn(e)
    const color = colorOf(e)
    const glyph = iconFor(e, domainGlyph[e.domain] || 'widgets')
    const nm = escHtml(e.friendly_name || e.entity_id)
    let st
    const n = numVal(e.state)
    const unit = e.unit || attr(e, 'unit_of_measurement', '') || ''
    if (n != null) st = `${Math.round(n * 10) / 10}${unit}`
    else st = map[String(e.state)] || String(e.state)
    const tg = toggleDomains.has(e.domain)
      ? `<button type="button" class="g-tg${on ? ' on' : ''}" style="--gc:${color}" data-hc="toggle" data-entity="${escHtml(e.entity_id)}" title="开关"><span class="material-symbols-outlined">power_settings_new</span></button>`
      : ''
    return `<div class="grow"><span class="g-ic material-symbols-outlined" style="color:${color}">${glyph}</span><span class="g-nm">${nm}</span><span class="g-st">${escHtml(st)}</span>${tg}</div>`
  }).join('')

  // 兼容旧模板中的单实体占位符（stateText/onCls/attrsHtml 仍按首个实体提供）
  const s0 = String(first.state)
  return {
    ...b,
    count: list.length > 1 ? String(list.length) : '',
    rowsHtml: rows,
    stateText: map[s0] || s0,
    onCls: isOn(first) ? 'b-on' : 'b-off',
    attrsHtml: attrsBlock(first, 3),
  }
}

function greetingData({ all, hasData, now }) {
  const d = now
  const h = d.getHours()
  const greeting = h < 6 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了'
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const date = `${d.getMonth() + 1}月${d.getDate()}日 ${week[d.getDay()]}`

  let temp = null
  let hum = null
  if (hasData) {
    const c = all.find((e) => e.domain === 'climate')
    const t = c && numVal(attr(c, 'current_temperature'))
    if (t != null) temp = Math.round(t)
    else {
      const s = all.find((e) => (e.device_class || '').includes('temperature') && numVal(e.state) != null)
      if (s) temp = Math.round(numVal(s.state))
    }
    const sh = all.find((e) => (e.device_class || '').includes('humidity') && numVal(e.state) != null)
    if (sh) hum = Math.round(numVal(sh.state))
  }

  let subtitle
  if (!hasData || temp == null) subtitle = '所有设备运行正常'
  else if (temp >= 26) subtitle = `今日室内${temp}°C，天气较热，注意通风`
  else if (temp <= 18) subtitle = `今日室内${temp}°C，注意保暖`
  else if (hum != null && hum < 40) subtitle = `室内湿度${hum}%，较为干燥，可开启加湿`
  else subtitle = '今日室内环境舒适'

  return {
    greeting, subtitle, time, date,
    indoorTemp: temp != null ? `${temp}°C` : '—',
    indoorHumidity: hum != null ? `${hum}%` : '—',
  }
}

function weatherData({ all, hasData, entityId }) {
  // 手动指定来源实体优先；未指定时自动取第一个 weather 域实体（兼容旧卡片）
  const w = hasData
    ? (entityId
        ? all.find((e) => e.entity_id === entityId) || null
        : all.find((e) => e.domain === 'weather') || null)
    : null
  const empty = { icon: '🌤️', temp: '—', unit: '°', condition: hasData ? '暂无天气数据' : '等待 Home Assistant 连接…', feels: '—', humidity: '—', wind: '—', forecastHtml: '' }
  if (!w) return empty
  const unit = (w.unit || '°C').replace('°C', '°')
  const hum = numVal(attr(w, 'humidity'))
  const kmh = numVal(attr(w, 'wind_speed'))
  const wind = kmh != null ? `${Math.round(kmh)} km/h` : (attr(w, 'wind_bearing') ? `${attr(w, 'wind_bearing')}°` : '—')
  return {
    icon: emojiFor(String(w.state), (w.icon || '').split(':').pop()),
    temp: fmtNum(attr(w, 'temperature')),
    unit,
    condition: weatherCond(w.state),
    feels: fmtNum(numVal(attr(w, 'apparent_temperature')) ?? numVal(attr(w, 'feels_like')) ?? numVal(attr(w, 'temperature'))),
    humidity: hum != null ? `${Math.round(hum)}%` : '—',
    wind,
    forecastHtml: forecastHtml(w),
  }
}

function hm(v) {
  const m = /T(\d{2}):(\d{2})/.exec(String(v || ''))
  return m ? `${m[1]}:${m[2]}` : '—'
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// ================= 基础卡：开关（可自动/手动指定实体） =================
const TOGGLE_DOMAINS = ['switch', 'light', 'plug', 'valve', 'input_boolean', 'fan', 'humidifier', 'group', 'remote', 'siren']
function resolveToggleEntity({ all, entityId }) {
  if (entityId) return all.find((e) => e.entity_id === entityId) || null
  return all.find((e) => TOGGLE_DOMAINS.includes(e.domain)) || null
}

// ================= 基础卡：时钟（每秒刷新） =================
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
function clockData(now) {
  const d = now
  return {
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    sec: pad(d.getSeconds()),
    period: d.getHours() < 12 ? '上午' : '下午',
    week: '星期' + WEEK_CN[d.getDay()],
    date: `${d.getMonth() + 1}月${d.getDate()}日`,
  }
}

// ================= 基础卡：日期 =================
function dateData(now) {
  const d = now
  return {
    day: pad(d.getDate()),
    month: d.getMonth() + 1,
    year: d.getFullYear(),
    week: '星期' + WEEK_CN[d.getDay()],
  }
}

// ================= 基础卡：设备概览（自动统计） =================
function overviewData({ all, hasData }) {
  if (!hasData || !all.length) {
    return { total: '—', online: '—', offline: '—', lightsOn: '—', domains: '—' }
  }
  const total = all.length
  const online = all.filter((e) => !['unavailable', 'unknown'].includes(String(e.state))).length
  const lightsOn = all.filter((e) => e.domain === 'light' && String(e.state) === 'on').length
  const domains = new Set(all.map((e) => e.domain)).size
  return { total, online, offline: total - online, lightsOn, domains }
}

// 基础卡默认头部图标（可被卡片自定义图标 card.icon 覆盖）
const DEF_GLYPH = {
  greeting: 'home', weather: 'partly_cloudy_day',
  clock: 'av_timer', date: 'calendar_month', overview: 'devices',
}

// ================= 分发 =================
export function computeData(type, ctx) {
  const { all, hasData, entity, entities } = ctx
  let d
  switch (type) {
    case 'greeting': d = greetingData(ctx); break
    case 'weather': d = weatherData(ctx); break
    case 'map': d = {}; break
    case 'toggle': d = toggleData(resolveToggleEntity(ctx), hasData); break
    case 'clock': d = clockData(ctx.now); break
    case 'date': d = dateData(ctx.now); break
    case 'overview': d = overviewData(ctx); break
    case 'light': case 'switch': case 'fan': case 'input_boolean': d = toggleData(entity, hasData); break
    case 'sensor': d = sensorData(entity, hasData); break
    case 'binary_sensor': d = binaryData(entity, hasData); break
    case 'climate': d = climateData(entity, hasData); break
    case 'cover': d = coverData(entity, hasData); break
    case 'media_player': d = mediaData(entity, hasData); break
    case 'lock': case 'alarm_control_panel': d = securityData(entity, hasData); break
    case 'camera': d = cameraData(entity, hasData); break
    case 'vacuum': d = vacuumData(entity, hasData); break
    case 'scene': case 'script': d = actionData(entity, hasData); break
    case 'person': d = personData(entities, hasData, ctx); break
    case 'weather_entity': d = weatherEntityData(entity, hasData); break
    case 'sun': d = sunData(entity, hasData); break
    case 'select': d = selectData(entity, hasData); break
    case 'text': d = textData(entity, hasData); break
    case 'datetime': d = datetimeData(entity, hasData); break
    case 'timer': d = timerData(entity, hasData); break
    case 'calendar': d = calendarData(entity, hasData); break
    case 'update': d = updateData(entity, hasData); break
    case 'event': d = eventData(entity, hasData); break
    case 'plant': d = plantData(entity, hasData); break
    case 'lawn_mower': d = lawnMowerData(entity, hasData); break
    case 'image': d = imageData(entity, hasData); break
    default: d = genericData(entities && entities.length ? entities : (entity ? [entity] : []), hasData); break
  }
  // 基础卡头部图标默认值（领域卡的 base() 已自带 glyph，不会被覆盖）
  if (d && typeof d === 'object' && !d.glyph && DEF_GLYPH[type]) d.glyph = DEF_GLYPH[type]
  return d
}

// 动态数据计算 —— 为模板中的所有 {{占位符}} 提供值。
// computeData(type, ctx)：ctx = { all, hasData, entity, now }
//  - entity 由 CodeCard 按 card.entity_id 从实时实体流中查找
//  - 与 templates.js 的占位符清单一一对应；缺失的占位符会原样保留
import { attr, numVal, isOn, iconFor, domainGlyph, domainColorCls } from '@/utils/entities'
import { buildControls, renderControlsHtml } from '@/utils/entityControls'
import api from '@/api'
import { store, registryDevices, registryLoaded, entityStates } from '@/store'

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

// HA 天气状态 → 动态天空场景（小米天气式卡片动画）。hail 单独场景，windy 归入大风。
const WX_SCENES = {
  sunny: 'sunny', clear: 'sunny',
  'clear-night': 'night', night: 'night',
  partlycloudy: 'partly',
  cloudy: 'cloudy', overcast: 'cloudy', exceptional: 'cloudy',
  fog: 'fog', hazy: 'fog',
  rainy: 'rain', pouring: 'rain', drizzle: 'rain',
  hail: 'hail',
  snowy: 'snow', 'snowy-rainy': 'snow',
  lightning: 'thunder', 'lightning-rainy': 'thunder',
  windy: 'windy', 'windy-variants': 'windy',
}
// 场景 class（含昼夜）：昼夜只按「本地时间」判定（6:00–18:00 白天），夜间叠加 wx-dark 换深色天幕；
// 晴天夜间直接用 wx-night（月亮 + 星星），白天晴才画太阳。
// 不再依赖 HA 的 sun 实体：其状态可能因 HA 时区配置错误或前端实体列表缓存而滞后，
// 曾导致 22 点仍被判为白天而在卡面画出太阳。雨按状态分级：drizzle 轻雨 wx-light，pouring 大雨 wx-heavy。
function weatherSceneCls(state, now) {
  const s = String(state || '').toLowerCase()
  const d = now instanceof Date ? now : new Date()
  const h = d.getHours()
  let isNight = h < 6 || h >= 18
  if (s.includes('night')) isNight = true
  const scene = WX_SCENES[s] || (isNight ? 'night' : 'cloudy')
  if (scene === 'night') return 'wx-night'
  let cls = 'wx-' + scene
  if (scene === 'rain') {
    if (s === 'drizzle') cls += ' wx-light'
    else if (s === 'pouring') cls += ' wx-heavy'
  }
  return cls + (isNight ? ' wx-dark' : '')
}

// 非有效天气状态：实体存在但无数据（天气集成离线/初始化中），
// 不能按真实天气渲染，否则会出现「晴转多云图标 + unavailable 文案 + 数据全空」的矛盾画面
const WEATHER_BAD = { unavailable: '不可用', unknown: '未知' }
function weatherBadData(entity) {
  return {
    icon: '❔',
    temp: '—',
    unit: (entity.unit || '°C').replace('°C', '°'),
    condition: WEATHER_BAD[String(entity.state)] || String(entity.state),
    feels: '—', humidity: '—', wind: '—', forecastHtml: '', scene: 'wx-cloudy',
  }
}
// 小米天气式 7 日预报（横向滚动条）：今天/明天/周X，每列「日期 · 图标 · 高/低温」。
// 每列用 data-* 携带该日信息（data-scene 该日天气场景 / data-cond 状况 / data-ic 图标 /
// data-hi、data-lo 高低温 / data-label 日期名 / data-today 是否今天）：
// 卡片内嵌引擎据此实现「点某天 → 卡面显示该日信息 + 切换到该日天气动画」，
// 数据属性由 Vue 每次渲染刷新，是唯一真相源（引擎只改 class/文本，不改这些属性）。
// 逐小时源按自然日聚合取最高/最低温，正午时段取图标。
function forecastHtml(entity) {
  const arr = attr(entity, 'forecast', [])
  if (!Array.isArray(arr) || !arr.length) return ''
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const byDay = new Map()
  for (const f of arr) {
    const d = new Date(f.datetime)
    if (Number.isNaN(d.getTime())) continue
    const key = d.toDateString()
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push({ f, d })
  }
  const today = new Date(new Date().toDateString()).getTime()
  const tomorrow = today + 86400000
  const days = []
  for (const list of byDay.values()) {
    const start = new Date(list[0].d); start.setHours(0, 0, 0, 0)
    if (start.getTime() < today) continue // 逐小时源：跳过已过去的时段
    days.push({ start: start.getTime(), list })
  }
  days.sort((a, b) => a.start - b.start)
  const first7 = days.slice(0, 7)
  if (!first7.length) return ''
  return `<div class="fc7w">` + first7.map(({ start, list }, i) => {
    const label = start === today ? '今天' : start === tomorrow ? '明天' : week[new Date(start).getDay()]
    const mid = list.find((x) => x.d.getHours() >= 11 && x.d.getHours() <= 14) || list[0]
    const st = String(mid.f.condition || '').toLowerCase()
    const ic = emojiFor(st, (mid.f.icon || '').split(':').pop())
    const cond = weatherCond(mid.f.condition)
    const temps = list.map((x) => numVal(x.f.temperature)).filter((v) => v != null)
    const lows = list.map((x) => numVal(x.f.templow)).filter((v) => v != null)
    const high = temps.length ? Math.round(Math.max(...temps)) : null
    const low = lows.length ? Math.round(Math.min(...lows)) : null
    // 该日天气场景（仅天气部分，不含昼夜：卡片引擎按「当前时间」叠加夜色，符合「随时间+天气变化」）
    let fcls = 'wx-' + (WX_SCENES[st] || 'cloudy')
    if (WX_SCENES[st] === 'rain') {
      if (st === 'drizzle') fcls += ' wx-light'
      else if (st === 'pouring') fcls += ' wx-heavy'
    }
    return `<div class="fc7d" data-i="${i}" data-label="${label}" data-scene="${fcls}" data-cond="${cond}" data-ic="${ic}"`
      + ` data-hi="${high != null ? high + '°' : '—'}" data-lo="${low != null ? low + '°' : '—'}"`
      + (start === today ? ' data-today="1"' : '')
      + `><span class="fc7-l">${label}</span><span class="fc7-i">${ic}</span>`
      + `<span class="fc7-t"><b>${high != null ? high + '°' : '—'}</b><i>${low != null ? low + '°' : '—'}</i></span></div>`
  }).join('') + `</div>`
}

// ================= 各卡组数据 =================
// 控件 HTML 片段：由 utils/entityControls 的能力模型统一推导（与设备页「更多信息」面板同源），
// 这样「属性缺失」也不会导致控件消失（如关闭状态下的亮度滑条）。
function controlsOf(entity) {
  return entity ? renderControlsHtml(buildControls(entity), entity.entity_id) : ''
}
// 只要指定 id 的控件（模板已自绘同功能 UI 时，避免重复）
function controlsOfIds(entity, ids) {
  if (!entity) return ''
  const want = new Set(ids)
  return renderControlsHtml(buildControls(entity).filter((c) => want.has(c.id)), entity.entity_id)
}

function toggleData(entity, hasData) {
  const b = base(entity, hasData, 'toggle_on')
  if (!entity) return { ...b, onCls: 'b-off', stateLabel: '', state: '', controlsHtml: '' }
  const on = isOn(entity)
  return {
    ...b, onCls: on ? 'b-on' : 'b-off', stateLabel: on ? '已开启' : '已关闭',
    state: String(entity.state), controlsHtml: controlsOf(entity),
  }
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
    return { ...b, temp: '—', tempUnit: '', target: '', hvacHtml: '', setSvc: '', decArgs: '{}', incArgs: '{}', modeLabel: '—', extraControls: '' }
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
  // ±1 步进：按 target_temp_step 步进，并用 min_temp/max_temp 夹取；无当前值时按钮置空（不误发无参调用）
  let decArgs = ''
  let incArgs = ''
  let stepSvc = setSvc
  if (cur != null) {
    const key = d === 'humidifier' ? 'humidity' : 'temperature'
    const step = numVal(attr(entity, 'target_temp_step')) || 1
    const min = numVal(attr(entity, 'min_temp'))
    const max = numVal(attr(entity, 'max_temp'))
    const lo = Math.round((cur - step) * 10) / 10
    const hi = Math.round((cur + step) * 10) / 10
    decArgs = JSON.stringify({ [key]: min != null ? Math.max(min, lo) : lo })
    incArgs = JSON.stringify({ [key]: max != null ? Math.min(max, hi) : hi })
  } else {
    stepSvc = ''
  }
  const modeKey = d === 'humidifier' ? 'mode' : d === 'water_heater' ? 'operation_mode' : 'hvac_mode'
  const modeSvc = d === 'humidifier' ? 'set_mode' : d === 'water_heater' ? 'set_operation_mode' : 'set_hvac_mode'
  const curMode = attr(entity, 'hvac_mode') || attr(entity, 'operation_mode') || attr(entity, 'mode') || entity.state
  const modes = attr(entity, 'hvac_modes') || attr(entity, 'operation_modes') || attr(entity, 'modes') || []
  const chips = (Array.isArray(modes) ? modes : []).slice(0, 6)
    .map((m) => `<span class="${m === curMode ? 'on' : ''}" data-hc="svc" data-svc="${d}.${modeSvc}" data-args='${JSON.stringify({ [modeKey]: m })}'>${hvacMap[m] || m}</span>`)
    .join('')
  const modeLabel = hvacMap[curMode] || String(curMode || '')
  // 模板已自绘模式芯片与 ± 调温按钮，这里只补风档/预设/摆风/湿度等附加控件
  const extraControls = controlsOfIds(entity, ['fan_mode', 'preset_mode', 'swing_mode', 'swing_horizontal_mode', 'humidity'])
  return { ...b, temp, tempUnit: unit, target, hvacHtml: chips, setSvc: stepSvc, decArgs, incArgs, modeLabel, extraControls }
}

function coverData(entity, hasData) {
  const b = base(entity, hasData, 'curtains')
  if (!entity) return { ...b, onCls: 'b-off', stateLabel: '—', posText: '—', controlsHtml: '' }
  const s = String(entity.state)
  const map = { open: '已打开', opening: '打开中…', closed: '已关闭', closing: '关闭中…', stopped: '已停止' }
  const on = ['open', 'opening'].includes(s)
  const pos = numVal(attr(entity, 'current_position'))
  return {
    ...b, onCls: on ? 'b-on' : 'b-off', stateLabel: map[s] || s,
    posText: pos != null ? pos + '%' : '—', controlsHtml: controlsOf(entity),
  }
}

function mediaData(entity, hasData) {
  const b = base(entity, hasData, 'tv')
  if (!entity) return { ...b, mediaGlyph: 'music_note', mediaTitle: '—', playSvc: 'media_player.media_play', playIcon: 'play_arrow', volumePct: '0', extraControls: '' }
  const playing = String(entity.state) === 'playing'
  const title = attr(entity, 'media_title') || attr(entity, 'media_artist') || attr(entity, 'media_album_name') || '暂无播放内容'
  const vol = numVal(attr(entity, 'volume_level'))
  return {
    ...b, mediaGlyph: 'music_note', mediaTitle: title,
    playSvc: playing ? 'media_player.media_pause' : 'media_player.media_play',
    playIcon: playing ? 'pause' : 'play_arrow',
    volumePct: vol != null ? String(Math.round(vol * 100)) : '0',
    // 模板已自绘输送按钮与音量滑条，这里只补静音/音源/声音模式
    extraControls: controlsOfIds(entity, ['mute', 'source', 'sound_mode']),
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

// 人员头像片段：自定义图 > HA 实体头像 > 默认人形图标（人员位置 / 人员信息卡共用）
function personAvatarHtml(main, custom) {
  if (custom) return `<img class="avatar" src="${escHtml(custom)}" referrerpolicy="no-referrer" alt="">`
  const pic = attr(main, 'entity_picture')
  if (pic && String(pic).startsWith('/api/')) {
    return `<img class="avatar" src="${api.pictureUrl(store.activeID, main.entity_id)}" referrerpolicy="no-referrer" alt="">`
  }
  return `<div class="avatar-f"><span class="material-symbols-outlined" style="font-size:18px">person</span></div>`
}

// 人员在家/离家角标（人员位置 / 人员信息卡共用）
function personHomeState(main) {
  const s = String(main.state).toLowerCase()
  const home = !['away', 'not_home', 'none'].includes(s)
  const label = s === 'home' ? '在家' : (s === 'away' || s === 'not_home') ? '离家' : String(main.state)
  return { home, label }
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

// ================= 人员信息卡（三槽位） =================
// 槽位1 = entity_id（person/device_tracker）：名称居左、在家/离家角标居右上、头像居中
// 槽位2/3 的项统一为「领域图标 + 状态值」（不显示实体名）：
//   槽位2 = ctx.entities2（多选）：中部循环翻动——全部项一次渲染，CodeCard 在 DOM 层
//           轮换 .on 类（不走数据驱动，避免每次翻动重建 v-html 导致下方滚动被重置）
//   槽位3 = ctx.entities3（多选）：底部从右向左无缝滚动（模板双拷贝 + translateX(-50%)）
function slotEntityHtml(e) {
  const unit = e.unit || attr(e, 'unit_of_measurement') || ''
  const icon = iconFor(e, domainGlyph[e.domain] || 'widgets')
  const val = `${String(e.state)}${unit ? ' ' + unit : ''}`
  return `<span class="material-symbols-outlined pi-it-ic">${icon}</span>${escHtml(val)}`
}
// 不带图标的纯值版本：用于 head 行跑马灯（空间紧张、不需要图标）
function slotValueHtml(e) {
  const unit = e.unit || attr(e, 'unit_of_measurement') || ''
  return `${escHtml(String(e.state))}${unit ? ' ' + unit : ''}`
}

// 积木设计器的实体占位符注入表：
// binding_entity 积木按槽位下标输出 `{{s_<slot>_<index>_<field>}}`，
// 这里按四个实体槽位数组生成对应值（与 blockDefs 的 entitySlotMap 顺序一致）。
export function bindingSlotTokens(slots) {
  const out = {}
  Object.entries(slots || {}).forEach(([key, list]) => {
    if (!Array.isArray(list)) return
    list.forEach((e, i) => {
      if (!e) return
      const unit = e.unit || attr(e, 'unit_of_measurement') || ''
      const p = `s_${key}_${i}`
      out[`${p}_icon`] = iconFor(e, domainGlyph[e.domain] || 'widgets')
      out[`${p}_name`] = e.friendly_name || e.entity_id || ''
      out[`${p}_state`] = String(e.state)
      out[`${p}_unit`] = unit
    })
  })
  return out
}

function personInfoData(ctx) {
  const { hasData, entity: main, card } = ctx
  const list2 = Array.isArray(ctx.entities2) ? ctx.entities2.filter(Boolean) : []
  const list3 = Array.isArray(ctx.entities3) ? ctx.entities3.filter(Boolean) : []
  const listSt = Array.isArray(ctx.entitiesStatus) ? ctx.entitiesStatus.filter(Boolean) : []
  const b = base(main, hasData, 'person')
  if (!main) {
    return {
      ...b, badge: '<span class="h-badge b-off">—</span>', avatarHtml: personAvatarHtml(null, card?.avatar),
      cycleCls: ' is-hide', cycleItemsHtml: '', mqCls: ' is-hide', marqueeItemsHtml: '',
      headStatusHtml: '<span class="pi-hs is-hide"></span>',
    }
  }
  const { home, label } = personHomeState(main)
  const badge = `<span class="h-badge ${home ? 'b-on' : 'b-warn'}">${escHtml(label)}</span>`
  const items2 = list2.map(slotEntityHtml)
  const items3 = list3.map(slotEntityHtml)
  // head 跑马灯不带图标（空间紧张），只显示值
  const itemsSt = listSt.map(slotValueHtml).map((v) => `<span class="pi-hs-it">${v}</span>`).join('')
  const headStatusHtml = itemsSt.length
    ? `<span class="pi-hs"><span class="pi-hs-in">${itemsSt}${itemsSt}</span></span>`
    : `<span class="pi-hs is-hide"></span>`
  return {
    ...b,
    badge,
    avatarHtml: personAvatarHtml(main, card?.avatar),
    cycleCls: items2.length ? '' : ' is-hide',
    cycleItemsHtml: items2.map((h) => `<span class="pi-cy-item">${h}</span>`).join(''),
    mqCls: items3.length ? '' : ' is-hide',
    marqueeItemsHtml: items3.map((h) => `<span class="pi-mq-it">${h}</span>`).join(''),
    headStatusHtml,
  }
}

function weatherEntityData(entity, hasData) {
  const b = base(entity, hasData, 'partly_cloudy_day')
  if (!entity) return { ...b, icon: '🌤️', temp: '—', unit: '°', condition: '—', feels: '—', humidity: '—', wind: '—', forecastHtml: '' }
  if (WEATHER_BAD[String(entity.state)]) return { ...b, ...weatherBadData(entity) }
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

// ================= 设备类型设计系统 =================
// 每种设备类型有专属：大图标 / 主题色 / 类型标签。卡片视觉随类型变化。
const DEVICE_KIND = {
  climate: { icon: 'thermostat', color: '#6BAED9', label: '空调温控' },
  lock: { icon: 'lock', color: '#7CC98C', label: '智能门锁' },
  alarm_control_panel: { icon: 'shield', color: '#7CC98C', label: '安防报警' },
  media_player: { icon: 'smart_display', color: '#8E92E8', label: '影音娱乐' },
  vacuum: { icon: 'vacuum', color: '#5EC4B0', label: '扫地机器人' },
  lawn_mower: { icon: 'grass', color: '#7CC98C', label: '割草机器人' },
  cover: { icon: 'curtains', color: '#AC8FE0', label: '窗帘遮阳' },
  fan: { icon: 'air', color: '#6BC5D9', label: '风扇' },
  humidifier: { icon: 'humidity_low', color: '#6BC5D9', label: '加湿除湿' },
  light: { icon: 'lightbulb', color: '#F5B04C', label: '照明灯光' },
  switch: { icon: 'toggle_on', color: '#E8A84C', label: '智能开关' },
  plug: { icon: 'outlet', color: '#E8A84C', label: '智能插座' },
  valve: { icon: 'water_drop', color: '#6BAED9', label: '智能水阀' },
  siren: { icon: 'campaign', color: '#E88C7C', label: '声光报警' },
  sensor: { icon: 'sensors', color: '#7CC98C', label: '环境监测' },
  binary_sensor: { icon: 'sensor_check', color: '#7CC98C', label: '状态监测' },
  input_boolean: { icon: 'toggle_on', color: '#8E92E8', label: '辅助开关' },
  select: { icon: 'tune', color: '#8E92E8', label: '下拉选项' },
  button: { icon: 'touch_app', color: '#E8A84C', label: '一键按钮' },
  input_button: { icon: 'touch_app', color: '#E8A84C', label: '一键按钮' },
  script: { icon: 'code', color: '#8E92E8', label: '脚本' },
  scene: { icon: 'auto_awesome', color: '#AC8FE0', label: '场景模式' },
}
// 主实体域优先级：设备的核心控制实体排在最前（决定卡片主状态区展示什么）
const HERO_PRIORITY = ['climate', 'lock', 'alarm_control_panel', 'media_player', 'vacuum', 'lawn_mower',
  'cover', 'fan', 'humidifier', 'light', 'siren', 'switch', 'plug', 'valve', 'input_boolean',
  'script', 'scene', 'button', 'input_button', 'select', 'sensor', 'binary_sensor']

function hexRgb(h) {
  const s = String(h).replace('#', '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}
function pickHeroEntity(list) {
  for (const dom of HERO_PRIORITY) {
    const e = list.find((x) => x.domain === dom)
    if (e) return e
  }
  return list[0]
}

// 二值传感器的语义文案（按 device_class 区分，两字短词）
function binaryStateText(e) {
  const on = isOn(e)
  const dc = String(e.device_class || '').toLowerCase()
  const map = {
    door: ['打开', '关闭'], window: ['打开', '关闭'], opening: ['打开', '关闭'],
    motion: ['有人', '无人'], occupancy: ['有人', '无人'], presence: ['有人', '无人'],
    problem: ['异常', '正常'], smoke: ['报警', '正常'], gas: ['报警', '正常'],
    carbon_monoxide: ['报警', '正常'], moisture: ['潮湿', '干燥'], leak: ['漏水', '正常'],
    sound: ['有声', '安静'], vibration: ['震动', '静止'], battery: ['低电', '正常'],
    power: ['通电', '断电'], running: ['运行', '停止'], connectivity: ['在线', '离线'],
  }
  return (map[dc] || ['开启', '关闭'])[on ? 0 : 1]
}

// 按实体类型提取主状态：{ mode:'num'|'icon'|'text', big, unit, bigIcon, bigText, sub, state, stateCls, active, click }
function heroFor(e) {
  const d = e.domain
  const st = String(e.state)
  const on = isOn(e)

  if (d === 'climate') {
    const cur = numVal(attr(e, 'current_temperature'))
    const modes = { off: '已关闭', cool: '制冷中', heat: '制热中', auto: '自动模式', heat_cool: '冷暖模式', fan_only: '送风模式', dry: '除湿中', idle: '待机' }
    const running = st !== 'off' && st !== 'idle'
    return { mode: 'num', big: cur != null ? String(Math.round(cur * 10) / 10) : '—', unit: '°C',
      sub: modes[st] || st, state: running ? '运行中' : '已关闭', stateCls: running ? 'is-on' : '',
      active: running, click: { kind: 'toggle' } }
  }
  if (d === 'light') {
    const br = numVal(attr(e, 'brightness'))
    const pct = br != null ? Math.round(br / 255 * 100) : on ? 100 : 0
    return { mode: 'num', big: String(pct), unit: '%',
      sub: on ? '亮度 ' + pct + '%' : '已关闭',
      state: on ? '已开启' : '已关闭', stateCls: on ? 'is-on' : '',
      active: on, click: { kind: 'toggle' } }
  }
  if (d === 'cover') {
    let pct = numVal(attr(e, 'current_position'))
    if (pct == null) pct = st === 'open' ? 100 : st === 'closed' ? 0 : null
    const subs = { open: '已打开', closed: '已关闭', opening: '正在打开', closing: '正在关闭' }
    return { mode: 'num', big: pct == null ? '—' : String(Math.round(pct)), unit: '%',
      sub: subs[st] || st, state: on ? '已打开' : '已关闭', stateCls: on ? 'is-on' : '',
      active: on, click: { kind: 'svc', svc: 'cover.toggle' } }
  }
  if (d === 'lock') {
    const locked = st === 'locked'
    return { mode: 'icon', bigIcon: locked ? 'lock' : 'lock_open',
      sub: locked ? '安全 · 已锁定' : '注意 · 未锁定',
      state: locked ? '已锁定' : '未锁定', stateCls: locked ? 'is-ok' : 'is-warn',
      active: !locked, click: { kind: 'svc', svc: locked ? 'lock.unlock' : 'lock.lock' } }
  }
  if (d === 'alarm_control_panel') {
    const armed = st.startsWith('armed')
    const subs = { disarmed: '已撤防', armed_away: '外出布防中', armed_home: '在家布防中', armed_night: '夜间布防中', triggered: '报警触发！' }
    return { mode: 'icon', bigIcon: st === 'triggered' ? 'crisis_alert' : armed ? 'verified_user' : 'shield',
      sub: subs[st] || st, state: armed ? '已布防' : '已撤防', stateCls: armed ? 'is-on' : '',
      active: armed, click: { kind: 'svc', svc: armed ? 'alarm_control_panel.alarm_disarm' : 'alarm_control_panel.alarm_arm_away' } }
  }
  if (d === 'media_player') {
    const playing = st === 'playing'
    const title = attr(e, 'media_title')
    const artist = attr(e, 'media_artist')
    return { mode: 'icon', bigIcon: playing ? 'pause' : 'play_arrow',
      sub: title ? title + (artist ? ' · ' + artist : '') : ({ paused: '已暂停', idle: '待机', off: '已关闭', buffering: '缓冲中' }[st] || st),
      state: { playing: '播放中', paused: '已暂停', idle: '待机', off: '已关闭' }[st] || st,
      stateCls: playing ? 'is-on' : '', active: playing,
      click: { kind: 'svc', svc: 'media_player.media_play_pause' } }
  }
  if (d === 'vacuum') {
    const subs = { cleaning: '清扫中', docked: '已回充', idle: '待机', paused: '已暂停', returning: '回充中', error: '异常需处理' }
    const working = ['cleaning', 'returning'].includes(st)
    const svc = st === 'cleaning' ? 'vacuum.pause' : st === 'returning' ? 'vacuum.pause' : 'vacuum.start'
    return { mode: 'icon', bigIcon: st === 'cleaning' ? 'pause' : st === 'returning' ? 'autorenew' : st === 'error' ? 'error' : 'play_arrow',
      sub: subs[st] || st, state: subs[st] || st,
      stateCls: st === 'error' ? 'is-warn' : working ? 'is-on' : 'is-ok',
      active: working, click: { kind: 'svc', svc } }
  }
  if (d === 'lawn_mower') {
    const subs = { mowing: '割草中', docked: '已回充', idle: '待机', paused: '已暂停', error: '异常需处理' }
    const working = st === 'mowing'
    return { mode: 'icon', bigIcon: working ? 'pause' : st === 'error' ? 'error' : 'play_arrow',
      sub: subs[st] || st, state: subs[st] || st,
      stateCls: st === 'error' ? 'is-warn' : working ? 'is-on' : 'is-ok',
      active: working, click: { kind: 'svc', svc: working ? 'lawn_mower.pause' : 'lawn_mower.start_mowing' } }
  }
  if (d === 'fan' || d === 'humidifier') {
    const pct = numVal(attr(e, 'percentage'))
    return { mode: 'num', big: pct != null ? String(Math.round(pct)) : on ? '100' : '0', unit: '%',
      sub: on ? (attr(e, 'preset_mode') || '运行中') : '已关闭',
      state: on ? '运行中' : '已关闭', stateCls: on ? 'is-on' : '',
      active: on, click: { kind: 'toggle' } }
  }
  if (['switch', 'plug', 'valve', 'input_boolean', 'group', 'remote'].includes(d)) {
    const bigIcon = d === 'valve' ? 'water_drop' : 'toggle_' + (on ? 'on' : 'off')
    return { mode: 'icon', bigIcon, sub: on ? '已开启' : '已关闭',
      state: on ? '已开启' : '已关闭', stateCls: on ? 'is-on' : '',
      active: on, click: { kind: 'toggle' } }
  }
  if (d === 'siren') {
    return { mode: 'icon', bigIcon: 'campaign', sub: on ? '警报响起' : '已关闭',
      state: on ? '报警中' : '已关闭', stateCls: on ? 'is-warn' : '',
      active: on, click: { kind: 'toggle' } }
  }
  if (d === 'button' || d === 'input_button') {
    return { mode: 'icon', bigIcon: 'touch_app', sub: '点击执行',
      state: '待触发', stateCls: '', active: false, click: { kind: 'svc', svc: d + '.press' } }
  }
  if (d === 'script') {
    return { mode: 'icon', bigIcon: 'play_arrow', sub: '点击运行脚本',
      state: '待运行', stateCls: '', active: false, click: { kind: 'svc', svc: 'script.turn_on' } }
  }
  if (d === 'scene') {
    return { mode: 'icon', bigIcon: 'auto_awesome', sub: '点击切换场景',
      state: '场景', stateCls: '', active: false, click: { kind: 'svc', svc: 'scene.turn_on' } }
  }
  if (d === 'select') {
    return { mode: 'text', bigText: st, sub: '当前选项', state: '选项', stateCls: '', active: false, click: null }
  }
  if (d === 'sensor') {
    const n = numVal(e.state)
    const unit = e.unit || attr(e, 'unit_of_measurement', '')
    const dc = String(e.device_class || '').toLowerCase()
    const subs = { temperature: '室内温度', humidity: '空气湿度', power: '实时功率', energy: '累计电量',
      pm25: 'PM2.5', pm10: 'PM10', co2: 'CO2 浓度', illuminance: '光照强度', pressure: '大气压力',
      battery: '电池电量', aqi: '空气质量', formaldehyde: '甲醛浓度' }
    return { mode: 'num', big: n != null ? String(Math.round(n * 10) / 10) : '—', unit,
      sub: subs[dc] ? '当前' + subs[dc] : (e.friendly_name || ''),
      state: subs[dc] || '传感', stateCls: '', active: false, click: null }
  }
  if (d === 'binary_sensor') {
    const dc = String(e.device_class || '').toLowerCase()
    const subs = { door: '门窗状态', window: '门窗状态', opening: '门窗状态', motion: '人体感应',
      occupancy: '存在感应', presence: '存在感应', problem: '设备状态', smoke: '烟雾报警', gas: '燃气报警',
      moisture: '水浸状态', leak: '漏水检测', battery: '电池状态', power: '供电状态', running: '运行状态' }
    const warnDc = new Set(['door', 'window', 'opening', 'smoke', 'gas', 'moisture', 'leak', 'problem', 'carbon_monoxide', 'tampering', 'safety'])
    return { mode: 'text', bigText: binaryStateText(e), sub: subs[dc] || e.friendly_name || '',
      state: binaryStateText(e),
      stateCls: !on ? 'is-ok' : warnDc.has(dc) ? 'is-warn' : 'is-on',
      active: on && !warnDc.has(dc), click: null }
  }
  return { mode: 'text', bigText: st, sub: e.friendly_name || '', state: '—', stateCls: '', active: false, click: null }
}

// 设备卡行内动作：按实体域返回 { icon, kind:'toggle'|'svc', svc?, on, tip }，无动作返回 null。
// 让一台物理设备的所有可控实体在同一张卡片内直接操作，无需逐个实体翻找。
function rowAction(e) {
  const d = e.domain
  const st = String(e.state)
  const on = isOn(e)
  const toggleSet = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren', 'valve', 'remote', 'group'])
  if (toggleSet.has(d)) return { icon: 'power_settings_new', kind: 'toggle', on, tip: '开关' }
  if (d === 'cover') return { icon: 'swap_vert', kind: 'svc', svc: 'cover.toggle', on, tip: '打开/关闭' }
  if (d === 'lock') {
    return st === 'locked'
      ? { icon: 'lock_open', kind: 'svc', svc: 'lock.unlock', on: false, tip: '解锁' }
      : { icon: 'lock', kind: 'svc', svc: 'lock.lock', on: true, tip: '锁定' }
  }
  if (d === 'media_player') return { icon: 'play_pause', kind: 'svc', svc: 'media_player.media_play_pause', on, tip: '播放/暂停' }
  if (d === 'scene') return { icon: 'play_arrow', kind: 'svc', svc: 'scene.turn_on', on: false, tip: '执行场景' }
  if (d === 'script') return { icon: 'play_arrow', kind: 'svc', svc: 'script.turn_on', on: false, tip: '运行脚本' }
  if (d === 'button' || d === 'input_button') return { icon: 'touch_app', kind: 'svc', svc: `${d}.press`, on: false, tip: '按下' }
  if (d === 'vacuum') {
    return ['cleaning', 'paused', 'returning', 'error'].includes(st)
      ? { icon: 'pause', kind: 'svc', svc: 'vacuum.pause', on: true, tip: '暂停清扫' }
      : { icon: 'play_arrow', kind: 'svc', svc: 'vacuum.start', on: false, tip: '开始清扫' }
  }
  if (d === 'lawn_mower') {
    return ['mowing', 'paused', 'error'].includes(st)
      ? { icon: 'pause', kind: 'svc', svc: 'lawn_mower.pause', on: true, tip: '暂停' }
      : { icon: 'play_arrow', kind: 'svc', svc: 'lawn_mower.start_mowing', on: false, tip: '开始割草' }
  }
  return null
}

// 实体行（通用卡「其余实体行」与实体组卡共用）：图标 + 名称 + 状态文本 + 行内开关按钮
// （data-hc="toggle"/"svc" 由 CodeCard 统一派发，行按钮点击不触发卡片整卡点击）。
function entityRowHtml(e) {
  const stateMap = { on: '开启', off: '关闭', open: '已打开', closed: '已关闭', home: '在家', not_home: '离家', playing: '播放中', paused: '已暂停', idle: '待机' }
  const color = colorOf(e)
  const glyph = iconFor(e, domainGlyph[e.domain] || 'widgets')
  const nm = escHtml(e.friendly_name || e.entity_id)
  const n = numVal(e.state)
  const unit = e.unit || attr(e, 'unit_of_measurement', '') || ''
  const st = n != null ? `${Math.round(n * 10) / 10}${unit}` : (stateMap[String(e.state)] || String(e.state))
  let actHtml = ''
  const a = rowAction(e)
  if (a) {
    const actionAttrs = a.kind === 'toggle'
      ? 'data-hc="toggle"'
      : `data-hc="svc" data-svc="${escHtml(a.svc)}"`
    actHtml = `<button type="button" class="g-tg${a.on ? ' on' : ''}" style="--gc:${color}" ${actionAttrs} data-entity="${escHtml(e.entity_id)}" title="${a.tip}"><span class="material-symbols-outlined">${a.icon}</span></button>`
  }
  return `<div class="grow"><span class="g-ic material-symbols-outlined" style="color:${color}">${glyph}</span><span class="g-nm">${nm}</span><span class="g-st">${escHtml(st)}</span>${actHtml}</div>`
}

// 实体组卡数据：卡面只显示组名/图标/设备数（实体列表在点击弹窗中展示）。
function groupData(entities, hasData, card) {
  const list = Array.isArray(entities) ? entities : entities ? [entities] : []
  const b = base(list[0] || null, hasData, 'group_work')
  const tint = list.length ? colorOf(list[0]) : '#8A8986'
  return {
    ...b,
    name: card?.title || '实体组',
    groupIcon: card?.icon || 'group_work',
    count: String(list.length),
    kindColorRgb: hexRgb(tint),
  }
}

function genericData(entities, hasData, card) {
  const list = Array.isArray(entities) ? entities : entities ? [entities] : []
  const first = list[0] || null
  const b = base(first, hasData, 'widgets')
  if (!first) return { ...b, rowsHtml: '', rowsHideCls: 'is-empty', bigHtml: '', sub: '', state: '', stateCls: '',
    kindColor: '#8A8986', kindColorRgb: '138,137,134', kindLabel: '设备', kindIcon: 'widgets',
    activeCls: '', shortCls: 'is-short', heroBtnCls: '', heroClickAttrs: '' }

  // 1) 选主实体（按设备类型优先级），决定卡片类型视觉
  const heroEntity = pickHeroEntity(list)
  const cfg = DEVICE_KIND[heroEntity.domain] || { icon: 'widgets', color: '#8A8986', label: '通用设备' }
  // 2) 主状态字段
  const hero = heroFor(heroEntity)
  const name = card?.title || b.name

  // 主状态区点击属性：toggle 走 /toggle，svc 走服务转发
  let heroClickAttrs = ''
  if (hero.click) {
    heroClickAttrs = hero.click.kind === 'toggle'
      ? `data-hc="toggle" data-entity="${escHtml(heroEntity.entity_id)}"`
      : `data-hc="svc" data-svc="${escHtml(hero.click.svc)}" data-entity="${escHtml(heroEntity.entity_id)}"`
  }
  // 大字区三种模式：数字（值+单位）/ 图标 / 短文本
  let bigHtml
  if (hero.mode === 'num') bigHtml = `${escHtml(hero.big)}<small>${escHtml(hero.unit)}</small>`
  else if (hero.mode === 'icon') bigHtml = `<span class="material-symbols-outlined">${escHtml(hero.bigIcon)}</span>`
  else bigHtml = escHtml(hero.bigText)

  // 3) 其余实体行（主实体已在主状态区展示，不再重复）
  const restList = list.filter((e) => e !== heroEntity)
  const rowsHtml = restList.map(entityRowHtml).join('')

  return {
    ...b,
    name,
    glyph: cfg.icon,
    kindIcon: cfg.icon,
    kindColor: cfg.color,
    kindColorRgb: hexRgb(cfg.color),
    kindLabel: cfg.label,
    activeCls: hero.active ? 'is-active' : '',
    shortCls: card?.h === 1 ? 'is-short' : 'is-tall',
    heroBtnCls: hero.click ? 'is-btn' : '',
    heroClickAttrs,
    bigHtml,
    sub: hero.sub,
    state: hero.state,
    stateCls: hero.stateCls,
    rowsHtml,
    rowsHideCls: restList.length ? '' : 'is-empty',
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

function weatherData({ all, hasData, entityId, now }) {
  // 手动指定来源实体优先；未指定时自动取第一个 weather 域实体（兼容旧卡片）
  const w = hasData
    ? (entityId
        ? all.find((e) => e.entity_id === entityId) || null
        : all.find((e) => e.domain === 'weather') || null)
    : null
  const empty = { icon: '🌤️', temp: '—', unit: '°', condition: hasData ? '暂无天气数据' : '等待 Home Assistant 连接…', feels: '—', humidity: '—', wind: '—', hi: '—', lo: '—', forecastHtml: '', scene: 'wx-cloudy' }
  if (!w) return empty
  if (WEATHER_BAD[String(w.state)]) return weatherBadData(w)
  const unit = (w.unit || '°C').replace('°C', '°')
  const hum = numVal(attr(w, 'humidity'))
  const kmh = numVal(attr(w, 'wind_speed'))
  const wind = kmh != null ? `${Math.round(kmh)} km/h` : (attr(w, 'wind_bearing') ? `${attr(w, 'wind_bearing')}°` : '—')
  // 今天最高/最低温：从预报首日聚合（逐小时源同日取最大/最小）
  const fc = attr(w, 'forecast', [])
  const day0 = Array.isArray(fc) ? fc.filter((f) => { const d = new Date(f.datetime); return !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString() }) : []
  const t0s = day0.map((f) => numVal(f.temperature)).filter((v) => v != null)
  const l0s = day0.map((f) => numVal(f.templow)).filter((v) => v != null)
  const hi = t0s.length ? Math.round(Math.max(...t0s)) : null
  const lo = l0s.length ? Math.round(Math.min(...l0s)) : (t0s.length > 1 ? Math.round(Math.min(...t0s)) : null)
  return {
    icon: emojiFor(String(w.state), (w.icon || '').split(':').pop()),
    temp: fmtNum(attr(w, 'temperature')),
    unit,
    condition: weatherCond(w.state),
    feels: fmtNum(numVal(attr(w, 'apparent_temperature')) ?? numVal(attr(w, 'feels_like')) ?? numVal(attr(w, 'temperature'))),
    humidity: hum != null ? `${Math.round(hum)}%` : '—',
    wind,
    hi: hi != null ? `${hi}°` : '—',
    lo: lo != null ? `${lo}°` : '—',
    forecastHtml: forecastHtml(w),
    scene: weatherSceneCls(w.state, now),
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

// ================= 基础卡：翻页时钟（数字牌初始值；后续由卡片 JS 自走定时器驱动） =================
function flipClockData(now) {
  const d = clockData(now)
  const hh = pad(now.getHours())
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  return { ...d, year: now.getFullYear(), hh1: hh[0], hh2: hh[1], mm1: mm[0], mm2: mm[1], ss1: ss[0], ss2: ss[1] }
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
// 按「物理设备」统计（与设备抽屉同一数据源 registryDevices），
// 保证卡片数字与抽屉列出的设备数量一致。
// online/offline 字段语义为「开启/关闭」的设备数（至少一个实体 isOn）：
// 原先按可用性统计的在线/离线在 HA 里几乎恒为「全部/零」，点击格子没有过滤感。
function overviewData({ all }) {
  const devs = registryDevices.value
  if (!registryLoaded.value && !devs.length) {
    return { total: '—', online: '—', offline: '—', lightsOn: '—', domains: '—' }
  }
  const total = devs.length
  const liveState = (e) => {
    const live = entityStates[e.entity_id]
    return live && live.state !== undefined ? live.state : e.state
  }
  const active = devs.filter((d) => (d.entities || []).some((e) => !e.disabled && isOn({ state: liveState(e), domain: e.domain }))).length
  const lightsOn = all.filter((e) => e.domain === 'light' && String(e.state) === 'on').length
  const domains = new Set(devs.map((d) => d.domain).filter(Boolean)).size
  return { total, online: active, offline: total - active, lightsOn, domains }
}

// 日历 / 黄历卡覆盖层：如果用户绑定了天元历法 / HA calendar / datetime 等实体，
// 把它的 attributes 拆解成 AlmanacCard 可直接使用的 override 字段。
// AlmanacCard 自身会用 lunar-javascript 算月历，这里只提供可选覆盖（零实体也能跑）。
// 天元历法集成常见 attributes：yi / ji / ji_shen / xiong_sha / chong / sha / good_fortune / bad_fortune ……
// 因为集成字段名可能变化，我们用启发式匹配（别名字典）+ 兜底 rawAttributes。
const ALMANAC_KEY_ALIASES = [
  // 宜忌
  ['yi', ['yi', 'suitable', 'favorable', 'good_fortune', 'good_activities']],
  ['ji', ['ji', 'avoid', 'unfavorable', 'bad_fortune', 'bad_activities']],
  ['jiShen', ['ji_shen', 'jishen', 'auspicious_gods', 'good_gods', '吉神']],
  ['xiongSha', ['xiong_sha', 'xiongsha', 'inauspicious', 'bad_gods', '凶煞']],
  ['chongSha', ['chong_sha', 'chongsha', '冲煞']],
]
function almanacData(entity) {
  const out = { yiOverride: '', jiOverride: '', jiShenOverride: '', xiongShaOverride: '', chongShaOverride: '', rawAttributes: {} }
  if (!entity || !entity.attributes) return out
  const attrs = entity.attributes
  out.rawAttributes = attrs
  for (const [target, aliases] of ALMANAC_KEY_ALIASES) {
    for (const a of aliases) {
      if (attrs[a] !== undefined && attrs[a] !== null && String(attrs[a]).trim()) {
        // 兼容 array / string 两种形态（HA 集成可能返回数组或分隔字符串）
        out[target] = Array.isArray(attrs[a]) ? attrs[a].join('、') : String(attrs[a])
        break
      }
    }
  }
  return out
}

// 基础卡默认头部图标（可被卡片自定义图标 card.icon 覆盖）
const DEF_GLYPH = {
  greeting: 'home', weather: 'partly_cloudy_day',
  clock: 'av_timer', flipclock: 'flip', amapweather: 'weather', date: 'calendar_month', overview: 'devices',
}

// ================= 分发 =================
export function computeData(type, ctx) {
  const { all, hasData, entity, entities } = ctx
  let d
  switch (type) {
    case 'greeting': d = greetingData(ctx); break
    case 'weather': d = weatherData(ctx); break
    case 'map': d = {}; break
    case 'amapweather': d = {}; break
    case 'toggle': d = toggleData(resolveToggleEntity(ctx), hasData); break
    case 'clock': d = clockData(ctx.now); break
    case 'flipclock': d = flipClockData(ctx.now); break
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
    case 'personInfo': d = personInfoData(ctx); break
    case 'group': d = groupData(entities && entities.length ? entities : (entity ? [entity] : []), hasData, ctx.card); break
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
    case 'almanac': d = almanacData(entity); break
    // 生日 / 生日倒计时：数据全部由 BirthdayCard 组件自行读取 prefs（birthdays）
    case 'birthday': case 'birthdayCountdown': d = {}; break
    case 'custom': d = {}; break
    default: d = genericData(entities && entities.length ? entities : (entity ? [entity] : []), hasData, ctx.card); break
  }
  // 基础卡头部图标默认值（领域卡的 base() 已自带 glyph，不会被覆盖）
  if (d && typeof d === 'object' && !d.glyph && DEF_GLYPH[type]) d.glyph = DEF_GLYPH[type]
  return d
}

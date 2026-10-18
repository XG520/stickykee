// 卡片默认代码模板与注册表 —— 「独立自包含」+「高可扩展性」的基础。
// 每张卡片由三段代码驱动（html/css/js），编辑弹窗完整展示并可修改：
//  - html：DOM 结构，用 {{占位符}} 绑定动态数据（值由 data.js 计算）
//  - css ：卡片样式，以 #card-xxx / #preview-xxx 作用域注入，不泄漏到其他卡片
//  - js  ：渲染后执行的逻辑，参数 (el, card, data)
import {
  tplToggle, tplSensor, tplBinary, tplClimate, tplCover, tplMedia, tplSecurity, tplCamera,
  tplVacuum, tplAction, tplGeneric, tplPerson, tplWeatherEntity, tplSelect, tplText, tplGroup,
  tplDatetime, tplTimer, tplCalendar, tplUpdate, tplEvent, tplPlant, tplLawnMower, tplSun,
  tplImage, tplGreeting, tplWeather, tplMap, tplClock, tplFlipClock, tplDate, tplOverview, JS_COMMON, JS_FLIP_CLOCK, tplAmapWeather, JS_AMAP_WEATHER,
} from './templates'

export { computeData } from './data'

// 组装：元信息 + 默认三栏代码
function mk(meta, tplFn) {
  const { html, css } = tplFn()
  return { ...meta, html, css, js: JS_COMMON }
}

// ================= 卡片注册表（36 个类型） =================
// 领域卡保持原有 24+ 领域不变；基础卡：问候 / 天气 / 地图 / 开关 / 时钟 / 日期 / 设备概览。
export const cardDefaults = {
  // ---- 基础仪表盘卡（默认布局，无需绑定实体） ----
  greeting: mk({ label: '问候', icon: 'home', colorCls: 'text-primary', w: 1, h: 1, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplGreeting),
  // entityOptional：可不绑定实体（未指定时自动取第一个 weather 实体），也可在属性面板手动指定来源实体
  weather: mk({ label: '天气', icon: 'partly_cloudy_day', colorCls: 'text-info', w: 2, h: 2, needEntity: false, entityOptional: true, entityDomains: ['weather'], group: '基础仪表盘' }, tplWeather),
  map: mk({ label: '地图', icon: 'map', colorCls: 'text-accent', w: 4, h: 2, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplMap),
  // 基础开关：未指定实体时自动取第一个开关类实体，也可在属性面板手动指定
  toggle: mk({ label: '开关', icon: 'toggle_on', colorCls: 'text-primary', w: 1, h: 1, needEntity: false, entityOptional: true, entityDomains: ['switch', 'light', 'plug', 'valve', 'input_boolean', 'fan', 'humidifier', 'group', 'remote', 'siren'], group: '基础仪表盘' }, tplToggle),
  clock: mk({ label: '时钟', icon: 'av_timer', colorCls: 'text-info', w: 1, h: 1, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplClock),
  // 翻页时钟：默认 js 为翻页驱动逻辑（用户可改），其余同 mk 组装
  flipclock: { ...mk({ label: '翻页时钟', icon: 'flip', colorCls: 'text-info', w: 2, h: 1, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplFlipClock), js: JS_FLIP_CLOCK },
  // 高德天气：app 级卡片，用实例配置的高德 Key 查询（不依赖 HA 天气实体）
  amapweather: { ...mk({ label: '高德天气', icon: 'weather', colorCls: 'text-info', w: 1, h: 2, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplAmapWeather), js: JS_AMAP_WEATHER },
  date: mk({ label: '日期', icon: 'calendar_month', colorCls: 'text-warning', w: 1, h: 1, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplDate),
  overview: mk({ label: '设备概览', icon: 'devices', colorCls: 'text-success', w: 2, h: 1, needEntity: false, entityDomains: null, group: '基础仪表盘' }, tplOverview),

  // ---- HA 领域卡片（needEntity：需绑定一个实体；entityDomains 限定可选域） ----
  light: mk({ label: '灯光', icon: 'lightbulb', colorCls: 'text-warning', w: 1, h: 1, needEntity: true, entityDomains: ['light'], group: '开关设备' }, tplToggle),
  switch: mk({ label: '开关', icon: 'toggle_on', colorCls: 'text-primary', w: 1, h: 1, needEntity: true, entityDomains: ['switch', 'plug', 'valve', 'group', 'remote', 'siren'], group: '开关设备' }, tplToggle),
  fan: mk({ label: '风扇', icon: 'mode_fan', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['fan', 'humidifier'], group: '开关设备' }, tplToggle),
  input_boolean: mk({ label: '辅助开关', icon: 'check_circle', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['input_boolean'], group: '开关设备' }, tplToggle),
  sensor: mk({ label: '传感器', icon: 'sensors', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['sensor', 'number', 'input_number', 'counter'], group: '传感器' }, tplSensor),
  binary_sensor: mk({ label: '二值传感器', icon: 'sensors', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['binary_sensor'], group: '传感器' }, tplBinary),
  climate: mk({ label: '空调/恒温', icon: 'thermostat', colorCls: 'text-info', w: 1, h: 2, needEntity: true, entityDomains: ['climate', 'water_heater', 'humidifier'], group: '环境气候' }, tplClimate),
  cover: mk({ label: '窗帘', icon: 'curtains', colorCls: 'text-warning', w: 1, h: 1, needEntity: true, entityDomains: ['cover'], group: '门窗窗帘' }, tplCover),
  media_player: mk({ label: '媒体播放', icon: 'tv', colorCls: 'text-accent', w: 1, h: 2, needEntity: true, entityDomains: ['media_player'], group: '影音媒体' }, tplMedia),
  lock: mk({ label: '门锁', icon: 'lock', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['lock'], group: '安防' }, tplSecurity),
  alarm_control_panel: mk({ label: '报警面板', icon: 'shield', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['alarm_control_panel'], group: '安防' }, tplSecurity),
  camera: mk({ label: '摄像头', icon: 'videocam', colorCls: 'text-accent', w: 2, h: 2, needEntity: true, entityDomains: ['camera'], group: '安防' }, tplCamera),
  vacuum: mk({ label: '扫地机', icon: 'robot', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['vacuum'], group: '清洁' }, tplVacuum),
  scene: mk({ label: '场景', icon: 'magic_button', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['scene'], group: '场景' }, tplAction),
  script: mk({ label: '脚本/自动化', icon: 'terminal', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['script', 'automation', 'button', 'input_button'], group: '场景' }, tplAction),
  person: mk({ label: '人员位置', icon: 'person_pin', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['person', 'device_tracker', 'zone', 'geocoded_location', 'sensor'], group: '人员' }, tplPerson),
  weather_entity: mk({ label: '天气实体', icon: 'partly_cloudy_day', colorCls: 'text-info', w: 2, h: 2, needEntity: true, entityDomains: ['weather'], group: '环境气候' }, tplWeatherEntity),
  sun: mk({ label: '太阳', icon: 'wb_sunny', colorCls: 'text-warning', w: 1, h: 1, needEntity: true, entityDomains: ['sun'], group: '环境气候' }, tplSun),
  select: mk({ label: '选项选择', icon: 'arrow_drop_down_circle', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['select', 'input_select'], group: '输入控制' }, tplSelect),
  text: mk({ label: '文本', icon: 'text_fields', colorCls: 'text-muted', w: 1, h: 1, needEntity: true, entityDomains: ['text', 'input_text'], group: '输入控制' }, tplText),
  datetime: mk({ label: '日期时间', icon: 'calendar_today', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['date', 'datetime', 'time', 'input_datetime'], group: '输入控制' }, tplDatetime),
  timer: mk({ label: '计时器', icon: 'timer', colorCls: 'text-warning', w: 1, h: 1, needEntity: true, entityDomains: ['timer'], group: '输入控制' }, tplTimer),
  calendar: mk({ label: '日历', icon: 'calendar_month', colorCls: 'text-info', w: 1, h: 2, needEntity: true, entityDomains: ['calendar'], group: '其他' }, tplCalendar),
  update: mk({ label: '固件更新', icon: 'system_update', colorCls: 'text-warning', w: 1, h: 1, needEntity: true, entityDomains: ['update'], group: '其他' }, tplUpdate),
  event: mk({ label: '事件', icon: 'event', colorCls: 'text-info', w: 1, h: 1, needEntity: true, entityDomains: ['event'], group: '其他' }, tplEvent),
  plant: mk({ label: '植物', icon: 'spa', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['plant'], group: '其他' }, tplPlant),
  image: mk({ label: '图片', icon: 'image', colorCls: 'text-accent', w: 2, h: 2, needEntity: true, entityDomains: ['image'], group: '其他' }, tplImage),
  lawn_mower: mk({ label: '割草机', icon: 'yard', colorCls: 'text-success', w: 1, h: 1, needEntity: true, entityDomains: ['lawn_mower'], group: '清洁' }, tplLawnMower),
  generic: mk({ label: '通用卡片', icon: 'widgets', colorCls: 'text-accent', w: 2, h: 2, needEntity: true, entityDomains: null, group: '通用' }, tplGeneric),
  // 实体组：一个组（如「卧室」）装该组全部设备，卡面即设备列表，点开弹窗集中控制
  group: mk({ label: '实体组', icon: 'group_work', colorCls: 'text-primary', w: 2, h: 2, needEntity: true, entityDomains: null, group: '通用' }, tplGroup),
}

// ================= 占位符渲染 =================
// 把 {{key}} 替换为数据对象中的值；缺失的占位符原样保留。
export function renderTemplate(html, data) {
  return String(html || '').replace(/\{\{(\w+)\}\}/g, (m, k) =>
    data[k] !== undefined && data[k] !== null ? String(data[k]) : m)
}

// 把用户 CSS 作用到指定容器：#card-xxx 或 #preview-xxx。
// 普通规则加作用域前缀；@keyframes 整块原样保留——否则步进选择器 from/to/0%
// 会被「}选择器{」规则误加前缀，整个动画声明非法导致翻页等动画失效。
export function scopeCss(css, holderSel) {
  try {
    let s = String(css || '')
    const frames = []
    // 先摘出 @keyframes 整块（含嵌套的步进规则），用占位符顶替，作用域化后再还原
    s = s.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})+\s*\}/g, (m) => {
      frames.push(m)
      return `\u0000${frames.length - 1}\u0000`
    })
    s = s.replace(/(^|})([^@][^{}]*?)\{/g, (_, pre, sel) => {
      const scoped = sel.split(',').map((x) => `${holderSel} ${x.trim()}`).join(',')
      return `${pre}${scoped} {`
    })
    return s.replace(/\u0000(\d+)\u0000/g, (_, n) => frames[+n])
  } catch {
    return css
  }
}

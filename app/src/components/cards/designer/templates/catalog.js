// 精品模板 catalog：12 个开箱即美的卡片模板（schema v2 + 角色槽 roles）。
// 视觉语言与 SHELL_BASE 一致：--hc 变量、外壳 14px/内层 10px 圆角、
// 标题 13-16px/600、数值 14-16px/700、辅助 10-12px。
// 实体一律不写死：元素 props.role 指向 roles.key，套用时映射真实实体。
import { ELEMENT_DEFS } from '../elementDefs'
import { SHELL_BASE } from '@/components/cards/templates'
import { DESIGNER_EXTRA_CSS } from '../blockDefs'
import { scopeCss } from '@/components/cards/defaults'

// —— 元素简写（props 稀疏即可，applyTemplate/画廊渲染前会与 ELEMENT_DEFS 默认值合并） ——
let _n = 0
const el = (type, x, y, w, h, props = {}) => ({ id: `t${++_n}`, type, x, y, w, h, rotate: 0, props })
const G = 120 // 1 格 = 120px 设计基准

// 与元素默认值合并（entity 的 show* 开关等缺省值在 ELEMENT_DEFS 里，稀疏模板靠它补全）
export function normalizeTemplateSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema))
  s.version = 2
  for (const e of s.elements) {
    const def = ELEMENT_DEFS[e.type]
    if (def) e.props = { ...JSON.parse(JSON.stringify(def.defaultProps)), ...(e.props || {}) }
  }
  return s
}

// —— 12 个精品模板 ——
// roles: key 被元素 props.role 引用；domains 用于绑定时过滤实体；mock* 供画廊缩略图假数据
export const TEMPLATE_CATALOG = [
  {
    id: 'env-overview', name: '环境总览', icon: 'thermostat', category: '环境', grid: { w: 2, h: 2 },
    roles: [
      { key: 'temp', label: '温度传感器', domains: ['sensor'], required: true, mockName: '客厅温度', mockState: '23.5', mockUnit: '°C', mockIcon: 'thermometer' },
      { key: 'humi', label: '湿度传感器', domains: ['sensor'], required: true, mockName: '湿度', mockState: '48', mockUnit: '%', mockIcon: 'humidity_percentage' },
      { key: 'co2', label: 'CO₂（可选）', domains: ['sensor'], required: false, mockName: 'CO₂', mockState: '612', mockUnit: 'ppm', mockIcon: 'co2' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 2 * G },
      elements: [
        el('text', 16, 12, 120, 18, { text: '室内环境', fontSize: 13, weight: 600 }),
        el('icon', 198, 12, 24, 24, { icon: 'eco', fontSize: 20 }),
        el('entity', 16, 44, 130, 40, { role: 'temp', showIcon: false, showName: false, fontSize: 26, color: 'var(--hc-color, var(--hc-primary))' }),
        el('entity', 150, 44, 80, 18, { role: 'humi', showName: false, fontSize: 11 }),
        el('entity', 150, 68, 80, 18, { role: 'co2', showName: false, fontSize: 11 }),
        el('rect', 12, 100, 216, 1, { background: 'var(--hc-border)', radius: 0, borderWidth: 0, opacity: 0.5 }),
        el('rect', 12, 112, 104, 116, { background: 'var(--hc-bg)', radius: 10, borderWidth: 0, opacity: 0.6 }),
        el('icon', 24, 128, 28, 28, { icon: 'air', fontSize: 22 }),
        el('text', 24, 162, 80, 16, { text: '通风建议', fontSize: 10, color: 'var(--hc-sub)' }),
        el('text', 24, 182, 80, 32, { text: '午间开窗 20 分钟', fontSize: 11, weight: 500 }),
        el('rect', 124, 112, 104, 116, { background: 'var(--hc-bg)', radius: 10, borderWidth: 0, opacity: 0.6 }),
        el('icon', 136, 128, 28, 28, { icon: 'wb_sunny', fontSize: 22 }),
        el('text', 136, 162, 80, 16, { text: '体感', fontSize: 10, color: 'var(--hc-sub)' }),
        el('text', 136, 182, 80, 32, { text: '舒适', fontSize: 14, weight: 700 }),
      ],
    },
  },
  {
    id: 'climate-room', name: '客厅温控', icon: 'ac_unit', category: '环境', grid: { w: 2, h: 1 },
    roles: [
      { key: 'ac', label: '空调', domains: ['climate'], required: true, mockName: '客厅空调', mockState: '24.5', mockUnit: '°C', mockIcon: 'air_conditioner' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('icon', 16, 18, 30, 30, { icon: 'ac_unit', fontSize: 26 }),
        el('text', 54, 20, 110, 16, { text: '客厅空调', fontSize: 13, weight: 600 }),
        el('text', 54, 40, 110, 14, { text: '制冷 · 风速自动', fontSize: 10, color: 'var(--hc-sub)' }),
        el('entity', 16, 62, 140, 38, { role: 'ac', showIcon: false, showName: false, fontSize: 24, color: 'var(--hc-color, var(--hc-primary))' }),
        el('button', 186, 30, 40, 40, { glyph: 'power_settings_new', action: 'toggle', role: 'ac' }),
        el('text', 178, 76, 56, 14, { text: '开关', fontSize: 9, color: 'var(--hc-sub)', align: 'center' }),
      ],
    },
  },
  {
    id: 'light-main', name: '照明场景', icon: 'lightbulb', category: '照明', grid: { w: 2, h: 1 },
    roles: [
      { key: 'lamp', label: '主灯', domains: ['light'], required: true, mockName: '客厅主灯', mockState: 'on', mockIcon: 'lightbulb' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('rect', 14, 16, 56, 56, { background: 'color-mix(in srgb, var(--hc-primary) 18%, transparent)', radius: 99, borderWidth: 0 }),
        el('icon', 26, 28, 32, 32, { icon: 'lightbulb', fontSize: 26, color: 'var(--hc-color, var(--hc-primary))' }),
        el('entity', 84, 22, 110, 20, { role: 'lamp', showIcon: false, fontSize: 13 }),
        el('text', 84, 46, 110, 14, { text: '亮度 80% · 暖光', fontSize: 10, color: 'var(--hc-sub)' }),
        el('button', 188, 24, 40, 40, { glyph: 'power_settings_new', action: 'toggle', role: 'lamp' }),
      ],
    },
  },
  {
    id: 'lights-4', name: '四路灯光', icon: 'light_group', category: '照明', grid: { w: 2, h: 2 },
    roles: [1, 2, 3, 4].map((i) => ({
      key: `l${i}`, label: `灯 ${i}`, domains: ['light'], required: i <= 2,
      mockName: ['客厅灯', '餐厅灯', '卧室灯', '书房灯'][i - 1], mockState: i % 2 ? 'on' : 'off', mockIcon: 'lightbulb',
    })),
    schema: {
      canvas: { w: 2 * G, h: 2 * G },
      elements: [0, 1, 2, 3].flatMap((i) => {
        const x = 12 + (i % 2) * 112
        const y = 12 + Math.floor(i / 2) * 112
        return [
          el('rect', x, y, 104, 104, { background: 'var(--hc-bg)', radius: 10, borderWidth: 0, opacity: 0.6 }),
          el('icon', x + 12, y + 12, 26, 26, { icon: 'lightbulb', fontSize: 22 }),
          el('entity', x + 12, y + 46, 80, 16, { role: `l${i + 1}`, showIcon: false, showState: false, showUnit: false, fontSize: 11 }),
          el('entity', x + 12, y + 66, 80, 14, { role: `l${i + 1}`, showIcon: false, showName: false, showUnit: false, fontSize: 10, color: 'var(--hc-sub)' }),
          el('button', x + 62, y + 12, 30, 30, { glyph: 'power_settings_new', action: 'toggle', role: `l${i + 1}` }),
        ]
      }),
    },
  },
  {
    id: 'lock-door', name: '安防门锁', icon: 'lock', category: '安防', grid: { w: 2, h: 1 },
    roles: [
      { key: 'door', label: '门锁', domains: ['lock'], required: true, mockName: '入户门', mockState: 'locked', mockIcon: 'lock' },
      { key: 'contact', label: '门磁（可选）', domains: ['binary_sensor'], required: false, mockName: '门已关好', mockState: 'off', mockIcon: 'door_sensor' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('rect', 14, 16, 56, 56, { background: 'color-mix(in srgb, var(--hc-primary) 18%, transparent)', radius: 99, borderWidth: 0 }),
        el('icon', 26, 28, 32, 32, { icon: 'lock', fontSize: 26, color: 'var(--hc-color, var(--hc-primary))' }),
        el('entity', 84, 24, 110, 20, { role: 'door', showIcon: false, fontSize: 13 }),
        el('entity', 84, 48, 120, 14, { role: 'contact', showIcon: false, fontSize: 10, color: 'var(--hc-sub)' }),
        el('button', 188, 24, 40, 40, { glyph: 'lock_open', action: 'toggle', role: 'door' }),
      ],
    },
  },
  {
    id: 'camera-snap', name: '摄像头快照', icon: 'videocam', category: '安防', grid: { w: 2, h: 2 },
    roles: [
      { key: 'cam', label: '摄像头', domains: ['camera'], required: true, mockName: '门口摄像头', mockState: 'idle', mockIcon: 'video_camera' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 2 * G },
      elements: [
        el('image', 0, 0, 240, 240, { url: '', fit: 'cover', radius: 14 }),
        el('rect', 0, 180, 240, 60, { background: 'linear-gradient(transparent, rgb(0 0 0 / .55))', radius: 0, borderWidth: 0 }),
        el('icon', 14, 196, 22, 22, { icon: 'videocam', fontSize: 18, color: '#fff' }),
        el('entity', 42, 196, 150, 20, { role: 'cam', showIcon: false, showState: false, showUnit: false, fontSize: 12, color: '#fff' }),
        el('rect', 186, 14, 42, 18, { background: 'rgb(0 0 0 / .45)', radius: 99, borderWidth: 0 }),
        el('text', 186, 16, 42, 14, { text: 'LIVE', fontSize: 9, color: '#ff5c5c', align: 'center', weight: 700 }),
      ],
    },
  },
  {
    id: 'media-player', name: '媒体播放', icon: 'play_circle', category: '媒体', grid: { w: 2, h: 1 },
    roles: [
      { key: 'player', label: '播放器', domains: ['media_player'], required: true, mockName: '客厅音箱', mockState: 'playing', mockIcon: 'speaker' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('image', 14, 16, 56, 56, { url: '', fit: 'cover', radius: 10 }),
        el('entity', 82, 22, 116, 18, { role: 'player', showIcon: false, fontSize: 12 }),
        el('text', 82, 44, 116, 14, { text: '未在播放', fontSize: 10, color: 'var(--hc-sub)' }),
        el('button', 154, 66, 32, 32, { glyph: 'skip_previous', action: 'none' }),
        el('button', 196, 28, 40, 40, { glyph: 'play_arrow', action: 'toggle', role: 'player' }),
      ],
    },
  },
  {
    id: 'curtain', name: '窗帘控制', icon: 'blinds', category: '场景', grid: { w: 2, h: 1 },
    roles: [
      { key: 'curtain', label: '窗帘', domains: ['cover'], required: true, mockName: '主卧窗帘', mockState: 'open', mockIcon: 'blinds' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('icon', 16, 16, 28, 28, { icon: 'blinds', fontSize: 24 }),
        el('entity', 52, 18, 120, 20, { role: 'curtain', showIcon: false, fontSize: 13 }),
        el('rect', 16, 58, 168, 6, { background: 'var(--hc-bg2)', radius: 3, borderWidth: 0 }),
        el('rect', 16, 58, 110, 6, { background: 'var(--hc-color, var(--hc-primary))', radius: 3, borderWidth: 0 }),
        el('text', 16, 72, 80, 14, { text: '开合 65%', fontSize: 10, color: 'var(--hc-sub)' }),
        el('button', 194, 30, 36, 36, { glyph: 'swap_vert', action: 'toggle', role: 'curtain' }),
      ],
    },
  },
  {
    id: 'energy', name: '能耗仪表', icon: 'bolt', category: '能耗', grid: { w: 2, h: 2 },
    roles: [
      { key: 'power', label: '当前功率', domains: ['sensor'], required: true, mockName: '功率', mockState: '486', mockUnit: 'W', mockIcon: 'flash_on' },
      { key: 'today', label: '今日电量', domains: ['sensor'], required: true, mockName: '今日', mockState: '6.2', mockUnit: 'kWh', mockIcon: 'counter' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 2 * G },
      elements: [
        el('text', 16, 12, 120, 18, { text: '家庭能耗', fontSize: 13, weight: 600 }),
        el('icon', 200, 12, 22, 22, { icon: 'bolt', fontSize: 18 }),
        el('rect', 12, 40, 104, 120, { background: 'var(--hc-bg)', radius: 10, borderWidth: 0, opacity: 0.6 }),
        el('text', 24, 52, 80, 14, { text: '当前功率', fontSize: 10, color: 'var(--hc-sub)' }),
        el('entity', 24, 72, 84, 30, { role: 'power', showIcon: false, showName: false, fontSize: 20, color: 'var(--hc-color, var(--hc-primary))' }),
        el('icon', 24, 118, 60, 30, { icon: 'show_chart', fontSize: 26, color: 'var(--hc-sub)' }),
        el('rect', 124, 40, 104, 120, { background: 'var(--hc-bg)', radius: 10, borderWidth: 0, opacity: 0.6 }),
        el('text', 136, 52, 80, 14, { text: '今日用电', fontSize: 10, color: 'var(--hc-sub)' }),
        el('entity', 136, 72, 84, 30, { role: 'today', showIcon: false, showName: false, fontSize: 20, color: 'var(--hc-color, var(--hc-primary))' }),
        el('text', 136, 122, 84, 14, { text: '较昨日 ↓ 8%', fontSize: 10, color: 'var(--hc-sub)' }),
        el('rect', 12, 172, 216, 56, { background: 'color-mix(in srgb, var(--hc-primary) 10%, transparent)', radius: 10, borderWidth: 0 }),
        el('icon', 26, 186, 26, 26, { icon: 'tips_and_updates', fontSize: 20, color: 'var(--hc-color, var(--hc-primary))' }),
        el('text', 62, 184, 150, 16, { text: '用电高峰在 20:00 前后', fontSize: 11, weight: 500 }),
        el('text', 62, 202, 150, 14, { text: '建议错峰开启热水器', fontSize: 10, color: 'var(--hc-sub)' }),
      ],
    },
  },
  {
    id: 'weather-tomorrow', name: '天气明日', icon: 'wb_sunny', category: '环境', grid: { w: 2, h: 1 },
    roles: [
      { key: 'weather', label: '天气', domains: ['weather'], required: true, mockName: '明天 · 晴转多云', mockState: 'sunny', mockIcon: 'weather_sunny' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('icon', 18, 20, 40, 40, { icon: 'partly_cloudy_day', fontSize: 34, color: 'var(--hc-color, var(--hc-primary))' }),
        el('entity', 70, 22, 140, 20, { role: 'weather', showIcon: false, showState: false, showUnit: false, fontSize: 13 }),
        el('text', 70, 46, 150, 16, { text: '18° ~ 26° · 东南风 3 级', fontSize: 11, color: 'var(--hc-sub)' }),
        el('text', 70, 68, 150, 14, { text: '适合开窗通风', fontSize: 10, color: 'var(--hc-sub)' }),
      ],
    },
  },
  {
    id: 'air-purifier', name: '新风空净', icon: 'air', category: '环境', grid: { w: 2, h: 2 },
    roles: [
      { key: 'fan', label: '空净/新风机', domains: ['fan'], required: true, mockName: '客厅空净', mockState: 'on', mockIcon: 'air_purifier' },
      { key: 'pm', label: 'PM2.5 传感器', domains: ['sensor'], required: true, mockName: 'PM2.5', mockState: '12', mockUnit: 'µg/m³', mockIcon: 'grain' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 2 * G },
      elements: [
        el('text', 16, 12, 100, 18, { text: '空气质量', fontSize: 13, weight: 600 }),
        el('rect', 16, 38, 64, 22, { background: 'color-mix(in srgb, var(--hc-primary) 18%, transparent)', radius: 99, borderWidth: 0 }),
        el('text', 16, 42, 64, 14, { text: '自动模式', fontSize: 10, align: 'center', color: 'var(--hc-color, var(--hc-primary))', weight: 600 }),
        el('entity', 16, 78, 150, 36, { role: 'pm', showIcon: false, showName: false, fontSize: 24, color: 'var(--hc-color, var(--hc-primary))' }),
        el('text', 16, 118, 100, 14, { text: 'PM2.5 · 优', fontSize: 10, color: 'var(--hc-sub)' }),
        el('rect', 12, 148, 216, 1, { background: 'var(--hc-border)', radius: 0, borderWidth: 0, opacity: 0.5 }),
        el('entity', 16, 162, 150, 20, { role: 'fan', showIcon: true, fontSize: 12 }),
        el('text', 16, 188, 150, 14, { text: '滤芯剩余 82%', fontSize: 10, color: 'var(--hc-sub)' }),
        el('button', 186, 20, 38, 38, { glyph: 'power_settings_new', action: 'toggle', role: 'fan' }),
      ],
    },
  },
  {
    id: 'scene-away', name: '离家模式', icon: 'logout', category: '场景', grid: { w: 2, h: 1 },
    roles: [
      { key: 'scene', label: '场景/脚本', domains: ['scene', 'script'], required: true, mockName: '离家模式', mockState: 'off', mockIcon: 'logout' },
    ],
    schema: {
      canvas: { w: 2 * G, h: 1 * G },
      elements: [
        el('rect', 14, 16, 56, 56, { background: 'color-mix(in srgb, var(--hc-primary) 18%, transparent)', radius: 99, borderWidth: 0 }),
        el('icon', 26, 28, 32, 32, { icon: 'logout', fontSize: 26, color: 'var(--hc-color, var(--hc-primary))' }),
        el('text', 84, 26, 120, 18, { text: '离家模式', fontSize: 14, weight: 600 }),
        el('text', 84, 48, 130, 14, { text: '一键关闭全屋灯光与空调', fontSize: 10, color: 'var(--hc-sub)' }),
        el('button', 190, 26, 40, 40, { text: '执行', action: 'toggle', role: 'scene' }),
      ],
    },
  },
]

export const TEMPLATE_CATEGORIES = ['全部', '环境', '照明', '安防', '媒体', '能耗', '场景', '我的模板']

// —— 设计器/画廊缩略图所需的作用域样式（SHELL_BASE + 设计器附加），只注入一次 ——
// 画布预览(.hc-fc-stage)与画廊缩略图(.hc-tg-thumb)内的 .hc 产物共用同一份壳层样式。
let _cssInjected = false
export function ensureDesignerCss() {
  if (_cssInjected || typeof document === 'undefined') return
  _cssInjected = true
  const tag = document.createElement('style')
  tag.id = 'hc-designer-css'
  tag.textContent =
    scopeCss(SHELL_BASE + DESIGNER_EXTRA_CSS, '.hc-fc-stage') + '\n' +
    scopeCss(SHELL_BASE + DESIGNER_EXTRA_CSS, '.hc-tg-thumb')
  document.head.appendChild(tag)
}

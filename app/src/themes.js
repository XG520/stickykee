// ---- 主题系统（Tailwind 官方 class 切换方案，同 shadcn 风格） ----
// 各预设主题的完整 CSS 变量集 + 背景装饰层静态定义在 assets/main.css 中，
// 切换主题 = 在 <html> 上增删 .theme-<key> 类，CSS 层面即时生效，不依赖 JS 注入。
// 自定义主题（key='custom'）无静态类，运行时把派生后的完整变量集 inline 写到 <html> 上。
// 主题 key 与 main.css 中 .theme-<key> 一一对应，新增主题时两处需同步。

export const THEMES = {
  default: { key: 'default', name: '默认', desc: '简约纯色 · 琥珀暖光', swatches: ['#F5A623', '#5EC4B0', '#14151A'] },
  china: { key: 'china', name: '中国风', desc: '朱砂鎏金 · 水墨雅韵', swatches: ['#C6392C', '#D4AF37', '#110D0B'] },
  aurora: { key: 'aurora', name: '极光', desc: '渐变色彩 · 紫青夜穹', swatches: ['#5EEAD4', '#A78BFA', '#0D1128'] },
  forest: { key: 'forest', name: '森林', desc: '自然风景 · 苔藓暖光', swatches: ['#6E9E7A', '#C4A860', '#0B130E'] },
  geo: { key: 'geo', name: '几何', desc: '孟菲斯撞色 · 几何构成', swatches: ['#F06A40', '#4C76F6', '#0F0F18'] },
  tech: { key: 'tech', name: '科技', desc: '深空霓虹 · 精密网格', swatches: ['#2DD4EC', '#9361F6', '#050A14'] },
  retro: { key: 'retro', name: '旧时光', desc: '旧日纸感 · 米黄噪点', swatches: ['#D97706', '#B05C2E', '#F8F2E6'] },
  autumn: { key: 'autumn', name: '秋日', desc: '枫叶橙红 · 暖金斜阳', swatches: ['#E86A36', '#F5B842', '#160E0A'] },
  festive: { key: 'festive', name: '节日', desc: '绯红鎏金 · 丝绒质感', swatches: ['#E24C5C', '#E8B23A', '#180A0E'] },
  custom: { key: 'custom', name: '自定义', desc: '完整调色板 · 专属主题', swatches: ['#F5A623', '#5EC4B0', '#0E0F12'] },
}

const ALL_THEME_KEYS = Object.keys(THEMES)

// 自定义主题的 11 个可调色项（设置页调色板按此渲染）
export const CUSTOM_COLOR_KEYS = [
  { key: 'primary', label: '主色', desc: '按钮 · 高亮 · 选中' },
  { key: 'background', label: '背景', desc: '页面底色' },
  { key: 'surface', label: '卡片表面', desc: '卡片与面板底色' },
  { key: 'onSurface', label: '正文文字', desc: '主要文字颜色' },
  { key: 'muted', label: '次要文字', desc: '辅助说明文字' },
  { key: 'border', label: '边框', desc: '卡片与输入框描边' },
  { key: 'accent', label: '强调色', desc: '图标与点缀' },
  { key: 'success', label: '成功', desc: '正常 · 已连接' },
  { key: 'warning', label: '警告', desc: '注意 · 提示' },
  { key: 'error', label: '错误', desc: '故障 · 危险' },
  { key: 'info', label: '信息', desc: '信息提示' },
]

// 自定义主题的默认调色板（以默认主题为基准）
export const DEFAULT_CUSTOM_COLORS = {
  primary: '#F5A623',
  background: '#0E0F12',
  surface: '#1A1B1E',
  onSurface: '#E8E5DD',
  muted: '#8A8986',
  border: '#2E2F33',
  accent: '#5EC4B0',
  success: '#5EC4B0',
  warning: '#E8A84C',
  error: '#E85D4C',
  info: '#6BA3D9',
}

function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n) || h.length !== 6) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lighten(rgb, pct) {
  return rgb.map((c) => Math.round(c + (255 - c) * pct))
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function luminance(rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
}

// 自定义主题涉及的 inline 变量（切换回预设主题时必须全部清除）
const CUSTOM_VARS = [
  '--c-primary', '--c-primary-hover', '--c-on-primary', '--c-background',
  '--c-surface', '--c-surface-alt', '--c-surface-hover', '--c-on-background',
  '--c-on-surface', '--c-muted', '--c-faint', '--c-border', '--c-border-focus',
  '--c-accent', '--c-error', '--c-warning', '--c-success', '--c-info',
]

// 由用户调色板派生完整 19 变量：缺失项自动按亮度/混合推导，保证任意配色下界面可读
function deriveCustomVars(c) {
  const pick = (k) => hexToRgb(c[k]) || hexToRgb(DEFAULT_CUSTOM_COLORS[k])
  const primary = pick('primary')
  const background = pick('background')
  const surface = pick('surface')
  const onSurface = pick('onSurface')
  const lightPrimary = luminance(primary) > 150
  const lightBg = luminance(background) > 150
  return {
    '--c-primary': primary,
    '--c-primary-hover': lightPrimary ? mix(primary, [0, 0, 0], 0.15) : lighten(primary, 0.18),
    '--c-on-primary': lightPrimary ? [22, 20, 18] : [255, 255, 255],
    '--c-background': background,
    '--c-surface': surface,
    '--c-surface-alt': mix(surface, background, 0.4),
    '--c-surface-hover': mix(surface, primary, 0.10),
    '--c-on-background': lightBg ? [40, 38, 34] : [240, 238, 233],
    '--c-on-surface': onSurface,
    '--c-muted': pick('muted'),
    '--c-faint': mix(onSurface, background, 0.68),
    '--c-border': pick('border'),
    '--c-border-focus': primary,
    '--c-accent': pick('accent'),
    '--c-error': pick('error'),
    '--c-warning': pick('warning'),
    '--c-success': pick('success'),
    '--c-info': pick('info'),
  }
}

// ---- APK 系统栏（状态栏 + 导航栏）跟随主题 ----
// 颜色取当前主题页面底色 --c-background（RGB 通道格式 "14 15 18"）。
// 走 APK 原生注入的 window.StickyKeeNative（JavascriptInterface，对远程页同样可用），
// 不依赖 Capacitor JS 运行时（其桥只注入壳页源）。网页环境静默跳过。
function syncSystemBars() {
  try {
    const native = window.StickyKeeNative
    if (!native || typeof native.setBars !== 'function') return

    const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-background') || ''
    const channels = raw.trim().split(/\s+/).map((n) => parseInt(n, 10))
    if (channels.length < 3 || channels.slice(0, 3).some((n) => Number.isNaN(n))) return
    const [r, g, b] = channels
    const hex = '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
    const darkIcons = 0.299 * r + 0.587 * g + 0.114 * b > 150
    native.setBars(hex, darkIcons)
  } catch { /* 非 APK 环境忽略 */ }
}

// 应用主题：themeKey 为 THEMES 的键（class 切换）。
// custom 兼容两种形态：
//   1. 字符串 hex —— 预设主题上的自定义主色覆盖（旧版行为）
//   2. 颜色对象 —— 自定义主题的完整调色板
export function applyTheme(themeKey, custom) {
  const root = document.documentElement
  // 1. 清理：先移除全部 inline 变量与主题类，避免切换残留
  for (const k of CUSTOM_VARS) root.style.removeProperty(k)
  for (const k of ALL_THEME_KEYS) root.classList.remove('theme-' + k)
  if (themeKey && themeKey !== 'default' && themeKey !== 'custom') root.classList.add('theme-' + themeKey)

  const colorsObj = themeKey === 'custom' && custom && typeof custom === 'object' ? custom : null
  const customHex = typeof custom === 'string' ? custom : ''

  let cache
  if (colorsObj) {
    // 2a. 自定义主题：完整调色板 inline 写入
    const vars = deriveCustomVars(colorsObj)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v.join(' '))
    cache = { theme: 'custom', colors: { ...colorsObj } }
  } else if (customHex) {
    // 2b. 预设主题 + 自定义主色覆盖
    const rgb = hexToRgb(customHex)
    if (rgb) {
      root.style.setProperty('--c-primary', rgb.join(' '))
      root.style.setProperty('--c-border-focus', rgb.join(' '))
      root.style.setProperty('--c-primary-hover', lighten(rgb, 0.18).join(' '))
    }
    cache = { theme: themeKey || 'default', custom: customHex }
  } else {
    cache = { theme: themeKey || 'default' }
  }
  // 3. 缓存到 localStorage：主题视为设备级 UI 偏好，登录页/下次启动也生效
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch { /* 隐私模式等场景忽略 */ }

  // 4. APK：系统栏（状态栏/导航栏）同步为主题底色；网页端为空操作
  syncSystemBars()
}

const CACHE_KEY = 'hc_theme'

// 启动/登录页立即应用本地缓存主题（同步、防闪烁；后端权威值随后异步覆盖）
export function loadThemeFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return
    if (obj.theme === 'custom') {
      applyTheme('custom', obj.colors && typeof obj.colors === 'object' ? obj.colors : DEFAULT_CUSTOM_COLORS)
      return
    }
    applyTheme(
      obj.theme && obj.theme in THEMES ? obj.theme : 'default',
      typeof obj.custom === 'string' ? obj.custom : '',
    )
  } catch { /* 缓存损坏时忽略 */ }
}

// 从 prefs.theme 恢复主题状态。
// 兼容多种存储格式：
//   1. 旧版直接存主题 key：'default' / 'china' 等
//   2. 旧版自定义色：直接存 hex（'#F5A623'）
//   3. 自定义主色（任意主题下）：JSON 字符串 '{"theme":"aurora","custom":"#..."}'
//   4. 自定义主题：JSON 字符串 '{"theme":"custom","colors":{...}}'
export function resolveTheme(pref) {
  if (typeof pref === 'string') {
    try {
      const obj = JSON.parse(pref)
      if (obj && typeof obj === 'object' && obj.theme) {
        if (obj.theme === 'custom') {
          return { themeKey: 'custom', customHex: '', colors: obj.colors && typeof obj.colors === 'object' ? obj.colors : null }
        }
        return { themeKey: obj.theme in THEMES ? obj.theme : 'default', customHex: typeof obj.custom === 'string' ? obj.custom : '', colors: null }
      }
    } catch { /* 非 JSON，走下面的兼容分支 */ }
    if (pref in THEMES) return { themeKey: pref, customHex: '', colors: null }
    if (pref.startsWith('#')) return { themeKey: 'default', customHex: pref, colors: null }
  }
  return { themeKey: 'default', customHex: '', colors: null }
}

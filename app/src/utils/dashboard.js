// 仪表盘 schema：常量、卡片构造、旧数据迁移、序列化、导出 / 导入。
// user_prefs / key='dashboard' 的值始终是一个 JSON 字符串：
//   v1：顶层卡片数组 [{type,w,h,...}, ...]
//   v2：{ version: 2, pages: [{ id, name, cards: [...] }, ...] }
// HomeView（读写布局）与 MessageCenter（共享前判空）共用此模块，避免判空逻辑两处分叉。
import { cardDefaults } from '@/components/cards/defaults'
import { CTL_CSS, BORDER_CSS } from '@/components/cards/templates'

export const DASH_VERSION = 2
export const EXPORT_APP = 'lumina-home-app'
export const EXPORT_KIND = 'dashboard'

// ---- 双端独立布局键：Web 端沿用历史键 dashboard，手机端独立使用 dashboard_apk ----
// 两端各存各的，卡片排列/页结构互不影响。手机端在自身键为空时回退读 dashboard
// （升级过渡：两端从同一布局起步，随后各自独立演进）。
export const LAYOUT_KEY_WEB = 'dashboard'
export const LAYOUT_KEY_APK = 'dashboard_apk'
export function layoutKey(isApk) { return isApk ? LAYOUT_KEY_APK : LAYOUT_KEY_WEB }

// 按设备隔离的布局键：每台手机 App 独立布局，键名 dashboard_apk_<deviceId>。
// 手机端首启自身键为空时，经回退链 dashboard_apk_<deviceId> → dashboard_apk → dashboard 读取。
// 网页端代管时按选中的手机设备 ID 拼出对应键写入，该手机收到广播即热刷新。
export function layoutKeyFor(deviceId) {
  if (!deviceId) return LAYOUT_KEY_APK
  return LAYOUT_KEY_APK + '_' + deviceId
}
// 按设备隔离的列数键：手机端把本机 hc_dash_cols 同步到 dashboard_apk_cols_<deviceId>，
// 供网页端编辑器读取后按真实列数预览（无值默认 3，即手机窄屏自动列数）。
export function colsKeyFor(deviceId) {
  return 'dashboard_apk_cols_' + (deviceId || '')
}

let uidSeq = 0
function uid() { return (++uidSeq).toString(36) + Date.now().toString(36) }

// 卡片字段白名单：序列化 / 导出时统一裁剪，避免把运行时字段带进库里
const CARD_FIELDS = ['type', 'w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar', 'title']

function stripCard(card) {
  const o = {}
  for (const k of CARD_FIELDS) o[k] = card?.[k]
  return o
}

export function newPage(name, cards = []) {
  return { id: 'p_' + uid(), name: name || '首页', cards }
}

export function newCard(type, extra = {}) {
  const d = cardDefaults[type] || cardDefaults.generic
  const o = { type, uid: uid(), w: d.w, h: d.h, html: d.html, css: d.css, js: d.js, entity_id: '', entity_ids: [], icon: '', avatar: '', title: '' }
  for (const k of ['w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar', 'title']) {
    if (extra[k] !== undefined) o[k] = extra[k]
  }
  // 多实体卡（通用卡/人员位置卡）：实体列表以 entity_ids 为准，entity_id 始终同步为第一个（兼容单实体链路）
  if (type === 'generic' || type === 'person') {
    o.entity_ids = Array.isArray(o.entity_ids) ? o.entity_ids.filter(Boolean) : []
    if (!o.entity_ids.length && o.entity_id) o.entity_ids = [o.entity_id] // 旧数据迁移
  }
  return o
}

// 人员卡旧模板升级：早期模板没有「第二实体（子属性）」元素，加载时自动注入，
// 使已存在的人员卡也能显示第二个实体的图标+值（幂等，已含 h-sub 则跳过）。
export function upgradePersonCard(card) {
  if (!card || card.type !== 'person' || !card.html || card.html.includes('h-sub')) return
  card.html = String(card.html).replace(
    /(<\/div>\s*)$/,
    '\n  <div class="h-sub{{subCls}}"><span class="material-symbols-outlined h-sub-ic">{{subGlyph}}</span><span class="h-sub-v">{{subValue}}</span></div>\n$1',
  )
  card.css = (card.css || '') + '\n.h-sub{display:flex;align-items:center;justify-content:center;gap:3px;margin-top:auto}\n.h-sub.is-hide{display:none}\n.h-sub-ic{font-size:10px;color:var(--hc-color,#5EC4B0);flex-shrink:0}\n.h-sub-v{font-size:9px;font-weight:600;color:#F2F0EB;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}'
}

// 实体卡旧模板升级：早期开关卡只在「有当前值」时渲染一个滑条（{{rangeHtml}}，如灯关闭时
// 没有亮度条）。改为能力模型输出的 {{controlsHtml}}——与设备页「更多信息」面板同源，
// 属性缺失也能操作，并覆盖风扇档位/窗帘位置等更多能力（幂等，已迁移过则跳过）。
export function upgradeToggleCard(card) {
  if (!card || !card.html || !String(card.html).includes('{{rangeHtml}}')) return
  card.html = String(card.html)
    .replace(/<div class="h-row">\s*\{\{rangeHtml\}\}\s*<\/div>/g,
      '<div class="h-ctl" style="flex-direction:column;gap:3px;align-items:stretch">{{controlsHtml}}</div>')
    .replace(/\{\{rangeHtml\}\}/g, '{{controlsHtml}}')
  // 卡片 CSS 是创建时的快照，需要补上实体控件样式
  if (!String(card.css || '').includes('.h-ctl{')) card.css = (card.css || '') + CTL_CSS
}

// 卡片边框厚度补偿：仪表盘/编辑器预览都以 transform:scale 等比放大整卡，1px 边框被同步放大
// （桌面端格子约 140~230px，边框视觉 1.2~1.9px，不同屏宽下粗细不一）。视图层按实际缩放
// 把补偿值写入 --card-bw，卡片外壳 border-width 引用它后最终渲染厚度恒定 ≈1px。
// 历史 CSS 快照没有这段覆盖，加载时统一补上（幂等：已含 --card-bw 则跳过）。
export function upgradeCardBorderCss(card) {
  if (!card || !card.css || String(card.css).includes('--card-bw')) return
  card.css = (card.css || '') + BORDER_CSS
}

// 翻页时钟卡动画修复：现为「整瓣 180° 翻转」结构（.flip 面板 + .fn/.fc 前后两半，
// 参考 flipflow 实现），与旧版（两瓣分体 fcFlipA / 单瓣 roll+shd）DOM 结构不同，
// 无法字符串补丁，检测到旧快照即整体重同步为注册表最新模板（uid 等保留，幂等）。
// v3：新增中断自愈 + 翻页看门狗（主题切换/keep-alive 停用打断动画后自动恢复），
// js 含 'v3' 即为最新；旧 'v2' 快照同样整体重同步。
export function upgradeFlipClockCard(card) {
  if (!card || card.type !== 'flipclock') return
  const d = cardDefaults.flipclock
  if (!d) return
  const ok = String(card.css || '').includes('.fcd::before') && String(card.js || '').includes('v3')
  if (!ok) { card.html = d.html; card.css = d.css; card.js = d.js }
}

// 高德天气卡修复：旧版走 SDK 插件链路（CitySearch + Weather）易静默失败，且预报
// 解析取了 fc.forecasts 而非 fc.forecasts[0].casts，数据层级错误；新版改 REST API
// 直查并修正解析。检测到旧快照（js 不含 'v2'）即整体重同步（幂等）。
export function upgradeAmapWeatherCard(card) {
  if (!card || card.type !== 'amapweather') return
  const d = cardDefaults.amapweather
  if (!d) return
  if (!String(card.js || '').includes('v2')) { card.html = d.html; card.css = d.css; card.js = d.js }
}

// 天气卡重构（动态天空场景动画，小米天气式）：场景元素以 .wx-sky 容器承载，
// 旧快照没有该结构且 CSS 无法字符串补丁，检测到即整体重同步为最新模板（uid 保留，幂等）。
export function upgradeWeatherCard(card) {
  if (!card || card.type !== 'weather') return
  const d = cardDefaults.weather
  if (!d) return
  // 迁移标记：模板 js 自带 WX_VER 版本号，升级模板时同步 +1 即可（勿再累加特征字符串）
  if (!/WX_VER\s*=\s*10/.test(String(card.js || ''))) {
    card.html = d.html; card.css = d.css; card.js = d.js
    // 本版同时把尺寸统一回 2×2（4×4 为误配，用户已更正）
    card.w = 2; card.h = 2
  }
}

// 卡片数组归一化：字符串（旧的卡片类型简写）→ 卡片对象；丢弃未知类型；跑卡片级迁移。
// 幂等：已有 uid 的卡片保留原 uid，因此可安全地重复调用（load / import 共用）。
export function normalizeCards(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const src = typeof item === 'string' ? { type: item } : item
    if (!src || typeof src !== 'object') continue
    if (!cardDefaults[src.type]) continue
    const extra = {}
    for (const k of CARD_FIELDS) {
      if (k !== 'type' && src[k] !== undefined) extra[k] = src[k]
    }
    const card = newCard(src.type, extra)
    if (typeof src.uid === 'string' && src.uid) card.uid = src.uid
    out.push(card)
  }
  out.forEach(upgradePersonCard)
  out.forEach(upgradeToggleCard)
  out.forEach(upgradeFlipClockCard)
  out.forEach(upgradeAmapWeatherCard)
  out.forEach(upgradeWeatherCard)
  out.forEach(upgradeCardBorderCss)
  return out
}

export function normalizePage(p, i) {
  const page = p && typeof p === 'object' ? p : {}
  const id = typeof page.id === 'string' && page.id ? page.id : 'p_' + uid()
  const name = typeof page.name === 'string' && page.name.trim() ? page.name.trim() : `第 ${i + 1} 页`
  return { id, name, cards: normalizeCards(page.cards) }
}

// 已解析的 dashboard 值 → { pages, migrated }；无法识别返回 null。
export function migrateDashboard(raw) {
  if (Array.isArray(raw)) {
    // v1：平面卡片数组 → 单页「首页」
    return { pages: [normalizePage({ name: '首页', cards: raw }, 0)], migrated: true }
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.pages) && raw.pages.length) {
    return { pages: raw.pages.map((p, i) => normalizePage(p, i)), migrated: raw.version !== DASH_VERSION }
  }
  return null
}

export function serializeDashboard(pages) {
  return JSON.stringify({
    version: DASH_VERSION,
    pages: (pages || []).map((p) => ({
      id: p.id,
      name: p.name,
      cards: (p.cards || []).map(stripCard),
    })),
  })
}

// ---- 编辑模式多选批量操作（web 左栏与手机面板共用）----
// 按 uid 集合从数组中删除卡片。
export function removeCards(arr, uids) {
  const s = new Set(uids)
  for (let i = arr.length - 1; i >= 0; i--) if (s.has(arr[i]?.uid)) arr.splice(i, 1)
}

// 所选卡片按相对顺序整体平移一位（dir=-1 前移 / 1 后移）：
// 依次与方向上的下一个未选中邻卡交换，保持所选卡片之间的相对顺序不变。
export function moveCards(arr, uids, dir) {
  const s = new Set(uids)
  if (dir < 0) {
    for (let i = 1; i < arr.length; i++) {
      if (s.has(arr[i]?.uid) && !s.has(arr[i - 1]?.uid)) { const t = arr[i - 1]; arr[i - 1] = arr[i]; arr[i] = t }
    }
  } else {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (s.has(arr[i]?.uid) && !s.has(arr[i + 1]?.uid)) { const t = arr[i + 1]; arr[i + 1] = arr[i]; arr[i] = t }
    }
  }
}

// 仪表盘 JSON 字符串里的卡片总数（兼容 v1 数组与 v2 多页对象）。
export function dashboardCardCount(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return 0
  let v
  try { v = JSON.parse(rawStr) } catch { return 0 }
  if (Array.isArray(v)) return v.length
  if (v && typeof v === 'object' && Array.isArray(v.pages)) {
    return v.pages.reduce((n, p) => n + (Array.isArray(p?.cards) ? p.cards.length : 0), 0)
  }
  return 0
}

// 重新生成页 id 与卡片 uid：导入必须调用，否则同一文件导入两次会出现 uid / CSS 作用域冲突。
export function regenUids(pages) {
  for (const p of pages || []) {
    p.id = 'p_' + uid()
    for (const c of p.cards || []) c.uid = uid()
  }
  return pages
}

// ---- 一键智能排版：扫描真实实体，按设计师栅格（8 列、功能分区、大小卡搭配）生成首页 ----
// 实体域名 → 卡片类型（无映射的域忽略；weather 由基础天气卡自动取源，故跳过）
const DOMAIN_CARD = {
  light: 'light', switch: 'switch', plug: 'switch', valve: 'switch', group: 'switch', remote: 'switch', siren: 'switch',
  fan: 'fan', humidifier: 'fan', input_boolean: 'input_boolean',
  sensor: 'sensor', number: 'sensor', input_number: 'sensor', counter: 'sensor',
  binary_sensor: 'binary_sensor', climate: 'climate', water_heater: 'climate', cover: 'cover',
  media_player: 'media_player', lock: 'lock', alarm_control_panel: 'alarm_control_panel',
  camera: 'camera', vacuum: 'vacuum', scene: 'scene',
  script: 'script', automation: 'script', button: 'script', input_button: 'script',
  person: 'person', device_tracker: 'person', select: 'select', input_select: 'select',
  text: 'text', input_text: 'text', date: 'datetime', datetime: 'datetime', time: 'datetime', input_datetime: 'datetime',
  timer: 'timer', calendar: 'calendar', update: 'update', event: 'event', plant: 'plant',
  image: 'image', lawn_mower: 'lawn_mower', sun: 'sun',
}

// ================= 实体质量评估：算出"有用且可用"的实体，离线/诊断/僵尸全部剔除 =================
const BAD_STATES = new Set(['unavailable', 'unknown'])
// 首页不直接展示的域：zone 内部区域、update 固件更新、automation 后台自动化、系统通知
const SKIP_DOMAINS = new Set(['zone', 'update', 'automation', 'persistent_notification'])
// 诊断类 device_class（按域区分）
const DIAG_DEVICE_CLASS = {
  sensor: new Set(['signal_strength', 'timestamp', 'date']),
  binary_sensor: new Set(['connectivity']),
}
// 强诊断关键词（object_id 命中即剔除，任意域）：网络/硬件内部信息，对家居控制无意义
const DIAG_KEYWORDS = [
  'rssi', 'linkquality', 'link_quality', 'lqi', 'ip_address', 'ip_addr', 'mac_address', 'mac_addr',
  'ssid', 'bssid', 'serial_number', 'serialno', 'node_id', 'short_id', 'ieee', 'endpoint_id',
  'firmware', 'uptime', 'last_reset', 'pairing', 'coord_version', 'gateway_',
]
// 仅在传感器域生效的弱诊断关键词（避免误杀同名控制实体）
const DIAG_KEYWORDS_SENSOR = ['reboot', 'restart', 'debug', 'scan_result', 'api_endpoint', 'last_seen']

// 有用度评分：域基础分 + 设备类/名称加分，高分实体在卡片排序中靠前
const DOMAIN_SCORE = {
  light: 90, climate: 92, cover: 85, lock: 88, scene: 86, media_player: 80,
  vacuum: 78, switch: 72, fan: 70, person: 75, script: 68, siren: 76,
  camera: 74, alarm_control_panel: 82, sensor: 50, binary_sensor: 48,
}
const SENSOR_VALUE_KW = [['temperature', 30], ['humid', 30], ['pm25', 26], ['pm10', 20], ['co2', 26],
  ['illuminance', 16], ['power', 14], ['energy', 14], ['air_quality', 20], ['pressure', 10], ['formaldehyde', 22]]

export function entityScore(e) {
  let s = DOMAIN_SCORE[e.domain] ?? 40
  const n = String(e.friendly_name || e.entity_id).toLowerCase()
  if (e.domain === 'sensor' || e.domain === 'binary_sensor') {
    for (const [k, v] of SENSOR_VALUE_KW) if (n.includes(k)) { s += v; break }
  }
  return s
}

// 主过滤入口：返回 { useful, stats }
export function filterUsefulEntities(list) {
  const stats = { total: (list || []).length, kept: 0,
    rejected: { unavailable: 0, domain: 0, hidden: 0, diagnostic: 0, offline: 0, duplicate: 0, stale: 0, invalid: 0 } }

  // 先收集人员信息：person 关联的 device_trackers、人员名称（用于设备跟踪器去重）
  const trackedIds = new Set()
  const personNames = new Set()
  for (const e of list || []) {
    if (!e || e.domain !== 'person') continue
    const dt = e.attributes?.device_trackers
    if (Array.isArray(dt)) dt.forEach((x) => trackedIds.add(x))
    if (e.friendly_name) personNames.add(String(e.friendly_name).toLowerCase())
  }

  const reject = (reason) => { stats.rejected[reason]++; return null }
  const useful = []
  for (const e of list || []) {
    if (!e || typeof e !== 'object' || !e.entity_id) { if (e) reject('invalid'); continue }
    const dot = String(e.entity_id).indexOf('.')
    const domain = e.domain || (dot >= 0 ? String(e.entity_id).slice(0, dot) : '')
    const objectId = dot >= 0 ? String(e.entity_id).slice(dot + 1) : ''
    const state = String(e.state ?? '').toLowerCase()

    if (SKIP_DOMAINS.has(domain)) { reject('domain'); continue }
    if (!DOMAIN_CARD[domain]) continue                        // 不支持的域：静默跳过（非剔除）
    if (state === '' || BAD_STATES.has(state)) { reject('unavailable'); continue }
    if (objectId.startsWith('_')) { reject('hidden'); continue }  // HA 约定：下划线开头=默认隐藏

    // 设备跟踪器：离线的不显示；已被 person 实体覆盖的不重复显示
    if (domain === 'device_tracker') {
      if (state === 'not_home') { reject('offline'); continue }
      if (trackedIds.has(e.entity_id) || (e.friendly_name && personNames.has(String(e.friendly_name).toLowerCase()))) {
        reject('duplicate'); continue
      }
    }
    // person 自身不可用已被状态过滤；not_home 属于有效信息（谁不在家），保留

    if (DIAG_DEVICE_CLASS[domain]?.has(String(e.device_class || '').toLowerCase())) { reject('diagnostic'); continue }
    const hay = `${objectId} ${e.friendly_name || ''}`.toLowerCase()
    if (DIAG_KEYWORDS.some((k) => hay.includes(k))) { reject('diagnostic'); continue }
    if ((domain === 'sensor' || domain === 'binary_sensor') && DIAG_KEYWORDS_SENSOR.some((k) => hay.includes(k))) {
      reject('diagnostic'); continue
    }
    // 僵尸实体：传感器 90 天未更新（长期不上报的失联设备，状态可能还停留在旧值）
    if (domain === 'sensor' || domain === 'binary_sensor') {
      const d = new Date(e.last_updated)
      if (!Number.isNaN(d.getTime()) && Date.now() - d.getTime() > 90 * 864e5) { reject('stale'); continue }
    }
    useful.push(e)
  }
  stats.kept = useful.length
  return { useful, stats }
}

// 智能排版：先做实体质量筛选，再按「物理设备」聚合成设备卡片——
// 一台设备的多个实体收进同一张卡（标题=设备名，行内直接控制），而非每个实体散成小卡。
// devices：注册表设备图（registryDevices，含 display_name / entities / disabled），由调用方传入。
export function autoComposeHomepage(list, devices = []) {
  const { useful, stats } = filterUsefulEntities(list)
  const usefulIds = new Set(useful.map((e) => e.entity_id))
  const stateById = new Map(useful.map((e) => [e.entity_id, e]))
  const cards = []
  const basic = (type, w, h) => newCard(type, { w, h })

  // ===== 1) 按物理设备聚合实体 =====
  const deviceGroups = []
  for (const dev of devices) {
    if (!dev || dev.disabled) continue
    const ids = (dev.entities || []).map((e) => e.entity_id).filter((id) => usefulIds.has(id))
    if (!ids.length) continue
    // 主控实体 = 组内评分最高者（控制类域基础分远高于传感器，自然代表设备类型）
    let primaryId = ids[0]
    let best = -1
    for (const id of ids) {
      const s = entityScore(stateById.get(id))
      if (s > best) { best = s; primaryId = id }
    }
    deviceGroups.push({ ids, primaryId, name: dev.display_name || ids[0], score: best })
  }
  deviceGroups.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name, 'zh'))
  stats.devices = deviceGroups.length

  const smallCards = [] // h=1
  const tallCards = []  // h=2（行内滚动的通用卡或空调/媒体等高类型卡）
  // 被卡片消费的实体：无论类型卡还是通用卡，都消费整组（保持原有聚合排版规则）
  const usedIds = new Set()
  for (const dg of deviceGroups) {
    // 新增规则：优先按设备类型（主控实体的域）使用对应类型卡片模板；
    // 无对应模板（域未映射或注册表缺类型）时才退回 generic 通用卡
    const primary = stateById.get(dg.primaryId)
    const typed = primary ? DOMAIN_CARD[primary.domain] : null
    let card
    if (typed && typed !== 'generic' && cardDefaults[typed]) {
      card = newCard(typed, { entity_id: dg.primaryId })
    } else {
      const h = dg.ids.length >= 3 ? 2 : 1
      card = newCard('generic', { title: dg.name, entity_ids: dg.ids, entity_id: dg.ids[0], w: 2, h })
    }
    ;(card.h >= 2 ? tallCards : smallCards).push(card)
    dg.ids.forEach((id) => usedIds.add(id))
  }

  // ===== 2) 头部状态行（h=1）：问候 + 概览 + 时钟 + 日期 + 2 格填充 =====
  // 头部 2 格：从未被设备消费的实体里挑——太阳/人员优先，其次高分传感器
  const headPri = (e) => (e.domain === 'sun' ? 200 : e.domain === 'person' ? 160 : entityScore(e))
  const headPool = useful
    .filter((e) => !usedIds.has(e.entity_id))
    .sort((a, b) => headPri(b) - headPri(a))
  const headPicks = headPool.slice(0, 2)
  headPicks.forEach((e) => usedIds.add(e.entity_id))
  // 可填充实体不足 2 格时，问候卡加宽吸收余量，保证头部整行满 8 格
  const greetingW = 2 + (2 - headPicks.length)
  cards.push(basic('greeting', greetingW, 1), basic('overview', 2, 1), basic('clock', 1, 1), basic('date', 1, 1))
  cards.push(...headPicks.map((e) => newCard(DOMAIN_CARD[e.domain] || 'sensor', { entity_id: e.entity_id, w: 1, h: 1 })))

  // ===== 3) 无设备归属实体（小磁贴，宽 1） =====
  const orphans = useful.filter((e) => !usedIds.has(e.entity_id))
  const orphanCards = orphans.map((e) => newCard(DOMAIN_CARD[e.domain] || 'sensor', { entity_id: e.entity_id, w: 1, h: 1 }))

  // 行组装：按顺序把卡片装入宽 8 的行；行尾不足时由最后一张卡吸收余量（卡模板均可 flex 适应）
  const pushRows = (rowCards) => {
    let cur = []
    let w = 0
    for (const c of rowCards) {
      if (w + c.w > 8) { cards.push(...cur); cur = []; w = 0 }
      cur.push(c)
      w += c.w
    }
    if (cur.length) {
      const remain = 8 - w
      if (remain > 0) {
        // 尾卡最多加宽到 4（避免单卡被拉成整宽过空）；仍有余量则行尾留白
        const add = Math.max(0, Math.min(remain, 4 - cur[cur.length - 1].w))
        cur[cur.length - 1].w += add
      }
      cards.push(...cur)
    }
  }

  // ===== 4) 小设备卡（2 宽）与无设备小卡（1 宽）混合流式排满（h=1） =====
  pushRows([...smallCards, ...orphanCards])
  // ===== 5) 大设备卡（2×2）每行 4 个（h=2） =====
  pushRows(tallCards)

  // ===== 6) 家庭地图整宽收尾（h=2） =====
  cards.push(basic('map', 8, 2))

  return { page: newPage('首页', cards), stats }
}

// 只含仪表盘布局；有意不带 page.id，也不含 amap_key / ha_token / map_config。
export function buildExportEnvelope(pages) {
  return {
    app: EXPORT_APP,
    kind: EXPORT_KIND,
    version: DASH_VERSION,
    exported_at: new Date().toISOString(),
    dashboard: {
      pages: (pages || []).map((p) => ({ name: p.name, cards: (p.cards || []).map(stripCard) })),
    },
  }
}

function exportFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `lumina-dashboard-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`
}

export function downloadDashboard(pages) {
  const env = buildExportEnvelope(pages)
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFileName()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return env
}

// ---- 导入 ----
// 返回 { ok:true, pages, warnings } 或 { ok:false, error }；pages 已重新生成 id / uid。
export function parseImportPayload(text) {
  if (!text || !String(text).trim()) return { ok: false, error: '文件为空' }
  let v
  try { v = JSON.parse(text) } catch { return { ok: false, error: '文件不是有效的 JSON' } }

  const warnings = []
  let rawPages = null
  if (Array.isArray(v)) {
    // 早期备份：裸卡片数组
    rawPages = [{ name: '首页', cards: v }]
    warnings.push('这是旧版备份文件，已按单页导入')
  } else if (v && typeof v === 'object') {
    if (v.kind && v.kind !== EXPORT_KIND) return { ok: false, error: '这不是仪表盘导出文件' }
    const version = Number(v.version) || 0
    if (version > DASH_VERSION) return { ok: false, error: `文件版本过新（v${version}），请升级 App 后再导入` }
    const src = v.dashboard && typeof v.dashboard === 'object' ? v.dashboard : v
    if (!Array.isArray(src.pages) || !src.pages.length) return { ok: false, error: '文件中没有可导入的页面' }
    rawPages = src.pages
  } else {
    return { ok: false, error: '文件结构不正确（缺少 pages）' }
  }

  let dropped = 0
  const pages = rawPages.map((p, i) => {
    const src = Array.isArray(p?.cards) ? p.cards : []
    const page = normalizePage(p, i)
    dropped += src.length - page.cards.length
    return page
  })
  const total = pages.reduce((n, p) => n + p.cards.length, 0)
  if (!total) return { ok: false, error: '没有可识别的卡片（可能类型已不受支持）' }
  if (dropped > 0) warnings.push(`已忽略 ${dropped} 张不支持的卡片`)

  regenUids(pages)
  return { ok: true, pages, warnings }
}
// 仪表盘 schema：常量、卡片构造、旧数据迁移、序列化、导出 / 导入。
// user_prefs / key='dashboard' 的值始终是一个 JSON 字符串：
//   v1：顶层卡片数组 [{type,w,h,...}, ...]
//   v2：{ version: 2, pages: [{ id, name, cards: [...] }, ...] }
// HomeView（读写布局）与 MessageCenter（共享前判空）共用此模块，避免判空逻辑两处分叉。
import { cardDefaults } from '@/components/cards/defaults'
import { CTL_CSS } from '@/components/cards/templates'

export const DASH_VERSION = 2
export const EXPORT_APP = 'lumina-home-app'
export const EXPORT_KIND = 'dashboard'

let uidSeq = 0
function uid() { return (++uidSeq).toString(36) + Date.now().toString(36) }

// 卡片字段白名单：序列化 / 导出时统一裁剪，避免把运行时字段带进库里
const CARD_FIELDS = ['type', 'w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar']

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
  const o = { type, uid: uid(), w: d.w, h: d.h, html: d.html, css: d.css, js: d.js, entity_id: '', entity_ids: [], icon: '', avatar: '' }
  for (const k of ['w', 'h', 'html', 'css', 'js', 'entity_id', 'entity_ids', 'icon', 'avatar']) {
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

// ---- 导出 ----
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
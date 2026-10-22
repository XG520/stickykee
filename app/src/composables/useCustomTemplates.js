// 用户自定义卡片模板：把运行时改好的一张卡（尤其是从 custom 空卡搭起的）注册到 cardDefaults，
// 下次「添加卡片」列表里就能选中并克隆为新卡。持久化走 user_prefs.card_templates，启动时
// 自动注入，双端（Web/APK）同账号共享。
import { cardDefaults } from '@/components/cards/defaults'
import { getPrefs, putPrefs } from '@/utils/prefs'

const PREFS_KEY = 'card_templates'
const GROUP = '我的模板'
const MAX_TEMPLATES = 40

// 模板字段（持久化）；其他字段（needEntity/entityDomains/group）在注入时由我们统一补齐
export const TEMPLATE_FIELDS = ['name', 'icon', 'w', 'h', 'html', 'css', 'js', 'needEntity', 'entityDomains', '_designerSchema', 'compiledHtml', 'entitySlotMap']

// 生成唯一 type key（运行时注册用）；ID 自带时间便于排序 / 查重
function makeId() {
  const t = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const s = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`
  let r = ''
  for (let i = 0; i < 4; i++) r += Math.floor(Math.random() * 36).toString(36)
  return `tpl_${s}_${r}`
}

// cardDefaults 是普通对象：热注入后所有遍历（addGroups/newCard/normalizeCards/metaOf）立即生效。
// 卸载时只清理 type 键（不删 group 属性）；cardDefaults 里原内置类型的 group 是字符串，不会误碰。
function injectTemplate(t) {
  cardDefaults[t.type] = {
    label: t.name,
    icon: t.icon || 'construction',
    colorCls: 'text-custom',
    w: t.w || 1,
    h: t.h || 1,
    needEntity: !!t.needEntity,
    entityDomains: t.needEntity ? (t.entityDomains || null) : null,
    entityOptional: false,
    group: GROUP,
    html: t.html || '',
    css: t.css || '',
    js: t.js || '',
    _designerSchema: t._designerSchema || null,
    compiledHtml: t.compiledHtml || '',
    entitySlotMap: t.entitySlotMap || {},
    __template: true, // 标记是用户模板（删除时用到）
  }
}
function ejectTemplate(type) {
  if (!cardDefaults[type]?.__template) return
  delete cardDefaults[type]
}

let templates = []

// 启动时从 prefs 加载模板并注入 cardDefaults；离线回退本地快照（prefs.js 已兜底）
export async function loadTemplates() {
  try {
    const { data } = await getPrefs()
    templates = Array.isArray(data?.[PREFS_KEY]) ? data[PREFS_KEY].slice(0, MAX_TEMPLATES) : []
  } catch {
    templates = []
  }
  // 先清掉运行时注入过的旧模板（type 前缀 tpl_），防止 reload 残留
  for (const k of Object.keys(cardDefaults)) if (k.startsWith('tpl_') && cardDefaults[k]?.__template) delete cardDefaults[k]
  templates.forEach(injectTemplate)
  return templates
}
export function allTemplates() { return templates.slice() }

// 把一张「已编辑好的卡」保存为模板；成功后立即注入 cardDefaults 并写 prefs。
// card 是 CardEditor 的 draft（含 type/w/h/html/css/js/icon）；name 必填。
export async function saveAsTemplate(card, { name, icon, needEntity, entityDomains } = {}) {
  if (!card) return { err: 'no-card' }
  name = String(name || '').trim()
  if (!name) return { err: 'no-name' }
  if (!card.html) return { err: 'empty-html' }
  if (templates.length >= MAX_TEMPLATES) return { err: 'limit', msg: `最多保存 ${MAX_TEMPLATES} 个模板` }
  // 同名 → 覆盖（以最新版本为准）
  const exist = templates.find((t) => t.name === name)
  const id = exist ? exist.id : makeId()
  const t = {
    id,
    name,
    icon: icon || card.icon || 'construction',
    w: card.w || 1,
    h: card.h || 1,
    html: card.html,
    css: card.css || '',
    js: card.js || '',
    needEntity: !!needEntity,
    entityDomains: needEntity && Array.isArray(entityDomains) && entityDomains.length ? entityDomains : null,
    _designerSchema: card._designerSchema || null,
    compiledHtml: card.compiledHtml || '',
    entitySlotMap: card.entitySlotMap || {},
    createdAt: exist?.createdAt || Date.now(),
    updatedAt: Date.now(),
  }
  if (exist) {
    Object.assign(exist, t)
  } else {
    templates.push(t)
  }
  injectTemplate({ ...t, type: id })
  try {
    await putPrefs({ [PREFS_KEY]: templates })
  } catch {
    // 离线合并进快照（prefs.js 已兜底）；不阻断本地体验
  }
  return { type: id, ...t }
}

export async function deleteTemplate(type) {
  const i = templates.findIndex((t) => t.id === type)
  if (i < 0) return false
  templates.splice(i, 1)
  ejectTemplate(type)
  try { await putPrefs({ [PREFS_KEY]: templates }) } catch { /* 离线：前端体验不变 */ }
  return true
}

// 卡片类型是否属于用户模板（用于在 UI 上单独着色 / 支持删除）
export function isUserTemplate(type) {
  return typeof type === 'string' && type.startsWith('tpl_') && !!cardDefaults[type]?.__template
}

// 卡片设计器状态（Composition API 单例，与项目 store/index.js 同级模式）
// schema v2：PS 式自由画布（扁平元素数组 + 绝对定位），v1 积木树仅由 CodeCard 兜底渲染旧卡。
import { reactive, computed } from 'vue'
import { ELEMENT_DEFS, createElement, createEmptySchema, renderElementsToHtml } from '@/components/cards/designer/elementDefs'
import { DESIGNER_EXTRA_CSS } from '@/components/cards/designer/blockDefs'
import { SHELL_BASE } from '@/components/cards/templates'
import { entityStates } from '@/store'

// —— state ——
const state = reactive({
  schema: null,        // { version:2, canvas:{w,h}, elements:[ElementInstance] }
  selectedId: null,    // 主选中元素 id（多选时=最后点选的那个）
  selectedIds: [],     // 多选集合（含 selectedId；单选时长度 1，无选中为空）
  history: [],         // schema 深拷贝快照（结构/变换变更时 push）
  historyIdx: -1,
  // 手改代码（低代码平台的「代码面板」）：画布只生成 html/css；
  // html/css 为 null 表示未手改（跟随生成物），一旦编辑即为覆盖值；
  // js 画布不生成，空串即无脚本。保存时 override 优先于生成物。
  codeOverride: { html: null, css: null, js: '' },
  // 当前设计来源模板（画廊套用）：{ id,name,icon,grid,roles }；空白/代码卡为 null。
  // 保存时随卡片存 _roles，供再次编辑与「我的模板」绑定流程使用。
  tplMeta: null,
})

// —— history 管理 ——
function pushHistory() {
  state.history = state.history.slice(0, state.historyIdx + 1)
  state.history.push(JSON.parse(JSON.stringify(state.schema)))
  if (state.history.length > 50) state.history.shift()
  state.historyIdx = state.history.length - 1
}

let _suppressHistory = false
function maybePushHistory() {
  if (!_suppressHistory) pushHistory()
}

// —— getters ——
const selected = computed(() => {
  if (!state.selectedId || !state.schema) return null
  return state.schema.elements.find((e) => e.id === state.selectedId) || null
})

const canUndo = computed(() => state.historyIdx > 0)
const canRedo = computed(() => state.historyIdx < state.history.length - 1)

// 桥接：从根 store 拿实体 key 列表
const availableEntityIds = computed(() => Object.keys(entityStates))

// —— actions ——
function newEmpty(canvas) {
  state.schema = createEmptySchema(canvas)
  state.selectedId = null
  state.selectedIds = []
  state.history = [JSON.parse(JSON.stringify(state.schema))]
  state.historyIdx = 0
  state.codeOverride = { html: null, css: null, js: '' }
  state.tplMeta = null
}

// 套用画廊模板：roleMap 把角色槽（props.role）映射到真实实体 id，再载入画布
function applyTemplate(tpl, roleMap = {}) {
  const s = JSON.parse(JSON.stringify(tpl.schema))
  s.version = 2
  s.canvas = s.canvas || { w: (tpl.grid?.w || 4) * 120, h: (tpl.grid?.h || 2) * 120 }
  s.elements = Array.isArray(s.elements) ? s.elements : []
  for (const e of s.elements) {
    const def = ELEMENT_DEFS[e.type]
    if (!def) continue
    e.props = { ...JSON.parse(JSON.stringify(def.defaultProps)), ...(e.props || {}) }
    if (e.props.role && roleMap[e.props.role]) e.props.entity = roleMap[e.props.role]
  }
  loadSchema(s)
  state.tplMeta = { id: tpl.id, name: tpl.name, icon: tpl.icon, grid: tpl.grid, roles: tpl.roles || [] }
}

// 恢复既有 schema（v2）；画布尺寸缺省补 480×240
function loadSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema))
  s.version = 2
  s.canvas = s.canvas || { w: 480, h: 240 }
  s.elements = Array.isArray(s.elements) ? s.elements : []
  state.schema = s
  state.selectedId = null
  state.selectedIds = []
  state.history = [JSON.parse(JSON.stringify(s))]
  state.historyIdx = 0
  state.codeOverride = { html: null, css: null, js: '' }
  state.tplMeta = null
}

function select(id) {
  state.selectedId = id || null
  state.selectedIds = id ? [id] : []
}

// ctrl/shift 点选：切换某元素的选中状态（多选）
function toggleSelect(id) {
  if (!id) return
  state.selectedIds = state.selectedIds.includes(id)
    ? state.selectedIds.filter((x) => x !== id)
    : [...state.selectedIds, id]
  state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null
}

// 框选/全选：整体替换选中集合（去重并过滤已删除元素）
function selectMany(ids) {
  const list = state.schema?.elements || []
  const exist = new Set(list.map((e) => e.id))
  state.selectedIds = [...new Set(ids)].filter((id) => exist.has(id))
  state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null
}

// 当前选中的元素对象数组（按选中顺序）
function selectedElements() {
  const list = state.schema?.elements || []
  return state.selectedIds.map((id) => list.find((e) => e.id === id)).filter(Boolean)
}

// 添加元素到画布（at 缺省稍微错开，避免完全重叠）
function addElement(type, at = {}) {
  if (!state.schema || !ELEMENT_DEFS[type]) return null
  const n = state.schema.elements.length
  const el = createElement(type, {
    x: at.x ?? (24 + (n % 6) * 14),
    y: at.y ?? (24 + (n % 6) * 14),
  })
  // 不越出画布
  el.x = Math.max(0, Math.min(el.x, state.schema.canvas.w - el.w))
  el.y = Math.max(0, Math.min(el.y, state.schema.canvas.h - el.h))
  state.schema.elements.push(el)
  state.selectedId = el.id
  state.selectedIds = [el.id]
  maybePushHistory()
  return el
}

function deleteElement(id) {
  if (!state.schema) return
  const i = state.schema.elements.findIndex((e) => e.id === id)
  if (i < 0) return
  state.schema.elements.splice(i, 1)
  state.selectedIds = state.selectedIds.filter((x) => x !== id)
  if (state.selectedId === id) state.selectedId = state.selectedIds[state.selectedIds.length - 1] || null
  maybePushHistory()
}

// moveable 操作结束后回写变换（拖拽/缩放/旋转统一入口）
// silent：属性面板连续输入时免推 history（拖拽结束、方向键等离散操作才记快照）
function updateTransform(id, t, silent = false) {
  const el = state.schema?.elements.find((e) => e.id === id)
  if (!el) return
  if (typeof t.x === 'number') el.x = Math.round(t.x)
  if (typeof t.y === 'number') el.y = Math.round(t.y)
  if (typeof t.w === 'number') el.w = Math.max(8, Math.round(t.w))
  if (typeof t.h === 'number') el.h = Math.max(8, Math.round(t.h))
  if (typeof t.rotate === 'number') el.rotate = Math.round(t.rotate * 10) / 10
  if (!silent) maybePushHistory()
}

// 批量变换（多选拖动/对齐/分布/键盘微调），整批只推一次 history
function updateTransforms(items) {
  if (!items?.length || !state.schema) return
  _suppressHistory = true
  for (const { id, t } of items) updateTransform(id, t, true)
  _suppressHistory = false
  pushHistory()
}

// 多选整体位移（方向键微调）
function moveSelectedBy(dx, dy) {
  const els = selectedElements()
  if (!els.length) return
  updateTransforms(els.map((el) => ({ id: el.id, t: { x: el.x + dx, y: el.y + dy } })))
}

// 删除全部选中元素（一次 history）
function deleteSelected() {
  const els = selectedElements()
  if (!els.length) return
  _suppressHistory = true
  for (const el of els) deleteElement(el.id)
  _suppressHistory = false
  pushHistory()
}

// 对齐：单选 = 对齐画布；多选 = 对齐选区包围盒
function alignElements(mode) {
  const els = selectedElements()
  if (!els.length || !state.schema) return
  let box
  if (els.length === 1) {
    box = { x: 0, y: 0, w: state.schema.canvas.w, h: state.schema.canvas.h }
  } else {
    const l = Math.min(...els.map((e) => e.x))
    const t = Math.min(...els.map((e) => e.y))
    const r = Math.max(...els.map((e) => e.x + e.w))
    const b = Math.max(...els.map((e) => e.y + e.h))
    box = { x: l, y: t, w: r - l, h: b - t }
  }
  const items = els.map((el) => {
    const t = {}
    if (mode === 'left') t.x = box.x
    else if (mode === 'hcenter') t.x = box.x + (box.w - el.w) / 2
    else if (mode === 'right') t.x = box.x + box.w - el.w
    else if (mode === 'top') t.y = box.y
    else if (mode === 'vcenter') t.y = box.y + (box.h - el.h) / 2
    else if (mode === 'bottom') t.y = box.y + box.h - el.h
    return { id: el.id, t }
  })
  updateTransforms(items)
}

// 分布：≥3 个元素，按主轴等间距（首尾不动）
function distributeElements(axis) {
  const els = selectedElements()
  if (els.length < 3) return
  const key = axis === 'h' ? 'x' : 'y'
  const sizeKey = axis === 'h' ? 'w' : 'h'
  const sorted = [...els].sort((a, b) => a[key] - b[key])
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = last[key] + last[sizeKey] - first[key]
  const totalSize = sorted.reduce((s, e) => s + e[sizeKey], 0)
  const gap = (span - totalSize) / (sorted.length - 1)
  let pos = first[key]
  const items = sorted.map((el) => {
    const it = { id: el.id, t: { [key]: pos } }
    pos += el[sizeKey] + gap
    return it
  })
  updateTransforms(items)
}

function updateProps(id, patch) {
  const el = state.schema?.elements.find((e) => e.id === id)
  if (!el) return
  el.props = { ...(el.props || {}), ...patch }
  // props 变更不推进 history（太细碎），跟随下一次结构变更落快照
}

// 图层顺序：dir=1 上移一层（数组后移=更靠上），-1 下移一层
function reorderElement(id, dir) {
  const list = state.schema?.elements
  if (!list) return
  const i = list.findIndex((e) => e.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const [el] = list.splice(i, 1)
  list.splice(j, 0, el)
  maybePushHistory()
}

// 图层拖拽落位：把 id 移到 refId 的数组位置（ref 及其上方顺移一位；数组末=最上层）
function moveElementBefore(id, refId) {
  const list = state.schema?.elements
  if (!list || id === refId) return
  const from = list.findIndex((e) => e.id === id)
  if (from < 0 || !list.some((e) => e.id === refId)) return
  const [el] = list.splice(from, 1)
  const to = list.findIndex((e) => e.id === refId)
  list.splice(to, 0, el)
  maybePushHistory()
}

// 画布尺寸变更（随卡片 w/h 档位切换）
function setCanvas(w, h) {
  if (!state.schema) return
  state.schema.canvas = { ...state.schema.canvas, w: Math.max(60, Math.round(w)), h: Math.max(60, Math.round(h)) }
  maybePushHistory()
}

// 画布背景：{ type:'color'|'gradient'|'image', color/from,to,angle/image,fit }；null/'none' = 清除
function setBackground(bg) {
  if (!state.schema) return
  if (bg && bg.type && bg.type !== 'none') state.schema.canvas = { ...state.schema.canvas, background: { ...bg } }
  else {
    const c = { ...state.schema.canvas }
    delete c.background
    state.schema.canvas = c
  }
  maybePushHistory()
}

function undo() {
  if (!canUndo.value) return
  state.historyIdx--
  state.schema = JSON.parse(JSON.stringify(state.history[state.historyIdx]))
  state.selectedId = null
  state.selectedIds = []
}

function redo() {
  if (!canRedo.value) return
  state.historyIdx++
  state.schema = JSON.parse(JSON.stringify(state.history[state.historyIdx]))
  state.selectedId = null
  state.selectedIds = []
}

// —— 代码面板：手改覆盖 ——
// 当前画布生成物（html/css），代码面板在未手改时展示它
const generated = computed(() => {
  if (!state.schema) return { html: '', css: '' }
  const css = SHELL_BASE + DESIGNER_EXTRA_CSS
  try {
    return { html: renderElementsToHtml(state.schema, { entitySlots: {} }), css }
  } catch {
    return { html: '', css }
  }
})

// 手改某语言代码（html/css 传入与生成物相同的内容时视为未手改，回到跟随模式）
function setCode(lang, code) {
  if (lang === 'js') { state.codeOverride.js = code || ''; return }
  if (lang === 'html' || lang === 'css') {
    state.codeOverride[lang] = code === generated.value[lang] ? null : code
  }
}

// 放弃手改，回到生成物（js 为清空）
function resetCode(lang) {
  if (lang === 'js') state.codeOverride.js = ''
  else if (lang === 'html' || lang === 'css') state.codeOverride[lang] = null
}

// —— 序列化：供 Designer.save() / LivePreview 调用 ——
function serialize() {
  const ctx = { entitySlots: {} }
  const compiledHtml = renderElementsToHtml(state.schema, ctx)
  const genCss = SHELL_BASE + DESIGNER_EXTRA_CSS
  return {
    schema: JSON.parse(JSON.stringify(state.schema)),
    entitySlotMap: ctx.entitySlots,
    compiledHtml,
    roles: state.tplMeta?.roles || null,
    // 最终产物：手改优先，未手改跟随生成物
    html: state.codeOverride.html ?? compiledHtml,
    css: state.codeOverride.css ?? genCss,
    js: state.codeOverride.js || '',
    extraCss: DESIGNER_EXTRA_CSS,
  }
}

export const designerStore = {
  state,
  selected,
  canUndo,
  canRedo,
  generated,
  availableEntityIds,
  // actions
  newEmpty,
  applyTemplate,
  loadSchema,
  select,
  toggleSelect,
  selectMany,
  addElement,
  deleteElement,
  updateTransform,
  updateTransforms,
  moveSelectedBy,
  deleteSelected,
  alignElements,
  distributeElements,
  moveElementBefore,
  updateProps,
  reorderElement,
  setCanvas,
  setBackground,
  undo,
  redo,
  setCode,
  resetCode,
  serialize,
}

export default designerStore

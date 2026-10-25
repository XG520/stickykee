// 卡片规则（如果…就…否则…）：ESPHome 式规则列表，把元素模型组合成可交互的卡片。
// card.rules = [{
//   name: '规则名',
//   if:   { mode: 'all'|'any', rows: [{ entity, attr, op, value, not }] },
//   then: [{ target: vid, action: 'show'|'hide'|'css'|'text', value }],
//   else: [{ ... }]   // 可选
// }]
// 纯函数模块：CodeCard 运行时与 LogicPanel 配置 UI 共用，不依赖 store / DOM 之外的副作用。

export const COND_OPS = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'contains', label: '包含' },
  { value: 'in', label: '属于（逗号分隔）' },
  { value: 'empty', label: '为空' },
  { value: 'notempty', label: '不为空' },
]

export const RULE_ACTIONS = [
  { value: 'show', label: '显示' },
  { value: 'hide', label: '隐藏' },
  { value: 'css', label: '修改样式' },
  { value: 'text', label: '修改文字' },
]

// 需要填比较值的操作符（为空/不为空 不需要）
export function needValue(op) {
  return op !== 'empty' && op !== 'notempty'
}

// 需要填参数值的动作（显示/隐藏 不需要）
export function needActionValue(action) {
  return action === 'css' || action === 'text'
}

export function makeRow() {
  return { entity: '', attr: '', op: 'eq', value: '', not: false }
}

export function makeAction(target = '') {
  return { target, action: 'hide', value: '' }
}

export function makeRule() {
  return { name: '', if: { mode: 'all', rows: [makeRow()] }, then: [makeAction()], else: [] }
}

// 有效条件行（至少选了实体与操作符）
export function validRows(cond) {
  return (cond?.rows || []).filter((r) => r && r.entity && r.op)
}

// 取参与判断的值：attr 为空取 state，否则取 attributes[attr]
function valueOf(entity, attr) {
  if (!entity) return ''
  const raw = attr ? entity.attributes?.[attr] : entity.state
  return raw == null ? '' : String(raw)
}

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// 单条判断：getEntity(id) → { state, attributes } | null；not 对结果取反
export function evalRow(row, getEntity) {
  if (!row?.entity) return true
  const entity = getEntity(row.entity)
  const s = valueOf(entity, row.attr)
  const v = String(row.value ?? '')
  let ok
  switch (row.op) {
    case 'eq':
      ok = s.toLowerCase() === v.toLowerCase()
      break
    case 'neq':
      ok = s.toLowerCase() !== v.toLowerCase()
      break
    case 'gt': {
      const a = num(s); const b = num(v)
      ok = a != null && b != null && a > b
      break
    }
    case 'gte': {
      const a = num(s); const b = num(v)
      ok = a != null && b != null && a >= b
      break
    }
    case 'lt': {
      const a = num(s); const b = num(v)
      ok = a != null && b != null && a < b
      break
    }
    case 'lte': {
      const a = num(s); const b = num(v)
      ok = a != null && b != null && a <= b
      break
    }
    case 'contains':
      ok = s.toLowerCase().includes(v.toLowerCase())
      break
    case 'in':
      ok = v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).includes(s.toLowerCase())
      break
    case 'empty':
      ok = s === ''
      break
    case 'notempty':
      ok = s !== ''
      break
    default:
      ok = true
  }
  return row.not ? !ok : ok
}

// 条件组求值：all=全部满足（与），any=任一满足（或）；无有效条件视为满足
export function evalWhen(cond, getEntity) {
  const rows = validRows(cond)
  if (!rows.length) return true
  return cond.mode === 'any'
    ? rows.some((r) => evalRow(r, getEntity))
    : rows.every((r) => evalRow(r, getEntity))
}

// 收集规则列表引用的全部条件实体 id（用于订阅状态变化）
export function collectRuleEntities(rules) {
  const out = new Set()
  for (const rule of rules || []) {
    for (const row of validRows(rule?.if)) out.add(row.entity)
  }
  return [...out]
}

// 把 css 文本（"color:red;font-size:12px"）合入行内样式，不动既有定位属性之外的声明
function applyCssText(el, cssText) {
  for (const decl of String(cssText || '').split(';')) {
    const i = decl.indexOf(':')
    if (i <= 0) continue
    const prop = decl.slice(0, i).trim()
    const val = decl.slice(i + 1).trim()
    if (!prop || !val) continue
    el.style.setProperty(prop, val)
  }
}

function applyAction(rootEl, action) {
  const vid = action?.target
  if (!vid) return
  const el = rootEl.querySelector('[data-vid="' + String(vid).replace(/"/g, '\\"') + '"]')
  if (!el) return
  switch (action.action) {
    case 'show':
      el.style.display = ''
      break
    case 'hide':
      el.style.display = 'none'
      break
    case 'text':
      el.textContent = action.value ?? ''
      break
    case 'css':
      applyCssText(el, action.value)
      break
  }
}

// 运行时入口：按顺序对 rootEl 内 [data-vid] 元素执行规则动作。
// 满足条件执行 then，不满足执行 else（如有）；后面的规则可覆盖前面的结果。
export function applyRules(rootEl, rules, getEntity) {
  if (!rootEl || !Array.isArray(rules) || !rules.length) return
  for (const rule of rules) {
    if (!rule) continue
    const met = evalWhen(rule.if, getEntity)
    const acts = met ? rule.then : rule.else
    if (!Array.isArray(acts)) continue
    for (const a of acts) applyAction(rootEl, a)
  }
}

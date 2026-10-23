// 自由画布元素注册表 + 渲染管线（schema v2，PS 式自由排版）
// 与 blockDefs.js（v1 积木，旧卡兜底渲染用）并存；新卡片一律走本文件。
// 产物 HTML 全部用 cqw/cqh 容器查询单位（相对卡片根 .hc 的百分比），
// 卡片在仪表盘任意格宽下整体等比缩放，绝对定位不错位。

// —— 生成唯一 id ——
let _idCounter = 0
export function makeElementId() {
  _idCounter++
  return `e${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${_idCounter}`
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// —— 元素注册表 ——
// defaultSize/defaultProps 用于 createElement；propsSchema 驱动 PropertyPanel（FormKit 声明式表单）
export const ELEMENT_DEFS = {
  text: {
    type: 'text',
    label: '文本',
    icon: 'text_fields',
    defaultSize: { w: 120, h: 24 },
    defaultProps: { text: '文本', fontSize: 14, color: 'var(--hc-text)', weight: 500, align: 'left' },
    propsSchema: {
      text: { type: 'textarea', label: '内容（支持 {{占位符}}）' },
      fontSize: { type: 'number', label: '字号(px)', min: 8, max: 72, step: 1 },
      color: { type: 'text', label: '颜色（CSS 值）' },
      weight: {
        type: 'select', label: '字重',
        options: [
          { value: 300, label: '细体 300' }, { value: 400, label: '常规 400' },
          { value: 500, label: '中等 500' }, { value: 600, label: '半粗 600' }, { value: 700, label: '粗体 700' },
        ],
      },
      align: {
        type: 'select', label: '对齐',
        options: [{ value: 'left', label: '左对齐' }, { value: 'center', label: '居中' }, { value: 'right', label: '右对齐' }],
      },
    },
  },

  icon: {
    type: 'icon',
    label: '图标',
    icon: 'emoji_emotions',
    defaultSize: { w: 36, h: 36 },
    defaultProps: { icon: 'home', fontSize: 24, color: 'var(--hc-color, var(--hc-primary))' },
    propsSchema: {
      icon: { type: 'text', label: '图标名（Material Symbols）' },
      fontSize: { type: 'number', label: '字号(px)', min: 8, max: 96, step: 1 },
      color: { type: 'text', label: '颜色（CSS 值）' },
    },
  },

  image: {
    type: 'image',
    label: '图片',
    icon: 'image',
    defaultSize: { w: 80, h: 80 },
    defaultProps: { url: '', fit: 'cover', radius: 8, opacity: 1 },
    propsSchema: {
      url: { type: 'text', label: '图片地址（URL / data:）' },
      fit: {
        type: 'select', label: '填充方式',
        options: [{ value: 'cover', label: '裁剪填满' }, { value: 'contain', label: '完整包含' }],
      },
      radius: { type: 'number', label: '圆角(px)', min: 0, max: 999, step: 1 },
      opacity: { type: 'number', label: '不透明度(0-1)', min: 0, max: 1, step: 0.05 },
    },
  },

  rect: {
    type: 'rect',
    label: '矩形',
    icon: 'rectangle',
    defaultSize: { w: 140, h: 90 },
    defaultProps: { background: 'var(--hc-bg2)', radius: 10, borderColor: 'var(--hc-border)', borderWidth: 1, opacity: 1 },
    propsSchema: {
      background: { type: 'text', label: '背景（CSS 值）' },
      radius: { type: 'number', label: '圆角(px)', min: 0, max: 999, step: 1 },
      borderColor: { type: 'text', label: '边框颜色' },
      borderWidth: { type: 'number', label: '边框厚度(px)', min: 0, max: 8, step: 1 },
      opacity: { type: 'number', label: '不透明度(0-1)', min: 0, max: 1, step: 0.05 },
    },
  },

  // 实体状态：绑一个 HA 实体，产物输出 s_entity_ids_<i>_* 占位符（CodeCard 实时注入）
  entity: {
    type: 'entity',
    label: '实体状态',
    icon: 'monitor_heart',
    defaultSize: { w: 160, h: 28 },
    defaultProps: { entity: '', showIcon: true, showName: true, showState: true, showUnit: true, fontSize: 11, color: '' },
    propsSchema: {
      entity: { type: 'entity-select', label: '绑定实体' },
      showIcon: { type: 'checkbox', label: '显示图标' },
      showName: { type: 'checkbox', label: '显示名称' },
      showState: { type: 'checkbox', label: '显示状态' },
      showUnit: { type: 'checkbox', label: '显示单位' },
      fontSize: { type: 'number', label: '字号(px)', min: 8, max: 32, step: 1 },
      color: { type: 'text', label: '颜色（留空用默认）' },
    },
  },

  // 按钮：动作编译成 CodeCard 的 data-hc 交互属性（toggle 开关 / link 跳转）
  button: {
    type: 'button',
    label: '按钮',
    icon: 'smart_button',
    defaultSize: { w: 64, h: 32 },
    defaultProps: { text: '', glyph: 'power_settings_new', action: 'toggle', entity: '', href: '/', background: '', color: '' },
    propsSchema: {
      text: { type: 'text', label: '文字（与图标二选一）' },
      glyph: { type: 'text', label: '图标名（文字为空时生效）' },
      action: {
        type: 'select', label: '点击动作',
        options: [
          { value: 'none', label: '无' },
          { value: 'toggle', label: '开关实体' },
          { value: 'link', label: '页面跳转' },
        ],
      },
      entity: { type: 'entity-select', label: '定向实体（开关动作，可空=卡片主实体）' },
      href: { type: 'text', label: '跳转地址（跳转动作）' },
      background: { type: 'text', label: '背景（留空用默认）' },
      color: { type: 'text', label: '颜色（留空用默认）' },
    },
  },
}

// —— 构造元素实例 ——
export function createElement(type, at = {}) {
  const def = ELEMENT_DEFS[type]
  if (!def) throw new Error(`[designer] unknown element type: ${type}`)
  return {
    id: makeElementId(),
    type,
    x: Math.round(at.x ?? 20),
    y: Math.round(at.y ?? 20),
    w: def.defaultSize.w,
    h: def.defaultSize.h,
    rotate: 0,
    props: JSON.parse(JSON.stringify(def.defaultProps)),
  }
}

export function createEmptySchema(canvas = { w: 480, h: 240 }) {
  return { version: 2, canvas: { ...canvas }, elements: [] }
}

// —— 画布背景：canvas.background = { type:'color'|'gradient'|'image', color, from, to, angle, image, fit } ——
// 产物内联到 .hc 根容器 style（优先级高于 SHELL_BASE 的壳层背景），设计画布/缩略图同一渲染器自动生效。
export function canvasBackgroundStyle(canvas) {
  const bg = canvas?.background
  if (!bg || !bg.type || bg.type === 'none') return ''
  if (bg.type === 'color' && bg.color) return `background:${bg.color};`
  if (bg.type === 'gradient') {
    const from = bg.from || 'var(--hc-bg2)'
    const to = bg.to || 'var(--hc-bg, var(--hc-bg2))'
    const angle = Number.isFinite(+bg.angle) ? +bg.angle : 135
    return `background:linear-gradient(${angle}deg, ${from}, ${to});`
  }
  if (bg.type === 'image' && bg.image) {
    const fit = bg.fit === 'contain' ? 'contain' : 'cover'
    const url = String(bg.image).replace(/"/g, '%22')
    return `background:url("${url}") center / ${fit} no-repeat;`
  }
  return ''
}

// —— 坐标换算：设计 px → 容器查询单位（相对画布尺寸的百分比） ——
function uX(v, cw) { return `${((v / cw) * 100).toFixed(3)}cqw` }
function uY(v, ch) { return `${((v / ch) * 100).toFixed(3)}cqh` }

// 元素公共定位样式（产物模式：cqw/cqh；预览模式：直接 px，画布 DOM 即设计基准尺寸）
function frameStyle(el, canvas, unit) {
  const cw = canvas.w || 480
  const ch = canvas.h || 240
  const f = unit === 'px'
    ? { left: `${el.x}px`, top: `${el.y}px`, width: `${el.w}px`, height: `${el.h}px` }
    : { left: uX(el.x, cw), top: uY(el.y, ch), width: uX(el.w, cw), height: uY(el.h, ch) }
  const rot = el.rotate ? `transform:rotate(${el.rotate}deg);` : ''
  return `position:absolute;left:${f.left};top:${f.top};width:${f.width};height:${f.height};${rot}`
}

function fontUnit(px, canvas, unit) {
  return unit === 'px' ? `${px}px` : uX(px, canvas.w || 480)
}

// —— 单元素渲染（内层内容，不含定位框） ——
function renderInner(el, ctx) {
  const p = el.props || {}
  const { canvas, unit, preview, entities } = ctx
  const fu = (px) => fontUnit(px, canvas, unit)

  switch (el.type) {
    case 'text': {
      const style = `display:flex;align-items:center;width:100%;height:100%;justify-content:${{ left: 'flex-start', center: 'center', right: 'flex-end' }[p.align] || 'flex-start'};font-size:${fu(p.fontSize ?? 14)};font-weight:${p.weight ?? 500};color:${p.color || 'var(--hc-text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`
      return `<span style="${style}">${escAttr(p.text ?? '')}</span>`
    }
    case 'icon': {
      const style = `display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${fu(p.fontSize ?? 24)};color:${p.color || 'var(--hc-color, var(--hc-primary))'}`
      return `<span class="material-symbols-outlined" style="${style}">${escAttr(p.icon || 'home')}</span>`
    }
    case 'image': {
      const op = p.opacity != null && p.opacity < 1 ? `opacity:${p.opacity};` : ''
      const style = `width:100%;height:100%;object-fit:${p.fit || 'cover'};border-radius:${p.radius ?? 8}px;${op}display:block`
      const src = p.url || ''
      return src ? `<img src="${escAttr(src)}" style="${style}" alt="">` : `<div style="${style};background:var(--hc-bg2);border:1px dashed var(--hc-border)"></div>`
    }
    case 'rect': {
      const op = p.opacity != null && p.opacity < 1 ? `opacity:${p.opacity};` : ''
      const bd = p.borderWidth ? `border:${p.borderWidth}px solid ${p.borderColor || 'var(--hc-border)'};` : ''
      return `<div style="width:100%;height:100%;background:${p.background || 'var(--hc-bg2)'};border-radius:${p.radius ?? 10}px;${bd}${op}"></div>`
    }
    case 'entity': {
      const fs = `font-size:${fu(p.fontSize ?? 11)};`
      const colorStyle = p.color ? `color:${p.color};` : ''
      const wrap = (inner) => `<span class="hc-binding-entity" style="${fs}${colorStyle}">${inner}</span>`
      // 预览：画布上直接渲染真实实体值；产物：输出占位符由 CodeCard 注入
      if (preview) {
        const e = p.entity && entities ? entities[p.entity] : null
        const icon = e
          ? (ctx.iconFor ? ctx.iconFor(e) : (e.attributes?.icon ? String(e.attributes.icon).split(':').pop() : 'widgets'))
          : 'link_off'
        const name = e ? (e.friendly_name || p.entity) : (p.entity || '未绑定')
        const state = e ? String(e.state ?? '—') : '—'
        const unit = e ? (e.unit || e.attributes?.unit_of_measurement || '') : ''
        return wrap(
          (p.showIcon ? `<span class="h-ic material-symbols-outlined">${icon}</span>` : '') +
          (p.showName ? `<span class="h-t">${escAttr(name)}</span>` : '') +
          (p.showState ? `<span class="h-mut">${escAttr(state)}</span>` : '') +
          (p.showUnit && unit ? `<span class="h-mut">${escAttr(unit)}</span>` : ''),
        )
      }
      const i = ctx.selfIndex ?? 0
      const tk = `s_entity_ids_${i}`
      return wrap(
        (p.showIcon ? `<span class="h-ic material-symbols-outlined">{{${tk}_icon}}</span>` : '') +
        (p.showName ? `<span class="h-t">{{${tk}_name}}</span>` : '') +
        (p.showState ? `<span class="h-mut">{{${tk}_state}}</span>` : '') +
        (p.showUnit ? `<span class="h-mut">{{${tk}_unit}}</span>` : ''),
      )
    }
    case 'button': {
      const bg = p.background ? `background:${p.background};` : ''
      const color = p.color ? `color:${p.color};` : ''
      const inner = p.text
        ? `<span style="font-size:${fu(11)};font-weight:600">${escAttr(p.text)}</span>`
        : `<span class="material-symbols-outlined" style="font-size:${fu(16)}">${escAttr(p.glyph || 'power_settings_new')}</span>`
      let hc = ''
      if (p.action === 'toggle') hc = ` data-hc="toggle"`
      else if (p.action === 'link') hc = ` data-hc="link" data-href="${escAttr(p.href || '/')}"`
      const ent = p.entity ? ` data-entity="${escAttr(p.entity)}"` : ''
      return `<button class="h-btn" style="width:100%;height:100%;border-radius:99px;${bg}${color}"${hc}${ent}>${inner}</button>`
    }
    default:
      return ''
  }
}

// —— 渲染整份 schema ——
// schema: { version:2, canvas:{w,h}, elements:[...] }
// ctx: { entitySlots:{}, preview?:bool, entities?:{}, iconFor?:fn, unit?:'cqw'|'px' }
// 返回完整卡片根 HTML（.hc 容器，container-type:size 支撑 cqw/cqh）
export function renderElementsToHtml(schema, ctx = {}) {
  if (!schema || !Array.isArray(schema.elements)) return ''
  const canvas = schema.canvas || { w: 480, h: 240 }
  const unit = ctx.unit || 'cqw'
  ctx.entitySlots = ctx.entitySlots || {}
  const parts = schema.elements.map((el) => {
    // 实体元素：按画布顺序聚合进 entity_ids 槽，占位符下标与聚合顺序一致
    let selfIndex = 0
    if (el.type === 'entity' && el.props?.entity && !ctx.preview) {
      ctx.entitySlots.entity_ids = ctx.entitySlots.entity_ids || []
      selfIndex = ctx.entitySlots.entity_ids.length
      ctx.entitySlots.entity_ids.push(el.props.entity)
    }
    const inner = renderInner(el, { ...ctx, canvas, unit, selfIndex })
    return `<div data-el-id="${el.id}" style="${frameStyle(el, canvas, unit)}">${inner}</div>`
  })
  const bgStyle = canvasBackgroundStyle(canvas)
  const rootStyle = unit === 'px'
    ? `position:relative;padding:0;overflow:hidden;width:${canvas.w}px;height:${canvas.h}px;${bgStyle}`
    : `position:relative;padding:0;overflow:hidden;container-type:size;${bgStyle}`
  return `<div class="hc" style="${rootStyle}">${parts.join('')}</div>`
}

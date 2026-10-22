// 积木注册表 + 渲染管线（Phase 1）
// 所有 render 函数返回**纯字符串**（供 v-html 使用），占位符沿用 {{xxx}} 与 CodeCard 的 liveData 注入体系对齐。
// 不 import Vue 组件，避免打包耦合。

// 设计器积木专用样式（叠加在 SHELL_BASE 之后）：
// 只补齐 blockDefs 自己产出的类名，预设卡原有的 CSS 已覆盖其余类。
export const DESIGNER_EXTRA_CSS = `
.hc-binding-entity{display:inline-flex;align-items:center;gap:3px;min-width:0;max-width:100%}
.hc-mq-wrap{overflow:hidden;width:100%;min-width:0}
.hc-mq-track{display:flex;align-items:center;gap:var(--pi-mq-gap,24px);width:max-content;animation:hc-mq-scroll var(--pi-mq-dur,10s) linear infinite}
@keyframes hc-mq-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.pi-cycle{position:relative;display:flex;align-items:center;min-width:0;min-height:12px;overflow:hidden}
`

// —— 生成唯一 id ——
let _idCounter = 0
export function makeBlockId() {
  _idCounter++
  return `b${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${_idCounter}`
}

// —— HTML 属性转义（entity_id 只含 [a-z0-9_.]，仍做兜底） ——
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// —— Deep clone defaultProps（避免多次引用同一对象） ——
function cloneProps(p) {
  if (p === null || p === undefined) return {}
  return JSON.parse(JSON.stringify(p))
}

// —— BlockDef 注册表 ——
export const BLOCK_DEFS = {
  // ========= 容器（slot） =========
  slot_root: {
    type: 'slot_root',
    label: '卡片根',
    icon: 'dns',
    group: 'slot',
    slots: ['head', 'main', 'bottom'],
    defaultProps: { padding: 8, gap: 4 },
    propsSchema: {
      padding: { type: 'number', label: '内边距', min: 0, max: 24, step: 1 },
      gap: { type: 'number', label: '子项间距', min: 0, max: 20, step: 1 },
    },
    render(props, childrenMap = {}) {
      const pad = props.padding ?? 8
      const gap = props.gap ?? 4
      const head = childrenMap.head || ''
      const main = childrenMap.main || ''
      const bottom = childrenMap.bottom || ''
      const headHtml = head ? `<div class="h-head" style="gap:${gap}px">${head}</div>` : ''
      const mainHtml = main ? `<div style="flex:1;min-height:0">${main}</div>` : ''
      const bottomHtml = bottom ? `<div class="h-row">${bottom}</div>` : ''
      return `<div class="hc" style="padding:${pad}px;gap:${gap}px">${headHtml}${mainHtml}${bottomHtml}</div>`
    },
  },

  slot_head: {
    type: 'slot_head',
    label: '顶部标题栏',
    icon: 'frame_top',
    group: 'slot',
    slots: ['default'],
    defaultProps: { gap: 5 },
    propsSchema: {
      gap: { type: 'number', label: '子项间距', min: 0, max: 20, step: 1 },
    },
    render(props, childrenMap = {}) {
      const gap = props.gap ?? 5
      const content = childrenMap.default || ''
      return `<div class="h-head" style="gap:${gap}px">${content}</div>`
    },
  },

  slot_bottom: {
    type: 'slot_bottom',
    label: '底部容器',
    icon: 'frame_bottom',
    group: 'slot',
    slots: ['default'],
    defaultProps: {},
    propsSchema: {},
    render(_props, childrenMap = {}) {
      const content = childrenMap.default || ''
      return `<div class="h-row">${content}</div>`
    },
  },

  slot_marquee: {
    type: 'slot_marquee',
    label: '跑马灯容器',
    icon: 'auto_awesome_motion',
    group: 'slot',
    slots: ['default'],
    defaultProps: { duration: 10, gap: 24 },
    propsSchema: {
      duration: { type: 'number', label: '滚动时长(秒)', min: 2, max: 30, step: 1 },
      gap: { type: 'number', label: '复制间隙(px)', min: 0, max: 80, step: 2 },
    },
    render(props, childrenMap = {}) {
      const dur = props.duration ?? 10
      const gap = props.gap ?? 24
      const content = childrenMap.default || ''
      // 双拷贝 + translateX(-50%) 实现无缝循环（与 personInfo 跑马灯同一手法）
      return `<div class="hc-mq-wrap"><div class="hc-mq-track" style="--pi-mq-dur:${dur}s;--pi-mq-gap:${gap}px">${content}${content}</div></div>`
    },
  },

  slot_cycle: {
    type: 'slot_cycle',
    label: '循环翻动容器',
    icon: 'sync_alt',
    group: 'slot',
    slots: ['cycleItems'],
    defaultProps: {},
    propsSchema: {},
    render(_props, childrenMap = {}) {
      const content = childrenMap.cycleItems || ''
      return `<div class="pi-cycle">${content}</div>`
    },
  },

  // ========= 绑定（binding） =========
  binding_entity: {
    type: 'binding_entity',
    label: '实体绑定',
    icon: 'account_box',
    group: 'binding',
    slots: [],
    defaultProps: {
      entitySlot: 'entity_ids',
      entityIds: [],          // 真实 HA entity_id 数组（按选择顺序渲染）
      showIcon: true,
      showName: true,
      showState: true,
      showUnit: true,
    },
    propsSchema: {
      entitySlot: {
        type: 'select',
        label: '实体数组位置',
        options: [
          { value: 'entity_ids', label: '主实体 (entity_ids)' },
          { value: 'entity_ids2', label: '槽位2 (entity_ids2)' },
          { value: 'entity_ids3', label: '槽位3 (entity_ids3)' },
          { value: 'entity_ids_status', label: '状态槽 (entity_ids_status)' },
        ],
      },
      entityIds: { type: 'entity-select', multiple: true, label: '绑定实体（按顺序渲染）' },
      showIcon: { type: 'checkbox', label: '显示图标' },
      showName: { type: 'checkbox', label: '显示名称' },
      showState: { type: 'checkbox', label: '显示状态' },
      showUnit: { type: 'checkbox', label: '显示单位' },
    },
    // ctx.selfBase：本积木在所属槽位数组中的起始下标（由 renderSchemaToHtml 计算）
    // 单个实体渲染成槽位下标占位符 `s_<slot>_<index>_<field>`，由 CodeCard 按实时实体状态注入；
    // 未选实体时回退到旧的全局占位符（{{glyph}}/{{name}}/…），保证旧卡片与预设模板仍可渲染。
    render(props, _childrenMap = {}, ctx = {}) {
      const { showIcon = true, showName = true, showState = true, showUnit = true } = props
      const slot = props.entitySlot || 'entity_ids'
      const ids = Array.isArray(props.entityIds) ? props.entityIds.filter(Boolean) : []
      if (!ids.length) {
        const icon = showIcon ? `<span class="h-ic material-symbols-outlined">{{glyph}}</span>` : ''
        const name = showName ? `<span class="h-t">{{name}}</span>` : ''
        const statePart = showState ? `<span class="h-mut">{{entityState}}</span>` : ''
        const unitPart = showUnit ? `<span class="h-mut">{{unit}}</span>` : ''
        return `<span class="hc-binding-entity" data-eid="{{entityId}}">${icon}${name}${statePart}${unitPart}</span>`
      }
      // 画布预览（Designer Canvas）：直接按当前实体状态渲染真实值，避免显示占位符原文
      if (ctx.preview) {
        return ids.map((eid) => {
          const e = ctx.entities ? ctx.entities[eid] : null
          // 预览图标优先用 BlockNode 传入的图标解析器（与卡片领域图标规则一致）
          const icon = ctx.iconFor
            ? ctx.iconFor(e)
            : (e?.attributes?.icon ? String(e.attributes.icon).split(':').pop() : 'widgets')
          const name = e?.friendly_name || eid
          const unit = e?.unit || e?.attributes?.unit_of_measurement || ''
          const iconPart = showIcon ? `<span class="h-ic material-symbols-outlined">${icon}</span>` : ''
          const namePart = showName ? `<span class="h-t">${escAttr(name)}</span>` : ''
          const statePart = showState ? `<span class="h-mut">${escAttr(String(e?.state ?? '—'))}</span>` : ''
          const unitPart = showUnit && unit ? `<span class="h-mut">${escAttr(unit)}</span>` : ''
          return `<span class="hc-binding-entity">${iconPart}${namePart}${statePart}${unitPart}</span>`
        }).join('')
      }
      const base = typeof ctx.selfBase === 'number' ? ctx.selfBase : 0
      return ids.map((eid, i) => {
        const p = `s_${slot}_${base + i}`
        const icon = showIcon ? `<span class="h-ic material-symbols-outlined">{{${p}_icon}}</span>` : ''
        const name = showName ? `<span class="h-t">{{${p}_name}}</span>` : ''
        const statePart = showState ? `<span class="h-mut">{{${p}_state}}</span>` : ''
        const unitPart = showUnit ? `<span class="h-mut">{{${p}_unit}}</span>` : ''
        return `<span class="hc-binding-entity" data-eid="${escAttr(eid)}">${icon}${name}${statePart}${unitPart}</span>`
      }).join('')
    },
  },

  // ========= 原子（primitive） =========
  avatar: {
    type: 'avatar',
    label: '头像',
    icon: 'person',
    group: 'primitive',
    slots: [],
    defaultProps: { size: 38, radius: 999 },
    propsSchema: {
      size: { type: 'number', label: '尺寸(px)', min: 16, max: 96, step: 2 },
      radius: { type: 'number', label: '圆角(px)', min: 0, max: 999, step: 1 },
    },
    render(props) {
      const size = props.size ?? 38
      const radius = props.radius ?? 999
      return `<div class="hc-design-avatar" style="width:${size}px;height:${size}px;border-radius:${radius}px;background:var(--hc-bg2,rgb(var(--c-surface-alt)));border:1px solid var(--hc-border);display:flex;align-items:center;justify-content:center;flex:none">
<span class="material-symbols-outlined" style="font-size:${Math.round(size * 0.6)}px;color:var(--hc-sub)">person</span>
</div>`
    },
  },

  state_badge: {
    type: 'state_badge',
    label: '状态角标',
    icon: 'notifications_active',
    group: 'primitive',
    slots: [],
    defaultProps: { stateCls: 'b-on', label: '在线' },
    propsSchema: {
      stateCls: {
        type: 'select',
        label: '状态类型',
        options: [
          { value: 'b-on', label: '绿色·在线' },
          { value: 'b-warn', label: '橙色·告警' },
          { value: 'b-off', label: '灰色·离线' },
        ],
      },
      label: { type: 'text', label: '状态文字' },
    },
    render(props) {
      const cls = props.stateCls || 'b-off'
      const label = props.label || '{{stateLabel}}'
      return `<span class="h-badge ${cls}"><i class="dot"></i>${label}</span>`
    },
  },

  text_block: {
    type: 'text_block',
    label: '文字块',
    icon: 'text_fields',
    group: 'primitive',
    slots: [],
    defaultProps: { text: '文字', fontSize: 10, color: 'var(--hc-text)', weight: 500 },
    propsSchema: {
      text: { type: 'text', label: '文字内容（支持 {{占位符}}' },
      fontSize: { type: 'number', label: '字号(px)', min: 6, max: 32, step: 1 },
      color: { type: 'text', label: '颜色（CSS 值）' },
      weight: {
        type: 'select',
        label: '字重',
        options: [
          { value: 300, label: '细体 300' },
          { value: 400, label: '常规 400' },
          { value: 500, label: '中等 500' },
          { value: 600, label: '半粗 600' },
          { value: 700, label: '粗体 700' },
        ],
      },
    },
    render(props) {
      const text = props.text ?? '文字'
      const fs = props.fontSize ?? 10
      const color = props.color ?? 'var(--hc-text)'
      const w = props.weight ?? 500
      return `<span style="font-size:${fs}px;font-weight:${w};color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;min-width:0">${text}</span>`
    },
  },

  icon_block: {
    type: 'icon_block',
    label: '图标',
    icon: 'emoji_emotions',
    group: 'primitive',
    slots: [],
    defaultProps: { icon: 'home', size: 11 },
    propsSchema: {
      icon: { type: 'text', label: '图标名（Material Symbols）' },
      size: { type: 'number', label: '字号(px)', min: 8, max: 48, step: 1 },
    },
    render(props) {
      const icon = props.icon ?? 'home'
      const size = props.size ?? 11
      return `<span class="material-symbols-outlined" style="font-size:${size}px">${icon}</span>`
    },
  },

  button_toggle: {
    type: 'button_toggle',
    label: '开关按钮',
    icon: 'power_settings_new',
    group: 'primitive',
    slots: [],
    defaultProps: { glyph: 'power_settings_new', width: 44, height: 44 },
    propsSchema: {
      glyph: { type: 'text', label: '按钮图标' },
      width: { type: 'number', label: '宽(px)', min: 24, max: 96, step: 2 },
      height: { type: 'number', label: '高(px)', min: 24, max: 96, step: 2 },
    },
    render(props) {
      const glyph = props.glyph ?? 'power_settings_new'
      const w = props.width ?? 44
      const h = props.height ?? 44
      return `<button class="h-btn" style="width:${w}px;height:${h}px;border-radius:99px" data-hc="toggle"><span class="material-symbols-outlined" style="font-size:${Math.round(Math.min(w, h) * 0.5)}px">${glyph}</span></button>`
    },
  },

  line_block: {
    type: 'line_block',
    label: '分隔线',
    icon: 'horizontal_rule',
    group: 'primitive',
    slots: [],
    defaultProps: { color: 'var(--hc-border)', height: 1 },
    propsSchema: {
      color: { type: 'text', label: '颜色（CSS 值）' },
      height: { type: 'number', label: '厚度(px)', min: 1, max: 8, step: 1 },
    },
    render(props) {
      const color = props.color ?? 'var(--hc-border)'
      const h = props.height ?? 1
      return `<hr style="border:none;height:${h}px;background:${color};margin:4px 0">`
    },
  },
}

// —— renderSchemaToHtml(tree, ctx) ——
// Phase 2：完整递归渲染 BlockInstance 树。
//   - 容器节点：先递归 children 拿到 childrenMap（slot 名 → HTML 字符串），再调 def.render(props, childrenMap)
//   - 叶子节点：调 def.render(props)（atomic 类 childrenMap 不读，传 {}）
//   - ctx.entitySlots: 聚合所有 binding_entity 的 entitySlot 声明
// tree: BlockInstance | null
// ctx: { entitySlots: Record<string, string[]> }
// 返回: string（完整 HTML）
export function renderSchemaToHtml(tree, ctx) {
  if (!tree) return ''
  if (!BLOCK_DEFS[tree.defType]) {
    console.warn('[designer] unknown defType:', tree.defType)
    return ''
  }
  const def = BLOCK_DEFS[tree.defType]
  const props = tree.props || {}
  ctx.entitySlots = ctx.entitySlots || {}
  ctx.entities = ctx.entities || {}

  // 聚合 entitySlot：binding_entity 在所属槽位中的**真实 HA entity_id**（按渲染顺序拼接），
  // 同时记下本积木的起始下标，交给 render 生成 `s_<slot>_<index>_<field>` 占位符。
  // 槽位数组顺序 = 积木遍历顺序 × 各自 entityIds 顺序，与 render 输出顺序完全一致。
  let selfBase = 0
  if (tree.defType === 'binding_entity') {
    const slotKey = props.entitySlot || 'entity_ids'
    const ids = Array.isArray(props.entityIds) ? props.entityIds.filter(Boolean) : []
    if (ids.length) {
      ctx.entitySlots[slotKey] = ctx.entitySlots[slotKey] || []
      selfBase = ctx.entitySlots[slotKey].length
      ctx.entitySlots[slotKey].push(...ids)
    }
  }

  // 递归 children：预览模式复用同一 ctx（携带 entities / entitySlots）保证与最终渲染槽位顺序一致
  const childrenMap = buildChildrenMap(tree, ctx)

  // atomic 类同样传 ctx（binding_entity 需要 selfBase），render 函数按需取用
  if (def.slots && def.slots.length > 0) {
    return def.render(props, childrenMap, ctx)
  }
  return def.render(props, {}, { ...ctx, selfBase })
}

// 把 node.children 递归渲染后，按 def.slots 分组：
//   - 单一 slot 容器（slot_head/bottom/marquee）有 slots: ['default'] → 所有 children 平铺到 default
//   - 多 slot 容器（slot_root）有 slots: ['head','main','bottom']：
//     Phase 3 支持 slot 归属元数据：每个 child 节点可选带 slot 字段（'head'|'main'|'bottom'|'cycleItems'|'default'）
//     按 child.slot 分组；没有 slot 的子节点落到第一个 slot。
function buildChildrenMap(node, ctx) {
  const def = BLOCK_DEFS[node.defType]
  const result = {}
  const slotNames = def?.slots || []
  const children = node.children || []

  if (slotNames.length === 0) return result

  if (slotNames.length === 1) {
    // 单一 slot：Phase 3 也支持子节点带 slot 字段，若子节点 slot === slotNames[0] 或无 slot 都归入
    const targetSlot = slotNames[0]
    result[targetSlot] = children
      .filter((c) => !c.slot || c.slot === targetSlot)
      .map((c) => renderSchemaToHtml(c, ctx))
      .join('')
    return result
  }

  // 多 slot：Phase 3 按 child.slot 归属
  slotNames.forEach((s) => { result[s] = '' })
  // 按 slot 字段分组渲染
  const groups = {}
  children.forEach((c) => {
    const slotKey = c.slot || slotNames[0]
    if (!slotNames.includes(slotKey)) {
      // 不合法的 slot 归属落到第一个 slot（fallback）
      groups[slotNames[0]] = groups[slotNames[0]] || []
      groups[slotNames[0]].push(c)
    } else {
      groups[slotKey] = groups[slotKey] || []
      groups[slotKey].push(c)
    }
  })
  Object.keys(groups).forEach((slotKey) => {
    result[slotKey] = groups[slotKey].map((c) => renderSchemaToHtml(c, ctx)).join('')
  })
  return result
}

// —— 工具：构造一个 BlockInstance（含唯一 id 和 defaultProps） ——
export function createBlockInstance(defType, propsOverride = {}) {
  const def = BLOCK_DEFS[defType]
  if (!def) throw new Error(`[designer] unknown defType: ${defType}`)
  return {
    id: makeBlockId(),
    defType,
    props: { ...cloneProps(def.defaultProps), ...propsOverride },
    children: [],
  }
}

// —— 预设骨架 ——
export const PRESETS = {
  personInfo: () => ({
    id: makeBlockId(),
    defType: 'slot_root',
    props: { padding: 8, gap: 4 },
    children: [
      {
        id: makeBlockId(),
        defType: 'slot_head',
        props: { gap: 5 },
        children: [
          { id: makeBlockId(), defType: 'text_block', props: { text: '{{name}}', fontSize: 10, weight: 700 }, children: [] },
          { id: makeBlockId(), defType: 'state_badge', props: { stateCls: 'b-on', label: '在线' }, children: [] },
        ],
      },
      { id: makeBlockId(), defType: 'avatar', props: { size: 38 }, children: [] },
    ],
  }),
  toggle: () => ({
    id: makeBlockId(),
    defType: 'slot_root',
    props: { padding: 8, gap: 4 },
    children: [
      {
        id: makeBlockId(),
        defType: 'slot_head',
        props: { gap: 5 },
        children: [
          { id: makeBlockId(), defType: 'binding_entity', props: { showName: true, showIcon: true, showState: false }, children: [] },
          { id: makeBlockId(), defType: 'state_badge', props: { stateCls: 'b-on', label: '{{stateLabel}}' }, children: [] },
        ],
      },
      {
        id: makeBlockId(),
        defType: 'slot_bottom',
        props: {},
        children: [
          { id: makeBlockId(), defType: 'text_block', props: { text: '实体 {{entityId}}', fontSize: 8, weight: 400, color: 'var(--hc-sub)' }, children: [] },
        ],
      },
    ],
  }),
}

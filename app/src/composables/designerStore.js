// 卡片设计器状态（Composition API 单例，与项目 store/index.js 同级模式）
// 不使用 Pinia：项目全局 store 用 reactive/ref 实现，Phase 1 延续同一风格。
import { reactive, computed } from 'vue'
import { BLOCK_DEFS, DESIGNER_EXTRA_CSS, createBlockInstance, renderSchemaToHtml } from '@/components/cards/designer/blockDefs'
import { SHELL_BASE } from '@/components/cards/templates'
import { entityStates } from '@/store'

// —— state ——
const state = reactive({
  schema: null,        // BlockInstance 树根（slot_root）
  selectedId: null,    // 当前选中积木 id
  history: [],         // schema 深拷贝快照（结构变更时 push）
  historyIdx: -1,      // 当前指向
})

// —— history 管理 ——
function pushHistory() {
  // 截断 redo 分支
  state.history = state.history.slice(0, state.historyIdx + 1)
  state.history.push(JSON.parse(JSON.stringify(state.schema)))
  // 上限：最多 50 份，防内存膨胀
  if (state.history.length > 50) {
    state.history.shift()
  }
  state.historyIdx = state.history.length - 1
}

function maybePushHistory() {
  if (!_suppressHistory) pushHistory()
}
let _suppressHistory = false

// —— 树遍历辅助 ——
function findNode(id, node = state.schema, parent = null) {
  if (!node) return null
  if (node.id === id) return { node, parent }
  const kids = node.children || []
  for (const c of kids) {
    const r = findNode(id, c, node)
    if (r) return r
  }
  return null
}

function isDescendant(ancestorId, targetId) {
  const r = findNode(targetId)
  if (!r) return false
  // 往上找 ancestorId
  let cur = r.parent
  while (cur) {
    if (cur.id === ancestorId) return true
    const p = findNode(cur.id).parent
    cur = p
  }
  return false
}

// —— getters ——
const selected = computed(() => {
  if (!state.selectedId || !state.schema) return null
  const r = findNode(state.selectedId)
  return r ? r.node : null
})

const flattened = computed(() => {
  const list = []
  function walk(node) {
    if (!node) return
    list.push(node)
    for (const c of node.children || []) walk(c)
  }
  walk(state.schema)
  return list
})

// 桥接：从根 store 拿实体 key 列表
const availableEntityIds = computed(() => Object.keys(entityStates))

// undo / redo 可用性
const canUndo = computed(() => state.historyIdx > 0)
const canRedo = computed(() => state.historyIdx < state.history.length - 1)

// —— actions ——
function newEmpty() {
  state.schema = {
    id: createBlockInstance('slot_root').id,
    defType: 'slot_root',
    props: { padding: 8, gap: 4 },
    children: [],
  }
  state.selectedId = null
  state.history = [JSON.parse(JSON.stringify(state.schema))]
  state.historyIdx = 0
}

function cloneFromPreset(presetSchema) {
  state.schema = JSON.parse(JSON.stringify(presetSchema))
  state.selectedId = null
  state.history = [JSON.parse(JSON.stringify(state.schema))]
  state.historyIdx = 0
}

function select(id) {
  state.selectedId = id || null
}

// 向某节点加新积木；defType 可带可选 props 覆盖
function addBlock(parentId, defType, insertIndex) {
  const r = findNode(parentId)
  if (!r) {
    console.warn('[designer] addBlock: parent not found', parentId)
    return
  }
  const def = BLOCK_DEFS[defType]
  if (!def) {
    console.warn('[designer] addBlock: unknown defType', defType)
    return
  }
  // 校验目标父节点是否接受 children
  if (!def.slots || def.slots.length === 0) {
    // primitive 块不能当父节点
    return
  }
  // 校验新积木是否接受 children（slot_root/head/bottom/marquee 是容器；primitive 本身也可以加但无 slots 就忽略）
  const instance = createBlockInstance(defType)
  const parent = r.node
  parent.children = parent.children || []
  const idx = typeof insertIndex === 'number' ? Math.max(0, Math.min(insertIndex, parent.children.length)) : parent.children.length
  parent.children.splice(idx, 0, instance)
  maybePushHistory()
}

// vue-draggable-plus 的 onMove / onEnd 会传 from/to；这里提供直接 API
function moveBlock(id, newParentId, insertIndex) {
  if (id === newParentId) return // 不能自己当自己的子
  if (isDescendant(id, newParentId)) {
    console.warn('[designer] moveBlock: cannot move node into its own descendant')
    return
  }
  const src = findNode(id)
  const dst = findNode(newParentId)
  if (!src || !dst) {
    console.warn('[designer] moveBlock: node not found', id, newParentId)
    return
  }
  if (!src.parent) return // 根节点
  // 从旧父节点摘除
  const oldKids = src.parent.children
  const oldIdx = oldKids.findIndex((c) => c.id === id)
  if (oldIdx >= 0) oldKids.splice(oldIdx, 1)
  // 插入新父节点
  dst.node.children = dst.node.children || []
  const idx = typeof insertIndex === 'number'
    ? Math.max(0, Math.min(insertIndex, dst.node.children.length))
    : dst.node.children.length
  dst.node.children.splice(idx, 0, src.node)
  maybePushHistory()
}

function deleteBlock(id) {
  const r = findNode(id)
  if (!r || !r.parent) return // 根节点不删
  const kids = r.parent.children
  const idx = kids.findIndex((c) => c.id === id)
  if (idx >= 0) kids.splice(idx, 1)
  if (state.selectedId === id) state.selectedId = null
  maybePushHistory()
}

function updateProps(id, patch) {
  const r = findNode(id)
  if (!r) return
  r.node.props = { ...(r.node.props || {}), ...patch }
  // props 变更不推进 history（太细碎），但标记脏
}

function undo() {
  if (!canUndo.value) return
  state.historyIdx--
  state.schema = JSON.parse(JSON.stringify(state.history[state.historyIdx]))
  state.selectedId = null
}

function redo() {
  if (!canRedo.value) return
  state.historyIdx++
  state.schema = JSON.parse(JSON.stringify(state.history[state.historyIdx]))
  state.selectedId = null
}

// —— 序列化：供 Designer.save() 调用 ——
function serialize() {
  const ctx = { entitySlots: {} }
  const compiledHtml = renderSchemaToHtml(state.schema, ctx)
  return {
    schema: JSON.parse(JSON.stringify(state.schema)),
    entitySlotMap: ctx.entitySlots,
    compiledHtml,
    // 自定义卡片从空白画布起步时没有模板 CSS，需带上积木基础样式；
    // 预设卡已有完整 CSS，由 CardEditor 判断是否采用
    css: SHELL_BASE + DESIGNER_EXTRA_CSS,
    extraCss: DESIGNER_EXTRA_CSS,
  }
}

// —— 暴露 store 对象（与项目 store/index.js 的 `store` 同级风格） ——
export const designerStore = {
  state,
  selected,
  flattened,
  availableEntityIds,
  canUndo,
  canRedo,
  // actions
  newEmpty,
  cloneFromPreset,
  select,
  addBlock,
  moveBlock,
  deleteBlock,
  updateProps,
  undo,
  redo,
  serialize,
}

export default designerStore

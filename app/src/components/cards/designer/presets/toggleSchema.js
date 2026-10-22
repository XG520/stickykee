// Toggle 预设卡 BlockInstance 树（Phase 3）
// 对应 templates.js tplToggle：开关卡，实体头部 + 状态 badge + 大按钮
import { makeBlockId } from '../blockDefs'

function bi(defType, props, slot) {
  const inst = { id: makeBlockId(), defType, props: props || {}, children: [] }
  if (slot) inst.slot = slot
  return inst
}
function biTree(defType, props, children, slot) {
  const inst = { id: makeBlockId(), defType, props: props || {}, children: children || [] }
  if (slot) inst.slot = slot
  return inst
}

/**
 * Toggle:
 *   slot_root
 *     ├─ slot_head (slot: 'head')
 *     │    ├─ binding_entity (entitySlot: entity_ids, showName+showIcon)
 *     │    └─ state_badge ({{stateLabel}})
 *     ├─ slot_head (slot: 'main' — 状态行)
 *     │    ├─ state_badge ({{stateLabel}})
 *     │    └─ text_block ({{state}})
 *     ├─ button_toggle (slot: 'main' — 核心开关按钮, data-hc="toggle")
 *     └─ slot_bottom (slot: 'bottom', binding_entity entitySlot: entity_ids — 控件槽占位)
 */
export default function TOGGLE_SCHEMA() {
  return biTree('slot_root', { padding: 8, gap: 4 }, [
    biTree('slot_head', { gap: 5 }, [
      bi('binding_entity', {
        entitySlot: 'entity_ids',
        showIcon: true, showName: true, showState: false, showUnit: false,
      }),
      bi('state_badge', { stateCls: 'b-on', label: '{{stateLabel}}' }),
    ], 'head'),

    biTree('slot_head', { gap: 4 }, [
      bi('state_badge', { stateCls: 'b-on', label: '{{stateLabel}}' }),
      bi('text_block', { text: '{{state}}', fontSize: 9, weight: 500, color: 'var(--hc-sub)' }),
    ], 'main'),

    bi('button_toggle', { glyph: '{{glyph}}', width: 44, height: 44 }, 'main'),

    biTree('slot_bottom', {}, [
      bi('binding_entity', {
        entitySlot: 'entity_ids',
        showIcon: false, showName: false, showState: true, showUnit: false,
      }),
    ], 'bottom'),
  ])
}

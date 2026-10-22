// Climate 预设卡 BlockInstance 树（Phase 3）
// 对应 templates.js tplClimate：空调/恒温卡，大数字温度 + HVAC 控制
// Phase 3 先用 text_block 大数字 + binding_entity 占位 hvac 模式下拉，Phase 5 再完善
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
 * Climate:
 *   slot_root
 *     ├─ slot_head (slot: 'head')
 *     │    ├─ binding_entity (entitySlot: entity_ids, showIcon+showName)
 *     │    └─ state_badge ({{hvacAction}})
 *     ├─ slot_head (slot: 'main' — 状态行)
 *     │    ├─ text_block ({{hvacAction}})
 *     │    └─ text_block ({{hvacStateText}})
 *     ├─ slot_head (slot: 'main' — 大数字温度)
 *     │    ├─ text_block ({{temp}}, fontSize 22)
 *     │    └─ text_block ({{unit}}, fontSize 10)
 *     └─ slot_head (slot: 'bottom' — HVAC 模式占位)
 *          └─ binding_entity (entitySlot: entity_ids)
 */
export default function CLIMATE_SCHEMA() {
  return biTree('slot_root', { padding: 8, gap: 4 }, [
    biTree('slot_head', { gap: 5 }, [
      bi('binding_entity', {
        entitySlot: 'entity_ids',
        showIcon: true, showName: true, showState: false, showUnit: false,
      }),
      bi('state_badge', { stateCls: 'b-on', label: '{{hvacAction}}' }),
    ], 'head'),

    biTree('slot_head', { gap: 4 }, [
      bi('text_block', { text: '{{hvacAction}}', fontSize: 9, weight: 600 }),
      bi('text_block', { text: '{{hvacStateText}}', fontSize: 9, weight: 500, color: 'var(--hc-sub)' }),
    ], 'main'),

    biTree('slot_head', { gap: 2 }, [
      bi('text_block', { text: '{{temp}}', fontSize: 22, weight: 700 }),
      bi('text_block', { text: '{{tempUnit}}', fontSize: 10, weight: 500, color: 'var(--hc-sub)' }),
    ], 'main'),

    biTree('slot_head', { gap: 6 }, [
      bi('binding_entity', {
        entitySlot: 'entity_ids',
        showIcon: false, showName: false, showState: false, showUnit: true,
      }),
    ], 'bottom'),
  ])
}

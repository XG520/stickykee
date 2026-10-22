// PersonInfo 预设卡 BlockInstance 树（Phase 3）
// 对应 templates.js tplPersonInfo：三槽位卡，主实体状态角标 / 中部循环翻动 / 底部滚动轮播
import { makeBlockId } from '../blockDefs'

// 辅助：构造一个 BlockInstance（含唯一 id 和 defaultProps）
function bi(defType, props, slot) {
  const inst = { id: makeBlockId(), defType, props: props || {}, children: [] }
  if (slot) inst.slot = slot
  return inst
}
// 辅助：带 children 的 BlockInstance
function biTree(defType, props, children, slot) {
  const inst = { id: makeBlockId(), defType, props: props || {}, children: children || [] }
  if (slot) inst.slot = slot
  return inst
}

/**
 * PersonInfo:
 *   slot_root (head / main / bottom)
 *     ├─ slot_head (slot: 'head')
 *     │    ├─ icon_block (glyph)
 *     │    ├─ text_block ({{name}})
 *     │    ├─ slot_marquee (entitySlot: entity_ids_status — head 内状态跑马灯)
 *     │    └─ state_badge (主实体状态角标)
 *     ├─ avatar (slot: 'main' — 主头像)
 *     ├─ slot_cycle (slot: 'main', entitySlot: entity_ids2 — 中部循环翻动)
 *     └─ slot_marquee (slot: 'bottom', entitySlot: entity_ids3 — 底部滚动轮播)
 */
export default function PERSON_INFO_SCHEMA() {
  return biTree('slot_root', { padding: 8, gap: 4 }, [
    biTree('slot_head', { gap: 5 }, [
      bi('icon_block', { icon: '{{glyph}}', size: 11 }),
      bi('text_block', { text: '{{name}}', fontSize: 10, weight: 700 }),
      biTree('slot_marquee', { duration: 10, gap: 16 }, [
        bi('binding_entity', {
          entitySlot: 'entity_ids_status',
          showIcon: true, showName: true, showState: true, showUnit: false,
        }),
      ]),
      bi('state_badge', { stateCls: 'b-on', label: '{{stateLabel}}' }),
    ], 'head'),

    bi('avatar', { size: 38, radius: 999 }, 'main'),

    biTree('slot_cycle', {}, [
      bi('binding_entity', {
        entitySlot: 'entity_ids2',
        showIcon: false, showName: true, showState: true, showUnit: false,
      }),
    ], 'main'),

    biTree('slot_marquee', { duration: 10, gap: 24 }, [
      bi('binding_entity', {
        entitySlot: 'entity_ids3',
        showIcon: true, showName: true, showState: true, showUnit: false,
      }),
    ], 'bottom'),
  ])
}

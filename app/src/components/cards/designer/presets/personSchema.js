// Person 预设卡 BlockInstance 树（Phase 3）
// 对应 templates.js tplPerson：人员位置卡，单实体 + 头像 + 位置信息
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
 * Person:
 *   slot_root
 *     ├─ slot_head (slot: 'head')
 *     │    ├─ icon_block (glyph)
 *     │    ├─ text_block ({{name}})
 *     │    └─ state_badge (状态角标)
 *     ├─ avatar (slot: 'main')
 *     ├─ text_block (slot: 'main' — {{locationText}} 位置文字)
 *     └─ text_block (slot: 'bottom' — {{subInfo}} 副标题)
 */
export default function PERSON_SCHEMA() {
  return biTree('slot_root', { padding: 8, gap: 4 }, [
    biTree('slot_head', { gap: 5 }, [
      bi('icon_block', { icon: '{{glyph}}', size: 11 }),
      bi('text_block', { text: '{{name}}', fontSize: 10, weight: 700 }),
      bi('state_badge', { stateCls: 'b-on', label: '{{stateLabel}}' }),
    ], 'head'),

    bi('avatar', { size: 38, radius: 999 }, 'main'),

    bi('text_block', { text: '{{locationText}}', fontSize: 9, weight: 500, color: 'var(--hc-text)' }, 'main'),
    bi('text_block', { text: '{{subInfo}}', fontSize: 8, weight: 400, color: 'var(--hc-sub)' }, 'bottom'),
  ])
}

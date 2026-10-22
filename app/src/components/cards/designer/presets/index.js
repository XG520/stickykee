// Presets 索引 — 汇总四张预设卡 schema 构造函数
// 使用：import { PERSON_INFO_SCHEMA, PERSON_SCHEMA, TOGGLE_SCHEMA, CLIMATE_SCHEMA, makePresets } from './presets'

import PERSON_INFO_SCHEMA from './personInfoSchema'
import PERSON_SCHEMA from './personSchema'
import TOGGLE_SCHEMA from './toggleSchema'
import CLIMATE_SCHEMA from './climateSchema'

export { PERSON_INFO_SCHEMA, PERSON_SCHEMA, TOGGLE_SCHEMA, CLIMATE_SCHEMA }

// 注册表：type → schema 构造函数
export const PRESET_MAP = {
  personInfo: PERSON_INFO_SCHEMA,
  person: PERSON_SCHEMA,
  toggle: TOGGLE_SCHEMA,
  climate: CLIMATE_SCHEMA,
}

// makePresets() —— 把 blockDefs.PRESETS 替换/扩展为包含完整 schema 的预设集合
// blockDefs 原有的 PRESETS（Phase 1 骨架）被覆盖；同时追加 custom 类型的空白 schema
import { makeBlockId } from '../blockDefs'

export function makePresets() {
  const customSchema = () => ({
    id: makeBlockId(),
    defType: 'slot_root',
    props: { padding: 8, gap: 4 },
    children: [],
  })
  return {
    personInfo: PERSON_INFO_SCHEMA,
    person: PERSON_SCHEMA,
    toggle: TOGGLE_SCHEMA,
    climate: CLIMATE_SCHEMA,
    custom: customSchema,
  }
}

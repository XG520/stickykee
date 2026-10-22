// FormKit 自定义 input 聚合
// 每个组件用 createInput() 包一下，产出 FormKitTypeDefinition；
// 暴露 `inputs` 对象直接给 main.js 的 plugin config 用：
//   app.use(formkit, { inputs })
import { createInput } from '@formkit/vue'
import EntitySelect from './EntitySelect.vue'
import DomainMultiSelect from './DomainMultiSelect.vue'
import ColorToken from './ColorToken.vue'

// 暴露给 Vue 模板直接用（<entity-select>），可选
export { EntitySelect, DomainMultiSelect, ColorToken }

// FormKit plugin config 用：type: 'entity-select' 等
// 注：createInput 组件统一接收 context（$node.context），值读写走 context.value / node.input，
// 这里 props 只声明需要从 FormKit schema 透传的额外配置项（不要把 modelValue 写进来）。
export const inputs = {
  'entity-select': createInput(EntitySelect, {
    props: ['multiple', 'entityDomains'],
    definition: {
      type: 'input',
    },
  }),
  'domain-multi-select': createInput(DomainMultiSelect, {
    props: [],
    definition: {
      type: 'input',
    },
  }),
  'color-token': createInput(ColorToken, {
    props: [],
    definition: {
      type: 'input',
    },
  }),
}

// 为兼容旧命名（任务描述里说的 registerXxx）
export const registerEntitySelect = EntitySelect
export const registerDomainMultiSelect = DomainMultiSelect
export const registerColorToken = ColorToken

export default inputs

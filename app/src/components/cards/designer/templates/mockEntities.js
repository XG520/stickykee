// 画廊缩略图用的 mock 实体：模板不写死真实实体（roles 角色槽），
// 画廊预览时把角色映射到 mock.<key> 假实体，保证缩略图所见即所得。

// 由模板的 roles 生成 { 'mock.<key>': 实体对象 } 映射（结构与 entityStates 一致）
export function buildMockEntities(template) {
  const out = {}
  for (const role of template.roles || []) {
    const id = `mock.${role.key}`
    out[id] = {
      entity_id: id,
      friendly_name: role.mockName || role.label,
      state: role.mockState ?? 'on',
      unit: role.mockUnit || '',
      domain: role.domains?.[0] || 'sensor',
      attributes: role.mockIcon ? { icon: `mdi:${role.mockIcon}` } : {},
    }
  }
  return out
}

// 把模板 schema 克隆一份，角色槽替换成 mock 实体 id（供画廊缩略图渲染）
export function mockBoundSchema(template) {
  const s = JSON.parse(JSON.stringify(template.schema))
  for (const el of s.elements) {
    if (el.props?.role) el.props.entity = `mock.${el.props.role}`
  }
  return s
}

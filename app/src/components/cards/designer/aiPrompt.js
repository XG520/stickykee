// AI 设计：系统提示词 + 模型输出容错解析。
// 模型直接产出 schema v2 JSON（与 elementDefs.js 的 renderElementsToHtml 对齐），
// 前端校验后 loadSchema 落画布，用户可继续图形化微调。
// 规范部分直接内嵌单一来源 cardSpec.md（?raw），与 .trae/skills/hc-card-dev 同源，规范只维护一份。
import { ELEMENT_DEFS } from './elementDefs'
import cardSpec from './cardSpec.md?raw'

// —— 系统提示词：规范（cardSpec）+ 元素 props 实时清单 + 实体清单 ——
export function buildSystemPrompt(canvas, entityHints) {
  const typeLines = Object.values(ELEMENT_DEFS)
    .map((d) => {
      const props = Object.entries(d.propsSchema)
        .map(([k, f]) => `${k}(${f.type}${f.options ? ':' + f.options.map((o) => o.value).join('|') : ''})`)
        .join(', ')
      return `- ${d.type}「${d.label}」默认尺寸 ${d.defaultSize.w}x${d.defaultSize.h}，props: ${props}`
    })
    .join('\n')

  return `你是智能家居仪表盘卡片设计师。根据用户描述，输出一个卡片设计的 JSON（不要输出任何其他文字、解释或 markdown 代码块标记，只输出纯 JSON）。

## 输出格式（schema v2）
{"version":2,"canvas":{"w":${canvas.w},"h":${canvas.h}},"elements":[...]}

每个元素：{"id":"唯一字符串","type":"元素类型","x":数字,"y":数字,"w":数字,"h":数字,"rotate":0,"props":{...}}
- 坐标原点在画布左上角，x 向右、y 向下，单位 px。元素不得超出画布（x+w<=${canvas.w}, y+h<=${canvas.h}）。
- id 用 e1、e2、e3… 即可。

## 元素 props 实时清单（以此为准）
${typeLines}

## 卡片设计规范（项目技能 hc-card-dev 单一来源，必须遵守）
${cardSpec}

## 用户本期卡片可用的实体（id → 名称）
${entityHints || '（用户未选择实体）'}`
}

// —— 容错解析模型输出 → 合法 schema v2；失败抛错 ——
export function parseAiSchema(text, canvas) {
  if (!text) throw new Error('模型未返回内容')
  let s = String(text).trim()
  // 提取 ```json ... ``` 或 ``` ... ``` 块
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  // 再兜底截取首个 { 到末尾最后一个 }
  if (!s.startsWith('{')) {
    const i = s.indexOf('{')
    const j = s.lastIndexOf('}')
    if (i < 0 || j <= i) throw new Error('模型输出中未找到 JSON')
    s = s.slice(i, j + 1)
  }
  let obj
  try {
    obj = JSON.parse(s)
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message)
  }
  if (!obj || !Array.isArray(obj.elements)) throw new Error('JSON 缺少 elements 数组')

  const cw = obj.canvas?.w || canvas.w
  const ch = obj.canvas?.h || canvas.h
  const elements = []
  let n = 0
  for (const raw of obj.elements) {
    if (!raw || !ELEMENT_DEFS[raw.type]) continue // 未知类型直接丢弃
    n++
    const def = ELEMENT_DEFS[raw.type]
    const el = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : `ai_${n}`,
      type: raw.type,
      x: clamp(Math.round(Number(raw.x) || 0), 0, cw - 8),
      y: clamp(Math.round(Number(raw.y) || 0), 0, ch - 8),
      w: clamp(Math.round(Number(raw.w) || def.defaultSize.w), 8, cw),
      h: clamp(Math.round(Number(raw.h) || def.defaultSize.h), 8, ch),
      rotate: Number(raw.rotate) || 0,
      props: { ...JSON.parse(JSON.stringify(def.defaultProps)), ...(raw.props || {}) },
    }
    // 防越界
    if (el.x + el.w > cw) el.x = Math.max(0, cw - el.w)
    if (el.y + el.h > ch) el.y = Math.max(0, ch - el.h)
    elements.push(el)
  }
  if (!elements.length) throw new Error('模型未产出任何有效元素')
  // id 去重
  const seen = new Set()
  for (const el of elements) {
    while (seen.has(el.id)) el.id += '_x'
    seen.add(el.id)
  }
  const out = { version: 2, canvas: { w: cw, h: ch }, elements }
  // 画布背景白名单透传（AI 产出图片背景只允许 http(s) URL，不允许 data:/js 注入）
  const rawBg = obj.canvas?.background
  if (rawBg && ['color', 'gradient', 'image'].includes(rawBg.type)) {
    const bg = { type: rawBg.type }
    if (rawBg.type === 'color' && rawBg.color) bg.color = String(rawBg.color)
    if (rawBg.type === 'gradient') {
      bg.from = String(rawBg.from || '#1a2a4a')
      bg.to = String(rawBg.to || '#0e1626')
      bg.angle = Number.isFinite(+rawBg.angle) ? +rawBg.angle : 135
    }
    if (rawBg.type === 'image' && /^https?:\/\//i.test(String(rawBg.image || ''))) {
      bg.image = String(rawBg.image)
      bg.fit = rawBg.fit === 'contain' ? 'contain' : 'cover'
    }
    if (bg.type !== 'image' || bg.image) out.canvas.background = bg
  }
  return out
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

---
name: hc-card-dev
description: 按本项目规范开发 HomeCanvas 仪表盘卡片（schema v2 自由画布 / 手写 html+css+js 代码卡）。当用户要求创建、修改、设计或生成卡片、卡片设计器元素、卡片交互时使用。不用于仪表盘整体布局或其他视图开发。
---

# HomeCanvas 卡片开发

卡片规范的单一来源：`app/src/components/cards/designer/cardSpec.md`（已入版本库）。
前端 AI 设计调用 `aiPrompt.js` 的 `buildSystemPrompt` 通过 `?raw` 内嵌同一文件进系统提示词，
**修改卡片规范只改 cardSpec.md**，本技能与 AI 设计调用自动同步。开发前先完整阅读该文件。

项目：Vue3+Vite 前端 `app/`，Go 后端 `server/`。

## 两种卡片形态

1. **schema v2 自由画布卡（优先）**：设计器产出的结构化 JSON，存于卡片的
   `_designerSchema` 字段，经 `elementDefs.js` 的 `renderElementsToHtml` 编译为 html。
   AI 生成卡片时**必须输出此格式**。
2. **手写代码卡**：直接给 `html` / `css` / `js` 三个字符串。仅当需求超出
   元素体系能力（复杂动画、第三方库、canvas 等）时使用。

## AI 生成卡片的工作流程

1. 读取用户勾选的实体（id + friendly_name）与画布尺寸。
2. 输出**纯 JSON** schema v2（无 markdown 围栏、无解释文字）。
3. 前端 `aiPrompt.js` 的 `parseAiSchema` 做围栏提取、JSON 校验、未知类型过滤、
   越界收敛、id 去重、背景白名单透传（图片背景仅 http(s)），再
   `designerStore.loadSchema` 落画布。
4. 设计质量要求见 cardSpec.md「设计质量要求」一节。

## 保存产物结构（designerStore.serialize → DesignerView.onSave）

```js
{
  schema,          // v2 schema（含 canvas.background），存卡片 _designerSchema 供再次编辑
  entitySlotMap,   // { entity_ids: [...] } 存卡片同名字段
  html, css, js,   // 最终代码（手改覆盖优先于编译产物）
  compiledHtml,    // 编译产物（未手改时 = html）
}
```

## 校验清单（改动后逐项过）

- [ ] 规范符合 cardSpec.md：schema 含 version:2、canvas、elements；元素 id 唯一、类型在 ELEMENT_DEFS 内
- [ ] 元素不越出画布；局部背景元素在数组最前；整卡背景用 canvas.background
- [ ] entity/button 的 props.entity 是真实存在的实体 id（对照 `entityStates`）
- [ ] 产物无写死 px 定位/字号（编译器自动转 cqw/cqh；手写卡需自查）
- [ ] 交互只用 data-hc 体系，无内联 onclick
- [ ] 前端验证：`cd app && npx vite build`；后端验证：`cd server && go build ./...`
- [ ] 只做构建验证，不部署、不启动浏览器自动化测试

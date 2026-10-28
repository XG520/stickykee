---
name: hc-card-dev
description: 按本项目规范开发 HomeCanvas 仪表盘卡片（schema v2 自由画布 / 手写 html+css+js 代码卡）。当用户要求创建、修改、设计或生成卡片、卡片设计器元素、卡片交互时使用。不用于仪表盘整体布局或其他视图开发。
---

# HomeCanvas 卡片开发

卡片 AI 设计规范的单一来源：`app/src/ai/card-designer.md`（已入版本库）。
CardEditor.vue 的 `aiSystemPrompt()` 通过 `?raw` 将该文件内联为 /ai/chat 的系统提示词，
并拼接动态上下文（本次可用占位符、勾选实体、修改模式下的现有卡片代码）。
**调整 AI 生成卡片的质量/规范只改 card-designer.md**；主题配色设计同理走
`app/src/ai/theme-designer.md`（设置页自定义调色板的 AI 设计功能）。
开发前先完整阅读对应文件。

项目：Vue3+Vite 前端 `app/`，Go 后端 `server/`。

## 现状说明（2026-10 校正）

- 线上 AI 生成路径：CardEditor.vue → `api.aiChat` → 输出 `{title,icon,w,h,html,css}` 手写代码卡。
- 本文件先前描述的 schema v2 设计器链路（`designer/aiPrompt.js`、`cardSpec.md`、
  `elementDefs.js`、`designerStore`）在当前代码库中已不存在；卡片数据模型仍保留
  `_designerSchema` / `compiledHtml` / `entitySlotMap` 字段用于渲染存量卡片
  （CodeCard.vue 按 schema 渲染），新卡片走手写代码卡路径。

## 校验清单（改动后逐项过）

- [ ] AI 提示词规范符合 card-designer.md；动态上下文（占位符/实体/现有代码）拼接正确
- [ ] 交互只用 data-hc 体系，无内联 onclick
- [ ] 前端验证：`cd app && npx vite build`；后端验证：`cd server && go build ./...`
- [ ] 只做构建验证，不部署、不启动浏览器自动化测试

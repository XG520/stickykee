# HomeCanvas 卡片设计规范（单一来源）

本文件是卡片规范的唯一来源，同时被两处使用：

- 项目技能 `.trae/skills/hc-card-dev/SKILL.md`（IDE 内 AI 代理开发卡片时阅读）
- 前端 AI 设计调用 `app/src/components/cards/designer/aiPrompt.js`
  （`buildSystemPrompt` 通过 `?raw` 原样内嵌本文件进系统提示词）

**修改卡片规范只改本文件**，两处消费方自动同步。

## 渲染管线

卡片最终由 `app/src/components/cards/CodeCard.vue` 渲染（`v-html` + `{{占位符}}` 注入
+ data-hc 事件委托），任何卡片产物都必须能在该管线中工作。卡片随仪表盘格宽变化，
产物一律用 `cqw/cqh` 容器查询单位（根容器 `.hc` 带 `container-type: size`），
禁止写死 px 定位/字号（schema v2 编译器自动转换；手写代码卡需自查）。

## schema v2 格式

```json
{
  "version": 2,
  "canvas": { "w": 480, "h": 240 },
  "elements": [
    { "id": "e1", "type": "rect", "x": 0, "y": 0, "w": 480, "h": 240, "rotate": 0, "props": {} }
  ]
}
```

- 坐标系：左上角原点，x 向右 y 向下，单位 px（设计基准 1 格 = 120px，画布 480×240 = 4×2 格）。
- 元素不得超出画布；elements 数组顺序 = 图层 z 序（局部背景矩形放数组最前）。
- `id` 必须唯一。

## 画布背景（canvas.background，可选）

整张卡的背景挂在 canvas 上，编译时内联到 `.hc` 根容器 style
（`elementDefs.js` 的 `canvasBackgroundStyle`），优先级高于壳层样式；三选一：

- `{"type":"color","color":"#16213e"}`：纯色（CSS 值，可用 CSS 变量）。
- `{"type":"gradient","from":"#1a2a4a","to":"#0e1626","angle":135}`：线性渐变，angle 缺省 135。
- `{"type":"image","image":"https://...","fit":"cover"}`：图片，fit 取 `cover|contain`。
  用户上传图为 dataURL（设计器上传限 800KB）；**AI 产出只许 http(s) URL**
  （`parseAiSchema` 白名单校验，data:/其他协议会被丢弃）。
- 省略该字段 = 无背景（用卡片壳层默认底色）。

## 元素类型

注册表见 `elementDefs.js` 的 `ELEMENT_DEFS`（defaultSize / defaultProps / propsSchema，
propsSchema 驱动属性面板表单）：

| type | 用途 | 关键 props |
|---|---|---|
| `text` | 文本 | text, fontSize, color, weight, align |
| `icon` | Material Symbols 图标 | icon（图标名）, fontSize, color |
| `image` | 图片 | url（http(s)/data:）, fit(cover/contain), radius, opacity |
| `rect` | 矩形/局部背景 | background, radius, borderColor, borderWidth, opacity |
| `entity` | 实体实时状态 | entity（实体 id）, showIcon, showName, showState, showUnit, fontSize, color |
| `button` | 交互按钮 | text 或 glyph, action(none/toggle/link), entity, href, background, color |

新增元素类型时：在 `ELEMENT_DEFS` 加定义，在 `renderInner` 的 switch 加渲染分支；
画布预览与产物共用同一渲染器，无需改他处。

## 实体与占位符约定

- `entity` 元素把实体 id 写进 `props.entity`。编译时该元素占一个槽位下标 i，
  产物输出 `{{s_entity_ids_<i>_icon}}` / `{{s_entity_ids_<i>_name}}` /
  `{{s_entity_ids_<i>_state}}` / `{{s_entity_ids_<i>_unit}}` 占位符，
  同时把实体 id 收集进 `entitySlotMap.entity_ids[i]`。
- 运行时 CodeCard 经 `bindingSlotTokens`（data.js）注入实时值，`renderTemplate`
  （defaults.js）做 `{{key}}` 替换，缺失的占位符原样保留。
- 手写代码卡可直接使用上述占位符，但必须在卡片的 `entitySlotMap` 中登记对应槽位
  （`{ "entity_ids": ["light.xxx", ...] }`），下标与占位符中的 i 一一对应。
- 不依赖卡片主实体的多实体展示一律走 `s_entity_ids_*`。

## 交互约定（data-hc 事件委托，CodeCard.vue onClick/onInput/onChange）

- `data-hc="toggle"` `data-entity="light.xxx"`：切换实体开关（data-entity 可空 = 卡片主实体）。
- `data-hc="svc"` `data-svc="domain.service"` `data-args='{"k":"v"}'`：调 HA 服务；
  `data-from="CSS选择器"` 可取输入控件的 value 作为 service_data.value。
- `data-hc="link"` `data-href="/map"`：路由跳转。
- `data-hc="range"` `data-svc data-key data-div`：滑条拖动实时上报（120ms 节流）。
- `data-hc="select"` `data-key`：下拉/滑条松手补发。
- svc/toggle 已内置乐观更新与 1s 防连点，产物**不要**自己写 onclick 或 js 轮询状态。

## CSS 变量（主题自适应，优先使用）

`var(--hc-text)` 主文字、`var(--hc-primary)` / `var(--hc-color)` 主题色、
`var(--hc-bg2)` 次背景、`var(--hc-border)` 边框、`var(--hc-sub)` 次要文字。
图标字体类：`material-symbols-outlined`。

## 设计质量要求

- 整卡氛围用 `canvas.background`（渐变优先），局部面板用背景 rect 垫底。
- 标题 13-16px / 状态 10-12px；合理留白、对齐、层级分明。
- 深色背景配浅色文字；深色场景用 CSS 变量而非硬编码色值。
- 图标用 Material Symbols 图标名（如 home、lightbulb、thermostat、power_settings_new）。

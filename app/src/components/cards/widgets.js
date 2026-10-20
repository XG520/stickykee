// 卡片组件库：图形设计模式下可拖入 / 点按插入的控件定义。
// 纯数据 + 纯函数，零 DOM 依赖（VisualStage 插入器与 CardEditor 面板共用）。
// 约定：
//  - def.html 不含 position/left/top/width/height（由插入器按落点统一写入），也不含 data-vid；
//  - 数据绑定类控件的 {{token}} 只出现在文本节点，绝不写进 style 属性
//    （DOMParser 会丢弃含 {{}} 的非法声明，详见 VisualStage 的 rawGet/rawSet 注释）；
//  - 颜色一律走主题变量 var(--hc-color,var(--hc-primary)) / var(--hc-bg2) / var(--hc-border)，
//    自动跟随深浅主题，不写死色值。

export const WIDGET_GROUPS = [
  { key: 'basic', label: '文字与图标' },
  { key: 'state', label: '状态与胶囊' },
  { key: 'shape', label: '容器与形状' },
  { key: 'data', label: '数据绑定' },
]

// 数据绑定占位符标记：widgetHtml 会用实际 token（或 fallback）整体替换它
const V = '%%v%%'

export const WIDGET_DEFS = [
  // ---- 文字与图标 ----
  {
    key: 'text', label: '文字', icon: 'text_fields', group: 'basic', w: 60, h: 16,
    html: '<span style="display:inline-block;color:var(--hc-text);font-size:10px;font-weight:600;white-space:nowrap">文字</span>',
  },
  {
    key: 'big', label: '大数字', icon: 'tag', group: 'basic', w: 56, h: 30,
    html: '<span style="display:inline-block;color:var(--hc-text);font-size:20px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums">--</span>',
  },
  {
    key: 'sub', label: '说明文字', icon: 'notes', group: 'basic', w: 64, h: 12,
    html: '<span style="display:inline-block;color:var(--hc-sub);font-size:8px;white-space:nowrap">说明文字</span>',
  },
  {
    key: 'icon', label: '图标', icon: 'emoji_symbols', group: 'basic', w: 26, h: 26,
    html: '<span class="material-symbols-outlined" style="font-size:22px;color:var(--hc-color,var(--hc-primary))">widgets</span>',
  },
  // ---- 状态与胶囊 ----
  {
    key: 'badge', label: '徽章', icon: 'label', group: 'state', w: 44, h: 14,
    html: '<span class="h-badge b-on">已开启</span>',
  },
  {
    key: 'chip', label: '胶囊标签', icon: 'sell', group: 'state', w: 48, h: 16,
    html: '<span style="display:inline-flex;align-items:center;padding:1px 7px;border-radius:99px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub);font-size:8px;white-space:nowrap">标签</span>',
  },
  {
    key: 'dot', label: '状态圆点', icon: 'radio_button_checked', group: 'state', w: 6, h: 6,
    html: '<span style="display:inline-block;border-radius:99px;background:var(--hc-success)"></span>',
  },
  // ---- 容器与形状 ----
  {
    key: 'panel', label: '面板底衬', icon: 'crop_square', group: 'shape', w: 90, h: 40,
    html: '<div style="border-radius:10px;background:var(--hc-bg2);border:1px solid var(--hc-border)"></div>',
  },
  {
    key: 'line', label: '分隔线', icon: 'horizontal_rule', group: 'shape', w: 90, h: 2,
    html: '<div style="border-radius:99px;background:var(--hc-border)"></div>',
  },
  {
    key: 'bar', label: '进度条', icon: 'linear_scale', group: 'shape', w: 90, h: 6,
    html: '<div style="border-radius:99px;background:var(--hc-bg2);overflow:hidden"><div style="width:60%;height:100%;border-radius:99px;background:var(--hc-color,var(--hc-primary))"></div></div>',
  },
  {
    // 不写 data-hc，插入到仪表盘后仅作图形，不触发任何真实设备操作
    key: 'btn', label: '图标按钮', icon: 'radio_button_unchecked', group: 'shape', w: 26, h: 26,
    html: '<button class="h-btn"><span class="material-symbols-outlined" style="font-size:14px">power_settings_new</span></button>',
  },
  // ---- 数据绑定（token 化，运行时跟随实体数据刷新） ----
  {
    key: 'dname', label: '实体名称', icon: 'badge', group: 'data', w: 70, h: 14,
    tokens: ['name'], fallback: '名称',
    html: '<span style="display:inline-block;max-width:100%;color:var(--hc-text);font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + V + '</span>',
  },
  {
    key: 'dvalue', label: '当前数值', icon: 'speed', group: 'data', w: 56, h: 30,
    tokens: ['mainValue', 'state', 'temp', 'target'], fallback: '--',
    html: '<span style="display:inline-block;color:var(--hc-text);font-size:20px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums">' + V + '</span>',
  },
  {
    key: 'dstate', label: '状态文案', icon: 'toggle_on', group: 'data', w: 44, h: 14,
    tokens: ['stateLabel', 'badge'], fallback: '状态',
    html: '<span class="h-badge b-on">' + V + '</span>',
  },
]

export function widgetDef(key) {
  return WIDGET_DEFS.find((d) => d.key === key) || null
}

// 按 def.tokens 顺序取首个有值的 token；都没有则返回空串（由调用方回落 fallback）
export function pickToken(def, data) {
  const list = def?.tokens
  if (!Array.isArray(list) || !list.length) return ''
  for (const k of list) {
    const v = data?.[k]
    if (v !== null && v !== undefined && String(v) !== '') return k
  }
  return ''
}

// 生成最终 HTML：静态控件原样返回；数据绑定控件把 %%v%% 换成 {{token}} 或 fallback 文案
export function widgetHtml(def, data) {
  if (!def) return ''
  const key = pickToken(def, data)
  const fill = key ? '{{' + key + '}}' : (def.fallback ?? '')
  return String(def.html).replace(/%%v%%/g, fill)
}

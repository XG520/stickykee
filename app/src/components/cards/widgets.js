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
  { key: 'media', label: '图片与背景' },
  { key: 'state', label: '状态与胶囊' },
  { key: 'shape', label: '容器与形状' },
  { key: 'data', label: '实体与数据' },
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
  // ---- 图片与背景 ----
  {
    // 图片模型：插入后选中它，在右侧属性条「图片地址」里换成自己的图
    key: 'image', label: '图片', icon: 'image', group: 'media', w: 56, h: 56,
    html: '<img style="display:block;object-fit:cover;border-radius:8px;width:100%;height:100%" alt="" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'56\' height=\'56\'%3E%3Crect width=\'56\' height=\'56\' rx=\'8\' fill=\'%232a2b2f\'/%3E%3Cpath d=\'M16 38l8-9 6 6 9-11 7 14z\' fill=\'%2355565c\'/%3E%3Ccircle cx=\'21\' cy=\'19\' r=\'3\' fill=\'%2355565c\'/%3E%3C/svg%3E" />',
  },
  {
    // 背景模型：铺满整卡的底层装饰（插入器特判 def.bg：落 0,0、100% 尺寸、置于最底层）
    key: 'bg', label: '背景层', icon: 'wallpaper', group: 'media', w: 0, h: 0, bg: true,
    html: '<div style="background:linear-gradient(135deg,rgba(245,166,35,.12),rgba(107,163,217,.1));border-radius:inherit"></div>',
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
  {
    // 弹窗层：铺满整卡、运行时默认隐藏（CodeCard 的 .hc-pop 规则），
    // 由 data-hc="pop" 打开 / data-hc="popclose" 与点背板关闭；设计器切到「弹窗层」后强制显示以编辑内容
    key: 'pop', label: '弹窗层', icon: 'web_asset', group: 'shape', pop: true, w: 0, h: 0,
    html: '<div class="hc-pop" style="position:absolute;inset:0;z-index:60;align-items:center;justify-content:center;background:rgba(0,0,0,.45);border-radius:14px"><div class="hc-pop-inner" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:70px;min-height:36px;padding:10px 12px;border-radius:12px;background:var(--hc-bg2);border:1px solid var(--hc-border)"><span style="font-size:10px;color:var(--hc-text)">弹窗内容</span><button data-hc="popclose" style="border:none;border-radius:99px;padding:2px 10px;background:var(--hc-color,var(--hc-primary));color:#fff;font-size:9px;cursor:pointer">关闭</button></div></div>',
  },
  {
    // 弹窗按钮：点击打开卡片里的弹窗层（data-pop 可填目标弹窗 data-vid，留空取第一个 .hc-pop）
    key: 'popbtn', label: '弹窗按钮', icon: 'smart_button', group: 'shape', w: 62, h: 16,
    html: '<button data-hc="pop" style="border:none;border-radius:99px;padding:3px 10px;background:var(--hc-color,var(--hc-primary));color:#fff;font-size:9px;cursor:pointer;white-space:nowrap">打开弹窗</button>',
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
  {
    // 实体开关按钮：绑定卡片实体，运行时点击切换开关（data-hc="toggle" 由 CodeCard 事件委托处理；
    // 需定向到其他实体时在元素代码里加 data-entity="xxx.yyy"）
    key: 'etoggle', label: '开关按钮', icon: 'power_settings_new', group: 'data', w: 26, h: 26,
    html: '<button data-hc="toggle" class="h-btn"><span class="material-symbols-outlined" style="font-size:14px">power_settings_new</span></button>',
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

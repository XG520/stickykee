// 卡片默认 HTML/CSS 模板生成器 —— 按卡组产出「独立自包含」的代码模板。
// 约定：
//  - 模板内 {{xxx}} 为数据占位符（运行时由 data.js 提供值替换）
//  - 颜色统一用 CSS 变量 --hc-color（CodeCard 按领域注入色值，用户可在 CSS 里覆盖）
//  - 交互通过 data-hc 属性 + 事件委托实现（见 CodeCard.vue）：
//      data-hc="toggle"                      点击切换实体开关
//      data-hc="svc"   data-svc="d.svc"      点击调用 HA 服务（data-args 静态参数 / data-from 取输入值）
//      data-hc="range" data-svc="d.svc" data-key="k"   滑条输入实时调用
//      data-hc="select" data-svc="d.svc"     select 变化调用（参数 option）
//      data-hc="link"  data-href="#/map"     跳转

// 公共外壳样式（每张卡的 CSS 都以此为基底）
// 设计语言：统一卡片壳（细边框 + 顶光渐变 + 柔和落影）、头部图标升级为类型色芯片、
// 徽章/按钮/大数字统一排版节奏——与设备聚合卡 .dk 保持同一视觉体系。
export const SHELL_BASE = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;overflow:hidden;padding:8px;border-radius:14px;
  background:linear-gradient(165deg,rgb(255 255 255 / .05),rgb(255 255 255 / 0) 46%),color-mix(in srgb,var(--hc-bg2) 72%,var(--hc-bg));
  border:1px solid var(--hc-border);
  /* 边框厚度补偿：仪表盘/预览以 transform:scale 等比放大整卡，1px 会被同步放大
     （桌面端约 1.2~1.9px）。视图层按缩放系数把补偿值写入 --card-bw，
     使最终渲染的边框厚度恒定 ≈1px；无该变量的场景回落 1px，视觉不变 */
  border-width:var(--card-bw,1px);
  box-shadow:0 1px 3px rgb(0 0 0 / .07),0 8px 20px -8px rgb(0 0 0 / .16)}
.h-head{display:flex;align-items:center;gap:5px;min-width:0}
.h-ic{width:18px;height:18px;font-size:11px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:6px;
  color:var(--hc-color,var(--hc-primary));
  background:color-mix(in srgb,var(--hc-color,var(--hc-primary)) 13%,transparent);
  border:1px solid color-mix(in srgb,var(--hc-color,var(--hc-primary)) 26%,transparent)}
.h-t{font-size:10px;font-weight:600;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.h-badge{font-size:8px;font-weight:600;padding:1.5px 7px;border-radius:99px;flex-shrink:0;white-space:nowrap}
.b-on{background:rgb(var(--hc-success-rgb) / .15);color:var(--hc-success)}
.b-off{background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub)}
.b-warn{background:rgb(var(--hc-warn-rgb) / .15);color:var(--hc-warn)}
.h-mut{font-size:8px;color:var(--hc-sub)}
.h-fill{flex:1;min-height:0}
.h-mid{display:flex;align-items:center;justify-content:center}
.h-btn{display:flex;align-items:center;justify-content:center;border:1px solid var(--hc-color,var(--hc-primary));background:rgb(var(--hc-primary-rgb) / .12);color:var(--hc-color,var(--hc-primary));border-radius:99px;cursor:pointer;transition:all .15s}
.h-btn:hover{background:rgb(var(--hc-primary-rgb) / .22);box-shadow:0 0 0 3px rgb(var(--hc-primary-rgb) / .08)}
.h-btn:active{transform:scale(.9)}
.h-btn[disabled]{opacity:.4;cursor:default}
.h-btn:empty{display:none}
.h-btn-ghost{background:var(--hc-bg2);border-color:var(--hc-border);color:var(--hc-sub)}
.h-cell{background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:3px 5px;text-align:center;min-width:0}
.h-row{display:flex;align-items:center;gap:4px;min-width:0}
.h-big{font-size:20px;font-weight:700;color:var(--hc-text);line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.h-num{font-size:13px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}
.h-cap{font-size:7px;color:var(--hc-sub);font-style:normal}
.h-bar{width:100%;height:3px;accent-color:var(--hc-color,var(--hc-primary));cursor:pointer}`

// 实体控件样式（entityControls 渲染出的 .h-ctl/.h-lb/.h-vv/.h-sel/.h-chip/.h-tin）。
// 单独导出：卡片 CSS 是创建时的快照，历史卡片迁移时需要把这段补进去。
export const CTL_CSS = `
.h-ctl{display:flex;align-items:center;gap:4px;min-width:0}
.h-ctl .h-lb{font-size:8px;color:var(--hc-sub);white-space:nowrap;flex-shrink:0}
.h-ctl .h-vv{font-size:8px;font-weight:600;color:var(--hc-text);margin-left:auto;white-space:nowrap}
.h-ctl .h-bar{flex:1;min-width:0}
.h-sel{flex:1;min-width:0;font-size:8px;padding:1px 2px;border-radius:6px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-text);outline:none}
.h-chip{font-size:8px;padding:1px 6px;border-radius:99px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:2px}
.h-chip.on{background:rgb(var(--hc-primary-rgb) / .15);border-color:var(--hc-color,var(--hc-primary));color:var(--hc-color,var(--hc-primary))}
.h-chip:active{transform:scale(.93)}
.h-tin{flex:1;min-width:0;font-size:8px;padding:1px 4px;border-radius:6px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-text);outline:none}`

const shell = SHELL_BASE + CTL_CSS

// 边框厚度补偿片段：与上面三处外壳（.hc/.dk/.hcm）的 border-width 覆盖等价，
// 单独导出供 dashboard.js 迁移历史卡片 CSS 快照时追加（卡片 CSS 是创建时的快照）。
export const BORDER_CSS = `
.hc,.dk,.hcm{border-width:var(--card-bw,1px)}`

const head = `<div class="h-head"><span class="h-ic material-symbols-outlined">{{glyph}}</span><span class="h-t">{{name}}</span>{{badge}}</div>`

// 空态 / 缺实体
const empty = `<div class="h-fill h-mid"><span class="h-mut">{{emptyText}}</span></div>`

// ================= 1. 开关类（light/switch/plug/fan/valve/input_boolean/group/remote/siren/humidifier） =================
export function tplToggle() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{onCls}}"><i class="dot"></i>{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{state}}</span>
  </div>
  <div class="h-fill h-mid">
    <button class="h-btn" style="width:44px;height:44px;border-radius:99px" data-hc="toggle">
      <span class="material-symbols-outlined" style="font-size:22px;color:{{onColor}}">{{glyph}}</span>
    </button>
  </div>
  <div class="h-ctl" style="flex-direction:column;gap:3px;align-items:stretch">{{controlsHtml}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.dot{display:inline-block;width:5px;height:5px;border-radius:99px;margin-right:3px;background:currentColor}`
  return { html, css }
}

// ================= 2. 传感器类（sensor/number/input_number/counter） =================
export function tplSensor() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">
    <div class="h-row" style="gap:4px">
      <span class="h-big">{{mainValue}}</span>
      <span class="h-mut">{{mainUnit}}</span>
    </div>
  </div>
  <div class="h-fill">{{attrsHtml}}{{stepHtml}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.attrs{display:flex;flex-direction:column;gap:2px;justify-content:flex-end}
.attr{display:flex;justify-content:space-between;gap:4px;font-size:8px;min-width:0}
.attr b{color:var(--hc-text);font-weight:600}
.step{display:flex;align-items:center;justify-content:center;gap:6px}
.step .h-btn{width:22px;height:22px;font-size:12px;border-radius:6px}`
  return { html, css }
}

// ================= 3. 二值传感器 =================
export function tplBinary() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">
    <span class="material-symbols-outlined" style="font-size:30px;color:{{onColor}}">{{glyph}}</span>
  </div>
  <div class="h-mid"><span class="h-badge {{onCls}}">{{stateLabel}}</span></div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 4. 空调/恒温类（climate/water_heater/humidifier） =================
export function tplClimate() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">
    <div class="h-row" style="gap:2px">
      <span class="h-big">{{temp}}</span>
      <span class="h-mut">{{tempUnit}}</span>
      <span class="h-mut" style="margin-left:4px">目标 {{target}}</span>
    </div>
  </div>
  <div class="hvac">{{hvacHtml}}</div>
  <div class="h-ctl" style="flex-wrap:wrap">{{extraControls}}</div>
  <div class="h-row" style="justify-content:center">
    <button class="h-btn h-btn-ghost" style="width:24px;height:24px" data-hc="svc" data-svc="{{setSvc}}" data-args="{{decArgs}}"><span class="material-symbols-outlined" style="font-size:12px">remove</span></button>
    <span class="h-num" style="font-size:10px">{{modeLabel}}</span>
    <button class="h-btn h-btn-ghost" style="width:24px;height:24px" data-hc="svc" data-svc="{{setSvc}}" data-args="{{incArgs}}"><span class="material-symbols-outlined" style="font-size:12px">add</span></button>
  </div>
</div>`
  const css = shell + `
.hc{padding:6px}
.hvac{display:flex;flex-wrap:wrap;gap:3px}
.hvac span{font-size:8px;padding:1px 6px;border-radius:99px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub);cursor:pointer}
.hvac span.on{background:rgb(var(--hc-primary-rgb) / .15);border-color:var(--hc-color,var(--hc-primary));color:var(--hc-color,var(--hc-primary))}`
  return { html, css }
}

// ================= 5. 窗帘/卷帘（cover） =================
export function tplCover() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">
    <span class="material-symbols-outlined" style="font-size:28px;color:{{onColor}}">{{glyph}}</span>
  </div>
  <div class="h-row">
    <span class="h-badge {{onCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{posText}}</span>
  </div>
  <div class="h-ctl" style="flex-direction:column;gap:3px;align-items:stretch">{{controlsHtml}}</div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 6. 媒体播放（media_player） =================
export function tplMedia() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid" style="flex-direction:column;gap:2px">
    <span class="material-symbols-outlined" style="font-size:26px;color:var(--hc-color,var(--hc-success))">{{mediaGlyph}}</span>
    <span class="h-mut" style="font-size:9px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{mediaTitle}}</span>
  </div>
  <div class="h-row" style="justify-content:center;gap:8px">
    <button class="h-btn h-btn-ghost" style="width:24px;height:24px" data-hc="svc" data-svc="media_player.media_previous_track"><span class="material-symbols-outlined" style="font-size:12px">skip_previous</span></button>
    <button class="h-btn" style="width:34px;height:34px" data-hc="svc" data-svc="{{playSvc}}"><span class="material-symbols-outlined" style="font-size:16px">{{playIcon}}</span></button>
    <button class="h-btn h-btn-ghost" style="width:24px;height:24px" data-hc="svc" data-svc="media_player.media_next_track"><span class="material-symbols-outlined" style="font-size:12px">skip_next</span></button>
  </div>
  <div class="h-row"><input class="h-bar" type="range" min="0" max="100" value="{{volumePct}}" data-hc="range" data-svc="media_player.volume_set" data-key="volume_level" data-div="100"></div>
  <div class="h-ctl" style="flex-wrap:wrap">{{extraControls}}</div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 7. 安防类（lock/alarm_control_panel） =================
export function tplSecurity() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">
    <span class="material-symbols-outlined" style="font-size:28px;color:{{onColor}}">{{glyph}}</span>
  </div>
  <div class="h-mid"><span class="h-badge {{onCls}}">{{stateLabel}}</span></div>
  <div class="h-row" style="justify-content:center;gap:6px">{{secBtns}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.secb{font-size:8px;padding:3px 8px;border-radius:99px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub);cursor:pointer}
.secb.on{background:rgb(var(--hc-success-rgb) / .15);border-color:var(--hc-success);color:var(--hc-success)}
.secb:active{transform:scale(.93)}`
  return { html, css }
}

// ================= 8. 摄像头 =================
export function tplCamera() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill" style="position:relative;background:var(--hc-bg);border:1px solid var(--hc-border);border-radius:8px;overflow:hidden">
    <img src="{{cameraUrl}}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'" alt="">
    <span class="h-mut" style="position:absolute;left:4px;bottom:2px;background:rgb(var(--hc-bg-rgb) / .6);padding:0 4px;border-radius:4px">{{stateLabel}}</span>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 9. 扫地机（vacuum） =================
export function tplVacuum() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{runCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{detail}}</span>
  </div>
  <div class="h-fill h-mid" style="gap:8px">
    <button class="h-btn" style="width:32px;height:32px" data-hc="svc" data-svc="vacuum.start"><span class="material-symbols-outlined" style="font-size:15px">play_arrow</span></button>
    <button class="h-btn h-btn-ghost" style="width:32px;height:32px" data-hc="svc" data-svc="{{pauseSvc}}"><span class="material-symbols-outlined" style="font-size:15px">{{pauseIcon}}</span></button>
    <button class="h-btn h-btn-ghost" style="width:32px;height:32px" data-hc="svc" data-svc="vacuum.return_to_base"><span class="material-symbols-outlined" style="font-size:15px">home</span></button>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 10. 一键执行（scene/script/automation/button/input_button） =================
export function tplAction() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">
    <button class="h-btn" style="width:44px;height:44px;border-radius:99px" data-hc="svc" data-svc="{{runSvc}}">
      <span class="material-symbols-outlined" style="font-size:22px">{{glyph}}</span>
    </button>
  </div>
  <div class="h-mid"><span class="h-mut">{{stateText}}</span></div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 11. 设备聚合卡（generic）：按设备类型定制视觉 =================
export function tplGeneric() {
  const html = `<div class="dk {{activeCls}} {{shortCls}}" style="--dk:{{kindColor}};--dk-rgb:{{kindColorRgb}}">
  <div class="dk-glow"></div>
  <div class="dk-head">
    <span class="dk-logo"><span class="material-symbols-outlined">{{kindIcon}}</span></span>
    <span class="dk-name">{{name}}</span>
    <span class="dk-tag">{{kindLabel}}</span>
  </div>
  <div class="dk-hero {{heroBtnCls}}" {{heroClickAttrs}}>
    <div class="dk-info">
      <span class="dk-big">{{bigHtml}}</span>
      <span class="dk-sub">{{sub}}</span>
    </div>
    <span class="dk-state {{stateCls}}">{{state}}</span>
  </div>
  <div class="g-rows dk-rows {{rowsHideCls}}">{{rowsHtml}}</div>
</div>`
  const css = `
.dk{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;padding:7px;position:relative;overflow:hidden;border-radius:14px;
  background:linear-gradient(165deg,rgb(255 255 255 / .05),rgb(255 255 255 / 0) 46%),color-mix(in srgb,var(--hc-bg2) 72%,var(--hc-bg));
  border:1px solid var(--hc-border);border-width:var(--card-bw,1px);
  box-shadow:0 1px 3px rgb(0 0 0 / .07),0 8px 20px -8px rgb(0 0 0 / .16)}
/* 顶部类型色光晕：默认隐于背景，激活态显现 */
.dk-glow{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s;
  background:radial-gradient(135% 58% at 50% -28%, rgb(var(--dk-rgb) / .17), transparent 68%)}
.dk.is-active .dk-glow{opacity:1}
.dk.is-active{box-shadow:inset 0 0 0 1px rgb(var(--dk-rgb) / .4), 0 2px 14px rgb(var(--dk-rgb) / .14), 0 8px 20px -8px rgb(0 0 0 / .16)}
/* 头部：渐变 Logo + 设备名 + 类型标签 */
.dk-head{display:flex;align-items:center;gap:5px;min-width:0;position:relative;z-index:1}
.dk-logo{width:20px;height:20px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;
  background:rgb(var(--dk-rgb) / .13);color:var(--dk);border:1px solid rgb(var(--dk-rgb) / .28);transition:all .2s}
.dk-logo .material-symbols-outlined{font-size:12px;line-height:1}
.dk.is-active .dk-logo{background:linear-gradient(140deg,var(--dk),color-mix(in srgb,var(--dk) 55%,#000));
  color:#fff;border-color:transparent;box-shadow:0 1px 5px rgb(var(--dk-rgb) / .45)}
.dk-name{flex:1;min-width:0;font-size:9.5px;font-weight:600;color:var(--hc-text);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dk-tag{flex:none;font-size:7px;line-height:14px;color:var(--dk);
  background:rgb(var(--dk-rgb) / .1);border:1px solid rgb(var(--dk-rgb) / .2);border-radius:5px;padding:0 5px}
/* 主状态区：左列大字+副文本，右侧状态徽章；可控制时整块可点 */
.dk-hero{position:relative;z-index:1;display:flex;align-items:center;gap:6px;min-width:0;
  padding:5px 7px;border-radius:8px;cursor:default;border:1px solid var(--hc-border);
  background:linear-gradient(180deg,rgb(var(--dk-rgb) / .07),transparent),var(--hc-bg2);transition:all .15s}
.dk-hero.is-btn{cursor:pointer}
.dk-hero.is-btn:hover{border-color:rgb(var(--dk-rgb) / .55);background:rgb(var(--dk-rgb) / .1)}
.dk-hero.is-btn:active{transform:scale(.985)}
.dk-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dk-big{display:flex;align-items:center;gap:2px;min-width:0;
  font-size:18px;font-weight:700;line-height:1.05;color:var(--hc-text)}
.dk-big small{font-size:8px;font-weight:500;color:var(--hc-sub)}
.dk-big .material-symbols-outlined{font-size:20px;line-height:1;color:var(--dk)}
.dk-sub{font-size:7.5px;line-height:1.25;color:var(--hc-sub);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dk-state{flex:none;font-size:7px;line-height:15px;padding:0 7px;border-radius:99px;white-space:nowrap;
  background:rgb(var(--dk-rgb) / .12);color:var(--dk);border:1px solid rgb(var(--dk-rgb) / .22)}
.dk-state.is-on{background:rgb(var(--dk-rgb) / .2);border-color:rgb(var(--dk-rgb) / .45)}
.dk-state.is-ok{background:rgb(var(--hc-success-rgb) / .15);color:var(--hc-success);border-color:rgb(var(--hc-success-rgb) / .3)}
.dk-state.is-warn{background:rgb(var(--hc-warn-rgb) / .17);color:var(--hc-warn);border-color:rgb(var(--hc-warn-rgb) / .35)}
/* 其余实体行：无边框轻列表，hover 类型色高亮；有内容时以细分隔线与主状态区分隔 */
.g-rows{position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;gap:1px;
  overflow-y:auto;padding:0;scrollbar-width:thin}
.g-rows.is-empty{display:none}
.g-rows:not(.is-empty){border-top:1px solid color-mix(in srgb,var(--hc-border) 55%,transparent);margin-top:2px;padding-top:3px}
.g-rows::-webkit-scrollbar{width:3px}
.g-rows::-webkit-scrollbar-thumb{background:var(--hc-border);border-radius:3px}
.grow{display:flex;align-items:center;gap:5px;min-width:0;padding:2px 5px;border-radius:6px;border:1px solid transparent}
.grow:hover{background:rgb(var(--dk-rgb) / .08);border-color:rgb(var(--dk-rgb) / .16)}
.g-ic{font-size:11px;line-height:1;flex:none}
.g-nm{flex:1;min-width:0;font-size:8px;color:var(--hc-text);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-st{flex:none;max-width:80px;font-size:8px;color:var(--hc-sub);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-tg{flex:none;width:18px;height:18px;padding:0;border-radius:99px;border:1px solid var(--hc-border);
  background:var(--hc-bg2);color:var(--hc-sub);display:flex;align-items:center;justify-content:center;cursor:pointer}
.g-tg .material-symbols-outlined{font-size:10px;line-height:1}
.g-tg.on{background:color-mix(in srgb,var(--gc,var(--dk)) 18%,var(--hc-bg2));
  border-color:var(--gc,var(--dk));color:var(--gc,var(--dk))}
/* 高卡（h=2）：主状态放大，给大字区更多呼吸空间 */
.dk.is-tall .dk-big{font-size:26px}
.dk.is-tall .dk-big .material-symbols-outlined{font-size:28px}
.dk.is-tall .dk-hero{padding:7px 9px}
`
  return { html, css }
}

/* 实体组卡：卡面只显示组名（图标 + 设备数徽标），不列实体；
   点击卡面由上层弹出多实体控制弹窗（列表 + 行内开关 + 子控制面板）。 */
export function tplGroup() {
  const html = `<div class="gp" style="--dk-rgb:{{kindColorRgb}}">
  <div class="gp-glow"></div>
  <div class="gp-top"><span class="gp-count">{{count}} 个设备</span></div>
  <div class="gp-body">
    <span class="gp-icw"><span class="gp-ic material-symbols-outlined">{{groupIcon}}</span></span>
    <span class="gp-nm">{{name}}</span>
  </div>
</div>`
  const css = `
.gp{flex:1;min-height:0;display:flex;flex-direction:column;padding:7px;position:relative;overflow:hidden;border-radius:14px;
  background:linear-gradient(165deg,rgb(255 255 255 / .05),rgb(255 255 255 / 0) 46%),color-mix(in srgb,var(--hc-bg2) 72%,var(--hc-bg));
  border:1px solid var(--hc-border);border-width:var(--card-bw,1px);
  box-shadow:0 1px 3px rgb(0 0 0 / .07),0 8px 20px -8px rgb(0 0 0 / .16)}
.gp-glow{position:absolute;inset:0;pointer-events:none;opacity:.9;
  background:radial-gradient(135% 58% at 50% -28%, rgb(var(--dk-rgb) / .14), transparent 68%)}
.gp-top{position:relative;z-index:1;display:flex;justify-content:flex-end}
.gp-count{flex:none;font-size:7px;line-height:14px;color:rgb(var(--dk-rgb));
  background:rgb(var(--dk-rgb) / .1);border:1px solid rgb(var(--dk-rgb) / .22);border-radius:5px;padding:0 5px}
.gp-body{position:relative;z-index:1;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px}
.gp-icw{width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:rgb(var(--dk-rgb) / .13);color:rgb(var(--dk-rgb));border:1px solid rgb(var(--dk-rgb) / .28);
  box-shadow:0 2px 8px rgb(var(--dk-rgb) / .18)}
.gp-ic{font-size:19px;line-height:1}
.gp-nm{max-width:100%;font-size:11.5px;font-weight:600;color:var(--hc-text);text-align:center;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`
  return { html, css }
}

// ================= 12. 人员位置（person/device_tracker/zone） =================
export function tplPerson() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid">{{avatarHtml}}</div>
  <div class="h-mid"><span class="h-badge {{onCls}}">{{stateLabel}}</span></div>
  <div class="h-mid"><span class="h-mut">{{detail}}</span></div>
  <div class="h-sub{{subCls}}"><span class="material-symbols-outlined h-sub-ic">{{subGlyph}}</span><span class="h-sub-v">{{subValue}}</span></div>
</div>`
  const css = shell + `
.hc{padding:6px}
.avatar{width:38px;height:38px;border-radius:99px;object-fit:cover;border:2px solid var(--hc-border)}
.avatar-f{width:38px;height:38px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:2px solid var(--hc-border);background:var(--hc-bg2);color:var(--hc-color,var(--hc-success))}
.h-sub{display:flex;align-items:center;justify-content:center;gap:3px;margin-top:auto}
.h-sub.is-hide{display:none}
.h-sub-ic{font-size:10px;color:var(--hc-color,var(--hc-success));flex-shrink:0}
.h-sub-v{font-size:9px;font-weight:600;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}`
  return { html, css }
}

// ================= 12b. 人员信息（三槽位：主实体状态角标 / 中部循环翻动 / 底部滚动轮播） =================
export function tplPersonInfo() {
  // 槽位3 无缝滚动：轨道内渲染两份完全相同的内容（{{marqueeItemsHtml}}×2），
  // 每项自带右间距作间隙，位移 -50% 时第二份恰好接上第一份（从右向左，无需 JS 测量）。
  // 顶部状态跑马灯（{{headStatusHtml}}）插在 {{name}} 和 {{badge}} 之间——
  // 标题独占图标到跑马灯的全部空间，跑马灯是次要元素在标题右侧滚动，互不挤占。
  const html = `<div class="hc">
  ${head.replace('{{name}}</span>{{badge}}', '{{name}}</span>{{headStatusHtml}}{{badge}}')}
  <div class="h-fill h-mid">{{avatarHtml}}</div>
  <div class="pi-cycle{{cycleCls}}">{{cycleItemsHtml}}</div>
  <div class="pi-mq{{mqCls}}"><div class="pi-mq-in">{{marqueeItemsHtml}}{{marqueeItemsHtml}}</div></div>
</div>`
  const css = shell + `
.hc{padding:6px}
/* head 内设备状态跑马灯：在标题右侧（h-t → pi-hs → badge）从右向左滚动 */
/* 关键：跑马灯是次要元素，flex:0 0 auto + max-width:38% 不抢占标题空间 */
.h-head .pi-hs{flex:0 0 auto;min-width:0;max-width:38%;overflow:hidden}
.h-head .pi-hs.is-hide{display:none}
.h-head .pi-hs-in{display:inline-flex;align-items:center;white-space:nowrap;will-change:transform;animation:pi-mq-scroll 10s linear infinite}
.h-head .pi-hs-it{display:inline-flex;align-items:center;gap:2px;margin-right:16px;font-size:8px;font-weight:600;color:var(--hc-sub)}
/* 标题永远优先：独占剩余空间，不截断 */
.h-head .h-t{flex:1 1 auto;min-width:0;max-width:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.avatar{width:38px;height:38px;border-radius:99px;object-fit:cover;border:2px solid var(--hc-border)}
.avatar-f{width:38px;height:38px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:2px solid var(--hc-border);background:var(--hc-bg2);color:var(--hc-color,var(--hc-success))}
.pi-cycle{display:flex;align-items:center;justify-content:center;min-height:13px;min-width:0}
.pi-cycle.is-hide{display:none}
.pi-cy-item{display:none;align-items:center;gap:3px;font-size:9px;font-weight:600;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pi-cy-item.on{display:inline-flex;animation:pi-flip .45s ease}
@keyframes pi-flip{0%{opacity:0;transform:translateY(7px)}100%{opacity:1;transform:translateY(0)}}
.pi-it-ic{font-size:10px;line-height:1;flex:none;color:var(--hc-color,var(--hc-success))}
.pi-mq{margin-top:auto;min-width:0;overflow:hidden}
.pi-mq.is-hide{display:none}
.pi-mq-in{display:inline-flex;align-items:center;white-space:nowrap;will-change:transform;animation:pi-mq-scroll 14s linear infinite}
.pi-mq-it{display:inline-flex;align-items:center;gap:3px;margin-right:28px;font-size:9px;font-weight:600;color:var(--hc-sub)}
@keyframes pi-mq-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`
  return { html, css }
}

// ================= 13. 天气实体（weather） =================
export function tplWeatherEntity() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid" style="gap:6px">
    <span style="font-size:26px;line-height:1">{{icon}}</span>
    <div>
      <p style="font-size:20px;font-weight:600;color:var(--hc-text);line-height:1;margin:0">{{temp}}<small style="font-size:9px;color:var(--hc-sub)">{{unit}}</small></p>
      <p style="font-size:9px;color:var(--hc-sub);margin:1px 0 0">{{condition}}</p>
    </div>
  </div>
  <div class="h-row" style="gap:4px">
    <div class="h-cell h-fill"><span class="h-cap">体感</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{feels}}</b></div>
    <div class="h-cell h-fill"><span class="h-cap">湿度</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{humidity}}</b></div>
    <div class="h-cell h-fill"><span class="h-cap">风速</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{wind}}</b></div>
  </div>
  <div class="fc7w">{{forecastHtml}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.fc7w{flex:1;min-height:0;display:flex;min-width:0}
.fc7{flex:1;display:flex;gap:3px;min-width:0;overflow-x:auto;scrollbar-width:none}
.fc7::-webkit-scrollbar{display:none}
.fc7-d{flex:1 1 0;min-width:27px;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;gap:1px;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:3px 2px;text-align:center}
.fc7-l{font-size:8px;color:var(--hc-sub);white-space:nowrap}
.fc7-i{font-size:13px;line-height:1}
.fc7-t{display:flex;flex-direction:column;line-height:1.15;font-variant-numeric:tabular-nums}
.fc7-t b{font-size:10px;font-weight:600;color:var(--hc-text)}
.fc7-t i{font-style:normal;font-size:9px;color:var(--hc-sub)}
.fc7-p{font-size:7px;color:var(--hc-info);line-height:1}`
  return { html, css }
}

// ================= 14. 选项选择（select/input_select） =================
export function tplSelect() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid"><span class="h-badge b-off">{{stateText}}</span></div>
  <select class="sel" data-hc="select" data-svc="{{selSvc}}">{{optionsHtml}}</select>
</div>`
  const css = shell + `
.hc{padding:6px}
.sel{width:100%;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:6px;padding:3px 4px;font-size:9px;color:var(--hc-text)}
.sel:focus{border-color:var(--hc-color,var(--hc-primary));outline:none}`
  return { html, css }
}

// ================= 15. 文本（text/input_text） =================
export function tplText() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid"><span class="h-mut" style="font-size:10px;text-align:center;word-break:break-all">{{stateText}}</span></div>
  <div class="h-row" style="justify-content:center;gap:4px">
    <input class="tin" type="text" value="{{stateText}}" data-hc-input="text" placeholder="输入文本…">
    <button class="h-btn" style="padding:3px 8px;font-size:9px;border-radius:6px" data-hc="svc" data-svc="{{setSvc}}" data-from="[data-hc-input=text]"><span class="material-symbols-outlined" style="font-size:11px">check</span></button>
  </div>
</div>`
  const css = shell + `
.hc{padding:6px}
.tin{flex:1;min-width:0;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:6px;padding:2px 5px;font-size:9px;color:var(--hc-text)}
.tin:focus{border-color:var(--hc-color,var(--hc-primary));outline:none}`
  return { html, css }
}

// ================= 16. 日期时间（date/datetime/time/input_datetime） =================
export function tplDatetime() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid" style="flex-direction:column;gap:1px">
    <span class="h-big" style="font-size:16px">{{mainText}}</span>
    <span class="h-mut">{{subText}}</span>
  </div>
  <div class="h-row" style="justify-content:center;gap:4px">
    <input class="tin" type="{{inputType}}" value="{{draftVal}}" data-hc-input="dt">
    <button class="h-btn" style="padding:3px 8px;font-size:9px;border-radius:6px" data-hc="svc" data-svc="{{setSvc}}" data-from="[data-hc-input=dt]"><span class="material-symbols-outlined" style="font-size:11px">check</span></button>
  </div>
</div>`
  const css = shell + `
.hc{padding:6px}
.tin{background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:6px;padding:2px 5px;font-size:9px;color:var(--hc-text);color-scheme:var(--hc-scheme,dark)}
.tin:focus{border-color:var(--hc-color,var(--hc-primary));outline:none}`
  return { html, css }
}

// ================= 17. 计时器 =================
export function tplTimer() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid" style="flex-direction:column;gap:2px">
    <span class="h-big">{{remainText}}</span>
    <span class="h-badge {{onCls}}">{{stateLabel}}</span>
  </div>
  <div class="h-row" style="justify-content:center;gap:6px">{{timerBtns}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.tbtn{font-size:8px;padding:3px 10px;border-radius:99px;background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub);cursor:pointer}
.tbtn.on{background:rgb(var(--hc-primary-rgb) / .15);border-color:var(--hc-color,var(--hc-primary));color:var(--hc-color,var(--hc-primary))}
.tbtn:active{transform:scale(.93)}`
  return { html, css }
}

// ================= 18. 日历 =================
export function tplCalendar() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{onCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{timeRange}}</span>
  </div>
  <div class="h-fill h-mid" style="flex-direction:column;gap:2px;align-items:stretch">
    <p style="font-size:10px;font-weight:600;color:var(--hc-text);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{summary}}</p>
    <p class="h-mut" style="font-size:8px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{location}}</p>
    <p class="h-mut" style="font-size:8px;margin:0;line-height:1.4">{{description}}</p>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 19. 固件更新 =================
export function tplUpdate() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{onCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{inProgress}}</span>
  </div>
  <div class="h-fill h-mid" style="gap:6px">
    <span style="font-size:11px;font-weight:600;color:var(--hc-text)">{{installed}}</span>
    <span class="material-symbols-outlined" style="font-size:12px;color:var(--hc-color,var(--hc-warn))">arrow_forward</span>
    <span style="font-size:11px;font-weight:600;color:{{latestColor}}">{{latest}}</span>
  </div>
  <p class="h-mut" style="font-size:8px;margin:0;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">{{release}}</p>
  <div class="h-mid">
    <button class="h-btn" style="padding:3px 10px;font-size:9px;border-radius:99px" data-hc="svc" data-svc="update.install">{{installBtn}}</button>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 20. 事件 =================
export function tplEvent() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{onCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{deviceClass}}</span>
  </div>
  <div class="h-fill h-mid" style="flex-direction:column;gap:2px">
    <span class="material-symbols-outlined" style="font-size:26px;color:{{onColor}}">{{glyph}}</span>
    <span class="h-num" style="font-size:10px">{{eventType}}</span>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 21. 植物 =================
export function tplPlant() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{onCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{battery}}</span>
  </div>
  <div class="h-fill" style="display:grid;grid-template-columns:1fr 1fr;gap:3px">{{plantRows}}</div>
  <p class="h-mut" style="font-size:8px;margin:0;line-height:1.4;color:var(--hc-warn)">{{problems}}</p>
</div>`
  const css = shell + `
.hc{padding:6px}
.prow{background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:6px;padding:2px 4px;display:flex;justify-content:space-between;gap:4px;font-size:8px}
.prow span{color:var(--hc-sub)}
.prow b{color:var(--hc-text);font-weight:600}`
  return { html, css }
}

// ================= 22. 割草机 =================
export function tplLawnMower() {
  const html = `<div class="hc">
  ${head}
  <div class="h-row">
    <span class="h-badge {{runCls}}">{{stateLabel}}</span>
    <span class="h-mut" style="margin-left:auto">{{detail}}</span>
  </div>
  <div class="h-fill h-mid" style="gap:8px">
    <button class="h-btn" style="width:32px;height:32px" data-hc="svc" data-svc="lawn_mower.start_mowing"><span class="material-symbols-outlined" style="font-size:15px">play_arrow</span></button>
    <button class="h-btn h-btn-ghost" style="width:32px;height:32px" data-hc="svc" data-svc="lawn_mower.pause"><span class="material-symbols-outlined" style="font-size:15px">pause</span></button>
    <button class="h-btn h-btn-ghost" style="width:32px;height:32px" data-hc="svc" data-svc="lawn_mower.return_to_dock"><span class="material-symbols-outlined" style="font-size:15px">home</span></button>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 23. 太阳 =================
export function tplSun() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill h-mid" style="gap:6px">
    <span class="material-symbols-outlined" style="font-size:26px;color:{{onColor}}">wb_twilight</span>
    <div>
      <p style="font-size:11px;font-weight:600;color:var(--hc-text);margin:0">{{stateLabel}}</p>
      <p class="h-mut" style="font-size:8px;margin:1px 0 0">{{elevText}}</p>
    </div>
  </div>
  <div class="h-row" style="gap:4px">
    <div class="h-cell h-fill"><span class="h-cap">日出</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{rising}}</b></div>
    <div class="h-cell h-fill"><span class="h-cap">日落</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{setting}}</b></div>
    <div class="h-cell h-fill"><span class="h-cap">仰角</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{elevation}}°</b></div>
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 24. 图片 =================
export function tplImage() {
  const html = `<div class="hc">
  ${head}
  <div class="h-fill" style="position:relative;background:var(--hc-bg);border:1px solid var(--hc-border);border-radius:8px;overflow:hidden">
    <img src="{{imageUrl}}" style="width:100%;height:100%;object-fit:contain" alt="" onerror="this.style.display='none'">
  </div>
</div>`
  const css = shell + `.hc{padding:6px}`
  return { html, css }
}

// ================= 25. 问候卡片 =================
export function tplGreeting() {
  const html = `<div class="hc">
  <span class="deco"></span>
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-primary)">{{glyph}}</span>
    <span class="h-mut">智能家庭控制中心</span>
  </div>
  <h1 class="g-title">{{greeting}}</h1>
  <p class="g-sub" data-hc="device-drawer" data-filter="all" title="点击查看全部设备">{{subtitle}}</p>
  <div class="g-m">
    <div class="g-cell"><b>{{time}}</b><i>时间</i></div>
    <div class="g-cell"><b>{{indoorTemp}}</b><i>室内</i></div>
    <div class="g-cell"><b>{{indoorHumidity}}</b><i>湿度</i></div>
  </div>
</div>`
  const css = shell + `.hc{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;gap:3px;position:relative;overflow:hidden;padding:8px}
.deco{position:absolute;top:-14px;right:-14px;width:64px;height:64px;border-radius:50%;background:var(--hc-primary);opacity:.1;filter:blur(14px)}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:11px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-title{font-size:17px;font-weight:600;margin:0;line-height:1.1;color:var(--hc-text)}
.g-sub{font-size:9px;color:var(--hc-sub);margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-m{display:flex;gap:4px}
.g-cell{flex:1;min-width:0;text-align:center;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:2px 0}
.g-cell b{display:block;font-size:11px;font-weight:600;color:var(--hc-text)}
.g-cell i{font-style:normal;font-size:7px;color:var(--hc-sub)}`
  return { html, css }
}

// ================= 26. 基础天气卡片（动态天空：按实时天气切换场景动画，小米天气式） =================
// 数据层 weatherData 提供 scene class（wx-sunny/wx-night/wx-partly wx-dark/…），
// CSS 按场景切换渐变天幕与元素可见性；所有粒子（雨滴/雪花/云/星）常驻 DOM，由场景类控制显隐。
export function tplWeather() {
  const html = `<div class="hc wx" data-live="{{scene}}" data-temp="{{temp}}" data-cond="{{condition}}" data-ic="{{icon}}" data-hi="{{hi}}" data-lo="{{lo}}">
  <div class="wx-sky" aria-hidden="true">
    <i class="wx-cl b"></i>
    <i class="wx-cl a"></i>
    <i class="wx-smk s1"></i>
    <i class="wx-smk s2"></i>
    <canvas class="wx-cv"></canvas>
  </div>
  <div class="wx-head"><span class="wx-title"><i class="material-symbols-outlined">location_on</i>天气预报</span></div>
  <div class="wx-body">
    <span class="wx-temp">{{temp}}<small>{{unit}}</small></span>
    <span class="wx-cond"><i class="wx-emoji">{{icon}}</i>{{condition}}</span>
    <span class="wx-hilo">最高 {{hi}}　/　最低 {{lo}}</span>
  </div>
  <div class="wx-panel">{{forecastHtml}}</div>
</div>`
  const css = shell + `
.wx{position:relative;padding:8px;gap:5px;color:#fff;border-radius:14px;border-color:transparent;background:rgba(255,255,255,.08);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);font-size:10px;overflow:hidden}
.wx>*:not(.wx-sky){position:relative;z-index:4}
/* ---- 天空场景层（粒子常驻 DOM，按场景显隐） ---- */
.wx-sky{position:absolute;inset:0;border-radius:inherit;overflow:hidden;z-index:0;pointer-events:none;clip-path:inset(0 round 14px)}
/* clip-path 兜底：云层背景滚动会被提升为合成层，Chromium 下祖先的
   overflow:hidden+border-radius 对合成层裁剪不可靠（云角以直角溢出卡片圆角），
   clip-path 对合成层依然生效，保证任何场景内容都被圆角完整裁住 */
/* ---- 云纹理层（所有会显示云的场景共用：无缝循环滚动 + screen 混合）----
纹理为边缘交叉淡化拼接的无缝图（clouds-*-loop.jpg，ffmpeg 将右尾平滑淡化叠到左头再裁边，
非镜像拼接，无轴对称重复感），background-position-x 线性滑过恰好一个周期后回卷
→ 首尾相连、单向匀速无限飘移，永不露白，且不需要超出卡面的额外宽度。
近景积云 a 经 ::before/::after 拆成 3 层（各层平铺周期近大远小、起始相位与纵向错位），
b 为高空卷云；两层遮罩均为「上下双向渐隐」，避免云层顶端撞卡片顶边形成硬边。---- */
.wx-cl{display:none;position:absolute;left:0;width:100%;mix-blend-mode:screen;background-repeat:repeat-x;pointer-events:none}
.wx-cl.a{top:-4%;height:34%;background-image:url(/img/wx/clouds-a-loop.jpg);background-size:880px 100%;background-position:0 bottom;opacity:.6;animation:wxScroll 320s linear infinite;
  -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 12%,#000 74%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 12%,#000 74%,transparent 100%)}
.wx-cl.a::before{content:'';position:absolute;inset:0;background:url(/img/wx/clouds-a-loop.jpg) repeat-x 233px 88%/700px 118%;mix-blend-mode:screen;opacity:.35;animation:wxScroll2 380s linear infinite}
.wx-cl.a::after{content:'';position:absolute;inset:0;background:url(/img/wx/clouds-a-loop.jpg) repeat-x 310px 96%/620px 112%;mix-blend-mode:screen;opacity:.25;animation:wxScroll3 465s linear infinite}
.wx-cl.b{top:-6%;height:26%;background-image:url(/img/wx/clouds-b-loop.jpg);background-size:540px 100%;background-position:0 center;opacity:.42;animation:wxScroll4 135s linear infinite;
  -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 16%,#000 62%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 16%,#000 62%,transparent 100%)}
/* ---- 烟雾层（雾天）：大幅烟雾纹理缓慢漂移 ---- */
.wx-smk{display:none;position:absolute;left:-30%;width:160%;height:72%;mix-blend-mode:screen;background:url(/img/wx/smoke.jpg) center/cover no-repeat;animation:wxSmoke ease-in-out infinite alternate;pointer-events:none;
  -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 24%,#000 76%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 24%,#000 76%,transparent 100%)}
.wx-smk.s1{top:6%;opacity:.4;animation-duration:26s}
.wx-smk.s2{bottom:-4%;opacity:.26;animation-duration:37s;animation-direction:alternate-reverse}
/* 云层循环滚动（所有云场景共用）：纹理为边缘交叉淡化拼接的无缝图（clouds-*-loop.jpg，ffmpeg 将右尾平滑淡化叠到左头再裁边，
   非镜像拼接，无轴对称重复感；源图 clouds-*.jpg 约 1/4 宽为淡化带），
   background-position-x 线性滑过恰好一个周期后回卷 → 首尾相连、单向无限飘移，永不露白。
   每层独立平铺周期（近大远小：880/700/620px，卷云 540px）并匹配各自的 keyframes 滚动距离；
   速度按 px/s 对齐旧版观感（≈2.7/1.8/1.3/4 px/s），避免背景定位整像素吸附导致慢层顿挫；
   ::before/::after 额外加纵向错位（88%/96% + 高度 118%/112%），防止同纹理三尺度叠加被认出是同一片云 */
@keyframes wxScroll{from{background-position-x:0}to{background-position-x:880px}}          /* a 主层周期 880px */
@keyframes wxScroll2{from{background-position-x:233px}to{background-position-x:933px}}   /* ::before 周期 700px，相位 1/3 */
@keyframes wxScroll3{from{background-position-x:310px}to{background-position-x:930px}}   /* ::after 周期 620px，相位 1/2 */
@keyframes wxScroll4{from{background-position-x:0}to{background-position-x:540px}}       /* b 卷云周期 540px */
@keyframes wxSmoke{from{transform:translateX(-3%)}to{transform:translateX(4%)}}
.wx-cl,.wx-smk{z-index:2}
/* ---- Canvas 粒子层（雨/雪/星/闪电/日月，卡片 JS 自驱动） ----
   z-index:4 —— 太阳/月亮/雨滴/雪花必须在云层之上，否则晴天光斑被云盖住 ---- */
.wx-cv{position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;z-index:4}
/* 云/雾在 canvas 之上：遮挡星月更有纵深；内容最上 */
/* ---- 场景元素可见性 ---- */
.wx-sunny .wx-cl.a{display:none}        /* 晴天：无积云 */
.wx-sunny .wx-cl.b{display:block;opacity:.12}  /* 晴天：一层高空薄卷云缓慢漂移 —— 天幕有「活」感，不再是静止画面 */
/* 多云（少云）：与晴天明确区分 —— 双层云成量可见，且云层移到 canvas（太阳）之上形成「云遮日」 */
.wx-partly .wx-cl{display:block;z-index:5}
.wx-partly .wx-cl.a{opacity:.26}
.wx-partly .wx-cl.b{opacity:.44}
.wx-cloudy .wx-cl{display:block}        /* 多云/阴天：两层云（近景积云 3 尺度 + 高空卷云，见上方共用滚动层） */
.wx-rain .wx-cl{display:block;filter:brightness(.6) saturate(.8)}
.wx-rain .wx-cl.b{opacity:.2}
.wx-thunder .wx-cl{display:block;filter:brightness(.4) saturate(.7)}
.wx-thunder .wx-cl.b{opacity:.16}
.wx-snow .wx-cl{display:block;filter:brightness(.92)}
.wx-snow .wx-cl.b{opacity:.22}
.wx-fog .wx-smk{display:block}
.wx-fog .wx-cl.a{display:block;opacity:.22;filter:blur(1px)}
.wx-night .wx-cl,.wx-dark .wx-cl{filter:brightness(.52)}
.wx-thunder.wx-dark .wx-cl{filter:brightness(.34) saturate(.65)}
.wx-rain.wx-dark .wx-cl{filter:brightness(.44) saturate(.75)}
/* ---- 场景配色（天幕渐变；全部画在 .wx-sky 上，由它的 overflow:hidden + border-radius 彻底裁剪
   —— 背景只在一层元素上，避免壳层与绝对定位背景的 subpixel 对齐缝） ----
.wx-sky{background:linear-gradient(180deg,#46649a 0%,#52719f 34%,#5f7ead 62%,#6d8ab8 100%)}  /* 默认：晴天（对齐参考实拍天幕） */
.wx-sunny .wx-sky{background:linear-gradient(180deg,#4f8be8 0%,#5fa4f0 50%,#b2d2f7 75%,#d4e6fb 100%)}  /* 晴：全场最明快的蔚蓝 */
.wx-partly .wx-sky{background:linear-gradient(180deg,#5f7ba8 0%,#7a92b6 50%,#b0c1d6 75%,#d0dbe8 100%)}  /* 多云：去饱和压灰一档，与晴天拉开差距（修复旧版多云比晴天更艳的倒置） */
.wx-cloudy .wx-sky{background:linear-gradient(180deg,#4a5c86 0%,#66799f 42%,#97a8c2 74%,#bcc8d9 100%)}  /* 阴天（对齐参考实拍）：上段饱和深蓝，亮度交给明亮云层 */
.wx-rain .wx-sky{background:linear-gradient(180deg,#2f3f55 0%,#3d516a 50%,#6a829f 75%,#8ea5bc 100%)}
.wx-snow .wx-sky{background:linear-gradient(180deg,#5490c4 0%,#6aabd6 50%,#b2d3ee 75%,#d5e6f3 100%)}
.wx-thunder .wx-sky{background:linear-gradient(180deg,#2f2556 0%,#3f316e 50%,#6b5ea0 75%,#8d82b8 100%)}
.wx-fog .wx-sky{background:linear-gradient(180deg,#7d8a9b 0%,#95a1b1 50%,#b7c1ce 75%,#d2d9e1 100%)}
.wx-night .wx-sky{background:linear-gradient(180deg,#111733 0%,#162044 50%,#374680 75%,#52629a 100%)}
.wx-dark .wx-sky{background:linear-gradient(180deg,#141a36 0%,#1b244a 50%,#3c4780 75%,#5764a0 100%)}
.wx-hail .wx-sky{background:linear-gradient(180deg,#3e4d60 0%,#53667c 50%,#7e94ab 75%,#a3b5c7 100%)}
.wx-hail .wx-cl{display:block;filter:brightness(.55) saturate(.75)}
.wx-hail .wx-cl.b{opacity:.18}
.wx-hail.wx-dark .wx-cl{filter:brightness(.4) saturate(.7)}
.wx-windy .wx-sky{background:linear-gradient(180deg,#4a5c86 0%,#66799f 42%,#97a8c2 74%,#bcc8d9 100%)}  /* 与阴天共用蓝灰天幕 */
.wx-windy .wx-cl{display:block}
.wx-windy .wx-cl.a{animation-duration:26s}
.wx-windy .wx-cl.a::before{animation-duration:31s}
.wx-windy .wx-cl.a::after{animation-duration:38s}
.wx-windy .wx-cl.b{animation-duration:34s}
.wx-windy.wx-dark .wx-cl{filter:brightness(.5)}
.wx-heavy .wx-sky{background:linear-gradient(180deg,#283646 0%,#374a5e 50%,#5a7288 75%,#7a91a3 100%)}
/* ---- 阴天/夜阴天叠加（覆盖 .wx-dark 的天空） ---- */
.wx-cloudy.wx-dark .wx-sky{background:linear-gradient(180deg,#242e41 0%,#2f3a50 50%,#4d5d78 75%,#687a96 100%)}
.wx-cloudy.wx-dark .wx-cl{filter:brightness(.5) saturate(.7)}
.wx-partly.wx-dark .wx-sky{background:linear-gradient(180deg,#1c2440 0%,#263152 50%,#465580 75%,#617199 100%)}
/* ---- 内容排版（小米天气式：大号渐变温度 + 状况/高低温） ---- */
.wx-head{display:flex;align-items:center}
.wx-title{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:rgb(255 255 255 / .92);letter-spacing:.02em}
.wx-title .material-symbols-outlined{font-size:13px;color:rgb(255 255 255 / .82)}
.wx-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;padding:5px 0 3px}
.wx-temp{font-size:44px;font-weight:600;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;background:linear-gradient(180deg,#fff 26%,rgb(255 255 255 / .4));-webkit-background-clip:text;background-clip:text;color:transparent}
.wx-temp small{font-size:14px;font-weight:500;margin-left:3px;letter-spacing:0;background:none;-webkit-background-clip:initial;background-clip:initial;-webkit-text-fill-color:rgb(255 255 255 / .88);color:rgb(255 255 255 / .88)}
.wx-cond{display:flex;align-items:center;gap:4px;margin-top:5px;font-size:12px;font-weight:600;color:#fff;text-shadow:0 1px 10px rgb(8 18 40 / .35)}
.wx-emoji{font-style:normal;font-size:15px;line-height:1;filter:drop-shadow(0 1px 3px rgb(0 0 0 / .3))}
.wx-hilo{margin-top:3px;font-size:10px;color:rgb(255 255 255 / .72);text-shadow:0 1px 8px rgb(8 18 40 / .3)}
/* ---- 7 日预报横向滚动条：面板自上而下渐显（无边框硬边），
与天空自然过渡，避免「上下两块」的观感 ---- */
.wx-panel{flex:none;margin-top:3px;background:linear-gradient(180deg,rgb(9 20 40 / .16),rgb(9 20 40 / .62) 62%,rgb(9 20 40 / .74));border-radius:12px;padding:5px 2px}
.fc7w{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.fc7w::-webkit-scrollbar{display:none}
.fc7d{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:31px;padding:2px 3px;cursor:pointer;border-radius:8px;transition:background .18s}
.fc7d:hover{background:rgb(255 255 255 / .1)}
.fc7d.on{background:rgb(255 255 255 / .2)}
.fc7-l{font-size:8px;color:rgb(255 255 255 / .68);white-space:nowrap}
.fc7-i{font-size:13px;line-height:1;filter:drop-shadow(0 1px 2px rgb(0 0 0 / .25))}
.fc7-t{display:flex;flex-direction:column;align-items:center;line-height:1.15;font-variant-numeric:tabular-nums}
.fc7-t b{font-size:9.5px;font-weight:700;color:#fff}
.fc7-t i{font-style:normal;font-size:8px;color:rgb(255 255 255 / .55)}`
  const js = `/* ---- 动态天空 Canvas 引擎：雨(溅射)/雪(摇曳)/星野(流星)/分形闪电/日月光晕。
架构约定（关键）：场景 class 由本引擎独占写入，Vue 只负责 data-* 属性，
两者互不覆盖 —— 彻底消除「Vue 刷新把 class 覆盖回实时值」导致的动画分裂/不生效问题。
幂等重启、DOM 重建后认领新 canvas、页面隐藏/卡片离场自动暂停。 */
var WX_VER = 22 /* 迁移版本标记：dashboard.js upgradeWeatherCard 据此重写旧卡代码 */
if (el._wxStop) { el._wxStop() }
var cv = el.querySelector('.wx-cv')
if (!cv) return
var ctx = cv.getContext('2d')
var W = 0, H = 0, drops = [], spl = [], flakes = [], stars = []
var bolt = null, boltLife = 0, flash = 0, nextBolt = 2600
var moonCv = null
var hails = [], motes = []
var accum = null, ACC_N = 24
var meteor = 0, mxy = null, nextMeteor = 4200
el._wxApplied = '' // 引擎当前施加的场景（每帧由 wxSync 维护，是 scene() 的稳定真值）
var _wxu = el.querySelector('.wx-temp small')
el._wxUnit = _wxu ? _wxu.textContent : '°'
el.addEventListener('click', onPick)
function resize() {
  var r = cv.getBoundingClientRect()
  if (!r.width || !r.height) return
  var dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr)
  var pw = W, ph = H
  W = r.width; H = r.height
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  stars = []
  for (var i = 0; i < 26; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * .6, r: .4 + Math.random() * 1.1, p: Math.random() * 6.28, sp: .8 + Math.random() * 1.6 })
  // 自适应：卡面尺寸明显变化时，清空按旧尺寸分布的粒子与一次性效果
  // （密度/位置由各绘制函数按新卡面重算，避免旧粒子错位「破功」）
  if (Math.abs(pw - W) > 2 || Math.abs(ph - H) > 2) {
    drops.length = 0; spl.length = 0; flakes.length = 0; hails.length = 0; motes.length = 0
    accum = null; bolt = null; boltLife = 0; flash = 0; meteor = 0; mxy = null
  }
}
function scene() {
  // 场景来源：引擎当前施加的 class（el._wxApplied，微信 wxSync 每帧维护）。
  // 因为 class 由引擎独占（html 里的 class 是静态 "hc wx"，不含 {{scene}}），
  // Vue 刷新永远不会覆盖它，故这里读到的就是稳定真值；
  // 若尚未同步（首帧/重建后），回落到 .wx 的实际 class。
  var w = el.querySelector('.wx')
  var c = String(el._wxApplied || (w ? w.className : '')).split(/\s+/), s = ''
  function has(x) { return c.indexOf(x) >= 0 }
  if (has('wx-night')) s = 'night'
  else if (has('wx-sunny')) s = 'sunny'
  else if (has('wx-partly')) s = 'partly'
  else if (has('wx-cloudy')) s = 'cloudy'
  else if (has('wx-rain')) s = 'rain'
  else if (has('wx-snow')) s = 'snow'
  else if (has('wx-thunder')) s = 'thunder'
  else if (has('wx-hail')) s = 'hail'
  else if (has('wx-fog')) s = 'fog'
  else if (has('wx-windy')) s = 'windy'
  var hh = new Date().getHours(), localNight = hh < 6 || hh >= 18
  if (!s) s = localNight ? 'night' : 'cloudy'
  // 昼夜规则统一：夜间晴天/少云折叠为「晴夜」（月亮+星野），夜间其余场景叠加 wx-dark。
  // 实时与择日都走这条规则 —— 点其他日 = 模拟「那天的天气 + 当前时间」，夜里点到晴天也是晴夜。
  if (localNight && (s === 'sunny' || s === 'partly')) s = 'night'
  return { s: s, night: s === 'night' || localNight || has('wx-dark') }
}
// ---- 预报择日：点某天 → 卡面显示该日具体天气信息 + 动画切换到该日天气（按当前时间叠加昼夜）；
// 再点同一天或点卡片空白处 → 恢复实时天气。状态存在 el 上（Vue 重建 DOM 不丢），
// 并持久化到 localStorage（按卡片 uid 键）——刷新页面后仍保持所选日期，不会回到默认实时。
// 数据来源是 Vue 每次渲染刷新的 data-* 属性（唯一真相源），引擎只覆写 class/文本，故不会互相打架。
var SEL_KEY = 'hc_wx_sel_' + (card && card.uid ? card.uid : 'x')
function selLoad() {
  try { var v = parseInt(localStorage.getItem(SEL_KEY), 10); return isNaN(v) ? -1 : v } catch (e) { return -1 }
}
function selSave(v) {
  try { if (v < 0) localStorage.removeItem(SEL_KEY); else localStorage.setItem(SEL_KEY, String(v)) } catch (e) {}
}
var selDay = selLoad()
function wxInfo() {
  var w = el.querySelector('.wx')
  if (!w) return null
  return {
    scene: w.getAttribute('data-live') || '',
    temp: w.getAttribute('data-temp') || '',
    cond: w.getAttribute('data-cond') || '',
    ic: w.getAttribute('data-ic') || '',
    hi: w.getAttribute('data-hi') || '',
    lo: w.getAttribute('data-lo') || '',
    title: '天气预报',
  }
}
function dayInfo(i) {
  var d = el.querySelectorAll('.fc7d')[i]
  if (!d) return null
  var lbl = d.getAttribute('data-label') || ''
  // 今天：直接用实时信息（含当前温度与已含夜色的场景），只是标题换成日期名
  if (d.getAttribute('data-today')) { var L = wxInfo(); if (L) L.title = lbl ? lbl + '预报' : L.title; return L }
  return {
    scene: d.getAttribute('data-scene') || '',
    temp: d.getAttribute('data-hi') || '—',
    cond: d.getAttribute('data-cond') || '',
    ic: d.getAttribute('data-ic') || '',
    hi: d.getAttribute('data-hi') || '—',
    lo: d.getAttribute('data-lo') || '—',
    title: lbl ? lbl + '预报' : '天气预报',
  }
}
// 元素引用缓存：以 .wx 元素身份为键（Vue 重建 DOM 后引用失效，此处自动重取）
var refW = null, refs = null
function getRefs() {
  var w = el.querySelector('.wx')
  if (w !== refW) {
    refW = w
    refs = w ? { w: w, t: w.querySelector('.wx-temp'), cd: w.querySelector('.wx-cond'), hl: w.querySelector('.wx-hilo'), tt: w.querySelector('.wx-title') } : null
  }
  return refs
}
// 每帧同步（幂等，逐项比对后才写）：把「应当显示的场景/文本/高亮」与当前 DOM 对齐。
// 之所以每帧而非定时器：Vue 数据刷新会重建 .wx（class/文本回到实时值），
// 每帧核对可在下一帧（≤16ms）内恢复，人眼不可见；且场景 class 由引擎独占写入
// （html 里 class 静态、不含 {{scene}}），Vue 永远不会覆盖它 → 动画不会分裂。
//  - 实时（selDay < 0）：场景取 data-live（data.js 已按天气 + 本地时间算好昼夜）
//  - 择日（selDay >= 0）：模拟「该日天气 + 当前时间」——与实时同规则：夜里晴天/少云折叠为晴夜，
//    其余夜间场景叠加 wx-dark；白天原样。文本/高亮由引擎施加
function wxSync() {
  var r = getRefs()
  if (!r) return
  // 越界回落：持久化的择日索引超出当前预报天数（数据未到/变少）时回实时（无数据时保留待恢复）
  var nc = el.querySelectorAll('.fc7d').length
  if (nc > 0 && selDay >= nc) { selDay = -1; selSave(-1) }
  var live = selDay < 0
  var d = live ? wxInfo() : dayInfo(selDay)
  if (!d) return
  var cls = d.scene
  if (!live) {
    if (new Date().getHours() < 6 || new Date().getHours() >= 18) {
      cls = (cls === 'wx-sunny' || cls === 'wx-partly') ? 'wx-night'
        : (cls.indexOf('wx-dark') < 0 ? cls + ' wx-dark' : cls)
    }
  }
  var want = 'hc wx' + (cls ? ' ' + cls : '')
  if (r.w.className !== want) r.w.className = want
  el._wxApplied = cls
  var u = el._wxUnit || '°'
  if (r.t && r.t.textContent !== String(d.temp) + u) r.t.innerHTML = d.temp + '<small>' + u + '</small>'
  if (r.cd && r.cd.textContent !== d.ic + d.cond) r.cd.innerHTML = '<i class="wx-emoji">' + d.ic + '</i>' + d.cond
  var htxt = '最高 ' + d.hi + '　/　最低 ' + d.lo
  if (r.hl && r.hl.textContent !== htxt) r.hl.textContent = htxt
  if (r.tt && r.tt.lastChild && r.tt.lastChild.nodeValue !== d.title) r.tt.lastChild.nodeValue = d.title
  var cells = el.querySelectorAll('.fc7d')
  for (var i = 0; i < cells.length; i++) {
    var on = !live && i === selDay
    if (cells[i].classList.contains('on') !== on) cells[i].classList.toggle('on', on)
  }
}
function wxRestore() { selDay = -1; selSave(-1); wxSync() }
function onPick(ev) {
  var t = ev.target
  var d = t && t.closest ? t.closest('.fc7d') : null
  if (!d) { if (selDay >= 0) wxRestore(); return } // 点卡片空白处恢复实时
  var cells = el.querySelectorAll('.fc7d'), idx = -1
  for (var i = 0; i < cells.length; i++) if (cells[i] === d) { idx = i; break }
  if (idx < 0) return
  if (idx === selDay) { wxRestore(); return } // 再点同一天恢复实时
  selDay = idx
  selSave(idx)
  wxSync()
}
// 全局缩放：所有天空元素尺寸按卡片短边等比缩放（小卡小动画，大卡大动画）
function skyScale() { return Math.min(1.6, Math.max(.55, Math.min(W, H) / 150)) }
// 日月随真实时间沿弧线移动：太阳 6→18 点从东方升到正午最高再落向西方；月亮走 18→6 点的夜弧
function sunPos() {
  var d = new Date(), h = d.getHours() + d.getMinutes() / 60
  var p = Math.min(1, Math.max(0, (h - 6) / 12))
  return { x: (0.1 + 0.8 * p) * W, y: (0.5 - Math.sin(p * Math.PI) * 0.36) * H }
}
function moonPos() {
  var d = new Date(), h = d.getHours() + d.getMinutes() / 60
  var p = Math.min(1, Math.max(0, h >= 18 ? (h - 18) / 12 : (h + 6) / 12))
  return { x: (0.1 + 0.8 * p) * W, y: (0.5 - Math.sin(p * Math.PI) * 0.36) * H }
}
function drawSun(t, dim) {
  if (dim == null) dim = 1
  var k = skyScale(), sp = sunPos()
  var sx = sp.x, sy = sp.y
  // 写实照片感太阳（对齐参考图）：大气泛光 + 细星芒射线 + 白金光晕 + 纯白小核心 + 镜头光斑
  ctx.save()
  ctx.globalAlpha = dim  // 多云时太阳被云层遮蔽：整体透光率降低，配合云层 z-index 上移形成云遮日
  ctx.globalCompositeOperation = 'lighter'
  // 1. 大气散射：大范围柔和日辉（随时间缓慢呼吸，模拟空气透明度变化）
  var bp = .5 + .5 * Math.sin(t * .0011)
  var amb = ctx.createRadialGradient(sx, sy, 0, sx, sy, 78 * k)
  amb.addColorStop(0, 'rgba(255,244,214,' + (.24 + .16 * bp) + ')')
  amb.addColorStop(.45, 'rgba(255,236,190,' + (.09 + .06 * bp) + ')')
  amb.addColorStop(1, 'rgba(255,228,176,0)')
  ctx.fillStyle = amb; ctx.beginPath(); ctx.arc(sx, sy, 78 * k, 0, 6.29); ctx.fill()
  // 2. 柔光射线：仅 6 根，角度不规则分布，发散梯形向外变宽变淡；
  //    整组套 blur 滤镜让边缘完全柔化（参考图：射线少而朦胧，无硬边）
  var frac = function (x) { return x - Math.floor(x) }
  var rot = t * 0.00006
  ctx.filter = 'blur(' + 2.2 * k + 'px)'
  for (var i = 0; i < 6; i++) {
    var h1 = frac(Math.sin(i * 127.1) * 43758.5453)
    var h2 = frac(Math.sin(i * 269.5 + 13.7) * 24634.6345)
    var a = rot + i / 6 * 6.2832 + (h1 - .5) * .9
    var inn = 6 * k
    // 每根射线独立伸缩（周期约 5.7s，相位错开）—— 肉眼可感的律动，而非近乎静止
    var len = (26 + h2 * 58) * (.74 + .26 * Math.sin(t * .0011 + i * 1.7)) * k
    var ca = Math.cos(a), sa = Math.sin(a)
    var hwN = .8 * k, hwF = (3.5 + h2 * 4.5) * k // 近端窄、远端发散宽
    var bx = sx + ca * inn, by = sy + sa * inn
    var tx = sx + ca * (inn + len), ty = sy + sa * (inn + len)
    var lg = ctx.createLinearGradient(bx, by, tx, ty)
    var al = .18 + h1 * .16 + .07 * Math.sin(t * .0009 + i * 2.1)
    lg.addColorStop(0, 'rgba(255,250,232,' + al + ')')
    lg.addColorStop(.5, 'rgba(255,250,232,' + al * .45 + ')')
    lg.addColorStop(1, 'rgba(255,250,232,0)')
    ctx.fillStyle = lg
    ctx.beginPath()
    ctx.moveTo(bx - sa * hwN, by + ca * hwN)
    ctx.lineTo(bx + sa * hwN, by - ca * hwN)
    ctx.lineTo(tx + sa * hwF, ty - ca * hwF)
    ctx.lineTo(tx - sa * hwF, ty + ca * hwF)
    ctx.closePath(); ctx.fill()
  }
  ctx.filter = 'none' // 后续核心/光晕保持清晰，只有射线柔化
  // 3. 核心光晕：白转暖金的紧致强 bloom（半径随呼吸轻微起伏）
  var hr = (25 + 1.8 * bp) * k
  var halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, hr)
  halo.addColorStop(0, 'rgba(255,252,240,.95)')
  halo.addColorStop(.3, 'rgba(255,244,214,.6)')
  halo.addColorStop(.7, 'rgba(255,232,176,.18)')
  halo.addColorStop(1, 'rgba(255,226,166,0)')
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, hr, 0, 6.29); ctx.fill()
  // 4. 太阳核心：纯白小圆
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sx, sy, 7.5 * k, 0, 6.29); ctx.fill()
  // 5. 镜头光斑：沿太阳→画面中心的镜头轴线散布的圆形「透明光点」（对焦失焦的 bokeh），
  //    中心淡色 → 向外经多段停靠点平滑衰减到全透明，边缘完全虚化、无硬边圆盘；
  //    尺寸放大到与卡面比例相当，像参考图那样在天空上留下朦胧的圆形光晕
  var dx = W / 2 - sx, dy = H / 2 - sy
  var fl = [
    [1.12, 34, '208,226,255', .10],
    [1.48, 26, '255,238,206', .09],
    [1.9, 40, '196,216,255', .08],
    [2.35, 20, '255,220,176', .07],
    [2.85, 30, '206,224,255', .06],
  ]
  for (var j = 0; j < fl.length; j++) {
    var fx = sx + dx * fl[j][0], fy = sy + dy * fl[j][0], fr = fl[j][1] * k
    var fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr)
    fg.addColorStop(0, 'rgba(' + fl[j][2] + ',' + fl[j][3] + ')')
    fg.addColorStop(.35, 'rgba(' + fl[j][2] + ',' + (fl[j][3] * .7) + ')')
    fg.addColorStop(.65, 'rgba(' + fl[j][2] + ',' + (fl[j][3] * .28) + ')')
    fg.addColorStop(1, 'rgba(' + fl[j][2] + ',0)')
    ctx.fillStyle = fg
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, 6.29); ctx.fill()
  }
  // 6. 彩虹光环：围绕太阳的完整圆环，半径为卡片短边的 1/2；
  //    圆心在太阳正下方 R/2 处 → 太阳位于环内偏心靠上；
  //    用连续径向渐变（内红外紫）让各色之间自然模糊过渡，无硬边界
  var R = Math.min(W, H) * .35
  var rcx = sx, rcy = sy + R * .2
  var rg = ctx.createRadialGradient(rcx, rcy, R * .72, rcx, rcy, R * 1.12)
  rg.addColorStop(0, 'rgba(255,110,75,0)')
  rg.addColorStop(.12, 'rgba(255,110,75,.10)')
  rg.addColorStop(.28, 'rgba(255,195,85,.11)')
  rg.addColorStop(.44, 'rgba(160,235,140,.11)')
  rg.addColorStop(.62, 'rgba(100,180,255,.11)')
  rg.addColorStop(.78, 'rgba(160,120,255,.09)')
  rg.addColorStop(1, 'rgba(160,120,255,0)')
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
  ctx.restore()
}
function drawMoon(t) {
  var k = skyScale(), mp = moonPos()
  var sx = mp.x, sy = mp.y
  // 光晕直接画在主画布
  var g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 34 * k)
  g.addColorStop(0, 'rgba(226,233,250,.55)'); g.addColorStop(1, 'rgba(226,233,250,0)')
  ctx.fillStyle = g; ctx.fillRect(sx - 36 * k, sy - 36 * k, 72 * k, 72 * k)
  // 月牙在离屏画布合成：destination-out 只作用于离屏，
  // 不再在主画布上挖出一个透出天幕的暗色圆盘（旧版「两个圆形叠加」的根因）
  var R = Math.ceil(10 * k) + Math.ceil(8.6 * k) + 2
  var dpr = Math.min(2, window.devicePixelRatio || 1)
  var sz = Math.ceil(R * 2 * dpr)
  if (!moonCv) moonCv = document.createElement('canvas')
  if (moonCv.width !== sz) { moonCv.width = sz; moonCv.height = sz }
  var mc = moonCv.getContext('2d')
  mc.setTransform(1, 0, 0, 1, 0, 0)
  mc.clearRect(0, 0, sz, sz)
  mc.setTransform(dpr, 0, 0, dpr, 0, 0)
  // 每帧重置合成模式：上一帧的 destination-out 若不复位，满月会被「挖除模式」画成透明（月亮消失的根因）
  mc.globalCompositeOperation = 'source-over'
  mc.fillStyle = '#eef2fb'
  mc.beginPath(); mc.arc(R, R, 10 * k, 0, 6.29); mc.fill()
  mc.globalCompositeOperation = 'destination-out'
  mc.beginPath(); mc.arc(R - 4.6 * k, R - 2.7 * k, 8.6 * k, 0, 6.29); mc.fill()
  ctx.drawImage(moonCv, sx - R, sy - R, R * 2, R * 2)
}
function drawStars(t) {
  var k = skyScale()
  ctx.fillStyle = '#fff'
  for (var i = 0; i < stars.length; i++) {
    var s = stars[i]
    ctx.globalAlpha = .18 + .82 * (0.5 + 0.5 * Math.sin(t * .001 * s.sp + s.p))
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * k, 0, 6.29); ctx.fill()
  }
  ctx.globalAlpha = 1
}
function rain(dt) {
  // 雨量分级：drizzle 轻雨（少/慢/短），pouring 大雨（密/快/长）
  var w = el.querySelector('.wx'), mul = 1, sp = 1, ln = 1
  if (w && w.classList.contains('wx-light')) { mul = .45; sp = .7; ln = .8 }
  else if (w && w.classList.contains('wx-heavy')) { mul = 1.9; sp = 1.35; ln = 1.2 }
  var n = Math.max(10, Math.min(96, Math.round(W * H / 620 * mul)))
  while (drops.length < n) drops.push({ x: Math.random() * (W + 40) - 20, y: Math.random() * H, l: (7 + Math.random() * 8) * ln, v: (320 + Math.random() * 260) * sp, o: .3 + Math.random() * .4 })
  if (drops.length > n) drops.length = n
  var k = skyScale()
  ctx.lineWidth = 1.3; ctx.lineCap = 'round'
  for (var i = 0; i < drops.length; i++) {
    var d = drops[i]
    d.y += d.v * dt; d.x += d.v * .12 * dt
    if (d.y > H - 2) {
      if (Math.random() < .5) spl.push({ x: d.x, y: H - 2, vy: -(30 + Math.random() * 45), vx: (Math.random() - .5) * 30, o: .5 })
      d.y = -12; d.x = Math.random() * (W + 40) - 20
    }
    if (d.x > W + 20) d.x -= W + 40
    ctx.strokeStyle = 'rgba(188,214,250,' + d.o + ')'
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2.2 * k, d.y - d.l * k); ctx.stroke()
  }
  for (var j = spl.length - 1; j >= 0; j--) {
    var p = spl[j]
    p.vy += 320 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.o -= 1.8 * dt
    if (p.o <= 0) { spl.splice(j, 1); continue }
    ctx.fillStyle = 'rgba(200,222,252,' + p.o + ')'
    ctx.beginPath(); ctx.arc(p.x, p.y, .9 * k, 0, 6.29); ctx.fill()
  }
}
function snow(dt) {
  var n = Math.max(12, Math.min(64, Math.round(W * H / 480)))
  while (flakes.length < n) flakes.push({ x: Math.random() * W, y: Math.random() * H, r: .7 + Math.random() * 1.9, v: 15 + Math.random() * 32, p: Math.random() * 6.28, sw: 7 + Math.random() * 13, o: .4 + Math.random() * .5 })
  if (flakes.length > n) flakes.length = n
  var k = skyScale()
  ctx.fillStyle = '#fff'
  var t = performance.now()
  for (var i = 0; i < flakes.length; i++) {
    var f = flakes[i]
    f.y += f.v * dt; f.x += Math.sin(t * .001 + f.p) * f.sw * dt
    if (f.y > H + 4) {
      // 落底的雪花堆进雪坡（缓慢消融）
      if (!accum) { accum = []; for (var ci = 0; ci < ACC_N; ci++) accum.push(0) }
      var col = Math.min(ACC_N - 1, Math.max(0, Math.round(f.x / (W / ACC_N))))
      accum[col] += .9 * f.r
      f.y = -4; f.x = Math.random() * W
    }
    if (f.x > W + 4) f.x = -4; else if (f.x < -4) f.x = W + 4
    ctx.globalAlpha = f.o
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, 6.29); ctx.fill()
  }
  ctx.globalAlpha = 1
  // 底部积雪：沿列高画起伏雪坡
  if (accum) {
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    ctx.beginPath()
    var cw = W / (ACC_N - 1)
    ctx.moveTo(-2, H + 2)
    for (var bi = 0; bi < ACC_N; bi++) {
      var hgt = Math.min(13 * k, accum[bi]), nx = bi * cw, ny = H - hgt
      if (bi === 0) ctx.lineTo(-2, ny)
      else ctx.quadraticCurveTo(nx - cw / 2, H - Math.min(13 * k, (accum[bi - 1] + accum[bi]) / 2), nx, ny)
    }
    ctx.lineTo(W + 2, H + 2)
    ctx.closePath(); ctx.fill()
    for (var di = 0; di < ACC_N; di++) accum[di] *= .9997
  }
}
function thunder(dtm, dt) {
  nextBolt -= dtm
  if (boltLife <= 0 && nextBolt <= 0) {
    var pts = [], x = W * (.18 + Math.random() * .6), y = -4, segs = 9, step = (H + 8) / segs, k0 = skyScale()
    for (var i = 0; i <= segs; i++) { pts.push([x, y]); x += (Math.random() - .5) * W * .17; y += step }
    // 分形分支：从主干中段随机长出 2 条短叉
    var brs = []
    for (var b = 0; b < 2; b++) {
      var pi = 2 + Math.floor(Math.random() * (segs - 3))
      var dir = Math.random() < .5 ? -1 : 1, bx = pts[pi][0], by = pts[pi][1], br = [[bx, by]]
      for (var bj = 0; bj < 3; bj++) { bx += dir * (6 + Math.random() * 12) * k0; by += step * .5; br.push([bx, by]) }
      brs.push(br)
    }
    bolt = { main: pts, br: brs }; boltLife = .24; flash = .42
    nextBolt = 3600 + Math.random() * 5600
  }
  if (boltLife > 0 && bolt) {
    boltLife -= dt
    // 闪烁：寿命期内亮度抖动，更接近真实放电
    var a = Math.max(0, boltLife / .24) * (.78 + .22 * Math.sin(performance.now() * .09))
    var k = skyScale()
    ctx.save()
    ctx.strokeStyle = 'rgba(214,226,255,' + (a * .6).toFixed(3) + ')'; ctx.lineWidth = 1 * k
    ctx.shadowColor = 'rgba(150,175,255,.9)'; ctx.shadowBlur = 8 * k
    for (var br2 = 0; br2 < bolt.br.length; br2++) {
      var bb = bolt.br[br2]
      ctx.beginPath(); ctx.moveTo(bb[0][0], bb[0][1])
      for (var bj2 = 1; bj2 < bb.length; bj2++) ctx.lineTo(bb[bj2][0], bb[bj2][1])
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(214,226,255,' + a.toFixed(3) + ')'; ctx.lineWidth = 1.8 * k; ctx.shadowBlur = 14 * k
    ctx.beginPath(); ctx.moveTo(bolt.main[0][0], bolt.main[0][1])
    for (var k2 = 1; k2 < bolt.main.length; k2++) ctx.lineTo(bolt.main[k2][0], bolt.main[k2][1])
    ctx.stroke()
    ctx.shadowBlur = 0; ctx.lineWidth = .7 * k; ctx.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'
    ctx.stroke()
    ctx.restore()
  }
  if (flash > 0) { flash -= dt; ctx.fillStyle = 'rgba(214,226,255,' + Math.max(0, flash) * .55 + ')'; ctx.fillRect(0, 0, W, H) }
}
// 冰雹：白色小珠快速坠落，落地溅射
function hail(dt) {
  var k = skyScale()
  var n = Math.max(8, Math.min(34, Math.round(W * H / 900)))
  while (hails.length < n) hails.push({ x: Math.random() * W, y: Math.random() * H, r: 1.1 + Math.random() * 1.7, v: 360 + Math.random() * 240, vx: (Math.random() - .5) * 30 })
  if (hails.length > n) hails.length = n
  for (var i = 0; i < hails.length; i++) {
    var h = hails[i]
    h.y += h.v * dt; h.x += h.vx * dt
    if (h.y > H - 2) {
      if (Math.random() < .6) spl.push({ x: h.x, y: H - 2, vy: -(40 + Math.random() * 60), vx: (Math.random() - .5) * 60, o: .6 })
      h.y = -6; h.x = Math.random() * W
    }
    if (h.x > W + 6) h.x = -6; else if (h.x < -6) h.x = W + 6
    var g = ctx.createRadialGradient(h.x - h.r * .3, h.y - h.r * .3, .2, h.x, h.y, h.r * k)
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(190,210,235,.55)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(h.x, h.y, h.r * k, 0, 6.29); ctx.fill()
  }
}
// 晴天浮尘：光柱里缓升的微尘，呼吸明灭
function motesDraw(dt) {
  var k = skyScale()
  if (!motes.length) for (var i = 0; i < 14; i++) motes.push({ x: Math.random() * W, y: Math.random() * H, r: .6 + Math.random() * 1.4, vx: (Math.random() - .5) * 9, vy: -(3 + Math.random() * 7), p: Math.random() * 6.28 })
  var t = performance.now()
  ctx.fillStyle = '#fff'
  for (var j = 0; j < motes.length; j++) {
    var m = motes[j]
    m.x += m.vx * dt; m.y += m.vy * dt
    if (m.y < -4 || m.x < -4 || m.x > W + 4) { m.x = Math.random() * W; m.y = H + 4 }
    ctx.globalAlpha = .1 + .28 * (0.5 + 0.5 * Math.sin(t * .0012 + m.p))
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r * k, 0, 6.29); ctx.fill()
  }
  ctx.globalAlpha = 1
}
var raf = 0, running = true, ro = null, last = performance.now(), chkT = 0
function frame(now) {
  if (!running) return
  if (!el.isConnected) { running = false; return }
  if (!cv.isConnected) {
    var nc = el.querySelector('.wx-cv')
    if (!nc) { running = false; return }
    cv = nc; ctx = cv.getContext('2d'); W = 0
    if (ro) ro.disconnect()
    ro = new ResizeObserver(resize); ro.observe(cv)
  }
  if (!W) resize()
  if (!W) { raf = requestAnimationFrame(frame); return }
  // 每帧同步场景/文本/高亮（幂等）：Vue 重建 DOM 后下一帧即恢复，人眼不可见
  wxSync()
  // 兜底自适应：ResizeObserver 之外每 500ms 校验一次卡面尺寸（编辑改卡片大小/布局变化都能跟上）
  if (now - chkT > 500) {
    chkT = now
    var rc = cv.getBoundingClientRect()
    if (rc.width && (Math.abs(rc.width - W) > 1 || Math.abs(rc.height - H) > 1)) resize()
  }
  var dt = Math.min(.05, (now - last) / 1000 || .016); last = now
  var dtm = dt * 1000
  var sc = scene()
  ctx.clearRect(0, 0, W, H)
  if (sc) {
    if (sc.night) {
      // 只有晴夜/少云夜能看到星月；阴雨雪雾雷的夜里被云层遮住
      if (sc.s === 'night' || sc.s === 'partly') {
        drawStars(now)
        nextMeteor -= dtm
        if (meteor <= 0 && nextMeteor <= 0) { meteor = .7; mxy = [W * (.3 + Math.random() * .5), H * (.04 + Math.random() * .14)]; nextMeteor = 6500 + Math.random() * 9000 }
        if (meteor > 0 && mxy) {
          meteor -= dt
          var k = skyScale(), pr = 1 - meteor / .7, mx2 = mxy[0] - pr * W * .45, my2 = mxy[1] + pr * H * .26, al = Math.sin(pr * Math.PI)
          var lg = ctx.createLinearGradient(mx2, my2, mx2 + 24 * k, my2 - 14 * k)
          lg.addColorStop(0, 'rgba(255,255,255,' + .9 * al + ')'); lg.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.strokeStyle = lg; ctx.lineWidth = 1.4 * k
          ctx.beginPath(); ctx.moveTo(mx2, my2); ctx.lineTo(mx2 + 24 * k, my2 - 14 * k); ctx.stroke()
        }
        drawMoon(now)
      }
    } else if (sc.s === 'sunny') drawSun(now, 1)
    else if (sc.s === 'partly') drawSun(now, .55)  // 多云：太阳被云层遮蔽，只剩柔和透光
    // 旧版 motesDraw（晴天浮尘）已废弃：在蓝色天幕上呈现为白色气泡，
    // 用更干净的 drawSun 柔和光晕替代。
    if (sc.s === 'rain' || sc.s === 'thunder') rain(dt)
    if (sc.s === 'hail') hail(dt)
    if (sc.s === 'snow') snow(dt)
    if (sc.s === 'thunder') thunder(dtm, dt)
  }
  raf = requestAnimationFrame(frame)
}
function onVis() {
  if (document.hidden) { running = false; cancelAnimationFrame(raf) }
  else if (!running && el.isConnected) { running = true; last = performance.now(); raf = requestAnimationFrame(frame) }
}
document.addEventListener('visibilitychange', onVis)
resize()
ro = new ResizeObserver(resize); ro.observe(cv)
raf = requestAnimationFrame(frame)
el._wxStop = function () {
  running = false; cancelAnimationFrame(raf)
  if (ro) ro.disconnect()
  document.removeEventListener('visibilitychange', onVis)
  el.removeEventListener('click', onPick)
  el._wxApplied = ''
}`
  return { html, css, js }
}

// ================= 28. 基础时钟卡片（每秒刷新） =================
export function tplClock() {
  const html = `<div class="hc">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-info)">{{glyph}}</span>
    <span class="h-mut">当前时间</span>
  </div>
  <div class="h-fill h-mid" style="gap:4px">
    <span class="c-time">{{time}}</span>
    <span class="c-sec">{{sec}}</span>
  </div>
  <div class="h-row" style="justify-content:space-between">
    <span class="h-mut">{{period}}</span>
    <span class="h-mut">{{week}} · {{date}}</span>
  </div>
</div>`
  const css = shell + `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;overflow:hidden;padding:7px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:11px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-row{display:flex;align-items:center;gap:4px}
.c-time{font-size:26px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}
.c-sec{font-size:11px;font-weight:600;color:var(--hc-info);line-height:1;font-variant-numeric:tabular-nums;align-self:flex-end;padding-bottom:3px}`
  return { html, css }
}

// ================= 翻页时钟卡片（机械分瓣翻页动画，卡片 JS 自驱动） =================
export function tplFlipClock() {
  const html = `<div class="hc fcc">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-info)">{{glyph}}</span>
    <span class="h-mut fc-date">{{date}} · {{week}}</span>
  </div>
  <div class="fcd-row">
    <div class="fcd"><i class="half sc"><b>{{hh1}}</b></i><i class="half sn"><b>{{hh1}}</b></i><div class="flip"><i class="half fn"><b>{{hh1}}</b></i><i class="half fc"><b>{{hh1}}</b></i></div></div>
    <div class="fcd"><i class="half sc"><b>{{hh2}}</b></i><i class="half sn"><b>{{hh2}}</b></i><div class="flip"><i class="half fn"><b>{{hh2}}</b></i><i class="half fc"><b>{{hh2}}</b></i></div></div>
    <span class="fc-colon"><i></i><i></i></span>
    <div class="fcd"><i class="half sc"><b>{{mm1}}</b></i><i class="half sn"><b>{{mm1}}</b></i><div class="flip"><i class="half fn"><b>{{mm1}}</b></i><i class="half fc"><b>{{mm1}}</b></i></div></div>
    <div class="fcd"><i class="half sc"><b>{{mm2}}</b></i><i class="half sn"><b>{{mm2}}</b></i><div class="flip"><i class="half fn"><b>{{mm2}}</b></i><i class="half fc"><b>{{mm2}}</b></i></div></div>
    <span class="fc-colon"><i></i><i></i></span>
    <div class="fcd"><i class="half sc"><b>{{ss1}}</b></i><i class="half sn"><b>{{ss1}}</b></i><div class="flip"><i class="half fn"><b>{{ss1}}</b></i><i class="half fc"><b>{{ss1}}</b></i></div></div>
    <div class="fcd"><i class="half sc"><b>{{ss2}}</b></i><i class="half sn"><b>{{ss2}}</b></i><div class="flip"><i class="half fn"><b>{{ss2}}</b></i><i class="half fc"><b>{{ss2}}</b></i></div></div>
  </div>
  <div class="h-row" style="justify-content:space-between">
    <span class="h-mut">{{period}}</span>
    <span class="h-mut">{{year}} 年</span>
  </div>
</div>`
  const css = shell + `.hc.fcc{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;overflow:hidden;padding:7px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:11px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-row{display:flex;align-items:center;gap:4px}
.fcd-row{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:4px}
.fcd{position:relative;width:27px;height:42px;font-variant-numeric:tabular-nums;perspective:42px}
.fcd::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;margin-top:-.5px;background:rgb(0 0 0 / .35);z-index:4}
.fcd .half{position:absolute;left:0;top:0;width:100%;height:50%;overflow:hidden;background:var(--hc-bg2);font-style:normal}
.fcd .half b{position:absolute;left:0;width:100%;height:42px;line-height:42px;font-weight:700;font-size:33px;text-align:center;color:var(--hc-text);display:block}
.fcd .sc{border-radius:5px 5px 0 0}
.fcd .sc b{top:0}
.fcd .sn{top:auto;bottom:0;border-radius:0 0 5px 5px}
.fcd .sn b{bottom:0}
.fcd .flip{position:absolute;inset:0;z-index:3;transform-style:preserve-3d;transition:transform 0s;transform:rotateX(0)}
.fcd .flip.on{transition:transform .5s ease-in-out;transform:rotateX(-180deg)}
.fcd .flip .fc{backface-visibility:hidden;border-radius:5px 5px 0 0}
.fcd .flip .fc b{top:0}
.fcd .flip .fn{transform:rotateX(-180deg);backface-visibility:hidden;border-radius:0 0 5px 5px}
.fcd .flip .fn b{bottom:0}
.fc-colon{display:flex;flex-direction:column;justify-content:center;gap:9px;height:42px;margin:0 1px}
.fc-colon i{width:5px;height:5px;border-radius:50%;background:var(--hc-color);margin:0 auto;animation:fcBlink 2s ease-in-out infinite}
@keyframes fcBlink{0%,100%{opacity:1}50%{opacity:.25}}`
  return { html, css }
}

// 翻页时钟卡片 JS：渲染后执行一次，内部轮询检测秒变化驱动整瓣 180° 翻转（参考 flipflow 实现）。
// 卡片 DOM 被移除后（el.isConnected=false）自动清掉定时器，不留泄漏；
// 启动时先做中断自愈（keep-alive 停用/主题切换可能打断翻页留下 .flip.on 残留），
// 运行中带看门狗，翻板超时未复位则强制落定，保证任何打断后都能自动恢复。
export const JS_FLIP_CLOCK = `// 翻页时钟 v3：上半立即新值、下半翻完新值；中断自愈 + 翻页看门狗；卸载自动停止
;(function () {
  var ds = el.querySelectorAll('.fcd')
  var dateEl = el.querySelector('.fc-date')
  if (!ds.length) return
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  function p(n) { return (n < 10 ? '0' : '') + n }
  function faces(d) {
    return {
      sc: d.querySelector('.sc b'), sn: d.querySelector('.sn b'),
      fc: d.querySelector('.fc b'), fn: d.querySelector('.fn b'),
      flip: d.querySelector('.flip'),
    }
  }
  // 中断自愈：翻页进行到一半被打断时 .flip.on 残留、四瓣文字不一致，
  // 复位翻板并清空 _v，让下一轮 tick 重新做一次完整翻页对齐到当前值。
  function heal(d) {
    var f = faces(d)
    if (!f.flip.classList.contains('on')) return
    f.flip.classList.remove('on')
    clearTimeout(d._t)
    d._v = null
  }
  function setD(d, ch) {
    if (d._v === ch) return
    d._v = ch
    var f = faces(d)
    var old = f.fc.textContent                    // 翻页前实际显示值（前脸），静止态与上半一致
    f.sc.textContent = ch                         // 静止上半：翻页瞬间立即变为新值
    f.fn.textContent = ch                         // 后脸（下半）：预置新值
    f.fc.textContent = old                        // 前脸（上半）：保持旧值，随翻板翻走
    f.flip.classList.remove('on')                 // 立即复位（transition 0s），再重启翻转
    void f.flip.offsetWidth
    f.flip.classList.add('on')
    d._ts = Date.now()                            // 翻页开始时间，供看门狗判定卡死
    clearTimeout(d._t)
    d._t = setTimeout(function () {
      f.flip.classList.remove('on')               // 翻板复位（transition 0s 瞬时），露出新值
      f.sn.textContent = ch                       // 静止下半：翻完写入新值
      f.fc.textContent = ch                       // 前脸复位为新值，供下一轮翻页
    }, 500)
  }
  function tick() {
    if (!el.isConnected) { clearInterval(el._fcT); return }
    // 看门狗：翻板 .on 残留超过 1.5s（定时器被系统节流等罕见情况）→ 强制落定到新值
    for (var k = 0; k < ds.length; k++) {
      var dk = ds[k]
      if (dk._v && dk._ts && Date.now() - dk._ts > 1500) {
        var fk = faces(dk)
        if (fk.flip.classList.contains('on')) {
          fk.flip.classList.remove('on')
          fk.sn.textContent = dk._v
          fk.fc.textContent = dk._v
        }
      }
    }
    var t = new Date()
    var s = p(t.getHours()) + p(t.getMinutes()) + p(t.getSeconds())
    for (var i = 0; i < 6; i++) setD(ds[i], s[i])
    if (dateEl) dateEl.textContent = (t.getMonth() + 1) + '月' + t.getDate() + '日 · ' + WEEK[t.getDay()]
  }
  clearInterval(el._fcT)
  for (var j = 0; j < ds.length; j++) heal(ds[j])
  tick()
  el._fcT = setInterval(tick, 250)
})()`

// ================= 高德天气卡片（app 级：不依赖 HA 实体，用已配置的高德 Key 查询） =================
// 链路：卡片 js → window.skAmapKey()（prefs.map_config.amap_key）→ restapi.amap.com 直查
// IP 定城市（adcode）→ 实况(base) + 预报(all)。Key 需开通「Web服务」类型。10 分钟自动刷新。
export function tplAmapWeather() {
  const html = `<div class="hc aw">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-info)">{{glyph}}</span>
    <span class="h-mut aw-city">天气</span>
  </div>
  <div class="aw-body"><div class="aw-status">加载中…</div></div>
  <div class="h-row" style="justify-content:space-between">
    <span class="h-mut">高德天气</span>
    <span class="h-mut aw-time"></span>
  </div>
</div>`
  const css = shell + `.hc.aw{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;overflow:hidden;padding:8px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:11px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-row{display:flex;align-items:center;gap:4px}
.aw-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:3px}
.aw-status{font-size:9px;color:var(--hc-sub);text-align:center;padding:0 4px}
.aw-now{display:flex;align-items:center;justify-content:center;gap:10px}
.aw-bigic{font-size:36px;color:var(--hc-info)}
.aw-temp{font-size:36px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}
.aw-temp i{font-style:normal;font-size:16px;color:var(--hc-sub);font-weight:400}
.aw-desc{font-size:11px;font-weight:600;color:var(--hc-text);text-align:center}
.aw-meta{font-size:9px;color:var(--hc-sub);text-align:center}
.aw-fc{display:flex;gap:4px;margin-top:5px}
.aw-day{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:5px 0 4px}
.aw-dd{font-size:8px;color:var(--hc-sub);white-space:nowrap}
.aw-di{font-size:15px;color:var(--hc-info)}
.aw-dt{font-size:9px;color:var(--hc-text);font-variant-numeric:tabular-nums;white-space:nowrap}`
  return { html, css }
}

export const JS_AMAP_WEATHER = `// 高德天气 v2：REST API 直查（IP定城市 + 实况 + 预报），不依赖 SDK 加载
// Key 需开通「Web服务」类型（地图用的「Web端」Key 不行）；10分钟刷新，卡片卸载自动停
;(function () {
  var bodyEl = el.querySelector('.aw-body')
  var cityEl = el.querySelector('.aw-city')
  var timeEl = el.querySelector('.aw-time')
  var busy = false
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
    })
  }
  function say(msg) { if (bodyEl) bodyEl.innerHTML = '<div class="aw-status">' + esc(msg) + '</div>' }
  function icon(txt) {
    txt = String(txt || '')
    if (/雷/.test(txt)) return 'thunderstorm'
    if (/雨/.test(txt)) return 'rainy'
    if (/雪/.test(txt)) return 'weather_snowy'
    if (/雾|霾/.test(txt)) return 'foggy'
    if (/沙|尘/.test(txt)) return 'dust'
    if (/阴/.test(txt)) return 'cloud'
    if (/云/.test(txt)) return 'partly_cloudy_day'
    if (/晴/.test(txt)) return 'wb_sunny'
    return 'cloud'
  }
  function render(live, casts) {
    var h = '<div class="aw-now">'
      + '<span class="material-symbols-outlined aw-bigic">' + icon(live.weather) + '</span>'
      + '<span class="aw-temp">' + esc(live.temperature) + '<i>°C</i></span>'
      + '</div>'
      + '<div class="aw-desc">' + esc(live.weather) + '</div>'
      + '<div class="aw-meta">' + esc(live.winddirection) + '风' + esc(live.windpower) + '级 · 湿度 ' + esc(live.humidity) + '%</div>'
    if (casts && casts.length) {
      h += '<div class="aw-fc">'
      for (var i = 0; i < Math.min(casts.length, 3); i++) {
        var d = casts[i]
        h += '<div class="aw-day"><span class="aw-dd">' + (i === 0 ? '今天' : esc(String(d.date || '').slice(5))) + '</span>'
          + '<span class="material-symbols-outlined aw-di">' + icon(d.dayweather) + '</span>'
          + '<span class="aw-dt">' + esc(d.nighttemp) + '° / ' + esc(d.daytemp) + '°</span></div>'
      }
      h += '</div>'
    }
    if (bodyEl) bodyEl.innerHTML = h
    if (timeEl) timeEl.textContent = '更新 ' + esc(String(live.reporttime || '').slice(11, 16))
  }
  var ERR = {
    '10001': 'Key 无效，请检查高德 Key 配置',
    '10003': 'Key 无 Web 服务权限，请在高德控制台为该 Key 开通「Web服务」类型',
    '10009': 'Key 类型不匹配，天气查询需「Web服务」类型 Key',
    '10010': '请求过于频繁，请稍后重试',
    '10021': 'IP 定位服务暂不可用',
    '10044': '天气服务暂不可用'
  }
  function errDesc(info, code) {
    return ERR[code] || ERR[info] || (info ? ('查询失败：' + info) : '查询失败')
  }
  function load() {
    if (busy || !el.isConnected) return
    if (typeof window.skAmapKey !== 'function') { say('等待配置加载…'); return }
    busy = true
    say('查询中…')
    Promise.resolve(window.skAmapKey()).then(function (key) {
      if (!key) { busy = false; say('未配置高德 Key（设置 → 地图定位）'); return }
      var base = 'https://restapi.amap.com/v3/'
      // 1) IP 定城市（adcode）
      fetch(base + 'ip?key=' + encodeURIComponent(key))
        .then(function (r) { return r.json() })
        .then(function (ip) {
          if (ip.status === '0' || !ip.adcode) { busy = false; say('城市识别失败（' + errDesc(ip.info, ip.infocode) + '）'); return }
          if (cityEl && ip.city) cityEl.textContent = String(ip.city).replace(/市$/, '')
          // 2) 实况(base) + 预报(all) 并行
          var q = '&key=' + encodeURIComponent(key) + '&city=' + encodeURIComponent(ip.adcode)
          Promise.all([
            fetch(base + 'weather/weatherInfo' + q + '&extensions=base').then(function (r) { return r.json() }),
            fetch(base + 'weather/weatherInfo' + q + '&extensions=all').then(function (r) { return r.json() })
          ]).then(function (rs) {
            busy = false
            var live = rs[0], fc = rs[1]
            if (live.status === '0' || !live.lives || !live.lives.length) { say(errDesc(live.info, live.infocode)); return }
            var casts = (fc.status === '1' && fc.forecasts && fc.forecasts[0] && fc.forecasts[0].casts) ? fc.forecasts[0].casts : []
            render(live.lives[0], casts)
          }).catch(function () { busy = false; say('天气数据解析失败') })
        })
        .catch(function () { busy = false; say('网络请求失败，请检查网络连接') })
    }).catch(function () { busy = false; say('配置读取失败') })
  }
  clearInterval(el._awT)
  load()
  el._awT = setInterval(load, 600000)
})()`


// ================= 29. 基础日期卡片 =================
export function tplDate() {
  const html = `<div class="hc">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-warn)">{{glyph}}</span>
    <span class="h-mut">{{year}} 年 {{month}} 月</span>
  </div>
  <div class="h-fill h-mid">
    <span class="d-day">{{day}}</span>
  </div>
  <div class="h-row" style="justify-content:space-between">
    <span class="h-mut">今日</span>
    <span class="h-mut">{{week}}</span>
  </div>
</div>`
  const css = shell + `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;overflow:hidden;padding:7px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:11px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-row{display:flex;align-items:center;gap:4px}
.d-day{font-size:30px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}`
  return { html, css }
}

// ================= 30. 基础设备概览卡片（自动统计） =================
export function tplOverview() {
  const html = `<div class="hc" data-hc="device-drawer" title="点击查看设备并控制">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-success)">{{glyph}}</span>
    <span class="h-t">设备概览</span>
    <span class="h-go material-symbols-outlined">chevron_right</span>
  </div>
  <div class="h-fill h-mid" style="gap:5px">
    <div class="o-cell" data-hc="device-drawer" data-filter="all" title="查看全部设备"><b>{{total}}</b><i>设备总数</i></div>
    <div class="o-cell" data-hc="device-drawer" data-filter="active" title="查看开启中的设备"><b style="color:var(--hc-success)">{{online}}</b><i>开启中</i></div>
    <div class="o-cell" data-hc="device-drawer" data-filter="inactive" title="查看已关闭的设备"><b style="color:var(--hc-sub)">{{offline}}</b><i>已关闭</i></div>
    <div class="o-cell" data-hc="device-drawer" data-filter="lights_on" title="查看开启的灯光"><b style="color:var(--hc-primary)">{{lightsOn}}</b><i>灯光开启</i></div>
    <div class="o-cell" data-hc="device-drawer" data-filter="all" title="查看全部设备"><b style="color:var(--hc-info)">{{domains}}</b><i>类型</i></div>
  </div>
</div>`
  const css = shell + `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:5px;overflow:hidden;padding:8px;cursor:pointer}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:11px}
.h-t{font-size:10px;font-weight:600;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.h-go{font-size:12px;color:var(--hc-sub);opacity:.6}
.h-row{display:flex;align-items:center;gap:4px}
.o-cell{flex:1;min-width:0;text-align:center;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:5px 0 4px}
.o-cell b{display:block;font-size:15px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}
.o-cell i{font-style:normal;font-size:7px;color:var(--hc-sub);display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`
  return { html, css }
}

// ================= 27. 地图卡片 =================
export function tplMap() {
  const html = `<div class="hcm" data-map></div>`
  const css = `.hcm{flex:1;min-height:0;border-radius:14px;overflow:hidden;
  border:1px solid var(--hc-border);border-width:var(--card-bw,1px);
  box-shadow:0 1px 3px rgb(0 0 0 / .07),0 8px 20px -8px rgb(0 0 0 / .16)}`
  return { html, css }
}

export const JS_COMMON = `// 可用：el=卡片根元素，card={type,w,h}，data=当前数据
// 例：el.querySelector('.h-t').textContent='我的标题'`

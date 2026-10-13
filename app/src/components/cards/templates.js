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
const SHELL_BASE = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;overflow:hidden;padding:8px;border-radius:14px;
  background:linear-gradient(165deg,rgb(255 255 255 / .05),rgb(255 255 255 / 0) 46%),color-mix(in srgb,var(--hc-bg2) 72%,var(--hc-bg));
  border:1px solid var(--hc-border);
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
  border:1px solid var(--hc-border);
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
  <div class="h-fill" style="display:flex;flex-direction:column;justify-content:flex-end;gap:2px">{{forecastHtml}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.fc{display:flex;align-items:center;gap:4px;font-size:8px;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:6px;padding:1px 5px}
.fc span.d{width:36px;flex-shrink:0;color:var(--hc-sub)}
.fc b{margin-left:auto;color:var(--hc-text);font-weight:600}`
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

// ================= 26. 基础天气卡片 =================
export function tplWeather() {
  const html = `<div class="hc">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-info)">{{glyph}}</span>
    <span class="h-t">今日天气</span>
  </div>
  <div class="h-fill h-mid" style="gap:8px">
    <span style="font-size:26px;line-height:1">{{icon}}</span>
    <div>
      <p style="font-size:22px;font-weight:600;color:var(--hc-text);line-height:1;margin:0">{{temp}}<small style="font-size:9px;color:var(--hc-sub)">{{unit}}</small></p>
      <p style="font-size:9px;color:var(--hc-sub);margin:1px 0 0">{{condition}}</p>
    </div>
  </div>
  <div class="h-row" style="gap:4px">
    <div class="h-cell h-fill"><span class="h-cap">体感</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{feels}}</b></div>
    <div class="h-cell h-fill"><span class="h-cap">湿度</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{humidity}}</b></div>
    <div class="h-cell h-fill"><span class="h-cap">风力</span><b style="display:block;font-size:10px;color:var(--hc-text)">{{wind}}</b></div>
  </div>
  <div class="h-fill" style="display:flex;flex-direction:column;justify-content:flex-end;gap:2px">{{forecastHtml}}</div>
</div>`
  const css = shell + `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:5px;overflow:hidden;padding:8px}
.h-head{display:flex;align-items:center;gap:5px}
.h-ic{font-size:12px}
.h-t{font-size:11px;font-weight:600;color:var(--hc-text)}
.h-cell{padding:3px 0}
.h-row{display:flex;align-items:center;gap:4px}
.fc{display:flex;align-items:center;gap:4px;font-size:8px;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:6px;padding:1px 5px}
.fc span.d{width:36px;flex-shrink:0;color:var(--hc-sub)}
.fc b{margin-left:auto;color:var(--hc-text);font-weight:600}`
  return { html, css }
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
    <div class="fcd"><i class="half up"><b>{{hh1}}</b></i><i class="half bot"><b>{{hh1}}</b></i><i class="half fa"><b>{{hh1}}</b></i><i class="half fb"><b>{{hh1}}</b></i></div>
    <div class="fcd"><i class="half up"><b>{{hh2}}</b></i><i class="half bot"><b>{{hh2}}</b></i><i class="half fa"><b>{{hh2}}</b></i><i class="half fb"><b>{{hh2}}</b></i></div>
    <span class="fc-colon"><i></i><i></i></span>
    <div class="fcd"><i class="half up"><b>{{mm1}}</b></i><i class="half bot"><b>{{mm1}}</b></i><i class="half fa"><b>{{mm1}}</b></i><i class="half fb"><b>{{mm1}}</b></i></div>
    <div class="fcd"><i class="half up"><b>{{mm2}}</b></i><i class="half bot"><b>{{mm2}}</b></i><i class="half fa"><b>{{mm2}}</b></i><i class="half fb"><b>{{mm2}}</b></i></div>
    <span class="fc-colon"><i></i><i></i></span>
    <div class="fcd"><i class="half up"><b>{{ss1}}</b></i><i class="half bot"><b>{{ss1}}</b></i><i class="half fa"><b>{{ss1}}</b></i><i class="half fb"><b>{{ss1}}</b></i></div>
    <div class="fcd"><i class="half up"><b>{{ss2}}</b></i><i class="half bot"><b>{{ss2}}</b></i><i class="half fa"><b>{{ss2}}</b></i><i class="half fb"><b>{{ss2}}</b></i></div>
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
.fcd-row{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:4px;perspective:400px}
.fcd{position:relative;width:27px;height:42px;font-variant-numeric:tabular-nums;transform-style:preserve-3d}
.fcd .half{position:absolute;left:0;width:100%;height:50%;overflow:hidden;background:var(--hc-bg2);font-style:normal}
.fcd .half b{position:absolute;left:0;width:100%;height:42px;line-height:42px;font-weight:700;font-size:33px;text-align:center;color:var(--hc-text);display:block}
.fcd .up{top:0;border-radius:5px 5px 0 0;border-bottom:1px solid rgb(0 0 0 / .35)}
.fcd .up b{top:0}
.fcd .bot{bottom:0;top:auto;border-radius:0 0 5px 5px;box-shadow:inset 0 3px 5px -3px rgb(0 0 0 / .45)}
.fcd .bot b{bottom:0}
.fcd .fa,.fcd .fb{visibility:hidden;z-index:3;backface-visibility:hidden}
.fcd .fa{top:0;border-radius:5px 5px 0 0;transform-origin:50% 100%;box-shadow:0 2px 4px rgb(0 0 0 / .3)}
.fcd .fa b{top:0}
.fcd .fb{bottom:0;top:auto;border-radius:0 0 5px 5px;transform-origin:50% 0%;transform:rotateX(90deg);box-shadow:inset 0 3px 5px -3px rgb(0 0 0 / .45)}
.fcd .fb b{bottom:0}
.fcd.flip .fa,.fcd.flip .fb{visibility:visible}
.fcd.flip .fa{animation:fcFlipA .3s ease-in forwards}
.fcd.flip .fb{animation:fcFlipB .3s ease-out forwards}
@keyframes fcFlipA{from{transform:rotateX(0)}to{transform:rotateX(-90deg)}}
@keyframes fcFlipB{from{transform:rotateX(90deg)}to{transform:rotateX(0)}}
.fc-colon{display:flex;flex-direction:column;justify-content:center;gap:9px;height:42px;margin:0 1px}
.fc-colon i{width:5px;height:5px;border-radius:50%;background:var(--hc-color);margin:0 auto;animation:fcBlink 2s ease-in-out infinite}
@keyframes fcBlink{0%,100%{opacity:1}50%{opacity:.25}}`
  return { html, css }
}

// 翻页时钟卡片 JS：渲染后执行一次，内部自走 1s 定时器（不依赖组件重渲染）。
// 卡片 DOM 被移除后（el.isConnected=false）自动清掉定时器，不留泄漏。
export const JS_FLIP_CLOCK = `// 翻页时钟：自走 1s 定时器驱动翻页动画；卡片卸载后自动停止
;(function () {
  var ds = el.querySelectorAll('.fcd')
  var dateEl = el.querySelector('.fc-date')
  if (!ds.length) return
  var WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  function p(n) { return (n < 10 ? '0' : '') + n }
  function setD(d, ch) {
    if (d._v === ch) return
    var old = d._v == null ? d.querySelector('.up b').textContent : d._v
    d._v = ch
    d.querySelector('.up b').textContent = ch      // 上半静止 → 立即显示新值
    d.querySelector('.fa b').textContent = old     // 翻下的一半带着旧值落下
    d.querySelector('.fb b').textContent = ch      // 另一半带着新值翻上来
    d.classList.remove('flip')
    void d.offsetWidth                              // 重启动画
    d.classList.add('flip')
    clearTimeout(d._t)
    d._t = setTimeout(function () {
      d.querySelector('.bot b').textContent = ch    // 动画结束：下半静止落为新值
      d.classList.remove('flip')
    }, 320)
  }
  function tick() {
    if (!el.isConnected) { clearInterval(el._fcT); return }
    var t = new Date()
    var s = p(t.getHours()) + p(t.getMinutes()) + p(t.getSeconds())
    for (var i = 0; i < 6; i++) setD(ds[i], s[i])
    if (dateEl) dateEl.textContent = (t.getMonth() + 1) + '月' + t.getDate() + '日 · ' + WEEK[t.getDay()]
  }
  clearInterval(el._fcT)
  tick()
  el._fcT = setInterval(tick, 1000)
})()`

// ================= 高德天气卡片（app 级：不依赖 HA 实体，用已配置的高德 Key 查询） =================
// 链路：卡片 js → window.skAmapKey()（prefs.map_config.amap_key）→ 加载 AMap SDK →
// CitySearch IP 定城市（adcode）→ Weather 插件实况 + 3 天预报。10 分钟自动刷新。
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

export const JS_AMAP_WEATHER = `// 高德天气：IP 定城市 → 实况 + 3 天预报；10 分钟刷新，卡片卸载自动停
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
  function render(live, fc) {
    var days = (fc && fc.forecasts) || []
    var h = '<div class="aw-now">'
      + '<span class="material-symbols-outlined aw-bigic">' + icon(live.weather) + '</span>'
      + '<span class="aw-temp">' + esc(live.temperature) + '<i>°C</i></span>'
      + '</div>'
      + '<div class="aw-desc">' + esc(live.weather) + '</div>'
      + '<div class="aw-meta">' + esc(live.winddirection) + '风' + esc(live.windpower) + '级 · 湿度 ' + esc(live.humidity) + '%</div>'
    if (days.length) {
      h += '<div class="aw-fc">'
      for (var i = 0; i < Math.min(days.length, 3); i++) {
        var d = days[i]
        h += '<div class="aw-day"><span class="aw-dd">' + (i === 0 ? '今天' : esc(String(d.date || '').slice(5))) + '</span>'
          + '<span class="material-symbols-outlined aw-di">' + icon(d.dayweather) + '</span>'
          + '<span class="aw-dt">' + esc(d.nighttemp) + '° / ' + esc(d.daytemp) + '°</span></div>'
      }
      h += '</div>'
    }
    if (bodyEl) bodyEl.innerHTML = h
    if (timeEl) timeEl.textContent = '更新 ' + esc(String(live.reporttime || '').slice(11, 16))
  }
  function start() {
    AMap.plugin('AMap.CitySearch', function () {
      new AMap.CitySearch().getLocalCity(function (st, city) {
        var code = city && city.adcode
        if (!code) { busy = false; say('城市识别失败（网络或 IP 库未覆盖）'); return }
        if (cityEl && city.city) cityEl.textContent = String(city.city).replace(/市$/, '')
        AMap.plugin('AMap.Weather', function () {
          var w = new AMap.Weather()
          w.getLive(code, function (e1, live) {
            if (e1 || !live || !live.temperature) { busy = false; say('实况获取失败，请检查 Key 类型（需 Web 服务）'); return }
            w.getForecast(code, function (e2, fc) {
              busy = false
              render(live, (e2 || !fc) ? null : fc)
            })
          })
        })
      })
    })
  }
  function load() {
    if (busy || !el.isConnected) return
    if (typeof window.skAmapKey !== 'function') { say('等待配置加载…'); return }
    busy = true
    Promise.resolve(window.skAmapKey()).then(function (key) {
      if (!key) { busy = false; say('未配置高德 Key（设置 → 地图定位）'); return }
      if (window.AMap) { start(); return }
      window.skLoadAMap(key).then(function () { start() }).catch(function () { busy = false; say('地图 SDK 加载失败') })
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
  border:1px solid var(--hc-border);
  box-shadow:0 1px 3px rgb(0 0 0 / .07),0 8px 20px -8px rgb(0 0 0 / .16)}`
  return { html, css }
}

export const JS_COMMON = `// 可用：el=卡片根元素，card={type,w,h}，data=当前数据
// 例：el.querySelector('.h-t').textContent='我的标题'`

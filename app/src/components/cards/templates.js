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
const shell = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:4px;overflow:hidden}
.h-head{display:flex;align-items:center;gap:4px;min-width:0}
.h-ic{font-size:13px;color:var(--hc-color,var(--hc-primary));flex-shrink:0}
.h-t{font-size:10px;font-weight:600;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.h-badge{font-size:8px;padding:1px 6px;border-radius:99px;flex-shrink:0;white-space:nowrap}
.b-on{background:rgb(var(--hc-success-rgb) / .15);color:var(--hc-success)}
.b-off{background:var(--hc-bg2);border:1px solid var(--hc-border);color:var(--hc-sub)}
.b-warn{background:rgb(var(--hc-warn-rgb) / .15);color:var(--hc-warn)}
.h-mut{font-size:8px;color:var(--hc-sub)}
.h-fill{flex:1;min-height:0}
.h-mid{display:flex;align-items:center;justify-content:center}
.h-btn{display:flex;align-items:center;justify-content:center;border:1px solid var(--hc-color,var(--hc-primary));background:rgb(var(--hc-primary-rgb) / .12);color:var(--hc-color,var(--hc-primary));border-radius:99px;cursor:pointer;transition:all .15s}
.h-btn:active{transform:scale(.9)}
.h-btn[disabled]{opacity:.4;cursor:default}
.h-btn:empty{display:none}
.h-btn-ghost{background:var(--hc-bg2);border-color:var(--hc-border);color:var(--hc-sub)}
.h-cell{background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:3px 5px;text-align:center;min-width:0}
.h-row{display:flex;align-items:center;gap:4px;min-width:0}
.h-big{font-size:20px;font-weight:600;color:var(--hc-text);line-height:1}
.h-num{font-size:13px;font-weight:600;color:var(--hc-text);line-height:1}
.h-cap{font-size:7px;color:var(--hc-sub);font-style:normal}
.h-bar{width:100%;height:3px;accent-color:var(--hc-color,var(--hc-primary));cursor:pointer}`

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
  <div class="h-row">{{rangeHtml}}</div>
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
  <div class="h-row" style="justify-content:center;gap:6px">
    <button class="h-btn" style="width:30px;height:30px" data-hc="svc" data-svc="cover.open_cover"><span class="material-symbols-outlined" style="font-size:14px">open_in_full</span></button>
    <button class="h-btn h-btn-ghost" style="width:30px;height:30px" data-hc="svc" data-svc="cover.stop_cover"><span class="material-symbols-outlined" style="font-size:14px">stop</span></button>
    <button class="h-btn" style="width:30px;height:30px" data-hc="svc" data-svc="cover.close_cover"><span class="material-symbols-outlined" style="font-size:14px">close_fullscreen</span></button>
  </div>
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

// ================= 11. 通用卡片（多实体） =================
// 一张卡可绑定任意数量实体：头部显示首个实体，下方逐行列出所有实体，
// 开关类域行尾自带开关按钮（data-entity 定向到对应实体）。
export function tplGeneric() {
  const html = `<div class="hc">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined">{{glyph}}</span>
    <span class="h-t">{{name}}</span>
    <span class="g-cnt">{{count}}</span>
  </div>
  <div class="g-rows">{{rowsHtml}}</div>
</div>`
  const css = shell + `
.hc{padding:6px}
.g-cnt{margin-left:auto;font-size:8px;color:var(--hc-sub);background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:99px;padding:0 6px;line-height:14px}
.g-cnt:empty{display:none}
.g-rows{flex:1;min-height:0;display:flex;flex-direction:column;gap:2px;overflow-y:auto;padding-top:2px;scrollbar-width:thin}
.g-rows::-webkit-scrollbar{width:3px}
.g-rows::-webkit-scrollbar-thumb{background:var(--hc-border);border-radius:3px}
.grow{display:flex;align-items:center;gap:4px;min-width:0;flex:none;padding:2px 5px;border-radius:6px;background:var(--hc-bg2);border:1px solid var(--hc-border)}
.g-ic{font-size:11px;line-height:1;flex:none}
.g-nm{flex:1;min-width:0;font-size:8px;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-st{flex:none;max-width:84px;font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g-tg{flex:none;width:18px;height:18px;padding:0;border-radius:99px;border:1px solid var(--hc-border);background:var(--hc-bg2);color:var(--hc-sub);display:flex;align-items:center;justify-content:center;cursor:pointer}
.g-tg .material-symbols-outlined{font-size:10px;line-height:1}
.g-tg.on{background:color-mix(in srgb,var(--gc,var(--hc-primary)) 18%,var(--hc-bg2));border-color:var(--gc,var(--hc-primary));color:var(--gc,var(--hc-primary))}`
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
  <p class="g-sub">{{subtitle}}</p>
  <div class="g-m">
    <div class="g-cell"><b>{{time}}</b><i>时间</i></div>
    <div class="g-cell"><b>{{indoorTemp}}</b><i>室内</i></div>
    <div class="g-cell"><b>{{indoorHumidity}}</b><i>湿度</i></div>
  </div>
</div>`
  const css = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;gap:3px;position:relative;overflow:hidden;padding:8px}
.deco{position:absolute;top:-14px;right:-14px;width:64px;height:64px;border-radius:50%;background:var(--hc-primary);opacity:.1;filter:blur(14px)}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:12px}
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
  const css = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:5px;overflow:hidden;padding:8px}
.h-head{display:flex;align-items:center;gap:5px}
.h-ic{font-size:14px}
.h-t{font-size:11px;font-weight:600;color:var(--hc-text)}
.h-fill{flex:1;min-height:0}
.h-mid{display:flex;align-items:center;justify-content:center}
.h-cell{background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:3px 0;text-align:center;min-width:0}
.h-cap{font-size:7px;color:var(--hc-sub);font-style:normal}
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
  const css = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;overflow:hidden;padding:7px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:12px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-fill{flex:1;min-height:0}
.h-mid{display:flex;align-items:center;justify-content:center}
.h-row{display:flex;align-items:center;gap:4px}
.c-time{font-size:26px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}
.c-sec{font-size:11px;font-weight:600;color:var(--hc-info);line-height:1;font-variant-numeric:tabular-nums;align-self:flex-end;padding-bottom:3px}`
  return { html, css }
}

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
  const css = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;overflow:hidden;padding:7px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:12px}
.h-mut{font-size:8px;color:var(--hc-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-fill{flex:1;min-height:0}
.h-mid{display:flex;align-items:center;justify-content:center}
.h-row{display:flex;align-items:center;gap:4px}
.d-day{font-size:30px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}`
  return { html, css }
}

// ================= 30. 基础设备概览卡片（自动统计） =================
export function tplOverview() {
  const html = `<div class="hc">
  <div class="h-head">
    <span class="h-ic material-symbols-outlined" style="color:var(--hc-success)">{{glyph}}</span>
    <span class="h-t">设备概览</span>
  </div>
  <div class="h-fill h-mid" style="gap:5px">
    <div class="o-cell"><b>{{total}}</b><i>设备总数</i></div>
    <div class="o-cell"><b style="color:var(--hc-success)">{{online}}</b><i>在线</i></div>
    <div class="o-cell"><b style="color:var(--hc-sub)">{{offline}}</b><i>离线</i></div>
    <div class="o-cell"><b style="color:var(--hc-primary)">{{lightsOn}}</b><i>灯光开启</i></div>
    <div class="o-cell"><b style="color:var(--hc-info)">{{domains}}</b><i>类型</i></div>
  </div>
</div>`
  const css = `.hc{flex:1;min-height:0;display:flex;flex-direction:column;gap:5px;overflow:hidden;padding:8px}
.h-head{display:flex;align-items:center;gap:4px}
.h-ic{font-size:12px}
.h-t{font-size:10px;font-weight:600;color:var(--hc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.h-fill{flex:1;min-height:0}
.h-mid{display:flex;align-items:center;justify-content:center}
.o-cell{flex:1;min-width:0;text-align:center;background:var(--hc-bg2);border:1px solid var(--hc-border);border-radius:8px;padding:5px 0 4px}
.o-cell b{display:block;font-size:15px;font-weight:600;color:var(--hc-text);line-height:1;font-variant-numeric:tabular-nums}
.o-cell i{font-style:normal;font-size:7px;color:var(--hc-sub);display:block;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`
  return { html, css }
}

// ================= 27. 地图卡片 =================
export function tplMap() {
  const html = `<div class="hcm" data-map></div>`
  const css = `.hcm{flex:1;min-height:0}`
  return { html, css }
}

export const JS_COMMON = `// 可用：el=卡片根元素，card={type,w,h}，data=当前数据
// 例：el.querySelector('.h-t').textContent='我的标题'`

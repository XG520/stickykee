<template>
  <!-- 代码驱动卡片：DOM/CSS/JS 三段代码全部封装在卡片内部（独立自包含）。
       html 由 {{占位符}} 绑定动态数据；css 以 #scopeId 作用域自注入；js 渲染后执行。
       交互通过事件委托 + data-hc 属性体系分发（见下方 onClick/onInput/onChange）。 -->
  <!-- data-hc-self：标记「卡片自管理图标替换」，全局图标兜底观察器跳过该子树，
       避免多卡场景下每次实体刷新触发 O(卡片数) 的重复扫描（见 hcIcons.initIconWatcher） -->
  <div ref="root" class="hc-code-card" data-hc-self="1" :style="hcVars" v-html="renderedHtml"
    @click="onClick" @input="onInput" @change="onChange"></div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onUpdated, onActivated, nextTick, createApp } from 'vue'
import { useEntities } from '@/composables/useLive'
import { count as perfCount } from '@/utils/perf'
import { renderTemplate, scopeCss, computeData, cardDefaults } from './defaults'
import { bindingSlotTokens } from './data'
import { renderSchemaToHtml } from './designer/blockDefs'
import { domainColorCls } from '@/utils/entities'
import { loadIconList, replaceIconsIn } from '@/utils/hcIcons'
import api from '@/api'
import { store, entityStates, requestEntityRefresh } from '@/store'
import { setOptimistic, clearOptimistic, effectiveOn, applyOptimistic, setServiceOptimistic } from '@/composables/useOptimistic'
import { buildControls, buildServiceCall } from '@/utils/entityControls'
import HomeMap from '@/components/map/HomeMap.vue'
import router from '@/router'
import AlmanacCard from './AlmanacCard.vue'
import BirthdayCard from './BirthdayCard.vue'

const props = defineProps({
  card: { type: Object, required: true },
  // 样式作用域：真实卡片为 card-uid，预览（含图形设计模式）为 preview-uid（须与外部容器 id 一致）。
  scopeId: { type: String, default: '' },
  // freeze：图形设计模式下冻结实时数据（实体状态/分钟时钟不再重建 DOM，避免编辑操作被刷新打断）
  freeze: { type: Boolean, default: false },
  // interactive=false 时屏蔽所有 HA 交互（设计模式下点击/拖动只用于编辑，不触发服务调用）
  interactive: { type: Boolean, default: true },
})
const emit = defineEmits(['device-drawer', 'open-person', 'open-sensor', 'open-multi'])

const { all, hasData } = useEntities()
const root = ref(null)

// 性能基准：卡片重渲染次数。每次实体写入都会让所有「订阅全表」的卡片重渲染，
// 这个计数与 state:batches 的比值（perf 报告里的 cardUpdatesPerBatch）就是扇出规模。
onUpdated(() => perfCount('ui:cardUpdate'))

// 问候卡时间每分钟刷新；其他卡片不需要定时器。
const now = ref(new Date())
let clock = null

// 绑定实体：需要实体的卡片未绑定时渲染统一空态。
// 通用卡为多实体卡：card.entity_ids 保存完整列表；entity_id 为首项，兼容单实体链路。
// 双路读取：优先从 entitySlotMap.entity_ids（Designer 设计产生），兼容旧 card.entity_ids 直读
const needsEntity = computed(() => !!cardDefaults[props.card.type]?.needEntity)

// ---- 人员信息卡的扩展槽位 + 主槽 ----
// entity_ids 主实体 / entity_ids2 中部循环翻动 / entity_ids3 底部滚动轮播 / entity_ids_status head内状态跑马灯
// 双路读取：优先从 entitySlotMap（Designer 设计产生），兼容旧 card.entity_ids* 直读
const slotIds = computed(() => {
  if (props.card.entitySlotMap?.entity_ids?.length) return props.card.entitySlotMap.entity_ids
  return Array.isArray(props.card.entity_ids) ? props.card.entity_ids.filter(Boolean) : []
})
const slotIds2 = computed(() => {
  if (props.card.entitySlotMap?.entity_ids2?.length) return props.card.entitySlotMap.entity_ids2
  return Array.isArray(props.card.entity_ids2) ? props.card.entity_ids2.filter(Boolean) : []
})
const slotIds3 = computed(() => {
  if (props.card.entitySlotMap?.entity_ids3?.length) return props.card.entitySlotMap.entity_ids3
  return Array.isArray(props.card.entity_ids3) ? props.card.entity_ids3.filter(Boolean) : []
})
const slotIdsStatus = computed(() => {
  if (props.card.entitySlotMap?.entity_ids_status?.length) return props.card.entitySlotMap.entity_ids_status
  return Array.isArray(props.card.entity_ids_status) ? props.card.entity_ids_status.filter(Boolean) : []
})
const entityIds = computed(() => {
  if (slotIds.value.length) return slotIds.value
  if (Array.isArray(props.card.entity_ids) && props.card.entity_ids.length) return props.card.entity_ids.filter(Boolean)
  return props.card.entity_id ? [props.card.entity_id] : []
})
const entities = computed(() =>
  // 直接按 id 取（O(1) + 只订阅这几个实体），原先是在全表数组上 find，
  // 卡片数 × 实体数 的扫描会随每次状态推送反复发生
  entityIds.value.map((id) =>
    // 乐观覆盖：点击后立即以目标态渲染（新对象，不污染 entityStates）；
    // 确认/超时/回滚由 useOptimistic 统一管理，模板层零改动
    applyOptimistic(entityStates[id] || null),
  ).filter(Boolean))
const entity = computed(() => entities.value[0] || null)
const entities2 = computed(() => slotIds2.value.map((id) => applyOptimistic(entityStates[id] || null)).filter(Boolean))
const entities3 = computed(() => slotIds3.value.map((id) => applyOptimistic(entityStates[id] || null)).filter(Boolean))
const entitiesStatus = computed(() => slotIdsStatus.value.map((id) => applyOptimistic(entityStates[id] || null)).filter(Boolean))
// 槽位2 多实体时循环翻动：DOM 层轮换 .on 类（6s 间隔），不走数据驱动——
// 若由 cycleIdx 驱动 liveData，每次翻动都会重建 v-html，下方跑马灯会被一并重置。
// tick 时现查 DOM，v-html 因状态推送重建后依然安全（initCycle 在 postRender 兜底首项可见）。
let cycleTimer = null
function cycleTick() {
  const r = root.value
  if (!r) return
  const items = r.querySelectorAll('.pi-cy-item')
  if (items.length < 2) return
  let cur = -1
  items.forEach((n, i) => { if (n.classList.contains('on')) cur = i })
  const next = (cur + 1) % items.length
  items.forEach((n, i) => n.classList.toggle('on', i === next))
}
function initCycle() {
  const r = root.value
  if (!r) return
  const items = r.querySelectorAll('.pi-cy-item')
  if (items.length && !r.querySelector('.pi-cy-item.on')) items[0].classList.add('on')
}
function setupCycle() {
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null }
  if (props.freeze || props.card.type !== 'personInfo') return
  cycleTimer = setInterval(cycleTick, 6000)
}
watch(() => [props.card.type, props.freeze], setupCycle)

const liveData = computed(() => {
  const d = computeData(props.card.type, { all: all.value, hasData: hasData.value, entity: entity.value, entities: entities.value, entityId: props.card.entity_id, now: now.value, card: props.card, entities2: entities2.value, entities3: entities3.value, entitiesStatus: entitiesStatus.value })
  // 卡片自定义图标：覆盖模板头部 {{glyph}}（领域实体图标 / 基础卡默认图标均可替换）
  if (props.card.icon) d.glyph = props.card.icon
  // 积木设计器：binding_entity 按槽位下标输出 s_<slot>_<index>_{icon,name,state,unit} 占位符，
  // 仅在设计器产物上注入，旧卡片零额外开销
  if (props.card._designerSchema || props.card.compiledHtml || props.card.schema) {
    Object.assign(d, bindingSlotTokens({
      entity_ids: entities.value,
      entity_ids2: entities2.value,
      entity_ids3: entities3.value,
      entity_ids_status: entitiesStatus.value,
    }))
  }
  return d
})

// freeze（图形设计模式）：数据在进入冻结/切换实体时快照一次，状态推送不再重建 DOM
const frozenData = ref(null)
function refreshFrozen() { if (props.freeze) frozenData.value = liveData.value }
watch(() => props.freeze, (f) => { if (f) frozenData.value = liveData.value })
watch(() => [props.card.entity_id, entityIds.value.join(), slotIds2.value.join(), slotIds3.value.join(), props.card.icon], refreshFrozen)
watch(() => props.card.type, refreshFrozen)
watch(hasData, (v) => { if (v && props.freeze && !frozenData.value) refreshFrozen() })
const data = computed(() => (props.freeze ? frozenData.value || liveData.value : liveData.value))

// Phase 3：有 schema / compiledHtml 时优先使用；否则走原有 card.html 路径
// 双路渲染的占位符替换沿用 {{xxx}} → data.value 注入，保持向后兼容

const renderedHtml = computed(() => {
  if (needsEntity.value && !entity.value) {
    const msg = hasData.value ? '未绑定实体或实体不存在' : '等待 Home Assistant 连接…'
    return `<div class="hc-empty"><span class="material-symbols-outlined" style="font-size:20px;opacity:.5">link_off</span><span>${msg}</span></div>`
  }

  // Phase 3：schema 路径
  const schema = props.card._designerSchema || props.card.schema
  if (schema || props.card.compiledHtml) {
    let html = props.card.compiledHtml
    if (!html && schema) {
      html = renderSchemaToHtml(schema, { entitySlots: {} })
    }
    // 占位符替换：把 {{key}} 替换为 data.value 中的值，缺失的保留原样
    return renderTemplate(html || '', data.value)
  }

  // 旧路径：没有 schema → 走现有 card.html
  return renderTemplate(props.card.html, data.value)
})

// ---- 颜色注入：卡片统一用 var(--hc-*) 语义变量，跟随全局主题 ----
//  - --hc-color：领域色（按实体域/卡类型注入，模板内强调色默认用它，用户可覆盖）
//  - --hc-*：卡片级主题桥接变量，映射全局 --c-*（切主题即跟随）；
//    完整色（rgb(...)）直接用于 color/background，同名 -rgb 三元组用于半透明 rgb(var(--hc-x-rgb) / .15)
const hcVars = computed(() => {
  const hex = { 'text-warning': '#E8A84C', 'text-primary': '#F5A623', 'text-info': '#6BA3D9', 'text-success': '#5EC4B0', 'text-accent': '#5EC4B0', 'text-muted': '#8A8986' }
  const fix = { greeting: '#F5A623', weather: '#6BA3D9', map: '#5EC4B0', toggle: '#F5A623', clock: '#6BA3D9', flipclock: '#6BA3D9', amapweather: '#6BA3D9', date: '#E8A84C', overview: '#5EC4B0' }
  const cls = domainColorCls[entity.value?.domain]
  const c = (cls && hex[cls]) || fix[props.card.type] || '#F5A623'
  return {
    '--hc-color': c,
    '--hc-scheme': hcScheme.value,
    '--hc-primary': 'rgb(var(--c-primary))',
    '--hc-primary-rgb': 'var(--c-primary)',
    '--hc-accent': 'rgb(var(--c-accent))',
    '--hc-accent-rgb': 'var(--c-accent)',
    '--hc-success': 'rgb(var(--c-success))',
    '--hc-success-rgb': 'var(--c-success)',
    '--hc-warn': 'rgb(var(--c-warning))',
    '--hc-warn-rgb': 'var(--c-warning)',
    '--hc-info': 'rgb(var(--c-info))',
    '--hc-info-rgb': 'var(--c-info)',
    '--hc-error': 'rgb(var(--c-error))',
    '--hc-error-rgb': 'var(--c-error)',
    '--hc-bg': 'rgb(var(--c-surface))',
    '--hc-bg-rgb': 'var(--c-surface)',
    '--hc-bg2': 'rgb(var(--c-surface-alt))',
    '--hc-bg2-rgb': 'var(--c-surface-alt)',
    '--hc-text': 'rgb(var(--c-on-surface))',
    '--hc-sub': 'rgb(var(--c-muted))',
    '--hc-faint': 'rgb(var(--c-faint))',
    '--hc-border': 'rgb(var(--c-border))',
  }
})

// 深浅色侦测：按全局 --c-background 亮度决定 --hc-scheme（浅色主题下原生控件如输入框跟随浅色）
const hcScheme = ref('dark')
let schemeObs = null
function updateScheme() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--c-background').trim()
  const nums = (v.match(/\d+/g) || []).map(Number)
  const lum = nums.length >= 3 ? 0.299 * nums[0] + 0.587 * nums[1] + 0.114 * nums[2] : 0
  hcScheme.value = lum > 150 ? 'light' : 'dark'
}

// ---- CSS：卡片自管理，按 #scopeId 作用域注入，卸载时移除（不污染其他卡片） ----
const styleEl = ref(null)
function applyCss() {
  const css = props.card.css || ''
  if (!css) {
    if (styleEl.value) styleEl.value.textContent = ''
    return
  }
  const sel = '#' + (props.scopeId || 'card-' + props.card.uid)
  if (!styleEl.value) {
    styleEl.value = document.createElement('style')
    document.head.appendChild(styleEl.value)
  }
  // 拼接滚动（marquee）样式：文本溢出时包两层 .hc-mq-copy（中间带间隙），
  // 位移 = 单份宽度 + 间隙，循环复位时第二份恰好接上第一份（首尾相连、无缝循环）。
  const marqueeCss =
    sel + ' .hc-mq-in{display:inline-block;white-space:nowrap;animation:hc-marquee var(--hc-mq-dur,6s) linear infinite;will-change:transform}' +
    sel + ' .hc-mq-copy{display:inline-block}' +
    sel + ' .hc-mq-gap{display:inline-block;width:var(--hc-mq-gap,24px)}' +
    '@keyframes hc-marquee{0%{transform:translateX(0)}100%{transform:translateX(calc(-1 * var(--hc-mq-dx,0px)))}}'
  // 无状态服务调用的点击即时反馈：亮度脉冲（只用 filter，不影响布局），动画结束移除 class
  const firedCss =
    sel + ' .hc-fired{animation:hc-fired-pulse .6s ease-out}' +
    '@keyframes hc-fired-pulse{0%{filter:brightness(1.8)}100%{filter:brightness(1)}}'
  styleEl.value.textContent = scopeCss(css, sel) + '\n' + marqueeCss + '\n' + firedCss
}

// 文本溢出自动右向左循环滚动：渲染后扫描常见文本元素，
// 内容宽度超出容器时包一层 .hc-mq-in 并设置位移/时长变量，循环显示完整文本。
// 单次合并查询（原为 5 次遍历），scrollWidth 读取会强制回流，属于热路径。
function applyMarquee() {
  const r = root.value
  if (!r) return
  for (const el of r.querySelectorAll('.h-t,.h-mut,.h-nm,.h-big,.c-sec,.h-sub-v')) {
    if (el.querySelector('.hc-mq-in, [data-hc]')) continue
    if (el.scrollWidth <= el.clientWidth + 2) continue
    // 保证单行 + 溢出裁剪（模板一般已设置，缺失时补齐，避免动画溢出）
    el.style.whiteSpace = 'nowrap'
    el.style.overflow = 'hidden'
    const text = el.textContent || ''
    const inner = document.createElement('span')
    inner.className = 'hc-mq-in'
    // 复制两份内容，中间夹一个间隙；位移距离 = 单份宽 + 间隙宽，
    // 循环到尽头时第二份恰好处于第一份的起点 → 首尾相连、无缝循环。
    const c1 = document.createElement('span')
    c1.className = 'hc-mq-copy'
    c1.textContent = text
    const gap = document.createElement('span')
    gap.className = 'hc-mq-gap'
    const c2 = document.createElement('span')
    c2.className = 'hc-mq-copy'
    c2.textContent = text
    inner.append(c1, gap, c2)
    el.textContent = ''
    el.appendChild(inner)
    const copyW = c1.scrollWidth
    const gapW = gap.offsetWidth || 24
    const dx = Math.max(30, copyW + gapW)
    const dur = Math.max(3, Math.round(dx / 22))
    el.style.setProperty('--hc-mq-dx', dx + 'px')
    el.style.setProperty('--hc-mq-dur', dur + 's')
  }
}

// ---- JS：渲染后执行，暴露 (el, card, data) ----
function applyJs() {
  if (!props.card.js || !root.value) return
  try {
    new Function('el', 'card', 'data', props.card.js)(
      root.value,
      { type: props.card.type, uid: props.card.uid, w: props.card.w, h: props.card.h },
      data.value,
    )
  } catch (e) {
    console.error('[card-js]', props.card.type, e)
  }
}

// ---- 自驱动卡片（卡片 JS 自管定时器）的存活保障 ----
// 这类卡在 keep-alive 停用期间因 DOM 脱离文档会自清定时器（防泄漏设计），
// 重新激活后需重跑 JS 才能恢复；主题切换（themes.applyTheme）同样可能打断动画。
// 卡内 JS 起始均自带 clearInterval 幂等保护，重跑安全；防抖合并短时间内的多次触发
// （如设置页拖动自定义主题色时高频 applyTheme）。
const SELF_DRIVING_TYPES = new Set(['flipclock', 'amapweather', 'weather'])
let jsRestartT = null
function restartCardJs() {
  if (props.freeze || !SELF_DRIVING_TYPES.has(props.card.type)) return
  clearTimeout(jsRestartT)
  jsRestartT = setTimeout(() => nextTick(applyJs), 300)
}
// keep-alive 激活（从设置页等返回首页）+ 主题应用完成广播（新增主题类型自动覆盖）
onActivated(restartCardJs)
window.addEventListener('sk-theme-applied', restartCardJs)

// ---- 事件委托：data-hc 属性体系 ----
//  data-hc="toggle"                  → 切换实体开关
//  data-hc="svc"  data-svc="d.svc"   → 调用 HA 服务（data-args 静态参数 / data-from 取输入值）
//  data-hc="link" data-href="#/map"  → 路由跳转
// ---- 无状态服务调用（svc/select）的即时反馈与防连点 ----
// 点击立即脉冲反馈（hc-fired 动画，结束自动移除），不等服务端返回；
// 同一控件 1s 内重复触发忽略（反馈已即时给出，重复调用只会骚扰设备）。
// WeakSet 键随 v-html 重渲染丢弃的旧元素一起被 GC，无泄漏。
const svcLock = new WeakSet()
function markFired(el) {
  el.classList.add('hc-fired')
  el.addEventListener('animationend', () => el.classList.remove('hc-fired'), { once: true })
}
function doSvc(el) {
  const svc = el.dataset.svc
  if (!svc) return
  if (svcLock.has(el)) return
  svcLock.add(el)
  setTimeout(() => svcLock.delete(el), 1000)
  markFired(el)
  const dot = svc.indexOf('.')
  const domain = svc.slice(0, dot)
  const service = svc.slice(dot + 1)
  let args = {}
  try { args = JSON.parse(el.dataset.args || '{}') } catch { /* 忽略非法 JSON */ }
  const from = el.dataset.from
  if (from) {
    const input = root.value && root.value.querySelector(from)
    if (input) {
      let val = input.value
      if (domain === 'input_datetime' && service === 'set_datetime' && val && val.includes('T')) {
        const [date, time] = val.split('T')
        args = { ...args, date, time: time || '00:00' }
      } else {
        args = { ...args, value: val }
      }
    }
  }
  // data-entity 可将操作定向到多实体卡（通用卡）中的具体实体，缺省回退到卡片主实体
  const targetId = el.dataset.entity || props.card.entity_id
  // 乐观更新：可映射状态/属性的服务立即按目标态渲染，WS 确认/超时/失败校正。
  const patched = targetId ? setServiceOptimistic(targetId, domain, service, args) : false
  api.callService(store.activeID, { domain, service, entity_id: targetId, service_data: args })
    .then(() => requestEntityRefresh(300))
    .catch(() => { if (patched) clearOptimistic(targetId) })
}
function onClick(e) {
  if (!props.interactive) return
  const el = e.target.closest('[data-hc]')
  if (!el) {
    // 点击卡面（未命中任何交互控件）按内容弹详情：
    // 人员位置卡 → 人员弹窗；实体组卡 → 组控制弹窗；多实体卡 → 实体列表控制弹窗；单实体 sensor → 传感器历史弹窗
    if (props.card.type === 'person') { emit('open-person'); return }
    if (props.card.type === 'group') { emit('open-multi'); return }
    const ids = (props.card.entity_ids || []).filter(Boolean)
    if (ids.length > 1) { emit('open-multi'); return }
    const mainId = ids[0] || props.card.entity_id
    if (mainId && String(entityStates[mainId]?.domain) === 'sensor') emit('open-sensor')
    return
  }
  const hc = el.dataset.hc
  if (hc === 'toggle') {
    const targetId = el.dataset.entity || props.card.entity_id
    if (targetId) {
      // 乐观更新：立即按目标态渲染，不等服务端往返（消除动画滞后与连带误点）。
      // 优先按能力模型取开关服务载荷精确覆盖（空调→目标模式、媒体→播放态…），
      // 映射不到回退布尔开态；override 存在期间再点 = 反转目标并重发（连点改主意），
      // 8s 未确认自动回退真实态。
      const live = entityStates[targetId]
      const t = live ? buildControls(applyOptimistic(live)).find((c) => c.kind === 'toggle') : null
      const payload = t ? buildServiceCall(t, null) : null
      if (!(payload && setServiceOptimistic(targetId, payload.domain, payload.service, payload.data || {}))) {
        setOptimistic(targetId, !effectiveOn(live))
      }
      api.toggle(store.activeID, targetId)
        .then(() => requestEntityRefresh(300))
        .catch(() => clearOptimistic(targetId))
    }
  } else if (hc === 'svc') {
    doSvc(el)
  } else if (hc === 'link') {
    router.push(el.dataset.href || '/')
  } else if (hc === 'device-drawer') {
    // 概览卡按点击的统计格过滤抽屉：新模板格子上带 data-filter；
    // 旧卡片保存的 HTML 没有该属性，退化为按格子文字识别（同一批标签）。
    let filter = el.dataset.filter || ''
    if (!filter) {
      const cell = e.target.closest('.o-cell')
      if (cell) {
        // 旧卡片保存的 HTML 没有 data-filter：先按格子文字识别，再按格子位置兜底
        // （位置对应模板固定顺序：总数/开启中/已关闭/灯光/类型），避免用户改过标签文字后失效
        // 文字提取兼容跑马灯：溢出时文本被复制成两份，取第一份再匹配
        const iEl = cell.querySelector('i')
        const label = iEl ? ((iEl.querySelector('.hc-mq-copy')?.textContent || iEl.textContent || '').trim()) : ''
        const byLabel = { 在线: 'active', 离线: 'inactive', 开启中: 'active', 已关闭: 'inactive', 灯光开启: 'lights_on' }[label]
        const cells = [...(cell.parentElement ? cell.parentElement.querySelectorAll('.o-cell') : [])]
        const byIndex = ['all', 'active', 'inactive', 'lights_on', 'all'][cells.indexOf(cell)] || 'all'
        filter = byLabel || byIndex
      }
    }
    emit('device-drawer', filter || 'all')
  } else if (!el && props.card.type === 'greeting') {
    // 问候卡整体可点：旧卡片保存的 HTML 没有 data-hc 标记，按卡类型兜底
    emit('device-drawer', 'all')
  }
}

// 滑条实时调用：data-hc="range" data-svc data-key data-div（值除以 data-div，默认 1）
// 拖动过程按元素 120ms 节流上报，避免逐像素打 HA；change（松手）时立即补发一次。
const rangeTimers = new Map()
function onInput(e) {
  if (!props.interactive) return
  const el = e.target.closest('[data-hc="range"]')
  if (!el) return
  if (!el.dataset.svc || !el.dataset.key) return
  clearTimeout(rangeTimers.get(el))
  rangeTimers.set(el, setTimeout(() => { rangeTimers.delete(el); pushRange(el) }, 120))
}

function pushRange(el) {
  const svc = el.dataset.svc
  const key = el.dataset.key
  if (!svc || !key) return
  const dot = svc.indexOf('.')
  const domain = svc.slice(0, dot)
  const service = svc.slice(dot + 1)
  const v = Number(el.value)
  if (!Number.isFinite(v)) return
  const div = Number(el.dataset.div || 1) || 1
  const val = v / div
  const targetId = el.dataset.entity || props.card.entity_id
  // 乐观更新：滑条拖动即刷新关联读数（音量/亮度/温度等属性目标值）。
  // 节流期间连续触发，单次失败不清除（后续推流会纠正，避免拖动中读数跳变）。
  if (targetId) setServiceOptimistic(targetId, domain, service, { [key]: val })
  api.callService(store.activeID, { domain, service, entity_id: targetId, service_data: { [key]: val } })
    .then(() => requestEntityRefresh(600))
    .catch(() => {})
}

// 下拉/滑条松手：data-hc="select"（data-key 参数名，默认 option）或 range 立即补发
function onChange(e) {
  if (!props.interactive) return
  const rangeEl = e.target.closest('[data-hc="range"]')
  if (rangeEl) {
    clearTimeout(rangeTimers.get(rangeEl))
    rangeTimers.delete(rangeEl)
    pushRange(rangeEl)
    return
  }
  const el = e.target.closest('[data-hc="select"]')
  if (!el) return
  const svc = el.dataset.svc
  if (!svc) return
  const opt = el.value
  if (opt === '') return
  markFired(el)
  const dot = svc.indexOf('.')
  const domain = svc.slice(0, dot)
  const service = svc.slice(dot + 1)
  const key = el.dataset.key || 'option'
  let args = {}
  try { args = JSON.parse(el.dataset.args || '{}') } catch { /* 忽略非法 JSON */ }
  args = { ...args, [key]: opt }
  const targetId = el.dataset.entity || props.card.entity_id
  // 乐观更新：下拉选定即按目标态渲染，WS 确认/超时/失败校正。
  const patched = targetId ? setServiceOptimistic(targetId, domain, service, args) : false
  api.callService(store.activeID, { domain, service, entity_id: targetId, service_data: args })
    .then(() => requestEntityRefresh(300))
    .catch(() => { if (patched) clearOptimistic(targetId) })
}

// ---- 地图：把 HomeMap 挂载到模板中的 [data-map] 容器（注入 router 以支持内部跳转） ----
let mapApp = null
async function mountMap() {
  if (props.card.type !== 'map') return
  await nextTick()
  const holder = root.value && root.value.querySelector('[data-map]')
  if (!holder || mapApp) return
  mapApp = createApp(HomeMap, { height: 'flex' }).use(router)
  mapApp.mount(holder)
}
function unmountMap() {
  if (mapApp) {
    mapApp.unmount()
    mapApp = null
  }
}

// ---- 日历 / 黄历卡：Vue 子组件挂载到 [data-almanac]（类似 map 卡）。
// AlmanacCard 默认前端用 lunar-javascript 计算（零配置可跑）；若用户可选绑定一个天元历法实体，
// data.js 会把 entity.attributes 拆解成 override 字段传入。 ----
let almanacApp = null
async function mountAlmanac() {
  if (props.card.type !== 'almanac') return
  await nextTick()
  const holder = root.value && root.value.querySelector('[data-almanac]')
  if (!holder || almanacApp) return
  const live = liveData.value || {}
  almanacApp = createApp(AlmanacCard, {
    yiOverride: live.yiOverride || '',
    jiOverride: live.jiOverride || '',
    jiShenOverride: live.jiShenOverride || '',
    xiongShaOverride: live.xiongShaOverride || '',
    chongShaOverride: live.chongShaOverride || '',
    rawAttributes: live.rawAttributes || {},
  })
  almanacApp.mount(holder)
}
function unmountAlmanac() {
  if (almanacApp) {
    almanacApp.unmount()
    almanacApp = null
  }
}

// ---- 生日 / 生日倒计时卡：同 almanac 模式挂载（列表 / 倒计时由占位 data-mode 指定） ----
let birthdayApp = null
async function mountBirthday() {
  if (props.card.type !== 'birthday' && props.card.type !== 'birthdayCountdown') return
  await nextTick()
  const holder = root.value && root.value.querySelector('[data-birthday]')
  if (!holder || birthdayApp) return
  birthdayApp = createApp(BirthdayCard, {
    mode: holder.dataset.mode === 'countdown' ? 'countdown' : 'list',
    user: holder.dataset.user || '', // data-user="账号"：展示指定账号生日（仅管理员接口可读）
  })
  birthdayApp.mount(holder)
}
function unmountBirthday() {
  if (birthdayApp) {
    birthdayApp.unmount()
    birthdayApp = null
  }
}

// ---- 视口门控：图标替换 / 跑马灯扫描都含强制回流（scrollWidth / getComputedStyle），
// 卡片很多时对「视口外卡片」逐次执行会造成布局抖动累积卡顿。
// 用 IntersectionObserver 跟踪可见性：不可见时只记脏标记，滚入视口（含 300px 余量）再补做。
const rootVisible = ref(false)
let io = null
let postPending = false
function runPostRender() {
  postPending = false
  if (!root.value) return
  applyIcons()
  applyMarquee()
  initCycle()
}
function schedulePostRender() {
  if (!rootVisible.value) { postPending = true; return }
  nextTick(runPostRender)
}

// 代码变化 → 重渲染、重注入样式、重执行 JS、重挂地图
watch(
  () => [props.card.html, props.card.css, props.card.js],
  () => {
    nextTick(() => {
      unmountMap(); unmountAlmanac(); unmountBirthday()
      applyCss()
      schedulePostRender()
      applyJs()
      mountMap(); mountAlmanac(); mountBirthday()
    })
  },
  { deep: true },
)

// 实时数据（实体状态）变化会导致 v-html 重渲染、DOM 重建，需重新应用图标替换与文本滚动。
watch(renderedHtml, () => schedulePostRender())

// 日历卡若绑定了天元历法实体，entity.attributes 的覆盖值需重新注入 AlmanacCard ——
// AlmanacCard 自身没有 state（内部用 reactive），不能靠 createApp 的 props 更新，必须 unmount 后重挂。
watch(liveData, () => {
  if (props.card.type !== 'almanac' || props.freeze) return
  nextTick(() => { unmountAlmanac(); mountAlmanac() })
}, { deep: true })

// 图标替换：确保后端图标列表就绪后替换本卡图标（依赖已知集合，幂等）。
function applyIcons() {
  loadIconList().then(() => replaceIconsIn(root.value))
}

onMounted(() => {
  // 时钟卡每秒刷新；问候/日期卡每分钟刷新（其余卡片无需定时器）
  if (!props.freeze) {
    if (props.card.type === 'clock') clock = setInterval(() => (now.value = new Date()), 1000)
    else if (props.card.type === 'greeting' || props.card.type === 'date' || props.card.type === 'weather') clock = setInterval(() => (now.value = new Date()), 60000)
  }
  if (props.freeze) frozenData.value = liveData.value
  // 主题深浅色侦测：html 主题类变化时刷新 --hc-scheme（浅色主题下原生控件跟随）
  updateScheme()
  schemeObs = new MutationObserver(updateScheme)
  schemeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  // 视口门控：首帧 IO 回调会给出真实可见性；可见卡片立即做图标/跑马灯，不可见的滚入时补做
  io = new IntersectionObserver((entries) => {
    rootVisible.value = entries.some((e) => e.isIntersecting)
    if (rootVisible.value && postPending) runPostRender()
  }, { rootMargin: '300px 0px' })
  io.observe(root.value)
  applyCss()
  applyJs()
  mountMap()
  mountAlmanac()
  mountBirthday()
  setupCycle()
  schedulePostRender()
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null }
  if (io) { io.disconnect(); io = null }
  if (schemeObs) { schemeObs.disconnect(); schemeObs = null }
  clearTimeout(jsRestartT)
  window.removeEventListener('sk-theme-applied', restartCardJs)
  rangeTimers.forEach((t) => clearTimeout(t))
  rangeTimers.clear()
  unmountMap()
  unmountAlmanac()
  unmountBirthday()
  if (styleEl.value) {
    styleEl.value.remove()
    styleEl.value = null
  }
})
</script>

<style scoped>
.hc-code-card {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.hc-code-card :deep(.hc-empty) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 9px;
  color: var(--hc-sub);
  border-radius: 14px;
  background: linear-gradient(165deg, rgb(255 255 255 / .05), rgb(255 255 255 / 0) 46%), color-mix(in srgb, var(--hc-bg2) 72%, var(--hc-bg));
  border: 1px dashed color-mix(in srgb, var(--hc-border) 80%, transparent);
  border-width: var(--card-bw, 1px); /* 同卡片壳：按视图层缩放反向补偿，渲染厚度恒定 ≈1px */
  box-shadow: 0 1px 2px rgb(0 0 0 / .05), 0 6px 16px -6px rgb(0 0 0 / .1);
}
</style>

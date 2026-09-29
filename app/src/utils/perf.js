// 轻量性能基准：只做打点与计数，不做序列化/不动 DOM，正常使用可忽略开销。
// 目的是给「首屏加载 / 实时推送 / 渲染」三类优化提供可对比的数字。
//
// 用法：页面加载后在控制台执行
//   __hcPerf.report()   打印当前快照（首屏各段耗时、WS 吞吐、写入代价、重渲染次数、资源压缩比）
//   __hcPerf.reset()    清零计数（便于「操作一次 → 看代价」）
//
// 所有时间取自 performance.now()，基准点是页面导航开始，因此表中的毫秒值可直接横向比较。

const enabled = true

// 打点：记录某个时刻（毫秒，相对导航开始）
const marks = new Map()
// 数值序列：同一名字多次记录（用于求平均/最大，例如单次写入耗时）
const series = new Map()
// 计数：累计次数或累计数值（例如消息条数、实体条数）
const counters = new Map()

function bump(name, n) { counters.set(name, (counters.get(name) || 0) + n) }
function push(name, v) {
  const arr = series.get(name)
  if (arr) arr.push(v)
  else series.set(name, [v])
}

// 记录时刻
export function mark(name) {
  if (!enabled) return 0
  const t = performance.now()
  marks.set(name, t)
  return t
}

// 记录 name 相对 from 的耗时（毫秒）；from 不存在返回 0
export function measure(name, from) {
  if (!enabled) return 0
  const t0 = marks.get(from)
  if (t0 === undefined) return 0
  const d = performance.now() - t0
  push('耗时:' + name, d)
  return d
}

// 从某个打点到现在过去了多久
export function since(from) {
  if (!enabled) return 0
  const t0 = marks.get(from)
  return t0 === undefined ? 0 : performance.now() - t0
}

// 计数：count('ws:msg') 累加次数；count('state:entities', 12) 累加数值
export function count(name, n = 1) {
  if (!enabled) return
  bump(name, n)
}

// 记一次耗时样本（用于 applyStates 这类热点函数）
export function record(name, ms) {
  if (!enabled) return
  push(name, ms)
}

// 汇总一个数值序列：次数 / 平均 / 最大
function summarize(arr) {
  if (!arr || !arr.length) return null
  let sum = 0
  let max = 0
  for (const v of arr) { sum += v; if (v > max) max = v }
  return { n: arr.length, avg: +(sum / arr.length).toFixed(2), max: +max.toFixed(2) }
}

// 找到最近一次请求 /entities 的资源计时，用于看压缩是否生效（decoded vs transferred）
function entityResource() {
  if (typeof performance.getEntriesByType !== 'function') return null
  const list = performance.getEntriesByType('resource').filter((e) => e.name.includes('/entities'))
  const e = list[list.length - 1]
  if (!e) return null
  const decoded = e.decodedBodySize || 0
  const transferred = e.transferSize || 0
  return {
    url: e.name.split('/api/v1')[1] || e.name,
    decodedKB: +(decoded / 1024).toFixed(1),
    transferredKB: +(transferred / 1024).toFixed(1),
    ratio: decoded && transferred ? +(transferred / decoded).toFixed(2) : null,
    durationMs: Math.round(e.duration),
  }
}

// 输出一份可读快照
export function report() {
  const boot = {}
  for (const [k, v] of marks) boot[k] = Math.round(v)

  const perf = {}
  for (const [k, v] of series) perf[k] = summarize(v)

  const counts = {}
  for (const [k, v] of counters) counts[k] = v

  // 派生：WS 建连到现在每秒多少条消息 / 多少实体
  const opened = marks.get('ws:open')
  const elapsed = opened === undefined ? 0 : (performance.now() - opened) / 1000
  const derived = {
    wsSeconds: +elapsed.toFixed(1),
    msgsPerSec: elapsed > 0.5 ? +((counters.get('ws:msg') || 0) / elapsed).toFixed(1) : 0,
    entitiesPerSec: elapsed > 0.5 ? +((counters.get('ws:entities') || 0) / elapsed).toFixed(1) : 0,
    // 平均每条消息携带多少实体：越小说明后端合并得越好（优化前≈1）
    entitiesPerMsg: counters.get('ws:msg') ? +((counters.get('ws:entities') || 0) / counters.get('ws:msg')).toFixed(1) : 0,
    // 每次写入引发的卡片重渲染次数：越小说明渲染越细粒度
    cardUpdatesPerBatch: counters.get('state:batches') ? +((counters.get('ui:cardUpdate') || 0) / counters.get('state:batches')).toFixed(1) : 0,
  }

  const out = { boot, perf, counts, derived, entityResource: entityResource() }
  if (typeof console !== 'undefined') {
    // 单行 JSON 放最前面：控制台会把对象折叠成 "Object"，复制日志时拿不到数值，这行是可复制的
    console.info('[perf] ' + JSON.stringify(out))
    console.info('[perf] 首屏打点(ms, 相对导航开始)', boot)
    console.info('[perf] 耗时样本(次数/平均/最大 ms)', perf)
    console.info('[perf] 计数', counts)
    console.info('[perf] 派生指标', derived)
    console.info('[perf] 最近一次 /entities 资源', out.entityResource)
  }
  return out
}

export function reset() {
  marks.clear()
  series.clear()
  counters.clear()
}

// 首次收到实体快照时自动打印一份，省得手动调用
let autoReported = false
export function autoReportOnce() {
  if (autoReported) return
  autoReported = true
  // 延迟一拍，让首屏卡片渲染完再统计
  setTimeout(() => { try { report() } catch { /* 忽略 */ } }, 1500)
}

if (typeof window !== 'undefined') {
  window.__hcPerf = { report, reset }
}

export default { mark, measure, since, count, record, report, reset }
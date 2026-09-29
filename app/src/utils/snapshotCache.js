// 最近一次实体快照的本地持久化（IndexedDB）。
// 目的：首屏先用上次的数据绘制（stale-while-revalidate），随后 WS 全量快照到达即覆盖，
// 避免每次打开都对着空仪表盘等一个 RTT。
//
// 用 IndexedDB 而不是 localStorage：实体全量 JSON 可能上 MB，localStorage 有 ~5MB 配额
// 且写入是同步阻塞主线程的。所有操作失败都静默降级（隐私模式/配额不足/无 indexedDB）。

const DB_NAME = 'hc-snapshot'
const DB_VERSION = 1
const STORE = 'kv'
const KEY = 'entities'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return }
    const r = indexedDB.open(DB_NAME, DB_VERSION)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }).catch((e) => { dbPromise = null; throw e })
  return dbPromise
}

function tx(mode, fn) {
  return openDB().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

// 落盘一份快照。list 必须是「可结构化克隆」的普通对象数组（调用方需 toRaw + 逐项去代理）。
// activeID 一并存下，避免把另一个实例的数据当成当前实例的缓存展示。
export async function saveSnapshot(list, activeID) {
  const payload = { at: Date.now(), activeID: activeID || 0, list }
  await tx('readwrite', (s) => s.put(payload, KEY))
}

// 读取上次快照；无缓存或读取失败返回 null。
export async function loadSnapshot() {
  const v = await tx('readonly', (s) => s.get(KEY))
  return v && Array.isArray(v.list) && v.list.length ? v : null
}

export async function clearSnapshot() {
  await tx('readwrite', (s) => s.delete(KEY))
}

// ---- 通用键值（与实体快照共用同一个库）----
// 只放「可结构化克隆的普通数据」（字符串/数字/普通对象）。首页布局缓存用它：
// 存的是与后端 dashboard 字段同格式的 JSON 字符串，不涉及 Vue 代理，克隆零风险。
export async function saveKV(key, payload) {
  await tx('readwrite', (s) => s.put(payload, key))
}

export async function loadKV(key) {
  const v = await tx('readonly', (s) => s.get(key))
  return v || null
}

// 清空整个库（退出登录时调用）：避免下一个登录用户看到上一位用户的实体与布局
export async function clearAll() {
  await tx('readwrite', (s) => s.clear())
}
// 库存每日提醒（临期/过期/需补货）：APK 内走原生精确闹钟（NativeBridge.setDailyStockReminder
// → StockReminder/StockReminderReceiver，Doze 可唤醒），浏览器端无后台唤醒能力，为 no-op。
// 开关与时间存 localStorage（设备级，跨账号一致）；摘要每次库存页加载后刷新，
// 保证通知里的数字尽量新鲜（通知标题已注明「数据截至最近一次打开库存页」）。

const KEY = 'hc_stock_reminder'

/** 原生桥是否可用（APK 内 true；浏览器/旧版 APK false）。 */
export function reminderAvailable() {
  return !!(typeof window !== 'undefined' && window.StickyKeeNative
    && typeof window.StickyKeeNative.setDailyStockReminder === 'function')
}

/** 读取偏好 {on, time}；缺失时默认关、09:00。 */
export function loadReminderPref() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return { on: p.on === true || p.on === '1', time: p.time || '09:00' }
    }
  } catch { /* 隐私模式等忽略 */ }
  return { on: false, time: '09:00' }
}

/**
 * 保存偏好并同步到原生（APK）；浏览器端只落 localStorage。
 * @param pref {on, time}
 * @param summary 通知正文（如「临期 3 · 过期 1 · 需补货 2」），关闭时忽略
 */
export function applyReminder(pref, summary) {
  try { localStorage.setItem(KEY, JSON.stringify(pref)) } catch { /* 忽略 */ }
  if (!reminderAvailable()) return
  try {
    const enabled = !!(pref.on && pref.time)
    window.StickyKeeNative.setDailyStockReminder(enabled, enabled ? pref.time : '', summary || '')
  } catch { /* 原生桥异常不影响前端 */ }
}

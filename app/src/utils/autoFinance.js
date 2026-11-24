// 支付通知自动记账：APK 原生桥（window.StickyKeeNative）封装。
// 远程页面没有 Capacitor 运行时，只能通过原生注入的 JavascriptInterface 调用。
import { getToken } from '@/api'

function native() {
  return typeof window !== 'undefined' ? window.StickyKeeNative : null
}

export function autoFinanceSupported() {
  return !!native()?.autoFinanceStatus
}

// 每次打开账本时同步服务器地址与登录令牌，供后台通知服务上报。
export function syncAutoFinanceConfig() {
  const n = native()
  if (!n?.configureAutoFinance) return
  try {
    n.configureAutoFinance(window.location.origin + '/api/v1', getToken())
  } catch { /* 忽略 */ }
}

export function autoFinanceStatus() {
  const n = native()
  if (!n?.autoFinanceStatus) return { supported: false, enabled: false, configured: false, pending: 0 }
  try {
    return JSON.parse(n.autoFinanceStatus() || '{}')
  } catch {
    return { supported: false, enabled: false, configured: false, pending: 0 }
  }
}

export function openNotificationAccess() {
  try { native()?.openNotificationAccessSettings?.() } catch { /* 忽略 */ }
}

export function flushAutoFinance() {
  try { native()?.flushAutoFinance?.() } catch { /* 忽略 */ }
}

export function resetAutoFinance() {
  try { native()?.resetAutoFinance?.() } catch { /* 忽略 */ }
}

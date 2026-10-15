// APK 应用内更新：启动时自动检测版本，发现新版本后提示用户一键更新。
// 检测逻辑与 SettingsView 的「系统信息 → 应用内更新」同源，但独立为模块供 App.vue
// 在登录后自动调用，无需用户主动进设置页。
import api, { getToken } from '@/api'
import { isApk } from '@/utils/serverConfig'

// 版本比较：>0 表示 b 比 a 新（逐段数值比较，如 1.0.10 > 1.0.9）
export function cmpVer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n) || 0)
  const pb = String(b || '').split('.').map((n) => parseInt(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d) return d
  }
  return 0
}

const CHECK_KEY = 'hc_apk_update_checked' // sessionStorage：每会话只检测一次

// 检查 APK 更新：返回 { available: true, version } 或 { available: false } 或 null。
// 仅在 APK 环境下有意义（WebView 加载的是服务端网页，版本恒等于服务端，无需更新）。
export async function checkApkUpdate() {
  if (!isApk) return null
  if (sessionStorage.getItem(CHECK_KEY) === '1') return null // 本会话已检测过
  sessionStorage.setItem(CHECK_KEY, '1')
  try {
    const { data } = await api.appInfo()
    if (!data?.apkAvailable || !data?.version) return { available: false }
    // getAppVersion() 返回 build.gradle 的 versionName，是真实 APK 版本
    const nativeVer = window.StickyKeeNative?.getAppVersion?.() || ''
    if (!nativeVer) return { available: false }
    return cmpVer(nativeVer, data.version) > 0
      ? { available: true, version: data.version }
      : { available: false }
  } catch { return null }
}

// 触发应用内更新：经原生桥下载 APK（带进度）→ 完成后原生自动拉起系统安装器。
// 回调：onProgress(pct)、onDone()、onError(msg)。
export function downloadAndInstallApk(onProgress, onDone, onError) {
  const req = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const handler = (e) => {
    const d = e?.detail || {}
    if (d.req !== req) return
    if (d.phase === 'progress') { onProgress?.(d.pct || 0); return }
    if (d.phase === 'done') { onDone?.(); cleanup(); return }
    if (d.phase === 'error') { onError?.(d.message || '更新下载失败'); cleanup(); return }
  }
  function cleanup() { window.removeEventListener('stickykee-apk', handler) }
  window.addEventListener('stickykee-apk', handler)
  try {
    window.StickyKeeNative.downloadAndInstallApk(
      location.origin + '/api/v1/app/download', getToken() || '', req)
  } catch {
    cleanup()
    onError?.('原生下载不可用')
  }
}

// 全局全屏/沉浸模式：所有页面共用（TheHeader 全屏按钮、App 浮动退出按钮）。
// 浏览器 Fullscreen API + ui.immersive（折叠顶栏/导航）联动；Esc 退出全屏时自动恢复外壳。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ui } from '@/store'

// 模块级状态：多个组件共享同一个响应式值（TheHeader 图标、App 退出按钮）
export const isFullscreen = ref(false)

function sync() {
  isFullscreen.value = !!document.fullscreenElement
  if (!document.fullscreenElement) ui.immersive = false
}

async function enter() {
  ui.immersive = true
  try {
    if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen()
  } catch { /* 某些环境不支持全屏时仅隐藏应用外壳 */ }
}

async function exit() {
  ui.immersive = false
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {})
}

async function toggle() {
  if (document.fullscreenElement) exit()
  else enter()
}

export function useFullscreen() {
  onMounted(() => document.addEventListener('fullscreenchange', sync))
  onBeforeUnmount(() => document.removeEventListener('fullscreenchange', sync))
  return { isFullscreen, enter, exit, toggle }
}

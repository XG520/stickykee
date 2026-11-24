<template>
  <!-- 根容器不设不透明白底：底色由 body 兜底（默认主题）或主题背景装饰层（body::before 固定层）提供 -->
  <div class="min-h-screen text-on-background">
    <!-- 公开页（登录/注册）：无顶部导航与应用外壳 -->
    <router-view v-if="isPublic" v-slot="{ Component, route }">
      <transition name="fade" appear>
        <component :is="Component" :key="route.fullPath" />
      </transition>
    </router-view>

    <!-- 应用外壳（登录后）：登录态探测完成且已登录前不渲染，避免闪现首页 -->
    <template v-else-if="auth.checked && auth.user">
      <!-- 沉浸/全屏模式：折叠顶部栏与导航 -->
      <template v-if="!ui.immersive">
        <TheHeader />

        <!-- 桌面端顶部导航（手机端整个容器隐藏，避免留出 pt-4 空档） -->
        <div class="hidden md:block max-w-screen-2xl mx-auto px-6 pt-4">
          <TheNavBar />
        </div>
      </template>

      <!-- 沉浸/全屏模式：全局浮动退出按钮（Esc 也可退出）；鼠标移到按钮位置才显示 -->
      <div v-if="ui.immersive" class="fixed top-0 right-0 z-[100] p-3" @mouseenter="exitEnter" @mouseleave="exitLeave">
        <div class="transition-all duration-500"
          :class="exitShow ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'">
          <button @click="toggleFullscreen" title="退出全屏（可再按 Esc）"
            class="px-3 py-2 rounded-lg bg-surface/90 backdrop-blur border border-border shadow-lg text-sm font-semibold text-on-surface hover:border-primary/40 transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base">fullscreen_exit</span> 退出全屏
          </button>
        </div>
      </div>

      <!-- 主内容：宽度与顶部导航保持一致。
           不加 <transition>：切换时同步卸载旧页再挂载新页。若包 transition，
           旧首页 DOM 会滞留至少一帧，而期间 CodeCard 已移除动态注入的 <style>，
           表现为「闪现无样式的首页」；同步交换还能避免新旧重型页同帧挂载掉帧。
           keep-alive 缓存首页与地图页：仪表盘卡片数多（含地图卡）、地图页含高德
           实例（重建需重新拉 SDK 与全部瓦片），移动端切走再切回秒回，
           HA 实时数据仍经 store 推送保持新鲜。 -->
      <main class="max-w-screen-2xl mx-auto px-6 pt-3 md:pt-5 pb-10">
        <router-view v-slot="{ Component }">
          <keep-alive include="HomeView,MapView">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>

      <!-- 移动端底部 Tab（沉浸模式 / 首页仪表盘编辑态折叠：编辑操作栏在同一位置，避免互相遮挡）。
           外包 transition：进出时向下滑出/滑入，避免突兀消失 -->
      <transition name="hc-slide-up">
        <MobileTabBar v-if="!ui.immersive && !ui.dashEditing" />
      </transition>

      <!-- 全局设备抽屉：概览卡/统计卡/房间概览点击后按条件过滤展示设备（store.deviceDrawer 驱动） -->
      <DeviceDrawer />

      <!-- 全局语音通话覆盖层（来电/通话中界面，WebRTC mesh） -->
      <CallOverlay />

      <!-- APK 版本更新提示弹窗：启动时检测到新版本自动弹出 -->
      <transition name="hc-modal">
        <div v-if="apkUpdate" class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div class="w-full max-w-sm rounded-2xl bg-surface border border-border shadow-2xl p-6 text-center">
            <span class="material-symbols-outlined text-4xl text-primary mb-2" aria-hidden="true">system_update</span>
            <h3 class="text-lg font-semibold text-on-surface mb-1">发现新版本</h3>
            <p class="text-sm text-muted mb-4">v{{ apkUpdate.version }} 已发布，更新以获得最新功能与修复。</p>
            <div v-if="apkDownloading" class="mb-4">
              <div class="h-2 rounded-full bg-surface-alt overflow-hidden">
                <div class="h-full bg-primary transition-all duration-200" :style="{ width: apkPct + '%' }"></div>
              </div>
              <p class="text-xs text-muted mt-1.5">下载中 {{ apkPct }}%</p>
            </div>
            <div v-else class="flex gap-2">
              <button @click="dismissApkUpdate" class="flex-1 h-11 rounded-xl bg-surface-alt border border-border text-muted text-sm font-medium hover:text-on-surface transition-colors">稍后</button>
              <button @click="startApkUpdate" class="flex-1 h-11 rounded-xl bg-primary text-on-primary text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity">立即更新</button>
            </div>
          </div>
        </div>
      </transition>
    </template>

    <!-- APK 服务器地址簿抽屉：登录页（公开页）与登录后都可用，Web 端不渲染 -->
    <ServerManagerSheet />

    <!-- 全局确认弹窗：替代 window.confirm，保证与主题化弹窗样式一致 -->
    <UiConfirm />
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import TheHeader from '@/components/TheHeader.vue'
import TheNavBar from '@/components/TheNavBar.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import DeviceDrawer from '@/components/DeviceDrawer.vue'
import CallOverlay from '@/components/CallOverlay.vue'
import ServerManagerSheet from '@/components/ServerManagerSheet.vue'
import UiConfirm from '@/components/ui/UiConfirm.vue'
import { auth, loadInstances, ui, applyBrandDisplay } from '@/store'
import { useFullscreen } from '@/composables/useFullscreen'
import { useAutoHide } from '@/composables/useAutoHide'
import { checkApkUpdate, downloadAndInstallApk } from '@/utils/appUpdate'

// APK 更新提示：登录后自动检测一次（每会话），发现新版本弹窗提示一键更新
const apkUpdate = ref(null) // { version } 或 null
const apkDownloading = ref(false)
const apkPct = ref(0)
function dismissApkUpdate() { apkUpdate.value = null }
function startApkUpdate() {
  if (apkDownloading.value) return
  apkDownloading.value = true
  apkPct.value = 0
  downloadAndInstallApk(
    (pct) => { apkPct.value = pct },
    () => { apkDownloading.value = false; apkPct.value = 100; apkUpdate.value = null },
    (msg) => { apkDownloading.value = false; console.warn('[appUpdate]', msg) },
  )
}
import { applyTheme, resolveTheme, loadAppearanceFromCache, applyFontSize, applyIconStyle, applyBgFx } from '@/themes'
import { startAutoSync, stopAutoSync } from '@/utils/autoSync'
import { startProximityScreenWake } from '@/utils/sensors'
import { getPrefs } from '@/utils/prefs'

const route = useRoute()
const isPublic = computed(() => !!route.meta.public)
let stopProx = null // 人接近自动亮屏的停止函数
const { toggle: toggleFullscreen } = useFullscreen()
const { visible: exitShow, enter: exitEnter, leave: exitLeave } = useAutoHide(3000)

// 从后端恢复外观权威值（登录成功后 / 已登录刷新时调用）：主题 + 字体大小 + 图标风格，
// 结果由各 apply* 函数写回本地缓存。后端离线或未登录时静默失败，保留本地缓存外观。
async function restoreTheme() {
  try {
    const { data } = await getPrefs()
    const r = resolveTheme(data && data.theme)
    applyTheme(r.themeKey, r.themeKey === 'custom' && r.colors ? r.colors : r.customHex)
    if (data && data.font) applyFontSize(data.font)
    if (data && data.icons) applyIconStyle(data.icons)
    if (data && data.bgfx) {
      try {
        const b = JSON.parse(data.bgfx)
        if (b && b.effect) applyBgFx(b.effect, b.strength)
      } catch { /* 忽略坏配置 */ }
    }
    if (data && data.site_display) {
      try { applyBrandDisplay(JSON.parse(data.site_display)) } catch { /* 忽略坏配置 */ }
    }
  } catch { /* 无会话/离线：保持本地缓存外观 */ }
}
// 用户自定义模板：从 prefs 加载并热注入 cardDefaults，让「添加卡片」面板立即出现。
// 与 restoreTheme 并行，结果独立（模板失败不影响其他启动流程）。
async function restoreTemplates() {
  try {
    const mod = await import('@/composables/useCustomTemplates')
    await mod.loadTemplates()
  } catch { /* 离线 / prefs 暂不可达：模板在下次登录后再恢复 */ }
}

// 登录态变化：登录成功 → 加载实例 + 恢复后端主题；
// 退出登录 → 回到登录页并恢复本地缓存主题。
watch(
  () => auth.user,
  (u) => {
    if (u) {
      loadInstances()
      restoreTheme()
      restoreTemplates()
      // 登录后常驻自动同步：自动定位 + 自动上传传感器（无需手动）
      startAutoSync()
      // 人接近自动亮屏（依赖环境光阴影 + 屏幕唤醒锁，不支持时返回 null）
      stopProx = startProximityScreenWake()
      // APK：登录后自动检测版本，发现新版本弹窗提示更新（每会话只检测一次）
      checkApkUpdate().then((info) => { if (info?.available) apkUpdate.value = { version: info.version } })
    } else {
      stopAutoSync() // 登出/无会话时停止自动同步
      if (stopProx) { stopProx(); stopProx = null } // 释放屏幕唤醒锁
      loadAppearanceFromCache()
    }
  },
  { immediate: true },
)

// 启动时先应用本地缓存外观（防闪烁），已登录刷新时再异步对齐后端权威值。
onMounted(() => {
  loadAppearanceFromCache()
  restoreTheme()
  restoreTemplates()
})
</script>
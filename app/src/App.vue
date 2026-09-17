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

        <!-- 桌面端顶部导航 -->
        <div class="max-w-screen-2xl mx-auto px-6 pt-4">
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

      <!-- 主内容：宽度与顶部导航保持一致 -->
      <main class="max-w-screen-2xl mx-auto px-6 pt-5 pb-10">
        <router-view v-slot="{ Component, route }">
          <transition name="fade" appear>
            <component :is="Component" :key="route.fullPath" />
          </transition>
        </router-view>
      </main>

      <!-- 移动端底部 Tab（沉浸模式折叠，保留桌面导航用处有限，故同样隐藏） -->
      <MobileTabBar v-if="!ui.immersive" />
    </template>
  </div>
</template>

<script setup>
import { computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import TheHeader from '@/components/TheHeader.vue'
import TheNavBar from '@/components/TheNavBar.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import { auth, loadInstances, ui } from '@/store'
import { useFullscreen } from '@/composables/useFullscreen'
import { useAutoHide } from '@/composables/useAutoHide'
import { applyTheme, resolveTheme, loadThemeFromCache } from '@/themes'
import api from '@/api'

const route = useRoute()
const isPublic = computed(() => !!route.meta.public)
const { toggle: toggleFullscreen } = useFullscreen()
const { visible: exitShow, enter: exitEnter, leave: exitLeave } = useAutoHide(3000)

// 从后端恢复主题权威值（登录成功后 / 已登录刷新时调用），结果写回本地缓存。
// 后端离线或未登录时静默失败，此时保留本地缓存主题。
async function restoreTheme() {
  try {
    const { data } = await api.getPrefs()
    const r = resolveTheme(data && data.theme)
    applyTheme(r.themeKey, r.themeKey === 'custom' && r.colors ? r.colors : r.customHex)
  } catch { /* 无会话/离线：保持本地缓存主题 */ }
}

// 登录态变化：登录成功 → 加载实例 + 恢复后端主题；
// 退出登录 → 回到登录页并恢复本地缓存主题。
watch(
  () => auth.user,
  (u) => {
    if (u) {
      loadInstances()
      restoreTheme()
    } else {
      loadThemeFromCache()
    }
  },
  { immediate: true },
)

// 启动时先应用本地缓存主题（防闪烁），已登录刷新时再异步对齐后端权威值。
onMounted(() => {
  loadThemeFromCache()
  restoreTheme()
})
</script>
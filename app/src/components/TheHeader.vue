<template>
  <!-- 单一根节点：原先 header + MessageCenter + HANotifyCenter 三个平级根节点
       （片段组件）。嵌套在条件模板中的片段组件在 vite HMR 热更新时旧根节点可能
       卸载不净，导致顶栏被重复挂载堆叠；包裹单根后组件边界可被可靠回收。 -->
  <div>
  <header class="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
    <div class="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
      <router-link to="/" class="flex items-center gap-3">
        <div v-if="brandDisplay.icon" class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <SiteIcon span-class="text-on-primary text-lg" img-class="w-5 h-5 object-contain" />
        </div>
        <!-- 只保留一个名称时放大字号垂直居中拉满，避免半高留白 -->
        <div v-if="brandDisplay.cn || brandDisplay.en" class="flex flex-col justify-center">
          <h1 v-if="brandDisplay.cn" class="font-headline text-on-background font-semibold leading-tight" :class="brandDisplay.en ? 'text-base' : 'text-xl'">{{ siteName }}</h1>
          <p v-if="brandDisplay.en" class="leading-tight" :class="brandDisplay.cn ? 'text-muted text-xs' : 'text-on-background text-sm font-medium'">{{ siteNameEn }}</p>
        </div>
      </router-link>

      <div class="flex items-center gap-3">
        <span class="hidden md:inline-block text-muted text-sm font-body">{{ auth.user || '' }}</span>
        <button @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏显示（折叠导航栏）'"
          class="w-10 h-10 rounded-full bg-surface-alt border border-border flex items-center justify-center hover:bg-surface-hover transition-colors duration-200">
          <span class="material-symbols-outlined text-on-surface text-base">{{ isFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</span>
        </button>
        <button @click="notifyOpen = !notifyOpen" title="系统通知（Home Assistant 原生通知）"
          class="relative w-10 h-10 rounded-full bg-surface-alt border border-border flex items-center justify-center hover:bg-surface-hover transition-colors duration-200">
          <span class="material-symbols-outlined text-on-surface text-base">notifications</span>
          <span v-if="notifyCount > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-error text-white text-[10px] font-semibold flex items-center justify-center">{{ notifyCount > 9 ? '9+' : notifyCount }}</span>
        </button>
        <button @click="toggleIm" title="聊天与共享（消息中心）"
          class="relative w-10 h-10 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors duration-200">
          <span class="material-symbols-outlined text-primary text-sm">person</span>
          <span v-if="imUnread > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-error text-white text-[10px] font-semibold flex items-center justify-center">{{ imUnread > 99 ? '99+' : imUnread }}</span>
        </button>
        <button @click="logout" title="退出登录"
          class="w-10 h-10 rounded-full bg-surface-alt border border-border flex items-center justify-center hover:bg-error/10 hover:text-error text-on-surface transition-colors duration-200">
          <span class="material-symbols-outlined text-base">logout</span>
        </button>
      </div>
    </div>
  </header>
  <!-- 后端离线时显示红色状态条（正常时不显示，减少视觉噪音） -->
  <div v-if="!backendOnline" class="bg-error/90 text-on-error text-center text-xs font-medium py-1.5 px-4 flex items-center justify-center gap-1.5">
    <span class="material-symbols-outlined text-sm">cloud_off</span>
    后端不可达，实时数据已暂停 · 请检查后端服务与网络
  </div>
  <MessageCenter />
  <HANotifyCenter :open="notifyOpen" @close="notifyOpen = false" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { auth, authLogout, imUnread, toggleIm, entityList, siteName, siteNameEn, backendOnline, brandDisplay } from '@/store'
import { useFullscreen } from '@/composables/useFullscreen'
import MessageCenter from './MessageCenter.vue'
import HANotifyCenter from './HANotifyCenter.vue'
import SiteIcon from './SiteIcon.vue'

const { isFullscreen, toggle: toggleFullscreen } = useFullscreen()

// 系统通知面板开关 + 角标计数（persistent_notification 实体数）
const notifyOpen = ref(false)
const notifyCount = computed(() =>
  entityList.value.filter((e) => e && e.domain === 'persistent_notification').length)

let redirecting = false
async function logout() {
  if (redirecting) return
  redirecting = true
  await authLogout()
  window.location.href = '/login'
}
</script>
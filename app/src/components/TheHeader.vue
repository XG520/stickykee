<template>
  <header class="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
    <div class="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
      <router-link to="/" class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <span class="material-symbols-outlined text-on-primary text-lg">bolt</span>
        </div>
        <div>
          <h1 class="font-headline text-on-background font-semibold text-base leading-tight">归祺</h1>
          <p class="text-muted text-xs leading-tight">Sticky Kee</p>
        </div>
      </router-link>

      <div class="flex items-center gap-3">
        <span class="hidden md:inline-block text-muted text-sm font-body">{{ auth.user || '' }}</span>
        <div class="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border">
          <span class="material-symbols-outlined inline-flex items-center justify-center w-4 h-4 text-base leading-none text-accent">verified</span>
          <span class="text-accent font-body text-xs font-medium">系统正常</span>
        </div>
        <button @click="toggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏显示（折叠导航栏）'"
          class="w-9 h-9 rounded-full bg-surface-alt border border-border flex items-center justify-center hover:bg-surface-hover transition-colors duration-200">
          <span class="material-symbols-outlined text-on-surface text-base">{{ isFullscreen ? 'fullscreen_exit' : 'fullscreen' }}</span>
        </button>
        <button @click="notifyOpen = !notifyOpen" title="系统通知（Home Assistant 原生通知）"
          class="relative w-9 h-9 rounded-full bg-surface-alt border border-border flex items-center justify-center hover:bg-surface-hover transition-colors duration-200">
          <span class="material-symbols-outlined text-on-surface text-base">notifications</span>
          <span v-if="notifyCount > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-error text-background text-[10px] font-semibold flex items-center justify-center">{{ notifyCount > 9 ? '9+' : notifyCount }}</span>
        </button>
        <button @click="toggleIm" title="聊天与共享（消息中心）"
          class="relative w-9 h-9 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center hover:bg-primary/30 transition-colors duration-200">
          <span class="material-symbols-outlined text-primary text-sm">person</span>
          <span v-if="imUnread > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-error text-background text-[10px] font-semibold flex items-center justify-center">{{ imUnread > 99 ? '99+' : imUnread }}</span>
        </button>
        <button @click="logout" title="退出登录"
          class="w-9 h-9 rounded-full bg-surface-alt border border-border flex items-center justify-center hover:bg-error/10 hover:text-error text-on-surface transition-colors duration-200">
          <span class="material-symbols-outlined text-base">logout</span>
        </button>
      </div>
    </div>
  </header>
  <MessageCenter />
  <HANotifyCenter :open="notifyOpen" @close="notifyOpen = false" />
</template>

<script setup>
import { ref, computed } from 'vue'
import { auth, authLogout, imUnread, toggleIm, entityList } from '@/store'
import { useFullscreen } from '@/composables/useFullscreen'
import MessageCenter from './MessageCenter.vue'
import HANotifyCenter from './HANotifyCenter.vue'

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
<template>
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md border-t border-border">
    <div class="max-w-lg mx-auto">
      <div class="flex items-center justify-around h-16">
        <router-link
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-0.5 px-3 py-1.5"
          :class="isActive(item.to) ? 'text-primary' : 'text-muted hover:text-on-surface transition-colors'"
        >
          <span
            class="material-symbols-outlined inline-flex items-center justify-center w-6 h-6 text-2xl leading-none"
            :style="fillStyle(item.to)"
          >{{ item.icon }}</span>
          <span class="text-xs font-body" :class="isActive(item.to) ? 'font-medium' : ''">{{ item.label }}</span>
        </router-link>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()

const items = [
  { to: '/', icon: 'home', label: '首页' },
  { to: '/map', icon: 'map', label: '地图' },
  { to: '/floorplan', icon: 'apartment', label: '户型图' },
  { to: '/devices', icon: 'devices', label: '设备' },
  { to: '/inventory', icon: 'kitchen', label: '库存' },
  { to: '/scenes', icon: 'magic_button', label: '场景' },
  { to: '/settings', icon: 'settings', label: '设置' },
]

function isActive(to) {
  return route.path === to
}

function fillStyle(to) {
  return isActive(to) ? { fontVariationSettings: "'FILL' 1" } : {}
}
</script>
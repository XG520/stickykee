<template>
  <nav class="hidden md:flex items-center gap-1">
    <router-link
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :class="[
        'flex items-center gap-1.5 px-4 py-2 rounded-full font-body text-sm font-medium transition-colors duration-200',
        isActive(item.to)
          ? 'bg-surface-alt text-primary border border-border'
          : 'text-muted hover:text-on-surface hover:bg-surface-alt',
      ]"
    >
      <span class="material-symbols-outlined inline-flex items-center justify-center w-5 h-5 text-xl leading-none">{{ item.icon }}</span>
      {{ item.label }}
    </router-link>
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
  { to: '/scenes', icon: 'magic_button', label: '场景' },
  { to: '/settings', icon: 'settings', label: '设置' },
]

function isActive(to) {
  return route.path === to
}
</script>
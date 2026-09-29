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

    <!-- 首页顶部工具条（页签 + 操作按钮）的挂载槽：由 HomeView 用 Teleport 注入。
         导航栏本身是 hidden md:flex，只在桌面端存在；移动端与沉浸模式下 HomeView 会
         回落到原地渲染，因此手机端的页签与编辑入口不受影响。 -->
    <div id="hc-nav-slot" class="flex-1 min-w-0 flex items-center justify-end gap-2"></div>
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
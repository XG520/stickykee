<template>
  <!-- 全幅地图：无卡片边框，负边距抵消 main 的内边距，铺满头部与底部 Tab 之间的整个区域 -->
  <div class="-mx-6 -mt-3 md:-mt-5 -mb-10 flex flex-col h-[calc(100dvh-126px)] md:h-[calc(100dvh-140px)]">
    <h1 class="sr-only">地图定位</h1>
    <HomeMap height="flex" flat />
  </div>
</template>

<script setup>
import HomeMap from '@/components/map/HomeMap.vue'

// 命名供 <keep-alive include> 缓存：切走再切回地图不重新加载
defineOptions({ name: 'MapView' })
</script>

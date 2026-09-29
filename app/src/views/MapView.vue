<template>
  <div class="py-2">
    <!-- 页面标题只保留给屏读器（可见标题行占的垂直空间已省掉） -->
    <h1 class="sr-only">地图定位</h1>

    <div class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5">
      <HomeMap :height="'min(68vh, 620px)'" />
    </div>

    <p class="text-muted text-xs font-body mt-3">家（黄色区域）与家的范围圆来自 Home Assistant 的 zone 实体；成员标记在设置中选择了「位置同步到」的家人会使用其 HA 头像。浏览器定位需 HTTPS 环境。</p>
  </div>
</template>

<script setup>
import HomeMap from '@/components/map/HomeMap.vue'
</script>
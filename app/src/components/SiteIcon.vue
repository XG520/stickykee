<template>
  <!-- 系统图标统一渲染：自定义图片（siteIconImg，data URL）优先，否则 Material Symbol 名。
       spanClass/imgClass 由使用方按场景传入（字号颜色 / 图片尺寸），保持各入口视觉一致。 -->
  <img v-if="siteIconImg" :src="siteIconImg" :class="imgClass" alt="" draggable="false">
  <span v-else class="material-symbols-outlined" :class="spanClass">{{ siteIcon }}</span>
</template>

<script setup>
import { siteIcon, siteIconImg } from '@/store'

defineProps({
  spanClass: { type: String, default: '' },
  imgClass: { type: String, default: 'w-5 h-5 object-contain' },
})
</script>

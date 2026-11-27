<template>
  <div class="hc-actionbar">
    <div class="hc-actionbar-inner">
      <slot />
    </div>
  </div>
</template>

<script setup>
// 底部操作条：仅表单页使用。吸底 + 向上渐隐背景 + 让出全面屏手势安全区。
</script>

<style scoped>
.hc-actionbar {
  position: sticky;
  bottom: 0;
  z-index: 20;
  margin: 12px -4px 0;
  padding: 10px 4px calc(10px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, rgb(var(--c-background)) 62%, rgb(var(--c-background) / 0));
}
/* 手机端有全局底部 Tab 栏（64px + 安全区），操作条抬到其上方，避免被遮挡 */
@media (max-width: 767px) {
  .hc-actionbar {
    bottom: calc(64px + env(safe-area-inset-bottom, 0px));
    padding-bottom: 10px;
  }
}
.hc-actionbar-inner {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hc-actionbar-inner :deep(button) {
  flex: 1;
  min-height: 44px;
  justify-content: center;
}
@media (min-width: 1024px) {
  .hc-actionbar {
    position: static;
    padding-bottom: 0;
    background: none;
    margin: 12px 0 0;
  }
  .hc-actionbar-inner :deep(button) {
    flex: 0 0 auto;
  }
}
</style>

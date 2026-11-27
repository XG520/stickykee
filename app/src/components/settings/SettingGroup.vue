<template>
  <section class="hc-group">
    <header v-if="title" class="hc-group-head">
      <div v-if="icon" class="hc-group-icon">
        <span class="material-symbols-outlined">{{ icon }}</span>
      </div>
      <div class="hc-group-titles">
        <h2 class="hc-group-title">{{ title }}</h2>
        <p v-if="desc" class="hc-group-desc">{{ desc }}</p>
      </div>
      <slot name="action" />
    </header>
    <div class="hc-group-body">
      <slot />
    </div>
  </section>
</template>

<script setup>
defineProps({
  icon: { type: String, default: '' },
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
})
</script>

<style scoped>
.hc-group {
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border) / 0.65);
  border-radius: 16px;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.025) inset;
  padding: 14px 16px 8px;
  transition: border-color 200ms ease;
  overflow-wrap: anywhere;
}
.hc-group:focus-within {
  border-color: rgb(var(--c-primary) / 0.35);
}
.hc-group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgb(var(--c-border) / 0.55);
}
.hc-group-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: rgb(var(--c-primary) / 0.16);
  color: rgb(var(--c-primary));
}
.hc-group-icon .material-symbols-outlined {
  font-size: 17px;
  line-height: 1;
}
.hc-group-titles {
  flex: 1;
  min-width: 0;
}
.hc-group-title {
  font-family: var(--font-headline, inherit);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: rgb(var(--c-on-background));
  line-height: 1.3;
}
.hc-group-desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: rgb(var(--c-muted));
  line-height: 1.4;
}
.hc-group-body {
  display: flex;
  flex-direction: column;
}
</style>

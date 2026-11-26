<template>
  <header class="flex items-center gap-2 min-h-12">
    <button
      v-if="back"
      class="hc-hdr-btn -ml-2"
      :aria-label="backLabel"
      @click="router.push(to)"
    >
      <span class="material-symbols-outlined">arrow_back</span>
    </button>
    <div class="flex-1 min-w-0">
      <h1 class="font-headline text-lg font-semibold truncate">{{ title }}</h1>
      <p v-if="subtitle" class="mt-0.5 text-[11px] text-muted font-body truncate">{{ subtitle }}</p>
    </div>
    <slot />
  </header>
</template>

<script setup>
import { useRouter } from 'vue-router'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  back: { type: Boolean, default: true },
  to: { type: String, default: '/inventory' },
  backLabel: { type: String, default: '返回生活' },
})

const router = useRouter()
</script>

<style scoped>
.hc-hdr-btn {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--c-on-surface));
  transition: background-color .15s ease;
  flex-shrink: 0;
}
.hc-hdr-btn:hover { background: rgb(var(--c-surface-alt)); }
</style>

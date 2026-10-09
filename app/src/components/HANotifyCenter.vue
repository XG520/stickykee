<template>
  <Teleport to="body">
    <Transition name="nt-fade">
      <div v-if="open" class="fixed inset-0 z-[70]" @click="$emit('close')">
        <!-- 通知面板：锚定顶栏铃铛下方 -->
        <div class="absolute right-4 top-16 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface-alt shadow-2xl overflow-hidden"
          @click.stop>
          <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
            <span class="material-symbols-outlined text-primary text-base">notifications</span>
            <h3 class="font-headline text-on-background font-semibold text-sm flex-1">系统通知</h3>
            <span v-if="notes.length" class="text-muted text-xs font-body">{{ notes.length }} 条</span>
            <button @click="$emit('close')" title="关闭"
              class="w-7 h-7 rounded-full hover:bg-surface-hover flex items-center justify-center text-muted hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-sm">close</span>
            </button>
          </div>

          <div class="max-h-[60vh] overflow-y-auto">
            <div v-for="n in notes" :key="n.entity_id"
              class="flex items-start gap-3 px-4 py-3 border-b border-border/50 last:border-0">
              <div class="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-primary text-base">campaign</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-on-surface text-sm font-medium truncate">{{ title(n) }}</p>
                <p class="mt-0.5 text-muted text-xs leading-relaxed break-words whitespace-pre-wrap max-h-32 overflow-hidden font-body">{{ message(n) }}</p>
                <p v-if="time(n)" class="mt-1 text-muted text-[10px] font-body">{{ time(n) }}</p>
              </div>
              <button @click="dismiss(n)" :disabled="busy" title="清除该通知"
                class="w-7 h-7 rounded-full hover:bg-error/10 hover:text-error text-muted flex items-center justify-center transition-colors shrink-0">
                <span class="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>

            <div v-if="!notes.length" class="flex flex-col items-center py-10 px-6 text-center">
              <span class="material-symbols-outlined text-4xl text-muted opacity-40 mb-2">notifications_off</span>
              <p class="text-on-surface text-sm font-body">暂无系统通知</p>
              <p class="mt-1 text-muted text-xs font-body">Home Assistant 的 persistent_notification 通知会实时同步到这里</p>
            </div>
          </div>

          <div class="px-4 py-2 border-t border-border bg-surface/60">
            <p class="text-muted text-[10px] font-body">与 Home Assistant 原生通知中心同步 · 点垃圾桶清除对应通知</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
// HA 系统通知中心：persistent_notification 实体即 HA 的原生通知（配置错误、固件、登录告警等）。
// 实体集合增删由 entityList（仅成员变化才变更的 shallowRef）驱动；消息/标题为实体属性，原地更新实时跟随。
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import api from '@/api'
import { store, entityList, requestEntityRefresh } from '@/store'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const busy = ref(false)
// 仅在面板展开时枚举，避免常驻计算
const notes = computed(() => {
  if (!props.open) return []
  return entityList.value.filter((e) => e && e.domain === 'persistent_notification')
})

function title(n) {
  return String(n.attributes?.title || n.friendly_name || String(n.entity_id).split('.')[1] || '通知')
}
function message(n) {
  return String(n.attributes?.message ?? n.state ?? '')
}
// 通知 id：优先取属性，退化为实体 object_id（HA 以 persistent_notification.<id> 命名）
function nid(n) {
  return String(n.attributes?.notification_id || String(n.entity_id).split('.')[1] || '')
}
function time(n) {
  const t = n.last_updated || n.last_changed || ''
  return t ? String(t).slice(5, 16).replace('T', ' ') : ''
}
async function dismiss(n) {
  if (busy.value) return
  busy.value = true
  try {
    await api.callService(store.activeID, {
      domain: 'persistent_notification',
      service: 'dismiss',
      service_data: { notification_id: nid(n) },
    })
    requestEntityRefresh(300)
  } catch { /* 清除失败不打断面板 */ }
  finally { busy.value = false }
}

function onKey(e) {
  if (e.key === 'Escape' && props.open) emit('close')
}
watch(() => props.open, (v) => {
  if (v) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style>
.nt-fade-enter-active, .nt-fade-leave-active { transition: opacity .15s ease; }
.nt-fade-enter-from, .nt-fade-leave-to { opacity: 0; }
</style>

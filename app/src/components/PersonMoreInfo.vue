<!-- 人员「更多信息」弹窗：对齐 HA 点击人员后的 more-info 对话框——
     头像/名称/相对更新时间 + 状态徽章 + 当前位置地图（头像标记 + 家范围圈）。
     外壳与 EntityMoreInfo 同风格（遮罩、sticky 头部、ESC/遮罩点击关闭）。 -->
<template>
  <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" data-mi="person">
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')"></div>

    <div class="relative w-full sm:max-w-md max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-background border border-border shadow-2xl">
      <!-- 头部 -->
      <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-background/95 backdrop-blur border-b border-border">
        <div class="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 bg-surface-alt border border-border">
          <img v-if="picture && !picFailed" :src="picture" class="w-full h-full object-cover" alt="" @error="picFailed = true">
          <span v-else class="material-symbols-outlined text-xl text-success">person</span>
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-headline font-bold text-base text-on-background truncate leading-tight">{{ name }}</h2>
          <p class="font-body text-xs text-muted truncate">{{ entityId }}</p>
        </div>
        <button class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors" @click="$emit('close')" aria-label="关闭">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>

      <div class="px-4 py-4 space-y-4">
        <!-- 信息行：大头像 + 名称/相对时间 + 状态徽章 -->
        <div class="flex items-center gap-3 rounded-2xl bg-surface-alt border border-border px-4 py-3">
          <div class="w-12 h-12 rounded-full overflow-hidden shrink-0 border-2 flex items-center justify-center text-white font-semibold text-lg"
            :class="isHome ? 'border-success/60 bg-success' : 'border-faint bg-faint'">
            <img v-if="picture && !picFailed" :src="picture" class="w-full h-full object-cover" alt="" @error="picFailed = true">
            <span v-else>{{ initial }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-body text-sm font-semibold text-on-background truncate">{{ name }}</p>
            <p class="font-body text-xs text-muted">{{ relTime }}</p>
          </div>
          <span class="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium"
            :class="isHome ? 'bg-success/15 text-success' : 'bg-faint/50 text-muted'">{{ stateLabel }}</span>
        </div>

        <!-- 位置地图 -->
        <template v-if="hasPos">
          <div v-if="mapReady" ref="mapEl" class="h-56 rounded-xl overflow-hidden border border-border"></div>
          <p v-else class="font-body text-xs px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-warning flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">map</span>{{ mapError || '地图加载中…' }}
          </p>
        </template>
        <p v-else class="font-body text-xs px-3 py-2 rounded-xl bg-surface-alt border border-border text-muted flex items-center gap-1.5">
          <span class="material-symbols-outlined text-sm">location_off</span>
          该人员暂无位置信息（请在 HA「人员」中为其绑定跟踪设备）
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import api from '@/api'
import { store, entityStates } from '@/store'
import { attr } from '@/utils/entities'
import { loadAMap, getAmapKey } from '@/utils/amap'
import { wgs84ToGcj02 } from '@/utils/gcj02'

const props = defineProps({
  entityId: { type: String, required: true },
})
const emit = defineEmits(['close'])

const entity = computed(() => entityStates[props.entityId] || null)
const name = computed(() => entity.value?.friendly_name || props.entityId)

const stateLabel = computed(() => {
  const s = String(entity.value?.state || '')
  if (s === 'home') return '在家'
  if (s === 'not_home') return '离家'
  return s || '未知'
})
const isHome = computed(() => String(entity.value?.state || '') === 'home')

const picture = computed(() => (attr(entity.value, 'entity_picture') ? api.pictureUrl(store.activeID, props.entityId) : ''))
const picFailed = ref(false)
const initial = computed(() => (name.value || '?').slice(0, 1))

// ---- 相对时间（每分钟刷新）：last_changed → 刚刚 / x 分钟前 / x 小时前 / x 天前 ----
const nowTick = ref(Date.now())
let tickTimer = null
const relTime = computed(() => {
  const t = Date.parse(entity.value?.last_changed || '')
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, nowTick.value - t)
  if (diff < 60e3) return '刚刚'
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`
  return `${Math.floor(diff / 86400e3)} 天前`
})

// ---- 位置与地图 ----
const lat = computed(() => Number(attr(entity.value, 'latitude')))
const lng = computed(() => Number(attr(entity.value, 'longitude')))
const hasPos = computed(() => Number.isFinite(lat.value) && Number.isFinite(lng.value))

// 家的范围（zone.home），用于地图范围圈
const homeZone = computed(() => {
  const z = entityStates['zone.home']
  if (!z) return null
  const zLat = Number(attr(z, 'latitude'))
  const zLng = Number(attr(z, 'longitude'))
  if (!Number.isFinite(zLat) || !Number.isFinite(zLng)) return null
  return { lat: zLat, lng: zLng, radius: Number(attr(z, 'radius')) || 100 }
})

const mapEl = ref(null)
const mapReady = ref(false)
const mapError = ref('')
let map = null
let marker = null

const gcjPt = (x, y) => { const p = wgs84ToGcj02(x, y); return [p.lng, p.lat] }

// 地图头像标记（与 HomeMap 人员标记同款：圆头像 + 白边，在家绿底/离家灰底）
function avatarHTML() {
  const pic = picture.value
  const bg = isHome.value ? '#22c55e' : '#94a3b8'
  const img = pic ? `<img src="${pic}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">` : ''
  return `<div style="width:38px;height:38px;border-radius:50%;overflow:hidden;border:2px solid #fff;background:${bg};box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:600;font-size:16px;position:relative">${img}<span style="position:relative;z-index:0">${initial.value}</span></div>`
}

async function initMap() {
  if (!hasPos.value || map) return
  mapError.value = ''
  try {
    const key = await getAmapKey()
    if (!key) { mapError.value = '未配置高德地图 Key（设置 → 首页地图）'; return }
    const AMap = await loadAMap(key)
    mapReady.value = true
    await nextTick()
    const center = gcjPt(lng.value, lat.value)
    map = new AMap.Map(mapEl.value, { zoom: 15, center })
    marker = new AMap.Marker({
      position: center,
      title: name.value,
      content: avatarHTML(),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, -2),
    })
    marker.addTo(map)
    // 家的范围圈（与 HomeMap 样式一致：琥珀色虚线）
    if (homeZone.value) {
      new AMap.Circle({
        center: gcjPt(homeZone.value.lng, homeZone.value.lat),
        radius: homeZone.value.radius,
        strokeColor: '#F59E0B',
        strokeWeight: 2,
        strokeOpacity: 0.9,
        strokeStyle: 'dashed',
        fillColor: '#F59E0B',
        fillOpacity: 0.08,
      }).addTo(map)
    }
  } catch (e) {
    mapError.value = e.message || '地图加载失败'
  }
}

// 位置/状态实时更新：移动标记并跟随居中；在家状态变化时刷新头像底色
watch([lat, lng], () => {
  if (!map || !marker || !hasPos.value) return
  const p = gcjPt(lng.value, lat.value)
  marker.setPosition(p)
  map.setCenter(p)
})
watch(isHome, () => { if (marker) marker.setContent(avatarHTML()) })

// ---- ESC 关闭 ----
function escHandler(e) { if (e.key === 'Escape') emit('close') }

onMounted(() => {
  window.addEventListener('keydown', escHandler)
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 60000)
  initMap()
})
onUnmounted(() => {
  window.removeEventListener('keydown', escHandler)
  clearInterval(tickTimer)
  try { map?.destroy() } catch { /* 忽略 */ }
  map = null
  marker = null
})
</script>

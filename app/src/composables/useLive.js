// 实时实体组合式：各卡片复用，避免重复订阅逻辑。
import { computed } from 'vue'
import { store, backendOnline, entityStates, refreshEntities } from '@/store'
import { attr } from '@/utils/entities'

export function useEntities() {
  // entityStates 是 reactive 对象，WS 更新后 computed 自动重算。
  const all = computed(() => Object.values(entityStates))
  const hasData = computed(() => backendOnline.value && all.value.length > 0)

  // 首次进入视图时兜底拉取一次实体。返回 resolve 便于调用方 await。
  function ensureLoaded() {
    if (store.ready && store.activeID > 0) return refreshEntities(store.activeID)
    return Promise.resolve([])
  }

  return { all, hasData, backendOnline, ensureLoaded }
}

// 从 person/device_tracker 实体的 attributes 提取带经纬度的位置标记（地图卡用）。
export function usePersonMarkers() {
  const { all, hasData } = useEntities()
  const markers = computed(() => {
    if (!hasData.value) return []
    return all.value
      .filter((e) => e.domain === 'person' || e.domain === 'device_tracker')
      .map((e) => ({
        entity_id: e.entity_id,
        name: e.friendly_name || e.entity_id,
        domain: e.domain,
        away: String(e.state || '').toLowerCase() === 'away',
        lat: Number(attr(e, 'latitude')) || null,
        lng: Number(attr(e, 'longitude')) || null,
        picture: attr(e, 'entity_picture') || '',
        location: attr(e, 'location_name') || attr(e, 'source') || e.state,
      }))
      .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
  })
  return markers
}

// HA 家的范围/区域（zone 实体），用于地图展示家的位置与半径。
export function useZones() {
  const { all, hasData } = useEntities()
  const zones = computed(() => {
    if (!hasData.value) return []
    return all.value
      .filter((e) => e.domain === 'zone')
      .map((e) => ({
        entity_id: e.entity_id,
        name: e.friendly_name || e.entity_id,
        home: e.entity_id === 'zone.home',
        lat: Number(attr(e, 'latitude')) || null,
        lng: Number(attr(e, 'longitude')) || null,
        radius: Number(attr(e, 'radius')) || 100,
      }))
      .filter((z) => Number.isFinite(z.lat) && Number.isFinite(z.lng))
  })
  return zones
}
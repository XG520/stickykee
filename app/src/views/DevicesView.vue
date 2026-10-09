<template>
  <div>
    <!-- 页面标题只保留给屏读器：可见标题行占的垂直空间已省掉，文档大纲与无障碍不受影响 -->
    <h1 class="sr-only">设备管理</h1>

    <p v-if="!backendOnline" class="mb-4 text-error text-sm font-body">后端不可达，无法加载设备数据。请先启动 Go 后端并在「设置」中配置 Home Assistant 实例。</p>
    <p v-else-if="loadedOnce && !devices.length" class="mb-4 text-muted text-sm font-body">暂无设备数据。请确认 Home Assistant 实例可访问且设备注册表非空。</p>
    <!-- 搜索 + 类型筛选 -->
    <div class="flex flex-col gap-3 mb-5">
      <div class="flex items-center gap-2 w-full">
        <div class="relative flex-1">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted text-lg pointer-events-none">search</span>
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索设备 / 实体 / 厂商 / 房间…"
            class="w-full pl-9 pr-9 py-2 rounded-xl bg-surface-alt border border-border text-sm font-body text-on-background placeholder:text-faint outline-none focus:border-primary transition-colors"
          />
          <button v-if="keyword" class="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-on-surface" @click="keyword = ''">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <!-- 设备计数从已删除的标题行移到搜索行右侧，不额外占一行高度 -->
        <span v-if="backendOnline" class="hidden sm:inline shrink-0 font-body text-xs text-muted whitespace-nowrap">
          共 {{ devices.length }} 台 · {{ onDeviceCount }} 在线
        </span>
      </div>
      <div class="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-200"
          :class="filter === tab.key
            ? 'border border-primary bg-primary/10 text-primary'
            : 'border border-border text-muted hover:text-on-surface hover:border-faint'"
          @click="setFilter(tab.key)"
        >{{ tab.label }}</button>
      </div>
    </div>

    <!-- 主从布局：左侧设备分组列表 | 右侧设备详情（桌面并排；手机端列表 + 全屏详情）。
         桌面端用 flex + 视口高度约束：两栏等高且随窗口尺寸变化，列表与详情各自内部滚动，页面不滚。
         18rem ≈ 网格之上的固定占用（顶部栏 60 + 导航 54 + main pt-5 20 + 搜索筛选 106 + 底部留白 40），
         页面标题行已删除故不再计入；窗口过矮时由 min-h 兜底 -->
    <div class="lg:flex lg:gap-6 lg:h-[calc(100vh-18rem)] lg:min-h-[22rem]">

      <!-- 左列：按房间分组的设备列表。桌面端高度由父级 flex 决定（与右侧详情严格等高、随窗口变化），
           自身成为独立滚动区：滚轮落在列表上只滚动列表，不带动页面与右侧详情（overscroll-contain 阻止滚动链） -->
      <div class="hc-hide-bar lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain">
        <div v-for="room in rooms" :key="room.id" v-show="room.visible" class="mb-5">
          <!-- 房间头：点击整块折叠 -->
          <button
            class="w-full flex items-center gap-2 mb-3 group cursor-pointer select-none"
            @click="toggleRoom(room.id)"
          >
            <span class="material-symbols-outlined text-muted text-lg transition-transform duration-200 shrink-0"
              :class="isRoomCollapsed(room.id) ? '-rotate-90' : ''">expand_more</span>
            <span class="material-symbols-outlined text-primary text-lg">{{ roomIcon(room) }}</span>
            <h2 class="font-headline font-bold text-base text-on-background group-hover:text-primary transition-colors">{{ room.name }}</h2>
            <span class="font-body text-xs text-muted bg-surface-alt border border-border px-2 py-0.5 rounded-full">{{ room.devices.length }}</span>
            <span v-if="isRoomCollapsed(room.id)" class="font-body text-xs text-faint ml-auto">{{ onRoomCount(room) }} 在线</span>
            <span v-else class="material-symbols-outlined text-muted text-lg ml-auto">unfold_less</span>
          </button>

          <!-- 设备：桌面为窄列列表、手机为两列网格 -->
          <div v-show="!isRoomCollapsed(room.id)" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              v-for="d in room.devices"
              :key="d.device.id"
              class="rounded-xl p-3 cursor-pointer transition-all duration-200"
              :class="roomDeviceCls(d)"
              @click="openDetail(d)"
            >
              <div class="flex items-start gap-3">
                <div class="relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  :class="d.active_count > 0 ? iconBox(d) : 'bg-faint/15 border border-border'">
                  <span class="material-symbols-outlined text-xl" :class="d.active_count > 0 ? iconColor(d) : 'text-faint'">{{ deviceGlyph(d) }}</span>
                  <span
                    class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background"
                    :class="deviceOnline(d) ? 'bg-success' : 'bg-faint'"
                  ></span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="font-body font-semibold text-sm text-on-background truncate">{{ d.display_name }}</h3>
                    <span v-if="d.disabled" class="font-body text-[10px] px-1.5 py-0.5 rounded-md bg-faint/30 text-faint border border-border font-medium">已禁用</span>
                    <span v-if="domainBadge(d)" class="font-body text-[10px] px-1.5 py-0.5 rounded-md border font-medium" :class="domainBadgeCls(d)">{{ domainBadge(d) }}</span>
                  </div>
                  <p class="font-body text-[11px] mt-0.5 text-muted truncate">{{ deviceMeta(d) }}</p>
                  <p class="font-body text-[10px] mt-0.5 text-faint truncate">{{ d.entity_count }} 个实体</p>
                </div>
                <span class="material-symbols-outlined text-muted text-lg shrink-0 self-center">chevron_right</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 未挂载到设备的实体（可选收起） -->
        <div v-if="visibleUnassigned.length && !keyword" class="mb-6">
          <div class="flex items-center gap-2 mb-3">
            <span class="material-symbols-outlined text-muted text-lg">devices_other</span>
            <h2 class="font-headline font-bold text-base text-on-background">未关联设备</h2>
            <span class="font-body text-xs text-muted bg-surface-alt border border-border px-2 py-0.5 rounded-full">{{ visibleUnassigned.length }}</span>
            <button class="ml-auto text-muted hover:text-on-surface" @click="showUnassigned = !showUnassigned">
              <span class="material-symbols-outlined text-lg">{{ showUnassigned ? 'expand_less' : 'expand_more' }}</span>
            </button>
          </div>
          <div v-show="showUnassigned" class="bg-surface-alt border rounded-xl divide-y divide-border/60 overflow-hidden">
            <div v-for="e in visibleUnassigned" :key="e.entity_id" class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface transition-colors" @click="openEntityQuick(e)">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-faint/15 border border-border">
                <span class="material-symbols-outlined text-base text-faint">{{ glyph(e.domain) }}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-body text-sm font-medium text-on-background truncate">{{ e.friendly_name || e.entity_id }}</span>
                  <span class="font-body text-xs text-faint">{{ e.entity_id }}</span>
                </div>
                <span class="font-body text-xs text-muted">{{ domainLabel(e.domain) }} · {{ stateText(e) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右列：选定设备详情（手机=全屏抽屉，桌面=静态面板） -->
      <div
        v-if="detail"
        class="fixed inset-0 z-[60] lg:relative lg:inset-auto lg:z-auto lg:flex-1 lg:min-w-0 lg:rounded-2xl lg:border lg:border-border lg:bg-surface-alt/60 lg:overflow-hidden lg:shadow-sm"
      >
        <div class="absolute inset-0 bg-black/40 lg:hidden" @click="detail = null"></div>
        <aside class="absolute top-0 right-0 h-full w-full max-w-lg sm:max-w-xl bg-background shadow-2xl flex flex-col lg:static lg:h-full lg:w-auto lg:max-w-none lg:shadow-none">
          <!-- 顶栏：手机端带返回，桌面端仅标题 -->
          <div class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border bg-background/95 lg:bg-transparent">
            <button
              class="lg:hidden shrink-0 flex items-center gap-1.5 pl-1 pr-3 py-1.5 rounded-xl border border-border bg-surface-alt text-on-surface hover:border-primary/50 hover:text-primary transition-colors font-body text-sm font-medium"
              @click="detail = null"
            >
              <span class="material-symbols-outlined text-xl">arrow_back</span>
              返回
            </button>
            <div class="flex items-center gap-2.5 flex-1 min-w-0">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                :class="detail.active_count > 0 ? iconBox(detail) : 'bg-faint/15 border border-border'">
                <span class="material-symbols-outlined text-xl" :class="detail.active_count > 0 ? iconColor(detail) : 'text-faint'">{{ deviceGlyph(detail) }}</span>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <h2 class="font-headline font-bold text-lg text-on-background truncate leading-tight">{{ detail.display_name }}</h2>
                  <span class="shrink-0 w-2 h-2 rounded-full" :class="deviceOnline(detail) ? 'bg-success' : 'bg-faint'" title="在线状态"></span>
                </div>
                <p class="font-body text-xs text-muted truncate">{{ deviceMeta(detail) }}</p>
              </div>
            </div>
            <button class="lg:hidden shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors" @click="detail = null" aria-label="关闭">
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </div>

          <!-- 滚动主体：桌面端同样在面板内部滚动（面板高度固定，避免内容撑高整页） -->
          <div class="hc-hide-bar flex-1 overflow-y-auto">
            <!-- 设备概览 chips -->
            <div class="px-4 py-3 border-b border-border flex flex-wrap items-center gap-2">
              <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-on-surface">{{ domainLabel(detail.domain) || '通用设备' }}</span>
              <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-on-surface">{{ detail.area_name || '未分配区域' }}</span>
              <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-on-surface">{{ detail.entity_count }} 个实体</span>
              <template v-if="detail.device.manufacturer">
                <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-muted">{{ detail.device.manufacturer }}</span>
              </template>
              <template v-if="detail.device.model">
                <span class="font-body text-xs px-2.5 py-1 rounded-lg bg-surface-alt border border-border text-muted">{{ detail.device.model }}</span>
              </template>
            </div>

            <!-- 实体网格 -->
            <div class="px-4 pt-4 pb-2 flex items-center gap-2">
              <span class="font-body text-xs font-semibold text-muted uppercase tracking-wide">实体</span>
              <span class="font-body text-xs text-faint">{{ visibleEntities.length }} 个</span>
            </div>
            <div class="px-4 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                v-for="e in visibleEntities"
                :key="e.entity_id"
                class="flex items-center gap-3 bg-surface-alt border rounded-xl p-3 min-w-0 transition-colors duration-200 cursor-pointer hover:border-primary/60"
                :class="isOn(e) ? 'border-primary/40' : 'border-border'"
                @click="openMore(e)"
              >
                <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  :class="isOn(e) ? iconBox(detail) : 'bg-faint/15 border border-border'">
                  <span class="material-symbols-outlined text-xl" :class="isOn(e) ? iconColor(detail) : 'text-faint'">{{ glyph(e.domain) || 'widgets' }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="font-body text-sm font-medium text-on-background truncate">{{ e.friendly_name || e.entity_id }}</span>
                    <span v-if="e.disabled" class="shrink-0 font-body text-[10px] px-1 py-0.5 rounded bg-warning/15 text-warning border border-warning/30">已禁用</span>
                  </div>
                  <span class="block font-body text-[11px] text-muted truncate">{{ e.entity_id }}</span>
                </div>
                <div class="shrink-0 flex items-center gap-1 pl-1">
                  <span v-if="sensorValue(e)" class="font-body text-sm font-semibold whitespace-nowrap" :class="isOn(e) ? iconColor(detail) : 'text-on-surface'">{{ sensorValue(e) }}</span>
                  <button
                    v-if="canToggle(e) && !e.disabled"
                    class="relative w-10 h-6 rounded-full shrink-0 cursor-pointer transition-colors duration-200"
                    :class="isOn(e) ? accentToggle(detail) : 'bg-faint'"
                    @click.stop="onToggleEntity(e)"
                  >
                    <span
                      class="absolute top-1 left-1 w-4 h-4 rounded-full bg-on-primary shadow transition-transform duration-200"
                      :class="isOn(e) ? 'translate-x-4' : ''"
                    ></span>
                  </button>
                  <span v-if="canToggle(e)" class="font-body text-[11px] font-medium shrink-0" :class="isOn(e) ? iconColor(detail) : 'text-faint'">{{ isOn(e) ? '开' : '关' }}</span>
                  <button
                    v-if="hasMore(e) && !e.disabled"
                    class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                    title="更多操作"
                    @click.stop="openMore(e)"
                  >
                    <span class="material-symbols-outlined text-lg">tune</span>
                  </button>
                </div>
              </div>
              <div v-if="!visibleEntities.length" class="col-span-full px-5 py-10 text-center font-body text-sm text-faint">该设备没有关联实体</div>
            </div>
          </div>
        </aside>
      </div>

      <!-- 桌面：未选中设备时的空态占位（手机端不显示）。与左列等高，撑满右栏 -->
      <div v-else class="hidden lg:flex lg:flex-1 lg:min-w-0 flex-col items-center justify-center rounded-2xl border border-dashed border-faint/60 bg-surface-alt/40 p-10 text-center">
        <span class="material-symbols-outlined text-5xl text-faint mb-3">devices</span>
        <p class="font-body text-muted">从左侧选择一个设备，查看其实体与实时状态</p>
      </div>
    </div>

    <!-- 实体「更多信息」面板（HA more-info 形态）：按实体能力渲染控件 -->
    <EntityMoreInfo v-if="moreEntity" :entity="moreEntity" @close="moreEntityId = ''" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { store, backendOnline, onEntityChange, refreshEntities, entityStates } from '@/store'
import { isOn, isAvailable, iconFor, domainGlyph } from '@/utils/entities'
import { buildControls } from '@/utils/entityControls'
import EntityMoreInfo from '@/components/EntityMoreInfo.vue'

const filter = ref('all')
const keyword = ref('')
const detail = ref(null)
const showUnassigned = ref(true)
// 被折叠的房间 id 集合
const collapsedRooms = ref(new Set())

function isRoomCollapsed(id) { return collapsedRooms.value.has(id) }
function toggleRoom(id) {
  const s = new Set(collapsedRooms.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  collapsedRooms.value = s
}
function onRoomCount(room) { return room.devices.filter(deviceOnline).length }

// 类型 tabs（与官方设备类型接近）
const tabs = [
  { key: 'all', label: '全部' },
  { key: 'light', label: '💡 灯光' },
  { key: 'climate', label: '🌡 环境' },
  { key: 'switch', label: '⚡ 开关' },
  { key: 'media', label: '📺 影音' },
  { key: 'security', label: '🔒 安防' },
  { key: 'cover', label: '🪟 窗帘' },
  { key: 'sensor', label: '📈 传感器' },
  { key: 'other', label: '⚙ 其他' },
]

// 注册表数据
const areas = ref([])
const devices = ref([])
const unassigned = ref([])

const loadedOnce = ref(false)

function setFilter(k) { filter.value = k }

// 某设备若以其主要域归到某 tab：tab → 匹配的域列表
const tabDomains = {
  light: ['light'], switch: ['switch', 'plug', 'input_boolean'], media: ['media_player', 'media'],
  security: ['lock', 'alarm_control_panel', 'camera', 'siren'], climate: ['climate', 'fan', 'humidifier'],
  cover: ['cover', 'garage_door'], sensor: ['sensor', 'binary_sensor'],
}

function deviceDomains(d) {
  const s = new Set()
  for (const e of d.entities || []) { if (!e.disabled) s.add(e.domain) }
  return s
}
// 设备主类型标签
function domainBadge(d) {
  if (d.disabled || !d.domain) return ''
  const map = { light: '灯光', climate: '空调', switch: '开关', media_player: '影音', cover: '窗帘', lock: '门锁', camera: '摄像头', sensor: '传感器', fan: '风扇', humidifier: '加湿', vacuum: '扫地', binary_sensor: '传感器' }
  return map[d.domain] || ''
}
function domainBadgeCls(d) {
  const map = { light: 'bg-warning/15 text-warning border-warning/30', climate: 'bg-info/15 text-info border-info/30', switch: 'bg-primary/15 text-primary border-primary/30', media_player: 'bg-accent/15 text-accent border-accent/30', cover: 'bg-warning/15 text-warning border-warning/30', lock: 'bg-success/15 text-success border-success/30', camera: 'bg-accent/15 text-accent border-accent/30', sensor: 'bg-info/15 text-info border-info/30' }
  return map[d.domain] || 'bg-faint/30 text-faint border-border'
}
function domainLabel(domain) {
  const map = { light: '灯光', climate: '空调', switch: '开关', input_boolean: '布尔开关', media_player: '影音', cover: '窗帘', lock: '门锁', camera: '摄像头', sensor: '传感器', binary_sensor: '传感器', fan: '风扇', humidifier: '加湿器', vacuum: '扫地机器人', siren: '警报器', device_tracker: '设备追踪', number: '数值', select: '下拉选项', automation: '自动化', scene: '场景', script: '脚本', button: '按钮' }
  return map[domain] || domain
}
function glyph(domain) { return domainGlyph[domain] || 'widgets' }
// 设备卡片/详情图标：优先取主实体的 HA 图标（mdi:xxx → Material 图标名，后端按名取 SVG），
// 没有图标时回退到按主域取图标。原先绑定的是 mainIconGlyph，后端并无该字段，图标恒为空。
function deviceGlyph(d) { return iconFor({ icon: d && d.main_icon }, glyph(d && d.domain)) }
// 设备在线：至少一个实体可用（不是 unavailable/unknown），与 HA 的可用性语义一致。
// 不能用 active_count（"开启"的实体数）——传感器等领域永远不会是 on，全关的灯其实也在线。
// liveEntityOf 使在线计数随 WS 实时状态联动（toggle 后设备绿点/房间计数即时更新）。
function deviceOnline(d) {
  if (!d || d.disabled) return false
  return (d.entities || []).some((e) => isAvailable(liveEntityOf(e)))
}
function domainFilterMatch(d) {
  if (filter.value === 'all') return true
  const list = tabDomains[filter.value] || []
  const ds = deviceDomains(d)
  return list.some((x) => ds.has(x))
}

// 房间分组：优先设备 area_id → area_name；无区域归「未分配房间」
const rooms = computed(() => {
  const map = new Map() // key → {id,name,devices}
  for (const d of devices.value) {
    if (!deviceVisible(d)) continue
    const key = d.area_id || '__none__'
    const name = d.area_name || '未分配房间'
    if (!map.has(key)) map.set(key, { id: key, name, devices: [] })
    map.get(key).devices.push(d)
  }
  const out = []
  for (const [, g] of map) { out.push(g) }
  // 排序：已命名房间优先；未分配置顶显示在末位交由排序
  out.sort((a, b) => (a.id === '__none__' ? 1 : 0) - (b.id === '__none__' ? 1 : 0))
  out.forEach((g) => { g.visible = true })
  return out
})

// 设备是否命中当前筛选 + 搜索
function deviceVisible(d) {
  if (!domainFilterMatch(d)) return false
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return true
  const hay = [
    d.display_name, d.device.manufacturer, d.device.model, d.area_name,
    ...(d.entities || []).map((e) => `${e.friendly_name} ${e.entity_id}`),
  ].join(' ').toLowerCase()
  return hay.includes(kw)
}

const visibleUnassigned = computed(() => {
  if (!showUnassigned.value) return []
  if (filter.value !== 'all' && filter.value !== 'sensor') return []
  if (keyword.value.trim()) return []
  return unassigned.value
})

const visibleEntities = computed(() => {
  // 抽屉内实体列表展示设备下全部实体，不受页面搜索框关键字影响（页面关键字只筛外层卡片）。
  // 用 liveEntityOf 取全局 entityStates 的实时状态（WS 通道保持最新），使 toggle 后按钮/开关即时联动。
  if (!detail.value) return []
  return (detail.value.entities || []).map(liveEntityOf)
})

const onDeviceCount = computed(() => devices.value.filter(deviceOnline).length)

function deviceMeta(d) {
  const parts = []
  if (d.device.manufacturer) parts.push(d.device.manufacturer)
  if (d.device.model) parts.push(d.device.model)
  if (!parts.length && d.domain) parts.push(domainLabel(d.domain))
  return parts.join(' · ') || '通用设备'
}

function roomIcon(room) {
  const n = room.name
  if (room.id === '__none__') return 'devices_other'
  if (n.includes('客厅')) return 'weekend'
  if (n.includes('卧')) return 'bed'
  if (n.includes('餐')) return 'dining'
  if (n.includes('厨')) return 'kitchen'
  if (n.includes('书')) return 'desk'
  if (n.includes('卫')) return 'bathroom'
  if (n.includes('庭院') || n.includes('阳台')) return 'balcony'
  return 'apartment'
}

// 配色（按主域）
function domainPal(d) {
  const map = {
    light: { box: 'bg-warning/15 border border-warning/30', color: 'text-warning', toggle: 'bg-warning' },
    climate: { box: 'bg-info/15 border border-info/30', color: 'text-info', toggle: 'bg-info' },
    media_player: { box: 'bg-accent/15 border border-accent/30', color: 'text-accent', toggle: 'bg-accent' },
    cover: { box: 'bg-warning/15 border border-warning/30', color: 'text-warning', toggle: 'bg-warning' },
    sensor: { box: 'bg-info/15 border border-info/30', color: 'text-info', toggle: 'bg-info' },
    switch: { box: 'bg-primary/15 border border-primary/30', color: 'text-primary', toggle: 'bg-primary' },
    lock: { box: 'bg-success/15 border border-success/30', color: 'text-success', toggle: 'bg-success' },
    camera: { box: 'bg-accent/15 border border-accent/30', color: 'text-accent', toggle: 'bg-accent' },
  }
  return map[d.domain] || { box: 'bg-accent/15 border border-accent/30', color: 'text-accent', toggle: 'bg-accent' }
}
function iconBox(d) { return domainPal(d).box }
function iconColor(d) { return domainPal(d).color }
function accentBorder(d) { return d.active_count > 0 ? 'border-primary/40' : 'border-border' }
function accentToggle(d) { return domainPal(d).toggle }
// 列表行样式：选中设备高亮（主色描边 + 浅底）
function roomDeviceCls(d) {
  const sel = detail.value && detail.value.device && detail.value.device.id === d.device.id
  const base = 'bg-surface-alt border'
  const border = sel ? 'border-primary ring-1 ring-primary/40' : accentBorder(d)
  return `${base} ${border}`
}

function sensorValue(e) {
  if (['sensor', 'binary_sensor', 'number'].includes(e.domain)) {
    const u = e.unit ? ` ${e.unit}` : ''
    return `${e.state}${u}`
  }
  return null
}
function stateText(e) { return `${e.state}${e.unit ? ' ' + e.unit : ''}` }

// 实体行的可用操作由能力模型推导（与「更多信息」面板同源）：
// 需要拿到实时 attributes（supported_features 等），故优先用实时实体、否则回退注册表快照。
function liveEntityOf(e) {
  const live = entityStates[e.entity_id]
  if (!live) return e
  return {
    ...e,
    state: live.state !== undefined ? live.state : e.state,
    attributes: { ...(e.attributes || {}), ...(live.attributes || {}) },
    domain: e.domain || live.domain,
  }
}
function controlsOf(e) {
  return buildControls(liveEntityOf(e))
}
function canToggle(e) {
  return controlsOf(e).some((c) => c.kind === 'toggle')
}
function hasMore(e) {
  return controlsOf(e).length > 0
}

// ---- 「更多信息」面板：按 entity_id 定位，实时 attributes 优先于注册表快照 ----
const moreEntityId = ref('')
function findRegistryEntity(id) {
  for (const g of devices.value) {
    const hit = (g.entities || []).find((e) => e.entity_id === id)
    if (hit) return hit
  }
  return (unassigned.value || []).find((e) => e.entity_id === id) || null
}
const moreEntity = computed(() => {
  const id = moreEntityId.value
  if (!id) return null
  const reg = findRegistryEntity(id)
  const live = entityStates[id]
  if (!reg && !live) return null
  const attrs = { ...(reg?.attributes || {}), ...(live?.attributes || {}) }
  return {
    entity_id: id,
    domain: reg?.domain || live?.domain || id.split('.')[0],
    friendly_name: attrs.friendly_name || reg?.friendly_name || id,
    icon: reg?.icon || '',
    unit: attrs.unit_of_measurement || reg?.unit || '',
    state: live?.state !== undefined ? live.state : (reg?.state ?? ''),
    attributes: attrs,
  }
})
function openMore(e) { moreEntityId.value = e.entity_id }

function openDetail(d) {
  detail.value = d
}

function openEntityQuick(e) {
  const stub = { device: {}, display_name: e.friendly_name || e.entity_id, domain: e.domain, area_name: '', active_count: isOn(e) ? 1 : 0, entity_count: 1, entities: [e] }
  detail.value = stub
}

function onToggleEntity(e) {
  // 乐观更新：直接写全局 entityStates 的实时字段，visibleEntities 经 liveEntityOf 合并后即时联动。
  // 若实体尚未被 WS 收录，就地补一条实时记录，否则乐观翻转会静默丢失（UI 不刷新）。
  const live = entityStates[e.entity_id]
  const prev = live ? live.state : e.state
  const optimistic = isOn(e) ? 'off' : 'on'
  if (live) live.state = optimistic
  else entityStates[e.entity_id] = { ...e, state: optimistic, domain: e.domain }
  // 强制触发 visibleEntities 重算：实体可能尚未被 WS 收录，新增 entityStates key 的依赖追踪
  // 不一定可靠，替换 detail 引用可保证 computed 即时读取到乐观状态。
  if (detail.value) detail.value = { ...detail.value }
  api.toggle(store.activeID, e.entity_id).catch(() => { if (live) live.state = prev; else entityStates[e.entity_id].state = prev })
}

// 加载注册表。重连/瞬时错误时自动重试（后端心跳会重建停滞的 HA 连接）。
async function load(attempt = 0) {
  if (!store.ready || store.activeID <= 0) return
  try {
    const { data } = await api.registryDevices(store.activeID)
    areas.value = data?.areas || []
    // 合并实时状态缓存（WS 增量保持 state 新鲜）
    devices.value = (data?.devices || []).map(mergeLive)
    unassigned.value = (data?.unassigned || []).map(mergeLive)
    loadedOnce.value = true
  } catch (e) {
    devices.value = []
    // 前两次失败：等后端重连完成后再试，避免首次加载因旧的停滞连接而落空。
    if (attempt < 2) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
      return load(attempt + 1)
    }
  }
}

// 用全局 entityStates 的实时状态覆盖设备下实体（WS 通道保持最新）。
function mergeLive(g) {
  if (!g || !Array.isArray(g.entities)) return g
  g.entities = g.entities.map((e) => {
    const live = entityStates[e.entity_id]
    if (live) {
      if (live.state !== undefined) e.state = live.state
      if (live.attributes && live.attributes.friendly_name && !e.friendly_name) e.friendly_name = live.attributes.friendly_name
    }
    return e
  })
  // 在线数由实体状态推导，状态被实时覆盖后必须重算，
  // 否则开关设备后「在线」会停留在上一次注册表快照的旧值。
  g.active_count = g.entities.filter((e) => !e.disabled && isOn(e)).length
  return g
}

let off = null
function onEsc(e) {
  if (e.key !== 'Escape') return
  // 先关「更多信息」面板，再关设备抽屉（层级从内向外）
  if (moreEntityId.value) moreEntityId.value = ''
  else detail.value = null
}
onMounted(async () => {
  window.addEventListener('keydown', onEsc)
  await refreshEntities(store.activeID)
  await load()
  // WS 实时更新：状态变化时刷新设备在线数与实体状态（保留结构）。
  off = onEntityChange(() => {
    devices.value = devices.value.map(mergeLive)
    unassigned.value = unassigned.value.map(mergeLive)
    if (detail.value) detail.value = mergeLive(JSON.parse(JSON.stringify(detail.value)))
  })
})
onUnmounted(() => { if (off) off(); window.removeEventListener('keydown', onEsc) })
</script>

<style scoped>
/* 独立滚动区隐藏滚动条（可见滚动条会占掉内容横向空间），滚动能力不变 */
.hc-hide-bar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.hc-hide-bar::-webkit-scrollbar {
  display: none;
}
</style>
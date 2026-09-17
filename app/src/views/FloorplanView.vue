<template>
  <div class="flex flex-col lg:flex-row border border-border rounded-2xl overflow-hidden min-h-[70vh]">

    <!-- Left: Floor Plan Area -->
    <section class="lg:w-3/5 flex flex-col border-r border-border relative bg-background/30">
      <!-- Floor Switcher -->
      <div class="flex items-center gap-2 px-4 pt-4 pb-2 flex-wrap">
        <span class="text-muted text-sm font-body mr-1">当前楼层：</span>
        <button
          v-for="(f, i) in floors"
          :key="i"
          @click="setFloor(i)"
          class="px-4 py-1.5 rounded-full border text-sm font-body font-medium transition-all duration-200"
          :class="floor === i ? 'border-border text-primary' : 'border-border text-muted hover:border-border hover:text-on-surface'"
        >{{ f.name }}</button>
        <div class="ml-auto flex items-center gap-2 hidden sm:flex">
          <span class="material-symbols-outlined text-muted text-lg">zoom_in</span>
          <span class="text-muted text-xs font-body">平面图模式</span>
        </div>
      </div>

      <!-- Floor Plan SVG Container -->
      <div class="flex-1 flex items-center justify-center p-5 overflow-auto">
        <div class="relative w-full max-w-xl">
          <svg viewBox="0 0 600 480" class="w-full h-auto">
            <defs>
              <linearGradient id="room-living" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#F5A623;stop-opacity:0.12"/>
                <stop offset="100%" style="stop-color:#F5A623;stop-opacity:0.06"/>
              </linearGradient>
              <linearGradient id="room-bedroom" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#5EC4B0;stop-opacity:0.10"/>
                <stop offset="100%" style="stop-color:#5EC4B0;stop-opacity:0.05"/>
              </linearGradient>
              <linearGradient id="room-kitchen" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#6BA3D9;stop-opacity:0.10"/>
                <stop offset="100%" style="stop-color:#6BA3D9;stop-opacity:0.05"/>
              </linearGradient>
              <linearGradient id="room-bath" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#E8A84C;stop-opacity:0.10"/>
                <stop offset="100%" style="stop-color:#E8A84C;stop-opacity:0.05"/>
              </linearGradient>
              <linearGradient id="room-attic" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#8A8986;stop-opacity:0.08"/>
                <stop offset="100%" style="stop-color:#8A8986;stop-opacity:0.04"/>
              </linearGradient>
            </defs>

            <!-- Floor 1 -->
            <g v-show="floor === 0">
              <rect x="30" y="30" width="540" height="420" rx="4" fill="none" stroke="#3E3F43" stroke-width="4"/>
              <rect x="30" y="30" width="300" height="260" rx="2" fill="url(#room-living)" stroke="#4E4F53" stroke-width="1.5" @click="selectRoom('起居室')"/>
              <rect x="60" y="280" width="120" height="35" rx="4" fill="#2A2B2F" stroke="#3E3F43"/><text x="70" y="302" font-size="10" fill="#8A8986">沙发</text>
              <rect x="200" y="30" width="120" height="20" rx="3" fill="#2A2B2F" stroke="#3E3F43"/><text x="210" y="44" font-size="9" fill="#8A8986">电视柜</text>
              <circle cx="150" cy="180" r="8" fill="#F5A623" opacity="0.7"/><circle cx="150" cy="180" r="4" fill="#F5A623"/>
              <circle cx="180" cy="120" r="10" fill="#F5A623" opacity="0.6"/><circle cx="180" cy="120" r="5" fill="#F5A623"/>
              <text x="150" y="200" text-anchor="middle" font-size="18" font-weight="600" fill="#F5A623">起居室</text>
              <text x="150" y="220" text-anchor="middle" font-size="11" fill="#8A8986">24°C · 湿度 45%</text>

              <rect x="330" y="30" width="240" height="180" rx="2" fill="url(#room-kitchen)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('厨房')"/>
              <rect x="350" y="50" width="80" height="40" rx="3" fill="#2A2B2F" stroke="#3E3F43"/><text x="358" y="74" font-size="9" fill="#8A8986">灶台</text>
              <rect x="440" y="50" width="60" height="40" rx="3" fill="#2A2B2F" stroke="#3E3F43"/><text x="448" y="74" font-size="9" fill="#8A8986">水槽</text>
              <circle cx="500" cy="140" r="7" fill="#F5A623" opacity="0.8"/><circle cx="500" cy="140" r="3.5" fill="#F5A623"/>
              <circle cx="420" cy="160" r="6" fill="#5EC4B0" opacity="0.6"/><circle cx="420" cy="160" r="3" fill="#5EC4B0"/>
              <text x="450" y="110" text-anchor="middle" font-size="18" font-weight="600" fill="#6BA3D9">厨房</text>
              <text x="450" y="130" text-anchor="middle" font-size="11" fill="#8A8986">燃气正常 · 智能插座 ON</text>

              <rect x="330" y="210" width="120" height="240" rx="2" fill="url(#room-bath)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('浴室')"/>
              <ellipse cx="390" cy="260" rx="30" ry="20" fill="#2A2B2F" stroke="#3E3F43"/><text x="390" y="264" text-anchor="middle" font-size="8" fill="#8A8986">浴缸</text>
              <circle cx="390" cy="380" r="7" fill="#F5A623" opacity="0.7"/><circle cx="390" cy="380" r="3.5" fill="#F5A623"/>
              <circle cx="350" cy="420" r="6" fill="#5EC4B0" opacity="0.5"/><circle cx="350" cy="420" r="3" fill="#5EC4B0"/>
              <text x="390" y="320" text-anchor="middle" font-size="16" font-weight="600" fill="#E8A84C">浴室</text>
              <text x="390" y="338" text-anchor="middle" font-size="10" fill="#8A8986">浴霸 OFF</text>
            </g>

            <!-- Floor 2 -->
            <g v-show="floor === 1">
              <rect x="30" y="30" width="540" height="420" rx="4" fill="none" stroke="#3E3F43" stroke-width="4"/>
              <rect x="30" y="30" width="270" height="260" rx="2" fill="url(#room-bedroom)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('主卧')"/>
              <rect x="50" y="50" width="100" height="70" rx="4" fill="#2A2B2F" stroke="#3E3F43"/><text x="60" y="90" font-size="10" fill="#8A8986">床</text>
              <circle cx="180" cy="100" r="7" fill="#F5A623" opacity="0.7"/><circle cx="180" cy="100" r="3.5" fill="#F5A623"/>
              <circle cx="220" cy="180" r="6" fill="#5EC4B0" opacity="0.6"/><circle cx="220" cy="180" r="3" fill="#5EC4B0"/>
              <circle cx="140" cy="200" r="5" fill="#6BA3D9" opacity="0.5"/><circle cx="140" cy="200" r="2.5" fill="#6BA3D9"/>
              <text x="165" y="160" text-anchor="middle" font-size="18" font-weight="600" fill="#5EC4B0">主卧</text>
              <text x="165" y="180" text-anchor="middle" font-size="11" fill="#8A8986">23°C · 窗帘半开</text>

              <rect x="300" y="30" width="270" height="260" rx="2" fill="url(#room-bedroom)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('次卧')"/>
              <rect x="320" y="50" width="80" height="60" rx="4" fill="#2A2B2F" stroke="#3E3F43"/><text x="330" y="85" font-size="10" fill="#8A8986">床</text>
              <circle cx="480" cy="120" r="7" fill="#F5A623" opacity="0.5"/><circle cx="480" cy="120" r="3.5" fill="#F5A623"/>
              <circle cx="420" cy="200" r="6" fill="#5EC4B0" opacity="0.4"/><circle cx="420" cy="200" r="3" fill="#5EC4B0"/>
              <text x="435" y="160" text-anchor="middle" font-size="18" font-weight="600" fill="#5EC4B0">次卧</text>
              <text x="435" y="180" text-anchor="middle" font-size="11" fill="#8A8986">22°C · 设备已关</text>

              <rect x="30" y="290" width="200" height="160" rx="2" fill="url(#room-kitchen)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('书房')"/>
              <rect x="50" y="310" width="90" height="40" rx="3" fill="#2A2B2F" stroke="#3E3F43"/><text x="60" y="334" font-size="9" fill="#8A8986">书桌</text>
              <circle cx="160" cy="350" r="6" fill="#F5A623" opacity="0.6"/><circle cx="160" cy="350" r="3" fill="#F5A623"/>
              <text x="130" y="380" text-anchor="middle" font-size="16" font-weight="600" fill="#6BA3D9">书房</text>
              <text x="130" y="398" text-anchor="middle" font-size="10" fill="#8A8986">阅读灯 ON</text>

              <rect x="230" y="290" width="160" height="160" rx="2" fill="url(#room-bath)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('卫浴')"/>
              <ellipse cx="310" cy="340" rx="35" ry="22" fill="#2A2B2F" stroke="#3E3F43"/><text x="310" y="344" text-anchor="middle" font-size="8" fill="#8A8986">洗手台</text>
              <circle cx="350" cy="400" r="6" fill="#F5A623" opacity="0.4"/><circle cx="350" cy="400" r="3" fill="#F5A623"/>
              <text x="310" y="420" text-anchor="middle" font-size="16" font-weight="600" fill="#E8A84C">卫浴</text>

              <rect x="390" y="290" width="180" height="160" rx="2" fill="url(#room-attic)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('走廊')"/>
              <circle cx="480" cy="370" r="6" fill="#F5A623" opacity="0.3"/><circle cx="480" cy="370" r="3" fill="#F5A623"/>
              <text x="480" y="390" text-anchor="middle" font-size="16" font-weight="600" fill="#8A8986">走廊</text>
            </g>

            <!-- Floor 3 -->
            <g v-show="floor === 2">
              <rect x="30" y="30" width="540" height="420" rx="4" fill="none" stroke="#3E3F43" stroke-width="4"/>
              <rect x="30" y="30" width="270" height="260" rx="2" fill="url(#room-attic)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('储物间')"/>
              <rect x="60" y="60" width="60" height="80" rx="3" fill="#2A2B2F" stroke="#3E3F43"/>
              <rect x="130" y="60" width="60" height="80" rx="3" fill="#2A2B2F" stroke="#3E3F43"/>
              <rect x="200" y="60" width="60" height="80" rx="3" fill="#2A2B2F" stroke="#3E3F43"/>
              <text x="165" y="180" text-anchor="middle" font-size="16" font-weight="600" fill="#8A8986">储物间</text>
              <text x="165" y="200" text-anchor="middle" font-size="11" fill="#5C5B58">无人状态</text>
              <circle cx="240" cy="260" r="5" fill="#5C5B58" opacity="0.4"/>
              <text x="240" y="272" text-anchor="middle" font-size="9" fill="#5C5B58">红外感应 OFF</text>

              <rect x="300" y="30" width="270" height="260" rx="2" fill="url(#room-attic)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('休闲区')"/>
              <rect x="330" y="60" width="100" height="50" rx="4" fill="#2A2B2F" stroke="#3E3F43"/><text x="340" y="90" font-size="9" fill="#8A8986">沙发</text>
              <circle cx="480" cy="130" r="6" fill="#F5A623" opacity="0.3"/><circle cx="480" cy="130" r="3" fill="#F5A623"/>
              <text x="435" y="200" text-anchor="middle" font-size="16" font-weight="600" fill="#8A8986">休闲区</text>
              <text x="435" y="220" text-anchor="middle" font-size="11" fill="#5C5B58">氛围灯 30%</text>

              <rect x="30" y="290" width="540" height="160" rx="2" fill="url(#room-attic)" stroke="#4E3F43" stroke-width="1.5" @click="selectRoom('露天阳台')"/>
              <text x="300" y="370" text-anchor="middle" font-size="16" font-weight="600" fill="#8A8986">露天阳台</text>
              <text x="300" y="390" text-anchor="middle" font-size="11" fill="#5C5B58">温度 18°C · 风速 2级</text>
              <circle cx="150" cy="360" r="5" fill="#5C5B58" opacity="0.3"/>
              <circle cx="450" cy="360" r="5" fill="#5C5B58" opacity="0.3"/>
            </g>

            <!-- Compass -->
            <g transform="translate(540, 440)">
              <circle r="20" fill="#1A1B1E" stroke="#3E3F43" stroke-width="1"/>
              <text y="-5" text-anchor="middle" font-size="10" font-weight="600" fill="#F5A623">N</text>
              <polygon points="0,-14 -4,-4 4,-4" fill="#F5A623"/>
              <polygon points="0,14 -4,-4 4,-4" fill="#5C5B58"/>
            </g>
          </svg>

          <!-- Room Info Overlay -->
          <div class="absolute bottom-4 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl">
            <span class="material-symbols-outlined text-primary">info</span>
            <div>
              <p class="text-on-surface text-sm font-headline font-semibold">{{ activeRoom }}</p>
              <p class="text-muted text-xs font-body">{{ roomDetail }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div class="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-border bg-background/50">
        <span class="text-muted text-xs font-body">设备状态：</span>
        <span class="flex items-center gap-1.5 text-muted text-xs font-body"><span class="w-2.5 h-2.5 rounded-full bg-primary"></span>开启</span>
        <span class="flex items-center gap-1.5 text-muted text-xs font-body"><span class="w-2.5 h-2.5 rounded-full bg-accent opacity-60"></span>待机</span>
        <span class="flex items-center gap-1.5 text-muted text-xs font-body"><span class="w-2.5 h-2.5 rounded-full bg-faint opacity-40"></span>关闭</span>
        <span class="ml-auto hidden sm:flex items-center gap-4 text-muted text-xs font-body">
          <span>接入 {{ all.length }} 实体</span><span>{{ onCount }} 台在线</span>
        </span>
      </div>
    </section>

    <!-- Right: Control Panel -->
    <section class="lg:w-2/5 flex flex-col overflow-hidden bg-background/20">
      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="font-headline text-2xl font-bold text-on-background">{{ panelTitle }}</h1>
            <p class="text-muted text-sm font-body mt-0.5">{{ panelSubtitle }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="p-2 rounded-lg hover:bg-surface-alt transition-colors"><span class="material-symbols-outlined text-muted">refresh</span></button>
            <button class="p-2 rounded-lg hover:bg-surface-alt transition-colors"><span class="material-symbols-outlined text-muted">more_vert</span></button>
          </div>
        </div>

        <div class="border-t border-border pt-4">
          <!-- 客厅区域 -->
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-1 h-5 rounded-full bg-primary"></div>
              <h2 class="font-headline text-base font-semibold text-on-surface">客厅区域</h2>
              <span class="ml-auto text-muted text-xs font-body bg-surface-alt px-2 py-0.5 rounded-full border border-border">{{ livingRoom.length }} 设备</span>
            </div>
            <template v-if="livingRoom.length">
              <ControlRow v-for="d in livingRoom" :key="d.id" :model-value="d.on" @update:model-value="onRowToggle(d, $event)" :device="d" />
            </template>
            <p v-else class="text-muted text-xs font-body">暂无设备</p>
          </div>

          <!-- 卧室区域 -->
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-1 h-5 rounded-full bg-accent"></div>
              <h2 class="font-headline text-base font-semibold text-on-surface">卧室区域</h2>
              <span class="ml-auto text-muted text-xs font-body bg-surface-alt px-2 py-0.5 rounded-full border border-border">{{ bedroom.length }} 设备</span>
            </div>
            <template v-if="bedroom.length">
              <ControlRow v-for="d in bedroom" :key="d.id" :model-value="d.on" @update:model-value="onRowToggle(d, $event)" :device="d" />
            </template>
            <p v-else class="text-muted text-xs font-body">暂无设备</p>
          </div>

          <!-- 厨房区域 -->
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-1 h-5 rounded-full bg-info"></div>
              <h2 class="font-headline text-base font-semibold text-on-surface">厨房区域</h2>
              <span class="ml-auto text-muted text-xs font-body bg-surface-alt px-2 py-0.5 rounded-full border border-border">{{ kitchen.length }} 设备</span>
            </div>
            <template v-if="kitchen.length">
              <ControlRow v-for="d in kitchen" :key="d.id" :model-value="d.on" @update:model-value="onRowToggle(d, $event)" :device="d" />
            </template>
            <p v-else class="text-muted text-xs font-body">暂无设备</p>
          </div>

          <!-- 浴室区域 -->
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-3">
              <div class="w-1 h-5 rounded-full bg-warning"></div>
              <h2 class="font-headline text-base font-semibold text-on-surface">浴室区域</h2>
              <span class="ml-auto text-muted text-xs font-body bg-surface-alt px-2 py-0.5 rounded-full border border-border">{{ bathroom.length }} 设备</span>
            </div>
            <template v-if="bathroom.length">
              <ControlRow v-for="d in bathroom" :key="d.id" :model-value="d.on" @update:model-value="onRowToggle(d, $event)" :device="d" />
            </template>
            <p v-else class="text-muted text-xs font-body">暂无设备</p>
          </div>
        </div>

        <!-- Energy Summary -->
        <div class="bg-surface-alt rounded-xl border border-border p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-on-surface text-sm font-medium font-body">当前功率</span>
            <span class="text-primary font-headline font-bold text-lg">{{ hasData ? totalPowerKW.toFixed(2) : '—' }} kW</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import ControlRow from '@/components/ControlRow.vue'
import api from '@/api'
import { store, backendOnline, entityStates, refreshEntities, onEntityChange } from '@/store'
import { iconFor, isOn, attr, numVal, powerOf, totalPower } from '@/utils/entities'

const floors = [{ name: '一层' }, { name: '二层' }, { name: '阁楼' }]
const floor = ref(0)
const activeRoom = ref('起居室')

const panelTitle = computed(() => `当前楼层 · ${floors[floor.value].name}`)
const panelSubtitle = computed(() => (hasData.value ? `接入 ${all.value.length} 实体 · ${onCount.value} 台在线` : '暂无数据'))

function setFloor(i) {
  floor.value = i
  activeRoom.value = ['起居室', '主卧', '储物间'][i]
}
function selectRoom(room) {
  activeRoom.value = room
}

// ---- 从后端实时实体生成控制面板（按 area 分组），无数据时显示空态 ----
const all = computed(() => Object.values(entityStates))
const hasData = computed(() => backendOnline.value && all.value.length > 0)
const onCount = computed(() => (hasData.value ? all.value.filter((e) => isOn(e)).length : 0))
const totalPowerKW = computed(() => totalPower(all.value) / 1000)

// 当前选中房间的实时概览（真实设备数与功耗）。
const roomDetail = computed(() => {
  if (!hasData.value) return '暂无数据'
  const target = (activeRoom.value || '').trim()
  if (!target) return '暂无数据'
  const list = all.value.filter((e) => {
    const a = (e.area || '').trim()
    return a === target || (target && a.includes(target)) || (a && target.includes(a))
  })
  if (!list.length) return '该区域暂无设备数据'
  const pw = list.reduce((s, e) => s + (powerOf(e) || 0), 0)
  return `共 ${list.length} 个设备 · 功耗 ${(pw / 1000).toFixed(2)} kW`
})

const ROOM = {
  living: ['客厅', '起居室', 'living'],
  bedroom: ['主卧', '次卧', '卧室', 'bedroom'],
  kitchen: ['厨房', 'kitchen'],
  bathroom: ['浴室', '卫浴', '卫生间', 'bathroom'],
}
function sectionFor(area) {
  const a = (area || '').trim()
  if (ROOM.living.includes(a)) return 'living'
  if (ROOM.bedroom.includes(a)) return 'bedroom'
  if (ROOM.kitchen.includes(a)) return 'kitchen'
  if (ROOM.bathroom.includes(a)) return 'bathroom'
  return 'living'
}
function glyph(e) {
  switch (e.domain) {
    case 'light': return 'lightbulb'
    case 'climate': return 'ac_unit'
    case 'cover': return 'curtains'
    case 'switch': case 'plug': return 'power'
    case 'fan': return 'mode_fan'
    default: return 'widgets'
  }
}
function rowFromEntity(e) {
  const on = isOn(e)
  const color = e.domain === 'light' ? 'text-primary' : e.domain === 'climate' ? 'text-info' : e.domain === 'cover' ? 'text-warning' : 'text-primary'
  const bg = (color === 'text-primary' ? 'bg-primary/20' : color === 'text-info' ? 'bg-info/20' : 'bg-warning/20') + ' border-primary/30'
  let value = 0
  let unit = '%'
  let altText = ''
  if (e.domain === 'climate') {
    value = numVal(attr(e, 'temperature')) || 0; unit = '°C'
  } else if (e.domain === 'switch' || e.domain === 'plug') {
    value = numVal(attr(e, 'power')) || 0; unit = 'W'
  } else if (e.domain === 'cover') {
    value = numVal(attr(e, 'current_position')) || (on ? 100 : 0); unit = '%'
  } else {
    value = numVal(attr(e, 'brightness')) || (on ? 100 : 0); unit = '%'
  }
  if (e.domain === 'sensor' || e.domain === 'binary_sensor') {
    value = 0; unit = ''; altText = e.state || '—'
  }
  return {
    id: e.entity_id, _entity: e.entity_id, name: e.friendly_name || e.entity_id,
    icon: iconFor(e, glyph(e)), color, bg, on, value, unit, altText,
  }
}
function buildSection(key) {
  return all.value
    .filter((e) => sectionFor(e.area) === key)
    .map(rowFromEntity)
}
const livingRoom = computed(() => buildSection('living'))
const bedroom = computed(() => buildSection('bedroom'))
const kitchen = computed(() => buildSection('kitchen'))
const bathroom = computed(() => buildSection('bathroom'))

// 开关代理到后端：乐观更新 + toggle。
async function onRowToggle(row, val) {
  if (!row || !row._entity) return
  const target = !!val
  row.on = target
  try { await api.toggle(store.activeID, row._entity) } catch { row.on = !target }
}

let off = null
onMounted(async () => {
  if (store.ready && store.activeID > 0) await refreshEntities(store.activeID)
  off = onEntityChange(() => {})
})
</script>
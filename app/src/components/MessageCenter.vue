<template>
  <Teleport to="body">
    <Transition name="im-fade">
      <div v-if="imOpen" class="fixed inset-0 z-[80]">
        <!-- 遮罩 -->
        <div class="absolute inset-0 bg-black/30 backdrop-blur-[2px]" @click="closeIm"></div>

        <!-- 抽屉 -->
        <div class="absolute inset-0 right-0 md:inset-y-0 md:max-w-4xl flex flex-col md:flex-row bg-surface shadow-2xl">
          <!-- 会话列表面板 -->
          <div :class="['w-full md:w-80 shrink-0 md:flex flex-col border-r border-border bg-surface-alt/60', listVisible ? 'flex' : 'hidden']">
            <div class="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 class="font-headline text-on-background font-semibold text-base">消息与共享</h2>
              <button @click="closeIm" title="关闭" class="w-8 h-8 rounded-full hover:bg-surface flex items-center justify-center text-muted hover:text-on-surface transition-colors">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <!-- 新建会话 / 共享目标 -->
            <div class="px-3 pt-2">
              <button @click="togglePicker"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium hover:bg-primary-hover transition-colors">
                <span class="material-symbols-outlined text-base">add_comment</span> 发起会话 / 共享
              </button>
              <div v-if="showPicker" class="mt-2 max-h-56 overflow-y-auto rounded-xl bg-background border border-border p-1">
                <button v-for="u in candidates" :key="u"
                  @click="startChat(u)"
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-hover text-sm text-on-surface transition-colors text-left">
                  <span class="material-symbols-outlined text-accent text-base">account_circle</span> {{ u }}
                </button>
                <p v-if="!candidates.length" class="px-3 py-2 text-xs text-muted font-body">没有可聊天的用户</p>
              </div>
            </div>

            <!-- 会话列表 -->
            <div class="flex-1 overflow-y-auto py-2">
              <button v-for="c in conversations" :key="c.user"
                @click="openConv(c.user)"
                class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover/70 transition-colors text-left border-b border-border/50"
                :class="activeUser === c.user ? 'bg-surface-hover/70' : ''">
                <span class="material-symbols-outlined text-accent text-xl shrink-0">account_circle</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <p class="text-on-surface text-sm font-medium truncate">{{ c.user }}</p>
                    <span v-if="c.pending && c.pending > 0" class="ml-2 px-1.5 py-0.5 rounded-full bg-error/15 text-error text-[10px] font-semibold shrink-0">共享{{ c.pending > 9 ? '9+' : c.pending }}</span>
                  </div>
                  <p class="text-muted text-xs truncate font-body">{{ lastPreview(c) }}</p>
                </div>
                <div class="flex flex-col items-end gap-0.5 shrink-0">
                  <span class="text-muted text-[10px] font-body">{{ fmtTime(c.last.created_at) }}</span>
                  <span v-if="c.unread > 0" class="w-5 h-5 rounded-full bg-error text-background text-[10px] font-bold flex items-center justify-center">{{ c.unread > 9 ? '9+' : c.unread }}</span>
                </div>
              </button>
              <p v-if="!conversations.length" class="px-4 py-6 text-muted text-xs text-center font-body">暂无会话</p>
            </div>
          </div>

          <!-- 消息线程 -->
          <div :class="['flex-1 md:flex flex-col min-w-0', threadVisible ? 'flex' : 'hidden']">
            <template v-if="activeUser">
              <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
                <button @click="backToList" title="返回会话列表" class="md:hidden w-9 h-9 rounded-full -ml-1 hover:bg-surface-hover flex items-center justify-center text-muted hover:text-on-surface transition-colors shrink-0">
                  <span class="material-symbols-outlined">arrow_back</span>
                </button>
                <span class="material-symbols-outlined text-accent text-lg">account_circle</span>
                <h3 class="text-on-background font-semibold text-sm">{{ activeUser }}</h3>
                <span class="hidden sm:inline ml-auto text-muted text-xs font-body">可发文本 / 表情 / 图片 / 共享仪表盘 / 设备控制</span>
              </div>

              <div ref="listEl" class="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-background/40">
                <!-- 向上加载更早消息（游标分页） -->
                <div v-if="hasMore" class="text-center pb-1">
                  <button @click="loadOlder" :disabled="loadingOlder"
                    class="px-3 py-1 rounded-full border border-border text-muted hover:text-primary hover:border-primary/40 text-xs transition-colors disabled:opacity-60">
                    {{ loadingOlder ? '加载中…' : '加载更早消息' }}
                  </button>
                </div>
                <template v-for="m in messages" :key="m.id">
                  <!-- 撤回占位 -->
                  <div v-if="m.status === 'recalled'" class="flex" :class="m.from === auth.user ? 'justify-end' : 'justify-start'">
                    <p class="px-3 py-1 rounded-full bg-surface-alt border border-border text-muted text-xs italic font-body">
                      {{ m.from === auth.user ? '你撤回了一条消息' : `${m.from} 撤回了一条消息` }}
                    </p>
                  </div>
                  <div v-else class="flex group" :class="m.from === auth.user ? 'justify-end' : 'justify-start'">
                  <!-- 共享卡片 -->
                  <div v-if="m.type === 'share'" class="max-w-[85%] sm:max-w-[300px] w-full">
                    <div class="rounded-xl border border-border bg-surface-alt p-3 shadow-sm">
                      <p class="text-on-surface text-sm font-semibold flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-primary text-base">dashboard</span> 仪表盘共享
                      </p>
                      <p class="mt-1 text-muted text-xs font-body">{{ shareStatus(m) }}</p>
                      <div v-if="showActions(m)" class="mt-2 flex gap-2">
                        <button @click="doAccept(m)" class="flex-1 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">接受</button>
                        <button @click="doDecline(m)" class="flex-1 py-1.5 rounded-lg border border-border text-muted hover:text-error hover:border-error/40 text-xs transition-colors">拒绝</button>
                      </div>
                      <p v-if="m.status && !showActions(m)" class="mt-1.5 text-xs font-body" :class="m.status === 'accepted' ? 'text-success' : m.status === 'declined' ? 'text-muted' : 'text-accent'">
                        {{ m.status === 'accepted' ? '已接受' : m.status === 'declined' ? '已拒绝' : '待处理' }}
                      </p>
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body">{{ fmtTime(m.created_at) }}</p>
                  </div>

                  <!-- 设备卡片 -->
                  <div v-else-if="m.type === 'device'" class="max-w-[85%] sm:max-w-[300px] w-full">
                    <div class="rounded-xl border border-border bg-surface-alt p-3 shadow-sm"
                      :class="deviceAvailable(m) ? 'border-primary/30' : ''">
                      <div class="flex items-start gap-3">
                        <div class="w-10 h-10 rounded-xl bg-surface flex items-center justify-center border border-border shrink-0"
                          :class="{ 'bg-primary/15 border-primary/30': deviceAvailable(m) }">
                          <span class="material-symbols-outlined text-lg text-muted"
                            :class="{ 'text-primary': deviceAvailable(m), 'text-success': deviceBusyState(m) === 'on' }">
                            {{ deviceIcon(m) }}
                          </span>
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="text-on-surface text-sm font-semibold truncate">{{ deviceName(m) }}</p>
                          <p class="text-muted text-[11px] font-body truncate">{{ deviceEntityID(m) }}</p>
                          <p class="mt-1 text-xs font-body" :class="deviceStateTone(m)">{{ deviceStateText(m) }}</p>
                        </div>
                      </div>
                      <div class="mt-2.5 flex items-center gap-2">
                        <button v-if="deviceAvailable(m) && deviceTogglable(m)"
                          @click="deviceToggle(m)"
                          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          :class="deviceBusyState(m) === 'on'
                            ? 'bg-primary/15 text-on-primary hover:bg-primary/25'
                            : 'bg-primary hover:bg-primary-hover text-on-primary'">
                          <span class="material-symbols-outlined text-sm">{{ deviceBusyState(m) === 'on' ? 'toggle_on' : 'toggle_off' }}</span>
                          {{ deviceBusyState(m) === 'on' ? '已开启 · 点按关闭' : '关闭 · 点按开启' }}
                        </button>
                        <span v-else class="flex-1 text-center text-[11px] text-muted font-body py-1.5">匹配不到该设备</span>
                        <span v-if="debrief" class="text-success inline-flex items-center gap-0.5 text-[10px] font-body"><span class="material-symbols-outlined text-xs">done</span></span>
                      </div>
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body">{{ fmtTime(m.created_at) }}</p>
                  </div>

                  <!-- 图片消息 -->
                  <div v-else-if="m.type === 'image'" class="max-w-[85%] sm:max-w-[300px]">
                    <img :src="m.image?.url" :alt="m.image?.name || '图片'" loading="lazy"
                      @click="lightbox = m.image?.url || ''"
                      class="block max-h-64 w-auto rounded-2xl cursor-zoom-in border border-border shadow-sm bg-surface-alt"
                      :class="m.from === auth.user ? 'rounded-br-sm' : 'rounded-bl-sm'">
                    <p class="mt-1 px-1 text-muted text-[10px] font-body flex items-center gap-1" :class="m.from === auth.user ? 'justify-end' : ''">
                      {{ fmtTime(m.created_at) }}
                      <span v-if="m.from === auth.user" :class="m.read ? 'text-primary' : ''">{{ m.read ? '· 已读' : '· 已送达' }}</span>
                    </p>
                  </div>

                  <!-- 文本气泡（含表情） -->
                  <div v-else class="max-w-[85%]">
                    <div class="px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words"
                      :class="m.from === auth.user ? 'bg-primary text-on-primary rounded-br-sm' : 'bg-surface-alt border border-border text-on-surface rounded-bl-sm'">
                      {{ m.content }}
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body flex items-center gap-1" :class="m.from === auth.user ? 'justify-end' : ''">
                      {{ fmtTime(m.created_at) }}
                      <span v-if="m.from === auth.user" :class="m.read ? 'text-primary' : ''">{{ m.read ? '· 已读' : '· 已送达' }}</span>
                    </p>
                  </div>

                  <!-- 撤回按钮（自己的文本/图片消息，悬停行内显示） -->
                  <button v-if="m.from === auth.user && (m.type === 'text' || m.type === 'image')" @click="doRecall(m)" title="撤回"
                    class="self-center w-7 h-7 rounded-full text-muted hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shrink-0">
                    <span class="material-symbols-outlined text-sm">undo</span>
                  </button>
                  </div>
                </template>
                <p v-if="!messages.length" class="text-muted text-center text-xs py-8 font-body">没有消息，打个招呼吧</p>
              </div>

              <!-- 输入区 -->
              <div class="border-t border-border px-4 py-3 bg-surface">
                <!-- 表情面板 -->
                <Transition name="im-pop">
                  <div v-if="showEmoji" class="mb-2 rounded-xl border border-border bg-background p-2 shadow-lg max-h-44 overflow-y-auto">
                    <div class="flex items-center gap-1 mb-1.5">
                      <span class="text-[10px] uppercase tracking-wide text-muted font-semibold font-body flex-1">表情</span>
                      <span class="material-symbols-outlined text-sm text-muted">emoticons</span>
                    </div>
                    <div class="grid grid-cols-6 sm:grid-cols-8 gap-1">
                      <button v-for="e in emojis" :key="e" @click="insertEmoji(e)"
                        class="w-9 h-9 sm:w-8 sm:h-8 rounded-lg hover:bg-surface-hover text-xl leading-none transition-colors flex items-center justify-center">{{ e }}</button>
                    </div>
                  </div>
                </Transition>
                <!-- 设备选择面板 -->
                <Transition name="im-pop">
                  <div v-if="showDevicePicker" class="mb-2 rounded-xl border border-border bg-background p-2 shadow-lg max-h-52 overflow-y-auto">
                    <div class="flex items-center gap-2 mb-1.5 px-1">
                      <span class="text-[10px] uppercase tracking-wide text-muted font-semibold font-body flex-1">发送设备（当前实例实体，对方按 entity_id 匹配后可直接控制）</span>
                      <button @click="reloadDevices" class="text-muted hover:text-primary transition-colors"><span class="material-symbols-outlined text-sm">refresh</span></button>
                    </div>
                    <p v-if="!deviceCandidates.length" class="px-2 py-3 text-center text-muted text-xs font-body">暂无实体，或尚未配置 HA token</p>
                    <div v-for="d in deviceCandidates" :key="d.entity_id" class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer" @click="sendDeviceCard(d)">
                      <span class="material-symbols-outlined text-base text-accent shrink-0">{{ domainIcon(d.domain) }}</span>
                      <span class="text-sm text-on-surface truncate flex-1">{{ d.friendly_name || d.entity_id }}</span>
                      <span class="text-muted text-[10px] font-body shrink-0">{{ d.domain }}</span>
                    </div>
                  </div>
                </Transition>

                <div class="flex gap-2">
                  <button @click="showEmoji = !showEmoji; showDevicePicker = false" :disabled="busy" title="表情"
                    class="px-2.5 py-2 rounded-xl border border-border text-muted hover:text-primary hover:border-primary/40 transition-colors"
                    :class="showEmoji ? 'text-primary border-primary/40' : ''">
                    <span class="material-symbols-outlined text-base">mood</span>
                  </button>
                  <button @click="pickImage" :disabled="busy" title="发送图片"
                    class="px-2.5 py-2 rounded-xl border border-border text-muted hover:text-primary hover:border-primary/40 transition-colors">
                    <span class="material-symbols-outlined text-base">image</span>
                  </button>
                  <input ref="imgInput" type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" @change="onPickImage">
                  <button @click="openDevicePicker" :disabled="busy" title="发送设备（可控制）"
                    class="px-2.5 py-2 rounded-xl border border-border text-muted hover:text-primary hover:border-primary/40 transition-colors"
                    :class="showDevicePicker ? 'text-primary border-primary/40' : ''">
                    <span class="material-symbols-outlined text-base">devices_other</span>
                  </button>
                  <button @click="share" :disabled="busy" title="把当前仪表盘共享给对方"
                    class="px-3 py-2 rounded-xl border border-border text-muted hover:text-primary hover:border-primary/40 text-sm transition-colors">
                    <span class="material-symbols-outlined text-base">share</span>
                  </button>
                  <input v-model="compose" @keyup.enter="send" placeholder="输入消息…"
                    :disabled="busy"
                    class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
                  <button @click="send" :disabled="busy || !compose.trim()"
                    class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all disabled:opacity-60">发送</button>
                </div>
                <p v-if="tip" class="mt-1.5 text-xs font-body" :class="tipErr ? 'text-error' : 'text-success'">{{ tip }}</p>
              </div>
            </template>

            <div v-else :class="['flex-1 flex flex-col items-center justify-center text-muted', listVisible ? 'hidden md:flex' : 'flex']">
              <span class="material-symbols-outlined text-5xl mb-3 opacity-40">forum</span>
              <p class="text-sm font-body">选择一个会话，或发起共享</p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 图片灯箱预览 -->
    <Transition name="im-fade">
      <div v-if="lightbox" class="fixed inset-0 z-[90] bg-black/85 flex items-center justify-center p-6 sm:p-10 cursor-zoom-out" @click="lightbox = ''">
        <img :src="lightbox" alt="预览" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl">
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import api from '@/api'
import { auth, imOpen, imRefresher, imConversations, closeIm, bumpIm, store, entityStates, requestEntityRefresh } from '@/store'
import { dashboardCardCount } from '@/utils/dashboard'
import { getPrefs } from '@/utils/prefs'

const conversations = imConversations
const activeUser = ref('')
const messages = ref([])
const compose = ref('')
const busy = ref(false)
const showPicker = ref(false)
const tip = ref('')
const tipErr = ref(false)
const listEl = ref(null)
const showEmoji = ref(false)
const showDevicePicker = ref(false)
const deviceCandidates = ref([])
const debrief = ref('')
// 图片消息 / 分页 / 撤回
const imgInput = ref(null)
const lightbox = ref('')
const hasMore = ref(false)
const loadingOlder = ref(false)
const PAGE = 50

// 移动端视口检测：<768px 视为手机，列表与消息线程互斥切换。
const isMobile = ref(false)
function syncViewport() {
  isMobile.value = window.matchMedia('(max-width: 767px)').matches
}
// 会话列表可见：桌面恒显；手机端仅在未进入会话时显示。
const listVisible = computed(() => !isMobile.value || !activeUser.value)
// 消息线程可见：进入会话后显示（手机端全屏覆盖列表，桌面端并排显示）。
const threadVisible = computed(() => !!activeUser.value)

function backToList() { activeUser.value = '' }
let debriefTimer = null

const emojis = [
  '😀','😁','😂','🤣','😊','😍','😘','😋',
  '😎','🤔','😴','🤗','🤩','😇','🙂','🥳',
  '😅','😭','😤','😡','🥺','😳','🤯','😱',
  '👍','👎','👏','🙌','🤝','💪','👌','✌️',
  '❤️','🔥','⭐','🎉','🎊','✨','💯','🌹',
  '❓','❗','✅','❌','🚀','🌙','☕','🍀',
]

const DOMAIN_ICONS = {
  light: 'lightbulb', switch: 'toggle_on', fan: 'mode_fan_off', cover: 'blinds',
  climate: 'thermostat', media_player: 'speaker_group', sensor: 'sensors',
  binary_sensor: 'sensors_off', lock: 'lock', camera: 'videocam', vacuum: 'cleaning_services',
  button: 'radio_button_checked', script: 'play_circle', scene: 'image', automation: 'bolt',
  number: 'tune', select: 'arrow_drop_down_circle', event: 'date_range', person: 'person',
}
function domainIcon(domain) { return DOMAIN_ICONS[domain] || 'devices_other' }

let tipTimer = null
function toast(msg, err = false) {
  tip.value = msg; tipErr.value = err
  if (tipTimer) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 5000)
}
function flash(marker) {
  debrief.value = marker
  if (debriefTimer) clearTimeout(debriefTimer)
  debriefTimer = setTimeout(() => (debrief.value = ''), 1800)
}

// 可选聊天对象：全部用户（去掉自己）。
const candidates = ref([])
async function loadCandidates() {
  try {
    const { data } = await api.listContacts()
    const list = Array.isArray(data) ? data : []
    candidates.value = list.filter((u) => u !== auth.user)
  } catch { candidates.value = [] }
}

// 展开选择器时重新拉取用户列表，保证刚新增的用户即时可选，无需刷新页面。
async function togglePicker() {
  showPicker.value = !showPicker.value
  if (showPicker.value) await loadCandidates()
}

function fmtTime(s) {
  if (!s) return ''
  const m = String(s).match(/(\d{2}):(\d{2})$/)
  return m ? `${m[1]}:${m[2]}` : String(s).slice(5, 16)
}

function lastPreview(c) {
  if (c.last?.status === 'recalled') return '消息已撤回'
  if (c.last?.type === 'share') return `🖥 ${c.card_count || '?'} 张卡片的仪表盘 · ${shareLabel(c.last.status)}`
  if (c.last?.type === 'device') {
    const name = c.last.device?.name || c.last.device?.entity_id || '设备'
    return `📟 ${name}`
  }
  if (c.last?.type === 'image') return '🖼 图片'
  return c.last?.content || '新消息'
}

function shareLabel(st) {
  return st === 'accepted' ? '已接受' : st === 'declined' ? '已拒绝' : '待处理'
}
function shareStatus(m) {
  if (m.from === auth.user) return `已发送给 ${m.to}（${shareLabel(m.status)}），共一次快照`
  return `${m.from} 分享了一份仪表盘，接受后会覆盖你的仪表盘`
}
function showActions(m) {
  return m.type === 'share' && m.status === 'pending' && m.from !== auth.user
}

// ===== 设备卡片 =====
function deviceMeta(m) {
  const d = m.device || {}
  const eid = d.entity_id || ''
  return { name: d.name || d.friendlyName || (eid.split('.')[1] || ''), entity_id: eid, domain: d.domain || (eid.split('.')[0] || ''), device_class: d.device_class || '', icon: d.icon || '' }
}
function deviceName(m) { return deviceMeta(m).name || '设备' }
function deviceEntityID(m) { return deviceMeta(m).entity_id }
function deviceAvailable(m) { return !!entityStates[deviceEntityID(m)] }
function deviceState(m) { return entityStates[deviceEntityID(m)] || null }
function deviceBusyState(m) { return deviceState(m)?.state }
function deviceTogglable(m) {
  const dom = deviceMeta(m).domain
  return ['light', 'switch', 'fan', 'cover', 'media_player', 'lock', 'vacuum', 'climate', 'automation', 'script'].includes(dom)
}
function deviceIcon(m) {
  const meta = deviceMeta(m)
  return meta.icon === '' ? domainIcon(meta.domain) : domainIcon(meta.domain)
}
function deviceStateText(m) {
  const st = deviceState(m)
  if (!st) return '尚未匹配到该设备在你实例中的实体'
  const s = st.state
  const on = ['on', 'open', 'playing', 'unlocked'].includes(s)
  if (s === 'on' || s === 'open' || s === 'playing' || s === 'unlocked') return '● 开启中'
  if (s === 'off' || s === 'closed' || s === 'locked') return '○ 已关闭'
  if (st.unit_of_measurement != null || st.unit) return `${s}${st.unit_of_measurement || st.unit || ''}`
  return String(s).charAt(0).toUpperCase() + String(s).slice(1)
}
function deviceStateTone(m) {
  const s = deviceState(m)?.state
  if (['on', 'open', 'playing', 'unlocked'].includes(s)) return 'text-success'
  if (s === 'off' || s === 'closed' || s === 'locked') return 'text-muted'
  return 'text-on-surface'
}
async function deviceToggle(m) {
  if (busy.value) return
  const eid = deviceEntityID(m)
  if (!store.activeID || !eid) return
  busy.value = true
  try {
    await api.toggle(store.activeID, eid)
    requestEntityRefresh(250)
    flash('done')
  } catch (e) { toast(e.message || '控制失败', true) }
  finally { busy.value = false }
}

// ===== 设备选择 =====
async function openDevicePicker() {
  showDevicePicker.value = !showDevicePicker.value
  showEmoji.value = false
  if (showDevicePicker.value && !deviceCandidates.value.length) await reloadDevices()
}
async function reloadDevices() {
  deviceCandidates.value = []
  if (!store.ready) return
  try {
    const { data } = await api.entities({ instance: store.activeID })
    deviceCandidates.value = Array.isArray(data)
      ? data.filter((e) => e.entity_id && ['light','switch','fan','cover','media_player','lock','vacuum','climate','automation','script'].includes(String(e.entity_id).split('.')[0]))
      : []
  } catch { deviceCandidates.value = [] }
}
async function sendDeviceCard(d) {
  if (busy.value || !activeUser.value) return
  busy.value = true
  try {
    const eid = d.entity_id
    const device = {
      entity_id: eid,
      name: d.friendly_name || (eid.split('.')[1] || eid),
      domain: eid.split('.')[0] || '',
      device_class: d.device_class || '',
      icon: d.icon || '',
    }
    await api.sendDevice(activeUser.value, device)
    showDevicePicker.value = false
    await loadMessages(activeUser.value)
    bumpIm()
    flash('done')
  } catch (e) { toast(e.message || '发送失败', true) }
  finally { busy.value = false }
}

// 表情
function insertEmoji(e) {
  compose.value += e
  showEmoji.value = false
}

async function loadMessages(user) {
  if (!user) return messages.value = []
  try {
    const { data } = await api.getMessages(user, PAGE)
    const list = Array.isArray(data) ? data : []
    messages.value = list
    hasMore.value = list.length >= PAGE
    scrollBottom()
  } catch { messages.value = [] }
}

// 向上加载更早消息：以当前最旧一条的 id 为游标；prepend 后保持视口停在原消息处
async function loadOlder() {
  if (loadingOlder.value || !activeUser.value || !messages.value.length) return
  loadingOlder.value = true
  const el = listEl.value
  const prevTop = el ? el.scrollTop : 0
  const prevHeight = el ? el.scrollHeight : 0
  try {
    const { data } = await api.getMessages(activeUser.value, PAGE, messages.value[0]?.id || 0)
    const older = Array.isArray(data) ? data : []
    if (older.length) messages.value = [...older, ...messages.value]
    hasMore.value = older.length >= PAGE
    requestAnimationFrame(() => {
      if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight - prevHeight + prevTop
    })
  } catch (e) { toast(e.message || '加载失败', true) }
  finally { loadingOlder.value = false }
}

// 图片发送：本地预校验大小 → FormData 上传 → 刷新线程
function pickImage() { imgInput.value?.click() }
async function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !activeUser.value) return
  if (file.size > 8 * 1024 * 1024) { toast('图片不能超过 8MB', true); return }
  const form = new FormData()
  form.append('file', file)
  busy.value = true
  try {
    await api.sendImage(activeUser.value, form)
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (err2) { toast(err2.message || '图片发送失败', true) }
  finally { busy.value = false }
}

// 撤回自己的文本/图片消息
async function doRecall(m) {
  if (busy.value) return
  busy.value = true
  try {
    await api.recallMessage(m.id)
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (e) { toast(e.message || '撤回失败', true) }
  finally { busy.value = false }
}

function scrollBottom() {
  requestAnimationFrame(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function openConv(user) {
  activeUser.value = user
  showPicker.value = false
  await loadMessages(user)
  try { await api.markMessageRead(user) } catch {}
  bumpIm()
}
function startChat(user) {
  openConv(user)
}

async function send() {
  const t = compose.value.trim()
  if (!t || !activeUser.value || busy.value) return
  busy.value = true
  try {
    await api.sendMessage(activeUser.value, t)
    compose.value = ''
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (e) { toast(e.message || '发送失败', true) }
  finally { busy.value = false }
}

async function share() {
  if (!activeUser.value || busy.value) return
  busy.value = true
  try {
    const { data } = await getPrefs()
    if (!data?.dashboard || dashboardCardCount(data.dashboard) === 0) {
      toast('当前仪表盘为空，请先在首页编辑并保存', true)
      return
    }
    await api.sendShare(activeUser.value, data.dashboard)
    await loadMessages(activeUser.value)
    bumpIm()
    toast('仪表盘已共享给对方')
  } catch (e) { toast(e.message || '共享失败', true) }
  finally { busy.value = false }
}

async function doAccept(m) {
  busy.value = true
  try {
    await api.acceptShare(m.id)
    await loadMessages(activeUser.value)
    bumpIm()
    toast('已接受，回到首页即为新的仪表盘')
  } catch (e) { toast(e.message || '接受失败', true) }
  finally { busy.value = false }
}
async function doDecline(m) {
  busy.value = true
  try {
    await api.declineShare(m.id)
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (e) { toast(e.message || '操作失败', true) }
  finally { busy.value = false }
}

// 外部刷新信号：重拉会话，若在线程中则同步刷新消息。
watch(imRefresher, async () => {
  if (!imOpen.value) return
  if (activeUser.value) await loadMessages(activeUser.value)
})

// 打开抽屉时重拉可选用户（用户可能在别处新增过），关闭时收起选择器。
watch(imOpen, async (open) => {
  if (!open) { showPicker.value = false; return }
  await loadCandidates()
})

onMounted(async () => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
  await loadCandidates()
  bumpIm()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
  if (tipTimer) clearTimeout(tipTimer)
  if (debriefTimer) clearTimeout(debriefTimer)
})
</script>

<style>
.im-fade-enter-active, .im-fade-leave-active { transition: opacity .2s ease; }
.im-fade-enter-from, .im-fade-leave-to { opacity: 0; }
.im-pop-enter-active { transition: opacity .15s ease, transform .15s ease; }
.im-pop-leave-active { transition: opacity .12s ease, transform .12s ease; }
.im-pop-enter-from, .im-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
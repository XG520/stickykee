<template>
  <!-- 通话覆盖层：全屏沉浸（微信式深色通话界面） -->
  <Teleport to="body">
    <Transition name="co-fade">
      <div v-if="callState.incoming || callState.active"
        class="fixed inset-0 z-[95] flex flex-col text-white select-none overflow-hidden">
        <!-- 背景：深色渐变 + 主题色光晕 -->
        <div class="absolute inset-0 bg-gradient-to-b from-[#22313f] via-[#161f29] to-[#0b1118]"></div>
        <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[30rem] h-[30rem] rounded-full bg-primary/15 blur-3xl"></div>

        <!-- 错误提示 -->
        <p v-if="callState.error" class="relative z-10 mx-auto mt-6 px-4 py-2 rounded-full bg-black/50 text-xs text-red-200">
          {{ callState.error }}
        </p>

        <!-- ========== 来电 ========== -->
        <template v-if="callState.incoming">
          <div class="relative z-10 flex-1 flex flex-col items-center justify-center px-8">
            <div class="co-avatar co-ring w-24 h-24 rounded-full bg-white/10 border border-white/15 flex items-center justify-center mb-5">
              <span class="material-symbols-outlined text-5xl text-white/80">call</span>
            </div>
            <h2 class="text-2xl font-semibold tracking-wide">{{ callState.incoming.from }}</h2>
            <p class="mt-2 text-sm text-white/60 font-body">邀请你语音通话…</p>
          </div>
          <div class="relative z-10 flex items-center justify-around pb-14 pt-6">
            <div class="flex flex-col items-center gap-2">
              <button @click="rejectCall" title="拒绝"
                class="co-btn w-16 h-16 rounded-full bg-[#e04b3f] hover:bg-[#f05a4d] flex items-center justify-center shadow-lg shadow-red-900/40 active:scale-95 transition-transform">
                <span class="material-symbols-outlined text-3xl">call_end</span>
              </button>
              <span class="text-xs text-white/70 font-body">拒绝</span>
            </div>
            <div class="flex flex-col items-center gap-2">
              <button @click="acceptCall" title="接听"
                class="co-btn w-16 h-16 rounded-full bg-[#34c759] hover:bg-[#43d66a] flex items-center justify-center shadow-lg shadow-green-900/40 active:scale-95 transition-transform animate-co-pulse">
                <span class="material-symbols-outlined text-3xl">call</span>
              </button>
              <span class="text-xs text-white/70 font-body">接听</span>
            </div>
          </div>
        </template>

        <!-- ========== 通话中 ========== -->
        <template v-else-if="callState.active">
          <div class="relative z-10 pt-10 text-center">
            <p class="text-sm text-white/60 font-body">{{ callState.active.owner === auth.user ? '你发起的通话' : '语音通话' }}</p>
            <p class="mt-1 text-lg font-semibold tabular-nums">{{ elapsed }}</p>
            <!-- 等待接听提示：除自己外无人建立连接 -->
            <p v-if="waiting" class="mt-1 text-xs text-white/45 font-body animate-pulse">等待对方接听…</p>
          </div>

          <!-- 参与者网格 -->
          <div class="relative z-10 flex-1 overflow-y-auto px-6 py-6">
            <div class="flex flex-wrap items-start justify-center gap-5">
              <div v-for="u in participants" :key="u.name" class="flex flex-col items-center gap-1.5 w-20">
                <div class="relative">
                  <div class="w-16 h-16 rounded-full flex items-center justify-center border transition-all duration-300"
                    :class="u.connected
                      ? 'bg-primary/25 border-primary/50 shadow-lg shadow-primary/20'
                      : 'bg-white/8 border-white/12'">
                    <span class="material-symbols-outlined text-3xl"
                      :class="u.connected ? 'text-white' : 'text-white/45'">account_circle</span>
                  </div>
                </div>
                <p class="text-xs truncate max-w-full" :class="u.connected ? 'text-white' : 'text-white/45'">{{ u.name }}</p>
                <p class="text-[10px] text-white/40 font-body">{{ u.me ? (callState.micMuted ? '已静音' : '我') : (u.connected ? '已连接' : '等待接听') }}</p>
              </div>
            </div>
          </div>

          <!-- 控制条 -->
          <div class="relative z-10 flex items-center justify-center gap-10 pb-12 pt-4">
            <div class="flex flex-col items-center gap-2">
              <button @click="toggleMute" title="静音"
                class="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95"
                :class="callState.micMuted
                  ? 'bg-white text-[#16202b]'
                  : 'bg-white/15 text-white hover:bg-white/25 border border-white/15'">
                <span class="material-symbols-outlined text-2xl">{{ callState.micMuted ? 'mic_off' : 'mic' }}</span>
              </button>
              <span class="text-[11px] text-white/60 font-body">{{ callState.micMuted ? '取消静音' : '静音' }}</span>
            </div>
            <div class="flex flex-col items-center gap-2">
              <button @click="hangup" title="挂断"
                class="w-16 h-16 rounded-full bg-[#e04b3f] hover:bg-[#f05a4d] flex items-center justify-center shadow-lg shadow-red-900/50 active:scale-95 transition-transform">
                <span class="material-symbols-outlined text-3xl">call_end</span>
              </button>
              <span class="text-[11px] text-white/60 font-body">挂断</span>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <!-- 通话结束提示：独立浮层，短暂展示后由 call.js 自动清空 -->
    <Transition name="co-fade">
      <div v-if="callState.ended && !callState.incoming && !callState.active"
        class="fixed inset-x-0 bottom-24 z-[96] flex justify-center pointer-events-none">
        <p class="px-5 py-2.5 rounded-full bg-black/70 text-white text-sm shadow-lg backdrop-blur">
          {{ endText }}
        </p>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { auth } from '@/store'
import {
  callState, acceptCall, rejectCall, hangup, toggleMute, END_TEXT,
} from '@/utils/call'

let timer = null
const elapsed = ref('00:00')

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

watch(() => callState.active, (a) => {
  if (timer) { clearInterval(timer); timer = null }
  if (!a) return
  let s = 0
  elapsed.value = '00:00'
  timer = setInterval(() => { s += 1; elapsed.value = fmt(s) }, 1000)
}, { immediate: true })

onBeforeUnmount(() => { if (timer) clearInterval(timer) })

// 结束原因 → 文案
const endText = computed(() => END_TEXT[callState.ended?.reason] || '通话已结束')

// 媒体走 WS 中继：voiceReady=true 即本端语音管线就绪、房间成员经服务器互通，无逐 peer 协商
const connected = computed(() => !!callState.active?.voiceReady)

// 呼叫方仍在等待：对方尚未接通（语音管线未就绪且成员里有别人）
const waiting = computed(() => {
  const a = callState.active
  if (!a || connected.value) return false
  return [...a.members].some((u) => u !== auth.user)
})

// 参与者展示列表：自己 + 房间成员（保持顺序稳定）
const participants = computed(() => {
  const a = callState.active
  if (!a) return []
  const list = [{ name: auth.user, me: true, connected: true }]
  for (const u of a.members) {
    if (u === auth.user) continue
    list.push({ name: u, connected: connected.value })
  }
  return list
})
</script>

<style>
.co-fade-enter-active, .co-fade-leave-active { transition: opacity .25s ease; }
.co-fade-enter-from, .co-fade-leave-to { opacity: 0; }
.co-btn { transition: transform .15s ease; }
@keyframes coPulse {
  0% { box-shadow: 0 0 0 0 rgba(52,199,89,.55); }
  70% { box-shadow: 0 0 0 18px rgba(52,199,89,0); }
  100% { box-shadow: 0 0 0 0 rgba(52,199,89,0); }
}
.animate-co-pulse { animation: coPulse 1.6s infinite; }
/* 来电头像：左右摆动模拟响铃 */
@keyframes coRing {
  0%, 100% { transform: rotate(0deg); }
  15% { transform: rotate(-14deg); }
  30% { transform: rotate(12deg); }
  45% { transform: rotate(-8deg); }
  60% { transform: rotate(6deg); }
  75% { transform: rotate(0deg); }
}
.co-ring { animation: coRing 1.4s ease-in-out infinite; }
</style>

// 语音通话管理：信令经后端 /api/v1/call/*，媒体走与信令同一条 WS 连接（8080）二进制中继。
// 采集→Opus 编码→WS 上行→服务器按通话房间转发→对端解码播放（utils/voice.js 管线）。
// 不再有 WebRTC P2P / ICE：跨运营商 NAT 打洞失败的问题随之消失，凡能连上服务即可通话。
//
// 多端（手机/Web/PC 同账号）语义：
//   - 邀请会推给被叫的全部设备 → 各端同时振铃；
//   - 任一设备接听/拒绝/挂断后，后端事件携带发起设备 id（device），
//     本设备匹配自身 id 忽略，其余设备据此停止振铃/退出并提示"已在其他设备…"；
//   - 无人接听 60s 由后端超时清理并推送 ended{reason:'timeout'}。
import { reactive } from 'vue'
import api from '@/api'
import { auth, wsSendBinary } from '@/store'
import { getDeviceId } from '@/utils/device'
import { startVoice, stopVoice, setVoiceMuted, voiceSupported } from '@/utils/voice'

// 通话结束原因 → 提示文案（CallOverlay 展示 callState.ended.reason 对应文字）
export const END_TEXT = {
  hangup: '通话已结束',
  'remote-hangup': '对方已结束通话',
  rejected: '对方拒绝接听',
  'no-answer': '未接听，通话已结束',
  cancelled: '对方已取消呼叫',
  'other-accept': '已在其他设备接听',
  'other-reject': '已在其他设备拒绝',
  'other-hangup': '已在其他设备挂断',
}

export const callState = reactive({
  incoming: null,     // 来电 {id, from, owner, members}
  active: null,       // 通话 {id, owner, members:Set, voiceReady, startedAt}
  ended: null,        // 刚结束 {reason}，UI 短暂提示后自动清空
  micMuted: false,
  error: '',
})

let raf = null
function flashError(msg) {
  callState.error = msg
  if (raf) clearTimeout(raf)
  raf = setTimeout(() => (callState.error = ''), 4000)
}

// ---- 铃声与振动 ----
// APK：走原生铃声播放（铃声音量流 USAGE_NOTIFICATION_RINGTONE，随铃声键调音量），
//      铃声文件可在设置中选择（localStorage 存 {uri,name}，sk_call_ringtone=来电 / sk_back_ringtone=彩铃）。
// Web：WebAudio 合成双音回铃（媒体音量，仅作回退）。
const nativeBridge = () => window.StickyKeeNative || null
const TONE_KEYS = { incoming: 'sk_call_ringtone', back: 'sk_back_ringtone' }
let ringCtx = null
let ringTimer = null

function readToneUri(kind) {
  try {
    const v = JSON.parse(localStorage.getItem(TONE_KEYS[kind]) || 'null')
    return v?.uri || ''
  } catch { return '' }
}

// kind: 'incoming' 来电振铃 | 'back' 呼叫等待回铃（彩铃）
function startRing(kind) {
  stopRing()
  const n = nativeBridge()
  if (n?.playRing) {
    n.playRing(readToneUri(kind), true)
    if (kind === 'incoming') {
      try { navigator.vibrate?.([500, 200, 500, 800]) } catch { /* 不支持则忽略 */ }
    }
    return
  }
  try {
    ringCtx = new (window.AudioContext || window.webkitAudioContext)()
  } catch { ringCtx = null }
  const beep = () => {
    if (!ringCtx) return
    ringCtx.resume?.().catch(() => {})
    // 双音回铃：440/480Hz 各 0.5s 响 + 1.5s 停
    const t = ringCtx.currentTime
    ;[440, 480].forEach((f, i) => {
      const o = ringCtx.createOscillator()
      const g = ringCtx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02 + i * 0.5)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45 + i * 0.5)
      o.connect(g).connect(ringCtx.destination)
      o.start(t + i * 0.5)
      o.stop(t + 0.5 + i * 0.5)
    })
  }
  beep()
  ringTimer = setInterval(beep, 2000)
  if (kind === 'incoming') {
    try { navigator.vibrate?.([500, 200, 500, 800]) } catch { /* 忽略 */ }
  }
}

function stopRing() {
  try { nativeBridge()?.stopRing?.() } catch { /* 忽略 */ }
  if (ringTimer) { clearInterval(ringTimer); ringTimer = null }
  if (ringCtx) { ringCtx.close().catch(() => {}); ringCtx = null }
  try { navigator.vibrate?.(0) } catch { /* 忽略 */ }
}

// ---- 对外动作 ----

// 发起通话（一对一 users.length=1；群聊多人）
export async function startCall(users) {
  const list = [...new Set((users || []).filter((u) => u && u !== auth.user))]
  if (!list.length) return
  if (callState.active || callState.incoming) { flashError('正在通话中'); return }
  if (!voiceSupported()) { flashError('当前系统 WebView 过旧，无法语音通话'); return }
  try {
    const { data } = await api.callStart(list)
    callState.active = {
      id: data.id, owner: data.owner || auth.user,
      members: new Set(data.members), voiceReady: false, startedAt: Date.now(),
    }
    callState.micMuted = false
    startRing('back') // 呼叫方等待接听：播彩铃（铃声音量流），对方加入后停止
    // 被邀请人当前无在线设备：给出提示（仍等待其上线接听，超时后自动结束）
    if (Array.isArray(data.offline) && data.offline.length) {
      flashError(`对方不在线：${data.offline.join('、')}`)
    }
  } catch (e) {
    teardown()
    flashError(e.message || '发起通话失败')
    throw e
  }
}

// 接听
export async function acceptCall() {
  const inc = callState.incoming
  if (!inc) return
  stopRing()
  if (!voiceSupported()) {
    try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
    callState.incoming = null
    flashError('当前系统 WebView 过旧，无法语音通话')
    return
  }
  try {
    // 先起本端语音（拿麦 + 编解码就绪）再入房：入房即收发，无空窗。
    // 入房前发出的帧会被服务端丢弃（发送者尚不在房间），无害。
    await startVoice(inc.id, wsSendBinary)
    const { data } = await api.callJoin(inc.id, getDeviceId())
    callState.incoming = null
    callState.active = {
      id: data.id, owner: data.owner,
      members: new Set(data.members), voiceReady: true, startedAt: Date.now(),
    }
    callState.micMuted = false
    try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
  } catch (e) {
    stopVoice()
    stopRing()
    try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
    callState.incoming = null
    flashError(e.message || '接听失败')
  }
}

// 拒接
export async function rejectCall() {
  const inc = callState.incoming
  if (!inc) return
  stopRing()
  try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
  callState.incoming = null
  try { await api.callReject(inc.id, getDeviceId()) } catch { /* ignore */ }
}

// 挂断（通话中）
export async function hangup() {
  const a = callState.active
  const id = a?.id
  endCall('hangup')
  if (id) { try { await api.callLeave(id, getDeviceId()) } catch { /* ignore */ } }
}

// 统一结束：停语音管线、清来电/振铃，并设置结束提示（UI 短暂展示后自动清空）
function endCall(reason) {
  stopRing()
  try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
  teardown()
  callState.incoming = null
  callState.ended = { reason }
  setTimeout(() => {
    if (callState.ended?.reason === reason) callState.ended = null
  }, 2500)
}

// 本地清理：停语音管线（麦/编解码/播放）
function teardown() {
  stopVoice()
  callState.active = null
  callState.micMuted = false
}

// 静音切换（编码输出丢弃：对端听不到，本端无感）
export function toggleMute() {
  if (!callState.active) return
  callState.micMuted = !callState.micMuted
  setVoiceMuted(callState.micMuted)
}

// ---- 信令事件入口（store 收到 type:'call' 后调用）----
export async function handleCallEvent(ev) {
  switch (ev.event) {
    case 'invite': return onInvite(ev)
    case 'signal': return onSignal(ev)
    case 'joined': return onJoined(ev)
    case 'left': return onLeft(ev)
    case 'reject': return onReject(ev)
    case 'ended': return onEnded(ev)
  }
}

// 该事件是否由本设备的操作触发（后端回传 device 用于多端互斥）
function isSelfAction(device) {
  return device && device === getDeviceId()
}

async function onInvite(ev) {
  // 通话中收到新邀请：自动拒（忙碌）
  if (callState.active) { try { await api.callReject(ev.room, getDeviceId()) } catch {}; return }
  if (callState.incoming) { try { await api.callReject(ev.room, getDeviceId()) } catch {}; return }
  callState.incoming = { id: ev.room, from: ev.from, owner: ev.owner, members: ev.members }
  startRing('incoming')
  // 来电状态栏通知（APK）：响铃期间常驻，接听/挂断后取消；点击拉应用回前台
  try { window.StickyKeeNative?.callNotification?.('来电', '来自 ' + (ev.from || '联系人') + ' 的语音通话') } catch { /* 忽略 */ }
}

// 收到 WebRTC 信令：对端仍是旧版（P2P 直连方案）。新版媒体走 WS 中继，
// 新旧版本媒体层不互通——与其静默无声，不如明确提示升级。
function onSignal(ev) {
  if (callState.active?.id === ev.room || callState.incoming?.id === ev.room) {
    flashError('对方是旧版本，请双方更新 App 后重试')
  }
}

function onJoined(ev) {
  // 本人其它设备接听：本端若仍在振铃则停止并提示
  if (ev.user === auth.user) {
    if (isSelfAction(ev.device)) return
    if (callState.incoming?.id === ev.room) endCall('other-accept')
    return
  }
  const a = callState.active
  if (!a || a.id !== ev.room) return
  stopRing() // 对方接通（加入房间）：呼叫方停止彩铃
  a.members = new Set(ev.members)
  // 呼叫方此前未拿麦：对方接入后启动本端语音管线（收发即通，无协商）
  if (a.voiceReady) return // 已启动（多人房间多个 joined 事件只起一次）
  a.voiceReady = true
  startVoice(a.id, wsSendBinary).catch((e) => {
    flashError(e.message || '语音初始化失败')
    endCall('hangup')
  })
}

function onLeft(ev) {
  // 本人其它设备挂断/接听后离开：本端退出
  if (ev.user === auth.user) {
    if (isSelfAction(ev.device)) return
    if (callState.incoming?.id === ev.room || callState.active?.id === ev.room) {
      endCall('other-hangup')
    }
    return
  }
  const a = callState.active
  if (!a || a.id !== ev.room) {
    // 被叫未接时收到 ended=true 即取消
    if (ev.ended && callState.incoming?.id === ev.room) endCall('cancelled')
    return
  }
  // owner 离开或房间结束：全量挂断并提示
  if (ev.ended || ev.user === a.owner) { endCall('remote-hangup'); return }
  a.members.delete(ev.user)
  // 一对一：对方挂断后仅剩自己 → 本端同步结束并提示
  const others = [...a.members].filter((u) => u !== auth.user)
  if (!others.length) endCall('remote-hangup')
}

function onReject(ev) {
  // 本人其它设备拒绝
  if (ev.from === auth.user) {
    if (isSelfAction(ev.device)) return
    if (callState.incoming?.id === ev.room) endCall('other-reject')
    return
  }
  const a = callState.active
  if (!a || a.id !== ev.room) return
  // 该成员拒接：移出成员；一对一（仅剩自己）则结束通话
  a.members.delete(ev.from)
  const others = [...a.members].filter((u) => u !== auth.user)
  if (!others.length) endCall('rejected')
}

// 后端超时/强制结束：清振铃或通话并提示
function onEnded(ev) {
  if (callState.incoming?.id === ev.room) { endCall('no-answer'); return }
  const a = callState.active
  if (a && a.id === ev.room) {
    endCall(ev.reason === 'timeout' ? 'no-answer' : 'remote-hangup')
  }
}

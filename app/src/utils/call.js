// 语音通话管理：WebRTC mesh（每位参与者与其余成员各一条 P2P 连接，建议 ≤6 人）。
// 信令经后端 /api/v1/call/* 中继；媒体不经过服务器。
//
// Mesh 建链规则（避免 offer glare）：任意双方中，username 字典序较小的一方发起 offer。
//
// 多端（手机/Web/PC 同账号）语义：
//   - 邀请会推给被叫的全部设备 → 各端同时振铃；
//   - 任一设备接听/拒绝/挂断后，后端事件携带发起设备 id（device），
//     本设备匹配自身 id 忽略，其余设备据此停止振铃/退出并提示"已在其他设备…"；
//   - 无人接听 60s 由后端超时清理并推送 ended{reason:'timeout'}。
import { reactive } from 'vue'
import api from '@/api'
import { auth } from '@/store'
import { getDeviceId } from '@/utils/device'

let ICE_SERVERS = [
  // 腾讯/小米公共 STUN；局域网内即使无 STUN 也能用 host candidate 直连
  { urls: ['stun:stun.qq.com:3478', 'stun:stun.miwifi.com:3478'] },
]
// TURN 中继配置从服务端 /ice 拉取（coturn，跨运营商 NAT 打洞失败时经服务器中继语音）。
// 拉取失败保持纯 STUN（行为同旧版）；成功后本会话内所有新通话生效。
;(async () => {
  try {
    const { data } = await api.ice()
    const list = data && Array.isArray(data.iceServers) ? data.iceServers.filter((s) => s && s.urls && s.urls.length) : []
    if (list.length) ICE_SERVERS = list
  } catch { /* 未配置/未登录时用默认 STUN */ }
})()

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
  active: null,       // 通话 {id, owner, members:Set, peers:Map<user,Peer>, localStream, startedAt}
  ended: null,        // 刚结束 {reason}，UI 短暂提示后自动清空
  micMuted: false,
  error: '',
})

// Peer: { pc, stream, iceQueue }
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

async function ensureMic() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('设备不支持语音通话')
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}

function createPeerCtx(user) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const ctx = { pc, stream: new MediaStream(), iceQueue: [] }
  const a = callState.active
  // 本地麦克风推给对方
  if (a.localStream) a.localStream.getAudioTracks().forEach((t) => pc.addTrack(t, a.localStream))
  pc.onicecandidate = (e) => {
    if (!e.candidate) return
    api.callSignal(a.id, user, { kind: 'ice', candidate: e.candidate }).catch(() => {})
  }
  pc.ontrack = (e) => {
    e.streams[0]?.getAudioTracks().forEach((t) => ctx.stream.addTrack(t))
    if (!e.streams[0] && e.track) ctx.stream.addTrack(e.track)
  }
  a.peers.set(user, ctx)
  return ctx
}

// initiator=true：本端是字典序较小者，发 offer
async function connectPeer(user, initiator) {
  const a = callState.active
  if (a.peers.has(user)) return
  const ctx = createPeerCtx(user)
  if (!initiator) return // answer 方等待 offer
  try {
    const offer = await ctx.pc.createOffer({ offerToReceiveAudio: true })
    await ctx.pc.setLocalDescription(offer)
    await api.callSignal(a.id, user, { kind: 'offer', sdp: ctx.pc.localDescription })
  } catch (e) { flashError('连接失败：' + user) }
}

// 按规则与所有需要的成员建链：对字典序大于自己的成员发起 offer
function connectAllPeers() {
  const me = auth.user
  for (const user of callState.active.members) {
    if (user === me) continue
    if (user > me) connectPeer(user, true)
  }
}

// ---- 对外动作 ----

// 发起通话（一对一 users.length=1；群聊多人）
export async function startCall(users) {
  const list = [...new Set((users || []).filter((u) => u && u !== auth.user))]
  if (!list.length) return
  if (callState.active || callState.incoming) { flashError('正在通话中'); return }
  try {
    const localStream = await ensureMic()
    let data
    try {
      ({ data } = await api.callStart(list))
    } catch (e) {
      localStream.getTracks().forEach((t) => t.stop()) // 建房失败：释放麦克风
      throw e
    }
    callState.active = {
      id: data.id, owner: data.owner || auth.user,
      members: new Set(data.members), peers: new Map(),
      localStream, startedAt: Date.now(),
    }
    callState.micMuted = false
    // 不在此处建链：若本端字典序小于对方，offer 会在对方接听前到达并被其
    // onSignal 丢弃（彼时对方 active 为空），对方接听后按规则等待 offer → 死锁无声。
    // 改为收到 joined（对方已加入、双方 active 均就绪）后再按字典序补齐建链。
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
  try {
    const localStream = await ensureMic()
    const { data } = await api.callJoin(inc.id, getDeviceId())
    callState.incoming = null
    callState.active = {
      id: data.id, owner: data.owner,
      members: new Set(data.members), peers: new Map(),
      localStream, startedAt: Date.now(),
    }
    callState.micMuted = false
    // 成员中字典序大于我的，由我发起；小于我的等对方 offer
    connectAllPeers()
    // 回放接听前缓存的信号：旧版对端在响铃期已发出的 offer/ICE
    replayPreAccept(data.id)
    try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
  } catch (e) {
    stopRing()
    try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
    dropPreAccept(inc.id)
    // 房间已被其他设备接听/结束：清理本地振铃状态
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
  dropPreAccept(inc.id)
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

// 统一结束：关 peer、停麦克风、清来电/振铃，并设置结束提示（UI 短暂展示后自动清空）
function endCall(reason) {
  stopRing()
  try { window.StickyKeeNative?.cancelCallNotification?.() } catch { /* 忽略 */ }
  dropPreAccept(callState.active?.id || callState.incoming?.id)
  teardown()
  callState.incoming = null
  callState.ended = { reason }
  setTimeout(() => {
    if (callState.ended?.reason === reason) callState.ended = null
  }, 2500)
}

// 本地清理：关 peer、停麦克风
function teardown() {
  const a = callState.active
  if (a) {
    for (const ctx of a.peers.values()) ctx.pc.close()
    a.localStream?.getTracks().forEach((t) => t.stop())
  }
  callState.active = null
  callState.micMuted = false
}

// 静音切换（作用于本地轨道 + 已建连的 peer）
export function toggleMute() {
  const a = callState.active
  if (!a) return
  callState.micMuted = !callState.micMuted
  a.localStream?.getAudioTracks().forEach((t) => { t.enabled = !callState.micMuted })
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

async function onSignal(ev) {
  let a = callState.active
  if (!a) {
    // 振铃期（无 active）收到的 offer/ICE 不能丢弃：旧版发起方在响铃时已发出，
    // 新版接听后才建链；若在此丢弃会形成「旧发起方+新被叫」无声死锁。缓存待回放。
    if (callState.incoming?.id === ev.room) {
      const d = ev.data || {}
      if (d.kind === 'offer' || d.kind === 'ice') {
        let buf = preAccept.find((b) => b.room === ev.room && b.from === ev.from)
        if (!buf) { buf = { room: ev.room, from: ev.from, ts: Date.now(), items: [] }; preAccept.push(buf) }
        if (Date.now() - buf.ts < 60000) buf.items.push(d)
      }
    }
    return
  }
  if (!a.members.has(ev.from)) return
  const ctx0 = a.peers.get(ev.from)
  const d = ev.data || {}
  if (d.kind === 'offer') {
    const ctx = ctx0 || createPeerCtx(ev.from)
    const pc = ctx.pc
    // 完美协商（避免双方同时互发 offer 的 glare）：
    // 字典序大者为 polite——冲突时回滚己方 offer 让路；小者为 impolite——忽略对方 offer
    const polite = ev.from > auth.user
    if (pc.signalingState !== 'stable') {
      if (!polite) return
      try { await pc.setLocalDescription({ type: 'rollback' }) } catch { /* 已 stable 则忽略 */ }
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(d.sdp))
      ctx.iceQueue.forEach((c) => ctx.pc.addIceCandidate(c).catch(() => {}))
      ctx.iceQueue = []
      const answer = await ctx.pc.createAnswer()
      await ctx.pc.setLocalDescription(answer)
      await api.callSignal(a.id, ev.from, { kind: 'answer', sdp: ctx.pc.localDescription })
    } catch { /* 协商失败：等对方重连 */ }
  } else if (d.kind === 'answer') {
    if (!ctx0 || ctx0.pc.signalingState !== 'have-local-offer') return
    await ctx0.pc.setRemoteDescription(new RTCSessionDescription(d.sdp)).catch(() => {})
  } else if (d.kind === 'ice') {
    if (!ctx0) return
    const c = new RTCIceCandidate(d.candidate)
    if (ctx0.pc.remoteDescription) ctx0.pc.addIceCandidate(c).catch(() => {})
    else ctx0.iceQueue.push(c)
  }
}

// 接听前缓存的信号：[{room, from, ts, items:[{kind,...}]}]（60s 过期）
let preAccept = []
// 接听成功后回放缓存：旧版对端在响铃期发出的 offer/ICE 按原顺序补处理
function replayPreAccept(room) {
  const buf = preAccept.filter((b) => b.room === room)
  preAccept = preAccept.filter((b) => b.room !== room)
  for (const b of buf) for (const d of b.items) onSignal({ room, from: b.from, data: d })
}
// 通话终结（拒接/结束/超时）时丢弃该房间缓存
function dropPreAccept(room) {
  if (room) preAccept = preAccept.filter((b) => b.room !== room)
  else preAccept = []
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
  // 对方已接听、双方 active 均就绪，此刻按字典序规则建链才安全
  // （connectAllPeers 对缺链且字典序大于本端的成员发 offer，已建链自动跳过）
  connectAllPeers()
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
    // 呼叫方（本端 active 等待接听场景不存在 left；被叫未接时收到 ended=true 即取消）
    if (ev.ended && callState.incoming?.id === ev.room) endCall('cancelled')
    return
  }
  // owner 离开或房间结束：全量挂断并提示
  if (ev.ended || ev.user === a.owner) { endCall('remote-hangup'); return }
  const ctx = a.peers.get(ev.user)
  if (ctx) ctx.pc.close()
  a.peers.delete(ev.user)
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
  // 该成员拒接：移除其连接；一对一（仅剩自己）则结束通话
  const ctx = a.peers.get(ev.from)
  if (ctx) ctx.pc.close()
  a.peers.delete(ev.from)
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

// 语音通话管理：WebRTC mesh（每位参与者与其余成员各一条 P2P 连接，建议 ≤6 人）。
// 信令经后端 /api/v1/call/* 中继；媒体不经过服务器。
//
// Mesh 建链规则（避免 offer glare）：任意双方中，username 字典序较小的一方发起 offer。
import { reactive } from 'vue'
import api from '@/api'
import { auth } from '@/store'

const ICE_SERVERS = [
  // 腾讯/小米公共 STUN；局域网内即使无 STUN 也能用 host candidate 直连
  { urls: ['stun:stun.qq.com:3478', 'stun:stun.miwifi.com:3478'] },
]

export const callState = reactive({
  incoming: null,     // 来电 {id, from, owner, members}
  active: null,       // 通话 {id, owner, members:Set, peers:Map<user,Peer>, localStream, startedAt}
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
    const { data } = await api.callStart(list)
    callState.active = {
      id: data.id, owner: data.owner || auth.user,
      members: new Set(data.members), peers: new Map(),
      localStream, startedAt: Date.now(),
    }
    callState.micMuted = false
    connectAllPeers()
  } catch (e) {
    flashError(e.message || '发起通话失败')
    throw e
  }
}

// 接听
export async function acceptCall() {
  const inc = callState.incoming
  if (!inc) return
  try {
    const localStream = await ensureMic()
    const { data } = await api.callJoin(inc.id)
    callState.incoming = null
    callState.active = {
      id: data.id, owner: data.owner,
      members: new Set(data.members), peers: new Map(),
      localStream, startedAt: Date.now(),
    }
    callState.micMuted = false
    // 成员中字典序大于我的，由我发起；小于我的等对方 offer
    connectAllPeers()
  } catch (e) { flashError(e.message || '接听失败') }
}

// 拒接
export async function rejectCall() {
  const inc = callState.incoming
  if (!inc) return
  callState.incoming = null
  try { await api.callReject(inc.id) } catch { /* ignore */ }
}

// 挂断
export async function hangup() {
  const a = callState.active
  const id = a?.id
  teardown()
  if (id) { try { await api.callLeave(id) } catch { /* ignore */ } }
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
  }
}

async function onInvite(ev) {
  // 通话中收到新邀请：自动拒（忙碌）
  if (callState.active) { try { await api.callReject(ev.room) } catch {}; return }
  if (callState.incoming) { try { await api.callReject(ev.room) } catch {}; return }
  callState.incoming = { id: ev.room, from: ev.from, owner: ev.owner, members: ev.members }
}

async function onSignal(ev) {
  const a = callState.active
  if (!a || !a.members.has(ev.from)) return
  let ctx = a.peers.get(ev.from)
  const d = ev.data || {}
  if (d.kind === 'offer') {
    if (!ctx) ctx = createPeerCtx(ev.from)
    try {
      await ctx.pc.setRemoteDescription(new RTCSessionDescription(d.sdp))
      ctx.iceQueue.forEach((c) => ctx.pc.addIceCandidate(c).catch(() => {}))
      ctx.iceQueue = []
      const answer = await ctx.pc.createAnswer()
      await ctx.pc.setLocalDescription(answer)
      await api.callSignal(a.id, ev.from, { kind: 'answer', sdp: ctx.pc.localDescription })
    } catch { /* 协商失败：等对方重连 */ }
  } else if (d.kind === 'answer') {
    if (!ctx) return
    await ctx.pc.setRemoteDescription(new RTCSessionDescription(d.sdp)).catch(() => {})
  } else if (d.kind === 'ice') {
    if (!ctx) return
    const c = new RTCIceCandidate(d.candidate)
    if (ctx.pc.remoteDescription) ctx.pc.addIceCandidate(c).catch(() => {})
    else ctx.iceQueue.push(c)
  }
}

function onJoined(ev) {
  const a = callState.active
  if (!a || a.id !== ev.room) return
  a.members = new Set(ev.members)
  // 新成员若字典序大于我，我主动连；否则等其 offer
  if (ev.user > auth.user) connectPeer(ev.user, true)
}

function onLeft(ev) {
  const a = callState.active
  if (!a || a.id !== ev.room) return
  // owner 离开或房间结束：全量挂断
  if (ev.ended || ev.user === a.owner) { teardown(); return }
  const ctx = a.peers.get(ev.user)
  if (ctx) ctx.pc.close()
  a.peers.delete(ev.user)
  a.members.delete(ev.user)
}

function onReject(ev) {
  const a = callState.active
  if (!a || a.id !== ev.room) return
  // 该成员拒接：移除其连接；一对一（仅剩自己）则结束通话
  const ctx = a.peers.get(ev.from)
  if (ctx) ctx.pc.close()
  a.peers.delete(ev.from)
  a.members.delete(ev.from)
  const others = [...a.members].filter((u) => u !== auth.user)
  if (!others.length) teardown()
}

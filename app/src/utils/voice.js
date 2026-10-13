// 语音通话媒体管线：WebCodecs Opus 编解码 + WebSocket 二进制中继。
// 媒体不再走 WebRTC P2P（跨运营商 NAT 打洞必失败），而是采集→Opus 编码→
// 经与信令同一条 WS 连接（8080）上行；服务器按通话房间转发给其他成员；
// 本端收到 WS 二进制帧→Opus 解码→AudioBuffer 调度播放。
// 帧格式：[1B 版本=0x01][16B roomID ASCII 补 0][Opus 载荷]（与后端 audioHeaderLen 对应）。
// 依赖 WebCodecs（Android WebView 103+）；不支持时 voiceSupported() 为 false，UI 提示升级。

const CHUNK = 960 // 编码帧长：20ms @48kHz
const PLAY_PREBUFFER = 0.12 // 播放起始缓冲（jitter buffer），欠载时重置

// 采集 worklet：内部累积到 20ms 再 postMessage（降低消息频率 375/s → 50/s）
const CAP_WORKLET = `class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(960); this.filled = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    let pos = 0
    while (pos < ch.length) {
      const n = Math.min(960 - this.filled, ch.length - pos)
      this.buf.set(ch.subarray(pos, pos + n), this.filled)
      this.filled += n; pos += n
      if (this.filled === 960) { this.port.postMessage(this.buf.slice(0)); this.filled = 0 }
    }
    return true
  }
}
registerProcessor('cap', Cap)`

let capCtx = null        // 采集 AudioContext
let worklet = null       // 采集 AudioWorkletNode
let encoder = null       // AudioEncoder
let decoder = null       // AudioDecoder
let playCtx = null       // 播放 AudioContext
let micStream = null     // getUserMedia 流
let playTime = 0         // 下一帧调度时间（jitter buffer 写指针）
let activeRoom = ''      // 当前通话房间
let sendFn = null        // 二进制上行（store 注入）
let muted = false        // 静音：编码输出丢弃（对端听不到，本端无感）

// 当前 WebView 是否具备语音通话能力
export function voiceSupported() {
  return typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function' && typeof AudioData === 'function'
}

function frameHeader(room) {
  const b = new Uint8Array(17)
  b[0] = 1
  for (let i = 0; i < 16 && i < room.length; i++) b[1 + i] = room.charCodeAt(i)
  return b
}

// 启动语音：getUserMedia → 编码上行；解码播放侧就绪。send(bytes) 由 store 注入 WS 上行。
export async function startVoice(room, send) {
  stopVoice()
  if (!voiceSupported()) throw new Error('当前系统 WebView 过旧，无法语音通话')
  activeRoom = room
  sendFn = send

  // ---- 采集 + 编码 ----
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  capCtx = new AudioContext({ sampleRate: 48000 })
  const url = URL.createObjectURL(new Blob([CAP_WORKLET], { type: 'text/javascript' }))
  await capCtx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  worklet = new AudioWorkletNode(capCtx, 'cap')
  worklet.port.onmessage = (e) => {
    if (!encoder || muted) return
    try {
      encoder.encode(new AudioData({
        format: 'f32-planar', sampleRate: 48000, numberOfFrames: CHUNK,
        numberOfChannels: 1, timestamp: Math.round(capCtx.currentTime * 1e6),
        data: e.data,
      }))
    } catch { /* 单帧失败忽略 */ }
  }
  capCtx.createMediaStreamSource(micStream).connect(worklet) // 不连 destination：防回声环
  encoder = new AudioEncoder({
    output: (chunk) => {
      if (!sendFn) return
      try {
        const payload = new Uint8Array(chunk.byteLength)
        chunk.copyTo(payload)
        const head = frameHeader(activeRoom)
        const out = new Uint8Array(head.length + payload.length)
        out.set(head)
        out.set(payload, head.length)
        sendFn(out)
      } catch { /* 单帧失败忽略 */ }
    },
    error: () => {},
  })
  encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 24000 })

  // ---- 解码 + 播放 ----
  playCtx = new AudioContext({ sampleRate: 48000 })
  decoder = new AudioDecoder({
    output: schedulePlay,
    error: () => {},
  })
  decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 })
  playTime = 0
}

// 收到服务器转发的语音帧（WS ArrayBuffer）
export function feedVoiceRaw(frame) {
  if (!decoder || !(frame instanceof ArrayBuffer) || frame.byteLength <= 17) return
  const u8 = new Uint8Array(frame)
  if (u8[0] !== 1) return
  let room = ''
  for (let i = 1; i <= 16; i++) {
    if (u8[i] === 0) break
    room += String.fromCharCode(u8[i])
  }
  if (room !== activeRoom) return
  try {
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: 0, data: u8.slice(17) }))
  } catch { /* 单帧失败忽略 */ }
}

// 解码输出 → 按序调度到扬声器（简单 jitter buffer：欠载重置，超积压丢弃）
function schedulePlay(ad) {
  if (!playCtx) { ad.close(); return }
  try {
    const dur = ad.numberOfFrames / ad.sampleRate
    const now = playCtx.currentTime
    if (playTime < now + 0.02) playTime = now + PLAY_PREBUFFER // underrun：重建缓冲
    if (playTime > now + 0.6) { ad.close(); return }           // 积压过大：丢帧追实时
    const buf = new AudioBuffer({
      numberOfChannels: ad.numberOfChannels, sampleRate: ad.sampleRate, length: ad.numberOfFrames,
    })
    for (let c = 0; c < ad.numberOfChannels; c++) ad.copyTo(buf.getChannelData(c), { planeIndex: c })
    const src = new AudioBufferSourceNode(playCtx, { buffer: buf })
    src.connect(playCtx.destination)
    src.start(playTime)
    playTime += dur
  } finally {
    ad.close()
  }
}

// 静音切换：true=对端听不到本端
export function setVoiceMuted(m) { muted = !!m }

// 停止并释放全部资源
export function stopVoice() {
  try { encoder?.close() } catch { /* 忽略 */ }
  try { decoder?.close() } catch { /* 忽略 */ }
  try { micStream?.getTracks().forEach((t) => t.stop()) } catch { /* 忽略 */ }
  try { worklet?.disconnect() } catch { /* 忽略 */ }
  try { capCtx?.close() } catch { /* 忽略 */ }
  try { playCtx?.close() } catch { /* 忽略 */ }
  encoder = decoder = capCtx = playCtx = worklet = micStream = null
  activeRoom = ''
  sendFn = null
  muted = false
}

// 语音消息录音：封装 MediaRecorder + 麦克风权限 + 时长统计。
// 输出浏览器原生格式（安卓 Chrome：webm/opus；iOS 14.3+：mp4/aac），
// 由后端 MIME 嗅探与扩展名白名单兜底校验。

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',       // iOS Safari
  'audio/mp4;codecs=mp4a.40.2',
  'audio/ogg;codecs=opus',
]

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m } catch { /* ignore */ }
  }
  return ''
}

// mime → 文件扩展名（须与后端 imAudioExts 对齐）
function extForMime(mime) {
  if (mime.includes('mp4')) return '.m4a'
  if (mime.includes('ogg')) return '.ogg'
  if (mime.includes('webm')) return '.webm'
  return '.webm'
}

export class VoiceRecorder {
  constructor() {
    this.mr = null
    this.chunks = []
    this.startedAt = 0
    this.mime = ''
    this.stream = null
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  }

  async start() {
    if (!VoiceRecorder.supported()) throw new Error('当前设备不支持语音录制')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.mime = pickMime()
    this.chunks = []
    this.mr = this.mime ? new MediaRecorder(this.stream, { mimeType: this.mime }) : new MediaRecorder(this.stream)
    this.mr.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data) }
    this.mr.start(250)
    this.startedAt = Date.now()
  }

  // 停止并收集；返回 {blob, ext, durationSec}；不足 1 秒由调用方决定是否丢弃
  stop() {
    return new Promise((resolve) => {
      if (!this.mr) { resolve(null); return }
      this.mr.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000))
        const type = this.mr.mimeType || this.mime || 'audio/webm'
        const blob = new Blob(this.chunks, { type })
        this.release()
        resolve({ blob, ext: extForMime(type), durationSec })
      }
      try { this.mr.stop() } catch { this.mr.onstop() }
    })
  }

  // 中途取消：停止录音但不产出
  cancel() {
    return new Promise((resolve) => {
      if (!this.mr) { resolve(); return }
      this.mr.onstop = () => { this.release(); resolve() }
      try { this.mr.stop() } catch { this.mr.onstop() }
    })
  }

  release() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.mr = null
    this.chunks = []
  }
}

// PCM WAV 录制：不经 MediaRecorder，直接采集原始 PCM 并编码为 16-bit 单声道 WAV。
// 智家助手线程的语音走 HA Assist pipeline 识别，后端仅接受 WAV/PCM，该线程用此录制器。
export class WavRecorder {
  constructor() {
    this.ctx = null
    this.stream = null
    this.proc = null
    this.src = null
    this.buffers = []
    this.sampleRate = 16000
    this.startedAt = 0
  }

  static supported() {
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null
    return !!AC && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  }

  async start() {
    if (!WavRecorder.supported()) throw new Error('当前设备不支持语音录制')
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext
    this.ctx = new AC()
    this.src = this.ctx.createMediaStreamSource(this.stream)
    this.buffers = []
    this.sampleRate = this.ctx.sampleRate
    // ScriptProcessorNode 已废弃但在旧安卓 WebView 上兼容性最好，够用
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1)
    this.proc.onaudioprocess = (e) => {
      // inputBuffer 会被复用，必须拷贝
      this.buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    this.src.connect(this.proc)
    this.proc.connect(this.ctx.destination) // 不接 destination 不会触发回调
    this.startedAt = Date.now()
  }

  // 停止并编码 WAV；返回 {blob, ext, durationSec}
  stop() {
    return new Promise((resolve) => {
      if (!this.proc) { resolve(null); return }
      const durationSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000))
      const wavBuf = encodeWav(this.buffers, this.sampleRate)
      this.release()
      resolve({ blob: new Blob([wavBuf], { type: 'audio/wav' }), ext: '.wav', durationSec })
    })
  }

  cancel() {
    return new Promise((resolve) => { this.release(); resolve() })
  }

  release() {
    try { if (this.proc) { this.proc.onaudioprocess = null; this.proc.disconnect() } } catch { /* ignore */ }
    try { if (this.src) this.src.disconnect() } catch { /* ignore */ }
    try { if (this.ctx) this.ctx.close() } catch { /* ignore */ }
    this.proc = this.src = this.ctx = null
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.buffers = []
  }
}

// 原生录音兜底（仅 APK）：http 非安全上下文下 WebView 不暴露 navigator.mediaDevices，
// MediaRecorder/AudioContext 采集均不可用，改走 StickyKeeNative 原生 AudioRecord，
// 返回 16kHz 单声道 16-bit WAV。接口与 VoiceRecorder/WavRecorder 一致。
export class NativeWavRecorder {
  constructor() {
    this.t0 = 0
  }

  static native() {
    const n = typeof window !== 'undefined' ? window.StickyKeeNative : null
    return n && typeof n.startRec === 'function' && typeof n.stopRec === 'function' ? n : null
  }

  static supported() {
    return !!NativeWavRecorder.native()
  }

  async start() {
    const n = NativeWavRecorder.native()
    if (!n) throw new Error('原生录音不可用')
    const r = String(n.startRec() || '')
    if (r === 'no_permission') throw new Error('请授予 APP 麦克风权限后重试')
    if (r === 'busy') throw new Error('录音未就绪，请稍候重试')
    if (r !== 'ok') throw new Error('无法启动录音' + (r.startsWith('error') ? '：' + r.slice(6) : ''))
    this.t0 = Date.now()
  }

  stop() {
    const n = NativeWavRecorder.native()
    const durationSec = Math.max(1, Math.round((Date.now() - this.t0) / 1000))
    const b64 = n ? String(n.stopRec() || '') : ''
    if (!b64) return Promise.resolve(null)
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return Promise.resolve({ blob: new Blob([u8], { type: 'audio/wav' }), ext: '.wav', durationSec })
  }

  cancel() {
    const n = NativeWavRecorder.native()
    if (n) { try { n.cancelRec() } catch { /* ignore */ } }
    return Promise.resolve()
  }

  release() { /* 原生侧自行管理 */ }
}

// 采集的 Float32 分段 → 16-bit 单声道 PCM WAV（44 字节头）
function encodeWav(buffers, sampleRate) {
  let total = 0
  for (const b of buffers) total += b.length
  const buf = new ArrayBuffer(44 + total * 2)
  const v = new DataView(buf)
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF')
  v.setUint32(4, 36 + total * 2, true)
  wstr(8, 'WAVE')
  wstr(12, 'fmt ')
  v.setUint32(16, 16, true)          // fmt 块长度
  v.setUint16(20, 1, true)           // PCM
  v.setUint16(22, 1, true)           // 单声道
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // 字节率
  v.setUint16(32, 2, true)           // 块对齐
  v.setUint16(34, 16, true)          // 位深
  wstr(36, 'data')
  v.setUint32(40, total * 2, true)
  const pcm = new Int16Array(buf, 44)
  let off = 0
  for (const b of buffers) {
    for (let i = 0; i < b.length; i++) {
      const s = Math.max(-1, Math.min(1, b[i]))
      pcm[off + i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    off += b.length
  }
  return buf
}

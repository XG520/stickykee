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

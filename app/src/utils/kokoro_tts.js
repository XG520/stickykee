// Kokoro-82M 中文 TTS（浏览器本地推理，不依赖服务端）
// 模型：onnx-community/Kokoro-82M-v1.1-zh-ONNX
// 音色：zf_* 女声，zm_* 男声，需将 .bin 文件放到 public/kokoro/voices/
import { KokoroTTS } from '@uzen/kokoro-js'

let ttsInstance = null
let loadingPromise = null

/**
 * 初始化 Kokoro TTS（懒加载，首次调用时下载模型并缓存）。
 * 模型约 80~160MB，从 HuggingFace 下载，浏览器自动缓存。
 */
export async function initKokoroTTS() {
  if (ttsInstance) return ttsInstance
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    const useWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
    const device = useWebGPU ? 'webgpu' : 'wasm'
    const dtype = useWebGPU ? 'fp32' : 'q8'
    ttsInstance = await KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.1-zh-ONNX',
      { dtype, device, voicePath: '/kokoro/voices' }
    )
    return ttsInstance
  })()
  return loadingPromise
}

/**
 * 合成语音，返回 WAV Blob。
 * @param {string} text 文本
 * @param {string} voice 音色（默认 zf_001 女声）
 */
export async function kokoroSynth(text, voice = 'zf_001') {
  const tts = await initKokoroTTS()
  const audio = await tts.generate(text, { voice, speed: 1.0 })
  return rawAudioToWavBlob(audio)
}

// 将 Transformers.js RawAudio 转为 WAV Blob
function rawAudioToWavBlob(rawAudio) {
  const { samples, sampleRate } = rawAudio
  const numChannels = 1
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE')
  ws(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true)
  ws(36, 'data'); view.setUint32(40, dataSize, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

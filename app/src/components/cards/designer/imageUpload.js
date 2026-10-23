// 本地图片选择 → dataURL。背景上传与图片元素共用。
// dataURL 会内联进卡片 HTML / prefs 存储，必须限制体积，超限直接拒绝。
export const IMAGE_MAX_BYTES = 800 * 1024

export function pickImageFile(cb) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const f = input.files && input.files[0]
    if (!f) return
    if (f.size > IMAGE_MAX_BYTES) {
      window.alert(`图片过大（${(f.size / 1024).toFixed(0)}KB），请用 ${IMAGE_MAX_BYTES / 1024}KB 以内的图片，或改用图片 URL`)
      return
    }
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result || '')
      if (url) cb(url)
    }
    r.readAsDataURL(f)
  }
  input.click()
}

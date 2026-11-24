// 全局确认弹窗：以 Promise 方式替代 window.confirm，样式与应用内弹窗一致。
import { reactive } from 'vue'

export const confirmState = reactive({
  open: false,
  title: '请确认',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: true,
  resolve: null,
})

// 返回 Promise<boolean>；重复调用时上一个确认按取消处理。
export function confirmAction(opts = {}) {
  if (confirmState.resolve) confirmState.resolve(false)
  confirmState.title = opts.title || '请确认'
  confirmState.message = opts.message || ''
  confirmState.confirmText = opts.confirmText || '确定'
  confirmState.cancelText = opts.cancelText || '取消'
  confirmState.danger = opts.danger !== false
  confirmState.open = true
  return new Promise((resolve) => {
    confirmState.resolve = resolve
  })
}

export function settleConfirm(ok) {
  const resolve = confirmState.resolve
  confirmState.resolve = null
  confirmState.open = false
  if (resolve) resolve(!!ok)
}

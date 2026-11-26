// 记账模块共用的小工具：支付方式、金额格式化、月份计算。
// 金额在接口层统一以「分」为单位，仅展示时除以 100。

export const PAY_METHOD_OPTIONS = [
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信支付' },
  { value: 'bankcard', label: '银行卡' },
  { value: 'credit', label: '信用卡' },
  { value: 'cash', label: '现金' },
  { value: 'other', label: '其他' },
]

export function payMethodLabel(key) {
  if (!key) return ''
  const hit = PAY_METHOD_OPTIONS.find((x) => x.value === key)
  return hit ? hit.label : key
}

export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function monthText(month) {
  const [y, m] = String(month || '').split('-')
  if (!y || !m) return ''
  return `${y}年${Number(m)}月`
}

export function money(cents) {
  return '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function shortMoney(cents) {
  const v = Number(cents || 0) / 100
  if (!v) return ''
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万'
  if (v >= 100) return String(Math.round(v))
  return v.toFixed(v % 1 ? 1 : 0)
}

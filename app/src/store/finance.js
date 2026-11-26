import { ref, watch } from 'vue'
import { currentMonth } from '@/utils/finance'

// 账本子应用共享状态：月份在明细/图表/计划之间保持；编辑对象用于
// 「明细 → 记一笔页」传递待编辑流水；version 用于保存后通知各页刷新。
const MONTH_KEY = 'hc_finance_month'

function readMonth() {
  try {
    const v = sessionStorage.getItem(MONTH_KEY)
    if (v && /^\d{4}-\d{2}$/.test(v)) return v
  } catch { /* 隐私模式下忽略 */ }
  return currentMonth()
}

export const financeMonth = ref(readMonth())

watch(financeMonth, (v) => {
  try { sessionStorage.setItem(MONTH_KEY, v) } catch { /* 忽略 */ }
})

export const financeEditing = ref(null)
// 复制一笔的源流水：与「编辑」区分，保存时走新建而不是更新。
export const financeCopy = ref(null)
export const financeVersion = ref(0)

export function shiftFinanceMonth(n) {
  const [y, m] = financeMonth.value.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  financeMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function bumpFinanceVersion() {
  financeVersion.value += 1
}

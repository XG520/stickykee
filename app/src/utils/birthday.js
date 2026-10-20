// 生日工具：农历/公历生日的公历换算与倒计时。
// 生日数据存在 prefs 用户级键 birthdays：[{ id, name, calendar: 'solar'|'lunar', month, day }]
// 存储值为 JSON 字符串（/prefs 通道只收字符串）；readBirthdays 兼容历史数组格式。
import { Lunar } from 'lunar-javascript'

// 读取 prefs 里的 birthdays（兼容数组 / JSON 字符串 / 缺失）。
export function readBirthdays(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const a = JSON.parse(raw)
      return Array.isArray(a) ? a : []
    } catch { return [] }
  }
  return []
}

// 生日在某公历年的日期 [y, m, d]；换不出返回 null。
// 特例：公历 2·29 平年回落 2·28；农历三十缺位回落二十九。
export function birthdaySolarInYear(b, y) {
  if (b.calendar !== 'lunar') {
    if (b.month === 2 && b.day === 29) {
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
      if (!leap) return [y, 2, 28]
    }
    return [y, b.month, b.day]
  }
  const tryDay = (d) => {
    try {
      const s = Lunar.fromYmd(y, b.month, d).getSolar()
      return [s.getYear(), s.getMonth(), s.getDay()]
    } catch { return null }
  }
  if (b.day === 30) return tryDay(30) || tryDay(29)
  return tryDay(b.day)
}

// 距下一次生日的 { date, days, y }；days=0 即今天生日。now 不传用当前时刻。
export function nextBirthday(b, now) {
  const t = now || new Date()
  const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  for (const y of [t0.getFullYear(), t0.getFullYear() + 1]) {
    const s = birthdaySolarInYear(b, y)
    if (!s) continue
    const d = new Date(s[0], s[1] - 1, s[2])
    if (d >= t0) return { date: d, days: Math.round((d - t0) / 86400000), y }
  }
  return null
}

// 展示文本：农历「农历八月十五」/ 公历「8月15日」
export function birthdayDateText(b) {
  return b.calendar === 'lunar' ? `农历${b.month}月${b.day}日` : `${b.month}月${b.day}日`
}

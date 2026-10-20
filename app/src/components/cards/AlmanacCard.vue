<template>
  <div class="hc-almanac" :class="{ 'has-detail': active }">
    <!-- ============ 卡头：农历简称 + 公历年月 + 上一月/下一月 ============ -->
    <div class="am-head">
      <button class="am-nav" title="上一月" @click.stop="prevMonth">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <div class="am-head-text">
        <div class="am-sub">{{ lunarOfToday }}</div>
        <div class="am-title">{{ viewMonth.getFullYear() }}年{{ viewMonth.getMonth() + 1 }}月</div>
      </div>
      <button class="am-nav" title="下一月" @click.stop="nextMonth">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>

    <!-- ============ 星期栏 ============ -->
    <div class="am-week">
      <span v-for="w in WEEK_LABELS" :key="w" class="am-wh">{{ w }}</span>
    </div>

    <!-- ============ 月历网格（6×7） ============ -->
    <div class="am-grid">
      <div
        v-for="(c, i) in cells"
        :key="i"
        class="am-cell"
        :class="{
          other: !c.inMonth,
          today: c.isToday,
          selected: active && active === c.key,
          festival: !!c.festival,
          solarterm: !!c.solarTerm,
        }"
        @click.stop="pickDay(c)"
      >
        <!-- 数字 + 生日/节日水印同行容器：生日优先于节日；下月补位格不显示数字与水印 -->
        <div v-if="c.inMonth" class="am-day">
          <div
            v-if="c.birthday || c.festival"
            class="am-fest-bg"
            :style="{ '--am-fest-dur': Math.max(4, Math.round((c.birthday || c.festival).length * 1.4)) + 's' }"
            aria-hidden="true"
          >
            <span class="am-fest-run">
              <span v-for="n in 4" :key="n" class="am-fest-copy">{{ c.birthday || c.festival }}</span>
            </span>
          </div>
          <div class="am-num">{{ c.day }}</div>
        </div>
        <!-- 副行优先级：生日 > 节气 > 农历月名/农历日 -->
        <div v-if="c.inMonth" class="am-below">
          <span v-if="c.birthday" class="am-tag am-tag-bd"><span class="material-symbols-outlined">cake</span>{{ c.birthday }}</span>
          <span v-else-if="c.solarTerm" class="am-tag am-tag-term">{{ c.solarTerm }}</span>
          <span v-else-if="c.lunarDay === '初一'" class="am-lunar-month">{{ c.lunarMonthText }}</span>
          <span v-else class="am-lunar">{{ c.lunarDay }}</span>
        </div>
      </div>
    </div>

    <!-- ============ 点击日期的详情弹窗（body 层浮层，不被卡片裁切） ============ -->
    <Teleport to="body">
      <Transition name="am-fade">
        <div v-if="detail" class="am-pop" @click.stop>
          <div class="am-pop-inner" @click.stop>
            <!-- 头部：农历完整干支 + 节气 + 关闭 -->
            <div class="am-pop-head">
              <div class="am-pop-title">
                <div class="am-pop-topline">
                  <span class="am-lunar-big">农历 {{ detail.lunarMonth }}月{{ detail.lunarDay }}</span>
                  <span class="am-pop-ganzhi">{{ detail.ganzhi }}</span>
                </div>
                <div class="am-pop-sub">
                  <span v-if="detail.birthday" class="am-tag am-tag-bd"><span class="material-symbols-outlined">cake</span>{{ detail.birthday }}</span>
                  <span v-if="detail.solarTerm" class="am-tag am-tag-term">{{ detail.solarTerm }}</span>
                  <span v-if="detail.festival" class="am-tag am-tag-fest">{{ detail.festival }}</span>
                  <span>{{ detail.weekCn }} · {{ detail.mdy }}</span>
                  <span v-if="detail.shengxiao">{{ detail.shengxiao }}年</span>
                  <button class="am-today-btn" @click.stop="goToday">今天</button>
                </div>
              </div>
              <button class="am-pop-close" title="关闭" @click.stop="close">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <!-- 五行 / 冲煞 / 方位（三列） -->
            <div class="am-rows">
              <div class="am-row am-row-first">
                <div class="am-row-cell">
                  <span class="am-row-lb">五行</span>
                  <span class="am-row-v">{{ detail.wuxing }}</span>
                </div>
                <div class="am-row-cell">
                  <span class="am-row-lb">冲煞</span>
                  <span class="am-row-v">{{ detail.chongSha || '—' }}</span>
                </div>
                <div class="am-row-cell">
                  <span class="am-row-lb">方位星宿</span>
                  <span class="am-row-v">{{ detail.xiu ? detail.xiu + (detail.xiuLuck || '') : '—' }}</span>
                </div>
              </div>

              <!-- 喜神 / 财神 / 描神 -->
              <div class="am-shen-row">
                <div class="am-shen-card">
                  <span class="material-symbols-outlined am-shen-icon">favorite</span>
                  <div class="am-shen-name">喜神</div>
                  <div class="am-shen-pos">{{ detail.positionXi || '—' }}</div>
                </div>
                <div class="am-shen-card">
                  <span class="material-symbols-outlined am-shen-icon">paid</span>
                  <div class="am-shen-name">财神</div>
                  <div class="am-shen-pos">{{ detail.positionCai || '—' }}</div>
                </div>
                <div class="am-shen-card">
                  <span class="material-symbols-outlined am-shen-icon">home_work</span>
                  <div class="am-shen-name">描神</div>
                  <div class="am-shen-pos">{{ detail.positionFu || '—' }}</div>
                </div>
              </div>

              <!-- 宜 / 忌 -->
              <div class="am-yiji-row">
                <div class="am-yiji am-yi">
                  <span class="am-yiji-title">宜</span>
                  <span class="am-yiji-list">{{ detail.yiText }}</span>
                </div>
                <div class="am-yiji am-ji">
                  <span class="am-yiji-title">忌</span>
                  <span class="am-yiji-list">{{ detail.jiText }}</span>
                </div>
              </div>

              <!-- 吉神 / 凶煞 / 彭祖 -->
              <div class="am-other">
                <div v-if="detail.jiShenList.length" class="am-other-row">
                  <span class="am-other-lb">吉神：</span><span>{{ detail.jiShenList.join('、') }}</span>
                </div>
                <div v-if="detail.xiongShaList.length" class="am-other-row">
                  <span class="am-other-lb">凶煞：</span><span>{{ detail.xiongShaList.join('、') }}</span>
                </div>
                <div v-if="detail.pengZu" class="am-other-row">
                  <span class="am-other-lb">彭祖：</span><span>{{ detail.pengZu }}</span>
                </div>
                <div v-if="detail.jiuXingDesc" class="am-other-row">
                  <span class="am-other-lb">九星：</span><span>{{ detail.jiuXingDesc }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Solar } from 'lunar-javascript'
import { getPrefs } from '@/utils/prefs'
import { birthdaySolarInYear, readBirthdays } from '@/utils/birthday'

// ================= 公共常量 =================
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// ================= props（CodeCard 会把 data.js 产出的 entity 覆盖值传进来；
// 不传也能用本地 lunar-javascript，entityOptional=true 就是为此） =================
const props = defineProps({
  // HA 集成覆盖：如果用户绑定了天元历法实体，data.js 会 computed 出这些字段
  yiOverride: { type: String, default: '' },
  jiOverride: { type: String, default: '' },
  jiShenOverride: { type: String, default: '' },
  xiongShaOverride: { type: String, default: '' },
  chongShaOverride: { type: String, default: '' },
  // 空槽：整段 attributes 字典（未来做更精细的覆盖时用）
  rawAttributes: { type: Object, default: () => ({}) },
})

// ================= 状态 =================
const viewMonth = ref(new Date())
const active = ref(null)        // 选中日期的 key "YYYY-MM-DD"
const detail = ref(null)        // 计算后的详情对象

// ================= 生日联动（prefs 键 birthdays，由生日卡维护） =================
const birthdays = ref([])
onMounted(async () => {
  const { data } = await getPrefs()
  birthdays.value = readBirthdays(data?.birthdays)
})
// key "YYYY-MM-DD" → 生日称呼；农历生日换算成当年/次年公历后匹配
const birthdayMap = computed(() => {
  const now = new Date()
  const map = new Map()
  for (const b of birthdays.value) {
    for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
      const s = birthdaySolarInYear(b, y)
      if (!s) continue
      const k = `${s[0]}-${pad(s[1])}-${s[2]}`
      map.set(k, map.has(k) ? `${map.get(k)}/${b.name}` : b.name)
    }
  }
  return map
})

// ================= 工具 =================
function pad(n) { return String(n).padStart(2, '0') }
function keyOf(s) { return `${s.getYear()}-${pad(s.getMonth())}-${pad(s.getDay())}` }

// 卡头：今天的农历简称（如"三月廿九"）
const lunarOfToday = computed(() => {
  const now = new Date()
  const l = Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()).getLunar()
  return `${l.getMonthInChinese()}月${l.getDayInChinese()}`
})

// 返回农历简称：初一 → 八月；日号 → 初二/十五/廿九/三十
function lunarDayLabel(s) {
  const l = s.getLunar()
  const d = l.getDayInChinese()
  if (d === '初一') return l.getMonthInChinese() + '月'
  return d
}

// ================= 月历网格（6 行 × 7 列） =================
const cells = computed(() => {
  const vm = viewMonth.value
  const y = vm.getFullYear()
  const m = vm.getMonth() + 1
  const first = Solar.fromYmd(y, m, 1)
  const startOffset = first.getWeek()    // 0=周日 ... 6=周六
  // lunar-javascript 没有 getDaysOfMonth，用原生 Date API 算（比手动算闰年/月长度可靠）
  const totalDays = new Date(y, m, 0).getDate()
  const cells = []

  // 今天
  const now = new Date()
  const todaySolar = Solar.fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate())

  // 前一月尾部
  if (startOffset > 0) {
    const prevM = m === 1 ? 12 : m - 1
    const prevY = m === 1 ? y - 1 : y
    const prevDays = new Date(prevY, prevM, 0).getDate()
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = Solar.fromYmd(prevY, prevM, prevDays - i)
      cells.push(buildCell(d, false, todaySolar))
    }
  }
  // 当月
  for (let d = 1; d <= totalDays; d++) {
    const sd = Solar.fromYmd(y, m, d)
    cells.push(buildCell(sd, true, todaySolar))
  }
  // 后一月头部，补满至 42（6 行 × 7 列）
  const remain = 42 - cells.length
  if (remain > 0) {
    let ny = y, nm = m + 1
    if (nm > 12) { ny++; nm = 1 }
    for (let d = 1; d <= remain; d++) {
      const sd = Solar.fromYmd(ny, nm, d)
      cells.push(buildCell(sd, false, todaySolar))
    }
  }
  return cells
})

function buildCell(s, inMonth, todaySolar) {
  const l = s.getLunar()
  const solarTerm = l.getCurrentJieQi() || null
  // 农历节日（春节/中秋等）优先于公历节日，再其它——水印层只流动显示一个最重要的
  const festival = [
    ...l.getFestivals(),      // 农历节日（如 春节/中秋节）
    ...s.getFestivals(),      // 公历节日（如 元旦/劳动节）
    ...s.getOtherFestivals(), // 其它公历节日
  ].filter((f) => f && f.length > 0)[0] || null
  return {
    key: keyOf(s),
    inMonth,
    day: s.getDay(),
    lunarMonth: l.getMonthInChinese(),
    lunarDay: l.getDayInChinese(),
    lunarMonthText: l.getMonthInChinese() + '月',
    lunarAbbr: lunarDayLabel(s),
    solarTerm,
    festival,
    // 生日标记（生日优先于节日水印/副行显示）
    birthday: inMonth ? (birthdayMap.value.get(keyOf(s)) || null) : null,
    isToday: keyOf(s) === keyOf(todaySolar),
  }
}

// ================= 详情（点击日期） =================
function buildDetail(s) {
  const l = s.getLunar()
  const wCn = s.getWeekInChinese()
  const ganzhi = `${l.getYearInGanZhi()}年 ${l.getMonthInGanZhi()}月 ${l.getDayInGanZhi()}日`
  // 今日宜忌（lunar-javascript 原生）；若 HA 集成覆盖了则用覆盖值
  const yiList = (props.yiOverride ? props.yiOverride.split(/[,、，]/).map(x => x.trim()).filter(Boolean) : l.getDayYi())
  const jiList = (props.jiOverride ? props.jiOverride.split(/[,、，]/).map(x => x.trim()).filter(Boolean) : l.getDayJi())
  const jiShen = (props.jiShenOverride ? props.jiShenOverride.split(/[,、，]/).map(x => x.trim()).filter(Boolean) : l.getDayJiShen())
  const xiongSha = (props.xiongShaOverride ? props.xiongShaOverride.split(/[,、，]/).map(x => x.trim()).filter(Boolean) : (l.getDayXiongSha ? l.getDayXiongSha() : []))
  const chong = l.getDayChongDesc ? l.getDayChongDesc() : ''
  const sha = l.getDaySha ? `煞${l.getDaySha()}` : ''
  const chongSha = props.chongShaOverride || (chong ? `${chong} ${sha}` : '')
  const xiu = l.getXiu ? l.getXiu() : ''
  const xiuLuck = l.getXiuLuck ? l.getXiuLuck() : ''
  // getDayNineStar() 返回对象（含 color/wuxing/judgement），模板直接取字符串
  const nineStarObj = l.getDayNineStar ? l.getDayNineStar() : null
  const jiuXing = nineStarObj ? (nineStarObj.toFullString ? nineStarObj.toFullString() : String(nineStarObj)) : ''
  // 彭祖百忌：库拆成 Gan + Zhi 两段，拼起来
  const pg = typeof l.getPengZuGan === 'function' ? l.getPengZuGan() : ''
  const pz = typeof l.getPengZuZhi === 'function' ? l.getPengZuZhi() : ''
  const pengZu = [pg, pz].filter(Boolean).join('；')
  // 五行：getDayNaYin() 返回当日纳音（如 沙中金），最接近截图"五行"位的语义
  const wuxing = l.getDayNaYin ? l.getDayNaYin() : ''
  return {
    key: keyOf(s),
    y: s.getYear(), m: s.getMonth(), d: s.getDay(),
    mdy: `${s.getYear()}年${s.getMonth()}月${s.getDay()}日`,
    weekCn: '星期' + wCn,
    lunarMonth: l.getMonthInChinese(),
    lunarDay: l.getDayInChinese(),
    ganzhi,
    shengxiao: l.getYearShengXiao ? l.getYearShengXiao() : '',
    solarTerm: l.getCurrentJieQi() || null,
    festival: ([...s.getFestivals(), ...s.getOtherFestivals(), ...l.getFestivals()].filter(Boolean)[0]) || null,
    birthday: birthdayMap.value.get(keyOf(s)) || null,
    wuxing: l.getDayWuXing ? l.getDayWuXing() : '',
    chongSha,
    xiu, xiuLuck,
    positionXi: l.getDayPositionXiDesc ? l.getDayPositionXiDesc() : '',
    positionCai: l.getDayPositionCaiDesc ? l.getDayPositionCaiDesc() : '',
    positionFu: l.getDayPositionFuDesc ? l.getDayPositionFuDesc() : '',
    yiText: yiList.join('、') || '—',
    jiText: jiList.join('、') || '—',
    jiShenList: jiShen,
    xiongShaList: xiongSha,
    pengZu,
    jiuXingDesc: jiuXing,
  }
}

function pickDay(c) {
  if (!c || !c.inMonth) return // 只能选当月（上月/下月只作填充）
  active.value = c.key
  const [y, m, d] = c.key.split('-').map(Number)
  detail.value = buildDetail(Solar.fromYmd(y, m, d))
}
function close() { active.value = null; detail.value = null }
function goToday() {
  const now = new Date()
  viewMonth.value = new Date(now.getFullYear(), now.getMonth(), 1)
  const c = cells.value.find((x) => x.isToday)
  if (c) pickDay(c)
}

function prevMonth() {
  const v = viewMonth.value
  viewMonth.value = new Date(v.getFullYear(), v.getMonth() - 1, 1)
}
function nextMonth() {
  const v = viewMonth.value
  viewMonth.value = new Date(v.getFullYear(), v.getMonth() + 1, 1)
}
// 不设 canPrev/canNext 截止 —— lunar-javascript 覆盖 1901–2101 足够

// 每月 1 号把 view 推进到有今天的月（卡首次挂载或翻月后如果要展示今日）
function syncView() {
  const now = new Date()
  viewMonth.value = new Date(now.getFullYear(), now.getMonth(), 1)
}

// ESC 关闭弹窗；点击弹窗外关闭
function onKey(e) { if (e.key === 'Escape') close() }
function onDocMouseDown(e) {
  if (!detail.value) return
  const t = e.target
  if (t && t.closest && t.closest('.am-pop-inner')) return
  if (t && t.closest && t.closest('.am-pop')) close()
}
let timer = 0
onMounted(() => {
  syncView()
  document.addEventListener('keydown', onKey)
  document.addEventListener('mousedown', onDocMouseDown)
  // 每分钟检查一次：跨天刷新视图（避免 12 点后还停留在昨天月历）
  timer = setInterval(syncView, 60000)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('mousedown', onDocMouseDown)
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.hc-almanac {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 卡壳与其他模板卡（SHELL_BASE）同一视觉体系：细边框 + 顶光渐变 + 柔和落影 */
  padding: 8px;
  box-sizing: border-box;
  color: var(--hc-text);
  font-family: inherit;
  border-radius: 14px;
  background: linear-gradient(165deg, rgb(255 255 255 / .05), rgb(255 255 255 / 0) 46%), color-mix(in srgb, var(--hc-bg2) 72%, var(--hc-bg));
  border: 1px solid var(--hc-border);
  border-width: var(--card-bw, 1px);
  box-shadow: 0 1px 3px rgb(0 0 0 / .07), 0 8px 20px -8px rgb(0 0 0 / .16);
}
/* ============ 卡头 ============ */
.am-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 1px 2px;
}
.am-nav {
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 5px;
  background: transparent; color: var(--hc-sub);
  cursor: pointer; transition: all .15s;
}
.am-nav:hover:not(:disabled) { background: color-mix(in srgb, var(--hc-color, var(--hc-primary)) 22%, transparent); color: var(--hc-color, var(--hc-primary)); }
.am-nav:disabled { opacity: .35; cursor: default; }
.am-nav .material-symbols-outlined { font-size: 16px; }
.am-head-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.am-title { font-size: 13px; font-weight: 700; color: var(--hc-text); line-height: 1.15; }
.am-sub { font-size: 10px; color: var(--hc-sub); line-height: 1.2; margin-top: 1px; }

/* ============ 星期栏 ============ */
.am-week {
  flex: none;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.am-wh {
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--hc-sub);
  padding: 1px 0;
}

/* ============ 月历网格 ============ */
.am-grid {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, 1fr);
  gap: 2px;
}
.am-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 1px 0;
  border-radius: 5px;
  cursor: pointer;
  transition: background .15s;
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
.am-cell:hover:not(.other) { background: color-mix(in srgb, var(--hc-color, var(--hc-primary)) 10%, transparent); }
.am-cell.other { color: color-mix(in srgb, var(--hc-sub) 35%, transparent); cursor: default; }
.am-cell.other:hover { background: transparent; }
.am-cell.today {
  background: color-mix(in srgb, var(--hc-color, var(--hc-primary)) 18%, transparent);
  outline: 1.5px solid var(--hc-color, var(--hc-primary));
  font-weight: 700;
}
.am-cell.selected {
  outline: 1.5px solid var(--hc-color, var(--hc-primary));
}
/* 数字行容器：横向铺满格宽（数字仍居中）→ 水印才有足够的滚动窗口，且天然以数字为中心 */
.am-day {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  line-height: 1;
  min-width: 0;
}
.am-num { position: relative; z-index: 1; font-size: 14px; line-height: 1; font-weight: 600; }
/* 节日水印流动层：从右向左无缝循环（两份拷贝 + translateX(-50%) 首尾相接）；
   时长按节日名长度自适应（--am-fest-dur），弱化透明度不干扰数字与农历阅读；
   左右渐隐 mask 让水印独立收边 → 不会误读成跨格的连续文字 */
.am-fest-bg {
  position: absolute;
  /* 窗口 = 格宽中央 70%（容器已铺满格宽）：足够看清，又以数字为中心收边 */
  inset: 0 15%;
  display: flex;
  align-items: center;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  color: var(--hc-primary);
  opacity: .38;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  text-shadow: 0 0 1px rgb(255 255 255 / .25);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
}
.am-fest-run { display: inline-flex; align-items: center; animation: am-fest-slide var(--am-fest-dur, 6s) linear infinite; will-change: transform; }
.am-fest-copy { display: inline-block; padding-right: 8px; }
/* 4 份拷贝 + 位移 -50%：短节日名总宽也足以铺满容器，任何时刻窗口内都有字经过（无缝循环） */
@keyframes am-fest-slide { from { transform: translateX(0); } to { transform: translateX(-50%); } }
/* 格子副行（农历/节日/节气）：统一限宽省略，任何文字都不撑破格子 → 行列整齐 */
.am-below { flex: none; display: flex; align-items: center; justify-content: center; max-width: 100%; overflow: hidden; }
.am-lunar { font-size: 11px; color: var(--hc-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.am-lunar-month { font-size: 11px; color: var(--hc-primary); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.am-tag {
  display: inline-flex; align-items: center; justify-content: center;
  max-width: 100%;
  padding: 0 3px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 节气标签：仅文字跟随自定义主色，无背景底色；农历月名、节日水印同跟随主色；节日标签保持 error 红语义 */
.am-tag-term { color: var(--hc-primary); }
/* 生日标记：主色底 + 白字（当日格子上的强提示，优先级高于节气/节日） */
.am-tag-bd { background: rgb(var(--hc-primary-rgb) / .85); color: #fff; }
.am-tag-bd .material-symbols-outlined { font-size: 10px; font-variation-settings: 'FILL' 1; }
.am-tag-fest { background: rgb(var(--hc-error-rgb) / .16); color: var(--hc-error); }
.am-cell.today .am-lunar-month,
.am-cell.today .am-tag-term,
.am-cell.today .am-tag-fest { color: #fff; }
.am-cell.today .am-tag-term { background: none; }
.am-cell.today .am-tag-fest { background: rgb(var(--hc-error-rgb) / .5); }

/* ============ 弹窗（body 层） ============ */
/* 弹窗配色全部走全局 --c-* 主题变量（Teleport 到 body 后卡内 --hc-* 不可用，
   但 --c-* 挂在 documentElement 上，与其他弹层组件同一体系、跟随主题切换） */
.am-pop {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgb(var(--c-background) / .55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 60px 16px;
  z-index: 2147483647;
  pointer-events: auto;
}
.am-fade-enter-active, .am-fade-leave-active { transition: opacity .18s ease; }
.am-fade-enter-from, .am-fade-leave-to { opacity: 0; }

.am-pop-inner {
  width: min(480px, 100%);
  max-height: min(80vh, 720px);
  overflow-y: auto;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 14px;
  box-shadow: 0 20px 50px rgb(0 0 0 / .5);
  padding: 16px 18px 18px;
  color: rgb(var(--c-on-surface));
  font-size: 14px;
  line-height: 1.55;
}
.am-pop-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgb(var(--c-border)); }
.am-pop-title { flex: 1 1 auto; min-width: 0; }
.am-pop-topline { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.am-lunar-big { font-size: 18px; font-weight: 700; color: rgb(var(--c-on-surface)); }
.am-pop-ganzhi { font-size: 12px; color: rgb(var(--c-muted)); font-weight: 600; }
.am-pop-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; color: rgb(var(--c-muted)); font-size: 12px; }
.am-pop-close {
  width: 26px; height: 26px; flex: none;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 6px;
  background: transparent; color: rgb(var(--c-muted)); cursor: pointer;
}
.am-pop-close:hover { background: rgb(var(--c-border)); color: rgb(var(--c-on-surface)); }

/* 网格行 */
.am-rows { display: flex; flex-direction: column; gap: 10px; }
.am-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.am-row-first { padding: 0 0 2px; }
.am-row-cell {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 8px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-surface-alt));
}
.am-row-lb { font-size: 11px; color: rgb(var(--c-faint)); font-weight: 700; letter-spacing: .04em; }
.am-row-v { font-size: 13px; color: rgb(var(--c-on-surface)); font-weight: 600; }

/* 喜神/财神/描神 */
.am-shen-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.am-shen-card {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 4px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-surface-alt));
}
.am-shen-icon { font-size: 18px; color: rgb(var(--c-warning)); }
.am-shen-name { font-size: 11px; color: rgb(var(--c-muted)); font-weight: 600; }
.am-shen-pos { font-size: 12px; color: rgb(var(--c-on-surface)); font-weight: 700; }

/* 宜/忌 */
.am-yiji-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.am-yiji {
  display: flex; gap: 8px; padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
}
.am-yiji.am-yi { background: rgb(var(--c-success) / .12); border-color: rgb(var(--c-success) / .35); }
.am-yiji.am-ji { background: rgb(var(--c-error) / .10); border-color: rgb(var(--c-error) / .30); }
.am-yiji-title { flex: none; font-size: 14px; font-weight: 700; }
.am-yiji.am-yi .am-yiji-title { color: rgb(var(--c-success)); }
.am-yiji.am-ji .am-yiji-title { color: rgb(var(--c-error)); }
.am-yiji-list { flex: 1 1 auto; min-width: 0; font-size: 13px; color: rgb(var(--c-on-surface)); line-height: 1.6; }

/* 吉神/凶煞/彭祖/九星 */
.am-other { display: flex; flex-direction: column; gap: 4px; padding: 0 2px; color: rgb(var(--c-muted)); font-size: 12px; line-height: 1.55; }
.am-other-row { word-break: break-word; }
.am-other-lb { color: rgb(var(--c-faint)); font-weight: 700; }

/* 小屏弹窗优化 */
@media (max-width: 400px) {
  .am-row, .am-shen-row, .am-yiji-row { grid-template-columns: 1fr; }
  .am-pop { padding: 30px 10px; }
}
</style>

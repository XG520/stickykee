<template>
  <div class="hc-bd">
    <!-- 列表模式（type: birthday）：所有生日 + 倒计时，点行编辑 -->
    <template v-if="mode === 'list'">
      <div class="bd-head">
        <span class="material-symbols-outlined bd-hicon">cake</span>
        <span class="bd-title">生日</span>
        <button class="bd-add" title="添加生日" @click.stop="openEdit(null)">
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>
      <div class="bd-list">
        <button v-for="r in rows" :key="r.id" class="bd-row" @click.stop="openEdit(r)">
          <span class="material-symbols-outlined bd-cal" :class="{ lunar: r.calendar === 'lunar' }">{{ r.calendar === 'lunar' ? 'brightness_4' : 'today' }}</span>
          <span class="bd-name">{{ r.name }}</span>
          <span class="bd-date">{{ r.dateText }}</span>
          <span class="bd-count" :class="{ zero: r.days === 0 }">{{ r.days === 0 ? '今天' : r.days + '天' }}</span>
        </button>
        <div v-if="!rows.length" class="bd-empty" @click.stop="openEdit(null)">
          <span class="material-symbols-outlined">cake</span>
          <span>添加第一个生日</span>
        </div>
      </div>
    </template>

    <!-- 倒计时模式（type: birthdayCountdown）：最近一个生日的大字倒计时 -->
    <template v-else>
      <div class="bd-head">
        <span class="material-symbols-outlined bd-hicon">cake</span>
        <span class="bd-title">生日倒计时</span>
        <button class="bd-add" title="添加生日" @click.stop="openEdit(null)"><span class="material-symbols-outlined">add</span></button>
      </div>
      <div v-if="next" class="bd-cd" @click.stop="openEdit(next)">
        <div class="bd-cd-name">{{ next.name }}</div>
        <div class="bd-cd-num">{{ next.days === 0 ? '今天' : next.days }}</div>
        <div class="bd-cd-unit">{{ next.days === 0 ? '祝你生日快乐' : '天后 · ' + next.dateText }}</div>
      </div>
      <div v-else class="bd-empty" @click.stop="openEdit(null)">
        <span class="material-symbols-outlined">cake</span>
        <span>添加第一个生日</span>
      </div>
    </template>

    <!-- 编辑弹窗（body 层，同日历卡弹窗体系） -->
    <Teleport to="body">
      <Transition name="bd-fade">
        <div v-if="editing" class="bd-pop" @click.self="closeEdit">
          <div class="bd-pop-inner" @click.stop>
            <div class="bd-pop-head">
              <span class="bd-pop-title">{{ editing.id ? '编辑生日' : '添加生日' }}</span>
              <button class="bd-pop-close" @click.stop="closeEdit"><span class="material-symbols-outlined">close</span></button>
            </div>
            <label class="bd-fld">
              <span>称呼</span>
              <input v-model.trim="editing.name" maxlength="12" placeholder="如：妈妈" />
            </label>
            <div class="bd-fld">
              <span>历法</span>
              <div class="bd-seg">
                <button :class="{ on: editing.calendar === 'solar' }" @click.stop="editing.calendar = 'solar'">公历</button>
                <button :class="{ on: editing.calendar === 'lunar' }" @click.stop="editing.calendar = 'lunar'">农历</button>
              </div>
            </div>
            <div class="bd-fld bd-dates">
              <span>日期</span>
              <UiSelect v-model="editing.month" class="flex-1 min-w-0" :options="monthOptions" @change="clampDay" />
              <UiSelect v-model="editing.day" class="flex-1 min-w-0" :options="dayOptions" />
            </div>
            <div class="bd-pop-actions">
              <button v-if="editing.id" class="bd-btn bd-del" @click.stop="remove">
                <span class="material-symbols-outlined">delete</span>删除
              </button>
              <span class="bd-flex"></span>
              <button class="bd-btn bd-save" @click.stop="save">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
// 生日卡 / 生日倒计时卡：共用本组件与 prefs 键 birthdays（跨端同步，随面板加载读取）。
// 点卡片行或「+」打开编辑弹窗（称呼 / 公历-农历 / 月日 / 删除）。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { nextBirthday, birthdayDateText, readBirthdays } from '@/utils/birthday'
import UiSelect from '@/components/ui/UiSelect.vue'

const props = defineProps({ mode: { type: String, default: 'list' } })

const now = ref(new Date())
const list = ref([])
let timer = null

onMounted(async () => {
  timer = setInterval(() => { now.value = new Date() }, 60000)
  const { data } = await getPrefs()
  list.value = readBirthdays(data?.birthdays)
})
onBeforeUnmount(() => clearInterval(timer))

// 按倒计时排序的行（今天生日排最前）
const rows = computed(() => {
  const out = list.value.map((b) => {
    const nb = nextBirthday(b, now.value)
    return { ...b, dateText: birthdayDateText(b), days: nb ? nb.days : 9999 }
  })
  out.sort((a, b2) => a.days - b2.days)
  return out
})
const next = computed(() => rows.value[0] || null)

// ---- 编辑弹窗 ----
const editing = ref(null)
function openEdit(b) {
  editing.value = b ? { ...b } : { id: null, name: '', calendar: 'solar', month: 1, day: 1 }
}
function closeEdit() { editing.value = null }

// 农历固定 1~30；公历按所选月份天数
const maxDay = computed(() => {
  if (!editing.value) return 31
  return editing.value.calendar === 'lunar' ? 30 : new Date(2000, editing.value.month, 0).getDate()
})
function clampDay() {
  if (editing.value && editing.value.day > maxDay.value) editing.value.day = maxDay.value
}

// 月/日下拉选项：value 必须为 number（替代原 v-model.number 的数字转换）
const monthOptions = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: i + 1 }))
const dayOptions = computed(() => Array.from({ length: maxDay.value }, (_, i) => ({ label: `${i + 1}日`, value: i + 1 })))

function save() {
  const e = editing.value
  if (!e) return
  const item = { id: e.id || Date.now().toString(36), name: e.name || '生日', calendar: e.calendar, month: e.month, day: e.day }
  list.value = e.id ? list.value.map((x) => (x.id === e.id ? item : x)) : [...list.value, item]
  // /prefs 通道只收字符串值：序列化后保存，服务端据此同步该账号的 HA 生日传感器
  putPrefs({ birthdays: JSON.stringify(list.value) }).catch(() => {})
  editing.value = null
}
function remove() {
  const e = editing.value
  if (!e?.id) return
  list.value = list.value.filter((x) => x.id !== e.id)
  putPrefs({ birthdays: JSON.stringify(list.value) }).catch(() => {})
  editing.value = null
}
</script>

<style scoped>
/* 配色全走 --hc-*（CodeCard 注入）与 --c-*（全局主题），深浅主题跟随 */
.hc-bd {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
  color: var(--hc-text);
  overflow: hidden;
}
.bd-head { display: flex; align-items: center; gap: 6px; flex: none; }
.bd-hicon { font-size: 15px; color: var(--hc-color); }
.bd-title { font-size: 12px; font-weight: 600; opacity: .85; }
.bd-add {
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border: none; border-radius: 6px;
  background: rgb(var(--hc-color-rgb, var(--hc-primary-rgb)) / .12);
  color: var(--hc-color, var(--hc-primary));
  cursor: pointer; transition: background .15s;
}
.bd-add:hover { background: rgb(var(--hc-color-rgb, var(--hc-primary-rgb)) / .2); }
.bd-add .material-symbols-outlined { font-size: 16px; }

/* ---- 列表 ---- */
.bd-list { flex: 1; display: flex; flex-direction: column; gap: 3px; overflow-y: auto; min-height: 0; }
.bd-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 7px;
  border: none; border-radius: 8px;
  background: rgb(var(--hc-bg-rgb, var(--hc-primary-rgb)) / .05);
  color: inherit; font: inherit; text-align: left;
  cursor: pointer; transition: background .15s;
  flex: none;
}
.bd-row:hover { background: rgb(var(--hc-color-rgb, var(--hc-primary-rgb)) / .1); }
.bd-cal { font-size: 13px; color: var(--hc-color, var(--hc-primary)); flex: none; }
.bd-cal.lunar { color: var(--hc-accent, var(--hc-info)); }
.bd-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bd-date { font-size: 10px; opacity: .6; margin-left: auto; flex: none; }
.bd-count {
  flex: none; min-width: 34px;
  padding: 2px 6px; border-radius: 6px;
  font-size: 11px; font-weight: 700;
  background: rgb(var(--hc-color-rgb, var(--hc-primary-rgb)) / .14);
  color: var(--hc-color, var(--hc-primary));
  text-align: center;
}
.bd-count.zero { background: var(--hc-color, var(--hc-primary)); color: #fff; }
.bd-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  border: 1px dashed var(--hc-border);
  border-radius: 10px;
  color: var(--hc-sub); font-size: 11px;
  cursor: pointer;
}
.bd-empty .material-symbols-outlined { font-size: 20px; opacity: .5; }
.bd-empty:hover { color: var(--hc-color, var(--hc-primary)); border-color: var(--hc-color, var(--hc-primary)); }

/* ---- 倒计时 ---- */
.bd-cd { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; cursor: pointer; min-height: 0; }
.bd-cd-name { font-size: 12px; font-weight: 600; opacity: .85; }
.bd-cd-num {
  font-size: 30px; font-weight: 800; line-height: 1.1;
  color: var(--hc-color, var(--hc-primary));
  font-variant-numeric: tabular-nums;
}
.bd-cd-unit { font-size: 10px; opacity: .6; }

/* ---- 编辑弹窗（--c-* 全局主题变量，body 层） ---- */
.bd-pop {
  position: fixed; inset: 0; z-index: 2000;
  background: rgb(var(--c-background) / .55);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
}
.bd-pop-inner {
  width: min(320px, 88vw);
  padding: 14px;
  border: 1px solid var(--c-border);
  border-radius: 16px;
  background: var(--c-surface);
  color: var(--c-on-surface);
  box-shadow: 0 18px 48px rgb(0 0 0 / .35);
}
.bd-pop-head { display: flex; align-items: center; margin-bottom: 10px; }
.bd-pop-title { font-size: 14px; font-weight: 700; }
.bd-pop-close {
  margin-left: auto; border: none; background: none; color: var(--c-muted);
  cursor: pointer; display: inline-flex; padding: 2px; border-radius: 6px;
}
.bd-pop-close:hover { color: var(--c-on-surface); }
.bd-pop-close .material-symbols-outlined { font-size: 18px; }
.bd-fld { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.bd-fld > span { flex: none; width: 38px; font-size: 12px; color: var(--c-muted); }
.bd-fld input {
  flex: 1; min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--c-border); border-radius: 8px;
  background: var(--c-surface-alt); color: var(--c-on-surface);
  font: inherit; font-size: 13px; outline: none;
}
.bd-fld input:focus { border-color: rgb(var(--c-primary)); }
.bd-seg { flex: 1; display: flex; gap: 4px; }
.bd-seg button {
  flex: 1; padding: 6px 0;
  border: 1px solid var(--c-border); border-radius: 8px;
  background: var(--c-surface-alt); color: var(--c-muted);
  font: inherit; font-size: 12px; cursor: pointer;
}
.bd-seg button.on { background: rgb(var(--c-primary) / .16); border-color: rgb(var(--c-primary)); color: rgb(var(--c-primary)); font-weight: 700; }
.bd-dates select {
  flex: 1; min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--c-border); border-radius: 8px;
  background: var(--c-surface-alt); color: var(--c-on-surface);
  font: inherit; font-size: 13px; outline: none;
}
.bd-pop-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.bd-flex { flex: 1; }
.bd-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 7px 14px;
  border: none; border-radius: 9px;
  font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.bd-btn .material-symbols-outlined { font-size: 15px; }
.bd-del { background: rgb(var(--c-error) / .12); color: var(--c-error); }
.bd-del:hover { background: rgb(var(--c-error) / .2); }
.bd-save { background: rgb(var(--c-primary)); color: var(--c-on-primary, #fff); }
.bd-save:hover { filter: brightness(1.08); }

/* 弹窗过渡（与日历卡 am-fade 同节奏） */
.bd-fade-enter-active, .bd-fade-leave-active { transition: opacity .18s; }
.bd-fade-enter-active .bd-pop-inner, .bd-fade-leave-active .bd-pop-inner { transition: transform .18s; }
.bd-fade-enter-from, .bd-fade-leave-to { opacity: 0; }
.bd-fade-enter-from .bd-pop-inner, .bd-fade-leave-to .bd-pop-inner { transform: scale(.96); }
</style>

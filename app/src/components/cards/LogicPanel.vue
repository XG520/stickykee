<template>
  <!-- 逻辑规则配置：ESPHome 式规则列表。
       规则 = 如果（条件组：全部/任一 + 条件行[实体/属性/操作符/值/非]）
            就（动作行：目标元素[data-vid] + 显示/隐藏/改样式/改文字）
            否则（可选动作行）。 -->
  <div class="lp-root">
    <p class="lp-tip">
      <span class="material-symbols-outlined">info</span>
      按实体状态自动控制卡片模型：满足条件执行「就」动作，不满足执行「否则」动作。规则实时生效并随卡片保存。
    </p>

    <div v-for="(rule, ri) in rules" :key="ri" class="lp-rule" :class="{ off: collapsed[ri] }">
      <!-- 规则头：折叠 / 名称 / 当前状态 / 删除 -->
      <div class="lp-rule-head" @click="toggleCollapse(ri)">
        <span class="material-symbols-outlined lp-fold">{{ collapsed[ri] ? 'chevron_right' : 'expand_more' }}</span>
        <input
          v-model="rule.name"
          class="lp-name"
          type="text"
          :placeholder="'规则 ' + (ri + 1)"
          spellcheck="false"
          @click.stop
        />
        <span v-if="hasConds(rule)" class="lp-met" :class="{ on: ruleMet(rule) }">
          {{ ruleMet(rule) ? '满足' : '不满足' }}
        </span>
        <span class="lp-spacer"></span>
        <button type="button" class="lp-icon-btn lp-danger" title="删除规则" @click.stop="removeRule(ri)">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>

      <div v-show="!collapsed[ri]" class="lp-rule-body">
        <!-- 如果：条件组 -->
        <div class="lp-sec">
          <div class="lp-sec-head">
            <span class="lp-sec-title">如果</span>
            <MiniSelect v-model="rule.if.mode" :options="MODE_OPTS" class="lp-mode" />
          </div>
          <div v-for="(row, ci) in rule.if.rows" :key="ci" class="lp-row">
            <!-- 实体选择（带搜索下拉） -->
            <div class="lp-entity">
              <button type="button" class="lp-entity-btn" :title="row.entity || '选择实体'" @click="openEntityMenu(ri, ci, $event)">
                <template v-if="row.entity">
                  <span class="lp-entity-name">{{ entityLabel(row.entity) }}</span>
                </template>
                <span v-else class="lp-entity-empty">选择实体…</span>
                <span class="material-symbols-outlined lp-caret">expand_more</span>
              </button>
            </div>
            <input
              v-model="row.attr"
              class="lp-input lp-attr"
              type="text"
              placeholder="属性(空=状态)"
              :list="'lp-attrs-' + ri + '-' + ci"
              spellcheck="false"
            />
            <datalist :id="'lp-attrs-' + ri + '-' + ci">
              <option v-for="k in attrKeys(row.entity)" :key="k" :value="k"></option>
            </datalist>
            <MiniSelect v-model="row.op" :options="COND_OPS" class="lp-op" />
            <input
              v-if="needValue(row.op)"
              v-model="row.value"
              class="lp-input lp-value"
              type="text"
              :placeholder="row.op === 'in' ? '如: on,home' : '比较值'"
              spellcheck="false"
            />
            <button
              type="button"
              class="lp-icon-btn lp-not"
              :class="{ on: row.not }"
              title="取反（非）"
              @click="row.not = !row.not"
            >非</button>
            <button type="button" class="lp-icon-btn" title="删除条件" @click="rule.if.rows.splice(ci, 1)">
              <span class="material-symbols-outlined">close</span>
            </button>
            <span v-if="row.entity" class="lp-cur" :title="'当前值：' + curValue(row)">{{ curValue(row) }}</span>
          </div>
          <button type="button" class="lp-add" @click="rule.if.rows.push(makeRow())">
            <span class="material-symbols-outlined">add</span>添加条件
          </button>
        </div>

        <!-- 就：满足时动作 -->
        <div class="lp-sec">
          <div class="lp-sec-head"><span class="lp-sec-title">就</span></div>
          <div v-for="(act, ai) in rule.then" :key="ai" class="lp-row">
            <MiniSelect v-model="act.target" :options="targetOptions" placeholder="选择模型…" class="lp-target" />
            <MiniSelect v-model="act.action" :options="RULE_ACTIONS" class="lp-action" />
            <input
              v-if="needActionValue(act.action)"
              v-model="act.value"
              class="lp-input lp-actval"
              type="text"
              :placeholder="act.action === 'css' ? '如: color:#fff; font-size:12px' : '替换文字'"
              spellcheck="false"
            />
            <button type="button" class="lp-icon-btn" title="删除动作" @click="rule.then.splice(ai, 1)">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <p v-if="!elementOptions.length" class="lp-warn">画布暂无可选模型，请先在画布左上角「添加模型」或「模型库」页添加</p>
          <button type="button" class="lp-add" :disabled="!elementOptions.length" @click="rule.then.push(makeAction(elementOptions[0]?.vid || ''))">
            <span class="material-symbols-outlined">add</span>添加动作
          </button>
        </div>

        <!-- 否则：不满足时动作（可选） -->
        <div class="lp-sec">
          <div class="lp-sec-head">
            <span class="lp-sec-title">否则</span>
            <span class="lp-spacer"></span>
            <button v-if="!rule.else.length" type="button" class="lp-add lp-add-else" @click="rule.else.push(makeAction(elementOptions[0]?.vid || ''))">
              <span class="material-symbols-outlined">add</span>添加否则动作
            </button>
          </div>
          <div v-for="(act, ai) in rule.else" :key="ai" class="lp-row">
            <MiniSelect v-model="act.target" :options="targetOptions" placeholder="选择模型…" class="lp-target" />
            <MiniSelect v-model="act.action" :options="RULE_ACTIONS" class="lp-action" />
            <input
              v-if="needActionValue(act.action)"
              v-model="act.value"
              class="lp-input lp-actval"
              type="text"
              :placeholder="act.action === 'css' ? '如: color:#fff; font-size:12px' : '替换文字'"
              spellcheck="false"
            />
            <button type="button" class="lp-icon-btn" title="删除动作" @click="rule.else.splice(ai, 1)">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <button type="button" class="lp-add-rule" @click="addRule">
      <span class="material-symbols-outlined">add</span>添加规则
    </button>

    <!-- 实体搜索下拉（fixed 遮罩捕获外部点击） -->
    <Teleport to="body">
      <div v-if="entityMenu" class="lp-menu-mask" @mousedown="closeEntityMenu">
        <div class="lp-menu" :style="menuStyle" @mousedown.stop>
          <div class="lp-menu-search">
            <span class="material-symbols-outlined">search</span>
            <input ref="menuSearchRef" v-model="entityQuery" type="text" placeholder="搜索名称或 entity_id…" />
          </div>
          <ul class="lp-menu-list">
            <li
              v-for="o in filteredEntities"
              :key="o.id"
              @click="pickEntity(o.id)"
            >
              <span class="lp-menu-name">{{ o.label }}</span>
              <span class="lp-menu-id">{{ o.id }}</span>
            </li>
            <li v-if="!filteredEntities.length" class="lp-menu-empty">没有匹配的实体</li>
          </ul>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, reactive, nextTick } from 'vue'
import { entityStates } from '@/store'
import { COND_OPS, RULE_ACTIONS, needValue, needActionValue, makeRow, makeAction, makeRule, validRows, evalWhen } from './rules'
import MiniSelect from './MiniSelect.vue'

const MODE_OPTS = [
  { value: 'all', label: '全部满足（与）' },
  { value: 'any', label: '任一满足（或）' },
]

const props = defineProps({
  // draft.rules（reactive 数组，原地修改）；draft.html（解析 data-vid 元素列表）
  rules: { type: Array, required: true },
  html: { type: String, default: '' },
})

// ---- 规则折叠（本地状态，不入库） ----
const collapsed = reactive({})
function toggleCollapse(ri) { collapsed[ri] = !collapsed[ri] }

function addRule() {
  props.rules.push(makeRule())
  collapsed[props.rules.length - 1] = false
}
function removeRule(ri) { props.rules.splice(ri, 1) }

// ---- 条件求值预览（规则头的 满足/不满足 徽标） ----
const getEntity = (id) => entityStates[id] || null
function hasConds(rule) { return validRows(rule?.if).length > 0 }
function ruleMet(rule) { return evalWhen(rule?.if, getEntity) }
function curValue(row) {
  const e = entityStates[row.entity]
  if (!e) return '—'
  const v = row.attr ? e.attributes?.[row.attr] : e.state
  return v == null || v === '' ? '—' : String(v)
}
function attrKeys(entityId) {
  const e = entityStates[entityId]
  return e?.attributes ? Object.keys(e.attributes) : []
}

// ---- 画布模型列表：从卡片 HTML 解析 [data-vid]（draft.html 与画布实时同步） ----
const elementOptions = computed(() => {
  const out = []
  if (!props.html) return out
  try {
    const doc = new DOMParser().parseFromString(props.html, 'text/html')
    doc.querySelectorAll('[data-vid]').forEach((el) => {
      const vid = el.getAttribute('data-vid')
      if (!vid) return
      const tag = el.tagName.toLowerCase()
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 12)
      out.push({ vid, label: t ? tag + ' · ' + t : tag })
    })
  } catch { /* 非法 HTML 时给空列表 */ }
  return out
})
const targetOptions = computed(() => elementOptions.value.map((el) => ({ value: el.vid, label: el.label })))

// ---- 实体选择下拉（全量实体，搜索过滤） ----
const entityMenu = ref(null) // { ri, ci, rect }
const entityQuery = ref('')
const menuSearchRef = ref(null)
const allEntities = computed(() =>
  Object.values(entityStates)
    .map((e) => ({ id: e.entity_id, label: e.friendly_name || e.entity_id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh')),
)
const filteredEntities = computed(() => {
  const q = entityQuery.value.trim().toLowerCase()
  const list = allEntities.value
  if (!q) return list.slice(0, 200)
  return list.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)).slice(0, 200)
})
const menuStyle = computed(() => {
  const r = entityMenu.value?.rect
  if (!r) return {}
  const top = Math.min(r.bottom + 4, window.innerHeight - 320)
  const left = Math.min(r.left, window.innerWidth - 300)
  return { top: top + 'px', left: left + 'px' }
})
function entityLabel(id) {
  return entityStates[id]?.friendly_name || id
}
function openEntityMenu(ri, ci, ev) {
  const rect = ev?.currentTarget?.getBoundingClientRect?.() || null
  entityMenu.value = { ri, ci, rect }
  entityQuery.value = ''
  nextTick(() => menuSearchRef.value?.focus())
}
function closeEntityMenu() { entityMenu.value = null }
function pickEntity(id) {
  const m = entityMenu.value
  if (!m) return
  const row = props.rules[m.ri]?.if?.rows?.[m.ci]
  if (row) row.entity = id
  closeEntityMenu()
}
</script>

<style scoped>
/* ================= 逻辑面板（配色统一走主题变量，随主题切换） ================= */
.lp-root { display: flex; flex-direction: column; gap: 10px; padding: 12px; font-size: 12px; color: rgb(var(--c-muted)); }
.lp-tip {
  display: flex; gap: 6px; align-items: flex-start;
  margin: 0; padding: 8px 10px; border-radius: 8px;
  background: rgb(var(--c-info) / 0.08); border: 1px solid rgb(var(--c-info) / 0.2);
  font-size: 11px; line-height: 1.5; color: rgb(var(--c-info));
}
.lp-tip .material-symbols-outlined { font-size: 14px; flex: none; margin-top: 1px; }

/* 规则卡片 */
.lp-rule { border: 1px solid rgb(var(--c-border)); border-radius: 10px; background: rgb(var(--c-on-surface) / 0.02); overflow: hidden; }
.lp-rule-head { display: flex; align-items: center; gap: 6px; padding: 7px 9px; cursor: pointer; user-select: none; }
.lp-rule-head:hover { background: rgb(var(--c-on-surface) / 0.03); }
.lp-fold { font-size: 18px; color: rgb(var(--c-muted)); flex: none; }
.lp-name {
  flex: 1; min-width: 0; height: 26px; padding: 0 8px; border-radius: 6px;
  background: transparent; border: 1px solid transparent;
  color: rgb(var(--c-on-background)); font-size: 12px; font-weight: 600; outline: none;
}
.lp-name:hover, .lp-name:focus { border-color: rgb(var(--c-border)); background: rgba(0, 0, 0, 0.2); }
.lp-met {
  flex: none; padding: 1px 7px; border-radius: 99px; font-size: 10px;
  background: rgb(var(--c-muted) / 0.14); color: rgb(var(--c-muted)); border: 1px solid rgb(var(--c-muted) / 0.25);
}
.lp-met.on { background: rgb(var(--c-accent) / 0.14); color: rgb(var(--c-accent)); border-color: rgb(var(--c-accent) / 0.35); }
.lp-spacer { flex: 1; }
.lp-rule-body { padding: 4px 9px 10px; display: flex; flex-direction: column; gap: 10px; }

/* 分区：如果 / 就 / 否则 */
.lp-sec { display: flex; flex-direction: column; gap: 6px; }
.lp-sec-head { display: flex; align-items: center; gap: 8px; }
.lp-sec-title { font-size: 11px; font-weight: 700; color: rgb(var(--c-primary)); letter-spacing: 0.06em; }

/* 行：条件行 / 动作行 */
.lp-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.lp-input {
  height: 28px; padding: 0 7px; border-radius: 6px; font-size: 11.5px;
  background: rgba(0, 0, 0, 0.25); border: 1px solid rgb(var(--c-border)); color: rgb(var(--c-on-background)); outline: none;
  min-width: 0;
}
.lp-input:focus { border-color: rgb(var(--c-primary) / 0.5); }
/* 下拉统一走 MiniSelect（暗色样式），宽度由下面几个类控制 */
.lp-mode { width: 118px; }
.lp-attr { width: 96px; }
.lp-op { width: 108px; }
.lp-value { flex: 1; min-width: 64px; }
.lp-target { flex: 1; min-width: 100px; max-width: 160px; }
.lp-action { width: 86px; }
.lp-actval { flex: 1; min-width: 90px; }

/* 实体按钮 */
.lp-entity { flex: 1; min-width: 110px; }
.lp-entity-btn {
  width: 100%; height: 28px; padding: 0 7px; border-radius: 6px;
  display: flex; align-items: center; gap: 5px;
  background: rgba(0, 0, 0, 0.25); border: 1px solid rgb(var(--c-border)); color: rgb(var(--c-on-background));
  font-size: 11.5px; cursor: pointer; text-align: left;
}
.lp-entity-btn:hover { border-color: rgb(var(--c-primary) / 0.4); }
.lp-entity-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lp-entity-empty { flex: 1; color: rgb(var(--c-muted)); }
.lp-caret { font-size: 16px; color: rgb(var(--c-muted)); flex: none; }
.lp-cur { flex: none; max-width: 74px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: rgb(var(--c-accent)); }

/* 小图标按钮 / 非 开关 */
.lp-icon-btn {
  flex: none; width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent; color: rgb(var(--c-muted)); cursor: pointer;
  font-size: 11px; font-weight: 700;
}
.lp-icon-btn .material-symbols-outlined { font-size: 15px; }
.lp-icon-btn:hover { background: rgb(var(--c-on-surface) / 0.07); color: rgb(var(--c-on-background)); }
.lp-not.on { background: rgb(var(--c-primary) / 0.2); border-color: rgb(var(--c-primary) / 0.4); color: rgb(var(--c-primary)); }
.lp-danger:hover { background: rgb(var(--c-error) / 0.18); color: rgb(var(--c-error)); }

/* 添加行 / 添加规则 */
.lp-add {
  align-self: flex-start; height: 26px; padding: 0 9px; border-radius: 6px;
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: 1px dashed rgb(var(--c-border)); color: rgb(var(--c-muted));
  font-size: 11px; cursor: pointer;
}
.lp-add .material-symbols-outlined { font-size: 14px; }
.lp-add:hover:not(:disabled) { border-color: rgb(var(--c-primary) / 0.45); color: rgb(var(--c-primary)); }
.lp-add:disabled { opacity: 0.4; cursor: not-allowed; }
.lp-add-else { margin-left: auto; }
.lp-add-rule {
  height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; gap: 5px;
  background: rgb(var(--c-primary) / 0.1); border: 1px dashed rgb(var(--c-primary) / 0.35); color: rgb(var(--c-primary));
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.lp-add-rule:hover { background: rgb(var(--c-primary) / 0.18); }
.lp-warn { margin: 0; font-size: 10.5px; color: rgb(var(--c-warning)); }

/* 实体搜索下拉菜单 */
.lp-menu-mask { position: fixed; inset: 0; z-index: 100; }
.lp-menu {
  position: fixed; width: 288px; max-height: 320px;
  display: flex; flex-direction: column;
  background: rgb(var(--c-surface-alt)); border: 1px solid rgb(var(--c-border)); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); overflow: hidden;
}
.lp-menu-search { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgb(var(--c-border)); }
.lp-menu-search .material-symbols-outlined { font-size: 16px; color: rgb(var(--c-muted)); }
.lp-menu-search input { flex: 1; background: transparent; border: none; outline: none; color: rgb(var(--c-on-background)); font-size: 12px; }
.lp-menu-list { flex: 1; overflow-y: auto; margin: 0; padding: 4px; list-style: none; }
.lp-menu-list li { display: flex; flex-direction: column; gap: 1px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.lp-menu-list li:hover { background: rgb(var(--c-primary) / 0.12); }
.lp-menu-name { font-size: 12px; color: rgb(var(--c-on-background)); }
.lp-menu-id { font-size: 10px; color: rgb(var(--c-muted)); font-family: ui-monospace, monospace; }
.lp-menu-empty { padding: 14px; text-align: center; color: rgb(var(--c-muted)); font-size: 11px; cursor: default; }
</style>

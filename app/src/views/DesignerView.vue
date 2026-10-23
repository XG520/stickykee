<template>
  <div class="hc-dv">
    <!-- 模板画廊（新建模式首屏）；uid 编辑模式跳过画廊直接进编辑器 -->
    <TemplateGallery
      v-if="mode === 'gallery'"
      @apply="onApplyTemplate"
      @blank="onBlank"
      @user="onUserTemplate"
      @close="router.push('/')"
    />
    <!-- 画布编辑器：uid 模式需先从布局里读出卡片（schema/代码），就绪后再挂设计器 -->
    <Designer
      v-else-if="ready"
      v-model="open"
      :initial-schema="initialSchema"
      :initial-code="initialCode"
      :initial-tab="initialTab"
      :save-label="editUid ? '保存到卡片' : '保存'"
      @save="onSave"
    />

    <!-- 保存弹窗：给设计产物取名 + 选尺寸，落成「我的模板」（仅模板模式） -->
    <Teleport to="body">
      <div v-if="saveOpen" class="hc-dv-mask" @click.self="closeSave">
        <div class="hc-dv-dialog">
          <h3>保存为我的模板</h3>
          <p class="hc-dv-sub">保存后可在「添加卡片 → 我的模板」中直接使用，不限次数。</p>
          <label class="hc-dv-field">
            <span>模板名称</span>
            <input v-model="name" maxlength="16" placeholder="例如：客厅环境卡" @keydown.enter="doSave" />
          </label>
          <div class="hc-dv-size">
            <label class="hc-dv-field">
              <span>宽（列）</span>
              <select v-model.number="w">
                <option v-for="n in 4" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
            <label class="hc-dv-field">
              <span>高（行）</span>
              <select v-model.number="h">
                <option v-for="n in 4" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
          </div>
          <div class="hc-dv-actions">
            <button class="hc-dv-btn" @click="closeSave">取消</button>
            <button class="hc-dv-btn hc-dv-btn-primary" :disabled="!name.trim() || saving" @click="doSave">
              {{ saving ? '保存中…' : '保存模板' }}
            </button>
          </div>
          <p v-if="errMsg" class="hc-dv-err">{{ errMsg }}</p>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Designer from '@/components/cards/designer/Designer.vue'
import TemplateGallery from '@/components/cards/designer/TemplateGallery.vue'
import { createEmptySchema } from '@/components/cards/designer/elementDefs'
import { designerStore } from '@/composables/designerStore'
import { saveAsTemplate } from '@/composables/useCustomTemplates'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { LAYOUT_KEY_WEB, layoutKeyFor, migrateDashboard, serializeDashboard } from '@/utils/dashboard'
import { getDeviceId } from '@/utils/device'
import { isApk } from '@/utils/serverConfig'
import { dashboardRev } from '@/store'

const router = useRouter()
const route = useRoute()

// ?uid=xxx：编辑主页上已有的卡片（设计器的「编辑卡片」模式）；否则为「新建模板」模式
const editUid = route.query.uid || ''

const blank = () => createEmptySchema()

// 三态：gallery（模板画廊，新建模式首屏）/ edit（画布编辑器）
const mode = ref(editUid ? 'edit' : 'gallery')
const initialTab = ref('props') // 画廊「AI 设计」入口进入时切到 AI tab

const ready = ref(false)
const initialSchema = ref(blank())
const initialCode = ref(null) // 既有代码（uid 模式；html/css 手改过才载入，未手改为 null 跟随生成物）
let editingCard = null // uid 模式下布局里找到的卡片对象引用（migrate 后的树）

onMounted(async () => {
  if (!editUid) { ready.value = true; return }
  try {
    const dashKey = isApk ? layoutKeyFor(getDeviceId()) : LAYOUT_KEY_WEB
    const { data } = await getPrefs({ force: true })
    const raw = data?.[dashKey]
    if (raw) {
      const r = migrateDashboard(JSON.parse(raw))
      for (const p of r.pages || []) {
        for (const c of p.cards || []) {
          if (c.uid === editUid) { editingCard = c; break }
        }
        if (editingCard) break
      }
    }
    if (editingCard) {
      const s = editingCard._designerSchema
      // v2 自由画布 schema：恢复元素；v1 积木/纯代码卡：空画布起步（走代码模式）
      initialSchema.value = s && s.version === 2 ? JSON.parse(JSON.stringify(s)) : blank()
      // 手改检测（与 CodeCard 同规则）：html 与编译产物不同才算手改，否则 null 跟随生成物
      const handHtml = editingCard.html && editingCard.compiledHtml && editingCard.html !== editingCard.compiledHtml
        ? editingCard.html : null
      initialCode.value = { html: handHtml, css: editingCard.css || null, js: editingCard.js || '' }
    }
  } catch { /* 读取失败：按空白起步 */ }
  ready.value = true
})

// 路由进入即打开设计器；关闭设计器（返回）时：uid 模式回首页，新建模式回画廊
const open = ref(true)
watch(open, (v) => {
  if (v || saveOpen.value) return
  if (editUid) router.push('/')
  else mode.value = 'gallery'
})

// —— 画廊事件 ——
// 套用精品模板（已完成实体角色绑定，roleMap 可为空=稍后再绑）
function onApplyTemplate({ tpl, roleMap }) {
  initialSchema.value = null
  initialCode.value = null
  initialTab.value = 'props'
  designerStore.applyTemplate(tpl, roleMap || {})
  open.value = true
  mode.value = 'edit'
}
// 空白画布（withAi 时直接打开 AI 面板）
function onBlank(withAi) {
  initialSchema.value = null
  initialCode.value = null
  initialTab.value = withAi ? 'ai' : 'props'
  designerStore.newEmpty()
  open.value = true
  mode.value = 'edit'
}
// 我的模板（实体已固化在 schema，直接载入）
function onUserTemplate(t) {
  initialSchema.value = null
  initialCode.value = null
  initialTab.value = 'props'
  designerStore.loadSchema(t.schema)
  designerStore.state.tplMeta = { id: t.id, name: t.name, icon: t.icon, grid: t.grid, roles: t.roles || [] }
  open.value = true
  mode.value = 'edit'
}

const saveOpen = ref(false)
const saving = ref(false)
const errMsg = ref('')
const name = ref('')
const w = ref(2)
const h = ref(2)
let payload = null

function onSave(p) {
  payload = p
  if (editUid) { saveToCard(); return }
  errMsg.value = ''
  // 套用模板来的设计：预填模板名与格数，少一步输入
  const meta = designerStore.state.tplMeta
  if (meta) {
    name.value = name.value || meta.name || ''
    w.value = meta.grid?.w || w.value
    h.value = meta.grid?.h || h.value
  }
  saveOpen.value = true
}

// uid 模式：直接回写布局里的卡片并落库（不弹模板弹窗）
async function saveToCard() {
  if (!payload) return
  saving.value = true
  try {
    const dashKey = isApk ? layoutKeyFor(getDeviceId()) : LAYOUT_KEY_WEB
    const { data } = await getPrefs({ force: true })
    const raw = data?.[dashKey]
    if (!raw) throw new Error('no layout')
    const r = migrateDashboard(JSON.parse(raw))
    let target = null
    for (const pg of r.pages || []) {
      for (const c of pg.cards || []) {
        if (c.uid === editUid) { target = c; break }
      }
      if (target) break
    }
    if (!target) {
      alert('未找到该卡片（可能已被删除），请返回主页重试')
      router.push('/')
      return
    }
    target.html = payload.html || ''
    target.css = payload.css || ''
    target.js = payload.js || ''
    target._designerSchema = payload.schema ? JSON.parse(JSON.stringify(payload.schema)) : null
    target.compiledHtml = payload.compiledHtml || ''
    target.entitySlotMap = payload.entitySlotMap && Object.keys(payload.entitySlotMap).length
      ? JSON.parse(JSON.stringify(payload.entitySlotMap))
      : {}
    target._roles = payload.roles || null
    await putPrefs({ [dashKey]: serializeDashboard(r.pages) })
    dashboardRev.value++ // 触发主页热重载，回到首页即见新卡片
    router.push('/')
  } catch {
    alert('保存失败，请检查网络后重试')
  } finally {
    saving.value = false
  }
}

// 放弃保存：设计器已关闭，直接回首页，避免停在空白页
function closeSave() {
  saveOpen.value = false
  router.push('/')
}

async function doSave() {
  const tplName = name.value.trim()
  if (!tplName || !payload) return
  saving.value = true
  errMsg.value = ''
  try {
    const res = await saveAsTemplate(
      {
        html: payload.html || payload.compiledHtml || '',
        css: payload.css || '',
        js: payload.js || '',
        w: w.value,
        h: h.value,
        icon: 'dashboard_customize',
        _designerSchema: payload.schema || null,
        compiledHtml: payload.compiledHtml || '',
        entitySlotMap: payload.entitySlotMap || {},
        _roles: payload.roles || null,
      },
      { name: tplName, icon: 'dashboard_customize' },
    )
    if (res.err) {
      errMsg.value = res.err === 'limit' ? (res.msg || '模板数量已达上限') : '保存失败，请检查画布是否为空'
      return
    }
    saveOpen.value = false
    alert(`模板「${tplName}」已保存，可在添加卡片的「我的模板」中使用`)
    router.push('/')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.hc-dv { width: 100%; height: 100vh; }
.hc-dv-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgb(0 0 0 / .5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hc-dv-dialog {
  width: min(92vw, 360px);
  padding: 18px;
  border-radius: 14px;
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  border: 1px solid rgb(var(--c-border));
  box-shadow: 0 12px 40px rgb(0 0 0 / .35);
}
.hc-dv-dialog h3 { font-size: 15px; font-weight: 700; margin: 0 0 4px; }
.hc-dv-sub { font-size: 11px; color: rgb(var(--c-muted)); margin: 0 0 14px; line-height: 1.5; }
.hc-dv-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: rgb(var(--c-muted)); margin-bottom: 12px; }
.hc-dv-field input, .hc-dv-field select {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
  font-size: 13px;
  outline: none;
}
.hc-dv-field input:focus, .hc-dv-field select:focus { border-color: var(--hc-color, var(--hc-primary)); }
.hc-dv-size { display: flex; gap: 10px; }
.hc-dv-size .hc-dv-field { flex: 1; }
.hc-dv-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.hc-dv-btn {
  padding: 7px 14px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: transparent;
  color: rgb(var(--c-on-surface));
  cursor: pointer;
}
.hc-dv-btn-primary {
  background: var(--hc-color, var(--hc-primary));
  border-color: var(--hc-color, var(--hc-primary));
  color: #000;
  font-weight: 600;
}
.hc-dv-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.hc-dv-err { margin: 10px 0 0; font-size: 11px; color: rgb(var(--c-error)); }
</style>

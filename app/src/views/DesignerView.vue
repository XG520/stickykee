<template>
  <div class="hc-dv">
    <Designer v-model="open" :initial-schema="blankSchema" @save="onSave" />

    <!-- 保存弹窗：给设计产物取名 + 选尺寸，落成「我的模板」 -->
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
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Designer from '@/components/cards/designer/Designer.vue'
import { makeBlockId } from '@/components/cards/designer/blockDefs'
import { saveAsTemplate } from '@/composables/useCustomTemplates'

const router = useRouter()

// 每次进入设计器都从空白画布起步（设计器 store 是模块级单例，避免带上一次的设计）
const blankSchema = { id: makeBlockId(), defType: 'slot_root', props: { padding: 8, gap: 4 }, children: [] }

// 路由进入即打开设计器；关闭设计器（返回）时回到首页
const open = ref(true)
watch(open, (v) => {
  if (!v && !saveOpen.value) router.push('/')
})

const saveOpen = ref(false)
const saving = ref(false)
const errMsg = ref('')
const name = ref('')
const w = ref(2)
const h = ref(2)
let payload = null

function onSave(p) {
  payload = p
  errMsg.value = ''
  saveOpen.value = true
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
        html: payload.compiledHtml || '',
        css: payload.css || '',
        js: '',
        w: w.value,
        h: h.value,
        icon: 'dashboard_customize',
        _designerSchema: payload.schema || null,
        compiledHtml: payload.compiledHtml || '',
        entitySlotMap: payload.entitySlotMap || {},
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

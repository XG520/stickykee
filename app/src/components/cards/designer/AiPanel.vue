<template>
  <div class="hc-ds-panel hc-ai-panel">
    <!-- 描述输入 -->
    <div class="hc-ai-block">
      <div class="hc-ai-label">描述你想要的卡片</div>
      <textarea
        v-model="prompt"
        class="hc-ai-textarea"
        rows="4"
        placeholder="例：一张客厅灯卡片，左侧大灯图标，中间显示灯名和开关状态，右下角一个开关按钮；深色背景圆角。"
      ></textarea>
    </div>

    <!-- 实体勾选（注入上下文，供模型绑定 entity/button） -->
    <div class="hc-ai-block">
      <div class="hc-ai-label">
        <span>可用实体（已选 {{ picked.length }}）</span>
        <input v-model="entityFilter" class="hc-ai-filter" placeholder="搜索实体…" />
      </div>
      <div class="hc-ai-entities">
        <label v-for="e in filteredEntities" :key="e.id" class="hc-ai-entity">
          <input type="checkbox" :value="e.id" v-model="picked" />
          <span class="hc-ai-entity-name">{{ e.name }}</span>
          <span class="hc-ai-entity-id">{{ e.id }}</span>
        </label>
        <div v-if="!filteredEntities.length" class="hc-ai-empty">无匹配实体</div>
      </div>
    </div>

    <!-- 生成 -->
    <button class="hc-ai-gen" :disabled="generating || !prompt.trim()" @click="onGenerate">
      <span class="material-symbols-outlined" :class="{ 'hc-ai-spin': generating }">
        {{ generating ? 'progress_activity' : 'auto_awesome' }}
      </span>
      {{ generating ? 'AI 设计中…' : '生成设计' }}
    </button>
    <div v-if="error" class="hc-ai-error">{{ error }}</div>
    <div v-if="notice" class="hc-ai-notice">{{ notice }}</div>

    <!-- AI 设置 -->
    <div class="hc-ai-settings">
      <button class="hc-ai-settings-toggle" @click="showSettings = !showSettings">
        <span class="material-symbols-outlined">settings</span>
        <span>AI 设置</span>
        <span class="hc-ai-settings-state" :class="{ on: cfgReady }">{{ cfgReady ? '已配置' : '未配置' }}</span>
        <span class="material-symbols-outlined hc-ai-caret">{{ showSettings ? 'expand_less' : 'expand_more' }}</span>
      </button>
      <div v-if="showSettings" class="hc-ai-settings-body">
        <label class="hc-ai-field">
          <span>Base URL</span>
          <input v-model.trim="cfg.base_url" placeholder="https://api.openai.com/v1" />
        </label>
        <label class="hc-ai-field">
          <span>API Key{{ cfg.has_key ? '（已保存，留空不修改）' : '' }}</span>
          <input v-model.trim="cfg.api_key" type="password" placeholder="sk-..." autocomplete="off" />
        </label>
        <label class="hc-ai-field">
          <span>模型名称</span>
          <input v-model.trim="cfg.model" placeholder="gpt-4o-mini" />
        </label>
        <button class="hc-ai-save" :disabled="saving" @click="onSaveCfg">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '@/api'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { entityStates } from '@/store'
import { designerStore } from '@/composables/designerStore'
import { buildSystemPrompt, parseAiSchema } from './aiPrompt'

const prompt = ref('')
const picked = ref([])
const entityFilter = ref('')
const generating = ref(false)
const error = ref('')
const notice = ref('')

// —— 实体清单（id + 名称） ——
const allEntities = computed(() =>
  Object.values(entityStates)
    .map((e) => ({ id: e.entity_id, name: e.friendly_name || e.entity_id }))
    .sort((a, b) => a.id.localeCompare(b.id)),
)
const filteredEntities = computed(() => {
  const q = entityFilter.value.trim().toLowerCase()
  if (!q) return allEntities.value.slice(0, 80)
  return allEntities.value.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)).slice(0, 80)
})

// —— AI 设置 ——
const showSettings = ref(false)
const saving = ref(false)
const cfg = reactive({ base_url: '', api_key: '', model: '', has_key: false })
const cfgReady = computed(() => cfg.has_key && !!cfg.model)

onMounted(async () => {
  const { data } = await getPrefs()
  try {
    const saved = JSON.parse(data?.ai_config || '{}')
    cfg.base_url = saved.base_url || ''
    cfg.model = saved.model || ''
    cfg.has_key = !!saved.has_key
  } catch { /* 忽略坏数据 */ }
  if (!cfgReady.value) showSettings.value = true
})

async function onSaveCfg() {
  saving.value = true
  error.value = ''
  try {
    await putPrefs({
      ai_config: JSON.stringify({ base_url: cfg.base_url, model: cfg.model, api_key: cfg.api_key }),
    })
    if (cfg.api_key) cfg.has_key = true
    cfg.api_key = ''
    notice.value = 'AI 设置已保存'
    setTimeout(() => (notice.value = ''), 2000)
  } catch {
    error.value = '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

// —— 生成 ——
async function onGenerate() {
  if (generating.value) return
  generating.value = true
  error.value = ''
  notice.value = ''
  try {
    const canvas = designerStore.state.schema?.canvas || { w: 480, h: 240 }
    const hints = picked.value
      .map((id) => `${id} → ${entityStates[id]?.friendly_name || id}`)
      .join('\n')
    const messages = [
      { role: 'system', content: buildSystemPrompt(canvas, hints) },
      { role: 'user', content: prompt.value.trim() },
    ]
    const res = await api.aiChat(messages)
    const text = res?.data?.choices?.[0]?.message?.content || ''
    const schema = parseAiSchema(text, canvas)
    designerStore.loadSchema(schema)
    notice.value = `已生成 ${schema.elements.length} 个元素，可在画布继续调整`
  } catch (e) {
    error.value = e?.message || '生成失败，请检查 AI 设置与网络'
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.hc-ai-panel { gap: 12px; }
.hc-ai-block { display: flex; flex-direction: column; gap: 6px; }
.hc-ai-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  text-transform: uppercase;
  letter-spacing: .04em;
}
.hc-ai-textarea {
  width: 100%;
  resize: vertical;
  min-height: 72px;
  font-size: 11px;
  line-height: 1.5;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  outline: none;
  font-family: inherit;
}
.hc-ai-textarea:focus { border-color: var(--hc-color, var(--hc-primary)); }
.hc-ai-filter {
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  outline: none;
  width: 110px;
  text-transform: none;
}
.hc-ai-entities {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-surface));
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.hc-ai-entity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
}
.hc-ai-entity:hover { background: rgb(var(--c-surface-alt)); }
.hc-ai-entity input { accent-color: var(--hc-color, var(--hc-primary)); }
.hc-ai-entity-name {
  color: rgb(var(--c-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hc-ai-entity-id {
  margin-left: auto;
  font-size: 9px;
  color: rgb(var(--c-muted));
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 45%;
}
.hc-ai-empty { padding: 12px; text-align: center; font-size: 10px; color: rgb(var(--c-muted)); }
.hc-ai-gen {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  background: var(--hc-color, var(--hc-primary));
  transition: opacity .15s;
}
.hc-ai-gen:disabled { opacity: .5; cursor: not-allowed; }
.hc-ai-gen .material-symbols-outlined { font-size: 16px; }
.hc-ai-spin { animation: hc-ai-rot 1s linear infinite; }
@keyframes hc-ai-rot { to { transform: rotate(360deg); } }
.hc-ai-error {
  font-size: 10px;
  color: rgb(var(--c-error));
  background: rgb(var(--c-error) / .1);
  border-radius: 6px;
  padding: 6px 8px;
  word-break: break-all;
}
.hc-ai-notice {
  font-size: 10px;
  color: rgb(var(--c-success, 46 160 67));
  background: rgb(var(--c-success, 46 160 67) / .1);
  border-radius: 6px;
  padding: 6px 8px;
}
.hc-ai-settings { margin-top: auto; border-top: 1px dashed rgb(var(--c-border)); padding-top: 8px; }
.hc-ai-settings-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  padding: 4px 2px;
}
.hc-ai-settings-toggle .material-symbols-outlined { font-size: 16px; }
.hc-ai-caret { margin-left: auto; }
.hc-ai-settings-state {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 99px;
  background: rgb(var(--c-error) / .12);
  color: rgb(var(--c-error));
}
.hc-ai-settings-state.on { background: rgb(var(--c-success, 46 160 67) / .12); color: rgb(var(--c-success, 46 160 67)); }
.hc-ai-settings-body { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
.hc-ai-field { display: flex; flex-direction: column; gap: 3px; }
.hc-ai-field span { font-size: 9px; font-weight: 600; color: rgb(var(--c-muted)); text-transform: uppercase; }
.hc-ai-field input {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-ai-field input:focus { border-color: var(--hc-color, var(--hc-primary)); }
.hc-ai-save {
  padding: 7px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 6px;
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  font-size: 11px;
  cursor: pointer;
}
.hc-ai-save:hover { border-color: var(--hc-color, var(--hc-primary)); }
</style>

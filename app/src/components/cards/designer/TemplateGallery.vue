<template>
  <div class="hc-tg">
    <!-- 画廊顶栏 -->
    <header class="hc-tg-header">
      <button class="hc-tg-back" @click="$emit('close')">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="hc-tg-headtxt">
        <div class="hc-tg-title">选择模板开始设计</div>
        <div class="hc-tg-sub">选中模板 → 绑定实体 → 进入画布微调，也可以从空白画布或 AI 开始</div>
      </div>
      <button class="hc-tg-ai" @click="$emit('blank', 'ai')">
        <span class="material-symbols-outlined">auto_awesome</span> AI 设计
      </button>
      <button class="hc-tg-blank" @click="$emit('blank')">
        <span class="material-symbols-outlined">add</span> 空白画布
      </button>
    </header>

    <!-- 分类筛选 -->
    <nav class="hc-tg-cats">
      <button
        v-for="c in categories"
        :key="c"
        class="hc-tg-cat"
        :class="{ 'is-on': cat === c }"
        @click="cat = c"
      >{{ c }}</button>
    </nav>

    <!-- 模板网格 -->
    <div class="hc-tg-grid-wrap">
      <div class="hc-tg-grid">
        <button
          v-for="t in shown"
          :key="t.id"
          class="hc-tg-card"
          @click="onPick(t)"
        >
          <span class="hc-tg-thumb" :style="{ height: thumbH(t) + 'px' }">
            <span class="hc-tg-scale" :style="thumbStyle(t)" v-html="thumbOf(t)"></span>
          </span>
          <span class="hc-tg-card-meta">
            <span class="material-symbols-outlined">{{ t.icon }}</span>
            <span class="hc-tg-card-name">{{ t.name }}</span>
            <span class="hc-tg-card-grid">{{ t.grid.w }}×{{ t.grid.h }}</span>
          </span>
        </button>
        <div v-if="!shown.length" class="hc-tg-empty">
          <span class="material-symbols-outlined">inventory_2</span>
          <span>该分类下还没有模板</span>
        </div>
      </div>
    </div>

    <!-- 实体绑定弹窗 -->
    <RoleBindDialog
      v-if="binding"
      :template="binding"
      @confirm="onBindConfirm"
      @skip="onBindSkip"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { TEMPLATE_CATALOG, TEMPLATE_CATEGORIES, normalizeTemplateSchema, ensureDesignerCss } from './templates/catalog'
import { buildMockEntities, mockBoundSchema } from './templates/mockEntities'
import { renderElementsToHtml } from './elementDefs'
import { allTemplates } from '@/composables/useCustomTemplates'
import RoleBindDialog from './RoleBindDialog.vue'

const emit = defineEmits(['apply', 'blank', 'user', 'close'])

const cat = ref('全部')
const binding = ref(null) // 正在绑定实体的模板
const THUMB_W = 222 // 缩略图渲染宽度（网格卡片内容宽：240 列宽 - 内边距与边框）

const categories = TEMPLATE_CATEGORIES

// 用户自制模板（有 v2 schema 的才能在画廊里直接套用）
const userTpls = computed(() =>
  allTemplates()
    .filter((t) => t._designerSchema?.version === 2)
    .map((t) => ({
      id: t.id,
      name: t.name,
      icon: t.icon || 'dashboard_customize',
      category: '我的模板',
      grid: { w: t.w || 2, h: t.h || 2 },
      roles: Array.isArray(t._roles) ? t._roles : [],
      schema: t._designerSchema,
      __user: t,
    })),
)

const shown = computed(() => {
  if (cat.value === '我的模板') return userTpls.value
  const mine = cat.value === '全部' ? userTpls.value : []
  const builtin = TEMPLATE_CATALOG.filter((t) => cat.value === '全部' || t.category === cat.value)
  return [...builtin, ...mine]
})

// 全部缩略图一次算好（静态 mock 数据，无需响应式）
const thumbs = {}
function thumbOf(t) {
  if (thumbs[t.id]) return thumbs[t.id]
  const schema = normalizeTemplateSchema(mockBoundSchema(t))
  const entities = buildMockEntities(t)
  // 用户模板已含真实实体 id：entities 找不到时渲染器显示「未绑定」，可接受
  const html = renderElementsToHtml(schema, { entitySlots: {}, preview: true, entities, unit: 'px' })
  thumbs[t.id] = html
  return html
}
for (const t of [...TEMPLATE_CATALOG]) thumbOf(t)

function thumbStyle(t) {
  const s = THUMB_W / t.schema.canvas.w
  return {
    width: t.schema.canvas.w + 'px',
    height: t.schema.canvas.h + 'px',
    transform: `scale(${s})`,
  }
}
function thumbH(t) {
  return Math.round(t.schema.canvas.h * (THUMB_W / t.schema.canvas.w))
}

function onPick(t) {
  if (t.__user) {
    // 我的模板：实体已固化在 schema 里，直接套用
    emit('user', t)
    return
  }
  if (t.roles?.length) {
    binding.value = t
  } else {
    emit('apply', { tpl: t, roleMap: {} })
  }
}
function onBindConfirm(roleMap) {
  emit('apply', { tpl: binding.value, roleMap })
  binding.value = null
}
function onBindSkip() {
  emit('apply', { tpl: binding.value, roleMap: {} })
  binding.value = null
}

onMounted(ensureDesignerCss)
</script>

<style scoped>
.hc-tg {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
  overflow: hidden;
}
.hc-tg-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  flex-shrink: 0;
}
.hc-tg-back {
  width: 32px; height: 32px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: transparent;
  color: rgb(var(--c-muted));
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.hc-tg-back:hover { color: rgb(var(--c-on-surface)); border-color: var(--hc-color, var(--hc-primary)); }
.hc-tg-headtxt { flex: 1; min-width: 0; }
.hc-tg-title { font-size: 16px; font-weight: 700; }
.hc-tg-sub { font-size: 11px; color: rgb(var(--c-muted)); margin-top: 2px; }
.hc-tg-blank, .hc-tg-ai {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
}
.hc-tg-blank:hover, .hc-tg-ai:hover { border-color: var(--hc-color, var(--hc-primary)); }
.hc-tg-ai {
  background: color-mix(in srgb, var(--hc-primary) 14%, rgb(var(--c-surface)));
  border-color: color-mix(in srgb, var(--hc-primary) 40%, rgb(var(--c-border)));
  color: var(--hc-color, var(--hc-primary));
}
.hc-tg-cats {
  display: flex;
  gap: 6px;
  padding: 10px 20px;
  flex-shrink: 0;
  overflow-x: auto;
}
.hc-tg-cat {
  padding: 5px 14px;
  font-size: 11px;
  border-radius: 99px;
  border: 1px solid rgb(var(--c-border));
  background: transparent;
  color: rgb(var(--c-muted));
  cursor: pointer;
  white-space: nowrap;
}
.hc-tg-cat.is-on {
  background: var(--hc-color, var(--hc-primary));
  border-color: var(--hc-color, var(--hc-primary));
  color: #000;
  font-weight: 600;
}
.hc-tg-grid-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 20px 24px; }
.hc-tg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.hc-tg-card {
  display: flex;
  flex-direction: column;
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  background: rgb(var(--c-surface));
  cursor: pointer;
  overflow: hidden;
  padding: 8px;
  transition: border-color .15s, box-shadow .15s, transform .15s;
  text-align: left;
}
.hc-tg-card:hover {
  border-color: var(--hc-color, var(--hc-primary));
  box-shadow: 0 6px 20px rgb(0 0 0 / .18);
  transform: translateY(-2px);
}
.hc-tg-thumb {
  display: block;
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--hc-bg2, rgb(var(--c-surface-alt))) 80%, transparent);
}
.hc-tg-scale {
  display: block;
  position: absolute;
  top: 0; left: 0;
  transform-origin: top left;
  pointer-events: none;
}
.hc-tg-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 2px 2px;
  font-size: 12px;
}
.hc-tg-card-meta .material-symbols-outlined { font-size: 16px; color: var(--hc-color, var(--hc-primary)); }
.hc-tg-card-name { font-weight: 600; color: rgb(var(--c-on-surface)); }
.hc-tg-card-grid {
  margin-left: auto;
  font-size: 9px;
  color: rgb(var(--c-muted));
  background: rgb(var(--c-surface-alt));
  padding: 1px 6px;
  border-radius: 4px;
}
.hc-tg-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 0;
  color: rgb(var(--c-muted));
  font-size: 12px;
}
.hc-tg-empty .material-symbols-outlined { font-size: 32px; opacity: .4; }
</style>

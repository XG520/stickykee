<template>
  <Teleport to="body">
    <Transition name="ce">
      <div v-if="open && draft.type" class="ce-overlay" @mousedown.self="requestClose">
        <div class="ce-panel" role="dialog" aria-modal="true" aria-label="卡片工作室">
          <!-- ============ 顶栏 ============ -->
          <header class="ce-topbar">
            <div class="ce-brand">
              <div class="ce-type-icon" :class="meta.colorCls">
                <span class="material-symbols-outlined">{{ meta.icon }}</span>
              </div>
              <div class="ce-titles">
                <span class="ce-eyebrow">卡片工作室</span>
                <span class="ce-title">
                  {{ meta.label }}
                  <i v-if="dirty" class="ce-title-dot" title="有未保存的更改"></i>
                </span>
              </div>
            </div>
            <div class="ce-top-actions">
              <button class="ce-btn ce-ghost" @click="banner = banner === 'reset' ? null : 'reset'" title="将 HTML/CSS/JS 还原为该类型的默认模板">
                <span class="material-symbols-outlined">restart_alt</span>
                <span class="ce-btn-text">恢复默认</span>
              </button>
              <button class="ce-btn ce-ghost" :class="{ 'is-dirty': dirty }" @click="banner = banner === 'save-as-tpl' ? null : 'save-as-tpl'" title="把当前这张卡保存为模板（下次添加卡片时就能找到）">
                <span class="material-symbols-outlined">bookmark_add</span>
                <span class="ce-btn-text">保存为模板</span>
              </button>
              <button class="ce-btn ce-ghost" @click="requestClose">
                取消
                <kbd class="ce-kbd">Esc</kbd>
              </button>
              <button class="ce-btn ce-primary" :class="{ 'is-dirty': dirty }" @click="save">
                <span class="material-symbols-outlined">check</span>
                保存更改
                <kbd class="ce-kbd ce-kbd-light">Ctrl S</kbd>
              </button>
            </div>
          </header>

          <!-- 瞬时 toast：保存模板 / 保存更改 等操作的非阻断提示（顶栏下方，单条自动消失） -->
          <Transition name="ce-banner">
            <div v-if="topMsg" class="ce-banner" :class="{ 'ce-danger-banner': topMsg.err }">
              <span class="material-symbols-outlined ce-banner-icon">{{ topMsg.err ? 'error' : 'check_circle' }}</span>
              <span>{{ topMsg.text }}</span>
            </div>
          </Transition>

          <!-- ============ 二次确认横幅 ============ -->
          <Transition name="ce-banner">
            <div v-if="banner" class="ce-banner">
              <template v-if="banner === 'discard'">
                <span class="material-symbols-outlined ce-banner-icon">error</span>
                <span>有尚未保存的更改，关闭后这些修改将丢失。</span>
                <span class="ce-spacer"></span>
                <button class="ce-btn ce-ghost ce-btn-sm" @click="banner = null">继续编辑</button>
                <button class="ce-btn ce-danger-btn ce-btn-sm" @click="discardAndClose">放弃更改</button>
              </template>
              <template v-else-if="banner === 'save-as-tpl'">
                <span class="material-symbols-outlined ce-banner-icon">bookmark_add</span>
                <span class="flex items-center gap-2 flex-wrap">
                  <label class="text-on-surface/85">模板名</label>
                  <input v-model="tplName" class="ce-input ce-input-sm w-40" maxlength="20" placeholder="我的模板" @keydown.enter="confirmSaveAsTpl" />
                  <label class="text-on-surface/85">图标</label>
                  <input v-model="tplIcon" class="ce-input ce-input-sm w-28" maxlength="32" placeholder="construction" @keydown.enter="confirmSaveAsTpl" />
                  <label class="inline-flex items-center gap-1 text-on-surface/85 ml-1">
                    <input type="checkbox" v-model="tplNeedEntity" class="accent-primary" />
                    需要绑定实体
                  </label>
                </span>
                <span class="ce-spacer"></span>
                <button class="ce-btn ce-ghost ce-btn-sm" @click="banner = null">取消</button>
                <button class="ce-btn ce-primary ce-btn-sm" :disabled="!tplName.trim() || savingAsTpl" @click="confirmSaveAsTpl">
                  <span class="material-symbols-outlined">{{ savingAsTpl ? 'progress_activity' : 'save' }}</span>保存为模板
                </button>
              </template>
              <template v-else-if="banner === 'reset'">
                <span class="material-symbols-outlined ce-banner-icon">restart_alt</span>
                <span>恢复默认会用内置模板覆盖当前的 HTML / CSS / JS 三段代码。</span>
                <span class="ce-spacer"></span>
                <button class="ce-btn ce-ghost ce-btn-sm" @click="banner = null">取消</button>
                <button class="ce-btn ce-primary ce-btn-sm" @click="resetToDefault">恢复</button>
              </template>
            </div>
          </Transition>

          <!-- ============ 主体 ============ -->
          <div class="ce-body">
            <!-- 左：预览舞台 -->
            <section class="ce-preview-col">
              <div class="ce-preview-head">
                <!-- 卡片设计的唯一入口是积木设计器（/designer） -->
                <button v-if="canDesign" class="ce-btn ce-primary ce-btn-sm" title="在积木设计器中设计这张卡片" @click="goDesigner">
                  <span class="material-symbols-outlined">dashboard_customize</span>设计
                </button>
                <span class="ce-preview-meta">{{ draft.w }}×{{ draft.h }} 格 · {{ pxW }}×{{ pxH }}px</span>
                <span class="ce-spacer"></span>
                <span class="ce-preview-scale">{{ Math.round(previewScale * 100) }}%</span>
              </div>
              <div ref="stageRef" class="ce-stage">
                <!-- 预览：1:1 渲染 + 等比缩放 -->
                <div class="ce-slot" :style="slotStyle">
                  <div
                    :id="'preview-' + draft.uid"
                    class="ce-pholder"
                    :style="holderStyle"
                  >
                    <div class="hc-card-zoom" :style="zoomStyle">
                      <CodeCard :card="draft" :scope-id="'preview-' + draft.uid" />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 右：配置 + 代码 -->
            <section class="ce-edit-col">
              <!-- 配置区 -->
              <div class="ce-config">
                <div v-if="meta.needEntity || meta.entityOptional" class="ce-field ce-field-entity" ref="entityWrapRef">
                  <label class="ce-label">
                    绑定实体
                    <span v-if="multiEntity" class="ce-label-sub">已选 {{ draft.entity_ids.length }} 个 · 不限数量</span>
                  </label>
                  <!-- 单实体卡 -->
                  <div v-if="!multiEntity" class="ce-combobox">
                    <button type="button" class="ce-combo-btn" @click="toggleEntityMenu()">
                      <template v-if="currentEntity">
                        <span class="ce-domain-badge">{{ currentEntity.domain }}</span>
                        <span class="ce-combo-name">{{ currentEntity.friendly_name || currentEntity.entity_id }}</span>
                        <span class="ce-combo-id">{{ currentEntity.entity_id }}</span>
                      </template>
                      <span v-else class="ce-combo-empty">请选择 Home Assistant 实体…</span>
                      <span class="material-symbols-outlined ce-combo-caret">expand_more</span>
                    </button>
                    <Transition name="ce-menu">
                      <div v-if="entityMenu" class="ce-dropdown">
                        <div class="ce-search">
                          <span class="material-symbols-outlined">search</span>
                          <input
                            ref="entitySearchRef"
                            v-model="entityQuery"
                            class="ce-search-input"
                            type="text"
                            placeholder="搜索名称或 entity_id…"
                          />
                        </div>
                        <ul class="ce-entity-list">
                          <li
                            v-for="o in filteredEntities"
                            :key="o.id"
                            class="ce-entity-item"
                            :class="{ on: isEntityPicked(o.id) }"
                            @click="pickEntity(o.id)"
                          >
                            <span class="ce-domain-badge">{{ o.domain }}</span>
                            <span class="ce-en-text">
                              <span class="ce-en-name">{{ o.label }}</span>
                              <span class="ce-en-id">{{ o.id }}</span>
                            </span>
                            <span v-if="isEntityPicked(o.id)" class="material-symbols-outlined ce-en-check">check</span>
                          </li>
                          <!-- 可选实体卡（entityOptional）：提供「不绑定」出口，清除误绑/自动预选的实体 -->
                          <li
                            v-if="!multiEntity && meta.entityOptional && !meta.needEntity"
                            class="ce-entity-item"
                            :class="{ on: !draft.entity_id }"
                            @click="pickEntity('')"
                          >
                            <span class="ce-domain-badge"><span class="material-symbols-outlined" style="font-size:10px">block</span></span>
                            <span class="ce-en-text">
                              <span class="ce-en-name">不绑定实体</span>
                              <span class="ce-en-id">使用卡片默认数据源</span>
                            </span>
                            <span v-if="!draft.entity_id" class="material-symbols-outlined ce-en-check">check</span>
                          </li>
                          <li v-if="!filteredEntities.length" class="ce-entity-empty">
                            {{ entityOptions.length ? '没有匹配的实体' : '该类型暂无可用实体（需先连接 Home Assistant）' }}
                          </li>
                        </ul>
                      </div>
                    </Transition>
                  </div>
                  <!-- 多实体通用卡：已选列表 + 追加 -->
                  <div v-else class="ce-combobox ce-multi-box">
                    <ul class="ce-multi-list">
                      <li
                        v-for="(id, idx) in draft.entity_ids"
                        :key="id"
                        class="ce-entity-item ce-multi-item"
                      >
                        <span class="ce-domain-badge">{{ entityRowOf(id).domain }}</span>
                        <span class="ce-en-text">
                          <span class="ce-en-name">{{ entityRowOf(id).label }}</span>
                          <span class="ce-en-id">{{ id }}</span>
                        </span>
                        <span v-if="idx === 0" class="ce-primary-tag" title="卡片头部显示该实体">主</span>
                        <button type="button" class="ce-multi-del" title="移除该实体" @click="removeEntity(id)">
                          <span class="material-symbols-outlined">close</span>
                        </button>
                      </li>
                      <li v-if="!draft.entity_ids.length" class="ce-entity-empty">
                        尚未添加实体，点击下方按钮搜索添加
                      </li>
                    </ul>
                    <button type="button" class="ce-add-entity" @click="toggleEntityMenu(true)">
                      <span class="material-symbols-outlined">add</span>
                      添加实体
                      <span class="material-symbols-outlined ce-combo-caret" v-if="entityMenu">expand_less</span>
                    </button>
                    <Transition name="ce-menu">
                      <div v-if="entityMenu" class="ce-dropdown">
                        <div class="ce-search">
                          <span class="material-symbols-outlined">search</span>
                          <input
                            ref="entitySearchRef"
                            v-model="entityQuery"
                            class="ce-search-input"
                            type="text"
                            placeholder="搜索名称或 entity_id…"
                          />
                        </div>
                        <ul class="ce-entity-list">
                          <li
                            v-for="o in filteredEntities"
                            :key="o.id"
                            class="ce-entity-item"
                            :class="{ on: isEntityPicked(o.id) }"
                            @click="pickEntity(o.id)"
                          >
                            <span class="ce-domain-badge">{{ o.domain }}</span>
                            <span class="ce-en-text">
                              <span class="ce-en-name">{{ o.label }}</span>
                              <span class="ce-en-id">{{ o.id }}</span>
                            </span>
                            <span v-if="isEntityPicked(o.id)" class="material-symbols-outlined ce-en-check">check</span>
                          </li>
                          <li v-if="!filteredEntities.length" class="ce-entity-empty">
                            {{ entityOptions.length ? '没有匹配的实体' : '暂无可用实体（需先连接 Home Assistant）' }}
                          </li>
                        </ul>
                        <div class="ce-dd-foot">
                          <span class="ce-dd-tip">点击实体即可加入 / 移除，可连续添加，不限数量</span>
                          <button type="button" class="ce-btn ce-primary ce-btn-sm" @click="entityMenu = false">完成</button>
                        </div>
                      </div>
                    </Transition>
                  </div>
                </div>

                <!-- 人员信息卡：扩展绑定槽位（中部循环翻动 / 底部滚动轮播，均不限数量、不限域） -->
                <div v-for="slot in extraSlots" :key="slot.key" class="ce-field ce-field-entity ce-slot-box">
                  <label class="ce-label">
                    {{ slot.label }}
                    <span class="ce-label-sub">已选 {{ draft[slot.key].length }} 个 · 不限数量</span>
                  </label>
                  <!-- 默认折叠态：只显示数量摘要 + 添加按钮，避免多实体时每个槽位框占满 132px -->
                  <div v-if="!slotExpanded[slot.key]" class="ce-slot-collapsed">
                    <span class="ce-slot-num">{{ draft[slot.key].length }}</span>
                    <span class="ce-slot-num-sub">个实体</span>
                    <button type="button" class="ce-btn ce-ghost ce-btn-sm ce-slot-act" @click="slotExpanded[slot.key] = true">
                      <span class="material-symbols-outlined">expand_more</span>展开
                    </button>
                    <button type="button" class="ce-btn ce-primary ce-btn-sm" @click="toggleSlotMenu(slot.key)">
                      <span class="material-symbols-outlined">add</span>添加
                    </button>
                  </div>
                  <!-- 展开态：完整 chip list + 收起/添加按钮 -->
                  <template v-else>
                    <div class="ce-combobox ce-multi-box">
                      <ul class="ce-multi-list">
                        <li
                          v-for="(id, idx) in draft[slot.key]"
                          :key="id"
                          class="ce-entity-item ce-multi-item"
                        >
                          <span class="ce-domain-badge">{{ slotRowOf(id).domain }}</span>
                          <span class="ce-en-text">
                            <span class="ce-en-name">{{ slotRowOf(id).label }}</span>
                            <span class="ce-en-id">{{ id }}</span>
                          </span>
                          <span class="ce-multi-act">
                            <button type="button" class="ce-multi-mv" title="上移" :disabled="idx === 0" @click.stop="moveSlotEntity(slot.key, id, -1)">
                              <span class="material-symbols-outlined">expand_less</span>
                            </button>
                            <button type="button" class="ce-multi-mv" title="下移" :disabled="idx === draft[slot.key].length - 1" @click.stop="moveSlotEntity(slot.key, id, 1)">
                              <span class="material-symbols-outlined">expand_more</span>
                            </button>
                            <button type="button" class="ce-multi-del" title="移除该实体" @click.stop="removeSlotEntity(slot.key, id)">
                              <span class="material-symbols-outlined">close</span>
                            </button>
                          </span>
                        </li>
                        <li v-if="!draft[slot.key].length" class="ce-entity-empty">
                          {{ slot.empty }}
                        </li>
                      </ul>
                    </div>
                    <div class="ce-slot-actions">
                      <button type="button" class="ce-btn ce-ghost ce-btn-sm ce-slot-act" @click="slotExpanded[slot.key] = false">
                        <span class="material-symbols-outlined">expand_less</span>收起
                      </button>
                      <button type="button" class="ce-add-entity" @click="toggleSlotMenu(slot.key)">
                        <span class="material-symbols-outlined">add</span>添加实体
                        <span class="material-symbols-outlined ce-combo-caret" v-if="slotMenuKey === slot.key">expand_less</span>
                      </button>
                    </div>
                  </template>
                  <!-- 下拉搜索菜单：独立于折叠/展开，始终渲染，v-if 由 slotMenuKey 控制显示 -->
                  <Transition name="ce-menu">
                    <div v-if="slotMenuKey === slot.key" class="ce-dropdown">
                      <div class="ce-search">
                        <span class="material-symbols-outlined">search</span>
                        <input
                          ref="slotSearchRef"
                          v-model="slotQuery"
                          class="ce-search-input"
                          type="text"
                          placeholder="搜索名称或 entity_id…"
                        />
                      </div>
                      <ul class="ce-entity-list">
                        <li
                          v-for="o in filteredSlotEntities"
                          :key="o.id"
                          class="ce-entity-item"
                          :class="{ on: draft[slot.key].includes(o.id) }"
                          @click="pickSlotEntity(o.id)"
                        >
                          <span class="ce-domain-badge">{{ o.domain }}</span>
                          <span class="ce-en-text">
                            <span class="ce-en-name">{{ o.label }}</span>
                            <span class="ce-en-id">{{ o.id }}</span>
                          </span>
                          <span v-if="draft[slot.key].includes(o.id)" class="material-symbols-outlined ce-en-check">check</span>
                        </li>
                        <li v-if="!filteredSlotEntities.length" class="ce-entity-empty">
                          {{ allEntityOptions.length ? '没有匹配的实体' : '暂无可用实体（需先连接 Home Assistant）' }}
                        </li>
                      </ul>
                      <div class="ce-dd-foot">
                        <span class="ce-dd-tip">点击实体即可加入 / 移除，可连续添加，不限数量</span>
                        <button type="button" class="ce-btn ce-primary ce-btn-sm" @click="slotMenuKey = ''">完成</button>
                      </div>
                    </div>
                  </Transition>
                </div>

                <div v-if="meta.needEntity" class="ce-field ce-field-title">
                  <label class="ce-label">
                    卡片标题
                    <span class="ce-label-sub">设备卡建议用物理设备名，留空取首个实体名</span>
                  </label>
                  <input
                    class="ce-icon-input ce-title-input"
                    type="text"
                    v-model="draft.title"
                    placeholder="如 客厅吸顶灯"
                    spellcheck="false"
                  />
                </div>

                <div class="ce-field ce-field-size">
                  <label class="ce-label">卡片尺寸</label>
                  <div class="ce-sizepick">
                    <div
                      v-for="i in 12"
                      :key="i"
                      class="ce-size-cell"
                      :class="sizeCellClass(i)"
                      @mouseenter="hoverCell = i"
                      @mouseleave="hoverCell = 0"
                      @click="pickSize(i)"
                    ></div>
                  </div>
                  <span class="ce-size-text">{{ draft.w }} 格宽 × {{ draft.h }} 格高</span>
                </div>

                <div class="ce-field ce-field-icon">
                  <label class="ce-label">
                    自定义图标
                    <span class="ce-label-sub">留空使用实体 / 默认图标</span>
                  </label>
                  <div class="ce-icon-row">
                    <div class="ce-icon-preview" :title="draft.icon || '默认图标'">
                      <span class="material-symbols-outlined" :style="draft.icon ? 'color:#F5A623' : ''">{{ draft.icon || 'image' }}</span>
                    </div>
                    <input
                      class="ce-icon-input"
                      type="text"
                      v-model="iconInput"
                      placeholder="图标名称，如 av_timer"
                      spellcheck="false"
                      @input="applyIconInput"
                      @keydown.enter.prevent="applyIconInput"
                    />
                    <button type="button" class="ce-btn ce-ghost ce-btn-sm" :disabled="!draft.icon" @click="clearCardIcon" title="恢复默认图标">
                      <span class="material-symbols-outlined">backspace</span>清除
                    </button>
                  </div>
                  <div class="ce-icon-sugs">
                    <button v-for="n in iconSugs" :key="n" type="button" class="ce-icon-sug" :class="{ on: draft.icon === n }" @click="pickCardIcon(n)" :title="n">
                      <span class="material-symbols-outlined">{{ n }}</span>
                    </button>
                  </div>
                </div>

                <!-- 自定义头像（人员位置卡 / 人员信息卡共用同一字段与上传逻辑） -->
                <div v-if="draft.type === 'person' || draft.type === 'personInfo'" class="ce-field ce-field-avatar">
                  <label class="ce-label">
                    自定义头像
                    <span class="ce-label-sub">上传图片（自动缩放 256px），留空使用实体图片</span>
                  </label>
                  <div class="ce-avatar-row">
                    <div class="ce-avatar-preview">
                      <img v-if="draft.avatar" :src="draft.avatar" alt="" />
                      <span v-else class="material-symbols-outlined">person</span>
                    </div>
                    <div class="ce-avatar-actions">
                      <label class="ce-btn ce-ghost ce-btn-sm" title="上传本地图片作为头像">
                        <span class="material-symbols-outlined">upload</span>上传
                        <input ref="avatarFileRef" type="file" accept="image/*" class="ce-hidden-input" @change="onPickAvatar" />
                      </label>
                      <button type="button" class="ce-btn ce-ghost ce-btn-sm" :disabled="!draft.avatar" @click="clearAvatar" title="恢复实体图片 / 默认头像">
                        <span class="material-symbols-outlined">backspace</span>清除
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- ============ 底部状态栏 ============ -->
          <footer class="ce-status">
            <span class="ce-status-item ce-dirty-state" :class="{ on: dirty }">
              <i class="ce-status-dot"></i>{{ dirty ? '未保存更改' : '所有更改已保存' }}
            </span>
            <span class="ce-spacer"></span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { entityStates } from '@/store'
import { cardDefaults } from './defaults'
import { saveAsTemplate, isUserTemplate } from '@/composables/useCustomTemplates'
import CodeCard from './CodeCard.vue'
const props = defineProps({
  open: { type: Boolean, default: false },
  card: { type: Object, default: null },
  // 真实网格当前每格像素宽 / 列数（用于让预览与实际渲染 1:1 一致）
  cellSize: { type: Number, default: 0 },
  cols: { type: Number, default: 8 },
})
const emit = defineEmits(['close', 'save', 'design'])

const baseCell = 120

// ================= 草稿与脏状态 =================
const draft = reactive({ type: '', uid: '', entity_id: '', entity_ids: [], entity_ids2: [], entity_ids3: [], entity_ids_status: [], w: 1, h: 1, html: '', css: '', js: '', icon: '', avatar: '', title: '', _designerSchema: null, compiledHtml: '', entitySlotMap: {} })
let snapshot = ''
const dirty = computed(() => JSON.stringify(pickDraft()) !== snapshot)

function pickDraft() {
  return {
    w: draft.w, h: draft.h, html: draft.html, css: draft.css, js: draft.js,
    entity_id: metaOf(draft.type).needEntity || metaOf(draft.type).entityOptional ? draft.entity_id : '',
    entity_ids: ['generic', 'person', 'group'].includes(draft.type) ? [...draft.entity_ids] : [],
    entity_ids2: draft.type === 'personInfo' ? [...draft.entity_ids2] : [],
    entity_ids3: draft.type === 'personInfo' ? [...draft.entity_ids3] : [],
    entity_ids_status: draft.type === 'personInfo' ? [...draft.entity_ids_status] : [],
    icon: draft.icon,
    avatar: draft.avatar,
    title: draft.title || '',
    _designerSchema: draft._designerSchema,
    compiledHtml: draft.compiledHtml,
    entitySlotMap: draft.entitySlotMap,
  }
}
// 通用卡与人员位置卡为多实体卡（不限数量）；其余卡仍为单实体
const multiEntity = computed(() => ['generic', 'person', 'group'].includes(draft.type))
function syncPrimaryEntity() { draft.entity_id = draft.entity_ids[0] || '' }
function metaOf(type) { return cardDefaults[type] || cardDefaults.greeting }
const meta = computed(() => metaOf(draft.type))

// 打开卡片时从 props 装载草稿。
// 自定义卡/用户模板仅当 _autoDesign 瞬时标记存在时才自动跳积木设计器（见下方 watch）。
watch(
  () => props.open,
  (open) => {
    if (open && props.card) {
      draft.type = props.card.type
      draft.uid = props.card.uid
      draft.entity_id = props.card.entity_id || ''
      draft.entity_ids = Array.isArray(props.card.entity_ids)
        ? props.card.entity_ids.filter(Boolean)
        : (props.card.entity_id ? [props.card.entity_id] : [])
      draft.entity_ids2 = Array.isArray(props.card.entity_ids2) ? props.card.entity_ids2.filter(Boolean) : []
      draft.entity_ids3 = Array.isArray(props.card.entity_ids3) ? props.card.entity_ids3.filter(Boolean) : []
      draft.entity_ids_status = Array.isArray(props.card.entity_ids_status) ? props.card.entity_ids_status.filter(Boolean) : []
      draft.w = props.card.w || 1
      draft.h = props.card.h || 1
      draft.html = props.card.html || ''
      draft.css = props.card.css || ''
      draft.js = props.card.js || ''
      draft.icon = props.card.icon || ''
      iconInput.value = draft.icon
      draft.avatar = props.card.avatar || ''
      draft.title = props.card.title || ''
      draft._designerSchema = props.card._designerSchema || null
      draft.compiledHtml = props.card.compiledHtml || ''
      draft.entitySlotMap = props.card.entitySlotMap || {}
      banner.value = null
      entityQuery.value = ''
      slotMenuKey.value = ''
      slotQuery.value = ''
      hoverCell.value = 0
      snapshot = JSON.stringify(pickDraft())
      nextTick(() => {
        computePreviewScale()
        if (stageRef.value && !ro) {
          ro = new ResizeObserver(computePreviewScale)
          ro.observe(stageRef.value)
        }
      })
      // 新建自定义卡/用户模板卡的瞬时标记：草稿就绪后直接进积木设计器
      if (props.card._autoDesign) {
        delete props.card._autoDesign
        nextTick(goDesigner)
      }
    }
  },
  { immediate: true },
)

// ================= 顶栏操作 =================
const banner = ref(null)
function requestClose() {
  if (dirty.value && banner.value !== 'discard') banner.value = 'discard'
  else if (!dirty.value) emit('close')
}
function discardAndClose() {
  banner.value = null
  emit('close')
}
function resetToDefault() {
  const d = cardDefaults[draft.type]
  if (!d) return
  draft.html = d.html
  draft.css = d.css
  draft.js = d.js
  banner.value = null
}

function save() {
  emit('save', { uid: draft.uid, ...pickDraft() })
}

// ================= 保存为用户自定义模板 =================
const tplName = ref('')
const tplIcon = ref('')
const tplNeedEntity = ref(false)
const savingAsTpl = ref(false)
// 打开保存对话框时预填当前 draft 的元信息，方便用户快速确认
watch(banner, (v) => {
  if (v !== 'save-as-tpl') return
  tplName.value = props.card?.title?.trim() || cardDefaults[draft.type]?.label || '我的模板'
  tplIcon.value = draft.icon || cardDefaults[draft.type]?.icon || 'construction'
  tplNeedEntity.value = !!metaOf(draft.type).needEntity
})
async function confirmSaveAsTpl() {
  if (savingAsTpl.value) return
  if (!tplName.value.trim()) return
  savingAsTpl.value = true
  try {
    const res = await saveAsTemplate(draft, {
      name: tplName.value.trim(),
      icon: tplIcon.value.trim() || 'construction',
      needEntity: tplNeedEntity.value,
    })
    if (res?.err === 'limit') showTopMsg(res.msg, true)
    else if (res?.err === 'no-name') showTopMsg('请输入模板名', true)
    else if (res?.err) showTopMsg('保存失败：' + res.err, true)
    else showTopMsg(`模板「${res.name}」已保存，下次添加卡片时就能找到了`)
    banner.value = null
  } finally { savingAsTpl.value = false }
}
function showTopMsg(text, err) {
  topMsg.value = { text, err: !!err }
  clearTimeout(topMsgTimer)
  topMsgTimer = setTimeout(() => { topMsg.value = null }, 3200)
}
const topMsg = ref(null)
let topMsgTimer = 0

// ================= 自定义图标 =================
const iconInput = ref('')
const iconSugs = ['home', 'lightbulb', 'av_timer', 'calendar_month', 'partly_cloudy_day', 'devices', 'sensors', 'thermostat', 'dashboard', 'bolt', 'battery_full', 'schedule']
function applyIconInput() { draft.icon = (iconInput.value || '').trim().replace(/\s+/g, '_') }
function pickCardIcon(n) { draft.icon = n; iconInput.value = n }
function clearCardIcon() { draft.icon = ''; iconInput.value = '' }

// ================= 自定义头像（人员位置卡） =================
const avatarFileRef = ref(null)
function onPickAvatar(ev) {
  const file = ev.target.files && ev.target.files[0]
  if (!file) return
  if (!file.type.startsWith('image/')) return
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    // 等比缩放至最长边 256px，转 jpeg dataURL 存储
    const max = 256
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d').drawImage(img, 0, 0, w, h)
    draft.avatar = cv.toDataURL('image/jpeg', 0.85)
    URL.revokeObjectURL(url)
    if (avatarFileRef.value) avatarFileRef.value.value = ''
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    if (avatarFileRef.value) avatarFileRef.value.value = ''
  }
  img.src = url
}
function clearAvatar() {
  draft.avatar = ''
  if (avatarFileRef.value) avatarFileRef.value.value = ''
}

// ================= 实体选择（可搜索下拉） =================
const entityWrapRef = ref(null)
const entityMenu = ref(false)
const entityQuery = ref('')
const entitySearchRef = ref(null)

const entityOptions = computed(() => {
  const m = meta.value
  const domains = m.entityDomains
  return Object.values(entityStates)
    .filter((e) => !domains || domains.includes(e.domain))
    .map((e) => ({
      id: e.entity_id,
      label: e.friendly_name || e.entity_id,
      domain: e.domain || e.entity_id.split('.')[0],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
})
const filteredEntities = computed(() => {
  const q = entityQuery.value.trim().toLowerCase()
  const list = entityOptions.value
  if (!q) return list
  return list.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
})
const currentEntity = computed(
  () => Object.values(entityStates).find((e) => e.entity_id === draft.entity_id) || null,
)
// 多实体卡列表项展示辅助
function entityRowOf(id) {
  return entityOptions.value.find((o) => o.id === id) || { id, label: id, domain: id.split('.')[0] }
}
function isEntityPicked(id) {
  return multiEntity.value ? draft.entity_ids.includes(id) : draft.entity_id === id
}
function toggleEntityMenu(force) {
  entityMenu.value = typeof force === 'boolean' ? force : !entityMenu.value
  if (entityMenu.value) nextTick(() => entitySearchRef.value?.focus())
}
function pickEntity(id) {
  if (multiEntity.value) {
    // 多选：点击即加入 / 再次点击移除，菜单保持打开，数量不限
    const i = draft.entity_ids.indexOf(id)
    if (i >= 0) draft.entity_ids.splice(i, 1)
    else draft.entity_ids.push(id)
    syncPrimaryEntity()
    return
  }
  draft.entity_id = id
  entityMenu.value = false
}
function removeEntity(id) {
  const i = draft.entity_ids.indexOf(id)
  if (i >= 0) draft.entity_ids.splice(i, 1)
  syncPrimaryEntity()
}

// ================= 人员信息卡：扩展绑定槽位（entity_ids2 循环翻动 / entity_ids3 滚动轮播） =================
// 与主实体框独立：不限域、不限数量；两个槽位共用一个打开中的下拉（slotMenuKey）与搜索词（slotQuery）
const extraSlots = computed(() => (draft.type === 'personInfo'
  ? [
    { key: 'entity_ids_status', label: '顶部状态跑马灯', empty: '可选：设备状态实体，从右向左滚动显示在标题与角标之间' },
    { key: 'entity_ids2', label: '循环翻动实体', empty: '可选：多个实体时状态在卡片中部轮流翻动显示' },
    { key: 'entity_ids3', label: '滚动轮播实体', empty: '可选：实体状态在卡片底部从左到右滚动显示' },
  ]
  : []))
const slotMenuKey = ref('')
const slotQuery = ref('')
const slotExpanded = ref({}) // { entity_ids2: true } 控制槽位框 chip list 默认折叠
const slotSearchRef = ref(null)
const allEntityOptions = computed(() =>
  Object.values(entityStates)
    .map((e) => ({ id: e.entity_id, label: e.friendly_name || e.entity_id, domain: e.domain || e.entity_id.split('.')[0] }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh')))
const filteredSlotEntities = computed(() => {
  const q = slotQuery.value.trim().toLowerCase()
  if (!q) return allEntityOptions.value
  return allEntityOptions.value.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
})
function slotRowOf(id) {
  return allEntityOptions.value.find((o) => o.id === id) || { id, label: id, domain: id.split('.')[0] }
}
function toggleSlotMenu(key) {
  slotMenuKey.value = slotMenuKey.value === key ? '' : key
  slotQuery.value = ''
  if (slotMenuKey.value) {
    // 确保下拉展开的槽位框可见，避免被 .ce-config 的 overflow 滚动容器裁剪
    nextTick(() => {
      const wrap = document.querySelector(`.ce-slot-box .ce-dropdown`)
      wrap?.closest?.('.ce-slot-box')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      const el = Array.isArray(slotSearchRef.value) ? slotSearchRef.value[0] : slotSearchRef.value
      el?.focus?.()
    })
  }
}
function pickSlotEntity(id) {
  const list = draft[slotMenuKey.value]
  if (!Array.isArray(list)) return
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}
function removeSlotEntity(key, id) {
  const list = draft[key]
  const i = Array.isArray(list) ? list.indexOf(id) : -1
  if (i >= 0) list.splice(i, 1)
}
// 调整槽位内实体顺序：dir = -1 上移 / +1 下移
function moveSlotEntity(key, id, dir) {
  const list = draft[key]
  if (!Array.isArray(list) || dir === 0) return
  const i = list.indexOf(id)
  if (i < 0) return
  const j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
}
function onDocMouseDown(e) {
  if (entityMenu.value && entityWrapRef.value && !entityWrapRef.value.contains(e.target)) entityMenu.value = false
  if (slotMenuKey.value && !e.target?.closest?.('.ce-slot-box')) slotMenuKey.value = ''
}

// ================= 可视化尺寸选择（4×3） =================
const hoverCell = ref(0)
function sizeCellClass(i) {
  const idx = i - 1
  const r = Math.floor(idx / 4)
  const c = idx % 4
  const hoverW = hoverCell.value ? ((hoverCell.value - 1) % 4) + 1 : 0
  const hoverH = hoverCell.value ? Math.floor((hoverCell.value - 1) / 4) + 1 : 0
  return {
    on: c < draft.w && r < draft.h,
    hover: hoverCell.value > 0 && c < hoverW && r < hoverH && !(c < draft.w && r < draft.h),
  }
}
function pickSize(i) {
  draft.w = ((i - 1) % 4) + 1
  draft.h = Math.floor((i - 1) / 4) + 1
}
watch(() => [draft.w, draft.h], () => nextTick(computePreviewScale))


// ================= 卡片设计入口：积木设计器 =================
// 只有「自定义卡 / 用户模板」开放设计入口；内置卡（天气/开关/时钟…）是纯配置卡。
// 设计 = 积木设计器（/designer）：低代码画布 + 实时预览 + 代码面板都在设计器里。
const canDesign = computed(() => draft.type === 'custom' || isUserTemplate(draft.type))
// 把当前草稿抛给 HomeView：由它先同步内存/落库，再跳设计器——
// 这样新建卡（尚未落库）和未保存的修改都不会在设计器里丢失。
function goDesigner() {
  if (!canDesign.value || !draft.uid) return
  emit('design', { uid: draft.uid, ...pickDraft() })
}

// ================= 预览：1:1 基准渲染 + transform 等比缩放 =================
const previewScale = ref(1)
let ro = null
function cellPx() { return props.cellSize > 0 ? props.cellSize : 240 }
const pxW = computed(() => Math.round(Math.min(draft.w, props.cols) * cellPx()))
const pxH = computed(() => Math.round(Math.min(3, draft.h) * cellPx()))
const slotStyle = computed(() => ({
  width: Math.min(draft.w, props.cols) * cellPx() * previewScale.value + 'px',
  height: Math.min(3, draft.h) * cellPx() * previewScale.value + 'px',
}))
const holderStyle = computed(() => ({
  width: Math.min(draft.w, props.cols) * cellPx() + 'px',
  height: Math.min(3, draft.h) * cellPx() + 'px',
  transform: `scale(${previewScale.value})`,
  // 预览净缩放 = previewScale × (cellPx/baseCell)，边框厚度按它反向补偿，与仪表盘所见即所得
  '--card-bw': (1 / (previewScale.value * (cellPx() / baseCell) || 1)).toFixed(3) + 'px',
}))
const zoomStyle = computed(() => {
  const factor = cellPx() / baseCell
  return {
    // transform:scale 替代 zoom：zoom 触发同步重排且与 container-type/content-visibility 组合会反复失效重排
    transform: `scale(${factor})`,
    width: Math.min(draft.w, props.cols) * baseCell + 'px',
    height: Math.min(3, draft.h) * baseCell + 'px',
    display: 'flex',
    flexDirection: 'column',
    flex: 'none',
  }
})
function computePreviewScale() {
  if (!props.open) return
  const c = cellPx()
  const nw = Math.min(draft.w, props.cols) * c
  const nh = Math.min(3, draft.h) * c
  const el = stageRef.value
  const maxW = (el ? el.clientWidth : 360) - 40
  const maxH = (el ? el.clientHeight : 320) - 40
  previewScale.value = Math.max(0.1, Math.min(maxW / nw, maxH / nh, 1))
}

// ================= 全局快捷键 =================
function onDocKeydown(e) {
  if (!props.open) return
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    save()
  } else if (e.key === 'Escape') {
    if (entityMenu.value) { entityMenu.value = false; return }
    if (banner.value) { banner.value = null; return }
    requestClose()
  }
}
document.addEventListener('keydown', onDocKeydown)
document.addEventListener('mousedown', onDocMouseDown)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown)
  document.removeEventListener('mousedown', onDocMouseDown)
  if (ro) { ro.disconnect(); ro = null }
})
watch(
  () => props.open,
  (open) => {
    if (!open && ro) { ro.disconnect(); ro = null }
    if (open) nextTick(computePreviewScale)
  },
)
</script>

<style scoped>
/* ================= 覆盖层与面板 ================= */
.ce-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: #0e0f12;
  display: flex;
  padding: 0;
}
.ce-panel {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1d1e22 0%, #18191d 100%);
  border: none;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}

/* ================= 顶栏 ================= */
.ce-topbar {
  flex: none;
  height: 58px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #2a2b2f;
  background: rgba(255, 255, 255, 0.015);
}
.ce-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
.ce-type-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid rgba(245, 166, 35, 0.22);
  flex: none;
}
.ce-type-icon .material-symbols-outlined { font-size: 20px; }
.ce-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ce-eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #6f6e6a;
  font-weight: 600;
}
.ce-title {
  font-size: 15px;
  font-weight: 600;
  color: #f2f0eb;
  display: flex;
  align-items: center;
  gap: 7px;
}
.ce-title-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f5a623;
  box-shadow: 0 0 8px rgba(245, 166, 35, 0.8);
}
.ce-top-actions { display: flex; align-items: center; gap: 8px; flex: none; }

.ce-btn {
  height: 34px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.08s;
  white-space: nowrap;
}
.ce-btn:active { transform: translateY(1px); }
.ce-btn .material-symbols-outlined { font-size: 16px; }
.ce-btn-sm { height: 28px; padding: 0 11px; font-size: 12px; }
.ce-ghost {
  background: transparent;
  color: #b6b4ad;
  border-color: #2e2f33;
}
.ce-ghost:hover { background: rgba(255, 255, 255, 0.06); color: #f2f0eb; }
.ce-primary {
  background: rgba(245, 166, 35, 0.28);
  color: #f2f0eb;
  border-color: rgba(245, 166, 35, 0.35);
}
.ce-primary:hover { background: rgba(245, 166, 35, 0.4); }
.ce-primary.is-dirty {
  background: #f5a623;
  color: #0e0f12;
  border-color: #f5a623;
  box-shadow: 0 6px 20px rgba(245, 166, 35, 0.28), 0 0 0 1px rgba(245, 166, 35, 0.35);
}
.ce-primary.is-dirty:hover { background: #ffb84d; }
.ce-danger-btn {
  background: rgba(232, 93, 76, 0.16);
  color: #f09185;
  border-color: rgba(232, 93, 76, 0.35);
}
.ce-danger-btn:hover { background: rgba(232, 93, 76, 0.28); color: #f5a398; }

.ce-kbd {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #8a8986;
}
.ce-kbd-light { background: rgba(14, 15, 18, 0.14); border-color: rgba(14, 15, 18, 0.2); color: rgba(14, 15, 18, 0.75); }

/* ================= 横幅 ================= */
.ce-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 16px;
  font-size: 12.5px;
  color: #e8d3ae;
  background: rgba(245, 166, 35, 0.09);
  border-bottom: 1px solid rgba(245, 166, 35, 0.22);
}
.ce-banner-icon { font-size: 17px; color: #f5a623; }
.ce-spacer { flex: 1; }
.ce-banner-enter-active, .ce-banner-leave-active { transition: all 0.22s ease; }
.ce-banner-enter-from, .ce-banner-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }

/* ================= 主体布局 ================= */
.ce-body {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 14px;
  gap: 14px;
}

/* ---------- 预览舞台 ---------- */
.ce-preview-col {
  flex: 5 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #27282c;
  border-radius: 14px;
  overflow: hidden;
  background: #101114;
}
.ce-preview-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  font-size: 11px;
  color: #8a8986;
  border-bottom: 1px solid #232428;
  background: rgba(255, 255, 255, 0.015);
}
/* 预览 / 设计 模式切换 */
.ce-mode {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: #0c0d10;
  border: 1px solid #26272b;
  gap: 2px;
}
.ce-mode-btn {
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8a8986;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ce-mode-btn .material-symbols-outlined { font-size: 14px; }
.ce-mode-btn:hover { color: #d8d6cf; }
.ce-mode-btn.on {
  background: rgba(245, 166, 35, 0.16);
  color: #f5a623;
  box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.25);
}
.ce-live { display: inline-flex; align-items: center; gap: 6px; color: #c9c7c0; font-weight: 600; }
.ce-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5ec4b0;
  box-shadow: 0 0 0 0 rgba(94, 196, 176, 0.5);
  animation: ce-pulse 2s ease-out infinite;
}
@keyframes ce-pulse {
  0% { box-shadow: 0 0 0 0 rgba(94, 196, 176, 0.45); }
  70% { box-shadow: 0 0 0 7px rgba(94, 196, 176, 0); }
  100% { box-shadow: 0 0 0 0 rgba(94, 196, 176, 0); }
}
.ce-preview-meta { font-family: ui-monospace, Menlo, Consolas, monospace; }
.ce-preview-scale {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: #f5a623;
  font-weight: 600;
}
.ce-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: hidden;
  background-color: #101114;
  background-image:
    radial-gradient(900px 480px at 50% -12%, rgba(245, 166, 35, 0.07), transparent 62%),
    radial-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1.2px);
  background-size: 100% 100%, 22px 22px;
}
.ce-slot { flex: none; position: relative; }
.ce-pholder {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  border-radius: 12px;
  overflow: hidden;
  background: #1a1b1e;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.07);
}
.hc-card-zoom { position: relative; flex: none; transform-origin: top left; }

/* ---------- 右栏 ---------- */
.ce-edit-col {
  flex: 6 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

/* 配置区 */
.ce-config {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 12px;
  overflow-y: auto;
  padding-right: 4px; /* 滚动条预留，避免 chip 贴边 */
}

/* 设计模式：元素属性 / 代码编辑 视图切换 */
.ce-viewswitch {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #141518;
  border: 1px solid #2a2b2f;
  border-radius: 10px;
}
.ce-vs-btn {
  flex: 1;
  min-width: 0;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #8a8986;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ce-vs-btn .material-symbols-outlined { font-size: 16px; }
.ce-vs-btn:hover { color: #cfccc4; }
.ce-vs-btn.on {
  background: rgba(245, 166, 35, 0.14);
  color: #f5a623;
  box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.28);
}
.ce-vs-btn:disabled {
  opacity: 0.38;
  cursor: default;
}
.ce-vs-btn:disabled:hover { color: #8a8986; }

/* ================= 组件库（组件页） ================= */
.ce-palette,
.ce-layers {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: #141518;
  border: 1px solid #2a2b2f;
  border-radius: 10px;
}
.ce-pal-tip {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(245, 166, 35, 0.08);
  color: #b9b6ae;
  font-size: 11px;
  line-height: 1.5;
}
.ce-pal-tip .material-symbols-outlined { font-size: 14px; color: #f5a623; flex: none; margin-top: 1px; }
.ce-pal-group { flex: none; display: flex; flex-direction: column; gap: 6px; }
.ce-pal-gtitle {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #7d7a73;
}
.ce-pal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 6px;
}
.ce-pal-tile {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 9px;
  border: 1px solid #2a2b2f;
  border-radius: 9px;
  background: #1b1c21;
  color: #cfccc4;
  font-size: 12px;
  cursor: grab;
  touch-action: manipulation;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ce-pal-tile .material-symbols-outlined { font-size: 17px; color: #8a8986; }
.ce-pal-tile em { font-style: normal; font-weight: 600; }
.ce-pal-tile:hover {
  background: #23242a;
  border-color: rgba(245, 166, 35, 0.45);
  color: #f5a623;
}
.ce-pal-tile:hover .material-symbols-outlined { color: #f5a623; }
.ce-pal-tile:active { cursor: grabbing; }
.ce-pal-msg {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(94, 196, 176, 0.12);
  color: #5ec4b0;
  font-size: 11px;
  line-height: 1.5;
}
.ce-pal-msg.err { background: rgba(240, 110, 110, 0.12); color: #f08a8a; }
.ce-pal-msg .material-symbols-outlined { font-size: 14px; flex: none; margin-top: 1px; }

/* ================= 图层页 ================= */
.ce-ly-empty { margin: 0; font-size: 12px; color: #7d7a73; }
.ce-ly-row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: #1b1c21;
  color: #cfccc4;
  font-size: 12px;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.15s, border-color 0.15s;
}
.ce-ly-row:hover { background: #23242a; }
.ce-ly-row.on {
  border-color: rgba(245, 166, 35, 0.5);
  background: rgba(245, 166, 35, 0.12);
  color: #f5a623;
}
.ce-ly-row.surf { color: #7d7a73; }
.ce-ly-row.drop { box-shadow: 0 -2px 0 0 #f5a623; }
.ce-ly-ic { font-size: 15px; flex: none; color: #8a8986; }
.ce-ly-row.on .ce-ly-ic { color: #f5a623; }
.ce-ly-name {
  font-style: normal;
  font-weight: 600;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-ly-acts { flex: none; display: flex; gap: 2px; }
.ce-ly-acts button {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8a8986;
  cursor: pointer;
}
.ce-ly-acts button .material-symbols-outlined { font-size: 14px; }
.ce-ly-acts button:hover { background: rgba(245, 166, 35, 0.16); color: #f5a623; }
.ce-ly-acts button:disabled { opacity: 0.3; cursor: default; }
.ce-ly-acts button:disabled:hover { background: transparent; color: #8a8986; }

/* 元素代码视图：只编辑选中元素的 HTML */
.ce-elcode {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ce-elcode-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid #2a2b2f;
  border-radius: 12px;
  background: #1b1c20;
  font-size: 12px;
  color: #d8d6cf;
}
.ce-elcode-head > .material-symbols-outlined { font-size: 15px; color: #f5a623; flex: none; }
.ce-elcode-title { font-weight: 700; flex: none; }
.ce-elcode-desc {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: #8fbce4;
  background: rgba(107, 163, 217, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-elcode-editor { flex: 1 1 auto; min-height: 0; }
.ce-elcode-err {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 6px 12px;
  font-size: 11px;
  color: #f09185;
  background: rgba(232, 93, 76, 0.08);
  border: 1px solid rgba(232, 93, 76, 0.25);
  border-radius: 10px;
}
.ce-elcode-err .material-symbols-outlined { font-size: 13px; flex: none; }

/* 元素属性面板：设计模式下占满原代码编辑区（属性条由 VisualStage 注入） */
.ce-design-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  background: #1b1c20;
  border: 1px solid #2a2b2f;
  border-radius: 12px;
  padding: 10px 12px;
}
.ce-design-panel:has(.ve-bar) { padding: 0; }
.ce-dp-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  color: #8a8986;
  padding: 20px;
}
.ce-dp-placeholder > .material-symbols-outlined {
  font-size: 38px;
  color: #f5a623;
  opacity: 0.85;
}
.ce-dp-title { margin: 0; font-size: 14px; font-weight: 700; color: #e8e5dd; }
.ce-dp-guides {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
}
.ce-dp-guides li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: #a3a19b;
}
.ce-dp-guides .material-symbols-outlined {
  font-size: 17px;
  color: #5ec4b0;
  flex: none;
}
/* 属性条注入后隐藏占位提示 */
.ce-design-panel:has(.ve-bar) .ce-dp-placeholder { display: none; }
.ce-field {
  background: #1b1c20;
  border: 1px solid #2a2b2f;
  border-radius: 12px;
  padding: 11px 13px;
  position: relative;
}
.ce-slot-box { position: relative; overflow: visible; z-index: 2; }
/* 槽位框在主实体之下时需要提升层级，防止下拉被下一个槽位框盖住 */
.ce-slot-box + .ce-slot-box { z-index: 1; }
.ce-field-entity { flex: 1 1 260px; min-width: 220px; }
.ce-field-size { flex: none; display: flex; flex-direction: column; gap: 7px; }
.ce-field-icon { flex: 0 1 auto; min-width: 0; }
.ce-label {
  display: block;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6f6e6a;
  font-weight: 700;
  margin-bottom: 7px;
}
.ce-label-sub {
  float: right;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 10px;
  font-weight: 600;
  color: #f5a623;
}

/* 多实体（通用卡） */
.ce-multi-box { display: flex; flex-direction: column; gap: 6px; }
.ce-multi-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 132px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ce-multi-item { background: #141518; border: 1px solid #2e2f33; cursor: default; }
.ce-multi-item:hover { background: #17181b; }
/* ===== 槽位框折叠态 / 展开态 ===== */
.ce-slot-collapsed {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}
.ce-slot-num {
  font-size: 17px;
  font-weight: 800;
  color: #f5a623;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.ce-slot-num-sub {
  font-size: 9px;
  color: #6f6e6a;
  margin-right: auto;
}
.ce-slot-act { flex: none; }
.ce-slot-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}
.ce-primary-tag {
  flex: none;
  font-size: 9px;
  font-weight: 700;
  color: #f5a623;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid rgba(245, 166, 35, 0.3);
  border-radius: 5px;
  padding: 1px 5px;
}
/* chip 右侧按钮组（上移 / 下移 / 删除） */
.ce-multi-act { display: inline-flex; align-items: center; gap: 1px; flex: none; margin-left: auto; }
.ce-multi-mv {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: #8a8a8a;
  border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.ce-multi-mv:hover:not(:disabled) { background: #2a2b2f; color: #d0d0d0; }
.ce-multi-mv:disabled { opacity: 0.3; cursor: not-allowed; }
.ce-multi-mv .material-symbols-outlined { font-size: 13px; line-height: 1; }
.ce-multi-del {
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: #6f6e6a;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ce-multi-del .material-symbols-outlined { font-size: 14px; }
.ce-multi-del:hover { color: #ff7a7a; background: rgba(255, 122, 122, 0.1); }
.ce-add-entity {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 8px;
  background: transparent;
  border: 1px dashed rgba(245, 166, 35, 0.45);
  color: #f5a623;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ce-add-entity .material-symbols-outlined { font-size: 17px; }
.ce-add-entity:hover { background: rgba(245, 166, 35, 0.08); border-color: #f5a623; }
.ce-dd-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid #2e2f33;
}
.ce-dd-tip { flex: 1; min-width: 0; font-size: 11px; color: #6f6e6a; }

/* 实体下拉 */
.ce-combobox { position: relative; }
.ce-combo-btn {
  width: 100%;
  min-height: 34px;
  height: auto;
  padding: 6px 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 8px;
  border-radius: 8px;
  background: #141518;
  border: 1px solid #2e2f33;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
}
.ce-combo-btn:hover { border-color: rgba(245, 166, 35, 0.45); background: #17181b; }
.ce-combo-name {
  font-size: 12.5px;
  color: #e8e5dd;
  font-weight: 600;
  /* 不压缩实体名：允许换行完整显示 */
  white-space: normal;
  word-break: break-all;
  overflow: visible;
  min-width: 0;
  flex: 1 1 auto;
}
.ce-combo-id {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: #6f6e6a;
  /* 实体 ID 独占一行完整显示，不被压缩 */
  white-space: normal;
  word-break: break-all;
  overflow: visible;
  flex: 0 0 100%;
}
.ce-combo-empty { font-size: 12.5px; color: #6f6e6a; }
.ce-combo-caret { margin-left: auto; font-size: 18px; color: #8a8986; flex: none; }
.ce-domain-badge {
  flex: none;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #6ba3d9;
  background: rgba(107, 163, 217, 0.12);
  border: 1px solid rgba(107, 163, 217, 0.25);
  border-radius: 5px;
  padding: 2px 6px;
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  background: #1a1b1f;
  border: 1px solid #34353b;
  border-radius: 11px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.ce-menu-enter-active, .ce-menu-leave-active { transition: all 0.16s ease; transform-origin: top; }
.ce-menu-enter-from, .ce-menu-leave-to { opacity: 0; transform: scaleY(0.96) translateY(-4px); }
.ce-search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 9px;
  padding: 0 9px;
  height: 32px;
  border-radius: 8px;
  background: #121316;
  border: 1px solid #2e2f33;
}
.ce-search .material-symbols-outlined { font-size: 16px; color: #6f6e6a; }
.ce-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12.5px;
  color: #e8e5dd;
}
.ce-search-input::placeholder { color: #5c5b58; }
.ce-entity-list { list-style: none; margin: 0; padding: 0 6px 6px; max-height: 224px; overflow-y: auto; }
.ce-entity-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.ce-entity-item:hover { background: rgba(245, 166, 35, 0.09); }
.ce-entity-item.on { background: rgba(245, 166, 35, 0.13); }
.ce-en-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.ce-en-name {
  font-size: 12.5px;
  color: #e8e5dd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-en-id {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: #6f6e6a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-en-check { font-size: 17px; color: #f5a623; flex: none; }
.ce-entity-empty { padding: 14px 10px; font-size: 12px; color: #6f6e6a; text-align: center; }

/* 尺寸点选 */
.ce-sizepick {
  display: grid;
  grid-template-columns: repeat(4, 18px);
  grid-auto-rows: 18px;
  gap: 5px;
}
.ce-size-cell {
  border-radius: 4px;
  background: #2b2c31;
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 0.1s, transform 0.08s;
}
.ce-size-cell:hover { transform: scale(1.08); }
.ce-size-cell.hover { background: rgba(245, 166, 35, 0.4); }
.ce-size-cell.on { background: #f5a623; border-color: #f5a623; box-shadow: 0 0 8px rgba(245, 166, 35, 0.35); }
.ce-size-text { font-size: 11px; color: #8a8986; white-space: nowrap; }

/* 自定义图标 */
.ce-icon-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ce-icon-preview {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1b1e;
  border: 1px solid #2e2f33;
  border-radius: 8px;
}
.ce-icon-preview .material-symbols-outlined { font-size: 17px; color: #8a8986; }
.ce-icon-input {
  flex: 1 0 160px;
  min-width: 160px;
  height: 30px;
  padding: 0 9px;
  font: 11px/1 ui-monospace, Menlo, Consolas, monospace;
  color: #d8d6cf;
  background: #1a1b1e;
  border: 1px solid #2e2f33;
  border-radius: 8px;
  outline: none;
}
.ce-icon-input:focus { border-color: rgba(94, 196, 176, 0.45); }
.ce-icon-sugs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.ce-icon-sug {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1b1e;
  border: 1px solid #2e2f33;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s;
}
.ce-icon-sug .material-symbols-outlined { font-size: 15px; color: #8a8986; }
.ce-icon-sug:hover { border-color: #3a3b40; background: #232428; }
.ce-icon-sug.on { border-color: rgba(94, 196, 176, 0.5); background: rgba(94, 196, 176, 0.08); }
.ce-icon-sug.on .material-symbols-outlined { color: #5ec4b0; }

/* 自定义头像（人员位置卡） */
.ce-avatar-row { display: flex; align-items: center; gap: 8px; }
.ce-avatar-preview {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1b1e;
  border: 1px solid #2e2f33;
}
.ce-avatar-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ce-avatar-preview .material-symbols-outlined { font-size: 20px; color: #8a8986; }
.ce-avatar-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ce-hidden-input { display: none; }

/* Tabs */
.ce-tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-bottom: 1px solid #2a2b2f;
}
.ce-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: #8a8986;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  margin-bottom: -1px;
  border-radius: 8px 8px 0 0;
}
.ce-tab:hover { color: #d8d6cf; }
.ce-tab.on {
  color: #f2f0eb;
  border-bottom-color: #f5a623;
  background: rgba(245, 166, 35, 0.07);
}
.ce-lang-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-html { background: #f5a623; }
.dot-css { background: #6ba3d9; }
.dot-js { background: #5ec4b0; }
.ce-tab-len {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10px;
  color: #5c5b58;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 1px 5px;
}
.ce-tab.on .ce-tab-len { color: #b8944f; background: rgba(245, 166, 35, 0.1); }
.ce-tab-hint { font-size: 10.5px; color: #5c5b58; display: flex; align-items: center; gap: 3px; padding-right: 8px; }

/* 代码编辑区 */
.ce-code {
  flex: 1;
  min-height: 160px;
  display: flex;
  border: 1px solid #2a2b2f;
  border-radius: 12px;
  overflow: hidden;
  background: #121316;
}
.ce-gutter {
  flex: none;
  width: 46px;
  overflow: hidden;
  background: #141519;
  border-right: 1px solid #232428;
}
.ce-gutter-inner { padding: 10px 0; will-change: transform; }
.ce-gutter-line {
  height: 20px;
  padding-right: 10px;
  text-align: right;
  font: 12px/20px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: #4c4d52;
  user-select: none;
}
.ce-code-scroll { position: relative; flex: 1; min-width: 0; }
.ce-pre,
.ce-ta {
  margin: 0;
  padding: 10px 14px;
  font: 12.5px/20px ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Roboto Mono', monospace;
  letter-spacing: 0;
  tab-size: 2;
  white-space: pre;
  border: 0;
}
.ce-pre {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: #c9c7c0;
  background: transparent;
}
.ce-pre code { font: inherit; white-space: pre; }
.ce-ta {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  resize: none;
  overflow: auto;
  color: transparent;
  caret-color: #f5a623;
  background: transparent;
  outline: none;
  -webkit-text-fill-color: transparent;
}
.ce-ta::selection {
  background: rgba(245, 166, 35, 0.2);
  color: transparent;
}
/* 中文输入法组词期间临时显示文字（常态文字透明，仅显示下层语法高亮） */
.ce-ta.is-composing {
  color: #d8d6cf;
  -webkit-text-fill-color: #d8d6cf;
}
.ce-ta::placeholder { color: #4c4d52; }

/* 语法 token 配色 */
.ce-pre :deep(.tok-comment) { color: #5f6369; font-style: italic; }
.ce-pre :deep(.tok-tag) { color: #7dd3fc; }
.ce-pre :deep(.tok-punct) { color: #7dd3fc; }
.ce-pre :deep(.tok-attr) { color: #e5c07b; }
.ce-pre :deep(.tok-str) { color: #98c379; }
.ce-pre :deep(.tok-ph) { color: #f5a623; font-weight: 700; }
.ce-pre :deep(.tok-kw) { color: #c792ea; }
.ce-pre :deep(.tok-num) { color: #d19a66; }
.ce-pre :deep(.tok-sel) { color: #82aaff; }
.ce-pre :deep(.tok-prop) { color: #79c0ff; }
.ce-pre :deep(.tok-hc) { color: #f5a623; font-style: italic; font-weight: 600; }
.ce-pre :deep(.tok-arg) { color: #5ec4b0; }

/* ================= 状态栏 ================= */
.ce-status {
  flex: none;
  height: 34px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-top: 1px solid #2a2b2f;
  background: rgba(255, 255, 255, 0.015);
  font-size: 11px;
  color: #6f6e6a;
  overflow: hidden;
}
.ce-status-item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ce-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #5ec4b0; }
.ce-dirty-state { color: #6f6e6a; }
.ce-dirty-state .ce-status-dot { background: #6f6e6a; }
.ce-dirty-state.on { color: #e8c483; }
.ce-dirty-state.on .ce-status-dot { background: #f5a623; box-shadow: 0 0 6px rgba(245, 166, 35, 0.8); }
.ce-hint { flex: none; }
.ce-hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: #8a8986;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 5px;
  padding: 2px 6px;
  white-space: nowrap;
}

/* ================= 动效 ================= */
.ce-enter-active, .ce-leave-active { transition: opacity 0.2s ease; }
.ce-enter-active .ce-panel, .ce-leave-active .ce-panel { transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease; }
.ce-enter-from, .ce-leave-to { opacity: 0; }
.ce-enter-from .ce-panel, .ce-leave-to .ce-panel { transform: translateY(14px) scale(0.985); opacity: 0; }

/* ================= 响应式：窄屏上下布局 ================= */
@media (max-width: 860px) {
  .ce-overlay { padding: 0; }
  .ce-panel { border-radius: 0; border-left: none; border-right: none; }
  .ce-body { flex-direction: column; padding: 10px; gap: 10px; }
  .ce-preview-col { flex: none; height: 34vh; }
  .ce-edit-col { flex: 1; }
  .ce-btn-text { display: none; }
  .ce-kbd { display: none; }
  .ce-config { flex-direction: column; }
  .ce-tab-hint { display: none; }
  .ce-hint { display: none; }
}
</style>

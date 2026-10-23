<template>
  <Teleport to="body">
    <div class="hc-rb-mask" @click.self="$emit('skip')">
      <div class="hc-rb-dialog">
        <div class="hc-rb-head">
          <span class="material-symbols-outlined hc-rb-head-icon">{{ template.icon }}</span>
          <div class="hc-rb-head-txt">
            <div class="hc-rb-title">绑定实体 · {{ template.name }}</div>
            <div class="hc-rb-sub">把模板中的角色映射到你的 Home Assistant 实体</div>
          </div>
        </div>

        <div class="hc-rb-roles">
          <div v-for="role in template.roles" :key="role.key" class="hc-rb-role">
            <div class="hc-rb-role-meta">
              <span class="hc-rb-role-label">
                {{ role.label }}<i v-if="role.required" class="hc-rb-req">*</i>
              </span>
              <span class="hc-rb-role-domains">{{ role.domains.join(' / ') }}</span>
            </div>
            <!-- 实体选择：搜索 + 单选列表（按角色域过滤） -->
            <input
              v-model="filters[role.key]"
              class="hc-rb-filter"
              :placeholder="`搜索 ${role.domains.join('/')} 实体…`"
            />
            <div class="hc-rb-list">
              <label
                v-for="e in listFor(role)"
                :key="e.id"
                class="hc-rb-item"
                :class="{ 'is-on': map[role.key] === e.id }"
              >
                <input type="radio" :name="role.key" :value="e.id" v-model="map[role.key]" />
                <span class="hc-rb-item-name">{{ e.name }}</span>
                <span class="hc-rb-item-id">{{ e.id }}</span>
              </label>
              <div v-if="!listFor(role).length" class="hc-rb-empty">无匹配实体</div>
            </div>
          </div>
        </div>

        <div class="hc-rb-actions">
          <button class="hc-rb-btn" @click="$emit('skip')">稍后再绑</button>
          <button class="hc-rb-btn hc-rb-btn-primary" :disabled="!valid" @click="onConfirm">
            完成，进入设计
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { entityStates } from '@/store'

const props = defineProps({
  template: { type: Object, required: true },
})
const emit = defineEmits(['confirm', 'skip'])

// role.key → 选中的实体 id；role.key → 搜索词
const map = reactive({})
const filters = reactive({})

const allEntities = computed(() =>
  Object.values(entityStates)
    .map((e) => ({ id: e.entity_id, name: e.friendly_name || e.entity_id, domain: e.domain || e.entity_id.split('.')[0] }))
    .sort((a, b) => a.id.localeCompare(b.id)),
)

function listFor(role) {
  const q = (filters[role.key] || '').trim().toLowerCase()
  return allEntities.value
    .filter((e) => !role.domains?.length || role.domains.includes(e.domain))
    .filter((e) => !q || e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    .slice(0, 50)
}

// 必填角色都已选择才可确认
const valid = computed(() =>
  (props.template.roles || []).every((r) => !r.required || map[r.key]),
)

function onConfirm() {
  emit('confirm', { ...map })
}
</script>

<style scoped>
.hc-rb-mask {
  position: fixed;
  inset: 0;
  z-index: 10001;
  background: rgb(0 0 0 / .55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hc-rb-dialog {
  width: min(94vw, 520px);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  padding: 18px;
  border-radius: 14px;
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  border: 1px solid rgb(var(--c-border));
  box-shadow: 0 12px 40px rgb(0 0 0 / .4);
}
.hc-rb-head { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.hc-rb-head-icon {
  font-size: 26px;
  color: var(--hc-color, var(--hc-primary));
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--hc-primary) 14%, transparent);
  border-radius: 12px;
}
.hc-rb-title { font-size: 14px; font-weight: 700; }
.hc-rb-sub { font-size: 11px; color: rgb(var(--c-muted)); margin-top: 2px; }
.hc-rb-roles {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 4px;
}
.hc-rb-role { display: flex; flex-direction: column; gap: 6px; }
.hc-rb-role-meta { display: flex; align-items: baseline; justify-content: space-between; }
.hc-rb-role-label { font-size: 12px; font-weight: 600; }
.hc-rb-req { color: rgb(var(--c-error)); font-style: normal; margin-left: 2px; }
.hc-rb-role-domains { font-size: 9px; color: rgb(var(--c-muted)); font-family: monospace; }
.hc-rb-filter {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.hc-rb-filter:focus { border-color: var(--hc-color, var(--hc-primary)); }
.hc-rb-list {
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-background));
  padding: 3px;
  display: flex;
  flex-direction: column;
}
.hc-rb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
}
.hc-rb-item:hover { background: rgb(var(--c-surface-alt)); }
.hc-rb-item.is-on { background: color-mix(in srgb, var(--hc-primary) 14%, transparent); }
.hc-rb-item input { accent-color: var(--hc-color, var(--hc-primary)); }
.hc-rb-item-name { color: rgb(var(--c-on-surface)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-rb-item-id {
  margin-left: auto;
  font-size: 9px;
  color: rgb(var(--c-muted));
  font-family: monospace;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hc-rb-empty { padding: 12px; text-align: center; font-size: 10px; color: rgb(var(--c-muted)); }
.hc-rb-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.hc-rb-btn {
  padding: 8px 16px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid rgb(var(--c-border));
  background: transparent;
  color: rgb(var(--c-on-surface));
  cursor: pointer;
}
.hc-rb-btn-primary {
  background: var(--hc-color, var(--hc-primary));
  border-color: var(--hc-color, var(--hc-primary));
  color: #000;
  font-weight: 600;
}
.hc-rb-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
</style>

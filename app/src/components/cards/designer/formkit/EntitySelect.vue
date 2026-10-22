<template>
  <div class="fk-entity-select">
    <!-- 已选实体展示区 -->
    <div
      class="fk-es-display"
      :class="{ 'is-open': isOpen }"
      :tabindex="0"
      @click="toggleOpen"
      @keydown.enter.prevent="toggleOpen"
      @keydown.esc.prevent="close"
    >
      <template v-if="multiple && modelArray.length">
        <span
          v-for="eid in modelArray"
          :key="eid"
          class="fk-es-chip"
        >
          <span class="fk-es-chip-fn">{{ friendlyName(eid) }}</span>
          <span class="fk-es-chip-id">{{ eid }}</span>
          <span class="fk-es-chip-x" @click.stop="removeOne(eid)">×</span>
        </span>
      </template>
      <template v-else-if="!multiple && modelValue">
        <span class="fk-es-chip">
          <span class="fk-es-chip-fn">{{ friendlyName(modelValue) }}</span>
          <span class="fk-es-chip-id">{{ modelValue }}</span>
        </span>
      </template>
      <span v-else class="fk-es-placeholder">{{ placeholderText }}</span>
      <span class="fk-es-caret material-symbols-outlined" :class="{ flip: isOpen }">expand_more</span>
    </div>

    <!-- 下拉面板 -->
    <div
      v-if="isOpen"
      class="fk-es-panel"
      @click.stop
    >
      <input
        ref="searchRef"
        v-model="search"
        class="fk-es-search"
        placeholder="搜索实体..."
        @keydown.enter.prevent="selectFirst"
        @keydown.esc.prevent="close"
      />
      <div v-if="filtered.length === 0" class="fk-es-empty">无匹配实体</div>
      <div class="fk-es-list">
        <div
          v-for="e in filtered"
          :key="e.entity_id"
          class="fk-es-item"
          :class="{ 'is-selected': isSelected(e.entity_id) }"
          @click="toggleEntity(e.entity_id)"
        >
          <span class="fk-es-domain">{{ e.domain }}</span>
          <span class="fk-es-fn">{{ e.friendly_name || e.entity_id }}</span>
          <span class="fk-es-eid">{{ e.entity_id }}</span>
          <span v-if="isSelected(e.entity_id)" class="fk-es-check material-symbols-outlined">check</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { store } from '@/store'

// FormKit 自定义 input：createInput 只会注入 context（$node.context），
// 不通过 v-model 传值，因此读写一律走 context.value / context.node.input。
const props = defineProps({
  context: { type: Object, required: true },
  multiple: { type: Boolean, default: false },
  entityDomains: { type: Array, default: null }, // 可选 domain 过滤
})

const search = ref('')
const isOpen = ref(false)
const searchRef = ref(null)

const modelValue = computed(() => props.context?.value)
const modelArray = computed(() => {
  if (Array.isArray(modelValue.value)) return modelValue.value
  return modelValue.value ? [modelValue.value] : []
})

// runListeners=false：自定义输入只写值，不触发 FormKit 的输入校验钩子
function setValue(v) {
  props.context?.node?.input(v, false)
}

// 可用实体列表：从 store.entityStates 取
const allEntities = computed(() => {
  // 遍历 store.entityStates，拿 instance 对应的那部分；entityStates 按 entity_id 索引
  // store.entityStates 是 reactive({ [entity_id]: { entity_id, domain, friendly_name, ... } })
  const list = Object.values(store.entityStates || {})
  return list.filter((e) => {
    if (!e || !e.entity_id) return false
    if (props.entityDomains && props.entityDomains.length) {
      return props.entityDomains.includes(e.domain)
    }
    return true
  })
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = allEntities.value
  if (!q) return list
  return list.filter((e) => {
    const eid = String(e.entity_id).toLowerCase()
    const fn = String(e.friendly_name || '').toLowerCase()
    const dom = String(e.domain || '').toLowerCase()
    return eid.includes(q) || fn.includes(q) || dom.includes(q)
  })
})

const placeholderText = computed(() => props.multiple ? '选择实体（可多选）' : '选择实体')

function friendlyName(eid) {
  const e = store.entityStates?.[eid]
  if (!e) return eid
  return e.friendly_name || eid
}

function isSelected(eid) {
  return modelArray.value.includes(eid)
}

function toggleEntity(eid) {
  if (props.multiple) {
    const has = isSelected(eid)
    if (has) {
      setValue(modelArray.value.filter((x) => x !== eid))
    } else {
      setValue([...modelArray.value, eid])
    }
  } else {
    setValue(isSelected(eid) ? '' : eid)
    close()
  }
}

function removeOne(eid) {
  if (props.multiple) {
    setValue(modelArray.value.filter((x) => x !== eid))
  } else {
    setValue('')
  }
}

function toggleOpen() {
  isOpen.value ? close() : open()
}

function open() {
  isOpen.value = true
  nextTick(() => { searchRef.value?.focus() })
}

function close() {
  isOpen.value = false
  search.value = ''
}

function selectFirst() {
  if (filtered.value.length > 0) {
    toggleEntity(filtered.value[0].entity_id)
  }
}

// 点击外部关闭
function onClickOutside(e) {
  if (!isOpen.value) return
  if (!e.target.closest('.fk-entity-select')) close()
}

onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))
</script>

<style scoped>
.fk-entity-select {
  position: relative;
  width: 100%;
}
.fk-es-display {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  min-height: 26px;
  padding: 3px 22px 3px 4px;
  border-radius: 6px;
  border: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  cursor: pointer;
  position: relative;
  transition: border-color .15s, box-shadow .15s;
}
.fk-es-display.is-open {
  border-color: var(--hc-color, var(--hc-primary));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--hc-primary) 18%, transparent);
}
.fk-es-display:focus {
  outline: none;
}
.fk-es-caret {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  color: rgb(var(--c-muted));
  transition: transform .15s;
  pointer-events: none;
}
.fk-es-caret.flip { transform: translateY(-50%) rotate(180deg); }
.fk-es-placeholder {
  font-size: 11px;
  color: rgb(var(--c-muted));
  padding: 0 4px;
}
.fk-es-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 4px;
  font-size: 10px;
  border-radius: 4px;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  max-width: 100%;
}
.fk-es-chip-fn { color: rgb(var(--c-on-surface)); max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fk-es-chip-id { color: rgb(var(--c-muted)); font-family: monospace; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fk-es-chip-x {
  color: rgb(var(--c-muted));
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 1px;
}
.fk-es-chip-x:hover { color: rgb(var(--c-error)); }

.fk-es-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / .25);
  z-index: 100;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.fk-es-search {
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  border: none;
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-surface));
  color: rgb(var(--c-on-surface));
  outline: none;
}
.fk-es-search:focus { box-shadow: inset 0 0 0 1px var(--hc-color, var(--hc-primary)); }
.fk-es-list {
  overflow-y: auto;
  flex: 1;
}
.fk-es-empty {
  font-size: 11px;
  color: rgb(var(--c-muted));
  padding: 10px;
  text-align: center;
}
.fk-es-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: background .1s;
}
.fk-es-item:hover { background: rgb(var(--c-surface-alt)); }
.fk-es-item.is-selected { background: color-mix(in srgb, var(--hc-primary) 14%, transparent); }
.fk-es-domain {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  text-transform: uppercase;
  letter-spacing: .03em;
  font-family: monospace;
}
.fk-es-item.is-selected .fk-es-domain {
  background: var(--hc-color, var(--hc-primary));
  color: #000;
}
.fk-es-fn { color: rgb(var(--c-on-surface)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fk-es-eid { color: rgb(var(--c-muted)); font-family: monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fk-es-check { font-size: 14px; color: var(--hc-color, var(--hc-primary)); }
</style>

<!-- 户型图工具栏：2D/3D 切换、编辑开关（仅桌面）、楼层增删、背景图上传、画墙/画房间工具、保存状态。 -->
<template>
  <div class="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-border bg-background/60 backdrop-blur-sm">
    <!-- 2D / 3D 切换 -->
    <div class="flex rounded-lg border border-border overflow-hidden" role="tablist" aria-label="视图模式">
      <button
        class="px-3 py-1.5 text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="view === '2d' ? 'bg-primary text-on-primary' : 'bg-surface-alt text-muted hover:text-on-surface'"
        role="tab" :aria-selected="view === '2d'" @click="$emit('update:view', '2d')"
      >2D</button>
      <button
        class="px-3 py-1.5 text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="view === '3d' ? 'bg-primary text-on-primary' : 'bg-surface-alt text-muted hover:text-on-surface'"
        role="tab" :aria-selected="view === '3d'" @click="$emit('update:view', '3d')"
      >3D</button>
    </div>

    <!-- 测量工具（2D 下随时可用，无需进入编辑） -->
    <button
      v-if="view === '2d'"
      class="flex items-center justify-center w-8 h-8 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      :class="tool === 'measure' ? 'bg-info/15 border-info/50 text-info' : 'border-border bg-surface-alt text-muted hover:text-on-surface'"
      :aria-pressed="tool === 'measure'" title="测量：点击两点测距离，Esc 清除" aria-label="测量工具"
      @click="$emit('update:tool', tool === 'measure' ? '' : 'measure')"
    >
      <span class="material-symbols-outlined text-sm" aria-hidden="true">straighten</span>
    </button>

    <!-- 编辑开关（仅桌面可用；移动端隐藏） -->
    <template v-if="canEdit">
      <button
        class="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="editMode ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-alt border-border text-muted hover:text-on-surface'"
        :aria-pressed="editMode" @click="$emit('toggle-edit')"
      >
        <span class="material-symbols-outlined text-sm" aria-hidden="true">{{ editMode ? 'edit_off' : 'edit' }}</span>
        {{ editMode ? '退出编辑' : '编辑' }}
      </button>

      <template v-if="editMode">
        <!-- 撤销 / 重做 -->
        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-surface-alt text-muted hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          :disabled="!canUndo" title="撤销（Ctrl+Z）" aria-label="撤销" @click="$emit('undo')"
        ><span class="material-symbols-outlined text-sm" aria-hidden="true">undo</span></button>
        <button
          class="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-surface-alt text-muted hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          :disabled="!canRedo" title="重做（Ctrl+Shift+Z）" aria-label="重做" @click="$emit('redo')"
        ><span class="material-symbols-outlined text-sm" aria-hidden="true">redo</span></button>

        <!-- 绘制工具 -->
        <button
          v-for="t in tools" :key="t.key"
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          :class="tool === t.key ? 'bg-info/15 border-info/50 text-info' : 'bg-surface-alt border-border text-muted hover:text-on-surface'"
          :aria-pressed="tool === t.key" :title="t.hint" @click="$emit('update:tool', tool === t.key ? '' : t.key)"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">{{ t.icon }}</span>{{ t.label }}
        </button>

        <!-- 背景图上传 -->
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="上传背景底图" @click="pickBg"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">image</span>底图
        </button>
        <input ref="bgInput" type="file" accept="image/*" class="hidden" @change="onBgFile" aria-hidden="true" />

        <!-- 楼层管理 -->
        <button
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="添加楼层" @click="$emit('add-floor')"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">add_home</span>楼层
        </button>
        <button
          v-if="floorCount > 1"
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
          title="删除当前楼层" aria-label="删除当前楼层" @click="$emit('del-floor')"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">delete</span>
        </button>
      </template>
    </template>

    <!-- 保存（显式按钮 + 状态反馈） -->
    <div class="ml-auto flex items-center gap-2">
      <span
        v-if="saveState === 'saved' || saveState === 'error'"
        class="text-[11px] font-body"
        :class="saveState === 'error' ? 'text-error' : 'text-muted'"
        aria-live="polite"
      >{{ saveState === 'saved' ? '已保存' : '保存失败' }}</span>
      <button
        class="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
        :class="saveState === 'error' ? 'bg-error/10 border-error/50 text-error' : 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/20'"
        :disabled="saveState === 'saving'" title="保存户型图" @click="$emit('save')"
      >
        <span class="material-symbols-outlined text-sm" :class="saveState === 'saving' ? 'animate-spin' : ''" aria-hidden="true">
          {{ saveState === 'saving' ? 'sync' : 'save' }}
        </span>
        {{ saveState === 'saving' ? '保存中…' : '保存' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { compressImage } from '@/utils/floorplanDoc'

const props = defineProps({
  view: { type: String, default: '2d' },
  editMode: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
  tool: { type: String, default: '' },
  saveState: { type: String, default: 'idle' }, // idle | saving | saved | error
  floorCount: { type: Number, default: 1 },
  canUndo: { type: Boolean, default: false },
  canRedo: { type: Boolean, default: false },
})
const emit = defineEmits(['update:view', 'update:tool', 'toggle-edit', 'add-floor', 'del-floor', 'bg-upload', 'save', 'undo', 'redo'])

const tools = [
  { key: 'wall', label: '画墙', icon: 'draw', hint: '单击落点，回车或「完成」结束' },
  { key: 'room', label: '画房间', icon: 'meeting_room', hint: '单击落点围合，回车闭合' },
  { key: 'floor', label: '地板', icon: 'grid_on', hint: '单击落点画地板轮廓，回车闭合' },
  { key: 'door', label: '门', icon: 'door_front', hint: '单击墙段放置门' },
  { key: 'window', label: '窗', icon: 'window', hint: '单击墙段放置窗' },
]

// ---- 背景图上传：压缩为 dataURL ----
const bgInput = ref(null)
function pickBg() { bgInput.value && bgInput.value.click() }
async function onBgFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const dataUrl = await compressImage(file)
  if (dataUrl) emit('bg-upload', dataUrl)
}
</script>

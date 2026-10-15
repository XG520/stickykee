<!-- 编辑态选中设备的设置弹窗：图标类型（内置/图片/代码）、状态配色映射、尺寸、删除。
     代码模式提供 html/css/js 三 tab 编辑，复用卡片的模板占位符与作用域 CSS 体系。
     所有修改直接写入 props.device（文档响应式对象），父级深监听自动防抖保存。 -->
<template>
  <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
    <div class="absolute inset-0 bg-black/50" @click="$emit('close')"></div>
    <div class="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-background border border-border shadow-2xl">
      <!-- 头部 -->
      <div class="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-background/95 backdrop-blur border-b border-border">
        <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-surface-alt border border-border overflow-hidden">
          <DeviceIconRenderer :device="device" :entity="entity" :size="32" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-headline font-bold text-base text-on-background truncate leading-tight">{{ name }}</h2>
          <p class="font-body text-xs text-muted truncate">{{ device.entityId || '未绑定实体' }}</p>
        </div>
        <button class="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-on-surface hover:bg-faint/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" @click="$emit('close')" aria-label="关闭设置">
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>

      <div class="px-4 py-4 space-y-4">
        <!-- 图标类型 -->
        <section>
          <h3 class="font-body text-sm font-semibold text-on-surface mb-2">图标类型</h3>
          <div class="flex rounded-lg border border-border overflow-hidden" role="tablist" aria-label="图标类型">
            <button
              v-for="t in kinds" :key="t.key"
              class="flex-1 px-2 py-1.5 text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              :class="device.icon.kind === t.key ? 'bg-primary text-on-primary' : 'bg-surface-alt text-muted hover:text-on-surface'"
              role="tab" :aria-selected="device.icon.kind === t.key" @click="device.icon.kind = t.key"
            >{{ t.label }}</button>
          </div>

          <!-- 内置图标选择器 -->
          <div v-if="device.icon.kind === 'material'" class="mt-3">
            <div class="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto overscroll-contain pr-1">
              <button
                v-for="c in ICON_CHOICES" :key="c"
                class="aspect-square rounded-lg flex items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :class="device.icon.name === c ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-surface-alt text-muted hover:text-on-surface'"
                :title="c" :aria-label="'图标 ' + c" @click="device.icon.name = c"
              >
                <span class="material-symbols-outlined text-lg" aria-hidden="true">{{ c }}</span>
              </button>
            </div>
          </div>

          <!-- 图片上传 -->
          <div v-else-if="device.icon.kind === 'image'" class="mt-3 flex items-center gap-3">
            <div class="w-14 h-14 rounded-xl border border-border bg-surface-alt flex items-center justify-center overflow-hidden shrink-0">
              <img v-if="device.icon.dataUrl" :src="device.icon.dataUrl" class="w-full h-full object-contain" alt="设备图标预览" />
              <span v-else class="material-symbols-outlined text-muted" aria-hidden="true">image</span>
            </div>
            <div class="space-y-1.5">
              <button class="px-3 py-1.5 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" @click="pickIcon">
                {{ device.icon.dataUrl ? '更换图片' : '上传图片' }}
              </button>
              <p class="text-[10px] font-body text-muted">自动压缩为小图存储</p>
            </div>
            <input ref="iconInput" type="file" accept="image/*" class="hidden" @change="onIconFile" aria-hidden="true" />
          </div>

          <!-- 代码编辑 -->
          <div v-else class="mt-3 space-y-2">
            <div class="flex rounded-lg border border-border overflow-hidden" role="tablist" aria-label="代码页签">
              <button
                v-for="t in codeTabs" :key="t"
                class="flex-1 px-2 py-1 text-xs font-body font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :class="codeTab === t ? 'bg-info text-on-primary' : 'bg-surface-alt text-muted hover:text-on-surface'"
                role="tab" :aria-selected="codeTab === t" @click="codeTab = t"
              >{{ t }}</button>
            </div>
            <textarea
              v-model="device.icon.code[codeTab]"
              class="w-full h-36 rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs font-mono text-on-surface resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              :placeholder="codeHint" :aria-label="'图标' + codeTab + '代码'" spellcheck="false"
            ></textarea>
            <p class="text-[10px] font-body text-muted leading-relaxed">
              html 支持 <code v-text="placeholders" class="font-mono"></code> 等占位符；
              css 自动限定在本图标内；js 在渲染后执行，参数 (el, card, data)。
            </p>
          </div>
        </section>

        <!-- 状态配色 -->
        <section>
          <h3 class="font-body text-sm font-semibold text-on-surface mb-2">状态配色</h3>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2">
              <input type="color" v-model="device.stateMap.on.color" class="w-7 h-7 rounded cursor-pointer bg-transparent border-none" aria-label="开启状态颜色" />
              <span class="text-xs font-body text-on-surface">开启颜色</span>
            </label>
            <label class="flex items-center gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2">
              <input type="color" v-model="device.stateMap.off.color" class="w-7 h-7 rounded cursor-pointer bg-transparent border-none" aria-label="关闭状态颜色" />
              <span class="text-xs font-body text-on-surface">关闭颜色</span>
            </label>
          </div>
        </section>

        <!-- 尺寸 -->
        <section>
          <div class="flex items-center justify-between mb-1.5">
            <h3 class="font-body text-sm font-semibold text-on-surface">图标尺寸</h3>
            <span class="text-xs font-body text-muted">{{ device.size }}px</span>
          </div>
          <input type="range" min="24" max="96" step="2" v-model.number="device.size" class="w-full accent-primary cursor-pointer" aria-label="图标尺寸" />
        </section>

        <!-- 删除 -->
        <button
          class="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-error/40 bg-error/10 text-error text-sm font-body font-medium hover:bg-error/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
          @click="onDelete"
        >
          <span class="material-symbols-outlined text-base" aria-hidden="true">delete</span>从平面图移除
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import DeviceIconRenderer from './DeviceIconRenderer.vue'
import { ICON_CHOICES, compressImage } from '@/utils/floorplanDoc'

const props = defineProps({
  device: { type: Object, required: true },  // 文档中的放置项（响应式）
  entity: { type: Object, default: null },
  name: { type: String, default: '' },
})
const emit = defineEmits(['close', 'delete'])

// 破坏性操作需确认
function onDelete() {
  if (window.confirm('从平面图移除该设备？（不会删除 Home Assistant 中的设备）')) emit('delete')
}

const kinds = [
  { key: 'material', label: '内置图标' },
  { key: 'image', label: '图片' },
  { key: 'code', label: '代码' },
]

// ---- 代码编辑三 tab ----
const codeTabs = ['html', 'css', 'js']
const codeTab = ref('html')
// 占位符说明（v-text 输出，避免模板解析器把 {{ }} 当插值）
const placeholders = '{{state}} {{on}} {{brightness}} {{temperature}} {{color}}'
const codeHint = computed(() => ({
  html: '<div class="ico">{{state}}</div>',
  css: '.ico { color: {{color}}; }',
  js: '// el: 图标容器, data: 实时状态',
}[codeTab.value]))

// ---- 图标图片上传（压缩为小图） ----
const iconInput = ref(null)
function pickIcon() { iconInput.value && iconInput.value.click() }
async function onIconFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const dataUrl = await compressImage(file, 256, 0.85, 64 * 1024)
  if (dataUrl) props.device.icon.dataUrl = dataUrl
}
</script>

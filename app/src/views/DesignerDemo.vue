<template>
  <div class="hc-designer-demo">
    <Designer v-model="open" :initial-schema="demoSchema" @save="onSave" />
    <!-- 打开按钮（路由本身进入时自动挂载 Designer，但为了让页面可退出，提供关闭后再打开的按钮） -->
    <div class="hc-designer-demo-landing">
      <span class="material-symbols-outlined" style="font-size:48px;color:var(--hc-color,var(--hc-primary));margin-bottom:16px">auto_awesome</span>
      <h1>Stickynuo 卡片设计器 · Phase 1</h1>
      <p>最小原型：积木库拖入画布 → 嵌套 → 改 props → 实时渲染。</p>
      <button class="hc-designer-demo-btn" @click="open = true">打开设计器</button>
      <div class="hc-designer-demo-tip">
        <p>访问 /designer 自动挂载 Demo schema；<br>支持拖拽嵌套、选中编辑、Delete 删除、Ctrl+Z 撤销。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Designer from '@/components/cards/designer/Designer.vue'

const open = ref(true) // 默认打开，路由进入即看到画布

// Demo schema（简化 personInfo 骨架）
const demoSchema = {
  id: 'b_root_demo',
  defType: 'slot_root',
  props: { padding: 8, gap: 4 },
  children: [
    {
      id: 'b_head_demo',
      defType: 'slot_head',
      props: { gap: 5 },
      children: [
        { id: 'b_text_demo', defType: 'text_block', props: { text: '{{name}}', fontSize: 10, weight: 700, color: 'var(--hc-text)' }, children: [] },
        { id: 'b_badge_demo', defType: 'state_badge', props: { stateCls: 'b-on', label: '在线' }, children: [] },
      ],
    },
    { id: 'b_avatar_demo', defType: 'avatar', props: { size: 38, radius: 999 }, children: [] },
    {
      id: 'b_bottom_demo',
      defType: 'slot_bottom',
      props: {},
      children: [
        { id: 'b_binding_demo', defType: 'binding_entity', props: { entitySlot: 'entity_ids', showIcon: true, showName: true, showState: true, showUnit: false }, children: [] },
      ],
    },
  ],
}

function onSave(payload) {
  // Phase 1：console dump；后续接 CardEditor 保存逻辑
  console.log('[DesignerDemo] save payload:', payload)
  alert('已保存（Phase 1 仅 console 输出）：\n' + JSON.stringify(payload, null, 2).slice(0, 500))
}
</script>

<style scoped>
.hc-designer-demo { width: 100%; height: 100vh; }
.hc-designer-demo-landing {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 24px;
  color: rgb(var(--c-on-surface));
}
.hc-designer-demo-landing h1 { font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
.hc-designer-demo-landing p { color: rgb(var(--c-muted)); font-size: 13px; max-width: 420px; line-height: 1.5; margin: 0; }
.hc-designer-demo-btn {
  margin-top: 12px;
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  background: var(--hc-color, var(--hc-primary));
  color: #000;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform .15s, box-shadow .15s;
}
.hc-designer-demo-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgb(0 0 0 / .2); }
.hc-designer-demo-tip { margin-top: 24px; font-size: 11px; color: rgb(var(--c-muted)); }
</style>

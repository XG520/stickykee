<!-- 户型图 3D 视图：three.js 动态 import（独立 chunk，不进首屏）。
     - 墙体：walls[].pts 逐段 BoxGeometry（高 h 厚 t）
     - 地面：有背景图用 CanvasTexture，否则用房间多边形 ShapeGeometry 色块
     - 设备图标：CSS2DRenderer 叠 DOM（DeviceIconRenderer 的 HTML/CSS/code 模式原样可用），
       按 y 排序 zIndex 缓解重叠
     - OrbitControls 限制极角防穿地；组件卸载即销毁场景释放资源 -->
<template>
  <div ref="holder" class="fp-3d w-full h-full relative">
    <!-- 视角 / 出图悬浮工具条（右上） -->
    <div class="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface/90 backdrop-blur px-1 py-1 shadow-md">
      <button v-for="b in viewBtns" :key="b.kind"
        class="flex items-center justify-center w-7 h-7 rounded-md text-muted hover:bg-primary/10 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :title="b.title" :aria-label="b.title" :aria-pressed="false"
        @click="b.kind === 'shot' ? onCapture() : setViewPreset(b.kind)">
        <span class="material-symbols-outlined text-lg" aria-hidden="true">{{ b.icon }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, createApp } from 'vue'
import DeviceIconRenderer from './DeviceIconRenderer.vue'
import { wallVisibleSegments, pointAlong } from '@/utils/floorplanDoc'

const props = defineProps({
  canvas: { type: Object, required: true },
  floor: { type: Object, required: true },
  items: { type: Array, default: () => [] },   // [{ dev, entity, name }]
  editMode: { type: Boolean, default: false },
  selectedFurnitureId: { type: String, default: '' },
})
const emit = defineEmits(['device-click', 'furniture-click'])

const holder = ref(null)

// three 相关句柄（动态 import 后填充）
let THREE = null, renderer = null, labelRenderer = null, scene = null, camera = null, controls = null
let OBJLoaderCtor = null, MTLLoaderCtor = null
let raf = 0
let buildToken = 0   // 每次 buildScene 递增，丢弃过期异步加载结果
let ambientLight = null, dirLight = null
const iconApps = []   // 每个设备图标一个迷你 Vue app（挂到 CSS2DObject 的 DOM 上）
const furnitureNodes = []   // [{ fu, root }] 供编辑态射线拾取家具
const deviceNodes = []      // [{ id, obj }] 设备 CSS2D 对象，供位置实时同步
const raycaster = { enabled: false, downX: 0, downY: 0 }
let rebuildTimer = null     // 家具增删/尺寸变化 → 防抖全量重建
let archGroup = null        // 建筑结构层：地面/房间色块/墙体/门窗（编辑时只重建此组）
let furnitureGroup = null   // 家具层（OBJ 模型，架构重建不受影响）
let archTimer = null        // 墙/门/窗/房间变化 → 防抖重建架构层
let archToken = 0           // 架构重建代际，丢弃过期的底图异步加载
const bgCache = { key: '', tex: null }  // 背景底图纹理缓存（dataUrl 不变则复用，避免反复 decode）

// 文档坐标 → 场景坐标：以画布中心为原点，y 向上
function toScene(x, y) {
  return { x: x - props.canvas.w / 2, z: y - props.canvas.h / 2 }
}

// 读取主题 CSS 变量（值为 "R G B" 空格分隔三元组）转 THREE.Color，
// 让 3D 背景色与 2D（rgb(var(--c-surface))）保持一致并随主题切换。
function cssVarColor(name, fallbackHex) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const parts = raw.split(/\s+/).map(Number)
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return new THREE.Color(parts[0] / 255, parts[1] / 255, parts[2] / 255)
  }
  return new THREE.Color(fallbackHex)
}
let bgGradient = null
function applyThemeBackground() {
  if (!scene || !THREE) return
  const base = cssVarColor('--c-surface', '#141518')
  // 垂直渐变：顶部向白色提亮 12%（天光感），底部为 surface 原色，增强空间纵深
  const c = document.createElement('canvas')
  c.width = 4; c.height = 256
  const ctx = c.getContext('2d')
  const top = base.clone().lerp(new THREE.Color('#ffffff'), 0.12)
  const css = (col) => `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, css(top))
  grad.addColorStop(1, css(base))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 4, 256)
  if (bgGradient) bgGradient.dispose()
  bgGradient = new THREE.CanvasTexture(c)
  bgGradient.colorSpace = THREE.SRGBColorSpace
  scene.background = bgGradient
}

// 程序化地板纹理（木条拼板：逐板明暗/色相变化 + 木纹 + 错缝，CanvasTexture）
// 程序化地板纹理（preset：wood 直铺 / herringbone 人字拼 / cementtile 花砖 / terrazzo 水磨石 / carpet 地毯）
function proceduralFloorTexture(preset = 'wood') {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')
  const rnd = (a, b) => a + Math.random() * (b - a)

  if (preset === 'herringbone') {
    // 人字拼：45° 双方向短木板对拼（经典 chevron）
    ctx.fillStyle = '#a67d52'; ctx.fillRect(0, 0, 512, 512)
    const BL = 120, BW = 22
    const plank = (cx, cy, ang) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang)
      ctx.fillStyle = `hsl(${28 + Math.random() * 8}, ${24 + Math.random() * 10}%, ${50 + Math.random() * 12}%)`
      ctx.fillRect(-BL / 2, -BW / 2, BL, BW)
      for (let g = 0; g < 4; g++) {
        ctx.strokeStyle = `rgba(70,48,26,${rnd(0.04, 0.1)})`
        const gy = -BW / 2 + rnd(3, BW - 3)
        ctx.beginPath(); ctx.moveTo(-BL / 2 + 4, gy); ctx.lineTo(BL / 2 - 4, gy + rnd(-2, 2)); ctx.stroke()
      }
      ctx.restore()
    }
    for (let row = -4, y = -60; y < 600; y += 80, row++) {
      for (let col = -4, x = -60; x < 600; x += 80, col++) {
        plank(x, y, Math.PI / 4)
        plank(x + 40, y + 40, -Math.PI / 4)
      }
    }
  } else if (preset === 'cementtile') {
    // 花砖：每格彩色对称拼花（复古四叶纹）
    const TS = 128
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const x = tx * TS, y = ty * TS
        const palettes = [['#f3ead9', '#2f6f7a'], ['#f5ede0', '#b5533c'], ['#efe9dd', '#56704a'], ['#f2eada', '#8a6aa0']]
        const [bg, fg] = palettes[(tx + ty) % palettes.length]
        ctx.fillStyle = bg; ctx.fillRect(x, y, TS, TS)
        ctx.fillStyle = fg
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          ctx.beginPath()
          ctx.arc(x + TS / 2 + sx * 26, y + TS / 2 + sy * 26, 30, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = bg
        ctx.beginPath(); ctx.arc(x + TS / 2, y + TS / 2, 14, 0, Math.PI * 2); ctx.fill()
      }
    }
  } else if (preset === 'terrazzo') {
    // 水磨石：浅灰水泥底 + 多彩不规则碎石
    ctx.fillStyle = '#d9d4cb'; ctx.fillRect(0, 0, 512, 512)
    const chipColors = ['#f2f0ea', '#8a8f96', '#c97b54', '#5e8a86', '#b9a98f', '#3d424a']
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = chipColors[Math.floor(Math.random() * chipColors.length)]
      const r = rnd(1.5, 5)
      ctx.save(); ctx.translate(rnd(0, 512), rnd(0, 512)); ctx.rotate(rnd(0, Math.PI))
      ctx.beginPath()
      ctx.moveTo(r, 0); ctx.lineTo(r * rnd(0.4, 1), r * rnd(0.4, 1)); ctx.lineTo(-r * rnd(0.4, 1), r * rnd(0.4, 1)); ctx.lineTo(-r, 0)
      ctx.lineTo(-r * rnd(0.4, 1), -r * rnd(0.4, 1)); ctx.lineTo(r * rnd(0.4, 1), -r * rnd(0.4, 1)); ctx.closePath(); ctx.fill()
      ctx.restore()
    }
  } else if (preset === 'carpet') {
    // 地毯：暖灰底 + 密集纤维噪声 + 细编织纹
    ctx.fillStyle = '#b3aaa0'; ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 9000; i++) {
      const dark = Math.random() < 0.5
      ctx.fillStyle = dark ? `rgba(60,52,44,${rnd(0.03, 0.09)})` : `rgba(255,250,240,${rnd(0.03, 0.08)})`
      ctx.fillRect(rnd(0, 512), rnd(0, 512), rnd(1, 3), rnd(1, 3))
    }
    for (let y = 0; y < 512; y += 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke()
    }
  } else {
    const PLANK_H = 64   // 板条高度
    const PLANK_W = 256  // 板条长度（错缝排列）
    for (let row = 0; row < 512 / PLANK_H; row++) {
      const y = row * PLANK_H
      const shift = (row % 2) * (PLANK_W / 2)   // 奇偶行错缝
      for (let x = -PLANK_W; x < 512 + PLANK_W; x += PLANK_W) {
        // 每块板随机明暗与暖度
        const l = 52 + Math.random() * 14       // 明度 52-66%
        const warm = Math.random() * 8
        ctx.fillStyle = `hsl(${28 + warm}, ${22 + Math.random() * 10}%, ${l}%)`
        ctx.fillRect(x + shift, y, PLANK_W, PLANK_H)
        // 木纹细线
        for (let g = 0; g < 5; g++) {
          ctx.strokeStyle = `rgba(60,42,24,${0.05 + Math.random() * 0.07})`
          ctx.lineWidth = 1
          const gy = y + 6 + Math.random() * (PLANK_H - 12)
          ctx.beginPath()
          ctx.moveTo(x + shift, gy)
          ctx.bezierCurveTo(x + shift + PLANK_W * 0.3, gy + (Math.random() - 0.5) * 6,
            x + shift + PLANK_W * 0.7, gy + (Math.random() - 0.5) * 6, x + shift + PLANK_W, gy)
          ctx.stroke()
        }
        // 板端接缝
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(x + shift, y, 1.5, PLANK_H)
      }
      // 板间横缝
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(0, y, 512, 2)
    }
  }

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (preset === 'wood') t.repeat.set(3, 3)
  return t
}

// 程序化墙面纹理（preset：paint 乳胶漆 / wallpaper 壁纸 / brick 文化砖 / woodpanel 木饰面 / concrete 清水混凝土）
function proceduralWallTexture(preset) {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')
  const rnd = (a, b) => a + Math.random() * (b - a)
  switch (preset) {
    case 'wallpaper': {
      // 暖白底 + 竖条纹 + 菱形暗纹
      ctx.fillStyle = '#ece8df'; ctx.fillRect(0, 0, 512, 512)
      for (let x = 0; x < 512; x += 32) {
        ctx.fillStyle = 'rgba(190,182,168,0.35)'
        ctx.fillRect(x, 0, 14, 512)
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.fillRect(x + 14, 0, 3, 512)
      }
      ctx.strokeStyle = 'rgba(160,150,135,0.18)'
      ctx.lineWidth = 1
      for (let y = 24; y < 512; y += 48) {
        for (let x = 16; x < 512; x += 48) {
          ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); ctx.stroke()
        }
      }
      break
    }
    case 'brick': {
      // 文化砖：错缝砖块 + 灰缝底
      ctx.fillStyle = '#b9b3a8'; ctx.fillRect(0, 0, 512, 512)
      const BH = 42, BW = 128, G = 5
      for (let row = 0, y = 0; y < 512 + BH; y += BH + G, row++) {
        const off = row % 2 ? BW / 2 : 0
        for (let x = -BW; x < 512 + BW; x += BW + G) {
          ctx.fillStyle = `hsl(${18 + Math.random() * 14}, ${26 + Math.random() * 10}%, ${52 + Math.random() * 14}%)`
          ctx.fillRect(x + off, y, BW, BH)
          for (let i = 0; i < 40; i++) {
            ctx.fillStyle = `rgba(0,0,0,${rnd(0.02, 0.07)})`
            ctx.fillRect(x + off + rnd(0, BW), y + rnd(0, BH), 2, 2)
          }
        }
      }
      break
    }
    case 'stone': {
      // 文化石：大小不一的不规则石板错落叠放 + 深色勾缝
      ctx.fillStyle = '#6f6a62'; ctx.fillRect(0, 0, 512, 512)
      for (let y = 0; y < 512; ) {
        const rowH = rnd(46, 80)
        let x = rnd(-30, 0)
        while (x < 512) {
          const sw = rnd(50, 130)
          const g = Math.random() < 0.5
          ctx.fillStyle = `hsl(${28 + rnd(-8, 14)}, ${g ? 6 : 14}%, ${42 + rnd(-10, 16)}%)`
          ctx.fillRect(x + 4, y + 4, sw - 8, rowH - 8)
          for (let i = 0; i < 18; i++) {
            ctx.fillStyle = `rgba(0,0,0,${rnd(0.02, 0.08)})`
            ctx.fillRect(x + rnd(6, sw - 6), y + rnd(6, rowH - 6), 2, 2)
          }
          x += sw
        }
        y += rowH
      }
      break
    }
    case 'woodpanel': {
      // 竖向木饰面板：板条 + 竖向木纹
      ctx.fillStyle = '#a9845e'; ctx.fillRect(0, 0, 512, 512)
      const PW = 64
      for (let x = 0; x < 512; x += PW) {
        ctx.fillStyle = `hsl(${28 + Math.random() * 8}, ${34 + Math.random() * 8}%, ${44 + Math.random() * 12}%)`
        ctx.fillRect(x + 1, 0, PW - 2, 512)
        for (let i = 0; i < 26; i++) {
          ctx.strokeStyle = `rgba(80,50,25,${rnd(0.04, 0.12)})`
          ctx.lineWidth = 1 + Math.random()
          const gx = x + rnd(4, PW - 4)
          ctx.beginPath(); ctx.moveTo(gx, 0)
          ctx.bezierCurveTo(gx + rnd(-5, 5), 170, gx + rnd(-5, 5), 340, gx + rnd(-3, 3), 512)
          ctx.stroke()
        }
        ctx.fillStyle = 'rgba(0,0,0,0.28)'
        ctx.fillRect(x, 0, 1.6, 512)
      }
      break
    }
    case 'concrete': {
      // 清水混凝土：灰底 + 骨料 + 明暗瑕疵 + 模板分缝
      ctx.fillStyle = '#b5b1aa'; ctx.fillRect(0, 0, 512, 512)
      for (let i = 0; i < 5000; i++) {
        const l = Math.random() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${l},${l},${l},${rnd(0.015, 0.05)})`
        ctx.fillRect(rnd(0, 512), rnd(0, 512), 2, 2)
      }
      for (let i = 0; i < 14; i++) {
        const g = ctx.createRadialGradient(rnd(0, 512), rnd(0, 512), 10, rnd(0, 512), rnd(0, 512), rnd(120, 260))
        g.addColorStop(0, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512)
      }
      ctx.strokeStyle = 'rgba(90,85,80,0.35)'; ctx.lineWidth = 2
      ctx.strokeRect(4, 4, 504, 504)
      break
    }
    case 'wainscot': {
      // 护墙板：上部浅色墙面 + 下部米白凹凸板 + 腰线分隔
      ctx.fillStyle = '#e9e5dc'; ctx.fillRect(0, 0, 512, 512)
      const WAIST = 188
      ctx.fillStyle = '#f4f1e9'; ctx.fillRect(0, WAIST, 512, 512 - WAIST)
      // 下部竖向凸框
      for (let x = 0; x < 512; x += 64) {
        ctx.strokeStyle = 'rgba(150,142,128,0.5)'; ctx.lineWidth = 2
        ctx.strokeRect(x + 8, WAIST + 12, 48, 512 - WAIST - 24)
      }
      // 腰线（深色凸起）
      ctx.fillStyle = '#cfc7b6'; ctx.fillRect(0, WAIST - 6, 512, 8)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, WAIST + 2, 512, 2)
      break
    }
    case 'diatom': {
      // 硅藻泥：暖米底 + 大颗粒松软凹凸质感
      ctx.fillStyle = '#e5dfd2'; ctx.fillRect(0, 0, 512, 512)
      for (let i = 0; i < 6000; i++) {
        const l = Math.random() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${l},${l},${l},${rnd(0.02, 0.06)})`
        const r = rnd(1, 3)
        ctx.fillRect(rnd(0, 512), rnd(0, 512), r, r)
      }
      // 抹刀弧形抹痕
      for (let i = 0; i < 22; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${rnd(0.03, 0.08)})`
        ctx.lineWidth = rnd(4, 9)
        ctx.beginPath()
        const x = rnd(-50, 512), y = rnd(0, 512)
        ctx.arc(x, y, rnd(30, 80), rnd(0, 3), rnd(0.3, 1.2))
        ctx.stroke()
      }
      break
    }
    default: {
      // paint：暖灰底色 + 粉刷颗粒 + 细微石膏纹路
      ctx.fillStyle = '#e7e3da'
      ctx.fillRect(0, 0, 512, 512)
      // 随机粉刷纹理（极轻微，避免白墙发花）
      for (let i = 0; i < 2500; i++) {
        const l = Math.random() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${l},${l},${l},${0.01 + Math.random() * 0.02})`
        ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2)
      }
      // 细微石膏滚子横痕
      for (let y = 0; y < 512; y += 18) {
        const off = (Math.random() - 0.5) * 2
        ctx.strokeStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.03})`
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, y + off); ctx.lineTo(512, y + off); ctx.stroke()
      }
      break
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ---- 程序化 bump（灰度高度）贴图：图案坐标与颜色贴图严格一致。
// size：地板木条/墙面=512；家具/其余地板=256。返回线性空间纹理（高度数据不做 sRGB） ----
function proceduralBumpTexture(preset, size = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const rnd = (a, b) => a + Math.random() * (b - a)
  const noise = (n, amp) => {
    for (let i = 0; i < n; i++) {
      const g = Math.max(0, Math.min(255, 128 + rnd(-amp, amp)))
      ctx.fillStyle = `rgb(${g},${g},${g})`
      ctx.fillRect(rnd(0, size), rnd(0, size), 2, 2)
    }
  }
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, size, size)
  switch (preset) {
    // ===== 地板专用木条（与 proceduralFloorTexture 同几何：PLANK_H=64 PLANK_W=256 错缝） =====
    case 'floorwood': {
      noise(1200, 10)
      for (let row = 0; row < size; row += 64) {
        ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, row, size, 2)         // 板间横缝
        const shift = ((row / 64) % 2) * 128
        for (let x = -256; x < size + 256; x += 256) {
          ctx.fillStyle = '#666'; ctx.fillRect(x + shift, row, 1.5, 64)  // 板端接缝
        }
      }
      break
    }
    case 'wood':
      noise(900, 8)
      for (let y = 0; y < size; y += 4) {
        ctx.fillStyle = `rgba(0,0,0,${rnd(0.04, 0.1)})`
        ctx.fillRect(0, y, size, 1)
      }
      break
    case 'fabric':
      noise(4000, 9)
      break
    case 'metal':
      for (let y = 0; y < size; y += 2) {
        const g = 128 + rnd(-8, 8)
        ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillRect(0, y, size, 1)
      }
      break
    case 'marble':
      noise(500, 6)
      for (let i = 0; i < 55; i++) {
        const g = Math.round(rnd(70, 105))
        ctx.strokeStyle = `rgb(${g},${g},${g})`
        ctx.lineWidth = 1 + Math.random() * 2
        ctx.beginPath()
        let x = rnd(0, size), y = rnd(0, size)
        ctx.moveTo(x, y)
        for (let k = 0; k < 4; k++) { x += rnd(-40, 40); y += rnd(-20, 20); ctx.lineTo(x, y) }
        ctx.stroke()
      }
      break
    case 'leather':
      noise(2500, 11)
      break
    case 'tile': {
      const TS = size === 256 ? 64 : 128
      ctx.fillStyle = '#8a8a8a'                      // 砖面略高
      for (let y = 0; y < size; y += TS) {
        for (let x = 0; x < size; x += TS) ctx.fillRect(x + 2, y + 2, TS - 4, TS - 4)
      }
      break                                          // 底色保持 128 → 勾缝凹槽
    }
    case 'concrete':
      noise(4000, 14)
      ctx.fillStyle = '#666'; ctx.fillRect(size / 2 - 0.5, 0, 1, size); ctx.fillRect(0, size / 2 - 0.5, size, 1)
      break
    // ===== 墙面（512，与 proceduralWallTexture 同几何） =====
    case 'paint':
      noise(1500, 3)
      break
    case 'wallpaper':
      for (let x = 0; x < size; x += 32) {
        ctx.fillStyle = '#9a9a9a'; ctx.fillRect(x, 0, 14, size)         // 凸条
        ctx.fillStyle = '#a8a8a8'; ctx.fillRect(x, 0, 2, size)
      }
      break
    case 'brick': {
      ctx.fillStyle = '#5c5c5c'; ctx.fillRect(0, 0, size, size)         // 灰缝低
      const BH = 42, BW = 128, G = 5
      for (let row = 0, y = 0; y < size + BH; y += BH + G, row++) {
        const off = row % 2 ? BW / 2 : 0
        for (let x = -BW; x < size + BW; x += BW + G) {
          ctx.fillStyle = '#8c8c8c'; ctx.fillRect(x + off, y, BW, BH)  // 砖块高
        }
      }
      break
    }
    case 'woodpanel':
      for (let x = 0; x < size; x += 64) {
        ctx.fillStyle = '#868686'; ctx.fillRect(x + 2, 0, 62, size)    // 板面
        ctx.fillStyle = '#4d4d4d'; ctx.fillRect(x, 0, 2, size)        // 板缝
        for (let i = 0; i < 10; i++) {
          ctx.strokeStyle = `rgba(0,0,0,${rnd(0.04, 0.1)})`
          const gx = x + rnd(6, 60)
          ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx + rnd(-4, 4), size); ctx.stroke()
        }
      }
      break
    // ===== 新增地板 =====
    case 'herringbone': {
      noise(800, 7)
      ctx.strokeStyle = '#5c5c5c'; ctx.lineWidth = 3
      for (let i = -size; i < size * 2; i += 80) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke()
      }
      break
    }
    case 'terrazzo':
      noise(400, 5)
      for (let i = 0; i < 700; i++) {
        const g = Math.round(rnd(95, 165))
        ctx.fillStyle = `rgb(${g},${g},${g})`
        const r = rnd(1.5, 4.5)
        ctx.fillRect(rnd(0, size), rnd(0, size), r, r)
      }
      break
    case 'carpet':
      for (let i = 0; i < 7000; i++) {
        const g = Math.round(128 + rnd(-16, 16))
        ctx.fillStyle = `rgb(${g},${g},${g})`
        ctx.fillRect(rnd(0, size), rnd(0, size), rnd(1, 3), rnd(1, 3))
      }
      break
    // ===== 新增墙面 =====
    case 'stone':
      ctx.fillStyle = '#5a5a5a'; ctx.fillRect(0, 0, size, size)   // 勾缝
      for (let y = 0; y < size; ) {
        const rowH = rnd(46, 80)
        let x = rnd(-30, 0)
        while (x < size) {
          const sw = rnd(50, 130)
          const g = Math.round(rnd(120, 150))
          ctx.fillStyle = `rgb(${g},${g},${g})`
          ctx.fillRect(x + 4, y + 4, sw - 8, rowH - 8)
          x += sw
        }
        y += rowH
      }
      break
    case 'wainscot': {
      const WAIST = Math.round(size * 188 / 512)
      ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, WAIST, size, size - WAIST)
      const cw = size * 64 / 512
      for (let x = 0; x < size; x += cw) {
        ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 3
        ctx.strokeRect(x + size * 8 / 512, WAIST + size * 12 / 512, cw - size * 16 / 512, size - WAIST - size * 24 / 512)
      }
      ctx.fillStyle = '#b0b0b0'; ctx.fillRect(0, WAIST - size * 6 / 512, size, size * 8 / 512)
      break
    }
    case 'diatom':
      for (let i = 0; i < 5000; i++) {
        const g = Math.round(128 + rnd(-18, 18))
        ctx.fillStyle = `rgb(${g},${g},${g})`
        const r = rnd(1, 3.5)
        ctx.fillRect(rnd(0, size), rnd(0, size), r, r)
      }
      break
    case 'rattan':
      ctx.lineWidth = 4
      for (let i = -size; i < size * 2; i += size * 20 / 256) {
        ctx.strokeStyle = '#6e6e6e'
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke()
        ctx.strokeStyle = '#a0a0a0'
        ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke()
      }
      break
    default:
      return null
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ---- 墙体 PBR 材质：按墙面预设分级（用户 wallColor 叠加调色，白色=保留纹理原色） ----
function makeWallMaterial(preset, colorHex) {
  const color = new THREE.Color(colorHex || '#ffffff')
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8
  const common = { color, metalness: 0 }
  switch (preset) {
    case 'wallpaper': {
      const tex = proceduralWallTexture('wallpaper'); tex.anisotropy = maxAniso
      return new THREE.MeshStandardMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('wallpaper', 512), bumpScale: 0.4, roughness: 0.85, envMapIntensity: 0.45 })
    }
    case 'brick': {
      const tex = proceduralWallTexture('brick'); tex.anisotropy = maxAniso
      return new THREE.MeshStandardMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('brick', 512), bumpScale: 2.2, roughness: 0.95, envMapIntensity: 0.4 })
    }
    case 'woodpanel': {
      const tex = proceduralWallTexture('woodpanel'); tex.anisotropy = maxAniso
      return new THREE.MeshPhysicalMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('woodpanel', 512), bumpScale: 0.8, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.65 })
    }
    case 'stone': {
      const tex = proceduralWallTexture('stone'); tex.anisotropy = maxAniso
      return new THREE.MeshStandardMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('stone', 512), bumpScale: 2.4, roughness: 0.97, envMapIntensity: 0.35 })
    }
    case 'wainscot': {
      const tex = proceduralWallTexture('wainscot'); tex.anisotropy = maxAniso
      return new THREE.MeshPhysicalMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('wainscot', 512), bumpScale: 0.9, roughness: 0.6, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.6 })
    }
    case 'diatom': {
      const tex = proceduralWallTexture('diatom'); tex.anisotropy = maxAniso
      return new THREE.MeshStandardMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('diatom', 512), bumpScale: 1.4, roughness: 0.95, envMapIntensity: 0.35 })
    }
    case 'concrete': {
      const tex = proceduralWallTexture('concrete'); tex.anisotropy = maxAniso
      return new THREE.MeshStandardMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('concrete', 512), bumpScale: 1.1, roughness: 0.92, envMapIntensity: 0.35 })
    }
    default: {
      const tex = proceduralWallTexture('paint'); tex.anisotropy = maxAniso
      return new THREE.MeshStandardMaterial({ ...common, map: tex, bumpMap: proceduralBumpTexture('paint', 512), bumpScale: 0.2, roughness: 0.9, envMapIntensity: 0.35 })
    }
  }
}

// 每 80 场景单位（≈2.7m）平铺一次墙面纹理
const WALL_TEX_UNIT = 80

// BoxGeometry UV 按世界尺寸缩放（面顺序：±x 侧面 / ±y 顶底 / ±z 前后），
// 使共享纹理按固定米数平铺——避免长墙拉伸、也无需逐墙克隆纹理
function scaleBoxUV(geo, len, h, t, unit) {
  const uv = geo.attributes.uv
  const su = len / unit, sv = h / unit, st = t / unit
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i)
    if (i < 8) uv.setXY(i, u * st, v * sv)
    else if (i < 16) uv.setXY(i, u * su, v * st)
    else uv.setXY(i, u * su, v * sv)
  }
  uv.needsUpdate = true
}

// 每 240 场景单位（8m）归一化一次地板 UV：配合纹理内部 repeat，
// 木地板板宽 ≈8cm、瓷砖格 ≈0.5m，接近真实铺装尺度
const FLOOR_TEX_UNIT = 240

// ShapeGeometry（地板多边形）UV 归一化：原始顶点坐标 → 按固定米数平铺
function scaleShapeUV(geo, unit) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / unit, uv.getY(i) / unit)
  uv.needsUpdate = true
}

// 程序化家具纹理（按预设 key 生成 CanvasTexture，避免外部图片依赖）
function proceduralFurnitureTexture(preset) {
  if (!preset) return null
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')
  const rnd = (a, b) => a + Math.random() * (b - a)
  switch (preset) {
    case 'wood':
      ctx.fillStyle = '#b0895c'; ctx.fillRect(0, 0, 256, 256)
      for (let y = 0; y < 256; y += 4) {
        ctx.fillStyle = `rgba(${60 + Math.random() * 30},${40 + Math.random() * 20},${20 + Math.random() * 15},0.18)`
        ctx.fillRect(0, y, 256, 2 + Math.random() * 3)
      }
      break
    case 'fabric':
      ctx.fillStyle = '#c8c2b8'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rnd(0.02, 0.06)})`
        ctx.fillRect(rnd(0, 256), rnd(0, 256), 2, 2)
      }
      break
    case 'metal':
      ctx.fillStyle = '#b8bcc2'; ctx.fillRect(0, 0, 256, 256)
      for (let y = 0; y < 256; y += 2) {
        ctx.fillStyle = `rgba(255,255,255,${rnd(0.02, 0.08)})`
        ctx.fillRect(0, y, 256, 1)
      }
      break
    case 'marble':
      ctx.fillStyle = '#d8d4cc'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(120,120,120,${rnd(0.05, 0.14)})`
        ctx.lineWidth = 1 + Math.random() * 2
        ctx.beginPath()
        let x = rnd(0, 256), y = rnd(0, 256)
        ctx.moveTo(x, y)
        for (let k = 0; k < 4; k++) { x += rnd(-40, 40); y += rnd(-20, 20); ctx.lineTo(x, y) }
        ctx.stroke()
      }
      break
    case 'leather':
      ctx.fillStyle = '#8f6344'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rnd(0.02, 0.07)})`
        ctx.fillRect(rnd(0, 256), rnd(0, 256), 2, 2)
      }
      break
    case 'rattan': {
      // 藤编：交叉斜纹编织网格
      ctx.fillStyle = '#c2a878'; ctx.fillRect(0, 0, 256, 256)
      ctx.lineWidth = 4
      for (let i = -256; i < 512; i += 20) {
        ctx.strokeStyle = `rgba(110,86,50,${0.35 + Math.random() * 0.15})`
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 256, 256); ctx.stroke()
        ctx.strokeStyle = `rgba(230,205,160,${0.3 + Math.random() * 0.15})`
        ctx.beginPath(); ctx.moveTo(i + 256, 0); ctx.lineTo(i, 256); ctx.stroke()
      }
      break
    }
    case 'tile': {
      // 瓷砖：浅色底 + 深色网格缝
      ctx.fillStyle = '#e8e4dc'; ctx.fillRect(0, 0, 256, 256)
      const TS = 64
      for (let y = 0; y < 256; y += TS) {
        for (let x = 0; x < 256; x += TS) {
          const l = 88 + Math.random() * 6
          ctx.fillStyle = `hsl(${40 + Math.random() * 10}, 8%, ${l}%)`
          ctx.fillRect(x + 1, y + 1, TS - 2, TS - 2)
        }
      }
      ctx.strokeStyle = 'rgba(120,110,100,0.5)'
      ctx.lineWidth = 1.5
      for (let i = 0; i <= 256; i += TS) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke()
      }
      break
    }
    case 'concrete': {
      ctx.fillStyle = '#9e9a94'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 4000; i++) {
        const l = Math.random() < 0.5 ? 0 : 255
        ctx.fillStyle = `rgba(${l},${l},${l},${rnd(0.02, 0.05)})`
        ctx.fillRect(rnd(0, 256), rnd(0, 256), 2, 2)
      }
      // 收缩缝
      ctx.strokeStyle = 'rgba(80,75,70,0.4)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(256, 128); ctx.stroke()
      break
    }
    default:
      return null
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ---- 地板 PBR 材质（酷家乐质感）：clearcoat 模拟木地板漆面 / 大理石瓷砖釉面 ----
// 纹理图颜色已烘焙，color 用白色相乘保留原色（用户自定义 floorColor 时叠加调色）
function makeFloorMaterial(preset, colorHex) {
  const userTint = colorHex || '#ffffff'
  const color = new THREE.Color(userTint)
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8
  switch (preset) {
    case 'wood': {
      const tex = proceduralFloorTexture()         // 精细木条拼板（优于家具纹理）
      tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('floorwood', 512)
      bump.repeat.copy(tex.repeat)
      return new THREE.MeshPhysicalMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 0.9,
        roughness: 0.5, metalness: 0,
        clearcoat: 0.35, clearcoatRoughness: 0.45,
        envMapIntensity: 0.7,
      })
    }
    case 'marble': {
      const tex = proceduralFurnitureTexture('marble')
      tex.repeat.set(1.5, 1.5); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('marble', 256); bump.repeat.copy(tex.repeat)
      return new THREE.MeshPhysicalMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 0.4,
        roughness: 0.2, metalness: 0,
        clearcoat: 0.8, clearcoatRoughness: 0.18,
        envMapIntensity: 0.9,
      })
    }
    case 'tile': {
      const tex = proceduralFurnitureTexture('tile')
      tex.repeat.set(4, 4); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('tile', 256); bump.repeat.copy(tex.repeat)
      return new THREE.MeshPhysicalMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 1.6,
        roughness: 0.16, metalness: 0,
        clearcoat: 0.65, clearcoatRoughness: 0.15,
        envMapIntensity: 0.85,
      })
    }
    case 'concrete': {
      const tex = proceduralFurnitureTexture('concrete')
      tex.repeat.set(1.5, 1.5); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('concrete', 256); bump.repeat.copy(tex.repeat)
      return new THREE.MeshStandardMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 1.0,
        roughness: 0.88, metalness: 0,
        envMapIntensity: 0.4,
      })
    }
    case 'herringbone': {
      const tex = proceduralFloorTexture('herringbone'); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('herringbone', 512); bump.repeat.copy(tex.repeat)
      return new THREE.MeshPhysicalMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 0.8,
        roughness: 0.48, metalness: 0,
        clearcoat: 0.35, clearcoatRoughness: 0.4,
        envMapIntensity: 0.7,
      })
    }
    case 'cementtile': {
      const tex = proceduralFloorTexture('cementtile'); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('tile', 512); bump.repeat.copy(tex.repeat)
      return new THREE.MeshPhysicalMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 0.7,
        roughness: 0.3, metalness: 0,
        clearcoat: 0.55, clearcoatRoughness: 0.25,
        envMapIntensity: 0.8,
      })
    }
    case 'terrazzo': {
      const tex = proceduralFloorTexture('terrazzo'); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('terrazzo', 512); bump.repeat.copy(tex.repeat)
      return new THREE.MeshPhysicalMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 0.9,
        roughness: 0.4, metalness: 0,
        clearcoat: 0.3, clearcoatRoughness: 0.35,
        envMapIntensity: 0.7,
      })
    }
    case 'carpet': {
      const tex = proceduralFloorTexture('carpet'); tex.anisotropy = maxAniso
      const bump = proceduralBumpTexture('carpet', 512); bump.repeat.copy(tex.repeat)
      return new THREE.MeshStandardMaterial({
        color, map: tex, bumpMap: bump, bumpScale: 1.2,
        roughness: 0.98, metalness: 0,
        envMapIntensity: 0.4,
      })
    }
    default:
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex || '#8a7a64'),
        roughness: 0.8, metalness: 0, envMapIntensity: 0.5,
      })
  }
}

// 初始视角：与 2D 一致地框住整块画布地面（canvas.w × canvas.h），
// 使背景底图/地面在 2D 与 3D 下的显示大小保持一致。
function fitCamera() {
  const W = props.canvas.w, H = props.canvas.h
  const radius = Math.hypot(W, H) / 2           // 覆盖整个地面的外接圆半径
  const vFov = (camera.fov * Math.PI) / 180
  const aspect = camera.aspect || 1
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  // 用较小的视场角（水平/垂直）反推距离，保证整块地面都可见
  const dist = radius / Math.sin(Math.min(vFov, hFov) / 2)
  const pitch = 50 * Math.PI / 180              // 俯视角度，兼顾立体感与 2D 一致性
  camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch))
  camera.lookAt(0, 0, 0)
}

// ---- 相机视角预设（酷家乐式）：kind = top 鸟瞰 / eye 人视透视 / front 立面 / reset 重置 ----
function viewDistance() {
  const W = props.canvas.w, H = props.canvas.h
  const radius = Math.hypot(W, H) / 2
  const vFov = camera.fov * Math.PI / 180
  const aspect = camera.aspect || 1
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  return radius / Math.sin(Math.min(vFov, hFov) / 2)
}
function setViewPreset(kind) {
  if (!camera || !controls) return
  const dist = viewDistance()
  const target = controls.target.clone()
  target.y = 0
  if (kind === 'reset') {
    controls.target.set(0, 0, 0)
    fitCamera()
    controls.update()
    return
  }
  if (kind === 'top') {
    // 鸟瞰：高俯角（约 65°）
    camera.position.set(target.x, dist * 0.91, target.z + dist * 0.42)
  } else if (kind === 'eye') {
    // 人视透视：低俯角（约 22°），目标点贴近地面
    camera.position.set(target.x, dist * 0.38, target.z + dist * 0.93)
  } else if (kind === 'front') {
    // 立面：人眼高度（≈1.6m=48）正看，目标点同样抬高
    camera.position.set(target.x, 48, target.z + dist)
    target.y = 44
  }
  controls.target.copy(target)
  controls.update()
}

// ---- 渲染出图：临时提升绘图缓冲分辨率渲染一帧 → PNG 下载（仅 WebGL 画面，不含 DOM 设备图标） ----
const capturing = ref(false)
function onCapture() {
  if (capturing.value || !renderer || !holder.value) return
  capturing.value = true
  const SCALE = 2
  const w = holder.value.clientWidth, h = holder.value.clientHeight
  const oldPR = renderer.getPixelRatio()
  renderer.setPixelRatio(oldPR * SCALE)
  renderer.setSize(w, h, false)          // 更新缓冲，不改画布 CSS 尺寸
  renderer.render(scene, camera)
  const url = renderer.domElement.toDataURL('image/png')
  renderer.setPixelRatio(oldPR)
  renderer.setSize(w, h, false)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.floor.name || 'floorplan'}-3d.png`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => capturing.value = false, 500)
}

defineExpose({ setViewPreset })

const viewBtns = [
  { kind: 'top', icon: 'map', title: '鸟瞰视图' },
  { kind: 'eye', icon: 'photo_camera', title: '人视透视' },
  { kind: 'front', icon: 'wall', title: '立面视图' },
  { kind: 'reset', icon: 'center_focus_strong', title: '重置视角' },
  { kind: 'shot', icon: 'image', title: '导出渲染图 PNG（2x 高清）' },
]

async function init() {
  const [three, orbit, css2d, objloader, mtlloader, roomEnvMod] = await Promise.all([
    import('three'),
    import('three/examples/jsm/controls/OrbitControls.js'),
    import('three/examples/jsm/renderers/CSS2DRenderer.js'),
    import('three/examples/jsm/loaders/OBJLoader.js'),
    import('three/examples/jsm/loaders/MTLLoader.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
  ])
  THREE = three
  CSS2DObjectCtor = css2d.CSS2DObject
  OBJLoaderCtor = objloader.OBJLoader
  MTLLoaderCtor = mtlloader.MTLLoader
  const el = holder.value
  if (!el) return

  scene = new THREE.Scene()
  applyThemeBackground()

  const w = el.clientWidth || 600
  const h = el.clientHeight || 400
  camera = new THREE.PerspectiveCamera(50, w / h, 1, 8000)
  fitCamera()

  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(w, h)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // ---- IBL 环境光照（酷家乐式真实感核心）：RoomEnvironment 经 PMREM 预滤波，
  // 所有 PBR 材质按 roughness 获得分级柔和反射；scene.environment 无需逐材质挂 envMap ----
  const pmrem = new THREE.PMREMGenerator(renderer)
  const roomEnv = new roomEnvMod.RoomEnvironment()
  scene.environment = pmrem.fromScene(roomEnv, 0.04).texture
  pmrem.dispose()

  // r186 物理光照：IBL + 直射光 + ACES；exposure 1.15 保持明亮且不洗平对比
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  el.appendChild(renderer.domElement)

  // CSS2D 层：设备图标 DOM 叠加
  labelRenderer = new css2d.CSS2DRenderer()
  labelRenderer.setSize(w, h)
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' })
  el.appendChild(labelRenderer.domElement)

  controls = new orbit.OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.maxPolarAngle = Math.PI / 2 - 0.05  // 防穿地
  controls.minDistance = 80
  controls.maxDistance = Math.max(props.canvas.w, props.canvas.h) * 3
  controls.enableDamping = true

  // 编辑态家具拾取（复用 renderer 画布点击）
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  // 平移：capture 阶段先于 OrbitControls 拦截中键 / Alt+左键 / 查看态空白左键，
  // 平移期间临时禁用 controls，避免 dolly/旋转冲突
  renderer.domElement.addEventListener('pointerdown', onViewPointerDown, true)
  renderer.domElement.addEventListener('pointerup', onViewPointerUp, true)

  // 架构层 / 家具层：整层重建，互不影响
  archGroup = new THREE.Group()
  furnitureGroup = new THREE.Group()
  scene.add(archGroup)
  scene.add(furnitureGroup)

  buildScene()

  const ro = new ResizeObserver(onResize)
  ro.observe(el)
  resizeObs = ro

  // 主题切换 → html 的 class/style 变化 → 重读 --c-surface 更新背景
  themeObs = new MutationObserver(applyThemeBackground)
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })

  const loop = () => {
    raf = requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }
  loop()
}

let resizeObs = null
let themeObs = null
function onResize() {
  const el = holder.value
  if (!el || !renderer) return
  const w = el.clientWidth, h = el.clientHeight
  if (!w || !h) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  labelRenderer.setSize(w, h)
}

// 按楼层 lighting 参数更新光照：环境光 + 半球光（地面反照） + 平行光（阴影/立体感）。
// 半球光让天花板偏冷白、地面反射暖棕，自然过渡，无需环境贴图。
let hemiLight = null
function applyLighting() {
  if (!scene || !THREE) return
  const L = props.floor.lighting || {}

  if (!ambientLight) {
    ambientLight = new THREE.AmbientLight(0xffffff, 1)
    scene.add(ambientLight)
  }
  ambientLight.intensity = L.ambient != null ? L.ambient : 1.0
  ambientLight.color.set(L.color || '#ffffff')

  // 半球光：天光（冷白）+ 地光（暖棕），模拟房间自然反射
  if (!hemiLight) {
    hemiLight = new THREE.HemisphereLight(0xfff4e0, 0x5a4a38, 1)
    scene.add(hemiLight)
  }
  hemiLight.intensity = 0.3   // IBL 已提供环境填充，半球光仅作冷暖过渡

  if (!dirLight) {
    dirLight = new THREE.DirectionalLight(0xffffff, 1)
    dirLight.position.set(props.canvas.w / 2, props.canvas.h * 0.9, props.canvas.h / 2)
    dirLight.shadow.mapSize.set(2048, 2048)   // 高清阴影
    const sc = dirLight.shadow.camera
    sc.left = -props.canvas.w; sc.right = props.canvas.w
    sc.top = props.canvas.h; sc.bottom = -props.canvas.h
    sc.near = 1; sc.far = props.canvas.h * 4
    dirLight.shadow.bias = -0.0003
    dirLight.shadow.normalBias = 0.6          // 抑制斜面阴影痤疮
    dirLight.shadow.radius = 4                // PCFSoft 边缘柔化
    scene.add(dirLight)
  }
  dirLight.intensity = L.dir != null ? L.dir : 3.4
  dirLight.color.set(L.color || '#ffffff')
  dirLight.castShadow = L.shadow !== false
}

// ---- 编辑态家具射线拾取（左键点击选中，旋转视角拖拽不算） ----
function onPointerDown(e) {
  if (!props.editMode) return
  if (e.button !== 0) return
  raycaster.enabled = true
  raycaster.downX = e.clientX
  raycaster.downY = e.clientY
}
function onPointerUp(e) {
  if (!raycaster.enabled) return
  raycaster.enabled = false
  if (e.button !== 0) return
  if (Math.hypot(e.clientX - raycaster.downX, e.clientY - raycaster.downY) > 6) return
  pickFurniture(e)
}
function pickFurniture(e) {
  if (!renderer || !camera || !THREE || !furnitureNodes.length) return
  const rect = renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  )
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  const hits = ray.intersectObjects(furnitureNodes.map((n) => n.root), true)
  if (!hits.length) return
  let cur = hits[0].object
  while (cur && !cur.userData.furnitureId) cur = cur.parent
  const id = cur && cur.userData.furnitureId
  const hit = furnitureNodes.find((n) => n.fu.id === id)
  if (hit) emit('furniture-click', hit.fu)
}

// ---- 视图平移（capture 拦截，避免与 OrbitControls 冲突） ----
let viewPan = null
function onViewPointerDown(e) {
  // 平移仅保留中键 / Alt+左键；左键恢复 OrbitControls 旋转
  const byKey = e.button === 1 || (e.button === 0 && e.altKey)
  if (!byKey) return
  e.stopPropagation()
  if (controls) controls.enabled = false
  viewPan = { x: e.clientX, y: e.clientY }
  window.addEventListener('pointermove', onViewPointerMove)
}
function onViewPointerMove(e) {
  if (!viewPan || !camera || !controls || !THREE) return
  const dx = e.clientX - viewPan.x, dy = e.clientY - viewPan.y
  viewPan.x = e.clientX; viewPan.y = e.clientY
  // 像素 → 世界单位：目标平面处每像素跨度
  const el = renderer.domElement
  const dist = camera.position.distanceTo(controls.target)
  const unit = (2 * dist * Math.tan((camera.fov * Math.PI / 180) / 2)) / el.clientHeight
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const shift = right.multiplyScalar(-dx * unit).add(up.multiplyScalar(dy * unit))
  camera.position.add(shift)
  controls.target.add(shift)
}
function onViewPointerUp() {
  if (!viewPan) return
  viewPan = null
  window.removeEventListener('pointermove', onViewPointerMove)
  if (controls) controls.enabled = true
}

// 更新选中家具的高亮（编辑态；避免整场景重建）
function updateSelectionHighlight() {
  if (!scene || !THREE) return
  for (const { fu, root } of furnitureNodes) {
    const sel = fu.id === props.selectedFurnitureId
    root.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.emissive.set(sel ? new THREE.Color('#3355ff') : new THREE.Color('#000000'))
        o.material.emissiveIntensity = sel ? 0.35 : 0
      }
    })
  }
}

// 释放单个 mesh 的几何与材质（共享缓存纹理 bgTex 不释放）
function disposeMesh(o, bgTex) {
  if (o.geometry) o.geometry.dispose()
  if (o.material) {
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (m.map && m.map !== bgTex) m.map.dispose()
      if (m.bumpMap && m.bumpMap !== m.map) m.bumpMap.dispose()
      m.dispose()
    }
  }
}

// 只清空建筑结构层（地面/房间色块/墙/门窗），家具与设备图标不动
function clearArch() {
  if (!archGroup) return
  const drop = []
  archGroup.traverse((o) => { if (o.isMesh) drop.push(o) })
  for (const o of drop) {
    o.parent.remove(o)
    disposeMesh(o, bgCache.tex)
  }
}

// 清空场景内容（楼层切换时重建）
function clearScene() {
  if (!scene) return
  for (const app of iconApps) { try { app.unmount() } catch {} }
  iconApps.length = 0
  furnitureNodes.length = 0
  deviceNodes.length = 0
  const drop = []
  scene.traverse((o) => { if (o.isMesh || o.isCSS2DObject) drop.push(o) })
  for (const o of drop) {
    if (o.parent) o.parent.remove(o)
    if (o.isMesh) disposeMesh(o)
  }
  bgCache.key = ''
  bgCache.tex = null
}

// 递归释放 OBJ 子树资源（几何体 / 材质 / 贴图），用于过期异步结果回退。
function disposeObject(root) {
  if (!root) return
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose() }
    }
  })
}

// 加载家具 OBJ/MTL 模型（three 内置 loader，无额外依赖）。
// mtl 可选：提供则先加载材质并预加载纹理；加载失败由调用方静默回退 Box。
async function loadFurnitureModel(model) {
  if (!OBJLoaderCtor) return null
  const objLoader = new OBJLoaderCtor()
  if (model.mtl && MTLLoaderCtor) {
    try {
      const matLoader = new MTLLoaderCtor()
      const materials = await matLoader.loadAsync(model.mtl)
      if (materials) {
        // map_Kd 等相对纹理路径按 mtl 所在目录解析
        materials.baseUrl = model.mtl.slice(0, model.mtl.lastIndexOf('/') + 1)
        if (materials.preload) materials.preload()
        objLoader.setMaterials(materials)
      }
    } catch (e) {
      // MTL 失败时仍尝试加载无材质 OBJ
      console.warn('[floorplan-3d] MTL 加载失败，回退无材质 OBJ：', model.mtl, e)
    }
  }
  try {
    return await objLoader.loadAsync(model.obj)
  } catch (e) {
    console.error('[floorplan-3d] OBJ 加载失败：', model.obj, e)
    return null
  }
}

// ---- 程序化内置家具模型：纯几何体搭建（免外部 OBJ），原点地面中心，目标 w×hh×d ----
// 材质留空，由 applyFurnitureMaterial 统一替换；返回 Group，不识别的 catalogId 返回 null
function buildProceduralModel(catalogId, w, hh, d) {
  const g = new THREE.Group()
  const B = (bw, bh, bd, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), null)
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true
    g.add(m); return m
  }
  const legs4 = (top, lh, inset) => {
    const lx = w / 2 - inset, lz = d / 2 - inset
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(3.2, lh, 3.2, sx * lx, lh / 2, sz * lz)
  }
  switch (catalogId) {
    case 'sofa': {
      const seatH = hh * 0.32
      B(w, seatH, d * 0.82, 0, seatH / 2, d * 0.09)                 // 底座
      B(w, hh * 0.62, d * 0.22, 0, hh * 0.5, -d * 0.39)            // 靠背
      B(w * 0.1, hh * 0.42, d * 0.82, -w * 0.45, hh * 0.34, d * 0.09)  // 扶手
      B(w * 0.1, hh * 0.42, d * 0.82, w * 0.45, hh * 0.34, d * 0.09)
      B(w * 0.44, hh * 0.1, d * 0.66, -w * 0.23, seatH + hh * 0.05, d * 0.11)  // 坐垫
      B(w * 0.44, hh * 0.1, d * 0.66, w * 0.23, seatH + hh * 0.05, d * 0.11)
      break
    }
    case 'bed': {
      const baseH = hh * 0.42
      B(w, baseH, d, 0, baseH / 2, 0)                               // 床架
      B(w * 0.96, hh * 0.3, d * 0.94, 0, baseH + hh * 0.15, d * 0.02)  // 床垫
      B(w, hh * 0.55, d * 0.1, 0, hh * 0.5, -d * 0.47)            // 床头板
      B(w * 0.4, hh * 0.12, d * 0.2, -w * 0.22, baseH + hh * 0.32, -d * 0.32)  // 枕
      B(w * 0.4, hh * 0.12, d * 0.2, w * 0.22, baseH + hh * 0.32, -d * 0.32)
      B(w * 0.96, hh * 0.1, d * 0.5, 0, baseH + hh * 0.28, d * 0.22)   // 被子
      break
    }
    case 'chair': {
      const seatH = hh * 0.48
      B(w * 0.9, hh * 0.09, d * 0.9, 0, seatH, 0)                  // 座面
      legs4(seatH, seatH, w * 0.12)
      B(w * 0.9, hh * 0.5, d * 0.1, 0, seatH + hh * 0.25, -d * 0.42)  // 靠背
      break
    }
    case 'coffee_table':
    case 'dining_table':
    case 'desk': {
      const topH = hh * 0.09
      B(w, topH, d, 0, hh - topH / 2, 0)                           // 桌面
      if (catalogId === 'desk') {
        B(w * 0.46, hh * 0.5, d * 0.9, -w * 0.25, hh * 0.25, 0)    // 侧柜
        legs4(hh - topH, hh - topH, w * 0.08)
      } else if (catalogId === 'coffee_table') {
        B(w, hh * 0.06, d, 0, hh * 0.18, 0)                        // 下层板
        legs4(hh - topH, hh - topH, w * 0.1)
      } else legs4(hh - topH, hh - topH, w * 0.1)
      break
    }
    case 'tv_stand':
    case 'nightstand': {
      B(w, hh * 0.96, d, 0, hh * 0.48, 0)                          // 柜体
      B(w * 0.3, hh * 0.05, 0.8, 0, hh * 0.62, d / 2 + 0.4)        // 把手
      B(w * 0.3, hh * 0.05, 0.8, 0, hh * 0.3, d / 2 + 0.4)
      break
    }
    case 'wardrobe': {
      B(w, hh * 0.98, d, 0, hh * 0.49, 0)
      B(1.2, hh * 0.9, d * 0.96, 0, hh * 0.49, 0)                  // 中缝
      B(0.8, hh * 0.3, 0.8, -w * 0.06, hh * 0.5, d / 2 + 0.4)
      B(0.8, hh * 0.3, 0.8, w * 0.06, hh * 0.5, d / 2 + 0.4)       // 把手
      break
    }
    case 'counter': {
      B(w, hh * 0.84, d, 0, hh * 0.42, 0)                          // 地柜
      B(w * 1.04, hh * 0.08, d * 1.04, 0, hh * 0.88, 0)           // 台面
      break
    }
    case 'fridge': {
      B(w * 0.98, hh * 0.98, d * 0.98, 0, hh * 0.49, 0)
      B(w * 0.4, 0.8, 0.8, 0, hh * 0.72, d / 2 + 0.4)              // 门缝把手
      break
    }
    case 'bookshelf': {
      B(w * 0.06, hh, d, -w / 2 + w * 0.03, hh / 2, 0)
      B(w * 0.06, hh, d, w / 2 - w * 0.03, hh / 2, 0)              // 侧板
      B(w, hh * 0.05, d, 0, hh * 0.97, 0)                          // 顶板
      for (let i = 1; i <= 4; i++) B(w * 0.9, hh * 0.04, d, 0, hh * i / 5, 0)  // 隔板
      break
    }
    case 'bathtub': {
      B(w, hh * 0.4, d, 0, hh * 0.2, 0)                            // 缸体
      B(w * 0.8, hh * 0.08, d * 0.84, 0, hh * 0.42, 0)            // 缸沿
      break
    }
    case 'toilet': {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.36, hh * 0.42, 20), null)
      c.position.set(0, hh * 0.21, d * 0.12); c.castShadow = true; c.receiveShadow = true; g.add(c)
      B(w * 0.8, hh * 0.4, d * 0.28, 0, hh * 0.6, -d * 0.34)       // 水箱
      break
    }
    case 'washer': {
      B(w * 0.98, hh * 0.98, d * 0.98, 0, hh * 0.49, 0)
      const c = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.32, 1.2, 24), null)
      c.position.set(0, hh * 0.72, d / 2 + 0.4); c.rotation.x = Math.PI / 2; g.add(c)  // 舱门
      break
    }
    default:
      return null
  }
  return g
}

// 统一应用家具材质参数（颜色/金属度/粗糙度/贴图纹理）到 OBJ 子树或 Box。
// 模型自带贴图（MTL map_Kd）作为默认贴图，用户选纹理预设时覆盖；
// 按预设给出 PBR 分级：漆面木质 clearcoat / 金属高金属度 / 织物高粗糙 / 皮革 sheen。
function applyFurnitureMaterial(root, fu) {
  const presetMap = proceduralFurnitureTexture(fu.texture)
  let mtlMap = null
  const meshes = []
  root.traverse((o) => {
    if (!o.isMesh) return
    meshes.push(o)
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) { if (m && m.map && !mtlMap) mtlMap = m.map }
  })
  const map = presetMap || mtlMap || null
  let metalness = fu.metalness != null ? fu.metalness : 0.05
  let roughness = fu.roughness != null ? fu.roughness : 0.7
  let envInt = 0.7
  let pbr = {}                      // MeshPhysicalMaterial 附加参数
  switch (fu.texture) {
    case 'wood':
      roughness = fu.roughness != null ? fu.roughness : 0.5
      pbr = { clearcoat: 0.25, clearcoatRoughness: 0.4 }
      break
    case 'fabric':
      metalness = 0; roughness = 0.95; envInt = 0.45
      break
    case 'metal':
      metalness = 0.85; roughness = 0.35; envInt = 1.1
      break
    case 'marble':
      roughness = fu.roughness != null ? fu.roughness : 0.25
      envInt = 0.95
      pbr = { clearcoat: 0.6, clearcoatRoughness: 0.2 }
      break
    case 'leather':
      roughness = 0.7; envInt = 0.6
      pbr = { sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffffff') }
      break
    case 'rattan':
      metalness = 0; roughness = 0.82; envInt = 0.5
      break
  }
  const Ctor = pbr.clearcoat != null || pbr.sheen != null ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial
  // 微凹凸：木纹/织物/拉丝/皮革等表面细节（bumpScale 按材质分级）
  const bump = proceduralBumpTexture(fu.texture, 256)
  const bumpScale = { wood: 0.7, fabric: 0.5, metal: 0.3, marble: 0.35, leather: 0.8, tile: 1.2, concrete: 0.8 }[fu.texture]
  for (const o of meshes) {
    o.material = new Ctor({
      map,
      color: new THREE.Color(fu.color || '#8A8986'),
      metalness,
      roughness,
      envMapIntensity: envInt,
      bumpMap: bump,
      bumpScale: bumpScale != null ? bumpScale : 0.4,
      ...pbr,
    })
  }
}

// ---- 建筑结构层：地面 / 房间色块 / 墙体（按洞口断开）/ 门窗立体 ----
async function buildArchitecture() {
  if (!scene || !archGroup || !THREE) return
  const gen = ++archToken
  clearArch()
  const f = props.floor

  // ---- 地面（始终铺地用于接收阴影；有底图优先，否则程序化木纹） ----
  let bgTex = null
  const bgUrl = f.bg && f.bg.dataUrl ? f.bg.dataUrl : ''
  if (bgUrl) {
    if (bgCache.key === bgUrl && bgCache.tex) bgTex = bgCache.tex
    else {
      bgTex = await new THREE.TextureLoader().loadAsync(bgUrl).catch(() => null)
      if (gen !== archToken) return
      if (bgTex) { bgCache.key = bgUrl; bgCache.tex = bgTex }
    }
  }
  if (gen !== archToken) return
  // ---- 地面：仅在 floorPoly 存在时渲染（地板 ≠ 画布，地板是独立绘制的多边形） ----
  const fp = f.floorPoly
  if (fp && fp.length >= 3) {
    const groundMat = makeFloorMaterial(f.floorTexture || 'wood', f.floorColor)
    const shape = new THREE.Shape(fp.map((p) => new THREE.Vector2(p[0] - props.canvas.w / 2, p[1] - props.canvas.h / 2)))
    const groundGeo = new THREE.ShapeGeometry(shape)
    scaleShapeUV(groundGeo, FLOOR_TEX_UNIT)   // 纹理按米数平铺
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    archGroup.add(ground)
  }

  // ---- 房间地板：每个房间多边形独立铺装（房间纹理优先，未设纹理用房间色块纯色） ----
  for (const r of f.rooms) {
    const poly = r.poly
    if (!poly || poly.length < 3) continue
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0] - props.canvas.w / 2, p[1] - props.canvas.h / 2)))
    const geo = new THREE.ShapeGeometry(shape)
    scaleShapeUV(geo, FLOOR_TEX_UNIT)
    const mat = r.floorTexture
      ? makeFloorMaterial(r.floorTexture, r.floorColor || r.color)
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(r.floorColor || r.color), roughness: 0.8, metalness: 0, envMapIntensity: 0.5 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0.4   // 略高于整体地面，避免 z-fighting
    mesh.receiveShadow = true
    archGroup.add(mesh)
  }

  // ---- 墙体：按门窗洞口断开逐段 Box + 门窗立体（墙面材质按楼层预设） ----
  const wallMat = makeWallMaterial(f.wallTexture || 'paint', f.wallColor)
  const doorTex = proceduralFurnitureTexture('wood')
  const doorBump = proceduralBumpTexture('wood', 256)
  const doorMat = new THREE.MeshPhysicalMaterial({
    map: doorTex, bumpMap: doorBump, bumpScale: 0.5,
    color: 0x9a7b52, roughness: 0.45, metalness: 0.05,
    clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.75,
  })
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfeaff, transparent: true, opacity: 0.24,
    roughness: 0.03, metalness: 0,
    transmission: 0.75, thickness: 0.3, ior: 1.45,
    specularIntensity: 1.0,
    envMapIntensity: 1.3,
  })
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x878c93, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.0 })   // 铝合金窗框
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x6e6258, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6 })   // 踢脚线
  const SKIRT_H = 2.6   // 踢脚线高（≈8.7cm）

  // 在两个画布点之间（a/b）放置一段墙体/门窗盒体
  const addBox = (a, b, y0, y1, mat, thickness) => {
    const A = toScene(a[0], a[1]), B = toScene(b[0], b[1])
    const len = Math.hypot(B.x - A.x, B.z - A.z)
    if (len < 1 || y1 <= y0) return
    const geo = new THREE.BoxGeometry(len, y1 - y0, thickness)
    scaleBoxUV(geo, len, y1 - y0, thickness, WALL_TEX_UNIT)   // 纹理按米数平铺，长墙不拉伸
    const box = new THREE.Mesh(geo, mat)
    box.position.set((A.x + B.x) / 2, (y0 + y1) / 2, (A.z + B.z) / 2)
    box.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x)
    box.castShadow = true
    box.receiveShadow = true
    archGroup.add(box)
  }

  // 在墙线上一点 p 处放置竖向框柱（门套/窗框），截面 fw(沿墙) × t+2(垂直墙)
  const addPost = (p, y0, y1, mat, fw, dirAng, t) => {
    if (y1 <= y0) return
    const P = toScene(p[0], p[1])
    const post = new THREE.Mesh(new THREE.BoxGeometry(fw, y1 - y0, t + 2), mat)
    post.position.set(P.x, (y0 + y1) / 2, P.z)
    post.rotation.y = dirAng
    post.castShadow = true
    post.receiveShadow = true
    archGroup.add(post)
  }

  for (const wall of f.walls) {
    const pts = wall.pts || []
    if (pts.length < 2) continue
    const H = (wall.h || 2.8) * 30   // 米 → 场景单位（与画布像素尺度大致匹配）
    const T = Math.max(4, (wall.t || 0.12) * 30)
    const wallOpenings = (f.openings || []).filter((o) => o.wallId === wall.id)

    // 主墙（全高，洞口处断开）+ 墙根踢脚线（凸出墙两侧）
    for (const sub of wallVisibleSegments(pts, wallOpenings)) {
      for (let i = 0; i < sub.length - 1; i++) {
        addBox(sub[i], sub[i + 1], 0, H, wallMat, T)
        addBox(sub[i], sub[i + 1], 0, SKIRT_H, skirtMat, T + 2)
      }
    }

    // 门窗立体
    for (const o of wallOpenings) {
      const w = o.width || 0
      const p0 = pointAlong(pts, o.offset || 0)
      const p1 = pointAlong(pts, (o.offset || 0) + w)
      const A = toScene(p0[0], p0[1]), B = toScene(p1[0], p1[1])
      const dirAng = -Math.atan2(B.z - A.z, B.x - A.x)
      if (o.kind === 'door') {
        const doorH = (o.height || 200) * 0.3   // 厘米 → 场景单位
        const len = Math.hypot(B.x - A.x, B.z - A.z)
        if (len >= 1) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(len, doorH, T * 0.35), doorMat)
          panel.position.set((A.x + B.x) / 2, doorH / 2, (A.z + B.z) / 2)
          panel.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x)
          panel.castShadow = true
          panel.receiveShadow = true
          archGroup.add(panel)
        }
        // 门套线：左右柱 + 顶部包边（酷家乐式三边门套）
        addPost(p0, 0, doorH, doorMat, 3, dirAng, T)
        addPost(p1, 0, doorH, doorMat, 3, dirAng, T)
        addBox(p0, p1, doorH - 3, doorH, doorMat, T + 2)
        addBox(p0, p1, doorH, H, wallMat, T)   // 门楣
      } else {
        const winH = (o.height || 130) * 0.3
        const sill = Math.max(H * 0.15, (H - winH) / 2)
        const top = Math.min(H, sill + winH)
        addBox(p0, p1, 0, sill, wallMat, T)    // 窗台
        addBox(p0, p1, top, H, wallMat, T)     // 窗楣
        const len = Math.hypot(B.x - A.x, B.z - A.z)
        if (len >= 1) {
          const glass = new THREE.Mesh(new THREE.BoxGeometry(len, top - sill, T * 0.3), glassMat)
          glass.position.set((A.x + B.x) / 2, (sill + top) / 2, (A.z + B.z) / 2)
          glass.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x)
          archGroup.add(glass)
        }
        // 窗框：左右框柱 + 中横梃/中竖梃（铝合金十字格）
        addPost(p0, sill, top, frameMat, 2.5, dirAng, T)
        addPost(p1, sill, top, frameMat, 2.5, dirAng, T)
        if (len >= 6) {
          const my = (sill + top) / 2
          addBox(p0, p1, my - 1, my + 1, frameMat, T * 0.5)
          const pm = pointAlong(pts, (o.offset || 0) + w / 2)
          addPost(pm, sill, top, frameMat, 2, dirAng, T)
        }
      }
    }
  }
}

async function buildScene() {
  if (!scene) return
  const gen = ++buildToken
  clearScene()
  applyLighting()
  const f = props.floor

  // 建筑结构（地面/房间/墙/门窗）
  await buildArchitecture()
  if (gen !== buildToken) return

  // ---- 家具：优先加载 OBJ 模型，无模型/加载失败回退 BoxGeometry ----
  for (const fu of (f.furniture || [])) {
    if (gen !== buildToken) return
    const w = Math.max(4, fu.w || 60)
    const d = Math.max(4, fu.d || 60)
    const hh = Math.max(4, (fu.h || 80) * 0.3)
    const p = toScene(fu.x, fu.y)
    let root = null

    if (fu.model && fu.model.obj) {
      const raw = await loadFurnitureModel(fu.model).catch(() => null)
      if (gen !== buildToken) { disposeObject(raw); return }
      if (raw) {
        // 归一化：按目标尺寸（w/d 画布单位、hh 场景单位）等比缩放并落地居中，
        // 用包装 Group 承载旋转，避免模型原点偏移导致旋转偏心。
        const wrap = new THREE.Group()
        wrap.add(raw)
        const bb = new THREE.Box3().setFromObject(raw)
        const size = new THREE.Vector3(); bb.getSize(size)
        const scale = Math.min(
          size.x > 0 ? w / size.x : 1,
          size.y > 0 ? hh / size.y : 1,
          size.z > 0 ? d / size.z : 1,
        )
        raw.scale.setScalar(scale)
        const bb2 = new THREE.Box3().setFromObject(raw)
        const center = new THREE.Vector3(); bb2.getCenter(center)
        raw.position.set(-center.x, -bb2.min.y, -center.z)
        raw.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
        wrap.rotation.y = (fu.rotation || 0) * Math.PI / 180
        wrap.position.set(p.x, 0, p.z)
        furnitureGroup.add(wrap)
        root = wrap
      }
    }

    if (!root) {
      // OBJ 缺失/加载失败：优先程序化内置模型，仍不识别才回退方块
      const pm = buildProceduralModel(fu.catalogId, w, hh, d)
      if (pm) {
        const wrap = new THREE.Group()
        wrap.add(pm)
        wrap.rotation.y = (fu.rotation || 0) * Math.PI / 180
        wrap.position.set(p.x, 0, p.z)
        furnitureGroup.add(wrap)
        root = wrap
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), null)
        box.position.set(p.x, hh / 2, p.z)
        box.rotation.y = (fu.rotation || 0) * Math.PI / 180
        box.castShadow = true
        box.receiveShadow = true
        furnitureGroup.add(box)
        root = box
      }
    }

    // 统一应用材质参数（颜色/金属度/粗糙度/贴图），并标记供编辑态射线拾取
    applyFurnitureMaterial(root, fu)
    root.userData.furnitureId = fu.id
    furnitureNodes.push({ fu, root, w: fu.w, d: fu.d, h: fu.h, matKey: [fu.color, fu.metalness, fu.roughness, fu.texture].join('|'), modelKey: fu.model && fu.model.obj ? (fu.model.obj + '|' + (fu.model.mtl || '')) : '' })
  }

  updateSelectionHighlight()

  // ---- 设备图标：CSS2DObject + 迷你 Vue app ----
  const sorted = [...props.items].sort((a, b) => a.dev.y - b.dev.y)
  sorted.forEach((it, idx) => {
    const div = document.createElement('div')
    div.style.pointerEvents = 'auto'
    div.style.cursor = 'pointer'
    div.style.zIndex = String(idx + 1)
    const app = createApp(DeviceIconRenderer, {
      device: it.dev,
      entity: it.entity,
      size: Math.max(28, it.dev.size * 0.8),
      onClick: () => emit('device-click', it.dev),
    })
    app.mount(div)
    iconApps.push(app)
    const p = toScene(it.dev.x, it.dev.y)
    const obj = new (css2dRef())(div)
    obj.position.set(p.x, 26, p.z)
    scene.add(obj)
    deviceNodes.push({ id: it.dev.id, obj })
  })
}

// CSS2DObject 构造器引用（动态 import 后保存）
let CSS2DObjectCtor = null
function css2dRef() { return CSS2DObjectCtor }

// 家具增删/尺寸变化 → 防抖全量重建（避免拖拽/滑动期间频繁重载 OBJ）
function scheduleRebuild() {
  if (rebuildTimer) return
  rebuildTimer = setTimeout(() => { rebuildTimer = null; if (scene) buildScene() }, 160)
}

// 墙/门/窗/房间变化 → 防抖只重建架构层（不触碰家具模型与设备图标）
function scheduleArchRebuild() {
  if (archTimer) return
  archTimer = setTimeout(() => { archTimer = null; buildArchitecture() }, 120)
}

// 家具变化 → 轻量同步（位置/旋转/材质实时跟随；增删/尺寸变化则防抖重建）
function syncFurniture() {
  if (!scene || !THREE) return
  const list = props.floor.furniture || []
  const ids = new Set(list.map((x) => x.id))
  if (ids.size !== furnitureNodes.length || furnitureNodes.some((n) => !ids.has(n.fu.id))) {
    scheduleRebuild(); return
  }
  for (const fu of list) {
    const node = furnitureNodes.find((n) => n.fu.id === fu.id)
    if (!node) continue
    node.fu = fu
    const p = toScene(fu.x, fu.y)
    node.root.position.set(p.x, 0, p.z)
    node.root.rotation.y = (fu.rotation || 0) * Math.PI / 180
    const mKey = fu.model && fu.model.obj ? (fu.model.obj + '|' + (fu.model.mtl || '')) : ''
    if (node.w !== fu.w || node.d !== fu.d || node.h !== fu.h || node.modelKey !== mKey) { scheduleRebuild(); return }
    const key = [fu.color, fu.metalness, fu.roughness, fu.texture].join('|')
    if (node.matKey !== key) {
      node.matKey = key
      applyFurnitureMaterial(node.root, fu)
    }
  }
  updateSelectionHighlight()
}

// 设备位置变化 → 实时同步 CSS2D 图标位置（y 固定 26，避免重建标签）
function syncDevices() {
  if (!scene) return
  const byId = new Map(deviceNodes.map((n) => [n.id, n]))
  for (const it of props.items) {
    const node = byId.get(it.dev.id)
    if (!node) continue
    const p = toScene(it.dev.x, it.dev.y)
    node.obj.position.set(p.x, 26, p.z)
  }
}

onMounted(async () => {
  await nextTick()
  await init()
})

// 楼层/设备变化 → 重建场景内容
watch(() => [props.floor.id, props.items.length], () => { if (scene) buildScene() })

// 墙体 / 门窗洞口 / 房间 / 地板（形状/颜色/材质）变化 → 防抖只重建架构层（编辑态 3D 实时预览）
watch(() => [props.floor.walls, props.floor.openings, props.floor.rooms, props.floor.floorPoly, props.floor.floorColor, props.floor.floorTexture, props.floor.wallColor, props.floor.wallTexture], scheduleArchRebuild, { deep: true })

// 背景底图（图片/透明度）变化 → 重建架构层，纹理走缓存不重新 decode
watch(() => props.floor.bg, scheduleArchRebuild, { deep: true })

// 设备位置（2D 拖拽）变化 → 实时同步 CSS2D 图标位置
watch(() => props.items, syncDevices, { deep: true })

// 家具（位置/材质/增删）变化 → 轻量同步或防抖重建
watch(() => props.floor.furniture, syncFurniture, { deep: true })

// 选中家具变化 → 更新 3D 高亮
watch(() => props.selectedFurnitureId, () => { if (scene) updateSelectionHighlight() })

// 光照参数变化 → 实时更新灯光（不重建场景）
watch(() => props.floor.lighting, () => { if (scene) applyLighting() }, { deep: true })

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null }
  if (themeObs) { themeObs.disconnect(); themeObs = null }
  clearScene()
  if (scene) {
    if (scene.environment) scene.environment.dispose()
    if (bgGradient) { bgGradient.dispose(); bgGradient = null }
  }
  if (controls) controls.dispose()
  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
    renderer.domElement.removeEventListener('pointerdown', onViewPointerDown, true)
    renderer.domElement.removeEventListener('pointerup', onViewPointerUp, true)
    window.removeEventListener('pointermove', onViewPointerMove)
    renderer.dispose()
    renderer.domElement.remove()
  }
  if (labelRenderer) labelRenderer.domElement.remove()
  if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null }
  if (archTimer) { clearTimeout(archTimer); archTimer = null }
  archGroup = null
  furnitureGroup = null
  scene = null
})
</script>

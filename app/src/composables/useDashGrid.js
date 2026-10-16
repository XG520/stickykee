import { ref, computed } from 'vue'

// 仪表盘网格测量与卡片缩放：电脑端 HomeView 与手机端 ApkDashPane 共用同一套计算。
// 基准格子 baseCell：卡片内容按固定尺寸布局，再整体 transform:scale 到实际格子，
// 窗口/机型变化时内部元素等比缩放、相对位置与换行不变。
//
// 参数：
//   el       测量元素 ref（clientWidth 为网格可用宽；手机端传手机外框，配 padX 扣除内边距）
//   cols     当前列数 ref（电脑端自适应/用户设置，手机端取真机配置）
//   padX     测量元素两侧内边距合计（手机外框 p-2 → 16；电脑网格自身无内边距 → 0）
//   minInner 内容宽下限（手机端口径 Math.max(80, w-16)；电脑端为 0）
export function useDashGrid({
  el,
  cols,
  baseCell = 120,
  gap = 12,
  padX = 0,
  minInner = 0,
} = {}) {
  const cellSize = ref(0)
  const zoomFactor = computed(() => (cellSize.value > 0 ? cellSize.value / baseCell : 1))

  // 按当前 cols 重测单格像素（行高 = 列宽，1×1 为正方形）
  function measure() {
    const node = el?.value
    // 元素尚未渲染/被隐藏（keep-alive）时 clientWidth 为 0：保留原值，避免算出负/假尺寸
    if (!node || node.clientWidth === 0) return 0
    const inner = Math.max(minInner, node.clientWidth - padX)
    cellSize.value = (inner - gap * (cols.value - 1)) / cols.value
    return cellSize.value
  }

  // 卡片在当前列数下实际占据的行列数（宽钳制到列数，高钳制到 3）
  function spans(card) {
    return {
      cw: Math.min(Math.max(1, card.w || 1), cols.value),
      ch: Math.min(3, Math.max(1, card.h || 1)),
    }
  }

  // 卡片内容盒样式：用 transform:scale 而非 zoom——zoom 会触发同步重排，
  // 且与卡片的 container-type/content-visibility 组合在窄屏下产生反复失效重排（画面跳动）。
  // holder 跨 cw 列/ch 行，盒尺寸含轨道间距并按缩放反算，
  // zoom 后必须恰好覆盖 holder，否则右侧/底部残留空白条（悬停误触、阴影盒越界）。
  function zoomStyle(card) {
    const { cw, ch } = spans(card)
    const z = zoomFactor.value
    return {
      transform: `scale(${z})`,
      width: cw * baseCell + (cw - 1) * gap / z + 'px',
      height: ch * baseCell + (ch - 1) * gap / z + 'px',
      display: 'flex',
      flexDirection: 'column',
      flex: 'none',
    }
  }

  // 网格容器公共样式：边框厚度按缩放反向补偿，使 1px 边框渲染厚度恒定 ≈1px
  const gridStyle = computed(() => ({
    '--card-bw': (1 / (zoomFactor.value || 1)).toFixed(3) + 'px',
    gridTemplateColumns: `repeat(${cols.value}, minmax(0, 1fr))`,
    gridAutoRows: cellSize.value ? cellSize.value + 'px' : 'auto',
  }))

  // holder 占位样式：grid span + 圆角随 zoom 与卡片壳曲线重合。
  // display/flex 等布局附加项由调用方按自身 DOM 结构合并。
  function holderStyle(card) {
    const { cw, ch } = spans(card)
    return {
      gridColumn: `span ${cw}`,
      gridRow: `span ${ch}`,
      borderRadius: (14 * (zoomFactor.value || 1)).toFixed(2) + 'px',
    }
  }

  // 卡片占满的像素盒宽/高（含轨道间距）：跨栏浮动幽灵按目标端格子钳制尺寸时使用
  function spanSize(card) {
    const { cw, ch } = spans(card)
    return {
      w: cw * cellSize.value + (cw - 1) * gap,
      h: ch * cellSize.value + (ch - 1) * gap,
    }
  }

  return { cellSize, zoomFactor, measure, spans, zoomStyle, gridStyle, holderStyle, spanSize, gap }
}

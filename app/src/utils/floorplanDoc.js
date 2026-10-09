// 户型图文档模型与工具函数。
// 文档结构（存 user_prefs 的 floorplan_doc key，JSON 字符串）：
// {
//   version, canvas: {w, h, grid},
//   floors: [{
//     id, name, bg: {dataUrl, opacity},
//     walls: [{id, pts, h, t}],                       // h 墙高(米) t 墙厚(米)
//     openings: [{id, wallId, offset, width, height, kind: door|window, name}],  // 门窗洞口
//     furniture: [{id, catalogId, category, name, x, y, w, d, h, rotation, icon, color, model}], // 普通家具；model={obj,mtl} 挂 3D 模型
//     rooms: [{id, name, area, poly, color}],
//     devices: [{id, deviceId, entityId, x, y, size, roomId,
//                icon: {kind: material|image|code, name, dataUrl, code: {html, css, js}},
//                stateMap: {on: {color, icon}, off: {color, icon}} }]
//   }]
// }

// 设备主实体：优先可控域（灯/空调/窗帘/开关/风扇），其次任意未禁用实体。
// 传感器等只读设备也展示，开关代理到主实体失败时静默回滚。
export const PRIMARY_DOMAINS = ['light', 'climate', 'cover', 'fan', 'switch', 'plug', 'media_player', 'lock']

export function mainEntityOf(d) {
  const list = (d.entities || []).filter((e) => !e.disabled)
  if (!list.length) return null
  for (const dom of PRIMARY_DOMAINS) {
    const hit = list.find((e) => e.domain === dom)
    if (hit) return hit
  }
  return list[0]
}

let seq = 0
export function uid(prefix = 'id') {
  seq = (seq + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}`
}

export function snap(v, grid = 20) {
  if (!grid || grid <= 1) return Math.round(v)
  return Math.round(v / grid) * grid
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

export function defaultFloor(name = '一层') {
  // IBL 环境光照提供环境填充，直射光只需塑造阴影立体感
  return { id: uid('f'), name, bg: { dataUrl: '', opacity: 0.6 }, walls: [], openings: [], furniture: [], rooms: [], devices: [], lighting: { ambient: 0.25, dir: 2.2, color: '#ffffff', shadow: true }, floorPoly: null, floorColor: '', floorTexture: 'wood', wallColor: '', wallTexture: 'paint' }
}

export function defaultDoc() {
  return { version: 1, canvas: { w: 1000, h: 800, grid: 20 }, floors: [defaultFloor('一层')] }
}

// 解析后端返回的文档 JSON；损坏/缺失时回退默认文档。
export function parseDoc(raw) {
  try {
    const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!doc || !Array.isArray(doc.floors) || !doc.floors.length) return defaultDoc()
    if (!doc.canvas || !doc.canvas.w) doc.canvas = { w: 1000, h: 800, grid: 20 }
    for (const f of doc.floors) {
      f.bg = f.bg || { dataUrl: '', opacity: 0.6 }
      f.lighting = { ambient: 0.25, dir: 2.2, color: '#ffffff', shadow: true, ...(f.lighting || {}) }
      // 迁移无 IBL 时代的高环境光旧默认（会洗平阴影、无对比度）
      if ((f.lighting.ambient === 2.2 && f.lighting.dir === 3.0)
        || (f.lighting.ambient === 1.0 && f.lighting.dir === 3.4)) {
        f.lighting.ambient = 0.25; f.lighting.dir = 2.2
      }
      f.walls = Array.isArray(f.walls) ? f.walls : []
      f.openings = Array.isArray(f.openings) ? f.openings : []
      f.furniture = Array.isArray(f.furniture) ? f.furniture : []
      f.rooms = Array.isArray(f.rooms) ? f.rooms : []
      // 地板多边形：null = 用整个画布；数组 = 自定义形状
      if (f.floorPoly === undefined) f.floorPoly = null
      if (f.floorColor == null) f.floorColor = ''
      if (f.floorTexture == null) f.floorTexture = 'wood'
      // 墙面材质（3D 渲染）：wallColor 空 = 白墙原色；wallTexture 默认乳胶漆
      if (f.wallColor == null) f.wallColor = ''
      if (f.wallTexture == null) f.wallTexture = 'paint'
      // 房间字段归一化：补齐地板材质字段
      for (const r of f.rooms) {
        if (!r.id) r.id = uid('r')
        r.name = r.name || '房间'
        r.color = r.color || '#F5A623'
        if (r.floorColor == null) r.floorColor = ''   // 空 = 用 r.color 渲染
        if (r.floorTexture == null) r.floorTexture = '' // 空 = 纯色
      }
      f.devices = Array.isArray(f.devices) ? f.devices : []
      // 墙体字段归一化：id 供洞口引用，h/t 默认 2.8m/0.12m
      for (const w of f.walls) {
        if (!w.id) w.id = uid('w')
        if (w.h == null) w.h = 2.8
        if (w.t == null) w.t = 0.12
      }
      // 门窗洞口字段归一化
      for (const o of f.openings) {
        if (!o.id) o.id = uid('o')
        o.kind = o.kind === 'window' ? 'window' : 'door'
        if (o.width == null) o.width = o.kind === 'door' ? 90 : 120
        if (o.height == null) o.height = o.kind === 'door' ? 200 : 130
        if (o.offset == null) o.offset = 0
        o.name = o.name || (o.kind === 'door' ? '门' : '窗')
      }
      // 家具字段归一化
      for (const fu of f.furniture) {
        if (!fu.id) fu.id = uid('fr')
        fu.rotation = fu.rotation || 0
        if (fu.w == null) fu.w = 60
        if (fu.d == null) fu.d = 60
        if (fu.h == null) fu.h = 80
        // 材质/渲染字段（未持久化的旧文档补齐默认值）
        if (fu.color == null) fu.color = catalogColor(fu.catalogId) || '#8A8986'
        if (fu.metalness == null) fu.metalness = 0.05
        if (fu.roughness == null) fu.roughness = 0.7
        if (fu.texture == null) fu.texture = ''
        // 旧文档家具未持久化 model 字段时，按 catalogId 从目录反查真实 3D 模型路径
        fu.model = (fu.model && fu.model.obj) ? fu.model : catalogModel(fu.catalogId)
      }
      // 设备字段归一化：补齐 icon/stateMap 缺失字段，避免旧文档触发 undefined 访问
      for (const d of f.devices) {
        d.size = d.size || 44
        d.icon = d.icon || { kind: 'material', name: 'widgets', dataUrl: '', code: { html: '', css: '', js: '' } }
        d.icon.code = d.icon.code || { html: '', css: '', js: '' }
        d.stateMap = d.stateMap || {}
        d.stateMap.on = d.stateMap.on || { color: '#F5A623', icon: '' }
        d.stateMap.off = d.stateMap.off || { color: '#8A8986', icon: '' }
      }
    }
    return doc
  } catch {
    return defaultDoc()
  }
}

// 由注册表设备生成一个放置项（默认 material 图标，按域取字形）。
export function placementFromDevice(regDevice, x, y, domainGlyph) {
  const me = mainEntityOf(regDevice)
  const domain = regDevice.domain || (me && me.domain) || 'switch'
  return {
    id: uid('dev'),
    deviceId: regDevice.device && regDevice.device.id ? String(regDevice.device.id) : '',
    entityId: me ? me.entity_id : '',
    x, y, size: 44, roomId: '',
    icon: { kind: 'material', name: (domainGlyph && domainGlyph[domain]) || 'widgets', dataUrl: '', code: { html: '', css: '', js: '' } },
    stateMap: { on: { color: '#F5A623', icon: '' }, off: { color: '#8A8986', icon: '' } },
  }
}

// 图片压缩为 dataURL：长边 ≤ maxDim，JPEG 质量 quality；超限返回 null。
export function compressImage(file, maxDim = 1600, quality = 0.8, maxBytes = 500 * 1024) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        cv.getContext('2d').drawImage(img, 0, 0, w, h)
        let out = cv.toDataURL('image/jpeg', quality)
        // 仍超限则降质重试一次
        if (out.length > maxBytes * 1.37) out = cv.toDataURL('image/jpeg', 0.55)
        resolve(out.length > maxBytes * 1.37 ? null : out)
      } catch {
        resolve(null)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

// 内置图标候选（设备图标选择器用）
export const ICON_CHOICES = [
  'lightbulb', 'light', 'ceiling_light', 'table_lamp', 'wall_lamp', 'light_group',
  'thermostat', 'ac_unit', 'mode_fan', 'air', 'humidity_percentage',
  'curtains', 'blinds', 'door_front', 'door_open', 'window',
  'power', 'power_outlet', 'switch', 'toggle_on', 'cable',
  'tv', 'speaker', 'speaker_group', 'videocam', 'camera',
  'lock', 'lock_open', 'shield', 'sensor_occupied', 'sensors',
  'robot', 'vacuum', 'yard', 'water_drop', 'faucet',
  'microwave', 'oven_gen', 'dishwasher_gen', 'refrigerator', 'kettle',
  'mode_cool', 'mode_heat', 'mode_fan', 'mode_night', 'wb_sunny',
]

// 门窗类型（墙上洞口使用；尺寸为画布单位，与 device.size≈44 同尺度）
export const OPENING_CHOICES = [
  { kind: 'door', name: '单开门', icon: 'door_front', width: 90, height: 200 },
  { kind: 'window', name: '平开窗', icon: 'window', width: 120, height: 130 },
]

// 家具分类与目录（普通家具，非智能设备；拖放/缩放/旋转）
export const FURNITURE_CATEGORIES = [
  { key: 'living', name: '客厅', icon: 'weekend' },
  { key: 'bedroom', name: '卧室', icon: 'bed' },
  { key: 'dining', name: '餐厅', icon: 'table_restaurant' },
  { key: 'kitchen', name: '厨房', icon: 'kitchen' },
  { key: 'bath', name: '卫浴', icon: 'bathtub' },
  { key: 'office', name: '书房', icon: 'desk' },
]

// 家具目录。每个项可带可选 model 字段挂接真实 3D 模型（OBJ/MTL）：
// 模型与纹理放置于 app/public/models/furniture/<id>/ 目录，路径相对 public 根。
// 例：model: { obj: 'models/furniture/sofa/sofa.obj', mtl: 'models/furniture/sofa/sofa.mtl' }
// mtl 可选；model 为 null 时 3D 视图回退 Box 占位。
//
// 内置模型版权署名（全部来自 Sweet Home 3D 免费 3D 模型库，均可免费商用，须保留作者署名）：
//   - 绝大多数模型采用 Free Art License 或 CC-BY 3.0 双许可证（二选一），
//     作者署名嵌入各模型 .obj/.mtl 头部的注释中（如 sofa1、bookcase © 2010 Peter Smolik）。
//   - tableBasse（tableBasse.obj）© Etienne Gerard，Licence Art Libre。
// 来源：https://www.sweethome3d.com/free-3d-models/
export const FURNITURE_CATALOG = [
  { id: 'sofa', category: 'living', name: '沙发', icon: 'weekend', w: 180, d: 90, h: 80, color: '#ffffff', model: { obj: 'models/furniture/sofa/sofa1.obj', mtl: 'models/furniture/sofa/sofa1.mtl' } },
  { id: 'coffee_table', category: 'living', name: '茶几', icon: 'table_bar', w: 100, d: 60, h: 45, color: '#b0895c', model: { obj: 'models/furniture/coffee_table/tableBasse.obj' } },
  { id: 'tv_stand', category: 'living', name: '电视柜', icon: 'tv', w: 160, d: 40, h: 50, color: '#ffffff', model: { obj: 'models/furniture/tv_stand/TVCenter.obj', mtl: 'models/furniture/tv_stand/TVCenter.mtl' } },
  { id: 'bed', category: 'bedroom', name: '双人床', icon: 'bed', w: 180, d: 200, h: 60, color: '#e8e2d8', model: { obj: 'models/furniture/bed/litParents.obj' } },
  { id: 'wardrobe', category: 'bedroom', name: '衣柜', icon: 'door_sliding', w: 180, d: 56, h: 220, color: '#a08060', model: { obj: 'models/furniture/wardrobe/armoire.obj' } },
  { id: 'nightstand', category: 'bedroom', name: '床头柜', icon: 'table', w: 45, d: 40, h: 50, color: '#ffffff', model: { obj: 'models/furniture/nightstand/meubleChevet.obj', mtl: 'models/furniture/nightstand/meubleChevet.mtl' } },
  { id: 'dining_table', category: 'dining', name: '餐桌', icon: 'table_restaurant', w: 140, d: 80, h: 75, color: '#b0895c', model: { obj: 'models/furniture/dining_table/table2.obj' } },
  { id: 'chair', category: 'dining', name: '餐椅', icon: 'chair', w: 45, d: 50, h: 90, color: '#c9a06a', model: { obj: 'models/furniture/chair/chair.obj' } },
  { id: 'counter', category: 'kitchen', name: '橱柜', icon: 'countertops', w: 120, d: 60, h: 85, color: '#ffffff', model: { obj: 'models/furniture/counter/counter.obj', mtl: 'models/furniture/counter/counter.mtl' } },
  { id: 'fridge', category: 'kitchen', name: '冰箱', icon: 'kitchen', w: 70, d: 70, h: 180, color: '#ffffff', model: { obj: 'models/furniture/fridge/frigo.obj', mtl: 'models/furniture/fridge/frigo.mtl' } },
  { id: 'desk', category: 'office', name: '书桌', icon: 'desk', w: 120, d: 60, h: 75, color: '#ffffff', model: { obj: 'models/furniture/desk/desk.obj', mtl: 'models/furniture/desk/desk.mtl' } },
  { id: 'bookshelf', category: 'office', name: '书架', icon: 'shelves', w: 90, d: 30, h: 200, color: '#ffffff', model: { obj: 'models/furniture/bookshelf/bookcase.obj', mtl: 'models/furniture/bookshelf/bookcase.mtl' } },
  { id: 'bathtub', category: 'bath', name: '浴缸', icon: 'bathtub', w: 80, d: 170, h: 60, color: '#ffffff', model: { obj: 'models/furniture/bathtub/bathtub_jet_system.obj', mtl: 'models/furniture/bathtub/bathtub_jet_system.mtl' } },
  { id: 'toilet', category: 'bath', name: '马桶', icon: 'wc', w: 40, d: 70, h: 70, color: '#ffffff', model: { obj: 'models/furniture/toilet/toilet_hang_round.obj', mtl: 'models/furniture/toilet/toilet_hang_round.mtl' } },
  { id: 'washer', category: 'bath', name: '洗衣机', icon: 'local_laundry_service', w: 60, d: 60, h: 85, color: '#ffffff', model: { obj: 'models/furniture/washer/washer_dryer.obj', mtl: 'models/furniture/washer/washer_dryer.mtl' } },
]

// 按目录 id 反查模型路径（旧文档家具未存 model 时回填）
export function catalogModel(catalogId) {
  const item = FURNITURE_CATALOG.find((c) => c.id === catalogId)
  return (item && item.model) || null
}

// 按目录 id 反查默认材质主色（旧文档家具未存 color 时回填）
export function catalogColor(catalogId) {
  const item = FURNITURE_CATALOG.find((c) => c.id === catalogId)
  return (item && item.color) || null
}

// 家具 3D 贴图/纹理预设（程序化生成，无需外部图片）
export const TEXTURE_PRESETS = [
  { key: '', name: '原始贴图' },
  { key: 'wood', name: '木纹' },
  { key: 'fabric', name: '布纹' },
  { key: 'metal', name: '金属拉丝' },
  { key: 'marble', name: '大理石' },
  { key: 'leather', name: '皮革' },
  { key: 'rattan', name: '藤编' },
]

// 房间地板纹理预设（3D 渲染用，与家具纹理共享 key 空间）
export const FLOOR_TEXTURE_PRESETS = [
  { key: '', name: '纯色' },
  { key: 'wood', name: '木地板' },
  { key: 'herringbone', name: '人字拼木' },
  { key: 'marble', name: '大理石' },
  { key: 'tile', name: '瓷砖' },
  { key: 'cementtile', name: '花砖' },
  { key: 'terrazzo', name: '水磨石' },
  { key: 'carpet', name: '地毯' },
  { key: 'concrete', name: '水泥' },
]

// 墙面材质预设（3D 渲染用）
export const WALL_TEXTURE_PRESETS = [
  { key: 'paint', name: '乳胶漆' },
  { key: 'wallpaper', name: '壁纸' },
  { key: 'brick', name: '文化砖' },
  { key: 'stone', name: '文化石' },
  { key: 'woodpanel', name: '木饰面' },
  { key: 'wainscot', name: '护墙板' },
  { key: 'diatom', name: '硅藻泥' },
  { key: 'concrete', name: '清水混凝土' },
]

// 由家具目录项生成一个放置实例
export function furnitureFromCatalog(item, x, y) {
  return {
    id: uid('fr'),
    catalogId: item.id, category: item.category, name: item.name,
    x, y, w: item.w, d: item.d, h: item.h, rotation: 0,
    icon: item.icon, color: item.color || '#8A8986',
    metalness: 0.05, roughness: 0.7, texture: '',
    model: item.model || null,
  }
}

// ---- 墙体端点吸附（Sweet Home 3D 级别画墙辅助） ----
// 点到线段最近点（投影，钳制在 [0,1]）
function pointOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: a[0], y: a[1] }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { x: a[0] + t * dx, y: a[1] + t * dy }
}

// 将新墙的每个端点吸附到既有墙的端点（L 形）或墙段上的投影点（T 形），
// 并在首尾点接近时自动闭合。返回吸附后的折点（已去重；连续重复点剔除）。
export function snapWallPts(pts, walls, threshold = 10) {
  if (!pts || pts.length < 2) return pts.slice()
  const wallList = walls || []
  const endCands = []
  const segs = []
  for (const w of wallList) {
    const ps = w.pts || []
    for (const p of ps) endCands.push([p[0], p[1]])
    for (let i = 0; i + 1 < ps.length; i++) segs.push([ps[i], ps[i + 1]])
  }
  const result = pts.map((p) => {
    let best = null, bestD = threshold
    for (const c of endCands) {
      const d = Math.hypot(c[0] - p[0], c[1] - p[1])
      if (d <= bestD) { bestD = d; best = [c[0], c[1]] }
    }
    for (const [a, b] of segs) {
      const pr = pointOnSegment(p, a, b)
      const d = Math.hypot(pr.x - p[0], pr.y - p[1])
      if (d <= bestD) { bestD = d; best = [pr.x, pr.y] }
    }
    return best || [p[0], p[1]]
  })
  // 自动闭合：首尾点接近则合并为同一点
  if (result.length > 2) {
    const a = result[0], b = result[result.length - 1]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= threshold) result[result.length - 1] = [a[0], a[1]]
  }
  // 剔除连续重复点
  const dedup = [result[0]]
  for (let i = 1; i < result.length; i++) {
    const a = dedup[dedup.length - 1], b = result[i]
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5) dedup.push(b)
  }
  return dedup
}

// ---- 折线几何（门窗洞口用） ----
export const PLAN_SCALE = 40   // 画布单位 / 米（与 2D strokeW 的 t*40 尺度一致）

// 多边形面积（绝对值，鞋带公式）
export function polygonArea(poly) {
  if (!poly || poly.length < 3) return 0
  let s = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
  }
  return Math.abs(s) / 2
}

export function polylineLength(pts) {
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    acc += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  }
  return acc
}

// 折线上距离 d 处的点（d 沿折线累计弧长）
export function pointAlong(pts, d) {
  if (!pts || !pts.length) return [0, 0]
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const seg = Math.hypot(dx, dy)
    if (d <= acc + seg) {
      const t = seg > 1e-6 ? (d - acc) / seg : 0
      return [a[0] + dx * t, a[1] + dy * t]
    }
    acc += seg
  }
  return [pts[pts.length - 1][0], pts[pts.length - 1][1]]
}

// 折线上 [s,e] 距离区间的点串（含起止投影点与中间顶点）
function rangePoints(pts, s, e) {
  const res = [pointAlong(pts, s)]
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const b = pts[i + 1]
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    const next = acc + seg
    if (next > s && next < e) res.push(b)
    acc = next
  }
  res.push(pointAlong(pts, e))
  return res
}

// 将墙体按洞口（opening.offset + opening.width 沿折线）断开，
// 返回可见墙段（每段为点串数组）。
export function wallVisibleSegments(pts, openings) {
  if (!pts || pts.length < 2) return []
  const total = polylineLength(pts)
  const intervals = (openings || [])
    .map((o) => {
      const s = clamp(o.offset || 0, 0, total)
      const e = clamp(s + (o.width || 0), s, total)
      return [s, e]
    })
    .filter(([s, e]) => e - s > 0.5)
    .sort((a, b) => a[0] - b[0])
  const ranges = []
  let cur = 0
  for (const [s, e] of intervals) {
    if (s > cur) ranges.push([cur, s])
    if (e > cur) cur = e
  }
  if (cur < total) ranges.push([cur, total])
  return ranges.map(([s, e]) => rangePoints(pts, s, e))
}

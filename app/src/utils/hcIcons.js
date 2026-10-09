// 统一图标基础设施：把 material-symbols-outlined 字体图标替换为后端内嵌的
// Material Symbols SVG（CSS mask + currentColor 着色），不再依赖前端打包的图标字体。
// 供卡片（CodeCard）与全局兜底（MutationObserver）共同复用，替换幂等、从后端加载。
let known = null // 后端可用图标名集合（Set）；null=未就绪
let listPromise = null

// 拉取一次后端图标名列表并缓存。
export function loadIconList() {
  if (!listPromise) {
    listPromise = (async () => {
      try {
        const r = await fetch('/api/v1/icons')
        const j = r.ok ? await r.json() : { data: [] }
        known = new Set(j.data || [])
      } catch {
        known = new Set()
      }
    })()
  }
  return listPromise
}

export function isIconKnown(name) {
  return !!(known && known.has(name))
}

export function iconUrl(name) {
  return '/api/v1/icons/' + encodeURIComponent(name) + '.svg'
}

// 把 root 内尚未替换的 material-symbols-outlined 图标替换为后端 SVG（CSS mask）。
// 只要图标名合法就走后端：后端优先返回本地内嵌 SVG，未收录时实时从 Material Symbols
// 官方源下载兜底，因此任意 mdi/ha 图标名都能渲染为图形而非英文字母。
export function replaceIconsIn(root) {
  if (!root) return
  const spans = root.querySelectorAll
    ? root.querySelectorAll('span.material-symbols-outlined')
    : []
  spans.forEach((sp) => {
    if (sp.dataset.hci) return // 已替换
    const name = (sp.textContent || '').trim()
    if (!name || !/^[a-z0-9_]+$/.test(name)) return // 模板文本/非法名保留
    const fs = window.getComputedStyle(sp).fontSize // 保留原字体尺寸，交由 1em 缩放
    const url = iconUrl(name)
    sp.classList.remove('material-symbols-outlined')
    sp.classList.add('hc-iconsvg')
    sp.dataset.hci = '1'
    sp.textContent = ''
    sp.style.fontSize = fs
    sp.style.maskImage = 'url("' + url + '")'
    sp.style.webkitMaskImage = 'url("' + url + '")'
  })
}

export function isWatcherActive() {
  return !!watcherActive
}
let watcherActive = false

// 全局兜底：监听 body 子树变化，把新出现/重建的字体图标也替换为后端 SVG，
// 并移除对打包字体文件的依赖（避免字体未加载时图标退化成英文文本）。
// 性能要点：
//  1. 跳过 [data-hc-self] 子树——卡片（CodeCard）自管理图标替换，多卡场景下
//     每次实体刷新都会重建卡片 DOM，若全局兜底再逐卡重扫，代价为 O(卡片数²)/批；
//  2. rAF 合并同一帧内的多次变更，只按根节点去重扫描一次。
export function initIconWatcher() {
  if (watcherActive) return
  watcherActive = true
  loadIconList().then(() => {
    replaceIconsIn(document.body)
    let scheduled = false
    const targets = new Set()
    const inCard = (n) => {
      const el = n && n.nodeType === 1 ? n : n && n.parentElement
      return !!(el && el.closest && el.closest('[data-hc-self]'))
    }
    const flush = () => {
      scheduled = false
      for (const t of targets) replaceIconsIn(t)
      targets.clear()
    }
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (inCard(m.target)) continue
        let added = false
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && !inCard(n)) { targets.add(n); added = true }
        }
        // 没有元素级新增时（如纯文本/属性变更），退回扫描变更目标本身
        if (!added && !inCard(m.target)) {
          const el = m.target.nodeType === 1 ? m.target : m.target.parentElement
          if (el) targets.add(el)
        }
      }
      if (targets.size && !scheduled) {
        scheduled = true
        requestAnimationFrame(flush)
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}
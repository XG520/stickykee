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
export function initIconWatcher() {
  if (watcherActive) return
  watcherActive = true
  loadIconList().then(() => {
    replaceIconsIn(document.body)
    new MutationObserver((muts) => {
      for (const m of muts) {
        replaceIconsIn(m.target)
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) replaceIconsIn(n)
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
}
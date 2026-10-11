import { createRouter, createWebHistory } from 'vue-router'
import { auth, loadMe, siteName, loadSiteName } from '@/store'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: '首页' } },
  { path: '/map', name: 'map', component: () => import('@/views/MapView.vue'), meta: { title: '地图' } },
  { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue'), meta: { title: '能耗总览' } },
  { path: '/floorplan', name: 'floorplan', component: () => import('@/views/FloorplanView.vue'), meta: { title: '户型图' } },
  { path: '/devices', name: 'devices', component: () => import('@/views/DevicesView.vue'), meta: { title: '设备' } },
  { path: '/scenes', name: 'scenes', component: () => import('@/views/ScenesView.vue'), meta: { title: '场景' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

// 登录守卫：未登录一律重定向到登录页。
router.beforeEach(async (to) => {
  if (to.meta.public) return true
  if (!auth.checked) await loadMe()
  if (!auth.user) return { path: '/login', query: { redirect: to.fullPath } }
  return true
})

router.afterEach((to) => {
  loadSiteName() // 每次切页兜底拉取（内部静默失败，保持缓存值）
  document.title = to.meta.title ? `${to.meta.title} · ${siteName.value}` : siteName.value
})

// 首次导航完成后，在浏览器空闲时预取其余路由的懒加载 chunk（Vite 会缓存模块解析结果，
// 重复调用同一 loader 不会再次下载）。切页时组件代码已在内存，消除点击后
// 「等 chunk 下载 → 白屏/卡顿」的空窗期。
let prefetched = false
router.afterEach(() => {
  if (prefetched) return
  prefetched = true
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500))
  idle(() => {
    for (const r of routes) {
      if (typeof r.component === 'function') {
        try { r.component() } catch { /* 预取失败不影响正常导航 */ }
      }
    }
  })
})

export default router
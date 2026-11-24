import { createRouter, createWebHistory } from 'vue-router'
import { auth, loadMe, loadSiteName, loadSiteIcon, setRouteTitle } from '@/store'
import { isApk, activeAddress } from '@/utils/serverConfig'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '登录', public: true } },
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: '首页' } },
  { path: '/map', name: 'map', component: () => import('@/views/MapView.vue'), meta: { title: '地图' } },
  { path: '/overview', name: 'overview', component: () => import('@/views/OverviewView.vue'), meta: { title: '能耗总览' } },
  { path: '/floorplan', name: 'floorplan', component: () => import('@/views/FloorplanView.vue'), meta: { title: '户型图' } },
  { path: '/devices', name: 'devices', component: () => import('@/views/DevicesView.vue'), meta: { title: '设备' } },
  { path: '/inventory', name: 'inventory', component: () => import('@/views/InventoryView.vue'), meta: { title: '生活' } },
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
  // APK 壳页（localhost）自动跳转：已配置服务器地址时整页跳转到目标服务器。
  // #connfail 标记表示看门狗检测到服务器不可达已退回壳页，此时先延迟探测重试，
  // 避免壳页↔故障服务器整页重载循环（画面闪烁）；3 次探测仍失败才留在地址列表。
  if (isApk && location.hostname === 'localhost' && location.hash.includes('connfail')) {
    // 异步探测：壳页先渲染（展示地址列表），探测成功后自动跳转
    Promise.resolve().then(async () => {
      const addr = activeAddress()
      if (!addr) return // 无配置地址，让用户手动添加
      // 连续 3 次探测（每次 4 秒间隔），成功即跳
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 4000))
        const ok = await (await import('@/utils/serverConfig')).probe(addr.url, 4000)
        if (ok) {
          window.location.replace(addr.url + '/')
          return
        }
      }
      // 3 次都失败：剥掉 #connfail，让用户手动选择
      history.replaceState(null, '', location.pathname)
    })
    // 守卫继续，让壳页展示地址列表（探测在后台进行）
    return true
  }
  if (isApk && location.hostname === 'localhost') {
    const addr = activeAddress()
    if (addr && addr.url) {
      location.replace(addr.url + '/')
      return false // 中止导航，页面将整页重载到目标服务器
    }
  }
  if (to.meta.public) return true
  if (!auth.checked) await loadMe()
  if (!auth.user) return { path: '/login', query: { redirect: to.fullPath } }
  return true
})

router.afterEach((to) => {
  loadSiteName(); loadSiteIcon() // 每次切页兜底拉取（内部静默失败，保持缓存值）
  setRouteTitle(to.meta.title) // 记录页名并刷新标签标题；系统名称热更新由 store 内部统一处理
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

// 发版后旧 chunk 失效（点击导航无反应/白屏）时自动整页刷新一次，拿到新 index.html。
router.onError((err, to) => {
  const msg = String((err && err.message) || '')
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported module/i.test(msg)) {
    console.error(err)
    return
  }
  try {
    const key = 'hc_chunk_reload_' + ((to && to.fullPath) || '')
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { /* 隐私模式下忽略 */ }
  window.location.reload()
})

export default router
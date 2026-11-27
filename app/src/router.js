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
  { path: '/inventory', name: 'inventory', component: () => import('@/views/inventory/InventoryHomeView.vue'), meta: { title: '生活' } },
  { path: '/inventory/stock', name: 'inventory-stock', component: () => import('@/views/inventory/StockView.vue'), meta: { title: '库存' } },
  { path: '/inventory/shopping', name: 'inventory-shopping', component: () => import('@/views/inventory/ShoppingView.vue'), meta: { title: '购物清单' } },
  {
    path: '/inventory/finance',
    component: () => import('@/views/finance/FinanceView.vue'),
    // finance: 需管理员授权的记账查看权限；financeOperate: 记一笔需要操作权限
    meta: { title: '账本', hideGlobalTab: true, finance: true },
    children: [
      { path: '', redirect: '/inventory/finance/ledger' },
      { path: 'ledger', name: 'finance-ledger', component: () => import('@/views/finance/FinanceLedgerView.vue'), meta: { title: '账本' } },
      { path: 'charts', name: 'finance-charts', component: () => import('@/views/finance/FinanceChartsView.vue'), meta: { title: '图表' } },
      { path: 'add', name: 'finance-add', component: () => import('@/views/finance/FinanceAddView.vue'), meta: { title: '记一笔', financeOperate: true } },
      { path: 'plan', name: 'finance-plan', component: () => import('@/views/finance/FinancePlanView.vue'), meta: { title: '计划' } },
      { path: 'me', name: 'finance-me', component: () => import('@/views/finance/FinanceMeView.vue'), meta: { title: '我的' } },
      { path: 'reports', name: 'finance-reports', component: () => import('@/views/finance/FinanceReportsView.vue'), meta: { title: '已保存报表' } },
    ],
  },
  { path: '/scenes', name: 'scenes', component: () => import('@/views/ScenesView.vue'), meta: { title: '场景' } },
  { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: '设置' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    // 账本内部 tab 切换保持各自滚动位置（仅 keep-alive 的明细/图表），由页面 onActivated 恢复。
    const keepScroll = new Set(['finance-ledger', 'finance-charts'])
    if (keepScroll.has(to.name) && keepScroll.has(from.name)) {
      return false
    }
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
  // 记账模块：无查看权限不可进入；记一笔等写操作入口需要操作权限。
  if (to.meta.finance) {
    if (!auth.financeView) return { path: '/inventory' }
    if (to.meta.financeOperate && !auth.financeOperate) return { path: '/inventory/finance/ledger' }
  }
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
    const walk = (list) => {
      for (const r of list) {
        if (typeof r.component === 'function') {
          try { r.component() } catch { /* 预取失败不影响正常导航 */ }
        }
        if (r.children) walk(r.children)
      }
    }
    walk(routes)
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
import { createRouter, createWebHistory } from 'vue-router'
import { auth, loadMe } from '@/store'

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
  document.title = to.meta.title ? `${to.meta.title} · 归栖` : '归栖'
})

export default router
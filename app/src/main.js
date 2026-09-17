import { createApp } from 'vue'
import 'material-symbols/outlined.css'
import './assets/main.css'
import App from './App.vue'
import router from './router'
import { initIconWatcher } from './utils/hcIcons'
import { loadThemeFromCache } from './themes'

// 挂载前同步应用本地缓存主题（登录页/首屏即生效，后端权威值由 App.vue 登录后异步覆盖）
loadThemeFromCache()

createApp(App).use(router).mount('#app')

// 图标兜底：把 material-symbols-outlined 统一替换为后端 SVG，避免字体未加载时显示英文。
initIconWatcher()
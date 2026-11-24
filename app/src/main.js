import { createApp } from 'vue'
import 'material-symbols/outlined.css'
import './assets/main.css'
import App from './App.vue'
import router from './router'
import { initIconWatcher } from './utils/hcIcons'
import { loadAppearanceFromCache } from './themes'
import { mark } from './utils/perf'

// 性能基准起点：后续首屏各段耗时都相对它（≈页面导航开始）计算
mark('boot:js')

// APK 内（WebView 注入了原生桥）启用移动端字号阶梯，桌面端/移动浏览器不受影响；
// 须在挂载前加类，首屏即按 17px 基准渲染（样式见 main.css「APK 原生端字号阶梯」）
if (window.StickyKeeNative) document.documentElement.classList.add('native-app')

// 挂载前同步应用本地缓存外观（主题 + 字号 + 图标风格；登录页/首屏即生效，
// 后端权威值由 App.vue 登录后异步覆盖）
loadAppearanceFromCache()

createApp(App).use(router).mount('#app')
mark('boot:mounted')

// 图标兜底：把 material-symbols-outlined 统一替换为后端 SVG，避免字体未加载时显示英文。
initIconWatcher()
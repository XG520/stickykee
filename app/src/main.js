import { createApp } from 'vue'
import 'material-symbols/outlined.css'
import './assets/main.css'
import App from './App.vue'
import router from './router'
import { plugin as formkit } from '@formkit/vue'
import '@formkit/inputs'
import { inputs as designerFormKitInputs } from './components/cards/designer/formkit'
import { initIconWatcher } from './utils/hcIcons'
import { loadThemeFromCache } from './themes'
import { mark } from './utils/perf'

// 性能基准起点：后续首屏各段耗时都相对它（≈页面导航开始）计算
mark('boot:js')

// 挂载前同步应用本地缓存主题（登录页/首屏即生效，后端权威值由 App.vue 登录后异步覆盖）
loadThemeFromCache()

createApp(App).use(router).use(formkit, { inputs: designerFormKitInputs }).mount('#app')
mark('boot:mounted')

// 图标兜底：把 material-symbols-outlined 统一替换为后端 SVG，避免字体未加载时显示英文。
initIconWatcher()
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

// 构建时把 package.json 的版本注入 __APP_VERSION__，设置页展示前端版本。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  plugins: [
    vue(),
    // 老车机兼容（Android 6.0/API 23，出厂 WebView ≈ Chrome 44-53）：
    // 生成 nomodule 回退包（SystemJS + core-js polyfill），不支持 ES Module 的
    // 老 WebView 自动落到 legacy 包；新内核仍走 modern 包，无性能损失。
    legacy({
      targets: ['Android >= 6', 'Chrome >= 50'],
      polyfills: true,
      modernPolyfills: true,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.SN_BACKEND || 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // 绝对根路径：后端在根路径托管 dist（Docker 同源）；'./' 相对基址在
  // history 深层路由（如 /instances/1）刷新时会把资源错误解析到子路径导致白屏。
  base: '/',
})
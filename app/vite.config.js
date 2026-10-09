import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
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
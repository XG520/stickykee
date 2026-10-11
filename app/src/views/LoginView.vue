<template>
  <div class="min-h-screen flex items-center justify-center px-4 text-on-background relative overflow-hidden">
    <!-- 装饰光晕 -->
    <div class="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3"></div>
    <div class="absolute bottom-0 left-0 w-80 h-80 bg-accent/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3"></div>

    <div class="relative w-full max-w-sm">
      <!-- 品牌 -->
      <div class="flex flex-col items-center mb-8">
        <div class="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30 mb-4">
          <span class="material-symbols-outlined text-on-primary text-3xl">home</span>
        </div>
        <h1 class="font-headline text-2xl font-bold">{{ siteName }}</h1>
        <p class="text-muted text-sm mt-1 font-body">{{ registerMode ? '创建管理员账号' : '智能家庭控制中心' }}</p>
      </div>

      <!-- 卡片 -->
      <div class="bg-surface-alt border border-border rounded-2xl p-6">
        <form @submit.prevent="submit" class="space-y-4">
          <div>
            <label class="block text-on-surface text-sm font-medium mb-1.5">用户名</label>
            <input v-model="form.username" type="text" autocomplete="username" placeholder="输入用户名"
              class="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
          </div>

          <div>
            <label class="block text-on-surface text-sm font-medium mb-1.5">密码</label>
            <input v-model="form.password" type="password" autocomplete="current-password" placeholder="输入密码"
              class="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
          </div>

          <div v-if="registerMode">
            <label class="block text-on-surface text-sm font-medium mb-1.5">确认密码</label>
            <input v-model="form.confirm" type="password" autocomplete="new-password" placeholder="再次输入密码"
              class="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
          </div>

          <!-- 保持登录：仅登录模式显示；勾选后令牌持久化，关闭 APP/浏览器后仍保持登录 -->
          <label v-if="!registerMode" class="flex items-center gap-2 cursor-pointer select-none">
            <input v-model="remember" type="checkbox"
              class="w-4 h-4 accent-primary rounded cursor-pointer">
            <span class="text-on-surface text-sm">保持登录</span>
            <span class="text-muted text-xs">（在此设备上记住登录状态）</span>
          </label>

          <p v-if="msg" class="text-xs font-body" :class="msgErr ? 'text-error' : 'text-success'">{{ msg }}</p>

          <button type="submit" class="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-primary/20">
            <span class="material-symbols-outlined text-lg">{{ registerMode ? 'person_add' : 'login' }}</span>
            {{ registerMode ? '创建账号' : '登 录' }}
          </button>
        </form>
      </div>

      <!-- APK 环境：退出登录后修改服务器地址的入口（打开应用内地址簿抽屉，Web 不显示） -->
      <button v-if="isApk" type="button" @click="openServerSheet"
        class="w-full mt-4 py-2.5 rounded-xl bg-surface-alt border border-border text-on-surface/80 text-sm font-medium hover:border-primary transition-colors flex items-center justify-center gap-1.5">
        <span class="material-symbols-outlined text-lg">dns</span>
        修改服务器地址
      </button>

      <p class="text-center text-muted text-xs mt-6 font-body">登录后即可配置与管理你的 Home Assistant</p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '@/api'
import { authLogin, authRegister, siteName, loadSiteName } from '@/store'
import { isApk, openServerSheet } from '@/utils/serverConfig'

const router = useRouter()
const route = useRoute()

const registerMode = ref(false)
const form = reactive({ username: '', password: '', confirm: '' })
const remember = ref(true) // 默认勾选：移动端 APP 场景下免重复登录
const msg = ref('')
const msgErr = ref(false)

onMounted(async () => {
  loadSiteName() // 异步拉取系统名（公开接口，不阻塞登录）
  try {
    const { data } = await api.authStatus()
    registerMode.value = !data?.has_users
  } catch {
    flash('无法连接后端服务', true)
  }
})

function flash(text, err = false) {
  msg.value = text
  msgErr.value = err
}

async function submit() {
  msg.value = ''
  const u = form.username.trim()
  if (!u || !form.password) { flash('请输入用户名和密码', true); return }
  if (registerMode.value) {
    if (form.password.length < 6) { flash('密码至少 6 位', true); return }
    if (form.password !== form.confirm) { flash('两次输入的密码不一致', true); return }
  }
  try {
    if (registerMode.value) {
      await authRegister(u, form.password)
    } else {
      await authLogin(u, form.password, remember.value)
    }
    const target = route.query.redirect || '/'
    router.replace(target)
  } catch (e) {
    flash(e.message || '登录失败', true)
  }
}
</script>
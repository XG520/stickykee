<template>
  <!-- 仅 APK 渲染：Web 端（无原生桥）整个组件不存在 -->
  <template v-if="isApk">
    <transition name="sm-sheet">
      <div v-if="sheetOpen" class="fixed inset-0 z-[95] flex items-end sm:items-center justify-center">
        <!-- 遮罩：点击关闭 -->
        <div class="absolute inset-0 bg-black/60" @click="closeServerSheet"></div>

        <div class="relative w-full sm:max-w-md max-h-[88vh] overflow-y-auto bg-surface-alt border border-border rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl">
          <!-- 头部 -->
          <div class="flex items-center justify-between mb-1">
            <h2 class="font-headline text-on-background text-lg font-semibold">{{ view === 'list' ? '服务器地址' : (editId ? '编辑地址' : '添加服务器') }}</h2>
            <button @click="closeServerSheet" class="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <p class="text-muted text-xs mb-4">{{ view === 'list' ? networkHint : '冒号、斜杠请用半角；地址含端口，如 192.168.1.100:18480' }}</p>

          <!-- ============ 列表视图 ============ -->
          <template v-if="view === 'list'">
            <p v-if="listErr" class="mb-3 rounded-xl bg-error/10 border border-error/30 px-3 py-2 text-error text-xs break-all">{{ listErr }}</p>

            <div class="space-y-2">
              <div v-for="a in cfg.addresses" :key="a.id"
                class="rounded-xl bg-background border px-3 py-3 cursor-pointer transition-colors"
                :class="a.id === cfg.activeId ? 'border-primary/60' : 'border-border hover:border-primary/30'"
                @click="connectTo(a)">
                <div class="flex items-center gap-3">
                  <!-- 在线状态点：探测中转圈 / 在线绿 / 离线红 -->
                  <span v-if="statuses[a.id] === 'checking'" class="w-2.5 h-2.5 rounded-full border-2 border-muted/30 border-t-primary animate-spin shrink-0"></span>
                  <span v-else class="w-2.5 h-2.5 rounded-full shrink-0" :class="statuses[a.id] === 'on' ? 'bg-success' : 'bg-faint'"></span>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <p class="text-on-surface text-sm font-medium truncate">{{ a.name }}</p>
                      <span v-if="a.id === cfg.activeId" class="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] shrink-0">使用中</span>
                    </div>
                    <p class="text-muted text-xs truncate mt-0.5">{{ a.url }}</p>
                  </div>

                  <span class="px-1.5 py-0.5 rounded text-[10px] shrink-0" :class="a.type === 'lan' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'">
                    {{ a.type === 'lan' ? '内网' : '外网' }}
                  </span>
                  <span v-if="versions[a.id]" class="px-1.5 py-0.5 rounded bg-surface-hover text-muted text-[10px] shrink-0">v{{ versions[a.id] }}</span>

                  <!-- 编辑 / 删除（阻断冒泡，不触发连接） -->
                  <button @click.stop="startEdit(a)" class="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-on-surface transition-colors shrink-0" title="编辑">
                    <span class="material-symbols-outlined text-base">edit</span>
                  </button>
                  <button @click.stop="removeAddr(a)" class="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors shrink-0" title="删除">
                    <span class="material-symbols-outlined text-base">delete</span>
                  </button>
                </div>
                <!-- 连接中提示 -->
                <p v-if="connecting === a.id" class="mt-2 text-xs text-primary flex items-center gap-1.5">
                  <span class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span>
                  正在探测并切换…
                </p>
              </div>

              <div v-if="!cfg.addresses.length" class="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <span class="material-symbols-outlined text-muted text-3xl">dns</span>
                <p class="text-muted text-xs mt-2">还没有保存的服务器地址</p>
              </div>
            </div>

            <button @click="startAdd"
              class="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors">
              <span class="material-symbols-outlined text-base">add</span> 添加服务器
            </button>
            <p class="text-muted text-xs mt-3 leading-relaxed">点击地址卡片切换服务器；内网、外网可同时保存，按当前网络自动选用。</p>
          </template>

          <!-- ============ 表单视图 ============ -->
          <template v-else>
            <div class="space-y-3">
              <div>
                <label class="block text-on-surface text-xs font-medium mb-1.5">名称</label>
                <input v-model="form.name" type="text" autocomplete="off" placeholder="例如 家里内网 / 外网域名"
                  class="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
              </div>

              <div>
                <label class="block text-on-surface text-xs font-medium mb-1.5">服务器地址</label>
                <div class="flex gap-2">
                  <div class="flex rounded-xl border border-border overflow-hidden shrink-0">
                    <button type="button" v-for="s in ['http', 'https']" :key="s" @click="scheme = s"
                      class="px-3 py-2.5 text-xs font-semibold transition-colors"
                      :class="scheme === s ? 'bg-primary/20 text-primary' : 'bg-background text-muted'">{{ s }}://</button>
                  </div>
                  <input v-model="form.host" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="192.168.1.100:18480"
                    class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
                </div>
              </div>

              <div>
                <label class="block text-on-surface text-xs font-medium mb-1.5">网络类型</label>
                <div class="flex rounded-xl border border-border overflow-hidden">
                  <button type="button" @click="form.type = 'lan'"
                    class="flex-1 py-2.5 text-xs font-semibold transition-colors"
                    :class="form.type === 'lan' ? 'bg-success/15 text-success' : 'bg-background text-muted'">内网（WiFi）</button>
                  <button type="button" @click="form.type = 'wan'"
                    class="flex-1 py-2.5 text-xs font-semibold transition-colors"
                    :class="form.type === 'wan' ? 'bg-primary/15 text-primary' : 'bg-background text-muted'">外网（移动数据）</button>
                </div>
              </div>
            </div>

            <p v-if="formErr" class="mt-3 text-error text-xs break-all">{{ formErr }}</p>
            <p v-else-if="formMsg" class="mt-3 text-success text-xs break-all">{{ formMsg }}</p>

            <div class="mt-4 space-y-2">
              <button @click="saveAndConnect" :disabled="busy"
                class="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors disabled:opacity-50">
                {{ editId ? '保存并连接' : '保存并连接' }}
              </button>
              <div class="flex gap-2">
                <button @click="saveOnly" :disabled="busy"
                  class="flex-1 py-2.5 rounded-xl bg-surface border border-border text-on-surface text-sm font-medium hover:border-primary/40 transition-colors disabled:opacity-50">仅保存</button>
                <button @click="autoDetect" :disabled="busy"
                  class="flex-1 py-2.5 rounded-xl bg-surface border border-border text-on-surface text-sm font-medium hover:border-primary/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <span v-if="detecting" class="inline-block w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></span>
                  自动识别
                </button>
              </div>
              <button @click="view = 'list'" :disabled="busy"
                class="w-full py-2.5 rounded-xl text-muted text-sm hover:text-on-surface transition-colors">返回列表</button>
            </div>
          </template>
        </div>
      </div>
    </transition>
  </template>
</template>

<script setup>
// 应用内服务器地址簿：数据经原生桥与壳页共用一份（SharedPreferences）。
// 列表点卡片 = 探测成功后整页跳转目标服务器；表单支持协议选择、内/外网标记与内网自动识别。
import { ref, reactive, watch } from 'vue'
import {
  isApk, sheetOpen, closeServerSheet,
  loadConfig, saveConfig, genId, probe, fetchVersion, getNetworkType, switchTo,
} from '@/utils/serverConfig'

const cfg = ref({ addresses: [], activeId: null, lastConnectedId: null })
const view = ref('list')          // list | form
const editId = ref('')            // 非空 = 编辑模式
const form = reactive({ name: '', host: '', type: 'lan' })
const scheme = ref('http')
const statuses = reactive({})     // id → 'checking' | 'on' | 'off'
const versions = reactive({})     // id → 'x.y.z'（后端支持 CORS 时才有）
const connecting = ref('')        // 正在切换的地址 id
const listErr = ref('')
const formErr = ref('')
const formMsg = ref('')
const busy = ref(false)
const detecting = ref(false)

const networkHint = ref('按当前网络自动选用内网/外网地址')

watch(sheetOpen, open => {
  if (!open) return
  cfg.value = loadConfig()
  view.value = 'list'
  listErr.value = ''
  connecting.value = ''
  const nt = getNetworkType()
  networkHint.value = nt === 'lan' ? '当前使用 WiFi，优先连接内网地址'
    : nt === 'wan' ? '当前使用移动数据，优先连接外网地址'
    : '按当前网络自动选用内网/外网地址'
  probeAll()
})

// 并发探测所有地址的在线状态（限流 3，避免同网段大量地址时卡顿）
async function probeAll() {
  cfg.value.addresses.forEach(a => { statuses[a.id] = 'checking' })
  const list = cfg.value.addresses
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const a = list[i++]
      const ok = await probe(a.url)
      statuses[a.id] = ok ? 'on' : 'off'
      if (ok && !versions[a.id]) fetchVersion(a.url).then(v => { if (v) versions[a.id] = v })
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker))
}

// ---- 列表操作 ----
async function connectTo(a) {
  if (connecting.value) return
  connecting.value = a.id
  listErr.value = ''
  const ok = await switchTo(a)
  if (!ok) {
    connecting.value = ''
    listErr.value = `无法连接到「${a.name}」（${a.url}），请检查服务器与当前网络`
  }
  // 成功则整页跳转，本组件随页面销毁
}

function removeAddr(a) {
  if (!confirm(`删除「${a.name}」？`)) return
  const c = cfg.value
  c.addresses = c.addresses.filter(x => x.id !== a.id)
  if (c.activeId === a.id) c.activeId = c.addresses[0] ? c.addresses[0].id : null
  if (c.lastConnectedId === a.id) c.lastConnectedId = null
  saveConfig(c)
}

// ---- 表单操作 ----
function startAdd() {
  editId.value = ''
  form.name = ''
  form.host = ''
  form.type = getNetworkType() === 'wan' ? 'wan' : 'lan'
  scheme.value = 'http'
  formErr.value = ''
  formMsg.value = ''
  view.value = 'form'
}

function startEdit(a) {
  editId.value = a.id
  form.name = a.name
  form.host = a.url.replace(/^https?:\/\//i, '')
  form.type = a.type
  scheme.value = /^https:\/\//i.test(a.url) ? 'https' : 'http'
  formErr.value = ''
  formMsg.value = ''
  view.value = 'form'
}

// 输入归一化：全角标点转半角、去空白（与壳页一致，兼容中文输入法）
function cleanInput(s) {
  return String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
}

function buildURL() {
  const s = cleanInput(form.host).replace(/\/+$/, '')
  const m = s.match(/^(https?):\/\/(.+)$/i)
  if (m) return { url: m[1].toLowerCase() + '://' + m[2].replace(/^\/+/, ''), scheme: m[1].toLowerCase() }
  return { url: scheme.value + '://' + s.replace(/^\/+/, ''), scheme: scheme.value }
}

function validHTTPURL(u) {
  try {
    const x = new URL(u)
    return (x.protocol === 'http:' || x.protocol === 'https:') && x.host ? x : null
  } catch { return null }
}

// 收集表单写入地址簿（connect=true 时探测成功后跳转）
function collect(connect) {
  formErr.value = ''
  formMsg.value = ''
  const name = form.name.trim()
  const built = buildURL()
  if (!name) { formErr.value = '请填写名称'; return null }
  if (!validHTTPURL(built.url)) { formErr.value = '地址格式不正确（冒号、斜杠用半角，需含地址与端口）'; return null }
  const c = cfg.value
  let addr
  const idx = c.addresses.findIndex(a => a.id === editId.value)
  if (idx >= 0) {
    addr = { id: editId.value, name, url: built.url, type: form.type }
    c.addresses[idx] = addr
  } else {
    addr = { id: genId(), name, url: built.url, type: form.type }
    c.addresses.push(addr)
  }
  if (connect) {
    c.activeId = addr.id
    c.lastConnectedId = addr.id
  }
  saveConfig(c)
  return addr
}

async function saveAndConnect() {
  if (busy.value) return
  busy.value = true
  try {
    const addr = collect(true)
    if (!addr) return
    formMsg.value = '正在探测服务器…'
    const ok = await probe(addr.url)
    if (!ok) {
      formErr.value = `无法连接到 ${addr.url}，请检查地址、端口与当前网络`
      return
    }
    formMsg.value = '连接成功，正在进入…'
    // switchTo 内部会重写 activeId 并整页跳转
    const jumped = await switchTo(addr)
    if (!jumped) formErr.value = '连接中断，请重试'
  } finally {
    busy.value = false
  }
}

function saveOnly() {
  if (busy.value) return
  const addr = collect(false)
  if (!addr) return
  view.value = 'list'
  probeAll()
}

// 自动识别内网服务器：抽样探测常见网段与端口（与壳页同策略）
async function autoDetect() {
  if (detecting.value) return
  detecting.value = true
  formErr.value = ''
  formMsg.value = '正在识别内网服务器…'
  try {
    const prefixes = ['192.168.1', '192.168.0', '10.0.0', '172.16.0']
    const ports = [18480, 8080, 8123, 80]
    const candidates = []
    prefixes.forEach(p => {
      for (let i = 1; i <= 254; i += 25) ports.forEach(port => candidates.push(`http://${p}.${i}:${port}`))
    })
    let found = null
    for (let i = 0; i < candidates.length && !found; i += 5) {
      const batch = candidates.slice(i, i + 5)
      const rs = await Promise.all(batch.map(u => probe(u, 2000).then(ok => (ok ? u : null))))
      found = rs.find(Boolean) || null
    }
    if (found) {
      form.host = found.replace(/^https?:\/\//i, '')
      scheme.value = 'http'
      formMsg.value = `发现服务器：${found}，请填写名称后保存`
    } else {
      formErr.value = '未识别到内网服务器，请手动填写地址'
    }
  } finally {
    detecting.value = false
  }
}
</script>

<style scoped>
.sm-sheet-enter-active,
.sm-sheet-leave-active {
  transition: opacity 0.2s ease;
}
.sm-sheet-enter-active > div:last-child,
.sm-sheet-leave-active > div:last-child {
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.sm-sheet-enter-from,
.sm-sheet-leave-to {
  opacity: 0;
}
.sm-sheet-enter-from > div:last-child,
.sm-sheet-leave-to > div:last-child {
  transform: translateY(24px);
}
</style>

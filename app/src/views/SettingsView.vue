<template>
  <div class="space-y-6 pb-4">
    <h1 class="font-headline text-2xl font-bold text-on-background hidden lg:block">个性化设置</h1>

    <!-- 分组导航：设置项分组收纳，页面更短；保存栏始终悬浮底部 -->
    <nav class="flex flex-wrap gap-1.5 p-1.5 w-fit rounded-2xl bg-surface-alt/90 backdrop-blur-xl border border-border shadow-sm">
      <button v-for="t in tabs" :key="t.key" @click="activeTab = t.key"
        class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 active:scale-95"
        :class="activeTab === t.key
          ? 'bg-primary text-on-primary shadow-md shadow-primary/25'
          : 'text-muted hover:text-on-surface hover:bg-surface'">
        <span class="material-symbols-outlined text-base leading-none">{{ t.icon }}</span>
        {{ t.label }}
      </button>
    </nav>

    <!-- ===== 连接与设备 ===== -->
    <div v-show="activeTab === 'connect'" class="space-y-6">
    <!-- Home Assistant 连接管理 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-primary text-lg">hub</span>
          </div>
          <div>
            <h2 class="font-headline text-on-background text-base font-semibold">Home Assistant 连接</h2>
            <p class="text-muted text-xs mt-0.5">配置后端连接的 Home Assistant 实例</p>
          </div>
        </div>
        <span v-if="!backendOnline" class="px-2.5 py-1 rounded-full bg-error/15 text-error text-xs font-medium">后端离线</span>
        <span v-else-if="store.activeID" class="px-2.5 py-1 rounded-full bg-success/15 text-success text-xs font-medium">已连接</span>
      </div>

      <div class="space-y-2 mb-4">
        <div
          v-for="ins in store.instances"
          :key="ins.id"
          class="rounded-xl bg-surface border transition-colors overflow-hidden"
          :class="ins.id === store.activeID ? 'border-primary/50' : 'border-border'"
        >
          <div class="flex items-center gap-3 p-3 pb-2">
            <span class="w-2 h-2 rounded-full" :class="ins.id === store.activeID ? 'bg-primary' : 'bg-faint'"></span>
            <div class="flex-1 min-w-0">
              <p class="text-on-surface text-sm font-medium">{{ ins.name }}</p>
              <p class="text-muted text-xs truncate">{{ ins.url }}</p>
            </div>
            <button
              v-if="ins.id !== store.activeID"
              @click="activate(ins.id)"
              class="px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface transition-colors"
            >切换</button>
            <button @click="removeInstance(ins.id)" class="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors">
              <span class="material-symbols-outlined text-lg">delete</span>
            </button>
          </div>
          <!-- 每实例忽略证书验证开关 -->
          <label class="flex items-center justify-between px-3 py-2 border-t border-border cursor-pointer hover:bg-surface-hover transition-colors">
            <span class="flex items-center gap-2.5">
              <input
                type="checkbox"
                class="w-4 h-4 accent-primary"
                :checked="!!ins.skip_tls"
                @change="setSkipTLS(ins, $event.target.checked)"
              >
              <span class="text-on-surface text-sm">忽略证书验证</span>
              <span class="text-muted text-xs">（本地自签名 HTTPS 请开启）</span>
            </span>
            <span class="material-symbols-outlined text-muted text-lg">verified</span>
          </label>
        </div>
        <p v-if="!store.instances.length" class="text-muted text-sm text-center py-3 font-body">尚未配置任何实例，请添加你的 Home Assistant</p>
      </div>

      <form @submit.prevent="addInstance" class="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3">
        <input v-model="form.name" placeholder="实例名称（如 家）"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="form.url" placeholder="HA 地址（如 http://192.168.1.10:8123）"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="form.token" placeholder="Long-Lived Token（可选）" type="password"
          class="col-span-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <label class="col-span-full flex items-center gap-2.5 cursor-pointer select-none">
          <input v-model="form.skipTLS" type="checkbox" class="w-4 h-4 accent-primary">
          <span class="text-on-surface text-sm">忽略证书验证</span>
          <span class="text-muted text-xs">（本地自签名 HTTPS 请开启）</span>
        </label>
        <button type="submit" class="sm:col-span-2 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-lg">add</span> 添加实例
        </button>
      </form>
      <p v-if="msg" class="mt-3 text-xs font-body" :class="msgErr ? 'text-error' : 'text-success'">{{ msg }}</p>
    </section>

    <!-- 高德地图 & 位置同步 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-accent text-lg">map</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">高德地图 & 位置同步</h2>
          <p class="text-muted text-xs mt-0.5">在首页地图卡展示家人位置，并可将当前设备定位同步回 Home Assistant</p>
        </div>
      </div>

      <div class="space-y-3">
        <div>
          <label class="text-on-surface text-sm font-medium mb-2 block">高德 Web 端 Key</label>
          <input v-model="map.amap_key" placeholder="填写高德开放平台申请到的 Key"
            class="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
          <p class="text-muted text-xs mt-1.5 font-body leading-relaxed">
            前往 <a href="https://console.amap.com/" target="_blank" rel="noopener" class="text-primary hover:underline">高德开放平台</a> → 应用管理，新建「Web端(JS API)」应用并开启定位权限，把 Key 粘贴到上方。<br>
            未配置 Key 时，首页地图卡会提示前往设置配置。
          </p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="text-on-surface text-sm font-medium mb-2 block">位置同步设备标识（dev_id）</label>
            <input v-model="map.dev_id" placeholder="默认 homecanvas"
              class="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
            <p class="text-muted text-xs mt-1.5 font-body">刷新定位后写入 Home Assistant 的 device_tracker 实体标识（如 device_tracker.homecanvas）。</p>
          </div>
          <div>
            <label class="text-on-surface text-sm font-medium mb-2 block">默认位置名（location_name）</label>
            <input v-model="map.location_name" placeholder="默认 home"
              class="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
            <p class="text-muted text-xs mt-1.5 font-body">定位同步时可附带的位置语义名，缺省使用逆地理地址。</p>
          </div>
        </div>
        <div>
          <label class="text-on-surface text-sm font-medium mb-2 block">位置同步到（自动定位 / 刷新位置写入的 Home Assistant 实体）</label>
          <select v-model="sync_target" class="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none transition-colors">
            <option value="">自动（写入 device_tracker.homecanvas，不关联人物）</option>
            <optgroup v-if="peopleOptions.length" label="人物 person">
              <option v-for="o in peopleOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </optgroup>
            <optgroup v-if="trackerOptions.length" label="设备跟踪 device_tracker">
              <option v-for="o in trackerOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </optgroup>
          </select>
          <p class="text-muted text-xs mt-1.5 font-body leading-relaxed">
            选择某位家人（person）后，定位会同步到该 person 关联的设备跟踪器（device_tracker），首页「家人状态」卡片会随之变为 在家/离家/所在位置。若 HA 中没有需要关联的 person，请选择「自动」。<br>
            <span class="text-warning">提示：浏览器定位需在 HTTPS 下生效；部分浏览器首次需授权位置权限。</span>
          </p>
        </div>
      </div>
    </section>

    <!-- 设备列表（自动识别、去重、别名） -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-primary text-lg">devices</span>
          </div>
          <div>
            <h2 class="font-headline text-on-background text-base font-semibold">设备列表</h2>
            <p class="text-muted text-xs mt-0.5">运行本应用的设备自动识别、按唯一标识去重，可设置别名</p>
          </div>
        </div>
      </div>
      <div v-if="deviceList.length" class="space-y-2">
        <div v-for="d in deviceList" :key="d.device_id"
          class="flex flex-wrap items-center gap-3 rounded-xl bg-background border border-border px-3 py-2.5">
          <span class="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center">
            <span class="material-symbols-outlined text-base">devices_other</span>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-on-surface text-sm font-medium truncate">{{ d.name }}</span>
              <span v-if="d.device_id === currentDevId" class="text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success font-semibold">当前设备</span>
            </div>
            <span class="text-muted text-xs font-mono">device_tracker.{{ d.dev_id }}</span>
          </div>
          <!-- 别名编辑 -->
          <div class="flex items-center gap-1.5">
            <input v-model="d._draft" @keyup.enter="saveAlias(d)"
              class="w-36 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none transition-colors"
              placeholder="设置别名">
            <button @click="saveAlias(d)" class="px-2 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">
              保存别名
            </button>
          </div>
          <button @click="removeDevice(d)" class="px-2 py-1.5 rounded-lg hover:bg-error/10 text-error text-xs font-semibold transition-colors"
            title="删除此设备记录">
            <span class="material-symbols-outlined text-base">delete</span>
          </button>
        </div>
      </div>
      <p v-else class="text-muted text-sm font-body">暂无已注册设备。在地图上点「更新位置」后会自动注册当前设备。</p>
    </section>

    <!-- 设备传感器（官方 App 同款：按设备类型提供不同传感器，可开关） -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-xl bg-info/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-info text-lg">sensors</span>
          </div>
          <div>
            <h2 class="font-headline text-on-background text-base font-semibold">设备传感器</h2>
            <p class="text-muted text-xs mt-0.5">像官方 App 一样把本设备状态注册到 Home Assistant（需启用 mobile_app 集成）</p>
          </div>
        </div>
        <button @click="reportNow(true)" :disabled="reporting || !store.activeID"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-all duration-200 active:scale-95 disabled:opacity-60">
          <span v-if="reporting" class="hc-spinner"></span>
          <span v-else class="material-symbols-outlined text-sm">sync</span>
          立即上报
        </button>
      </div>

      <div v-if="sensorDefs.length" class="space-y-1">
        <ToggleRow
          v-for="d in sensorDefs"
          :key="d.key"
          :model-value="!!sensorConfig[d.key]"
          :icon="sensorIcon(d.key)"
          :title="d.label"
          :desc="sensorAvail.has(d.key) ? d.desc : (unavailableReason(d.key) || d.desc)"
          :color="sensorAvail.has(d.key) ? 'bg-info/15 text-info' : 'bg-faint/70 text-muted'"
          :disabled="!sensorAvail.has(d.key)"
          @update:model-value="(v) => toggleSensor(d.key, v)"
        />
      </div>
      <p v-else class="text-muted text-sm font-body">传感器定义加载失败，或后端未连接。</p>

      <p v-if="lastReport" class="text-muted text-xs mt-3 font-body">最近上报：{{ lastReport }}</p>
      <p class="text-muted text-xs mt-1 font-body leading-relaxed">
        提示：官方 mobile_app 集成由 HA 的 default_config 默认启用（除非已从配置中移除）。
        本应用会注册为「homecanvas」设备，在 HA 中生成 <span class="font-mono">sensor.homecanvas_*</span> 传感器实体，
        状态变化自动上报（约 60 秒兜底）。
      </p>
    </section>
    </div>

    <!-- ===== 个性化 ===== -->
    <div v-show="activeTab === 'personal'" class="space-y-6">
    <!-- 主题风格 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">palette</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">主题风格</h2>
          <p class="text-muted text-xs mt-0.5">选择整套配色与字体风格，保存后全局生效</p>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <button
          v-for="t in themeOptions"
          :key="t.key"
          @click="themeKey = t.key"
          class="relative flex flex-col gap-2 p-4 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] text-left"
          :class="themeKey === t.key ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border bg-surface'"
        >
          <div class="flex items-center gap-2">
            <span v-for="(c, ci) in (t.key === 'custom' ? customSwatches : t.swatches)" :key="t.key + ci" class="w-5 h-5 rounded-full border border-white/10" :style="{ background: c }"></span>
          </div>
          <span class="text-sm font-semibold" :class="themeKey === t.key ? 'text-primary' : 'text-on-surface'">{{ t.name }}</span>
          <span class="text-xs text-muted">{{ t.desc }}</span>
          <div v-if="themeKey === t.key" class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
            <svg class="w-3 h-3 text-on-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
          </div>
        </button>
      </div>

      <!-- 自定义主题：完整调色板（实时预览，保存后成为专属主题） -->
      <div v-if="themeKey === 'custom'" class="pt-3 border-t border-border">
        <div class="flex items-center justify-between mb-3">
          <div>
            <p class="text-on-surface text-sm font-semibold">自定义调色板</p>
            <p class="text-muted text-xs mt-0.5">自由调配整套配色，实时预览，保存后全局生效</p>
          </div>
          <button @click="resetCustomPalette" class="px-3 py-1.5 rounded-lg bg-surface border border-border text-muted hover:text-on-surface text-sm transition-colors flex items-center gap-1.5">
            <span class="material-symbols-outlined text-base">restart_alt</span>恢复默认
          </button>
        </div>
        <div class="space-y-2.5">
          <div v-for="k in CUSTOM_COLOR_KEYS" :key="k.key" class="flex items-center gap-3">
            <div class="w-32 sm:w-40 flex-shrink-0">
              <p class="text-on-surface text-xs font-medium">{{ k.label }}</p>
              <p class="text-muted text-[10px] leading-tight">{{ k.desc }}</p>
            </div>
            <input type="color" v-model="customColors[k.key]" class="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent flex-shrink-0">
            <input type="text" v-model="customColors[k.key]" class="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-on-surface text-xs font-mono focus:border-primary focus:outline-none transition-colors">
          </div>
        </div>
      </div>

      <!-- 自定义主色（预设主题下可用，覆盖该主题的主色调） -->
      <div v-else class="pt-3 border-t border-border">
        <p class="text-muted text-xs mb-3">自定义主色（在所选主题基础上覆盖主色调，留空则使用主题默认色）</p>
        <div class="grid grid-cols-4 gap-3 mb-4">
          <button
            v-for="c in colors"
            :key="c.hex"
            @click="customColor = c.hex"
            class="relative flex flex-col items-center gap-2 py-3 rounded-xl border-2 transition-all duration-200 hover:scale-105"
            :class="customColor === c.hex ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border bg-surface'"
          >
            <div class="w-10 h-10 rounded-full" :style="{ background: c.hex, boxShadow: `0 4px 12px ${c.hex}66` }"></div>
            <span class="text-xs font-medium" :class="customColor === c.hex ? 'text-on-surface' : 'text-muted'">{{ c.name }}</span>
            <div v-if="customColor === c.hex" class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
              <svg class="w-3 h-3 text-on-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
            </div>
          </button>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-muted text-sm">自定义颜色</span>
          <input type="color" v-model="customColor" class="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent">
          <input type="text" v-model="customColor" class="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-on-surface text-sm font-mono focus:border-primary focus:outline-none transition-colors">
          <button v-if="customColor" @click="customColor = ''" class="px-3 py-1.5 rounded-lg bg-surface border border-border text-muted hover:text-on-surface text-sm transition-colors">恢复默认色</button>
        </div>
      </div>
    </section>

    <!-- 字体大小 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-accent text-lg">text_fields</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">字体大小</h2>
          <p class="text-muted text-xs mt-0.5">调整界面文字的显示大小</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <button
          v-for="f in fontSizes"
          :key="f.key"
          @click="fontSize = f.key"
          class="flex flex-col items-center gap-2 py-4 rounded-xl border-2 bg-surface hover:bg-surface-hover transition-all duration-200"
          :class="fontSize === f.key ? 'border-primary bg-primary/10' : 'border-transparent'"
        >
          <div class="flex flex-col items-center gap-1">
            <span class="text-muted text-xs">A</span>
            <span class="text-sm" :class="fontSize === f.key ? 'text-primary' : 'text-on-surface'">Aa</span>
            <span class="text-muted text-xs">Aa</span>
          </div>
          <span class="text-sm font-medium" :class="fontSize === f.key ? 'text-primary' : 'text-on-surface'">{{ f.name }}</span>
          <span class="text-muted text-xs">{{ f.note }}</span>
        </button>
      </div>
    </section>

    <!-- 图标风格 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-info/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-info text-lg">dashboard</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">图标风格</h2>
          <p class="text-muted text-xs mt-0.5">选择你偏好的图标呈现方式</p>
        </div>
      </div>
      <div class="grid grid-cols-4 gap-3">
        <button
          v-for="s in iconStyles"
          :key="s.key"
          @click="iconStyle = s.key"
          class="flex flex-col items-center gap-2.5 py-4 rounded-xl border-2 bg-surface hover:bg-surface-hover transition-all duration-200"
          :class="iconStyle === s.key ? 'border-primary bg-primary/10' : 'border-transparent'"
        >
          <div class="flex gap-1.5">
            <svg class="w-5 h-5" :class="iconStyle === s.key ? 'text-primary' : 'text-on-surface'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1"/></svg>
            <svg class="w-5 h-5" :class="iconStyle === s.key ? 'text-primary' : 'text-on-surface'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
          </div>
          <span class="text-xs font-medium text-on-surface">{{ s.name }}</span>
          <span class="text-muted text-xs">{{ s.note }}</span>
        </button>
      </div>
    </section>

    <!-- 户型图风格 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-warning/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-warning text-lg">apartment</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">户型图风格</h2>
          <p class="text-muted text-xs mt-0.5">选择户型图的渲染方式</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <button
          v-for="f in floorStyles"
          :key="f.key"
          @click="floorStyle = f.key"
          class="flex flex-col gap-3 py-3 rounded-xl border-2 bg-surface hover:bg-surface-hover transition-all duration-200"
          :class="floorStyle === f.key ? 'border-primary bg-primary/10' : 'border-transparent'"
        >
          <div class="flex flex-col gap-3 py-3 rounded-xl">
            <div class="text-center">
              <span class="text-sm font-medium text-on-surface">{{ f.name }}</span>
              <p class="text-muted text-xs mt-0.5">{{ f.note }}</p>
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- 动画效果 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-error/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-error text-lg">animation</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">动画效果</h2>
          <p class="text-muted text-xs mt-0.5">开启或关闭界面交互动画</p>
        </div>
      </div>
      <div class="space-y-1">
        <ToggleRow v-for="t in toggles" :key="t.id" v-model="t.on" :icon="t.icon" :title="t.title" :desc="t.desc" :color="t.color" />
      </div>
    </section>

    <!-- 语音助手 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-success/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-success text-lg">mic</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">语音助手</h2>
          <p class="text-muted text-xs mt-0.5">配置语音控制设备与唤醒方式</p>
        </div>
      </div>

      <div class="flex items-center gap-3 p-3 rounded-xl bg-surface mb-4">
        <div class="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
          <span class="material-symbols-outlined text-accent text-xl">smart_toy</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-on-surface text-sm font-medium">小爱同学</p>
            <span class="px-2 py-0.5 rounded-full bg-success/20 text-success text-xs font-medium">已连接</span>
          </div>
          <p class="text-muted text-xs mt-0.5 truncate">小米智能音箱 · 信号良好</p>
        </div>
        <button class="p-2 rounded-lg hover:bg-surface-hover transition-colors">
          <span class="material-symbols-outlined text-muted">more_vert</span>
        </button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="text-on-surface text-sm font-medium mb-2 block">唤醒词</label>
          <div class="flex items-center gap-2">
            <div class="flex-1 relative">
              <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted text-lg">record_voice_over</span>
              <input type="text" :value="wakeWord" class="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-2.5 text-on-surface text-sm focus:border-primary focus:outline-none transition-colors">
            </div>
            <button class="p-2.5 rounded-xl bg-surface-hover hover:bg-surface border border-border transition-colors"><span class="material-symbols-outlined text-on-surface text-lg">volume_up</span></button>
            <button class="p-2.5 rounded-xl bg-surface-hover hover:bg-surface border border-border transition-colors"><span class="material-symbols-outlined text-on-surface text-lg">mic</span></button>
          </div>
        </div>
        <div>
          <label class="text-on-surface text-sm font-medium mb-2 block">音量灵敏度</label>
          <div class="flex items-center gap-3">
            <span class="text-muted text-xs">低</span>
            <input type="range" min="1" max="100" value="65" class="flex-1 h-1 rounded-full bg-border cursor-pointer">
            <span class="text-muted text-xs">高</span>
          </div>
        </div>
        <div class="flex items-center justify-between py-2">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-muted text-lg">language</span>
            <span class="text-on-surface text-sm">语言</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-muted text-sm">中文（简体）</span>
            <span class="material-symbols-outlined text-muted text-base">chevron_right</span>
          </div>
        </div>
      </div>
    </section>
    </div>

    <!-- ===== 账户 ===== -->
    <div v-show="activeTab === 'account'" class="space-y-6">
    <!-- 账号与安全 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">shield_person</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">账号与安全</h2>
          <p class="text-muted text-xs mt-0.5">当前用户：{{ auth.user }}</p>
        </div>
      </div>

      <form @submit.prevent="doChangePassword" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input v-model="pw.oldPassword" type="password" placeholder="当前密码"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="pw.newPassword" type="password" placeholder="新密码（至少 6 位）"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="pw.confirm" type="password" placeholder="确认新密码"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button type="submit" class="sm:col-span-2 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-lg">lock_reset</span> 修改密码
        </button>
        <button type="button" @click="doLogout"
          class="py-2.5 rounded-xl border border-border text-error hover:bg-error/10 text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2">
          <span class="material-symbols-outlined text-lg">logout</span> 退出登录
        </button>
      </form>
      <p v-if="pwMsg" class="mt-3 text-xs font-body" :class="pwErr ? 'text-error' : 'text-success'">{{ pwMsg }}</p>
    </section>
    </div>

    <!-- 底部悬浮保存栏（始终可见） -->
    <div class="sticky bottom-16 md:bottom-0 z-40 mt-8">
      <div class="absolute inset-x-0 -top-5 h-5 bg-gradient-to-t from-background/90 to-transparent pointer-events-none rounded-t-2xl"></div>
      <div class="relative flex items-center gap-3 p-3 rounded-2xl bg-surface-alt/90 backdrop-blur-xl border border-border shadow-xl shadow-black/15">
        <button class="flex-1 py-3 rounded-xl border border-border text-muted hover:text-on-surface hover:bg-surface hover:border-primary/30 active:scale-[0.97] transition-all duration-200 font-body text-sm font-medium flex items-center justify-center gap-1.5"
          title="将所有偏好恢复为系统默认值">
          <span class="material-symbols-outlined text-lg">restart_alt</span>重置为默认
        </button>
        <button @click="saveSettings" :disabled="saving"
          class="flex-[2] py-3 rounded-xl text-on-primary font-body text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:opacity-70 disabled:hover:translate-y-0 disabled:cursor-not-allowed"
          :class="saved ? 'bg-success shadow-lg shadow-success/30' : 'bg-primary hover:bg-primary-hover shadow-lg shadow-primary/30'">
          <span v-if="saving" class="hc-spinner"></span>
          <span v-else-if="saved" class="material-symbols-outlined text-lg">check_circle</span>
          <span v-else class="material-symbols-outlined text-lg">save</span>
          {{ saving ? '保存中…' : (saved ? '已保存' : '保存设置') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onUnmounted, computed } from 'vue'
import ToggleRow from '@/components/ToggleRow.vue'
import api from '@/api'
import { listDevices, ensureDevice, renameDevice, deleteDevice, getDeviceId } from '@/utils/device'
import { availableSensors, unavailableReason, startSensorMonitor, buildReportPayload } from '@/utils/sensors'
import { loadInstances, switchInstance, changePassword, authLogout, auth, store, backendOnline } from '@/store'
import { applyTheme, resolveTheme, THEMES, CUSTOM_COLOR_KEYS, DEFAULT_CUSTOM_COLORS } from '@/themes'

// ---- HA 实例管理 ----
const form = reactive({ name: '', url: '', token: '', skipTLS: false })
const msg = ref('')
const msgErr = ref(false)

function flash(text, err = false) {
  msg.value = text
  msgErr.value = err
  setTimeout(() => { msg.value = '' }, 3000)
}

async function addInstance() {
  if (!form.url) { flash('请填写 Home Assistant 地址', true); return }
  try {
    await api.createInstance({
      name: form.name || form.url,
      url: form.url,
      token: form.token,
      skip_tls: form.skipTLS,
    })
    form.name = form.url = form.token = ''
    form.skipTLS = false
    await loadInstances()
    flash('实例已添加')
  } catch (e) {
    flash(e.message, true)
  }
}

// 切换某实例的忽略证书验证开关
async function setSkipTLS(ins, checked) {
  try {
    await api.updateInstance(ins.id, { name: ins.name, url: ins.url, token: ins.token, skip_tls: checked })
    ins.skip_tls = checked
    flash(checked ? '已开启忽略证书验证' : '已关闭忽略证书验证')
  } catch (e) {
    flash(e.message, true)
  }
}

async function activate(id) {
  try {
    await switchInstance(id)
    await loadInstances()
    flash('已切换实例')
  } catch (e) {
    flash(e.message, true)
  }
}

async function removeInstance(id) {
  if (!confirm('确定删除该实例？')) return
  try {
    await api.deleteInstance(id)
    await loadInstances()
    flash('实例已删除')
  } catch (e) {
    flash(e.message, true)
  }
}

// ---- 账号与安全 ----
const pw = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const pwMsg = ref('')
const pwErr = ref(false)

function pwFlash(text, err = false) {
  pwMsg.value = text
  pwErr.value = err
}

async function doChangePassword() {
  pwMsg.value = ''
  if (pw.newPassword.length < 6) { pwFlash('新密码至少 6 位', true); return }
  if (pw.newPassword !== pw.confirm) { pwFlash('两次输入的新密码不一致', true); return }
  try {
    await changePassword(pw.oldPassword, pw.newPassword)
    pw.oldPassword = pw.newPassword = pw.confirm = ''
    pwFlash('密码已修改')
  } catch (e) {
    pwFlash(e.message, true)
  }
}

async function doLogout() {
  await authLogout()
  window.location.href = '/login'
}

// ---- 偏好设置（对接 + 自动加载） ----
const map = reactive({ amap_key: '', dev_id: 'homecanvas', location_name: 'home' })
const themeKey = ref('default')
const customColor = ref('')
// 自定义主题调色板（11 个可调色项，实时预览）
const customColors = reactive({ ...DEFAULT_CUSTOM_COLORS })
// 主题网格中「自定义」卡的实时色板（跟随调色板变化）
const customSwatches = computed(() => [customColors.primary, customColors.accent, customColors.background])

// 恢复默认调色板（回到以默认主题为基准的配色）
function resetCustomPalette() {
  Object.assign(customColors, DEFAULT_CUSTOM_COLORS)
}

// 分组导航：页面太长时收纳为标签页，各组状态保活（v-show）
const tabs = [
  { key: 'connect', icon: 'link', label: '连接与设备' },
  { key: 'personal', icon: 'palette', label: '个性化' },
  { key: 'account', icon: 'shield_person', label: '账户' },
]
const activeTab = ref('connect')

// 保存栏交互状态：saving 转圈中 / saved 成功反馈（2s 后复原）
const saving = ref(false)
const saved = ref(false)
// 9 套主题（与 src/themes.js THEMES 同源，新增主题只需维护 THEMES）
const themeOptions = Object.values(THEMES)
const colors = [
  { name: '琥珀暖光', hex: '#F5A623' },
  { name: '薄荷清新', hex: '#5EC4B0' },
  { name: '薰衣草紫', hex: '#A78BFA' },
  { name: '深海蓝', hex: '#6BA3D9' },
  { name: '玫瑰金', hex: '#E8A87C' },
  { name: '森林绿', hex: '#5EC4A0' },
  { name: '珊瑚橙', hex: '#E87C5E' },
  { name: '极光青', hex: '#4DD9C4' },
]

// 主题变化即时预览（保存后持久化）；自定义主题走完整调色板，预设主题走主色覆盖
watch([themeKey, customColor, customColors], () => {
  if (themeKey.value === 'custom') applyTheme('custom', { ...customColors })
  else applyTheme(themeKey.value, customColor.value)
}, { deep: true })

const fontSize = ref('standard')
const fontSizes = [
  { key: 'compact', name: '紧凑', note: '适合大屏' },
  { key: 'standard', name: '标准', note: '推荐' },
  { key: 'loose', name: '宽松', note: '适合老年' },
]

const iconStyle = ref('linear')
const iconStyles = [
  { key: 'linear', name: '线性', note: '纤细优雅' },
  { key: 'filled', name: '填充', note: '饱满清晰' },
  { key: 'duotone', name: '双色调', note: '层次丰富' },
  { key: 'minimal', name: '极简', note: '纯粹简约' },
]

const floorStyle = ref('wireframe')
const floorStyles = [
  { key: 'wireframe', name: '简约线框', note: '线条简洁，一目了然' },
  { key: '3d', name: '伪3D', note: '立体感强，直观清晰' },
  { key: 'colored', name: '彩色分区', note: '功能分区一目了然' },
]

const toggles = ref([
  { id: 'transition', icon: 'motion_photos_on', title: '过渡动画', desc: '页面切换时的流畅过渡效果', color: 'bg-primary/15 text-primary', on: true },
  { id: 'glow', icon: 'light_mode', title: '光晕效果', desc: '按钮和重要元素的高亮光晕', color: 'bg-warning/15 text-warning', on: true },
  { id: 'micro', icon: 'touch_app', title: '微交互', desc: '点击、滑动等操作的手感反馈', color: 'bg-accent/15 text-accent', on: false },
])

const wakeWord = ref('你好， Lumina')

// 位置同步目标（person / device_tracker 实体下拉）
const sync_target = ref('')
const peopleOptions = ref([])
const trackerOptions = ref([])
async function loadTargets() {
  if (!store.activeID) return
  try {
    const { data: p } = await api.entities({ instance: store.activeID, domain: 'person' })
    const { data: t } = await api.entities({ instance: store.activeID, domain: 'device_tracker' })
    const pick = (ent) => ({ value: ent.entity_id, label: `${ent.friendly_name || ent.entity_id}（${String(ent.state || '未知')}）` })
    peopleOptions.value = (Array.isArray(p?.data) ? p.data : []).map(pick)
    trackerOptions.value = (Array.isArray(t?.data) ? t.data : []).map(pick)
  } catch { /* 未连接时下拉为空 */ }
}

// 设备列表：自动识别、去重、别名
const deviceList = ref([])
const currentDevId = ref('')
async function loadDevices() {
  try {
    const [list, cur] = await Promise.all([listDevices(), ensureDevice()])
    deviceList.value = list.map((d) => ({ ...d, _draft: d.name }))
    currentDevId.value = cur.device_id
  } catch { /* 后端离线时静默 */ }
}
async function saveAlias(d) {
  const name = (d._draft || '').trim()
  if (!name || name === d.name) { d._draft = d.name; return }
  try {
    const renamed = await renameDevice(d.device_id, name)
    d.name = renamed.name; d._draft = renamed.name
    flash('设备别名已更新')
  } catch (e) { flash(e.message, true) }
}
async function removeDevice(d) {
  if (!confirm(`确定删除设备「${d.name}」？`)) return
  try {
    await deleteDevice(d.device_id)
    deviceList.value = deviceList.value.filter((x) => x.device_id !== d.device_id)
    flash('设备已删除')
  } catch (e) { flash(e.message, true) }
}

// 设备传感器：按设备类型与浏览器能力提供不同传感器，可逐项开关并自动上报 HA
const sensorDefs = ref([])          // 后端定义 [{key,label,desc,icon}]
const sensorConfig = reactive({})   // key -> bool（当前设备）
const sensorAvail = ref(new Set())  // 当前设备可用的 key 集
const reporting = ref(false)
const lastReport = ref('')
let stopMonitor = null

// 后端图标为 mdi:xxx，设置页统一用 material 图标呈现
const SENSOR_ICONS = {
  battery_level: 'battery_full',
  battery_state: 'battery_charging_full',
  connection_type: 'wifi',
  network_quality: 'signal_cellular_alt',
  wifi_ssid: 'wifi_find',
  screen_state: 'monitor',
  light_sensor: 'light_mode',
  public_ip: 'public',
  current_time_zone: 'schedule',
  last_update_trigger: 'history',
  app_version: 'info',
  bssid: 'wifi_access_point',
  geocoded_location: 'location_on',
}
function sensorIcon(key) { return SENSOR_ICONS[key] || 'sensors' }

async function loadSensors() {
  try {
    const { data } = await api.sensorDefinitions()
    sensorDefs.value = Array.isArray(data) ? data : []
  } catch (e) { console.warn('[sensors] definitions:', e) }
  try {
    sensorAvail.value = availableSensors()
  } catch (e) { console.error('[sensors] availableSensors threw:', e) }
  // 默认全部关闭，再套用已保存配置
  sensorDefs.value.forEach((d) => { if (!(d.key in sensorConfig)) sensorConfig[d.key] = false })
  try {
    const { data } = await api.getPrefs()
    if (data && data.sensor_config) {
      const all = JSON.parse(data.sensor_config) || {}
      const mine = all[getDeviceId()] || {}
      sensorDefs.value.forEach((d) => { sensorConfig[d.key] = !!mine[d.key] })
    }
  } catch { /* 忽略坏配置 */ }
  syncMonitor()
  // 无论是否启用传感器都上报一次：注册 mobile_app 设备（HA 中立即出现 homecanvas 设备）。
  // activeID 由实例列表异步加载，尚未就绪时等待其变化后触发。
  if (sensorDefs.value.length) {
    if (store.activeID) reportNow(false)
    else {
      const stop = watch(() => store.activeID, (v) => { if (v) { stop(); reportNow(false) } })
    }
  }
}

async function saveSensorConfig() {
  let all = {}
  try {
    const { data } = await api.getPrefs()
    if (data && data.sensor_config) all = JSON.parse(data.sensor_config) || {}
  } catch { /* 忽略 */ }
  all[getDeviceId()] = { ...sensorConfig }
  await api.putPrefs({ sensor_config: JSON.stringify(all) })
}

async function toggleSensor(key, on) {
  sensorConfig[key] = on
  try {
    await saveSensorConfig()
    if (on) { syncMonitor(); reportNow(false) }
  } catch (e) { flash(e.message, true) }
}

// 有启用项时启动状态变化监听（变化即上报 + 60s 兜底），全部关闭时停止
function syncMonitor() {
  const enabled = sensorDefs.value.some((d) => sensorConfig[d.key])
  if (enabled && !stopMonitor) {
    stopMonitor = startSensorMonitor({
      onChange: (reason) => reportNow(false, reason),
      onError: (e) => console.warn('[sensors] monitor:', e),
    })
  } else if (!enabled && stopMonitor) {
    stopMonitor()
    stopMonitor = null
  }
}

async function reportNow(showMsg = true, trigger = 'manual') {
  if (!store.activeID) { console.warn('[sensors] report skipped: no activeID'); if (showMsg) flash('请先添加并切换 Home Assistant 实例', true); return }
  if (reporting.value) { console.warn('[sensors] report skipped: busy'); return }
  const enabled = sensorDefs.value.filter((d) => sensorConfig[d.key]).map((d) => d.key)
  // 手动点击且未启用任何传感器时给出提示；自动触发（注册设备）不受此限制
  if (!enabled.length && showMsg) { flash('请先启用至少一个传感器', true); return }
  reporting.value = true
  try {
    const { id, payload } = await buildReportPayload(store.activeID, enabled, { trigger, amapKey: map.amap_key.trim() })
    await api.reportSensors(id, payload)
    lastReport.value = new Date().toLocaleTimeString()
    if (showMsg) flash('设备传感器已上报')
  } catch (e) {
    console.error('[sensors] report failed:', e)
    const tips = {
      mobile_app_unavailable: 'Home Assistant 的 mobile_app 集成不可用（默认由 default_config 启用，请检查 HA 配置）',
      ha_unreachable: 'Home Assistant 连接失败，请检查实例配置',
      no_instance: '未配置或找不到该 Home Assistant 实例',
    }
    if (showMsg) flash(tips[e.code] || e.message, true)
  } finally {
    reporting.value = false
  }
}

async function loadPrefs() {
  try {
    const { data } = await api.getPrefs()
    if (!data) return
    if (data.theme) {
      const r = resolveTheme(data.theme)
      themeKey.value = r.themeKey
      customColor.value = r.customHex || ''
      if (r.themeKey === 'custom' && r.colors && typeof r.colors === 'object') {
        Object.assign(customColors, DEFAULT_CUSTOM_COLORS, r.colors)
      }
      if (themeKey.value === 'custom') applyTheme('custom', { ...customColors })
      else applyTheme(themeKey.value, customColor.value)
    }
    if (data.font) fontSize.value = data.font
    if (data.icons) iconStyle.value = data.icons
    if (data.floorplan) floorStyle.value = data.floorplan
    if (data.animation) {
      const m = JSON.parse(data.animation)
      toggles.value.forEach((t) => { if (t.id in m) t.on = !!m[t.id] })
    }
    if (data.wakeWord) wakeWord.value = data.wakeWord
    if (data.map_config) {
      try {
        const mc = JSON.parse(data.map_config)
        if (mc.amap_key) map.amap_key = mc.amap_key
        if (mc.dev_id) map.dev_id = mc.dev_id
        if (mc.location_name) map.location_name = mc.location_name
        if (mc.sync_target) sync_target.value = mc.sync_target
      } catch { /* 忽略坏配置 */ }
    }
  } catch { /* 后端离线时静默 */ }
}

async function saveSettings() {
  if (saving.value) return
  saving.value = true
  saved.value = false
  const animation = {}
  toggles.value.forEach((t) => { animation[t.id] = t.on })
  // 主题持久化：自定义主题存完整调色板；预设主题 + 自定义主色存旧格式 JSON；否则存主题 key
  let theme = themeKey.value
  if (themeKey.value === 'custom') theme = JSON.stringify({ theme: 'custom', colors: { ...customColors } })
  else if (customColor.value) theme = JSON.stringify({ theme: themeKey.value, custom: customColor.value })
  try {
    await api.putPrefs({
      theme,
      font: fontSize.value,
      icons: iconStyle.value,
      floorplan: floorStyle.value,
      animation: JSON.stringify(animation),
      wakeWord: wakeWord.value,
      map_config: JSON.stringify({
        amap_key: map.amap_key.trim(),
        dev_id: map.dev_id.trim() || 'homecanvas',
        location_name: map.location_name.trim() || 'home',
        sync_target: sync_target.value,
      }),
    })
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
    flash('设置已保存')
  } catch (e) {
    flash(e.message, true)
  } finally {
    saving.value = false
  }
}

onMounted(() => { loadPrefs(); loadTargets(); loadDevices(); loadSensors() })
onUnmounted(() => { if (stopMonitor) { stopMonitor(); stopMonitor = null } })
</script>

<style scoped>
/* 保存中旋转指示器（主题色前景） */
@keyframes hc-spin {
  to { transform: rotate(360deg); }
}
.hc-spinner {
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  border: 2px solid rgb(var(--c-on-primary) / 0.35);
  border-top-color: rgb(var(--c-on-primary));
  animation: hc-spin 0.7s linear infinite;
  flex-shrink: 0;
}
</style>
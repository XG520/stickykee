<template>
  <div class="space-y-6 pb-4">
    <!-- 页面标题只保留给屏读器（可见标题行占的垂直空间已省掉） -->
    <h1 class="sr-only">个性化设置</h1>

    <!-- 顶部导航（重置按钮收纳在「个性化」页底部） -->
    <div class="flex flex-wrap items-center gap-2">
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
    </div>

    <!-- ===== 连接与设备 ===== -->
    <div v-show="activeTab === 'connect'" class="space-y-6">
    <!-- 我的 HA Token：地址管理员全局配置，密钥属个人（所有用户可见，可自配或管理员代配） -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">key</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">我的 HA Token</h2>
          <p class="text-muted text-xs mt-0.5">访问 Home Assistant 的个人密钥</p>
        </div>
        <span class="ml-auto px-2.5 py-1 rounded-full text-xs font-medium"
          :class="haTokenBadge.cls">
          {{ haTokenBadge.text }}
        </span>
      </div>
      <p class="text-muted text-xs mb-3 font-body leading-relaxed">
        Home Assistant 的地址由管理员统一配置；访问密钥属于个人，可自己填写。
        {{ auth.isAdmin ? '也可由管理员在「用户管理」中代配。' : '管理员也可在「用户管理」中为你代配。' }}
        修改或切换后即时生效，无需重启服务器。
      </p>
      <div class="flex gap-2">
        <input v-model="myToken" type="password" autocomplete="new-password" placeholder="粘贴你的 Long-Lived Token（配置后即可访问实体）"
          class="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button @click="saveMyToken" :disabled="savingToken"
          class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all disabled:opacity-70 flex items-center gap-1.5">
          <span v-if="savingToken" class="hc-spinner"></span>
          {{ savingToken ? '保存中…' : '保存' }}
        </button>
      </div>
      <p v-if="tokMsg" class="mt-2 text-xs font-body" :class="tokMsgErr ? 'text-error' : 'text-success'">{{ tokMsg }}</p>
    </section>

    <!-- 服务器地址（APK 壳页地址簿同步显示） -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-accent text-lg">dns</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">服务器地址</h2>
          <p class="text-muted text-xs mt-0.5">当前连接的后端服务器（内网/外网地址簿）</p>
        </div>
      </div>
      <div class="rounded-xl bg-background border border-border px-3 py-2.5">
        <p class="text-on-surface text-xs font-semibold mb-1">当前连接</p>
        <p class="text-muted text-xs font-body leading-relaxed break-all">{{ currentOrigin }}</p>
      </div>
      <!-- APK 内：打开应用内地址簿抽屉（数据经原生桥与启动壳页共用一份） -->
      <button v-if="isApk" @click="openServerSheet"
        class="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-on-primary text-sm font-semibold transition-colors">
        <span class="material-symbols-outlined text-base">edit_note</span>
        管理服务器地址（内网/外网地址簿）
      </button>
      <p class="text-muted text-xs font-body mt-2 leading-relaxed">
        {{ isApk
          ? '地址簿与 APP 启动页共用一份；可同时保存内网、外网地址，启动与运行中按当前网络（WiFi→内网、移动数据→外网）自动选用。'
          : '手机端（APK）启动时会根据网络类型自动选择内网或外网地址。' }}
      </p>
    </section>

    <!-- 通话铃声（仅 APK）：来电铃声与呼叫彩铃，走系统铃声音量流 -->
    <section v-if="canPickRing" class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-accent text-lg">ring_volume</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">通话铃声</h2>
          <p class="text-muted text-xs mt-0.5">来电振铃与呼叫等待彩铃（随系统铃声音量）</p>
        </div>
      </div>
      <div class="space-y-2">
        <div v-for="k in ['call', 'back']" :key="k"
          class="flex items-center justify-between gap-3 rounded-xl bg-background border border-border px-3 py-2.5">
          <div class="min-w-0">
            <p class="text-on-surface text-sm font-medium">{{ k === 'call' ? '来电铃声' : '呼叫彩铃（等待接听）' }}</p>
            <p class="text-muted text-xs truncate">{{ ringNames[k] || '系统默认' }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button @click="pickRing(k)"
              class="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/90 text-on-primary text-xs font-semibold transition-colors">选择</button>
            <button v-if="ringNames[k]" @click="resetRing(k)"
              class="px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface transition-colors">默认</button>
          </div>
        </div>
      </div>
      <p class="text-muted text-xs font-body mt-2 leading-relaxed">
        通话铃声使用系统「铃声音量」，与媒体音量互不影响；在选择器中选「无」可静音对应铃声。
      </p>
    </section>

    <!-- Home Assistant 连接管理（仅管理员可见） -->
    <section v-if="auth.isAdmin" class="bg-surface-alt border border-border rounded-2xl p-5">
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

      <form @submit.prevent="addInstance" autocomplete="off" class="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3">
        <input v-model="form.name" placeholder="实例名称（如 家）" autocomplete="off"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="form.url" placeholder="HA 地址（如 http://homeassistant.local:8123）" autocomplete="off" inputmode="url" type="text"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <!-- 诱饵字段：吸收浏览器自动填充，避免污染上面的 url -->
        <input type="text" name="username" autocomplete="username" class="hidden" aria-hidden="true" tabindex="-1">
        <input type="password" name="password" autocomplete="current-password" class="hidden" aria-hidden="true" tabindex="-1">
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
        <div v-if="auth.isAdmin">
          <label class="text-on-surface text-sm font-medium mb-2 block">管理员全局 Key</label>
          <input v-model="map.amap_key" placeholder="填写高德开放平台申请到的 Key"
            class="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
          <p class="text-muted text-xs mt-1.5 font-body leading-relaxed">
            管理员全局 Key 供所有「使用管理员 Key」的用户渲染地图。每个用户用谁的 Key 可在「用户管理」中逐人设置。<br>
            前往 <a href="https://console.amap.com/" target="_blank" rel="noopener" class="text-primary hover:underline">高德开放平台</a> → 应用管理，新建「Web端(JS API)」应用并开启定位权限，把 Key 粘贴到上方。
          </p>
        </div>
        <div v-else-if="mapConfig.use_admin">
          <div class="rounded-xl bg-background border border-border px-3 py-2.5">
            <p class="text-on-surface text-xs font-semibold mb-1">当前地图使用「管理员的高德 Key」渲染</p>
            <p class="text-muted text-xs font-body leading-relaxed">由管理员指定，无需填写自己的 Key。</p>
          </div>
        </div>
        <div v-else>
          <label class="text-on-surface text-sm font-medium mb-2 block">我的高德 Key</label>
          <input v-model="map.amap_key" placeholder="填写你的高德 Key，以渲染首页地图"
            class="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
          <p class="text-muted text-xs mt-1.5 font-body leading-relaxed">
            管理员已指定你使用「本人的高德 Key」，请在此填写。<br>
            前往 <a href="https://console.amap.com/" target="_blank" rel="noopener" class="text-primary hover:underline">高德开放平台</a> → 应用管理，新建「Web端(JS API)」应用并开启定位权限。
          </p>
        </div>
        <!-- 设备追踪开关：APK 默认开启，网页端默认关闭；切换即时生效（不刷新/不重登） -->
        <div class="rounded-xl bg-background border border-border px-1.5 py-1">
          <ToggleRow :model-value="locTracking" icon="my_location" color="bg-info/15 text-info"
            title="设备追踪（自动同步位置到 Home Assistant）"
            :desc="locTracking
              ? '已开启：位置自动上报，HA 自动生成并绑定本机的 device_tracker 实体'
              : '已关闭：不会自动上报位置，也不生成 device_tracker（App 默认开启，网页端默认关闭）'"
            @update:model-value="toggleTracking" />
        </div>
        <div class="rounded-xl bg-background border border-border px-3 py-2.5">
          <p class="text-on-surface text-xs font-semibold mb-1">位置同步方式（HA 官方 mobile_app 协议）</p>
          <p class="text-muted text-xs font-body leading-relaxed">
            定位经 HA 官方 <span class="font-mono">update_location</span> 命令上报，HA 会为该注册设备自动创建并绑定
            <span class="font-mono">device_tracker</span> 实体（带唯一标识符，可在 HA 中管理），无需手动指定 dev_id。<br>
            实体状态由 HA 依据「家」zone 自动判定，显示<span class="font-mono">在家</span>/<span class="font-mono">离家</span>。<br>
            若要把本机位置关联到某位家人（person），请在 HA 中「设置 → 人员 → 选择该人员 → 跟踪设备」勾选本机设备，person 会自动取用其位置。<br>
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
          class="flex flex-col gap-2.5 rounded-xl bg-background border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
          <!-- 主行：图标 + 名称/说明（手机上占整行，不再被右侧固定宽度挤成单字列） -->
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <span class="w-7 h-7 flex-shrink-0 rounded-full bg-primary/20 text-primary flex items-center justify-center">
              <span class="material-symbols-outlined text-base">devices_other</span>
            </span>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-on-surface text-sm font-medium truncate">{{ d.name }}</span>
                <span v-if="d.device_id === currentDevId" class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-success/15 text-success font-semibold">当前设备</span>
              </div>
              <span class="text-muted text-xs font-body">开启设备追踪后，HA 中会自动创建并绑定该设备的 device_tracker 实体</span>
            </div>
          </div>
          <!-- 操作行：别名编辑 + 删除（手机上整行排在下方，输入框自适应宽度） -->
          <div class="flex items-center gap-1.5 sm:flex-shrink-0">
            <input v-model="d._draft" @keyup.enter="saveAlias(d)"
              class="min-w-0 flex-1 sm:flex-none sm:w-36 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none transition-colors"
              placeholder="设置别名">
            <button @click="saveAlias(d)" class="flex-shrink-0 px-2 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">
              保存别名
            </button>
            <button @click="removeDevice(d)" class="flex-shrink-0 px-2 py-1.5 rounded-lg hover:bg-error/10 text-error text-xs font-semibold transition-colors"
              title="删除此设备记录">
              <span class="material-symbols-outlined text-base">delete</span>
            </button>
          </div>
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
        提示： 
      </p>
    </section>

    <!-- 浏览器命令（Browser_mod 风格）：HA 侧经事件总线向本设备下发命令 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-warning/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-warning text-lg">contrast</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">浏览器命令（Browser_mod 风格）</h2>
          <p class="text-muted text-xs mt-0.5">Home Assistant 经事件总线（<code class="font-code text-muted">stickynuo_command</code>）向本设备下发通知/亮屏/亮度/媒体/服务命令</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 mb-4">
        <button @click="grantNotify" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface/60 text-on-surface text-xs font-semibold border border-border transition-all duration-200 active:scale-95">
          <span class="material-symbols-outlined text-sm">notifications</span> 授权系统通知
        </button>
        <button @click="testNotify" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface/60 text-on-surface text-xs font-semibold border border-border transition-all duration-200 active:scale-95">
          <span class="material-symbols-outlined text-sm">report</span> 测试通知
        </button>
        <button @click="toggleBlackout" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface/60 text-on-surface text-xs font-semibold border border-border transition-all duration-200 active:scale-95">
          <span class="material-symbols-outlined text-sm">visibility_off</span> {{ blackout.active ? '取消黑屏' : '模拟关屏（黑屏）' }}
        </button>
        <button @click="toggleWake" :class="waking ? 'bg-primary text-on-primary' : 'bg-surface hover:bg-surface/60 text-on-surface border border-border'" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95">
          <span class="material-symbols-outlined text-sm">brightness_7</span> {{ waking ? '保持亮屏（释放）' : '保持亮屏' }}
        </button>
      </div>

      <div class="mb-1 flex items-center justify-between text-xs text-muted font-body">
        <span>屏幕亮度（视觉遮罩模拟）</span>
        <span class="font-code">{{ blackout.brightness }}</span>
      </div>
      <input type="range" min="0" max="255" :value="blackout.brightness"
        @input="setBrightnessPreview($event.target.value)" class="w-full accent-primary" />

      <!-- 黑屏解除方式：双击手势始终可用；接近感应解除默认关闭，用环境光 lux 模拟接近 -->
      <div class="mt-4 pt-4 border-t border-border">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-on-surface text-xs font-semibold">接近感应解除黑屏</p>
            <p class="text-muted text-[11px] mt-0.5 font-body leading-relaxed">
              浏览器没有真实接近传感器，这里用环境光模拟：手盖住屏幕时 lux 下降，全黑状态下 lux ≤ 阈值即自动解除。双击屏幕随时可解除。
            </p>
          </div>
          <label class="flex items-center gap-2 shrink-0 pt-0.5 cursor-pointer" :class="blackout.supported ? '' : 'opacity-50'">
            <input type="checkbox" :checked="blackout.enabled" :disabled="!blackout.supported"
              @change="setDismissEnabled($event.target.checked)" class="accent-primary w-4 h-4" />
            <span class="text-xs text-muted">启用</span>
          </label>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <label class="flex items-center gap-2 text-xs text-muted font-body">
            解除阈值（lux ≤）
            <input type="number" min="0" step="1"
              :value="blackout.threshold" :disabled="!blackout.supported"
              @change="setDismissThreshold($event.target.value)"
              class="w-20 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs text-on-surface font-code outline-none focus:border-primary/50 disabled:opacity-50" />
          </label>
          <span class="text-xs text-muted font-body">
            环境光实时值：
            <span class="font-code text-on-surface">{{ blackout.supported ? (blackout.lux ?? '—') : '不支持' }}</span>
          </span>
        </div>
        <p v-if="!blackout.supported" class="text-warning text-[11px] mt-2 font-body leading-relaxed">
          当前浏览器不提供环境光传感器（桌面端通常不支持，需 Android Chrome 等移动端），接近解除不可用；双击手势不受影响。
        </p>
      </div>
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

    <!-- 重置为默认：只作用于个性化偏好，收纳在本页底部 -->
    <button @click="resetDefaults" title="将所有偏好恢复为系统默认值"
      class="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-border text-muted hover:text-error hover:border-error/40 hover:bg-error/5 text-sm transition-colors">
      <span class="material-symbols-outlined text-base">restart_alt</span> 重置为默认
    </button>
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
        <input v-model="pw.oldPassword" type="password" placeholder="当前密码" autocomplete="current-password"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="pw.newPassword" type="password" placeholder="新密码（至少 6 位）" autocomplete="new-password"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="pw.confirm" type="password" placeholder="确认新密码" autocomplete="new-password"
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

    <!-- 系统信息：前后端版本号，用于确认部署是否已更新 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">info</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">系统信息</h2>
          <p class="text-muted text-xs mt-0.5">前后端版本号，用于确认部署是否已更新</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-xl bg-background border border-border px-3 py-2.5">
          <p class="text-muted text-xs mb-1">网页版本</p>
          <p class="text-on-surface text-sm font-semibold">{{ appVersion || '—' }}</p>
        </div>
        <div class="rounded-xl bg-background border border-border px-3 py-2.5">
          <p class="text-muted text-xs mb-1">服务端版本</p>
          <p class="text-on-surface text-sm font-semibold">
            <span v-if="backendVersion === null" class="text-muted">获取中…</span>
            <span v-else-if="backendVersion === ''" class="text-error">获取失败</span>
            <template v-else>{{ backendVersion }}</template>
          </p>
        </div>
        <div class="rounded-xl bg-background border border-border px-3 py-2.5">
          <p class="text-muted text-xs mb-1">安卓 App</p>
          <!-- APK 内：发现新版本 → 一键更新（原生下载 + 拉起系统安装器） -->
          <template v-if="canInAppUpdate">
            <button v-if="apkUpdateAvailable && !apkUpdating" @click="updateApk"
              class="text-primary text-sm font-semibold inline-flex items-center gap-1 hover:underline">
              <span class="material-symbols-outlined text-base">system_update_alt</span>
              发现新版本，立即更新
            </button>
            <div v-else-if="apkUpdating" class="text-sm">
              <div class="flex items-center gap-2 text-muted">
                <span class="hc-spinner"></span>
                <span>下载中 {{ apkProgress }}%</span>
              </div>
              <div class="mt-1.5 h-1 rounded bg-border overflow-hidden">
                <div class="h-full bg-primary transition-all duration-200" :style="{ width: apkProgress + '%' }"></div>
              </div>
            </div>
            <p v-else-if="apkChecked" class="text-muted text-sm">已是最新</p>
            <p v-else class="text-muted text-sm">检测中…</p>
          </template>
          <!-- Web 端：仅提供安装包下载 -->
          <template v-else>
            <button v-if="apkAvailable" @click="downloadApk" :disabled="apkSaving"
              class="text-primary text-sm font-semibold inline-flex items-center gap-1 hover:underline disabled:opacity-60">
              <span v-if="apkSaving" class="hc-spinner"></span>
              <span v-else class="material-symbols-outlined text-base">download</span>
              {{ apkSaving ? '下载中…' : '下载安装包' }}
            </button>
            <p v-else-if="apkChecked" class="text-muted text-sm">未提供</p>
            <p v-else class="text-muted text-sm">检测中…</p>
          </template>
        </div>
        <!-- 通知权限：未开启时醒目提示，点击申请（永久拒绝自动跳应用详情） -->
        <div v-if="canInAppUpdate" class="rounded-xl bg-background border px-3 py-2.5"
          :class="notifOn === false ? 'border-warning' : 'border-border'">
          <p class="text-muted text-xs mb-1">通知提醒</p>
          <button v-if="notifOn === false" @click="askNotifPerm"
            class="text-warning text-sm font-semibold inline-flex items-center gap-1 hover:underline">
            <span class="material-symbols-outlined text-base">notifications_off</span>
            未开启，消息/来电无法提醒，点击开启
          </button>
          <p v-else-if="notifOn === true" class="text-success text-sm inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-base">check_circle</span> 已开启
          </p>
          <p v-else class="text-muted text-sm">检测中…</p>
        </div>
        <!-- 开机自启动：MIUI 等需手动允许，引导到应用详情 -->
        <div v-if="canInAppUpdate" class="rounded-xl bg-background border border-border px-3 py-2.5">
          <p class="text-muted text-xs mb-1">开机自启动</p>
          <button @click="goAppDetails"
            class="text-primary text-sm font-semibold inline-flex items-center gap-1 hover:underline">
            <span class="material-symbols-outlined text-base">restart_alt</span>
            允许自启动（重启后自动恢复在线）
          </button>
          <p class="text-muted text-[11px] mt-1">在应用详情中开启「自启动」，省电策略选「无限制」</p>
        </div>
      </div>
      <p v-if="versionMismatch" class="mt-2 text-xs font-body text-warning">
        前后端版本不一致：请先刷新页面（Ctrl+F5）；若仍不一致，说明服务端尚未更新到最新版本。
      </p>
    </section>
    </div>

    <!-- ===== 用户管理（仅管理员） ===== -->
    <div v-if="auth.isAdmin" v-show="activeTab === 'users'" class="space-y-6">
    <!-- 系统名称（全局）：改后所有用户的顶栏/登录页/浏览器标题同步更新 -->
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">badge</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">系统名称</h2>
          <p class="text-muted text-xs mt-0.5">顶栏、登录页与浏览器标签标题显示的名字</p>
        </div>
      </div>
      <div class="flex gap-2">
        <input v-model="siteNameDraft" maxlength="20" placeholder="例如：糯米"
          class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button @click="saveSiteName" :disabled="siteNameSaving"
          class="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-base">save</span> 保存
        </button>
      </div>
      <p v-if="siteNameMsg" class="mt-2 text-xs font-body" :class="siteNameErr ? 'text-error' : 'text-success'">{{ siteNameMsg }}</p>
    </section>
    <section class="bg-surface-alt border border-border rounded-2xl p-5">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-info/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-info text-lg">group</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">用户管理</h2>
          <p class="text-muted text-xs mt-0.5">仅管理员可创建用户，可管理角色、密码与地图 Key 使用策略</p>
        </div>
      </div>

      <!-- 创建用户 -->
      <form @submit.prevent="createUser" autocomplete="off" class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
        <input v-model="newUser.username" placeholder="用户名" autocomplete="off"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="newUser.password" type="password" placeholder="密码（至少 6 位）" autocomplete="new-password"
          class="bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button type="submit" class="px-4 py-2 rounded-xl bg-primary justify-center hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all flex items-center gap-2">
          <span class="material-symbols-outlined text-lg">person_add</span> 创建用户
        </button>
        <label class="col-span-full flex items-center gap-2.5 cursor-pointer select-none">
          <input v-model="newUser.is_admin" type="checkbox" class="w-4 h-4 accent-primary">
          <span class="text-on-surface text-sm">设为管理员</span>
          <span class="text-muted text-xs">（管理员可管理 HA 连接与用户）</span>
        </label>
      </form>
      <p v-if="umsg" class="mt-3 text-xs font-body" :class="umsgErr ? 'text-error' : 'text-success'">{{ umsg }}</p>

      <!-- 用户列表 -->
      <div class="mt-4 space-y-2">
        <div v-for="u in users" :key="u.username"
          class="rounded-xl bg-surface border border-border p-3 flex flex-wrap items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center"
            :class="u.username === auth.user ? 'bg-primary/20 text-primary' : 'bg-surface-hover text-muted'">
            <span class="material-symbols-outlined text-base">person</span>
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-on-surface text-sm font-medium">{{ u.username }}</span>
              <span v-if="u.username === auth.user" class="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold">当前账号</span>
              <span v-if="u.is_admin" class="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-semibold">管理员</span>
            </div>
            <span class="text-muted text-xs font-body">{{ (u.created_at || '').slice(0, 16).replace('T', ' ') }}</span>
          </div>

          <!-- 角色切换（永不操作自身） -->
          <div v-if="u.username !== auth.user">
            <button v-if="!u.is_admin" @click="toggleAdmin(u)"
              class="px-2.5 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface transition-colors">设为管理员</button>
            <button v-else @click="toggleAdmin(u)"
              class="px-2.5 py-1.5 rounded-lg border border-border text-xs text-error hover:bg-error/10 transition-colors">取消管理员</button>
          </div>

          <!-- 重置密码 -->
          <button v-if="u.username !== auth.user" @click="resetUserPassword(u)"
            class="px-2.5 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface transition-colors flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">lock_reset</span> 重置密码
          </button>

          <!-- 地图 Key 使用策略 -->
          <div class="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-1.5">
            <span class="text-muted text-xs">地图Key</span>
            <div class="flex rounded-md overflow-hidden border border-border text-xs">
              <button type="button" class="px-2 py-1 font-semibold transition-colors" :class="u.map_use_admin ? 'text-muted bg-background' : 'bg-primary text-on-primary'"
                @click="setUserMapPolicy(u, false)">本人</button>
              <button type="button" class="px-2 py-1 font-semibold transition-colors" :class="u.map_use_admin ? 'bg-primary text-on-primary' : 'text-muted bg-background'"
                @click="setUserMapPolicy(u, true)">管理员</button>
            </div>
          </div>

          <!-- HA 个人 Token：管理员代配/清除，即时生效 -->
          <div class="flex items-center gap-2">
            <span class="px-2 py-1 rounded text-xs flex items-center gap-1"
              :class="u.has_ha_token ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
              <span class="material-symbols-outlined text-sm">{{ u.has_ha_token ? 'key' : 'key_off' }}</span>
              {{ u.has_ha_token ? 'HA Token 已配' : 'HA Token 未配' }}
            </span>
            <button type="button" @click="u._editHA = !u._editHA"
              class="px-2.5 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface transition-colors">代配</button>
          </div>
          <div v-if="u._editHA" class="flex gap-2 w-full max-w-md">
            <input v-model="u._haToken" type="password" autocomplete="new-password"
              :placeholder="u.has_ha_token ? '输入新 Token 覆盖；留空则清除并禁用' : '粘贴该用户的 Long-Lived Token'"
              class="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
            <button type="button" @click="setUserHAToken(u)"
              class="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">保存</button>
          </div>

          <button @click="removeUser(u)" :disabled="u.username === auth.user"
            class="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors disabled:opacity-40 disabled:pointer-events-none">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
        <p v-if="!users.length" class="text-muted text-sm font-body">暂无其他用户。首个注册用户为管理员，其余用户需在此创建。</p>
      </div>
    </section>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onUnmounted, computed } from 'vue'
import ToggleRow from '@/components/ToggleRow.vue'
import api, { getToken } from '@/api'
import { listDevices, ensureDevice, renameDevice, deleteDevice, getDeviceId, currentDevice, readCache } from '@/utils/device'
import { availableSensors, unavailableReason, startSensorMonitor, buildReportPayload } from '@/utils/sensors'
import { showNotify, setBlackout, setScreenBrightness, setScreenWake, blackout, saveBlackoutDismiss, watchAmbientLight } from '@/utils/browserCommands'
import { loadInstances, switchInstance, changePassword, authLogout, auth, store, backendOnline, haTokenConfigured, haTokenKnown, saveHAToken, siteName, loadSiteName, saveSiteName as persistSiteName } from '@/store'
import { applyTheme, resolveTheme, THEMES, CUSTOM_COLOR_KEYS, DEFAULT_CUSTOM_COLORS } from '@/themes'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { isApk, openServerSheet } from '@/utils/serverConfig'
import { trackingEnabled, setTrackingEnabled } from '@/utils/location'
import { applyTrackingPref } from '@/utils/autoSync'

// ---- 设备追踪开关（APK 默认开启、网页端默认关闭，localStorage 设备级偏好） ----
// 切换后调 applyTrackingPref 即时启停定位链路（autoSync 的 watch/周期上报），无需刷新或重登
const locTracking = ref(trackingEnabled())
function toggleTracking(v) {
  locTracking.value = !!v
  setTrackingEnabled(!!v)
  applyTrackingPref()
}

// ---- HA 实例管理 ----
const form = reactive({ name: '', url: '', token: '', skipTLS: false })
const msg = ref('')
const msgErr = ref(false)

function flash(text, err = false) {
  msg.value = text
  msgErr.value = err
  setTimeout(() => { msg.value = '' }, 3000)
}

// ---- 个人 HA Token ----
const myToken = ref('')
const savingToken = ref(false)
const tokMsg = ref('')
const tokMsgErr = ref(false)

// 状态徽标：未取到后端权威值（haTokenKnown=false）时显示「检查中…」，
// 不能直接断言「未配置」，否则刷新/请求失败时会误报
const haTokenBadge = computed(() => {
  if (!haTokenKnown.value) return { cls: 'bg-surface text-muted', text: '检查中…' }
  return haTokenConfigured.value
    ? { cls: 'bg-success/15 text-success', text: '已配置' }
    : { cls: 'bg-error/15 text-error', text: '未配置（HA 访问已禁用）' }
})

// ---- APK 环境识别与地址簿入口 ----
// 远程页面里 Capacitor JS 运行时不存在（仅注入壳页源），
// 原生 addJavascriptInterface 注入的 StickyKeeNative 对所有源可用。
// 服务器地址簿经原生桥统一存取（utils/serverConfig），Web 端 isApk=false 不显示入口。
const currentOrigin = computed(() => {
  try { return window.location.origin } catch { return '' }
})

async function saveMyToken() {
  savingToken.value = true
  try {
    await saveHAToken(myToken.value.trim())
    tokMsgErr.value = false
    tokMsg.value = '已保存，连接即时生效'
    myToken.value = ''
  } catch (e) {
    tokMsgErr.value = true
    tokMsg.value = e.message
  }
  savingToken.value = false
  setTimeout(() => { tokMsg.value = '' }, 3000)
}

async function addInstance() {
  if (!form.url) { flash('请填写 Home Assistant 地址', true); return }
  try {
    await api.createInstance({
      name: form.name || form.url,
      url: form.url,
      skip_tls: form.skipTLS,
    })
    form.name = form.url = ''
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
    await api.updateInstance(ins.id, { name: ins.name, url: ins.url, skip_tls: checked })
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
const map = reactive({ amap_key: '' })
// 地图 Key 使用策略（普通用户）：use_admin=true 用管理员 Key；false 用本人 Key
const mapConfig = reactive({ use_admin: false, has_own_key: false })
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
  ...(auth.isAdmin ? [{ key: 'users', icon: 'group', label: '用户管理' }] : []),
]
const activeTab = ref('connect')
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

// 设备列表：自动识别、去重、别名
const deviceList = ref([])
const currentDevId = ref('')
async function loadDevices() {
  try {
    // 注册门控：仅当设备追踪开启（APK 默认开）或本机已有注册记录时才 ensureDevice；
    // 网页端默认（追踪关 + 从未注册）只读列表，不生成本机设备条目
    const cached = readDeviceCache()
    const shouldEnsure = trackingEnabled() || !!(cached && cached.device_id)
    const [list, cur] = await Promise.all([
      listDevices(),
      shouldEnsure ? ensureDevice() : Promise.resolve(currentDevice()),
    ])
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
  if (!confirm(`确定删除设备「${d.name}」？\n将同时从 Home Assistant 中移除对应设备（含 device_tracker 实体）。`)) return
  try {
    const { data } = await deleteDevice(d.device_id)
    deviceList.value = deviceList.value.filter((x) => x.device_id !== d.device_id)
    flash(data?.ha_removed ? '设备已删除，HA 中对应设备已移除' : `设备已删除；${data?.ha_message || 'HA 设备未能移除'}`, !data?.ha_removed)
  } catch (e) { flash(e.message, true) }
}

// 设备传感器：按设备类型与浏览器能力提供不同传感器，可逐项开关并自动上报 HA
const sensorDefs = ref([])          // 后端定义 [{key,label,desc,icon}]
const sensorConfig = reactive({})   // key -> bool（当前设备）
const sensorAvail = ref(new Set())  // 当前设备可用的 key 集
const reporting = ref(false)
const lastReport = ref('')
let stopMonitor = null
let stopLightWatch = null // 环境光实时值的停止函数（面板打开期间生效）

// 后端图标为 mdi:xxx，设置页统一用 material 图标呈现
const SENSOR_ICONS = {
  battery_level: 'battery_full',
  battery_state: 'battery_charging_full',
  connection_type: 'wifi',
  network_quality: 'signal_cellular_alt',
  wifi_ssid: 'wifi_find',
  screen_state: 'monitor',
  light_sensor: 'light_mode',
  proximity: 'sensor_occupied',
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
    const { data } = await getPrefs()
    if (data && data.sensor_config) {
      const all = JSON.parse(data.sensor_config) || {}
      const mine = all[getDeviceId()] || {}
      sensorDefs.value.forEach((d) => { sensorConfig[d.key] = !!mine[d.key] })
    }
  } catch { /* 忽略坏配置 */ }
  syncMonitor()
  // 注册上报门控：仅当本机启用了传感器、或设备追踪开启（APK 默认开）时才上报一次，
  // 注册 mobile_app 设备（HA 中出现 Sticky Kee 设备）。
  // 网页端默认（无启用传感器 + 追踪关闭）完全不注册——设备列表与 HA 中都不会生成条目。
  // activeID 由实例列表异步加载，尚未就绪时等待其变化后触发。
  const anySensor = sensorDefs.value.some((d) => sensorConfig[d.key])
  if (sensorDefs.value.length && (anySensor || trackingEnabled())) {
    if (store.activeID) reportNow(false)
    else {
      const stop = watch(() => store.activeID, (v) => { if (v) { stop(); reportNow(false) } })
    }
  }
}

async function saveSensorConfig() {
  let all = {}
  try {
    // 读-改-写：必须拿最新值，绕过本地缓存，否则可能覆盖掉别处的改动
    const { data } = await getPrefs({ force: true })
    if (data && data.sensor_config) all = JSON.parse(data.sensor_config) || {}
  } catch { /* 忽略 */ }
  all[getDeviceId()] = { ...sensorConfig }
  await putPrefs({ sensor_config: JSON.stringify(all) })
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
  const enabledKeys = sensorDefs.value.filter((d) => sensorConfig[d.key]).map((d) => d.key)
  if (enabledKeys.length && !stopMonitor) {
    stopMonitor = startSensorMonitor({
      onChange: (reason) => reportNow(false, reason),
      onError: (e) => console.warn('[sensors] monitor:', e),
      scope: enabledKeys,
    })
  } else if (!enabledKeys.length && stopMonitor) {
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

// ---- 浏览器命令（Browser_mod 风格）：本地自测 ----
const waking = ref(false)
async function grantNotify() {
  try { await showNotify({ title: '通知已授权', message: '现在可通过 Home Assistant 下发通知了' }) }
  catch (e) { flash(e.message, true) }
}
function testNotify() {
  showNotify({ title: 'Sticky Kee 测试通知', message: '这条通知来自浏览器命令面板。', actions: [{ label: '知道了', type: 'none' }] })
}
async function toggleBlackout() {
  setBlackout(!blackout.active, 200) // 状态由 browserCommands 的 blackout 持有（手势/接近解除也会改它）
}
function setDismissEnabled(v) { saveBlackoutDismiss({ enabled: v }) }
function setDismissThreshold(v) { saveBlackoutDismiss({ threshold: v }) }
async function toggleWake() {
  waking.value = await setScreenWake(!waking.value)
  if (!waking.value) flash('当前浏览器不支持屏幕唤醒锁', true)
}
function setBrightnessPreview(v) {
  setScreenBrightness(Number(v), 60) // 拖到最暗（0）即为全黑，此时双击屏幕可恢复全亮
}

// ---- 用户管理（仅管理员） ----
const users = ref([])
const newUser = reactive({ username: '', password: '', is_admin: false })
const umsg = ref('')
const umsgErr = ref(false)
function uflash(text, err = false) { umsg.value = text; umsgErr.value = err }

// ---- 系统名称（管理员） ----
const siteNameDraft = ref(siteName.value)
const siteNameSaving = ref(false)
const siteNameMsg = ref('')
const siteNameErr = ref(false)
async function saveSiteName() {
  const name = siteNameDraft.value.trim()
  if (!name) { siteNameMsg.value = '名称不能为空'; siteNameErr.value = true; return }
  siteNameSaving.value = true
  siteNameMsg.value = ''
  try {
    await persistSiteName(name)
    siteNameMsg.value = `已保存为「${name}」`
    siteNameErr.value = false
  } catch (e) {
    siteNameMsg.value = e?.response?.data?.error || e.message || '保存失败'
    siteNameErr.value = true
  } finally {
    siteNameSaving.value = false
  }
}

async function loadUsers() {
  if (!auth.isAdmin) return
  try { users.value = (await api.listUsers()).data || [] } catch { /* 静默 */ }
}
async function createUser() {
  if (!newUser.username || newUser.password.length < 6) { uflash('用户名必填，密码至少 6 位', true); return }
  try {
    await api.createUser({ username: newUser.username, password: newUser.password, is_admin: newUser.is_admin })
    newUser.username = newUser.password = ''; newUser.is_admin = false
    await loadUsers(); uflash('用户已创建')
  } catch (e) { uflash(e.message, true) }
}
async function toggleAdmin(u) {
  try {
    await api.updateUser(u.username, { is_admin: !u.is_admin })
    u.is_admin = !u.is_admin; uflash('角色已更新')
  } catch (e) { uflash(e.message, true) }
}
async function resetUserPassword(u) {
  const p = prompt(`输入「${u.username}」的新密码（至少 6 位）`)
  if (!p) return
  if (p.length < 6) { uflash('密码至少 6 位', true); return }
  try { await api.updateUser(u.username, { password: p }); uflash('密码已重置') }
  catch (e) { uflash(e.message, true) }
}
async function setUserMapPolicy(u, useAdmin) {
  if (u.map_use_admin === useAdmin) return
  try {
    await api.setUserMapPolicy(u.username, useAdmin)
    u.map_use_admin = useAdmin
    uflash(useAdmin ? `「${u.username}」将使用管理员的高德 Key` : `「${u.username}」将使用本人的高德 Key`)
  } catch (e) { uflash(e.message, true) }
}
async function removeUser(u) {
  if (!confirm(`确定删除用户「${u.username}」？其个性化与仪表盘布局将一并清除。`)) return
  try { await api.deleteUser(u.username); users.value = users.value.filter(x => x.username !== u.username); uflash('用户已删除') }
  catch (e) { uflash(e.message, true) }
}
// 管理员代配（或清除）某用户的 HA 个人 Token：保存后即时生效，无需重启服务器。
async function setUserHAToken(u) {
  try {
    const tok = (u._haToken || '').trim()
    await api.setUserHAToken(u.username, tok)
    u.has_ha_token = !!tok
    u._haToken = ''
    u._editHA = false
    uflash(tok ? `「${u.username}」的 HA Token 已保存并即时生效` : `已清除「${u.username}」的 HA Token（其 HA 访问已禁用）`)
  } catch (e) { uflash(e.message, true) }
}

// ---- 偏好加载与保存 ----
async function loadPrefs() {
  try {
    const { data } = await getPrefs()
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
        mapConfig.use_admin = !!mc.use_admin
        mapConfig.has_own_key = !!mc.has_own_key
        // 管理员始终可编辑全局 Key；普通用户仅在「本人 Key」模式下可编辑
        if (auth.isAdmin || !mapConfig.use_admin) map.amap_key = mc.amap_key
      } catch { /* 忽略坏配置 */ }
    }
  } catch { /* 后端离线时静默 */ }
}

// ---- 自动保存：去掉「保存设置」按钮，偏好变化即自动持久化（不再需要手动保存） ----
// 把当前个性化偏好组装成 prefs 请求体并持久化。
async function persistPrefs() {
  const animation = {}
  toggles.value.forEach((t) => { animation[t.id] = t.on })
  // 主题持久化：自定义主题存完整调色板；预设主题 + 自定义主色存旧格式 JSON；否则存主题 key
  let theme = themeKey.value
  if (themeKey.value === 'custom') theme = JSON.stringify({ theme: 'custom', colors: { ...customColors } })
  else if (customColor.value) theme = JSON.stringify({ theme: themeKey.value, custom: customColor.value })
  const body = {
    theme,
    font: fontSize.value,
    icons: iconStyle.value,
    floorplan: floorStyle.value,
    animation: JSON.stringify(animation),
    wakeWord: wakeWord.value,
  }
  if (auth.isAdmin) {
    // 管理员始终写全局 Key
    body.map_config = JSON.stringify({ amap_key: map.amap_key.trim() })
  } else if (!mapConfig.use_admin) {
    // 普通用户且「本人 Key」模式：写本人的 Key
    body.map_config = JSON.stringify({ amap_key: map.amap_key.trim() })
  }
  await putPrefs(body)
}

let saveTimer = null
function scheduleAutoSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistPrefs().catch(() => { /* 后端离线/写冲突时静默，下次变化再试 */ })
  }, 600)
}

// 任一偏好变化（含地图 Key）即触发自动保存
watch(
  [themeKey, customColor, customColors, fontSize, iconStyle, floorStyle, toggles, wakeWord, () => map.amap_key],
  () => scheduleAutoSave(),
  { deep: true },
)

// ---- 重置为默认：恢复全部个性化偏好并立即持久化 ----
async function resetDefaults() {
  if (!confirm('将所有偏好恢复为系统默认值？')) return
  themeKey.value = 'default'
  customColor.value = ''
  Object.assign(customColors, DEFAULT_CUSTOM_COLORS)
  fontSize.value = 'standard'
  iconStyle.value = 'linear'
  floorStyle.value = 'wireframe'
  toggles.value.forEach((t) => { t.on = t.id !== 'micro' }) // 默认 transition/glow 开、micro 关
  wakeWord.value = '你好， Lumina'
  applyTheme('default', '')
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try {
    await persistPrefs()
    flash('已重置为默认')
  } catch (e) {
    flash(e.message, true)
  }
}

// ===== 版本信息：__APP_VERSION__ 由 vite 构建时从 package.json 注入 =====
const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
const backendVersion = ref(null) // null=获取中；''=获取失败
const versionMismatch = computed(() => !!backendVersion.value && backendVersion.value !== appVersion)
async function loadVersion() {
  try {
    const h = await api.health()
    backendVersion.value = h.version || '未知'
  } catch {
    backendVersion.value = ''
  }
}

// 安卓 App 安装包：服务端随 Docker 镜像发布 APK 时展示下载入口（下载需登录）
const apkAvailable = ref(false)
const apkChecked = ref(false)
const apkSaving = ref(false)
// APK 应用内更新：服务端版本高于本机版本时提示，一键下载并拉起系统安装器
// （isApk 已从 serverConfig 导入；canInAppUpdate 区分旧 APK 无原生下载能力的情形）
const canInAppUpdate = !!window.StickyKeeNative?.downloadAndInstallApk
const apkUpdateAvailable = ref(false)
const apkUpdating = ref(false)
const apkProgress = ref(0)
let apkReq = ''
// 版本比较：>0 表示 b 比 a 新（逐段数值比较，如 1.0.10 > 1.0.9）
function cmpVer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n) || 0)
  const pb = String(b || '').split('.').map((n) => parseInt(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0)
    if (d) return d
  }
  return 0
}
function onApkEvent(e) {
  const d = e?.detail || {}
  if (d.req !== apkReq) return
  if (d.phase === 'progress') { apkProgress.value = d.pct || 0; return }
  if (d.phase === 'done') {
    apkUpdating.value = false
    apkProgress.value = 100
    flash('下载完成，请在弹出的界面确认安装', false)
    return
  }
  if (d.phase === 'error') {
    apkUpdating.value = false
    flash(d.message || '更新下载失败', true)
  }
}
// 立即更新：经原生桥下载（带进度）→ 完成后原生自动拉起系统安装器
function updateApk() {
  if (apkUpdating.value) return
  apkUpdating.value = true
  apkProgress.value = 0
  apkReq = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  try {
    window.StickyKeeNative.downloadAndInstallApk(
      location.origin + '/api/v1/app/download', getToken() || '', apkReq)
  } catch {
    apkUpdating.value = false
    flash('更新失败：原生下载不可用', true)
  }
}
// 通知权限状态：未开启时在关于区醒目提示（null=检测中/不可用）
const notifOn = ref(null)
function refreshNotif() {
  try { notifOn.value = !!window.StickyKeeNative?.notifEnabled?.() } catch { notifOn.value = null }
}
// 申请通知权限：首次弹系统框；被永久拒绝后原生会自动跳应用详情 → 回来时重查状态
function askNotifPerm() {
  try { window.StickyKeeNative?.requestNotifPermission?.() } catch { /* 忽略 */ }
  setTimeout(refreshNotif, 1200)
}
// 开机自启动引导：MIUI 等需在应用详情手动开启
function goAppDetails() {
  try { window.StickyKeeNative?.openAppDetails?.() } catch { /* 忽略 */ }
}
const onVisNotif = () => { if (document.visibilityState === 'visible') refreshNotif() }
async function loadAppInfo() {
  try {
    const { data } = await api.appInfo()
    apkAvailable.value = !!data?.apkAvailable
    // APK 环境下比较服务端版本与本机 APK 版本：服务端更高即提示更新。
    // 注意 WebView 加载的是服务器网页，appVersion（网页版本）恒等于服务端版本，
    // 必须用原生 getAppVersion()（build.gradle 的 versionName）才是真实 APK 版本。
    if (isApk && data?.apkAvailable && data?.version) {
      const nativeVer = window.StickyKeeNative?.getAppVersion?.() || appVersion
      apkUpdateAvailable.value = cmpVer(nativeVer, data.version) > 0
    }
  } catch { /* 服务端旧版本无此接口：保持未提供 */ }
  apkChecked.value = true
}
// 下载安装包：浏览器导航无法携带鉴权头，经 fetch 取流后再触发本地保存
async function downloadApk() {
  if (apkSaving.value) return
  apkSaving.value = true
  try {
    const { blob } = await api.appDownload()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'StickyKee-' + (backendVersion.value || '') + '.apk'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } catch (e) {
    flash(e.message || '下载失败', true)
  } finally {
    apkSaving.value = false
  }
}

// ===== 通话铃声（仅 APK）：经原生铃声选择器选择来电铃声/彩铃，存 localStorage 与 call.js 共用 =====
const canPickRing = !!window.StickyKeeNative?.pickRingtone
const RING_KEYS = { call: 'sk_call_ringtone', back: 'sk_back_ringtone' }
const ringNames = reactive({ call: '', back: '' })
function loadRingNames() {
  for (const k of ['call', 'back']) {
    try {
      const v = JSON.parse(localStorage.getItem(RING_KEYS[k]) || 'null')
      ringNames[k] = v?.name || (v?.uri ? '自定义铃声' : '')
    } catch { ringNames[k] = '' }
  }
}
function pickRing(kind) {
  let cur = ''
  try { cur = JSON.parse(localStorage.getItem(RING_KEYS[kind]) || 'null')?.uri || '' } catch { /* 忽略 */ }
  window.StickyKeeNative.pickRingtone(kind, cur)
}
function resetRing(kind) {
  localStorage.removeItem(RING_KEYS[kind])
  loadRingNames()
}
// 选择器结果（原生桥派发 stickykee-ring {kind,ok,uri,name}）：ok=false 为用户取消
function onRingPicked(e) {
  const d = e.detail || {}
  if (!d.ok || !RING_KEYS[d.kind]) return
  localStorage.setItem(RING_KEYS[d.kind], JSON.stringify({ uri: d.uri || '', name: d.name || (d.uri ? '自定义铃声' : '静音') }))
  loadRingNames()
}

onMounted(() => {
  loadVersion()
  loadAppInfo()
  loadPrefs(); loadDevices(); loadSensors(); loadUsers()
  if (canPickRing) { loadRingNames(); window.addEventListener('stickykee-ring', onRingPicked) }
  if (isApk) window.addEventListener('stickykee-apk', onApkEvent) // 应用内更新进度
  if (canInAppUpdate) { refreshNotif(); document.addEventListener('visibilitychange', onVisNotif) } // 通知权限状态（从详情页回来刷新）
  loadSiteName().then(() => { siteNameDraft.value = siteName.value }) // 同步后端权威值
  stopLightWatch = watchAmbientLight() // 面板打开期间持续读环境光，用于「实时值」显示
})
onUnmounted(() => {
  if (stopMonitor) { stopMonitor(); stopMonitor = null }
  if (stopLightWatch) { stopLightWatch(); stopLightWatch = null }
  if (canPickRing) window.removeEventListener('stickykee-ring', onRingPicked)
  if (isApk) window.removeEventListener('stickykee-apk', onApkEvent)
  if (canInAppUpdate) document.removeEventListener('visibilitychange', onVisNotif)
})
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
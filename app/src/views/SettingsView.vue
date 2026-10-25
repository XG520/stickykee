<template>
  <div class="space-y-4 sm:space-y-6 pb-4">
    <!-- 页面标题只保留给屏读器（可见标题行占的垂直空间已省掉） -->
    <h1 class="sr-only">个性化设置</h1>

    <!-- 顶部导航（重置按钮收纳在「个性化」页底部）：
         手机端单行横向滚动，避免 7 个标签折成 3 行吃掉首屏空间；桌面端仍自动换行。 -->
    <div class="flex flex-wrap items-center gap-2">
      <nav class="hc-nav-scroll flex sm:flex-wrap gap-1.5 p-1.5 w-full sm:w-fit rounded-2xl bg-surface-alt/90 backdrop-blur-xl border border-border shadow-sm">
        <button v-for="t in tabs.filter((x) => x.key !== 'diag' || auth.isAdmin)" :key="t.key" @click="activeTab = t.key"
          class="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 transition-all duration-200 active:scale-95"
          :class="activeTab === t.key
            ? 'bg-primary text-on-primary shadow-md shadow-primary/25'
            : 'text-muted hover:text-on-surface hover:bg-surface'">
          <span class="material-symbols-outlined text-base leading-none">{{ t.icon }}</span>
          {{ t.label }}
        </button>
      </nav>
    </div>

    <!-- 锚点导航：吸顶横向滚动，点击跳转到对应区块（随当前标签页切换锚点列表） -->
    <nav v-if="anchors[activeTab]" class="sticky top-14 z-30 py-2 -mx-1 px-1 overflow-x-auto hc-hide-bar">
      <div class="flex items-center gap-1.5 w-fit">
        <button v-for="a in anchors[activeTab]" :key="a.id" @click="scrollToSection(a.id)"
          class="whitespace-nowrap shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-surface-alt/70 text-muted hover:text-on-surface hover:border-primary/40 transition-colors">
          {{ a.label }}
        </button>
      </div>
    </nav>

    <!-- ===== 连接与设备 ===== -->
    <div v-show="activeTab === 'connect'" class="space-y-4 sm:space-y-6">
    <!-- 我的 HA Token：地址管理员全局配置，密钥属个人（所有用户可见，可自配或管理员代配） -->
    <section id="sec-ha-token" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
      <div class="flex flex-col sm:flex-row gap-2">
        <input v-model="myToken" type="password" autocomplete="new-password" placeholder="粘贴你的 Long-Lived Token（配置后即可访问实体）"
          class="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button @click="saveMyToken" :disabled="savingToken"
          class="w-full sm:w-auto justify-center px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all disabled:opacity-70 flex items-center gap-1.5">
          <span v-if="savingToken" class="hc-spinner"></span>
          {{ savingToken ? '保存中…' : '保存' }}
        </button>
      </div>
      <p v-if="tokMsg" class="mt-2 text-xs font-body" :class="tokMsgErr ? 'text-error' : 'text-success'">{{ tokMsg }}</p>
    </section>

    <!-- 服务器地址（APK 壳页地址簿同步显示） -->
    <section id="sec-server" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section v-if="canPickRing" id="sec-ring" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section v-if="auth.isAdmin" id="sec-ha-conn" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section id="sec-map" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section id="sec-devices" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section id="sec-sensors" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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

      <!-- 上报间隔：前台为周期 timer；APK 退后台由保活服务原生心跳按同间隔接管 -->
      <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-background border border-border mb-1">
        <div class="min-w-0">
          <p class="text-on-surface text-xs font-semibold">上报间隔</p>
          <p class="text-muted text-xs mt-0.5 leading-relaxed">App 退后台后由常驻服务按此间隔唤醒上报，被杀后自动恢复</p>
        </div>
        <UiSelect :model-value="sensorInterval" :options="INTERVALS" class="shrink-0" @change="changeInterval" />
      </div>

      <!-- 后台定位授权（原生采集模式）：授予「始终允许」后 geocoded_location 才能退后台刷新 -->
      <div v-if="isNativeSensorMode()" class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-background border border-border mb-1">
        <div class="min-w-0">
          <p class="text-on-surface text-xs font-semibold">后台定位权限</p>
          <p class="text-muted text-xs mt-0.5 leading-relaxed">在系统设置中选「始终允许」，退后台才能刷新位置类传感器</p>
        </div>
        <button @click="askBgLocation"
          class="shrink-0 px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-all duration-200 active:scale-95">
          去开启
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
    <section id="sec-browser" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <div v-show="activeTab === 'personal'" class="space-y-4 sm:space-y-6">
    <!-- 主题风格 -->
    <section id="sec-theme" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-muted text-sm">自定义颜色</span>
          <input type="color" v-model="customColor" class="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent">
          <input type="text" v-model="customColor" class="flex-1 min-w-24 bg-background border border-border rounded-lg px-3 py-1.5 text-on-surface text-sm font-mono focus:border-primary focus:outline-none transition-colors">
          <button v-if="customColor" @click="customColor = ''" class="px-3 py-1.5 rounded-lg bg-surface border border-border text-muted hover:text-on-surface text-sm transition-colors">恢复默认色</button>
        </div>
      </div>
    </section>

    <!-- 字体大小 -->
    <section id="sec-font" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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

    <!-- 仪表盘列数 -->
    <section id="sec-cols" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-accent text-lg">grid_view</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">仪表盘列数</h2>
          <p class="text-muted text-xs mt-0.5">首页卡片每行显示的列数，仅对本设备生效</p>
        </div>
      </div>
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <button
          v-for="o in dashColOptions"
          :key="o.key"
          @click="dashCols = o.key"
          class="flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 bg-surface hover:bg-surface-hover transition-all duration-200"
          :class="dashCols === o.key ? 'border-primary bg-primary/10' : 'border-transparent'"
        >
          <span
            class="grid gap-0.5"
            :style="{ gridTemplateColumns: `repeat(${o.key === 'auto' ? 3 : parseInt(o.key, 10)}, 1fr)`, width: '18px' }"
          >
            <span v-for="i in (o.key === 'auto' ? 3 : parseInt(o.key, 10))" :key="i" class="w-1 h-1 rounded-[1px]" :class="dashCols === o.key ? 'bg-primary' : 'bg-muted/40'"></span>
          </span>
          <span class="text-sm font-medium" :class="dashCols === o.key ? 'text-primary' : 'text-on-surface'">{{ o.name }}</span>
          <span class="text-muted text-xs">{{ o.note }}</span>
        </button>
      </div>
      <p class="text-muted text-xs mt-3">自动：手机固定 3 列（跨机型一致），平板/桌面按屏幕宽度自适应；手动指定后所有屏幕都按所选列数显示</p>
    </section>

    <!-- 图标风格 -->
    <section id="sec-icon-style" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
      <div class="flex items-center gap-2.5 mb-4">
        <div class="w-8 h-8 rounded-xl bg-info/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-info text-lg">dashboard</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">图标风格</h2>
          <p class="text-muted text-xs mt-0.5">选择你偏好的图标呈现方式</p>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
    <section id="sec-floorplan" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section id="sec-animation" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section id="sec-voice" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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

    <!-- ===== AI ===== -->
    <div v-show="activeTab === 'ai'" class="space-y-4 sm:space-y-6">
      <section id="sec-ai" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
        <div class="flex items-center gap-2.5 mb-4">
          <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-accent text-lg">auto_awesome</span>
          </div>
          <div class="min-w-0">
            <h2 class="font-headline text-on-background text-base font-semibold">AI 设置</h2>
            <p class="text-muted text-xs mt-0.5">OpenAI 兼容协议 · 用于卡片工作室 AI 生成</p>
          </div>
          <span class="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium" :class="aiBadge.cls">{{ aiBadge.text }}</span>
        </div>

        <!-- 管理员可在「我的配置」与「全局默认」之间切换；普通用户只有本人配置 -->
        <div v-if="auth.isAdmin" class="flex gap-1 p-1 rounded-xl bg-surface border border-border mb-4 w-fit">
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            :class="aiScope === 'user' ? 'bg-primary text-on-primary' : 'text-muted hover:text-on-surface'"
            @click="aiScope = 'user'"
          >我的配置</button>
          <button
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            :class="aiScope === 'global' ? 'bg-primary text-on-primary' : 'text-muted hover:text-on-surface'"
            @click="aiScope = 'global'"
          >全局默认</button>
        </div>

        <p class="text-muted text-xs mb-4 leading-relaxed">
          <template v-if="aiScope === 'global'">全局配置作为所有未单独配置用户的兜底；每个用户仍可在「设置 → AI」填写自己的 URL / Key 并优先使用。</template>
          <template v-else>不填写 Key 时会自动使用管理员配置的全局 AI。API Key 只保存在服务端，不会回传浏览器。</template>
        </p>

        <div class="space-y-3">
          <div>
            <label class="text-on-surface text-sm font-medium mb-2 block">API 地址（Base URL）</label>
            <input v-model="aiFields.base_url" type="text" class="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-on-surface text-sm focus:border-primary focus:outline-none transition-colors" placeholder="https://api.openai.com/v1">
            <p class="text-muted text-xs mt-1">兼容 OpenAI 协议的地址，例如 https://api.openai.com/v1、https://api.deepseek.com/v1</p>
          </div>
          <div>
            <label class="text-on-surface text-sm font-medium mb-2 block">模型</label>
            <input v-model="aiFields.model" type="text" class="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-on-surface text-sm focus:border-primary focus:outline-none transition-colors" placeholder="gpt-4o-mini">
          </div>
          <div>
            <label class="text-on-surface text-sm font-medium mb-2 block">API Key</label>
            <input v-model="aiFields.api_key" type="password" autocomplete="new-password" class="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-on-surface text-sm focus:border-primary focus:outline-none transition-colors" :placeholder="aiFields.has_key ? '已配置，留空表示不修改' : 'sk-...'">
          </div>
          <label v-if="aiFields.has_key" class="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" v-model="aiFields.clear_key" class="accent-primary" />
            清除已保存的 Key
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-2 mt-4">
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium transition-all active:scale-95 disabled:opacity-50"
            :disabled="aiSaving"
            @click="saveAi"
          >
            <span class="material-symbols-outlined text-base">{{ aiSaving ? 'progress_activity' : 'save' }}</span>{{ aiSaving ? '保存中…' : '保存' }}
          </button>
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface border border-border text-on-surface text-sm font-medium hover:bg-surface-hover transition-colors disabled:opacity-50"
            :disabled="aiTesting || !aiEffective.has_key"
            @click="testAi"
          >
            <span class="material-symbols-outlined text-base">{{ aiTesting ? 'progress_activity' : 'network_check' }}</span>{{ aiTesting ? '测试中…' : '测试连接' }}
          </button>
          <span v-if="aiMsg" class="text-xs" :class="aiMsgErr ? 'text-error' : 'text-success'">{{ aiMsg }}</span>
        </div>

        <p class="text-muted text-xs mt-3 leading-relaxed">
          当前生效：
          <span class="text-on-surface">{{ aiSourceText }}</span>
          <template v-if="aiEffective.model"> · {{ aiEffective.model }}</template>
          <template v-if="aiEffective.base_url"> · {{ aiEffective.base_url }}</template>
        </p>
      </section>
    </div>

    <!-- ===== AI 诊断 ===== -->
    <div v-show="activeTab === 'diag'" class="space-y-4 sm:space-y-6">
      <section id="sec-diag" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
        <div class="flex items-center gap-2.5 mb-4">
          <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-accent text-lg">monitor_heart</span>
          </div>
          <div class="min-w-0">
            <h2 class="font-headline text-on-background text-base font-semibold">AI 诊断</h2>
            <p class="text-muted text-xs mt-0.5">收集前后端日志，由 AI 生成可下载的诊断报告</p>
          </div>
          <span class="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium" :class="diagBadge.cls">{{ diagBadge.text }}</span>
        </div>

        <p class="text-muted text-xs mb-4 leading-relaxed">
          功能默认关闭。开启后服务器与当前浏览器会收集日志，到达时长后自动调用「设置 → AI」配置的模型生成报告。
          诊断期间保持本页面打开可采集到更完整的前端日志；仅管理员可用。
        </p>
        <p class="text-muted text-xs mb-4 leading-relaxed">
          隐私保护：提交给 AI 前会自动屏蔽账号、用户名、邮箱、电话、IP/MAC、Token、密码与 Key（显示为 ***），
          完整设备信息仅保留浏览器/系统类型。
        </p>

        <!-- 未开启：选择时长后开始 -->
        <template v-if="!diagActive">
          <label class="text-on-surface text-sm font-medium mb-2 block">诊断时长</label>
          <div class="flex flex-wrap gap-2 mb-4">
            <button
              v-for="m in DIAG_DURATIONS"
              :key="m"
              class="px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors"
              :class="diagDuration === m ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border text-muted hover:text-on-surface'"
              @click="diagDuration = m"
            >{{ m }} 分钟</button>
          </div>
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium transition-all active:scale-95 disabled:opacity-50"
            :disabled="diagBusy || !aiEffective.has_key"
            @click="startDiag"
          >
            <span class="material-symbols-outlined text-base">{{ diagBusy ? 'progress_activity' : 'play_arrow' }}</span>
            {{ diagBusy ? '启动中…' : '开始诊断' }}
          </button>
          <p v-if="!aiEffective.has_key" class="mt-2 text-xs text-warning leading-relaxed">请先在「AI」页配置 API Key，否则诊断结束后无法生成报告。</p>
          <p v-if="diagMsg" class="mt-3 text-xs" :class="diagMsgErr ? 'text-error' : 'text-success'">{{ diagMsg }}</p>
        </template>

        <!-- 进行中 / 已完成：进度、实时日志、报告 -->
        <template v-else>
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm text-on-surface font-medium">{{ diagPhaseText }}</p>
              <p class="text-xs text-muted mt-0.5">{{ diagCountdown }}</p>
            </div>
            <p class="text-xs text-muted text-right leading-relaxed">
              已收集 {{ diagStatus.collected }} 条<br />浏览器 {{ diagStatus.client_count }} 条
            </p>
          </div>
          <div class="h-2 rounded-full bg-surface overflow-hidden mt-3">
            <div class="h-full bg-primary transition-all duration-500" :style="{ width: diagStatus.progress + '%' }"></div>
          </div>

          <div class="flex flex-wrap gap-2 mt-3">
            <button
              v-if="diagStatus.status === 'collecting'"
              class="px-3 py-1.5 rounded-xl bg-surface border border-border text-on-surface text-xs font-medium hover:bg-surface-hover transition-colors"
              @click="stopDiag"
            >停止并生成报告</button>
            <button
              v-if="diagReportText"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-on-primary text-xs font-medium transition-colors"
              @click="downloadDiagReport"
            >
              <span class="material-symbols-outlined text-sm">download</span>下载报告
            </button>
            <button
              v-if="diagStatus.status === 'done' || diagStatus.status === 'failed'"
              class="px-3 py-1.5 rounded-xl bg-surface border border-border text-on-surface text-xs font-medium hover:bg-surface-hover transition-colors"
              @click="resetDiag"
            >重新诊断</button>
          </div>
          <p v-if="diagMsg" class="mt-2 text-xs" :class="diagMsgErr ? 'text-error' : 'text-success'">{{ diagMsg }}</p>
          <p v-if="diagStatus.error" class="mt-2 text-xs text-error leading-relaxed">{{ diagStatus.error }}</p>

          <!-- 实时日志：让诊断过程可见 -->
          <div class="mt-4">
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-on-surface text-xs font-medium">诊断日志（实时）</label>
              <span class="text-muted text-xs">{{ diagLogs.length }} 条</span>
            </div>
            <div ref="diagLogEl" class="diag-logs">
              <div v-for="e in diagLogs" :key="e.seq" class="diag-row">
                <span class="diag-time">{{ e.time }}</span>
                <span class="diag-lvl" :class="'lv-' + e.level.toLowerCase()">{{ e.level }}</span>
                <span class="diag-src">{{ e.source }}</span>
                <span class="diag-msg">{{ e.msg }}</span>
              </div>
              <p v-if="!diagLogs.length" class="diag-empty">等待日志…</p>
            </div>
          </div>

          <div v-if="diagStatus.status === 'analyzing'" class="flex items-center gap-2 mt-4 text-xs text-accent">
            <span class="hc-spinner hc-spinner-accent"></span>
            AI 正在分析日志并生成诊断报告，通常需要几十秒…
          </div>

          <div v-if="diagReportText" class="mt-4">
            <label class="text-on-surface text-xs font-medium mb-1.5 block">诊断报告预览</label>
            <pre class="diag-report-pre">{{ diagReportText }}</pre>
          </div>
        </template>
      </section>
    </div>

    <!-- ===== 运行日志 ===== -->
    <div v-show="activeTab === 'logs'" class="space-y-4 sm:space-y-6">
      <section id="sec-logs" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
        <div class="flex items-center gap-2.5 mb-4">
          <div class="w-8 h-8 rounded-xl bg-info/20 flex items-center justify-center">
            <span class="material-symbols-outlined text-info text-lg">receipt_long</span>
          </div>
          <div class="min-w-0">
            <h2 class="font-headline text-on-background text-base font-semibold">运行日志</h2>
            <p class="text-muted text-xs mt-0.5">按级别与来源分类，保留 {{ logRetentionDays }} 天，可筛选后交给 AI 分析</p>
          </div>
          <span class="ml-auto flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-muted">保留 {{ logRetentionDays }} 天</span>
        </div>

        <p class="text-muted text-xs mb-4 leading-relaxed">
          服务端日志、HTTP 失败/慢请求与浏览器日志统一入库。超过 {{ logRetentionDays }} 天的日志由后台每小时自动清理。
          提交 AI 前会自动屏蔽账号、邮箱、电话、IP/MAC、Token、密码等信息（显示为 ***）。
        </p>

        <!-- 级别筛选 -->
        <label class="text-on-surface text-xs font-medium mb-2 block">日志级别 <span class="text-muted font-normal">（不选=全部）</span></label>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="lv in LOG_LEVELS"
            :key="lv"
            class="px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors"
            :class="logLevels.includes(lv) ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border text-muted hover:text-on-surface'"
            @click="toggleLogLevel(lv)"
          >{{ lv }}</button>
        </div>

        <!-- 来源筛选 -->
        <label class="text-on-surface text-xs font-medium mb-2 block">日志来源 <span class="text-muted font-normal">（不选=全部）</span></label>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="s in LOG_SOURCES"
            :key="s.key"
            class="px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors"
            :class="logSources.includes(s.key) ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border text-muted hover:text-on-surface'"
            @click="toggleLogSource(s.key)"
          >{{ s.label }}</button>
        </div>

        <!-- 时间段 -->
        <label class="text-on-surface text-xs font-medium mb-2 block">时间段</label>
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            v-for="r in LOG_RANGES"
            :key="r.key"
            class="px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors"
            :class="logRange === r.key ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border text-muted hover:text-on-surface'"
            @click="logRange = r.key"
          >{{ r.label }}</button>
        </div>
        <div v-if="logRange === 'custom'" class="flex flex-wrap items-center gap-2 mb-3">
          <input v-model="logFrom" type="datetime-local"
            class="bg-background border border-border rounded-xl px-3 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none" />
          <span class="text-muted text-xs">至</span>
          <input v-model="logTo" type="datetime-local"
            class="bg-background border border-border rounded-xl px-3 py-1.5 text-xs text-on-surface focus:border-primary focus:outline-none" />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-surface border border-border text-on-surface text-sm font-medium transition-colors hover:bg-surface-hover disabled:opacity-50"
            :disabled="logLoading"
            @click="loadLogs"
          >
            <span class="material-symbols-outlined text-base">{{ logLoading ? 'progress_activity' : 'search' }}</span>
            {{ logLoading ? '查询中…' : '查询' }}
          </button>
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium transition-all active:scale-95 disabled:opacity-50"
            :disabled="logAnalysis.status === 'running' || !aiEffective.has_key"
            @click="analyzeLogs"
          >
            <span class="material-symbols-outlined text-base">{{ logAnalysis.status === 'running' ? 'progress_activity' : 'auto_awesome' }}</span>
            {{ logAnalysis.status === 'running' ? '分析中…' : 'AI 分析所选日志' }}
          </button>
        </div>
        <p v-if="!aiEffective.has_key" class="mt-2 text-xs text-warning leading-relaxed">请先在「AI」页配置 API Key，否则无法进行日志分析。</p>
        <p v-if="logMsg" class="mt-2 text-xs" :class="logMsgErr ? 'text-error' : 'text-success'">{{ logMsg }}</p>

        <!-- AI 分析结果 -->
        <div v-if="logAnalysis.status === 'running'" class="flex items-center gap-2 mt-4 text-xs text-accent">
          <span class="hc-spinner hc-spinner-accent"></span>
          正在分析 {{ logAnalysis.collected }} 条日志，通常需要几十秒…
        </div>
        <p v-if="logAnalysis.error" class="mt-3 text-xs text-error leading-relaxed">{{ logAnalysis.error }}</p>
        <div v-if="logReport" class="mt-4">
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-on-surface text-xs font-medium">分析报告</label>
            <button
              class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-medium"
              @click="downloadLogReport"
            >
              <span class="material-symbols-outlined text-sm">download</span>下载
            </button>
          </div>
          <pre class="diag-report-pre">{{ logReport }}</pre>
        </div>

        <!-- 日志列表 -->
        <div class="mt-5">
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-on-surface text-xs font-medium">日志列表</label>
            <span class="text-muted text-xs">共 {{ logTotal }} 条 · 显示最近 {{ logRows.length }} 条</span>
          </div>
          <div class="diag-logs log-list">
            <div v-for="e in logRows" :key="e.id" class="diag-row">
              <span class="diag-time">{{ e.time }}</span>
              <span class="diag-lvl" :class="'lv-' + e.level.toLowerCase()">{{ e.level }}</span>
              <span class="diag-src">{{ e.source }}</span>
              <span class="diag-msg">{{ e.msg }}</span>
            </div>
            <p v-if="!logRows.length" class="diag-empty">该条件下暂无日志</p>
          </div>
        </div>
      </section>
    </div>

    <!-- ===== 账户 ===== -->
    <div v-show="activeTab === 'account'" class="space-y-4 sm:space-y-6">
    <!-- 账号与安全 -->
    <section id="sec-account" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
    <section id="sec-sysinfo" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">info</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">系统信息</h2>
          <p class="text-muted text-xs mt-0.5">前后端版本号，用于确认部署是否已更新</p>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
        <!-- 消息免打扰：仅静音消息通知（仍显示在通知栏），来电提醒不受影响；本机生效。
             三列窄卡内不放「文本列+固定宽开关」横排（会把文本挤成单字竖排）：
             标题与开关一行（放不下时开关 flex-wrap 换行），描述独占整卡宽度正常换行 -->
        <div v-if="canInAppUpdate" class="rounded-xl bg-background border border-border px-3 py-2.5">
          <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p class="text-muted text-xs">消息免打扰</p>
            <button @click="imDnd = !imDnd"
              class="relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0"
              :class="imDnd ? 'bg-primary' : 'bg-muted/40'"
              :aria-label="imDnd ? '关闭消息免打扰' : '开启消息免打扰'">
              <span class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                :class="imDnd ? 'left-[22px]' : 'left-0.5'"></span>
            </button>
          </div>
          <p class="text-muted text-[11px] mt-1">开启后新消息通知不响铃不震动（仍显示在通知栏），来电提醒不受影响；仅对本手机生效</p>
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

    </section>
    </div>

    <!-- ===== 用户管理（仅管理员） ===== -->
    <div v-if="auth.isAdmin" v-show="activeTab === 'users'" class="space-y-4 sm:space-y-6">
    <!-- 系统名称（全局）：改后所有用户的顶栏/登录页/浏览器标题同步更新 -->
    <section id="sec-sysname" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-primary text-lg">badge</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">系统名称</h2>
          <p class="text-muted text-xs mt-0.5">顶栏、登录页与浏览器标签标题显示的名字</p>
        </div>
      </div>
      <div class="flex flex-col sm:flex-row gap-2">
        <input v-model="siteNameDraft" maxlength="20" placeholder="中文名称，例如：糯米"
          class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <input v-model="siteNameEnDraft" maxlength="40" placeholder="英文名称，例如：Sticky Kee"
          class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button @click="saveSiteName" :disabled="siteNameSaving"
          class="w-full sm:w-auto justify-center px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-base">save</span> 保存
        </button>
      </div>
      <div class="flex flex-col sm:flex-row gap-2 mt-2">
        <input v-model="serverDeviceNameDraft" maxlength="40" placeholder="HA 设备名（留空 = 英文名 + Server）"
          class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
        <button @click="saveServerDeviceName" :disabled="serverDeviceNameSaving"
          class="w-full sm:w-auto justify-center px-4 py-2 rounded-xl bg-surface border border-border hover:border-primary text-on-surface text-sm font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-base">dns</span> 同步到 HA
        </button>
      </div>
      <p class="text-faint text-xs mt-2">服务器注册到 Home Assistant 的虚拟设备显示名（生日传感器等实体挂在其下），保存后立即同步</p>
      <p v-if="siteNameMsg" class="mt-2 text-xs font-body" :class="siteNameErr ? 'text-error' : 'text-success'">{{ siteNameMsg }}</p>
    </section>
    <!-- 系统图标（全局）：Material Symbol 名，改后顶栏/登录页同步更新 -->
    <section id="sec-sysicon" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28 mt-4">
      <div class="flex items-center gap-2.5 mb-3">
        <div class="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center">
          <span class="material-symbols-outlined text-accent text-lg">palette</span>
        </div>
        <div>
          <h2 class="font-headline text-on-background text-base font-semibold">系统图标</h2>
          <p class="text-muted text-xs mt-0.5">顶栏、登录页显示的图标（Material Symbol 名称）</p>
        </div>
      </div>
      <!-- 手机端：预览 + 输入框 + 保存（图标钮）压在同一行；桌面端恢复完整「保存」按钮 -->
      <div class="flex gap-2 sm:gap-3 items-center">
        <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-primary flex items-center justify-center shadow shrink-0" title="预览">
          <SiteIcon :span-class="'text-on-primary text-lg sm:text-xl'" :img-class="'w-6 h-6 object-contain'" v-if="siteIconImg" />
          <span v-else class="material-symbols-outlined text-on-primary text-lg sm:text-xl">{{ siteIconDraft || 'bolt' }}</span>
        </div>
        <input v-model="siteIconDraft" maxlength="40" placeholder="例如：bolt" @input="siteIconDraft = siteIconDraft.toLowerCase()"
          class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors font-mono">
        <button @click="saveSiteIcon" :disabled="siteIconSaving"
          class="shrink-0 w-10 h-10 sm:w-auto sm:h-auto sm:px-4 sm:py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
          :title="`保存图标 ${siteIconDraft || ''}`">
          <span class="material-symbols-outlined text-base">save</span>
          <span class="hidden sm:inline">保存</span>
        </button>
      </div>
      <!-- 自定义图标：上传图片（与 Material 图标互斥，上传后立即生效；选 Material 保存自动恢复）。
           手机端按钮与说明竖排，避免长说明挤压按钮导致换行错位。 -->
      <div class="mt-3 flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
        <button @click="iconFileEl?.click()" :disabled="siteIconSaving"
          class="px-3.5 py-2 rounded-xl bg-background border border-border text-on-surface text-sm hover:border-primary transition-colors disabled:opacity-50 flex items-center gap-1.5">
          <span class="material-symbols-outlined text-base">upload</span> 上传自定义图标
        </button>
        <span class="text-muted text-xs leading-relaxed">PNG/SVG/WebP ≤256KB{{ siteIconImg ? '；当前为自定义图片，选择 Material 图标保存后恢复' : '' }}</span>
        <input ref="iconFileEl" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" class="hidden" @change="onIconFile">
      </div>
      <!-- 常用图标快捷按钮：手机端 40px 触控目标（8 列排布），桌面端紧凑 36px -->
      <div class="mt-3">
        <div class="text-muted text-xs mb-1.5">常用图标</div>
        <div class="grid grid-cols-8 gap-2 sm:flex sm:flex-wrap">
          <button v-for="s in SITE_ICON_SUGGESTIONS" :key="s" @click="siteIconDraft = s"
            class="w-full aspect-square sm:w-9 sm:h-9 rounded-lg bg-background border border-border flex items-center justify-center hover:border-primary hover:bg-primary/10 transition-colors"
            :title="s">
            <span class="material-symbols-outlined text-on-surface text-base">{{ s }}</span>
          </button>
        </div>
      </div>
      <p v-if="siteIconMsg" class="mt-2 text-xs font-body" :class="siteIconErr ? 'text-error' : 'text-success'">{{ siteIconMsg }}</p>
    </section>
    <section id="sec-users" class="bg-surface-alt border border-border rounded-2xl p-4 sm:p-5 scroll-mt-28">
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
          <div v-if="u._editHA" class="flex flex-col sm:flex-row gap-2 w-full max-w-md">
            <input v-model="u._haToken" type="password" autocomplete="new-password"
              :placeholder="u.has_ha_token ? '输入新 Token 覆盖；留空则清除并禁用' : '粘贴该用户的 Long-Lived Token'"
              class="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">
            <button type="button" @click="setUserHAToken(u)"
              class="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">保存</button>
          </div>

          <!-- 账号生日（管理员代设；保存后服务端同步该账号 HA 生日传感器） -->
          <button type="button" @click="openUserBirthdays(u)"
            class="px-2.5 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface transition-colors flex items-center gap-1">
            <span class="material-symbols-outlined text-sm">cake</span> 生日
          </button>

          <button @click="removeUser(u)" :disabled="u.username === auth.user"
            class="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors disabled:opacity-40 disabled:pointer-events-none">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
        <p v-if="!users.length" class="text-muted text-sm font-body">暂无其他用户。首个注册用户为管理员，其余用户需在此创建。</p>
      </div>
    </section>

    <!-- 管理员代设账号生日弹窗（body 层浮层） -->
    <Teleport to="body">
      <div v-if="bdUser" class="fixed inset-0 z-[2000] bg-background/55 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="bdUser = null">
        <div class="w-full max-w-md rounded-2xl bg-surface border border-border shadow-2xl p-4" @click.stop>
          <div class="flex items-center gap-2 mb-3">
            <span class="material-symbols-outlined text-primary text-xl">cake</span>
            <span class="text-on-surface font-semibold text-sm">「{{ bdUser }}」的生日</span>
            <button type="button" class="ml-auto text-muted hover:text-on-surface" @click="bdUser = null">
              <span class="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <div class="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            <div v-for="(it, i) in bdList" :key="i" class="flex items-center gap-2 rounded-xl bg-background border border-border p-2">
              <input v-model.trim="it.name" maxlength="12" placeholder="称呼"
                class="w-20 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none" />
              <div class="flex rounded-md overflow-hidden border border-border text-xs flex-none">
                <button type="button" class="px-2 py-1.5 font-semibold" :class="it.calendar === 'solar' ? 'bg-primary text-on-primary' : 'text-muted bg-surface'"
                  @click="it.calendar = 'solar'">公</button>
                <button type="button" class="px-2 py-1.5 font-semibold" :class="it.calendar === 'lunar' ? 'bg-primary text-on-primary' : 'text-muted bg-surface'"
                  @click="it.calendar = 'lunar'; clampBdDay(it)">农</button>
              </div>
              <UiSelect v-model="it.month" class="flex-1 min-w-0" :options="bdMonthOptions" @change="clampBdDay(it)" />
              <UiSelect v-model="it.day" class="flex-1 min-w-0" :options="bdDayOptions(it)" />
              <button type="button" class="p-1 rounded-lg text-muted hover:text-error hover:bg-error/10 flex-none" @click="bdList.splice(i, 1)">
                <span class="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
            <p v-if="!bdList.length" class="text-muted text-xs text-center py-3">暂无生日，点击下方添加。</p>
          </div>
          <div class="flex items-center gap-2 mt-3">
            <button type="button" @click="addUserBirthday"
              class="px-2.5 py-1.5 rounded-lg bg-surface-hover hover:bg-surface border border-border text-xs text-on-surface flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">add</span> 添加
            </button>
            <span class="flex-1"></span>
            <button type="button" @click="saveUserBirthdays" :disabled="bdSaving"
              class="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold disabled:opacity-50">
              {{ bdSaving ? '保存中…' : '保存' }}
            </button>
          </div>
          <p class="text-muted text-xs mt-2">保存后自动同步为该账号在 HA 中的 Birthday 传感器实体（每账号一个，全部设备共用）。</p>
        </div>
      </div>
    </Teleport>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { startDiagCapture, stopDiagCapture, drainDiagLogs, diagClientMeta } from '@/utils/diagnostics'
import ToggleRow from '@/components/ToggleRow.vue'
import SiteIcon from '@/components/SiteIcon.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import api, { getToken } from '@/api'
import { listDevices, ensureDevice, renameDevice, deleteDevice, getDeviceId, currentDevice, readCache } from '@/utils/device'
import { availableSensors, unavailableReason, startSensorMonitor, buildReportPayload, isNativeSensorMode } from '@/utils/sensors'
import { showNotify, setBlackout, setScreenBrightness, setScreenWake, blackout, saveBlackoutDismiss, watchAmbientLight } from '@/utils/browserCommands'
import { loadInstances, switchInstance, changePassword, authLogout, auth, store, backendOnline, haTokenConfigured, haTokenKnown, saveHAToken, siteName, siteNameEn, siteIcon, siteIconImg, loadSiteName, loadSiteIcon, saveSiteName as persistSiteName, saveSiteIcon as persistSiteIcon, saveSiteIconImage as persistSiteIconImage } from '@/store'
import { applyTheme, resolveTheme, THEMES, CUSTOM_COLOR_KEYS, DEFAULT_CUSTOM_COLORS } from '@/themes'
import { getPrefs, putPrefs, invalidate } from '@/utils/prefs'
import { colsKeyFor } from '@/utils/dashboard'
import { isApk, openServerSheet } from '@/utils/serverConfig'
import { trackingEnabled, setTrackingEnabled } from '@/utils/location'
import { applyTrackingPref, setSensorIntervalPref, syncNativeSensorConfig } from '@/utils/autoSync'

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

// ---- AI 设置：本人配置 + 管理员全局默认（本人有 Key 时优先） ----
const aiScope = ref(auth.isAdmin ? 'global' : 'user')
const aiOwn = reactive({ base_url: '', model: '', api_key: '', has_key: false, clear_key: false })
const aiGlobal = reactive({ base_url: '', model: '', api_key: '', has_key: false, clear_key: false })
const aiEffective = reactive({ base_url: '', model: '', has_key: false, source: 'none' })
const aiSaving = ref(false)
const aiTesting = ref(false)
const aiMsg = ref('')
const aiMsgErr = ref(false)
const aiFields = computed(() => (aiScope.value === 'global' ? aiGlobal : aiOwn))
const aiSourceText = computed(() => {
  if (aiEffective.source === 'user') return '我的配置'
  if (aiEffective.source === 'global') return '管理员全局配置'
  return '未配置'
})
const aiBadge = computed(() => {
  if (aiEffective.source === 'user') return { cls: 'bg-success/15 text-success', text: '我的配置已生效' }
  if (aiEffective.source === 'global') return { cls: 'bg-info/15 text-info', text: '使用全局配置' }
  return { cls: 'bg-surface text-muted', text: '未配置' }
})
let aiMsgTimer = 0
function aiFlash(text, err = false) {
  aiMsg.value = text
  aiMsgErr.value = err
  clearTimeout(aiMsgTimer)
  aiMsgTimer = setTimeout(() => { aiMsg.value = '' }, 4500)
}
function applyAiPrefs(raw) {
  let cfg = {}
  try { cfg = JSON.parse(raw || '{}') } catch { /* 忽略坏配置 */ }
  aiOwn.base_url = cfg.own_base_url || ''
  aiOwn.model = cfg.own_model || ''
  aiOwn.has_key = !!cfg.own_has_key
  aiGlobal.base_url = cfg.global_base_url || ''
  aiGlobal.model = cfg.global_model || ''
  aiGlobal.has_key = !!cfg.global_has_key
  aiEffective.base_url = cfg.base_url || ''
  aiEffective.model = cfg.model || ''
  aiEffective.has_key = !!cfg.has_key
  aiEffective.source = cfg.source || 'none'
}
async function loadAiConfig(force = false) {
  try {
    const { data } = await getPrefs({ force })
    if (data && data.ai_config) applyAiPrefs(data.ai_config)
  } catch { /* 后端离线时静默 */ }
}
async function saveAi() {
  const scope = auth.isAdmin && aiScope.value === 'global' ? 'global' : 'user'
  const f = scope === 'global' ? aiGlobal : aiOwn
  aiSaving.value = true
  try {
    // 直接走 api 写入：AI Key 不进入 localStorage 快照（putPrefs 会持久化请求体）
    await api.putPrefs({
      ai_config: JSON.stringify({
        scope,
        base_url: (f.base_url || '').trim(),
        model: (f.model || '').trim(),
        api_key: f.api_key || '',
        clear_key: !!f.clear_key,
      }),
    })
    invalidate()
    f.api_key = ''
    f.clear_key = false
    await loadAiConfig(true)
    aiFlash(scope === 'global' ? '全局 AI 配置已保存' : 'AI 配置已保存')
    return true
  } catch (e) {
    aiFlash(e.message || '保存失败', true)
    return false
  } finally {
    aiSaving.value = false
  }
}
async function testAi() {
  // 先保存当前编辑，确保测试使用输入框里的 URL / Key / 模型
  const saved = await saveAi()
  if (!saved) return
  aiTesting.value = true
  try {
    const { data } = await api.aiTest()
    const extra = data?.latency_ms != null ? ` · ${data.latency_ms}ms` : ''
    aiFlash(`连接成功 · ${data?.model || aiEffective.model}${extra}`)
  } catch (e) {
    aiFlash(e.message || '连接失败', true)
  } finally {
    aiTesting.value = false
  }
}

// ================= AI 诊断（管理员） =================
const DIAG_DURATIONS = [1, 5, 10, 30]
const diagDuration = ref(5)
const diagBusy = ref(false)
const diagMsg = ref('')
const diagMsgErr = ref(false)
const diagNow = ref(Date.now())
const diagStatus = reactive({
  status: 'idle',
  progress: 0,
  started_at: '',
  ends_at: '',
  duration_min: 0,
  collected: 0,
  client_count: 0,
  report_ready: false,
  error: '',
})
const diagLogs = ref([])
const diagReportText = ref('')
const diagLogEl = ref(null)
let diagTimer = null
let diagTickTimer = null
let diagSeq = 0
let diagPollBusy = false
let diagReportLoaded = false

const diagActive = computed(() => diagStatus.status !== 'idle')
const diagPhaseText = computed(() => {
  switch (diagStatus.status) {
    case 'collecting': return '正在收集前后端日志'
    case 'analyzing': return 'AI 正在生成诊断报告'
    case 'done': return '诊断完成'
    case 'failed': return '诊断失败'
    default: return '未开启'
  }
})
const diagBadge = computed(() => {
  switch (diagStatus.status) {
    case 'collecting': return { cls: 'bg-primary/15 text-primary', text: '采集中' }
    case 'analyzing': return { cls: 'bg-accent/15 text-accent', text: '分析中' }
    case 'done': return { cls: 'bg-success/15 text-success', text: '已完成' }
    case 'failed': return { cls: 'bg-error/15 text-error', text: '失败' }
    default: return { cls: 'bg-surface text-muted', text: '默认关闭' }
  }
})
const diagCountdown = computed(() => {
  if (diagStatus.status === 'collecting' && diagStatus.ends_at) {
    const left = Math.max(0, Math.floor((new Date(diagStatus.ends_at).getTime() - diagNow.value) / 1000))
    const mm = String(Math.floor(left / 60)).padStart(2, '0')
    const ss = String(left % 60).padStart(2, '0')
    return `剩余 ${mm}:${ss} · 本次 ${diagStatus.duration_min} 分钟`
  }
  if (diagStatus.status === 'analyzing') return `采集已结束 · 本次 ${diagStatus.duration_min} 分钟`
  if (diagStatus.status === 'done') {
    const t = diagStatus.ends_at ? new Date(diagStatus.ends_at) : null
    return t ? `采集于 ${t.toLocaleString('zh-CN', { hour12: false })} 结束` : '报告已生成'
  }
  if (diagStatus.status === 'failed') return '报告生成失败，可重新诊断'
  return ''
})

function applyDiagStatus(data) {
  if (!data) return
  diagStatus.status = data.status || 'idle'
  diagStatus.progress = data.progress || 0
  diagStatus.started_at = data.started_at || ''
  diagStatus.ends_at = data.ends_at || ''
  diagStatus.duration_min = data.duration_min || 0
  diagStatus.collected = data.collected || 0
  diagStatus.client_count = data.client_count || 0
  diagStatus.report_ready = !!data.report_ready
  diagStatus.error = data.error || ''
}

function appendDiagLogs(entries) {
  if (!entries || !entries.length) return
  const mapped = entries.map((e) => ({
    seq: e.seq,
    time: e.ts ? new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false }) : '',
    level: String(e.level || 'INFO').toUpperCase(),
    source: e.source || 'server',
    msg: e.msg || '',
  }))
  diagLogs.value = diagLogs.value.concat(mapped)
  if (diagLogs.value.length > 400) diagLogs.value = diagLogs.value.slice(-400)
  diagSeq = mapped[mapped.length - 1].seq || diagSeq
  nextTick(() => {
    const el = diagLogEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function startDiagPolling() {
  if (!diagTimer) {
    diagTimer = setInterval(pollDiag, 1500)
    pollDiag()
  }
  if (!diagTickTimer) {
    diagTickTimer = setInterval(() => { diagNow.value = Date.now() }, 1000)
  }
}

function stopDiagPolling() {
  if (diagTimer) { clearInterval(diagTimer); diagTimer = null }
  if (diagTickTimer) { clearInterval(diagTickTimer); diagTickTimer = null }
  diagPollBusy = false
}

async function loadDiagReport() {
  try {
    const { data } = await api.diagReport()
    diagReportText.value = data?.report || ''
    diagReportLoaded = !!diagReportText.value
  } catch (e) {
    diagMsg.value = e.message || '报告读取失败'
    diagMsgErr.value = true
  }
}

async function pollDiag() {
  if (diagPollBusy) return
  diagPollBusy = true
  try {
    // 先上传浏览器日志，保证被采集进后端会话
    if (diagStatus.status === 'collecting') {
      const pending = drainDiagLogs()
      if (pending.length) {
        try { await api.diagClientLogs(pending) } catch { /* 单次失败忽略，下轮继续 */ }
      }
    }
    const { data } = await api.diagStatus()
    applyDiagStatus(data)
    if (data.status !== 'idle') {
      const res = await api.diagLogs(diagSeq)
      appendDiagLogs(res.data?.entries || [])
    }
    if (data.status === 'done' && !diagReportLoaded) await loadDiagReport()
    if (data.status === 'done' || data.status === 'failed') {
      stopDiagPolling()
      stopDiagCapture()
    }
  } catch (e) {
    // 网络异常时保持轮询，避免诊断过程卡死
    diagMsg.value = e.message || '诊断状态读取失败'
    diagMsgErr.value = true
  } finally {
    diagPollBusy = false
  }
}

async function initDiag() {
  if (!auth.isAdmin) return
  try {
    const { data } = await api.diagStatus()
    applyDiagStatus(data)
    if (data.status === 'collecting') {
      startDiagCapture()
      startDiagPolling()
    } else if (data.status === 'analyzing') {
      startDiagPolling()
    } else if (data.status === 'done') {
      await loadDiagReport()
    }
  } catch { /* 后端离线时静默 */ }
}

async function startDiag() {
  if (diagBusy.value) return
  diagBusy.value = true
  diagMsg.value = ''
  diagMsgErr.value = false
  diagLogs.value = []
  diagSeq = 0
  diagReportText.value = ''
  diagReportLoaded = false
  try {
    const { data } = await api.diagStart(diagDuration.value, diagClientMeta())
    applyDiagStatus(data)
    startDiagCapture()
    startDiagPolling()
    diagMsg.value = '诊断已开始，保持本页面打开可获得更完整的前端日志'
  } catch (e) {
    diagMsg.value = e.message || '启动失败'
    diagMsgErr.value = true
    await initDiag()
  } finally {
    diagBusy.value = false
  }
}

async function stopDiag() {
  if (diagBusy.value) return
  diagBusy.value = true
  diagMsg.value = ''
  diagMsgErr.value = false
  try {
    const { data } = await api.diagStop()
    applyDiagStatus(data)
    diagMsg.value = '已停止采集，正在生成诊断报告…'
    startDiagPolling()
  } catch (e) {
    diagMsg.value = e.message || '停止失败'
    diagMsgErr.value = true
  } finally {
    diagBusy.value = false
  }
}

function resetDiag() {
  stopDiagPolling()
  stopDiagCapture()
  applyDiagStatus({ status: 'idle' })
  diagLogs.value = []
  diagSeq = 0
  diagReportText.value = ''
  diagReportLoaded = false
  diagMsg.value = ''
  diagMsgErr.value = false
}

function downloadDiagReport() {
  if (!diagReportText.value) return
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  const blob = new Blob([diagReportText.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `homecanvas-diagnosis-${stamp}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
// ---- 运行日志（管理员）：级别/来源/时间段筛选 + AI 分析 ----
const logRetentionDays = 30
const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR']
const LOG_SOURCES = [
  { key: 'server', label: '服务端' },
  { key: 'http', label: 'HTTP' },
  { key: 'client', label: '浏览器' },
]
const LOG_RANGES = [
  { key: '1h', label: '最近 1 小时', hours: 1 },
  { key: '24h', label: '最近 24 小时', hours: 24 },
  { key: '7d', label: '最近 7 天', hours: 168 },
  { key: '30d', label: '最近 30 天', hours: 720 },
  { key: 'custom', label: '自定义', hours: 0 },
]
const logLevels = ref(['INFO', 'WARN', 'ERROR'])
const logSources = ref(['server', 'http', 'client'])
const logRange = ref('24h')
const logFrom = ref('')
const logTo = ref('')
const logEntries = ref([])
const logTotal = ref(0)
const logLoading = ref(false)
const logMsg = ref('')
const logMsgErr = ref(false)
const logReport = ref('')
const logAnalysis = reactive({ status: 'idle', collected: 0, error: '' })
let logPollTimer = null

const logRows = computed(() => logEntries.value.map((e) => ({
  ...e,
  time: e.ts ? new Date(e.ts).toLocaleString('zh-CN', { hour12: false }) : '',
})))

function toggleLogLevel(lv) {
  const i = logLevels.value.indexOf(lv)
  if (i >= 0) logLevels.value.splice(i, 1)
  else logLevels.value.push(lv)
}
function toggleLogSource(key) {
  const i = logSources.value.indexOf(key)
  if (i >= 0) logSources.value.splice(i, 1)
  else logSources.value.push(key)
}

// 时间段 → {from, to}（ISO 字符串）；预设按当前时间回溯，自定义取输入值
function logRangePayload() {
  const preset = LOG_RANGES.find((r) => r.key === logRange.value)
  if (preset && preset.hours > 0) {
    const to = new Date()
    return { from: new Date(to.getTime() - preset.hours * 3600e3).toISOString(), to: to.toISOString() }
  }
  const to = logTo.value ? new Date(logTo.value) : new Date()
  const from = logFrom.value ? new Date(logFrom.value) : new Date(to.getTime() - 24 * 3600e3)
  return { from: from.toISOString(), to: to.toISOString() }
}
function logFilterPayload() {
  const { from, to } = logRangePayload()
  return { levels: [...logLevels.value], sources: [...logSources.value], from, to }
}

async function loadLogs() {
  if (!auth.isAdmin || logLoading.value) return
  logLoading.value = true
  logMsg.value = ''
  logMsgErr.value = false
  try {
    const f = logFilterPayload()
    const { data } = await api.sysLogs({
      levels: f.levels.join(','),
      sources: f.sources.join(','),
      from: f.from,
      to: f.to,
      limit: 300,
    })
    logEntries.value = data?.entries || []
    logTotal.value = data?.total || 0
  } catch (e) {
    logMsg.value = e.message || '日志查询失败'
    logMsgErr.value = true
  } finally {
    logLoading.value = false
  }
}

function applyLogAnalysis(d) {
  if (!d) return
  logAnalysis.status = d.status || 'idle'
  logAnalysis.collected = d.collected || 0
  logAnalysis.error = d.error || ''
}

async function analyzeLogs() {
  if (logAnalysis.status === 'running') return
  logReport.value = ''
  logMsg.value = ''
  logMsgErr.value = false
  try {
    const { data } = await api.sysLogAnalyze(logFilterPayload())
    applyLogAnalysis(data)
    logMsg.value = `已提交 ${logAnalysis.collected} 条日志，正在分析…`
    startLogPoll()
  } catch (e) {
    logMsg.value = e.message || '提交分析失败'
    logMsgErr.value = true
  }
}

async function pollLogAnalysis() {
  try {
    const { data } = await api.sysLogAnalysis()
    applyLogAnalysis(data)
    if (data?.status === 'done') {
      logReport.value = data.report || ''
      stopLogPoll()
    } else if (data?.status !== 'running') {
      stopLogPoll()
    }
  } catch { /* 网络异常时保持轮询 */ }
}

function startLogPoll() {
  if (logPollTimer) return
  logPollTimer = setInterval(pollLogAnalysis, 1500)
  pollLogAnalysis()
}
function stopLogPoll() {
  if (logPollTimer) { clearInterval(logPollTimer); logPollTimer = null }
}

async function initLogView() {
  if (!auth.isAdmin) return
  loadLogs()
  try {
    const { data } = await api.sysLogAnalysis()
    applyLogAnalysis(data)
    if (data?.status === 'running') startLogPoll()
    else if (data?.status === 'done') logReport.value = data.report || ''
  } catch { /* 后端离线时静默 */ }
}

function downloadLogReport() {
  if (!logReport.value) return
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  const blob = new Blob([logReport.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `homecanvas-logs-analysis-${stamp}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

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
  { key: 'ai', icon: 'auto_awesome', label: 'AI' },
  ...(auth.isAdmin ? [{ key: 'diag', icon: 'monitor_heart', label: 'AI 诊断' }] : []),
  ...(auth.isAdmin ? [{ key: 'logs', icon: 'receipt_long', label: '日志' }] : []),
  { key: 'account', icon: 'shield_person', label: '账户' },
  ...(auth.isAdmin ? [{ key: 'users', icon: 'group', label: '用户管理' }] : []),
]
const activeTab = ref('connect')
// 锚点导航：每个标签页的区块快捷跳转列表
const anchors = {
  connect: [
    { id: 'sec-ha-token', label: 'HA Token' },
    { id: 'sec-server', label: '服务器' },
    { id: 'sec-ring', label: '铃声' },
    { id: 'sec-ha-conn', label: 'HA 连接' },
    { id: 'sec-map', label: '地图' },
    { id: 'sec-devices', label: '设备' },
    { id: 'sec-sensors', label: '传感器' },
    { id: 'sec-browser', label: '浏览器' },
  ],
  personal: [
    { id: 'sec-theme', label: '主题' },
    { id: 'sec-font', label: '字体' },
    { id: 'sec-cols', label: '列数' },
    { id: 'sec-icon-style', label: '图标' },
    { id: 'sec-floorplan', label: '户型图' },
    { id: 'sec-animation', label: '动画' },
    { id: 'sec-voice', label: '语音' },
  ],
  ai: [
    { id: 'sec-ai', label: 'AI 设置' },
  ],
  diag: [
    { id: 'sec-diag', label: 'AI 诊断' },
  ],
  logs: [
    { id: 'sec-logs', label: '运行日志' },
  ],
  account: [
    { id: 'sec-account', label: '账号' },
    { id: 'sec-sysinfo', label: '系统信息' },
  ],
  users: [
    { id: 'sec-sysname', label: '系统名称' },
    { id: 'sec-users', label: '用户管理' },
  ],
}
function scrollToSection(id) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
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

// 仪表盘列数偏好：仅存本设备（localStorage），换设备互不影响；
// auto 时首页窄屏固定 3 列、桌面按宽度自适应（见 HomeView.updateCols）
const COLS_PREF_KEY = 'hc_dash_cols'
const dashCols = ref(localStorage.getItem(COLS_PREF_KEY) || 'auto')
const dashColOptions = [
  { key: 'auto', name: '自动', note: '手机 3 列' },
  { key: '2', name: '2 列', note: '大卡片' },
  { key: '3', name: '3 列', note: '推荐' },
  { key: '4', name: '4 列', note: '紧凑' },
  { key: '5', name: '5 列', note: '细密' },
  { key: '6', name: '6 列', note: '极细' },
]
watch(dashCols, (v) => {
  try {
    if (v === 'auto') localStorage.removeItem(COLS_PREF_KEY)
    else localStorage.setItem(COLS_PREF_KEY, v)
  } catch { }
  // APK 端：同步列数到服务端 dashboard_apk_cols_<deviceId>，供网页端编辑器按真实列数预览
  // （auto → 空串，网页端默认 3；手动 → 数字 2~6）
  if (isApk) {
    putPrefs({ [colsKeyFor(getDeviceId())]: v === 'auto' ? '' : v }).catch(() => {})
  }
})

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
    const cached = readCache()
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
    flash(renamed.ha_renamed ? '设备别名已更新，HA 设备名已同步' : `别名已更新；${renamed.ha_message || 'HA 设备名未同步'}`, !renamed.ha_renamed)
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
// 上报间隔（秒，设备级配置存 sensor_config.<deviceId>._interval）：
// 前台为前端周期 timer 周期；APK 退后台由保活服务原生心跳按同间隔注入接管
const INTERVALS = [
  { value: 15, label: '15 秒' }, { value: 30, label: '30 秒' }, { value: 60, label: '1 分钟' },
  { value: 120, label: '2 分钟' }, { value: 300, label: '5 分钟' }, { value: 900, label: '15 分钟' },
]
const sensorInterval = ref(60)
async function changeInterval(v) {
  const sec = parseInt(v, 10) || 60
  sensorInterval.value = sec
  try {
    await setSensorIntervalPref(sec)
    flash('上报间隔已更新，后台心跳同步生效')
  } catch (e) { flash(e.message, true) }
}
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
  car_speed: 'speed',
  car_heading: 'explore',
  driving: 'directions_car',
  trip_today: 'route',
  altitude: 'terrain',
  gps_accuracy: 'gps_fixed',
  gps_satellites: 'satellite_alt',
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
      if (mine._interval) sensorInterval.value = parseInt(mine._interval, 10) || 60
    }
  } catch { /* 忽略坏配置 */ }
  syncMonitor()
  syncNativeSensorConfig(true) // 原生采集模式：进入设置页即同步一次采集上下文（Web 模式为空操作）
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
    // 原生采集模式：把启用项清单同步给原生（原生立即按新清单上报一次）；
    // Web 降级模式：有启用项时启动状态变化监听并即时上报一次。
    if (isNativeSensorMode()) syncNativeSensorConfig(true)
    else if (on) { syncMonitor(); reportNow(false) }
  } catch (e) { flash(e.message, true) }
}

// 有启用项时启动状态变化监听（变化即上报 + 60s 兜底），全部关闭时停止。
// 原生采集模式下采集/上报全由原生承担，不启动 Web 监听（见 docs/传感器原生采集开发规范.md）。
function syncMonitor() {
  if (isNativeSensorMode()) return
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
  // 原生采集模式：采集与上报全部由原生承担，前端只同步采集上下文并触发一次原生上报
  if (isNativeSensorMode()) {
    reporting.value = true
    try {
      await syncNativeSensorConfig(true)
      const res = await nativeReportNow(trigger)
      if (res.ok) {
        lastReport.value = new Date().toLocaleTimeString()
        if (showMsg) flash(`设备传感器已上报（${res.reported} 项）`)
      } else if (showMsg) {
        flash(NATIVE_SENSOR_TIPS[res.error] || res.error || '传感器上报失败', true)
      }
    } catch (e) {
      if (showMsg) flash(e.message, true)
    } finally {
      reporting.value = false
    }
    return
  }
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

// 原生采集上报错误码 → 中文提示（错误码见 NativeSensorReporter.java 的 ReportCallback）
const NATIVE_SENSOR_TIPS = {
  no_context: '采集上下文未就绪，请稍后重试或重新登录',
  busy: '上一次上报尚未完成，请稍后重试',
  auth: '登录状态已失效，请重新登录',
  unavailable: '当前环境不支持原生采集',
  timeout: '上报超时，请检查网络连接',
}
// 触发一次原生即时上报并等待结果（stickykee-sensors 事件按 req 匹配；超时 20s 视为失败）。
// 仅 APK 原生采集模式调用；纯浏览器环境走 reportNow 的 Web 路径。
function nativeReportNow(trigger = 'manual', timeoutMs = 20000) {
  return new Promise((resolve) => {
    const nv = typeof window !== 'undefined' ? window.StickyKeeNative : null
    if (!nv || typeof nv.reportSensorsNow !== 'function') { resolve({ ok: false, error: 'unavailable' }); return }
    const req = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const done = (r) => {
      window.removeEventListener('stickykee-sensors', onEvt)
      clearTimeout(timer)
      resolve(r)
    }
    const onEvt = (e) => {
      const d = e && e.detail
      if (!d || d.req !== req) return
      done({ ok: !!d.ok, reported: Number(d.reported) || 0, error: d.error || '' })
    }
    const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs)
    window.addEventListener('stickykee-sensors', onEvt)
    try { nv.reportSensorsNow(trigger, req) } catch (e) { done({ ok: false, error: (e && e.message) || 'error' }) }
  })
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
const siteNameEnDraft = ref(siteNameEn.value)
const siteNameSaving = ref(false)
const siteNameMsg = ref('')
const siteNameErr = ref(false)
async function saveSiteName() {
  const name = siteNameDraft.value.trim()
  if (!name) { siteNameMsg.value = '名称不能为空'; siteNameErr.value = true; return }
  const nameEn = siteNameEnDraft.value.trim()
  siteNameSaving.value = true
  siteNameMsg.value = ''
  try {
    await persistSiteName(name, nameEn)
    siteNameMsg.value = `已保存为「${name}」`
    siteNameErr.value = false
  } catch (e) {
    siteNameMsg.value = e?.response?.data?.error || e.message || '保存失败'
    siteNameErr.value = true
  } finally {
    siteNameSaving.value = false
  }
}

// ---- HA 设备名（管理员）：服务器注册到 HA 的虚拟设备显示名（生日传感器等实体挂在其下）----
const serverDeviceNameDraft = ref('')
const serverDeviceNameSaving = ref(false)
async function saveServerDeviceName() {
  serverDeviceNameSaving.value = true
  siteNameMsg.value = ''
  try {
    await api.putPrefs({ server_device_name: serverDeviceNameDraft.value.trim() })
    siteNameMsg.value = serverDeviceNameDraft.value.trim() ? `HA 设备名已保存为「${serverDeviceNameDraft.value.trim()}」并同步` : '已恢复默认设备名并同步'
    siteNameErr.value = false
  } catch (e) {
    siteNameMsg.value = e?.response?.data?.error || e.message || '保存失败'
    siteNameErr.value = true
  } finally {
    serverDeviceNameSaving.value = false
  }
}

// ---- 系统图标（管理员）----
const SITE_ICON_SUGGESTIONS = ['bolt', 'home', 'smart_toy', 'cloud', 'leaf', 'star', 'favorite', 'memory', 'devices', 'widgets', 'auto_awesome', 'rocket_launch']
const siteIconDraft = ref(siteIcon.value)
const siteIconSaving = ref(false)
const siteIconMsg = ref('')
const siteIconErr = ref(false)
async function saveSiteIcon() {
  const v = siteIconDraft.value.trim().toLowerCase()
  if (!v) { siteIconMsg.value = '图标不能为空'; siteIconErr.value = true; return }
  siteIconSaving.value = true
  siteIconMsg.value = ''
  try {
    await persistSiteIcon(v)
    siteIconMsg.value = '已保存'
    siteIconErr.value = false
  } catch (e) {
    siteIconMsg.value = e?.response?.data?.error || e.message || '保存失败'
    siteIconErr.value = true
  } finally {
    siteIconSaving.value = false
  }
}

// 上传自定义图标图片：读为 data URL 直接保存（≤256KB），各端经 brand 广播热刷新
const iconFileEl = ref(null)
async function onIconFile(e) {
  const f = e.target.files?.[0]
  e.target.value = '' // 允许重复选同一文件
  if (!f) return
  if (f.size > 256 * 1024) { siteIconMsg.value = '图片过大（请压缩到 256KB 以内）'; siteIconErr.value = true; return }
  let dataUrl
  try {
    dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(new Error('读取文件失败'))
      r.readAsDataURL(f)
    })
  } catch (err) {
    siteIconMsg.value = err.message || '读取文件失败'
    siteIconErr.value = true
    return
  }
  siteIconSaving.value = true
  siteIconMsg.value = ''
  try {
    await persistSiteIconImage(dataUrl)
    siteIconMsg.value = '已保存'
    siteIconErr.value = false
  } catch (e2) {
    siteIconMsg.value = e2.message || '保存失败'
    siteIconErr.value = true
  } finally {
    siteIconSaving.value = false
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

// ---- 管理员代设账号生日（服务端 user_prefs 用户级键；保存后同步该账号 HA 生日传感器） ----
const bdUser = ref('')
const bdList = ref([])
const bdSaving = ref(false)
const bdMonthOptions = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: i + 1 }))
function bdMaxDay(it) { return it.calendar === 'lunar' ? 30 : new Date(2000, it.month, 0).getDate() }
function bdDayOptions(it) {
  return Array.from({ length: bdMaxDay(it) }, (_, i) => ({ label: `${i + 1}日`, value: i + 1 }))
}
function clampBdDay(it) {
  const max = bdMaxDay(it)
  if (it.day > max) it.day = max
}
async function openUserBirthdays(u) {
  bdUser.value = u.username
  bdList.value = []
  try { bdList.value = (await api.getUserBirthdays(u.username)).data || [] }
  catch (e) { uflash(e.message, true); bdUser.value = '' }
}
function addUserBirthday() {
  bdList.value.push({ id: Date.now().toString(36), name: '', calendar: 'solar', month: 1, day: 1 })
}
async function saveUserBirthdays() {
  if (!bdUser.value) return
  bdSaving.value = true
  try {
    const list = bdList.value.map((it) => ({ id: it.id, name: it.name || '生日', calendar: it.calendar, month: it.month, day: it.day }))
    await api.setUserBirthdays(bdUser.value, list)
    uflash(`「${bdUser.value}」的生日已保存并同步到其 HA 生日传感器`)
    bdUser.value = ''
  } catch (e) { uflash(e.message, true) }
  finally { bdSaving.value = false }
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
    if (data.ai_config) applyAiPrefs(data.ai_config)
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
// 服务端可用的 APK 版本（AppInfo.version，独立于后端版本）
const apkVersion = ref('')
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

// 消息免打扰（本机开关，localStorage）：开启后新消息通知走静默渠道（不响不震，仍显示）
const imDnd = ref(localStorage.getItem('hc_im_dnd') === '1')
watch(imDnd, (v) => {
  try {
    if (v) localStorage.setItem('hc_im_dnd', '1')
    else localStorage.removeItem('hc_im_dnd')
  } catch { }
})
// 申请通知权限：首次弹系统框；被永久拒绝后原生会自动跳应用详情 → 回来时重查状态
function askNotifPerm() {
  try { window.StickyKeeNative?.requestNotifPermission?.() } catch { /* 忽略 */ }
  setTimeout(refreshNotif, 1200)
}
// 开机自启动引导：MIUI 等需在应用详情手动开启
function goAppDetails() {
  try { window.StickyKeeNative?.openAppDetails?.() } catch { /* 忽略 */ }
}
// 后台定位授权引导（原生采集模式）：Android 11+ 跳应用详情选「始终允许」，10 及以下弹运行时框
function askBgLocation() {
  try { window.StickyKeeNative?.requestBackgroundLocation?.() } catch { /* 忽略 */ }
  flash('请在系统设置中将定位权限改为「始终允许」')
}
const onVisNotif = () => { if (document.visibilityState === 'visible') refreshNotif() }
async function loadAppInfo() {
  try {
    const { data } = await api.appInfo()
    apkAvailable.value = !!data?.apkAvailable
    if (data?.version) apkVersion.value = String(data.version)
    // APK 环境下比较 AppInfo 返回的 APK 版本与本机原生版本：前者更高即提示更新。
    // WebView 加载的是服务器网页，appVersion（打包的 www 版本）与当前 JS 无关，
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
    a.download = 'StickyKee-' + (apkVersion.value || backendVersion.value || '') + '.apk'
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
  loadSiteName().then(() => { siteNameDraft.value = siteName.value; siteNameEnDraft.value = siteNameEn.value }) // 同步后端权威值
  getPrefs({ force: true }).then(({ data }) => { serverDeviceNameDraft.value = data?.server_device_name || '' }).catch(() => {})
  loadSiteIcon().then(() => { siteIconDraft.value = siteIcon.value })
  stopLightWatch = watchAmbientLight() // 面板打开期间持续读环境光，用于「实时值」显示
  initDiag() // 恢复可能仍在进行的诊断会话（默认关闭时不会产生采集）
  initLogView() // 初始加载运行日志并恢复可能仍在进行中的 AI 分析
})
onUnmounted(() => {
  stopDiagPolling()
  stopDiagCapture()
  stopLogPoll()
  if (stopMonitor) { stopMonitor(); stopMonitor = null }
  if (stopLightWatch) { stopLightWatch(); stopLightWatch = null }
  if (canPickRing) window.removeEventListener('stickykee-ring', onRingPicked)
  if (isApk) window.removeEventListener('stickykee-apk', onApkEvent)
  if (canInAppUpdate) document.removeEventListener('visibilitychange', onVisNotif)
})
</script>

<style scoped>
/* 手机端标签栏 / 锚点栏：横向滚动但隐藏滚动条（避免占位导致高度抖动） */
.hc-nav-scroll,
.hc-hide-bar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.hc-nav-scroll { overflow-x: auto; }
.hc-nav-scroll::-webkit-scrollbar,
.hc-hide-bar::-webkit-scrollbar { display: none; }

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
.hc-spinner-accent {
  width: 14px;
  height: 14px;
  border-width: 2px;
  border-color: rgb(var(--c-accent) / 0.3);
  border-top-color: rgb(var(--c-accent));
}

/* AI 诊断：实时日志与报告预览 */
.diag-logs {
  max-height: 260px;
  overflow-y: auto;
  padding: 6px 8px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  background: rgb(var(--c-background));
}
.log-list { max-height: 420px; }
.diag-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 0;
  border-bottom: 1px solid rgb(var(--c-border) / 0.35);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.45;
}
.diag-row:last-child { border-bottom: none; }
.diag-time { flex: none; color: rgb(var(--c-faint)); }
.diag-lvl {
  flex: none;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 16px;
  font-weight: 600;
}
.diag-lvl.lv-error { color: rgb(var(--c-error)); background: rgb(var(--c-error) / 0.12); }
.diag-lvl.lv-warn { color: rgb(var(--c-warning)); background: rgb(var(--c-warning) / 0.12); }
.diag-lvl.lv-info { color: rgb(var(--c-info)); background: rgb(var(--c-info) / 0.12); }
.diag-lvl.lv-debug { color: rgb(var(--c-muted)); background: rgb(var(--c-muted) / 0.12); }
.diag-src { flex: none; color: rgb(var(--c-accent)); }
.diag-msg { color: rgb(var(--c-on-surface)); white-space: pre-wrap; word-break: break-all; }
.diag-empty { padding: 8px 0; text-align: center; color: rgb(var(--c-muted)); font-size: 11px; }
.diag-report-pre {
  margin: 0;
  max-height: 420px;
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  background: rgb(var(--c-background));
  color: rgb(var(--c-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
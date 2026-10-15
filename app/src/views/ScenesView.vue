<template>
  <div class="space-y-4 py-2">
    <!-- 页面标题只保留给屏读器（可见标题行占的垂直空间已省掉）；右侧同步状态保留并右对齐。
         标题放在本行内部，避免成为 space-y-4 的多余子项而多出一段间距 -->
    <div class="flex items-center justify-end">
      <h1 class="sr-only">场景与自动化</h1>
      <div class="flex items-center gap-2 text-xs font-body" :class="syncFailed ? 'text-error' : 'text-muted'">
        <span class="material-symbols-outlined text-base">{{ syncFailed ? 'sync_problem' : 'schedule' }}</span>
        上次同步：{{ syncAgoText }}
        <span class="w-1 h-1 rounded-full bg-faint"></span>
        <span :class="syncFailed ? 'text-error' : 'text-success'">{{ syncFailed ? '✕ 同步失败' : '✓ 已连接' }}</span>
      </div>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div
        v-for="s in stats"
        :key="s.label"
        class="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" :class="s.iconBg">
          <span class="material-symbols-outlined text-xl" :class="s.iconColor">{{ s.icon }}</span>
        </div>
        <div>
          <div class="text-xs text-muted font-body">{{ s.label }}</div>
          <div class="font-headline text-xl font-semibold" :class="s.valueColor" v-html="s.value"></div>
        </div>
      </div>
    </div>

    <!-- Preset Scenes -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h2 class="font-headline text-lg font-semibold text-on-background">预设场景</h2>
          <span class="text-xs text-muted font-body bg-surface-alt border border-border px-2 py-0.5 rounded-full">{{ scenes.length }} 个</span>
        </div>
        <button
          class="text-xs text-muted font-body hover:text-primary transition-colors flex items-center gap-1"
          @click="haOpen()"
        >
          在 HA 中管理
          <span class="material-symbols-outlined text-base">open_in_new</span>
        </button>
      </div>

      <div v-if="scenes.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <div
          v-for="s in scenes"
          :key="s._entity || s.name"
          class="bg-surface rounded-2xl p-5 relative overflow-hidden transition-all duration-200 group"
          :class="[ s.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]', s.on ? 'border border-primary/30' : 'border border-border' ]"
          :style="s.on ? { borderColor: s.border } : {}"
          @click="runScene(s)"
        >
          <div v-if="s.on" class="absolute top-0 right-0 w-16 h-16 rounded-bl-3xl" :class="s.corner"></div>
          <div class="flex items-start justify-between mb-4 relative">
            <div class="w-12 h-12 rounded-2xl flex items-center justify-center border" :class="s.on ? s.iconBox : 'bg-faint/30 border-border'">
              <span
                class="material-symbols-outlined text-2xl transition-transform"
                :class="[ s.on ? s.text : 'text-muted ' + s.hoverText, s.running ? 'animate-spin' : '' ]"
              >{{ s.running ? 'progress_activity' : s.icon }}</span>
            </div>
            <span
              class="text-xs px-2 py-0.5 rounded-full font-body"
              :class="s.disabled ? 'bg-surface-alt border border-border text-faint' : (s.on ? 'bg-primary/10 border border-primary/20 text-primary' : 'bg-surface-alt border border-border text-muted')"
            >{{ s.disabled ? '不可用' : (s.on ? '运行中' : '点击执行') }}</span>
          </div>
          <h3 class="font-headline font-semibold text-on-background text-base mb-1">{{ s.name }}</h3>
          <p class="text-xs text-muted font-body leading-relaxed mb-4">{{ s.desc }}</p>
          <div class="flex items-center gap-1 text-primary/80 text-xs font-body opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="material-symbols-outlined text-base">touch_app</span>
            {{ s.disabled ? '设备不可用' : '点击执行场景' }}
          </div>
        </div>
      </div>
      <EmptyState v-else compact icon="magic_button" title="暂无场景" desc="从 Home Assistant 同步的预设场景将显示在此处" />
    </section>

    <!-- Automation Rules -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h2 class="font-headline text-lg font-semibold text-on-background">自动化规则</h2>
          <span class="text-xs text-muted font-body bg-surface-alt border border-border px-2 py-0.5 rounded-full">{{ rules.length }} 条</span>
        </div>
        <div class="flex items-center gap-2">
          <select
            v-model="stateFilter"
            class="bg-surface border border-border text-muted text-xs font-body rounded-lg px-3 py-1.5 outline-none focus:border-primary/40"
          >
            <option value="">全部状态</option>
            <option value="on">已启用</option>
            <option value="off">已关闭</option>
          </select>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors font-body text-xs font-medium"
            @click="newWizard()"
          >
            <span class="material-symbols-outlined text-base">add</span>
            新建规则
          </button>
        </div>
      </div>

      <div v-if="filteredRules.length" class="space-y-3">
        <div
          v-for="r in filteredRules"
          :key="r._entity || r.name"
          class="bg-surface rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-colors duration-200"
          :class="[ r.on ? 'border border-success/20 hover:border-success/40' : 'border border-border hover:border-muted/20 opacity-70' ]"
        >
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" :class="r.on ? 'bg-success/10' : 'bg-faint/20 border border-border'">
              <span class="material-symbols-outlined text-lg" :class="r.on ? 'text-success' : 'text-faint'">{{ r.icon }}</span>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-headline font-semibold text-sm" :class="r.on ? 'text-on-background' : 'text-muted'">{{ r.name }}</span>
                <span class="text-xs px-1.5 py-0.5 rounded font-body" :class="r.on ? 'bg-success/10 border border-success/20 text-success' : 'bg-surface-alt border border-border text-faint'">{{ r.on ? '运行中' : '已关闭' }}</span>
              </div>
              <div v-if="r.lastTriggered" class="text-xs text-faint font-body mt-0.5">
                上次触发：{{ r.lastTriggered }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button
              class="p-1.5 rounded-lg text-faint hover:text-on-surface hover:bg-surface-alt transition-colors"
              title="编辑规则"
              @click="openEdit(r)"
            >
              <span class="material-symbols-outlined text-base">edit</span>
            </button>
            <button
              class="p-1.5 rounded-lg text-faint hover:text-error hover:bg-surface-alt transition-colors"
              title="删除规则"
              @click="deleteRule(r)"
            >
              <span class="material-symbols-outlined text-base">delete</span>
            </button>
            <button
              class="p-1.5 rounded-lg text-faint hover:text-primary hover:bg-surface-alt transition-colors"
              title="在 HA 中打开"
              @click="haOpen(r._entity)"
            >
              <span class="material-symbols-outlined text-base">open_in_new</span>
            </button>
            <label class="flex items-center gap-2 cursor-pointer">
              <div class="relative">
                <input type="checkbox" class="sr-only peer" :checked="r.on" @change="toggleRule(r)" />
                <div class="w-8 h-4 rounded-full toggle-track transition-colors" :class="r.on ? 'bg-success/20 border border-success/40' : 'bg-surface-alt border border-border'"></div>
                <div class="absolute top-0.5 left-0.5 w-3 h-3 rounded-full toggle-thumb transition-transform duration-200" :class="r.on ? 'bg-success' : 'bg-faint'" :style="r.on ? { transform: 'translateX(14px)' } : {}"></div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <EmptyState v-else compact icon="account_tree" title="暂无自动化规则" desc="点击「新建自动化」创建你的第一条规则" />
    </section>

    <!-- Execution Log -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h2 class="font-headline text-lg font-semibold text-on-background">最近执行日志</h2>
          <span class="text-xs text-muted font-body bg-surface-alt border border-border px-2 py-0.5 rounded-full">最近24小时</span>
        </div>
        <button class="text-xs text-muted font-body hover:text-primary transition-colors" @click="loadLogs">
          刷新
          <span class="material-symbols-outlined text-base align-middle">refresh</span>
        </button>
      </div>

      <div v-if="logs.length" class="bg-surface border border-border rounded-xl divide-y divide-border/60">
        <div v-for="(log, i) in logs" :key="i" class="flex items-start gap-3 px-4 py-3">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-faint/15">
            <span class="material-symbols-outlined text-base text-muted">bolt</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-headline font-medium text-sm text-on-background truncate">{{ log.name || '系统' }}</span>
              <span v-if="log.entity_id" class="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt border border-border text-faint font-body">{{ log.entity_id }}</span>
            </div>
            <p class="text-xs text-muted font-body mt-0.5 truncate">{{ log.message || '—' }}</p>
          </div>
          <span class="text-xs text-faint font-body flex-shrink-0">{{ fmtTime(log.time) }}</span>
        </div>
      </div>
      <EmptyState v-else compact icon="history" title="暂无执行日志" desc="最近 24 小时内暂无自动化执行记录" />
    </section>

    <!-- 新建/编辑自动化向导 -->
    <div v-if="wizard" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" @click.self="wizard = null" @click="closeAllDropdowns">
      <div class="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border/60 sticky top-0 bg-surface z-10">
          <h3 class="font-headline text-base font-semibold text-on-background">{{ wizard.mode === 'edit' ? '编辑自动化' : '新建自动化' }}</h3>
          <button class="p-1.5 rounded-lg text-muted hover:text-on-surface hover:bg-surface-alt transition-colors" @click="wizard = null">
            <span class="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <div class="px-5 py-4 space-y-5">
          <!-- 名称 -->
          <div>
            <label class="block text-xs text-muted font-body mb-1.5">名称 <span class="text-error">*</span></label>
            <input
              v-model="wizard.alias"
              type="text"
              placeholder="如：晚安模式"
              class="w-full bg-surface-alt border border-border rounded-lg px-3 py-2 text-sm font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
            />
          </div>

          <!-- 触发器 -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs text-muted font-body">触发器</label>
              <div v-if="!wizard.rawTrigger" class="flex items-center gap-1 bg-surface-alt border border-border rounded-lg p-0.5">
                <button
                  class="px-2 py-0.5 rounded text-xs font-body transition-colors"
                  :class="wizard.triggerLogic === 'or' ? 'bg-primary/10 border border-primary/30 text-primary' : 'text-muted hover:text-on-surface'"
                  @click="wizard.triggerLogic = 'or'"
                >OR（任意）</button>
                <button
                  class="px-2 py-0.5 rounded text-xs font-body transition-colors"
                  :class="wizard.triggerLogic === 'and' ? 'bg-primary/10 border border-primary/30 text-primary' : 'text-muted hover:text-on-surface'"
                  @click="wizard.triggerLogic = 'and'"
                >AND（全部）</button>
              </div>
            </div>

            <template v-if="wizard.rawTrigger">
              <p class="text-xs text-muted font-body mb-2">已保留原有 {{ wizard.rawTrigger.length }} 个复杂触发器，保存时原样写回。</p>
            </template>
            <template v-else>
              <!-- 触发器列表 -->
              <div v-if="wizard.triggers.length" class="space-y-2 mb-3">
                <div
                  v-for="(tr, ti) in wizard.triggers"
                  :key="tr.id"
                  class="bg-surface-alt border border-border rounded-xl p-3 space-y-2"
                >
                  <!-- 触发器头部：类型 + 删除 -->
                  <div class="flex items-center gap-2">
                    <select
                      v-model="tr.platform"
                      class="bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      @change="onTriggerPlatformChange(tr)"
                    >
                      <option value="state">设备状态变化</option>
                      <option value="time">定时触发</option>
                      <option value="sun">日出/日落</option>
                      <option value="numeric_state">数值变化</option>
                    </select>
                    <span class="text-xs text-faint font-body flex-1">#{{ ti + 1 }}</span>
                    <button
                      class="p-1 rounded text-faint hover:text-error transition-colors"
                      @click="removeTrigger(ti)"
                      title="删除触发器"
                    >
                      <span class="material-symbols-outlined text-base">close</span>
                    </button>
                  </div>

                  <!-- 设备状态变化 -->
                  <template v-if="tr.platform === 'state'">
                    <div class="entity-search relative">
                      <div
                        class="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus-within:border-primary/50 cursor-text"
                        @click.stop="tr._open = !tr._open; tr._search = ''"
                      >
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0">search</span>
                        <input
                          :value="entityDisplay(tr._search, tr.entity_id)"
                          type="text"
                          placeholder="搜索或选择实体…"
                          class="flex-1 min-w-0 bg-transparent outline-none text-xs font-body text-on-background placeholder:text-faint"
                          @input="tr._search = $event.target.value; tr._open = true"
                        />
                        <button
                          v-if="tr.entity_id"
                          class="flex-shrink-0 text-muted hover:text-on-surface"
                          @click.stop="tr.entity_id = ''; tr.to = ''; tr.from = ''; tr._search = ''"
                        >
                          <span class="material-symbols-outlined text-base">close</span>
                        </button>
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0" :class="tr._open ? 'rotate-180' : ''">expand_more</span>
                      </div>
                      <div
                        v-if="tr._open"
                        class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto"
                      >
                        <div v-if="getFilteredEntities(tr._search).length" class="py-1">
                          <div
                            v-for="e in getFilteredEntities(tr._search)"
                            :key="e.entity_id"
                            class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors"
                            :class="{ 'bg-primary/10': tr.entity_id === e.entity_id }"
                            @click="tr.entity_id = e.entity_id; tr._search = ''; tr._open = false"
                          >
                            <span class="text-muted material-symbols-outlined text-base flex-shrink-0">devices</span>
                            <div class="min-w-0 flex-1">
                              <div class="text-on-background truncate">{{ e.friendly_name || e.entity_id }}</div>
                              <div class="text-faint truncate">{{ e.entity_id }} · {{ e.state }}</div>
                            </div>
                          </div>
                        </div>
                        <p v-else class="px-3 py-1.5 text-xs text-faint font-body">无匹配实体</p>
                      </div>
                    </div>
                    <!-- 事件类型 -->
                    <div class="flex items-center gap-2">
                      <select
                        v-model="tr.event_type"
                        class="bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      >
                        <option value="">状态变化（任意）</option>
                        <option value="changed">变化时</option>
                        <option value="turned_on">打开时</option>
                        <option value="turned_off">关闭时</option>
                        <option value="pressed">按下</option>
                        <option value="double_pressed">双击</option>
                        <option value="held">长按</option>
                      </select>
                      <template v-if="tr.event_type !== ''">
                        <!-- 二进制实体：下拉选择状态 -->
                        <select
                          v-if="isBinaryEntity(tr.entity_id)"
                          v-model="tr.to"
                          class="bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                        >
                          <option value="">等于</option>
                          <option value="on">on</option>
                          <option value="off">off</option>
                          <option value="open">open</option>
                          <option value="closed">closed</option>
                          <option value="home">home</option>
                          <option value="not_home">not_home</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                        <input
                          v-else
                          v-model="tr.to"
                          type="text"
                          placeholder="目标状态，如：on / 25"
                          class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                        />
                      </template>
                    </div>
                    <!-- for：持续时长 -->
                    <div class="flex items-center gap-2 mt-1">
                      <label class="text-xs text-faint font-body flex-shrink-0">保持</label>
                      <input
                        v-model="tr.for"
                        type="text"
                        placeholder="HH:MM:SS，如 00:05:00"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                      <label class="text-xs text-faint font-body flex-shrink-0">星期</label>
                      <input
                        v-model="tr.weekday"
                        type="text"
                        placeholder="1-7（可选）"
                        class="w-24 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                    </div>
                  </template>

                  <!-- 定时触发 -->
                  <template v-else-if="tr.platform === 'time'">
                    <input
                      v-model="tr.at"
                      type="time"
                      class="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus:border-primary/50"
                    />
                  </template>

                  <!-- 日出日落 -->
                  <template v-else-if="tr.platform === 'sun'">
                    <select
                      v-model="tr.event"
                      class="bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                    >
                      <option value="sunrise">日出</option>
                      <option value="sunset">日落</option>
                    </select>
                    <input
                      v-model="tr.offset"
                      type="text"
                      placeholder="偏移（可选），如：-30（提前30分钟）"
                      class="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint mt-1"
                    />
                  </template>

                  <!-- 数值变化 -->
                  <template v-else-if="tr.platform === 'numeric_state'">
                    <div class="entity-search relative">
                      <div
                        class="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus-within:border-primary/50 cursor-text"
                        @click.stop="tr._open = !tr._open; tr._search = ''"
                      >
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0">search</span>
                        <input
                          :value="entityDisplay(tr._search, tr.entity_id)"
                          type="text"
                          placeholder="搜索或选择实体…"
                          class="flex-1 min-w-0 bg-transparent outline-none text-xs font-body text-on-background placeholder:text-faint"
                          @input="tr._search = $event.target.value; tr._open = true"
                        />
                        <button
                          v-if="tr.entity_id"
                          class="flex-shrink-0 text-muted hover:text-on-surface"
                          @click.stop="tr.entity_id = ''; tr.above = ''; tr.below = ''; tr._search = ''"
                        >
                          <span class="material-symbols-outlined text-base">close</span>
                        </button>
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0" :class="tr._open ? 'rotate-180' : ''">expand_more</span>
                      </div>
                      <div
                        v-if="tr._open"
                        class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto"
                      >
                        <div v-if="getFilteredEntities(tr._search).length" class="py-1">
                          <div
                            v-for="e in getFilteredEntities(tr._search)"
                            :key="e.entity_id"
                            class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors"
                            :class="{ 'bg-primary/10': tr.entity_id === e.entity_id }"
                            @click="tr.entity_id = e.entity_id; tr._search = ''; tr._open = false"
                          >
                            <span class="text-muted material-symbols-outlined text-base flex-shrink-0">devices</span>
                            <div class="min-w-0 flex-1">
                              <div class="text-on-background truncate">{{ e.friendly_name || e.entity_id }}</div>
                              <div class="text-faint truncate">{{ e.entity_id }} · {{ e.state }}</div>
                            </div>
                          </div>
                        </div>
                        <p v-else class="px-3 py-1.5 text-xs text-faint font-body">无匹配实体</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 mt-1">
                      <input
                        v-model="tr.above"
                        type="number"
                        step="0.1"
                        placeholder="高于"
                        class="w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                      <span class="text-xs text-faint font-body flex-shrink-0">且</span>
                      <input
                        v-model="tr.below"
                        type="number"
                        step="0.1"
                        placeholder="低于"
                        class="w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                    </div>
                  </template>
                </div>
              </div>

              <!-- 添加触发器按钮 -->
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted font-body hover:border-primary/40 hover:text-primary transition-colors"
                @click="addTrigger('state')"
              >
                <span class="material-symbols-outlined text-base">add</span> 添加触发器
              </button>
            </template>

            <p v-if="wizard.triggers.length === 0 && !wizard.rawTrigger" class="text-xs text-faint font-body mt-2">
              添加至少一个触发器来定义何时执行自动化。
            </p>
          </div>

          <!-- 条件 -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs text-muted font-body">条件 <span class="text-faint font-body">（可选）</span></label>
              <div v-if="!wizard.rawCondition" class="flex items-center gap-1 bg-surface-alt border border-border rounded-lg p-0.5">
                <button
                  class="px-2 py-0.5 rounded text-xs font-body transition-colors"
                  :class="wizard.conditionLogic === 'or' ? 'bg-primary/10 border border-primary/30 text-primary' : 'text-muted hover:text-on-surface'"
                  @click="wizard.conditionLogic = 'or'"
                >OR</button>
                <button
                  class="px-2 py-0.5 rounded text-xs font-body transition-colors"
                  :class="wizard.conditionLogic === 'and' ? 'bg-primary/10 border border-primary/30 text-primary' : 'text-muted hover:text-on-surface'"
                  @click="wizard.conditionLogic = 'and'"
                >AND</button>
              </div>
            </div>

            <template v-if="wizard.rawCondition">
              <p class="text-xs text-muted font-body mb-2">已保留原有 {{ wizard.rawCondition.length }} 个复杂条件，保存时原样写回。</p>
            </template>
            <template v-else>
              <div v-if="wizard.conditions.length" class="space-y-2 mb-3">
                <div
                  v-for="(cond, ci) in wizard.conditions"
                  :key="cond.id"
                  class="bg-surface-alt border border-border rounded-xl p-3 space-y-2"
                >
                  <!-- 条件头部：类型 + 删除 -->
                  <div class="flex items-center gap-2">
                    <select
                      v-model="cond.platform"
                      class="bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      @change="onConditionPlatformChange(cond)"
                    >
                      <option value="state">设备状态</option>
                      <option value="numeric_state">数值范围</option>
                      <option value="time">时间窗口</option>
                      <option value="sun">日出日落</option>
                    </select>
                    <span class="text-xs text-faint font-body flex-1">#{{ ci + 1 }}</span>
                    <button
                      class="p-1 rounded text-faint hover:text-error transition-colors"
                      @click="removeCondition(ci)"
                      title="删除条件"
                    >
                      <span class="material-symbols-outlined text-base">close</span>
                    </button>
                  </div>

                  <!-- 设备状态条件 -->
                  <template v-if="cond.platform === 'state'">
                    <div class="entity-search relative">
                      <div
                        class="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus-within:border-primary/50 cursor-text"
                        @click.stop="cond._open = !cond._open; cond._search = ''"
                      >
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0">search</span>
                        <input
                          :value="entityDisplay(cond._search, cond.entity_id)"
                          type="text"
                          placeholder="搜索或选择实体…"
                          class="flex-1 min-w-0 bg-transparent outline-none text-xs font-body text-on-background placeholder:text-faint"
                          @input="cond._search = $event.target.value; cond._open = true"
                        />
                        <button
                          v-if="cond.entity_id"
                          class="flex-shrink-0 text-muted hover:text-on-surface"
                          @click.stop="cond.entity_id = ''; cond.to = ''; cond.from = ''; cond._search = ''"
                        >
                          <span class="material-symbols-outlined text-base">close</span>
                        </button>
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0" :class="cond._open ? 'rotate-180' : ''">expand_more</span>
                      </div>
                      <div
                        v-if="cond._open"
                        class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto"
                      >
                        <div v-if="getFilteredEntities(cond._search).length" class="py-1">
                          <div
                            v-for="e in getFilteredEntities(cond._search)"
                            :key="e.entity_id"
                            class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors"
                            :class="{ 'bg-primary/10': cond.entity_id === e.entity_id }"
                            @click="cond.entity_id = e.entity_id; cond._search = ''; cond._open = false"
                          >
                            <span class="text-muted material-symbols-outlined text-base flex-shrink-0">devices</span>
                            <div class="min-w-0 flex-1">
                              <div class="text-on-background truncate">{{ e.friendly_name || e.entity_id }}</div>
                              <div class="text-faint truncate">{{ e.entity_id }} · {{ e.state }}</div>
                            </div>
                          </div>
                        </div>
                        <p v-else class="px-3 py-1.5 text-xs text-faint font-body">无匹配实体</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <input
                        v-model="cond.to"
                        type="text"
                        placeholder="状态等于"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                      <input
                        v-model="cond.from"
                        type="text"
                        placeholder="状态不等于（可选）"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                    </div>
                  </template>

                  <!-- 数值范围条件 -->
                  <template v-else-if="cond.platform === 'numeric_state'">
                    <div class="entity-search relative">
                      <div
                        class="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus-within:border-primary/50 cursor-text"
                        @click.stop="cond._open = !cond._open; cond._search = ''"
                      >
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0">search</span>
                        <input
                          :value="entityDisplay(cond._search, cond.entity_id)"
                          type="text"
                          placeholder="搜索或选择实体…"
                          class="flex-1 min-w-0 bg-transparent outline-none text-xs font-body text-on-background placeholder:text-faint"
                          @input="cond._search = $event.target.value; cond._open = true"
                        />
                        <button
                          v-if="cond.entity_id"
                          class="flex-shrink-0 text-muted hover:text-on-surface"
                          @click.stop="cond.entity_id = ''; cond.above = ''; cond.below = ''; cond._search = ''"
                        >
                          <span class="material-symbols-outlined text-base">close</span>
                        </button>
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0" :class="cond._open ? 'rotate-180' : ''">expand_more</span>
                      </div>
                      <div
                        v-if="cond._open"
                        class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto"
                      >
                        <div v-if="getFilteredEntities(cond._search).length" class="py-1">
                          <div
                            v-for="e in getFilteredEntities(cond._search)"
                            :key="e.entity_id"
                            class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors"
                            :class="{ 'bg-primary/10': cond.entity_id === e.entity_id }"
                            @click="cond.entity_id = e.entity_id; cond._search = ''; cond._open = false"
                          >
                            <span class="text-muted material-symbols-outlined text-base flex-shrink-0">devices</span>
                            <div class="min-w-0 flex-1">
                              <div class="text-on-background truncate">{{ e.friendly_name || e.entity_id }}</div>
                              <div class="text-faint truncate">{{ e.entity_id }} · {{ e.state }}</div>
                            </div>
                          </div>
                        </div>
                        <p v-else class="px-3 py-1.5 text-xs text-faint font-body">无匹配实体</p>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 mt-1">
                      <input
                        v-model="cond.above"
                        type="number"
                        step="0.1"
                        placeholder="高于"
                        class="w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                      <span class="text-xs text-faint font-body flex-shrink-0">且</span>
                      <input
                        v-model="cond.below"
                        type="number"
                        step="0.1"
                        placeholder="低于"
                        class="w-full bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                    </div>
                  </template>

                  <!-- 时间窗口条件 -->
                  <template v-else-if="cond.platform === 'time'">
                    <div class="flex items-center gap-2">
                      <input
                        v-model="cond.at_from"
                        type="time"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      />
                      <span class="text-xs text-faint font-body flex-shrink-0">至</span>
                      <input
                        v-model="cond.at_to"
                        type="time"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      />
                    </div>
                  </template>

                  <!-- 日出日落条件 -->
                  <template v-else-if="cond.platform === 'sun'">
                    <div class="flex items-center gap-2">
                      <select
                        v-model="cond.event"
                        class="bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      >
                        <option value="sunrise">日出</option>
                        <option value="sunset">日落</option>
                      </select>
                      <input
                        v-model="cond.offset"
                        type="text"
                        placeholder="偏移（如 -30）"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                      />
                    </div>
                  </template>
                </div>
              </div>

              <button
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted font-body hover:border-primary/40 hover:text-primary transition-colors"
                @click="addCondition('state')"
              >
                <span class="material-symbols-outlined text-base">add</span> 添加条件
              </button>
            </template>

            <p v-if="wizard.conditions.length === 0 && !wizard.rawCondition" class="text-xs text-faint font-body mt-2">
              条件用于在执行动作前验证是否满足，可为空。
            </p>
          </div>

          <!-- 动作 -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs text-muted font-body">动作 <span class="text-error">*</span></label>
              <button
                class="text-xs text-primary font-body hover:text-primary/80 flex items-center gap-0.5"
                @click="addAction()"
              >
                <span class="material-symbols-outlined text-sm">add</span> 添加动作
              </button>
            </div>

            <div>
              <div v-for="(a, i) in wizard.actions" :key="i" class="space-y-2 mb-3 p-3 rounded-xl bg-surface-alt/60 border border-border/60">
                <!-- 动作类型（对应 HA 动作的 service / delay / wait_template / stop） -->
                <div class="flex items-center gap-2">
                  <span class="text-xs text-faint font-body flex-shrink-0 w-6">#{{ i + 1 }}</span>
                  <select
                    v-model="a.type"
                    class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                    @change="onActionTypeChange(a)"
                  >
                    <option v-if="a.raw" value="raw">复杂动作（原样保留）</option>
                    <option value="service">调用服务</option>
                    <option value="delay">延时</option>
                    <option value="wait_template">等待条件</option>
                    <option value="stop">停止</option>
                  </select>
                  <button v-if="i > 0" class="p-1 rounded text-faint hover:text-on-surface transition-colors" title="上移" @click="moveAction(i, -1)">
                    <span class="material-symbols-outlined text-sm">arrow_upward</span>
                  </button>
                  <button v-if="i < wizard.actions.length - 1" class="p-1 rounded text-faint hover:text-on-surface transition-colors" title="下移" @click="moveAction(i, 1)">
                    <span class="material-symbols-outlined text-sm">arrow_downward</span>
                  </button>
                  <button v-if="wizard.actions.length > 1" class="p-1 rounded text-faint hover:text-danger transition-colors" title="删除动作" @click="removeAction(i)">
                    <span class="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>

                <!-- 复杂动作（choose/repeat/device 等）：无法拆分编辑，保存时原样写回 -->
                <p v-if="a.raw" class="text-xs text-muted font-body">
                  该动作由 HA 高级编辑器创建，本页不拆分编辑，保存时原样写回。
                </p>

                <template v-else-if="a.type === 'service'">
                  <!-- 服务 -->
                  <div class="entity-search relative">
                    <label class="block text-xs text-muted font-body mb-1">服务 <span class="text-error">*</span></label>
                    <div
                      class="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus-within:border-primary/50 cursor-text"
                      @click.stop="a._svcOpen = !a._svcOpen"
                    >
                      <span class="material-symbols-outlined text-base text-muted flex-shrink-0">bolt</span>
                      <input
                        :value="a._svcSearch || (a.service ? serviceLabel(a.service) : '')"
                        type="text"
                        placeholder="搜索服务，如 light.turn_on"
                        class="flex-1 min-w-0 bg-transparent outline-none text-xs font-body text-on-background placeholder:text-faint"
                        @input="a._svcSearch = $event.target.value; a._svcOpen = true"
                      />
                      <button
                        v-if="a.service"
                        class="flex-shrink-0 text-muted hover:text-on-surface"
                        @click.stop="a.service = ''; a.params = {}; a._svcSearch = ''; a._svcOpen = false"
                      >
                        <span class="material-symbols-outlined text-base">close</span>
                      </button>
                      <span class="material-symbols-outlined text-base text-muted flex-shrink-0" :class="a._svcOpen ? 'rotate-180' : ''">expand_more</span>
                    </div>
                    <div v-if="a._svcOpen" class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      <div
                        v-if="a._svcSearch.trim() && !serviceOptions.some((s) => s.value === a._svcSearch.trim())"
                        class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors border-b border-border/60"
                        @click="selectActionService(i, a._svcSearch.trim())"
                      >
                        <span class="material-symbols-outlined text-base text-muted flex-shrink-0">edit</span>
                        <span class="truncate">直接使用「{{ a._svcSearch.trim() }}」</span>
                      </div>
                      <div v-if="filteredServices(a._svcSearch).length" class="py-1">
                        <div
                          v-for="s in filteredServices(a._svcSearch)"
                          :key="s.value"
                          class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors"
                          :class="{ 'bg-primary/10': a.service === s.value }"
                          @click="selectActionService(i, s.value)"
                        >
                          <span class="material-symbols-outlined text-base text-muted flex-shrink-0">bolt</span>
                          <div class="min-w-0 flex-1">
                            <div class="text-on-background truncate">{{ s.label }}</div>
                            <div class="text-faint truncate">{{ s.value }}</div>
                          </div>
                        </div>
                      </div>
                      <p v-else-if="!a._svcSearch" class="px-3 py-1.5 text-xs text-faint font-body">服务目录未加载，可在上方直接输入服务名</p>
                      <p v-else class="px-3 py-1.5 text-xs text-faint font-body">无匹配服务</p>
                    </div>
                  </div>

                  <!-- 目标实体 -->
                  <div class="entity-search relative">
                  <label class="block text-xs text-muted font-body mb-1">目标实体（可选）</label>
                  <div
                    class="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus-within:border-primary/50 cursor-text"
                    @click.stop="openActionDropdown === i ? (openActionDropdown = null) : openActionDropdown = i"
                  >
                    <span class="material-symbols-outlined text-base text-muted flex-shrink-0">search</span>
                    <input
                      :value="entityDisplay(actionSearches[i], a.entity)"
                      type="text"
                      placeholder="搜索或选择实体…"
                      class="flex-1 min-w-0 bg-transparent outline-none text-xs font-body text-on-background placeholder:text-faint"
                      @input="actionSearches[i] = $event.target.value; if(openActionDropdown !== i) openActionDropdown = i"
                    />
                    <button
                      v-if="a.entity"
                      class="flex-shrink-0 text-muted hover:text-on-surface"
                      @click.stop="a.entity = ''; actionSearches[i] = ''; openActionDropdown = null"
                    >
                      <span class="material-symbols-outlined text-base">close</span>
                    </button>
                    <span class="material-symbols-outlined text-base text-muted flex-shrink-0" :class="openActionDropdown === i ? 'rotate-180' : ''">expand_more</span>
                  </div>
                  <div
                    v-if="openActionDropdown === i"
                    class="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto"
                  >
                    <div v-if="getFilteredActionEntities(i).length" class="py-1">
                      <div
                        v-for="e in getFilteredActionEntities(i)"
                        :key="e.entity_id"
                        class="flex items-center gap-2 px-3 py-1.5 text-xs font-body cursor-pointer hover:bg-primary/10 transition-colors"
                        :class="{ 'bg-primary/10': a.entity === e.entity_id }"
                        @click="selectActionEntity(i, e.entity_id)"
                      >
                        <span class="text-muted material-symbols-outlined text-base flex-shrink-0">devices</span>
                        <div class="min-w-0 flex-1">
                          <div class="text-on-background truncate">{{ e.friendly_name || e.entity_id }}</div>
                          <div class="text-faint truncate">{{ e.entity_id }} · {{ e.state }}</div>
                        </div>
                      </div>
                    </div>
                    <p v-else class="px-3 py-1.5 text-xs text-faint font-body">无匹配实体</p>
                  </div>
                </div>
                <!-- 服务参数（按 HA 的 fields 定义生成，留空则不提交） -->
                  <div v-if="serviceFields(a).length" class="space-y-1.5">
                    <div v-for="f in serviceFields(a)" :key="f.name" class="flex items-center gap-2">
                      <label class="text-xs text-muted font-body w-24 flex-shrink-0 truncate" :title="f.description || f.name">
                        {{ f.name }}<span v-if="f.required" class="text-error">*</span>
                      </label>
                      <input
                        v-if="f.kind === 'boolean'"
                        type="checkbox"
                        class="flex-shrink-0 accent-primary"
                        :checked="a.params[f.name] === true"
                        @change="a.params[f.name] = $event.target.checked"
                      />
                      <select
                        v-else-if="f.kind === 'select'"
                        v-model="a.params[f.name]"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      >
                        <option value="">（默认）</option>
                        <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
                      </select>
                      <input
                        v-else-if="f.kind === 'number'"
                        v-model.number="a.params[f.name]"
                        type="number"
                        :min="f.min"
                        :max="f.max"
                        :step="f.step || 'any'"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      />
                      <input
                        v-else
                        v-model="a.params[f.name]"
                        type="text"
                        class="flex-1 min-w-0 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50"
                      />
                      <span v-if="f.unit" class="text-[11px] text-faint font-body flex-shrink-0">{{ f.unit }}</span>
                    </div>
                  </div>

                  <input
                    v-model="a.extra"
                    type="text"
                    placeholder='额外参数 JSON（可选），如 {"brightness": 200}'
                    class="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                  />
                </template>

                <!-- 延时 -->
                <template v-else-if="a.type === 'delay'">
                  <div class="grid grid-cols-3 gap-2">
                    <label class="text-xs text-muted font-body">
                      时
                      <input v-model="a.delayH" type="number" min="0" placeholder="0" class="w-full mt-1 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint" />
                    </label>
                    <label class="text-xs text-muted font-body">
                      分
                      <input v-model="a.delayM" type="number" min="0" placeholder="0" class="w-full mt-1 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint" />
                    </label>
                    <label class="text-xs text-muted font-body">
                      秒
                      <input v-model="a.delayS" type="number" min="0" placeholder="0" class="w-full mt-1 bg-surface border border-border rounded-lg px-2 py-1 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint" />
                    </label>
                  </div>
                  <p class="text-[11px] text-faint font-body">至少填写一个时间单位，对应 HA 的 delay。</p>
                </template>

                <!-- 等待条件 -->
                <template v-else-if="a.type === 'wait_template'">
                  <input
                    v-model="a.waitTemplate"
                    type="text"
                    placeholder="等待条件模板，如 is_state('binary_sensor.door', 'off')"
                    class="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                  />
                  <input
                    v-model="a.waitTimeout"
                    type="text"
                    placeholder="超时（可选），如 00:05:00"
                    class="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                  />
                </template>

                <!-- 停止 -->
                <template v-else>
                  <input
                    v-model="a.stopReason"
                    type="text"
                    placeholder="停止原因（可选，会写入日志）"
                    class="w-full bg-surface border border-border rounded-lg px-2.5 py-1.5 text-xs font-body text-on-background outline-none focus:border-primary/50 placeholder:text-faint"
                  />
                </template>
              </div>
              <p v-if="!wizard.actions.length" class="text-xs text-faint font-body">尚未添加动作。</p>
            </div>
          </div>

          <p v-if="wizard.triggers.length === 0 && !wizard.rawTrigger" class="text-[11px] text-warning font-body">
            提示：触发器为必填项，请添加触发器并选择触发设备或时间。
          </p>
        </div>

        <div class="px-5 py-4 border-t border-border/60 flex items-center justify-end gap-2 sticky bottom-0 bg-surface">
          <button class="px-4 py-2 rounded-lg text-sm text-muted font-body hover:text-on-surface hover:bg-surface-alt transition-colors" @click="wizard = null">取消</button>
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-body bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60"
            :disabled="wizard.saving"
            @click="saveWizard()"
          >
            <span v-if="wizard.saving" class="material-symbols-outlined text-base animate-spin">progress_activity</span>
            <span class="material-symbols-outlined text-base">{{ wizard.mode === 'edit' ? 'save' : 'add_circle' }}</span>
            {{ wizard.saving ? '保存中…' : (wizard.mode === 'edit' ? '保存修改' : '创建自动化') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <transition name="toast">
      <div
        v-if="toast.show"
        class="fixed top-5 left-1/2 -translate-x-1/2 z-[70] bg-surface border border-border rounded-xl px-4 py-2.5 text-sm font-body text-on-background shadow-xl flex items-center gap-2"
      >
        <span class="material-symbols-outlined text-base text-success">check_circle</span>
        {{ toast.text }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import api from '@/api'
import { store } from '@/store'
import { isOn, iconFor, attr } from '@/utils/entities'
import EmptyState from '@/components/EmptyState.vue'

// 场景卡配色轮换。
const scenePalettes = [
  { hoverText: 'group-hover:text-primary', text: 'text-primary', iconBox: 'bg-primary/10 border border-primary/20', trackOn: 'bg-primary/20 border border-primary/60', thumbOn: 'bg-primary', tagStyle: 'bg-primary/10 border border-primary/20 text-primary', corner: 'bg-primary/5', border: 'rgba(245,166,35,0.3)' },
  { hoverText: 'group-hover:text-accent', text: 'text-accent', iconBox: 'bg-accent/10 border border-accent/20', trackOn: 'bg-accent/20 border border-accent/60', thumbOn: 'bg-accent', tagStyle: 'bg-accent/10 border border-accent/20 text-accent', corner: 'bg-accent/5', border: 'rgba(94,196,176,0.3)' },
  { hoverText: 'group-hover:text-warning', text: 'text-warning', iconBox: 'bg-warning/10 border border-warning/20', trackOn: 'bg-warning/20 border border-warning/60', thumbOn: 'bg-warning', tagStyle: 'bg-warning/10 border border-warning/20 text-warning', corner: 'bg-warning/5', border: 'rgba(232,168,76,0.3)' },
  { hoverText: 'group-hover:text-info', text: 'text-info', iconBox: 'bg-info/10 border border-info/20', trackOn: 'bg-info/20 border border-info/60', thumbOn: 'bg-info', tagStyle: 'bg-info/10 border border-info/20 text-info', corner: 'bg-info/5', border: 'rgba(107,163,217,0.3)' },
  { hoverText: 'group-hover:text-success', text: 'text-success', iconBox: 'bg-success/10 border border-success/20', trackOn: 'bg-success/20 border border-success/60', thumbOn: 'bg-success', tagStyle: 'bg-success/10 border border-success/20 text-success', corner: 'bg-success/5', border: 'rgba(94,196,176,0.3)' },
]

// 场景与自动化：全部来自后端真实数据，无可展示数据时显示空态。
const scenes = ref([])
const rules = ref([])
const logs = ref([])
const stateFilter = ref('')

// 同步状态：记录上次成功同步时间戳与失败标记，驱动顶部相对时间显示
const lastSync = ref(0)
const syncFailed = ref(false)
const syncTick = ref(0) // 每 30s 自增，触发相对时间重新计算
let syncTimer = null
// 相对时间文案：刚刚 / N分钟前 / N小时前
const syncAgoText = computed(() => {
  syncTick.value // 依赖 tick 触发重算
  if (!lastSync.value) return '尚未同步'
  const diff = Date.now() - lastSync.value
  if (diff < 30000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return Math.floor(diff / 86400000) + ' 天前'
})

// 顶部 Toast（自包含实现，2.2s 自动消失）。
const toast = reactive({ show: false, text: '' })
let toastTimer = null
function showToast(text) {
  toast.text = text
  toast.show = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.show = false }, 2200)
}

// 实例 HA Web 地址（用于「在 HA 中打开」）。
function haBase() {
  const inst = store.instances.find((i) => i.id === store.activeID)
  return (inst && inst.url ? String(inst.url).replace(/\/+$/, '') : '')
}

// 在 HA Web UI 中打开：无 entity 打开场景页，有 entity 打开自动化编辑器。
function haOpen(entityId) {
  const base = haBase()
  if (!base) { showToast('当前实例未配置 HA 地址'); return }
  const path = entityId
    ? '/config/automation/' + String(entityId).replace(/^automation\./, '')
    : '/config/scene/dashboard'
  window.open(base + path, '_blank')
}

// 场景：点击卡片触发 scene.turn_on（对齐官方 App 的 press action 交互）。
function sceneFromEntity(e, i) {
  const p = scenePalettes[i % scenePalettes.length]
  const on = !!e && isOn(e)
  const disabled = !!e && (e.state === 'unavailable' || e.state === 'unknown')
  return {
    name: (e && (e.friendly_name || e.entity_id)) || '预设场景',
    icon: iconFor(e, 'scene'),
    desc: (e && attr(e, 'description')) || '点击卡片快速切换场景',
    tags: e && e.state ? [e.state] : ['点击执行'],
    _entity: e && e.entity_id,
    on,
    disabled,
    running: false,
    hoverText: p.hoverText, text: p.text, iconBox: p.iconBox,
    trackOn: p.trackOn, thumbOn: p.thumbOn,
    tagStyle: p.tagStyle, corner: p.corner, border: p.border,
  }
}

async function loadScenes() {
  if (!store.ready || store.activeID <= 0) return
  try {
    const { data } = await api.scenes(store.activeID)
    scenes.value = Array.isArray(data) ? data.map((e, i) => sceneFromEntity(e, i)) : []
    syncFailed.value = false
  } catch { scenes.value = []; syncFailed.value = true }
}

async function loadAutomations() {
  if (!store.ready || store.activeID <= 0) return
  try {
    const { data } = await api.automations(store.activeID)
    rules.value = Array.isArray(data) ? data.map((a) => {
      const on = !!a && isOn(a)
      const last = a && attr(a, 'last_triggered')
      return {
        name: (a && a.friendly_name) || (a && a.entity_id) || '未命名规则',
        icon: iconFor(a, 'rule_folder'),
        on,
        _entity: a && a.entity_id,
        lastTriggered: last ? new Date(last).toLocaleString('zh-CN', { hour12: false }) : '',
      }
    }) : []
    syncFailed.value = false
  } catch { rules.value = []; syncFailed.value = true }
}

async function loadLogs() {
  if (!store.ready || store.activeID <= 0) return
  try {
    const { data } = await api.logs(store.activeID, { start: Math.floor(Date.now() / 1000) - 86400, limit: 10 })
    logs.value = (Array.isArray(data) ? data : []).slice(-10).reverse()
  } catch { logs.value = [] }
}

function fmtTime(t) {
  if (!t) return ''
  const d = new Date(t)
  if (isNaN(d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 场景点击执行（官方 press action：点击即触发）。
async function runScene(s) {
  if (s.disabled || s.running || !s._entity) return
  s.running = true
  try {
    await api.callService(store.activeID, { domain: 'scene', service: 'turn_on', entity_id: s._entity })
    showToast(`场景「${s.name}」已执行`)
  } catch (e) {
    showToast(e.message || '场景执行失败')
  } finally { s.running = false }
}

// 自动化开关（官方 toggle 域：turn_on / turn_off）。
async function toggleRule(r) {
  const target = !r.on
  r.on = target
  if (!r._entity) return
  const action = target ? 'turn_on' : 'turn_off'
  try {
    await api.automationTurn(store.activeID, r._entity, action)
  } catch (e) {
    r.on = !target
    showToast(e.message || '切换失败')
  }
}

async function deleteRule(r) {
  if (!r._entity) return
  if (!window.confirm(`确定删除自动化「${r.name}」？此操作不可恢复。`)) return
  try {
    await api.deleteAutomation(store.activeID, r._entity)
    showToast('自动化已删除')
    loadAutomations()
  } catch (e) {
    showToast(e.message || '删除失败')
  }
}

// ---- 新建/编辑向导 ----
const wizard = ref(null)
const entityOptions = ref([])
let _triggerIdCounter = 0
let _condIdCounter = 0

function makeTrigger(platform = 'state') {
  return {
    id: ++_triggerIdCounter,
    platform,
    entity_id: '',
    to: '',
    from: '',
    event_type: '',
    at: '08:00',
    event: 'sunrise',
    offset: '',
    above: '',
    below: '',
    for: '',
    weekday: '',
    _open: false,
    _search: '',
  }
}

// 实体选择器搜索状态（仅用于动作行）
const actionSearches = ref({})
const openActionDropdown = ref(null) // key: action index or null

function getFilteredEntities(q) {
  const t = (q || '').trim().toLowerCase()
  if (!t) return entityOptions.value
  return entityOptions.value.filter((e) =>
    (e.friendly_name || '').toLowerCase().includes(t) ||
    e.entity_id.toLowerCase().includes(t)
  )
}

// 实体选择框的显示值：有搜索词时显示搜索词，否则显示已选实体的友好名称。
// 修复「选择后输入框空白、无法判断是否已选中」的问题。
function entityDisplay(searchStr, entityId) {
  if (searchStr) return searchStr
  if (!entityId) return ''
  const hit = entityOptions.value.find((e) => e.entity_id === entityId)
  return hit ? `${hit.friendly_name || hit.entity_id} (${hit.entity_id})` : entityId
}

function getFilteredActionEntities(idx) {
  return getFilteredEntities(actionSearches.value[idx])
}

function selectActionEntity(idx, entityId) {
  wizard.value.actions[idx].entity = entityId
  actionSearches.value[idx] = ''
  openActionDropdown.value = null
}

function closeAllDropdowns(e) {
  if (e.target.closest('.entity-search')) return
  openActionDropdown.value = null
  wizard.value?.triggers?.forEach((tr) => { tr._open = false })
  wizard.value?.actions?.forEach((a) => { a._svcOpen = false })
}

async function loadEntities() {
  if (!store.activeID || store.activeID <= 0) { entityOptions.value = []; return }
  try {
    const { data } = await api.entities({ instance: store.activeID })
    entityOptions.value = Array.isArray(data) ? data : []
  } catch { entityOptions.value = [] }
}

function blankWizard() {
  return {
    mode: 'create',
    entityId: '',
    alias: '',
    description: '',
    triggerLogic: 'or',
    rawTrigger: null,
    triggers: [makeTrigger('state')],
    conditionLogic: 'or',
    rawCondition: null,
    conditions: [],
    actions: [makeAction('service')],
    saving: false,
  }
}

function newWizard() {
  _triggerIdCounter = 0
  _condIdCounter = 0
  wizard.value = blankWizard()
  loadEntities()
  loadServiceCatalog()
}

function addTrigger(platform) {
  wizard.value.triggers.push(makeTrigger(platform || 'state'))
}

function removeTrigger(idx) {
  wizard.value.triggers.splice(idx, 1)
}

// ---- 条件编辑器 ----
function makeCondition(platform = 'state') {
  return {
    id: ++_condIdCounter,
    platform,
    entity_id: '',
    to: '',
    from: '',
    at_from: '',
    at_to: '',
    event: 'sunrise',
    offset: '',
    above: '',
    below: '',
    _open: false,
    _search: '',
  }
}

function addCondition(platform) {
  wizard.value.conditions.push(makeCondition(platform || 'state'))
}

function removeCondition(idx) {
  wizard.value.conditions.splice(idx, 1)
}

function onConditionPlatformChange(cond) {
  if (cond.platform === 'time') { cond.entity_id = ''; cond.to = ''; cond.from = ''; cond.event = 'sunrise'; cond.offset = ''; cond.above = ''; cond.below = '' }
  else if (cond.platform === 'state') { cond.at_from = ''; cond.at_to = ''; cond.event = 'sunrise'; cond.offset = ''; cond.above = ''; cond.below = '' }
  else if (cond.platform === 'sun') { cond.entity_id = ''; cond.to = ''; cond.from = ''; cond.at_from = ''; cond.at_to = ''; cond.above = ''; cond.below = '' }
  else if (cond.platform === 'numeric_state') { cond.to = ''; cond.from = ''; cond.at_from = ''; cond.at_to = ''; cond.event = 'sunrise'; cond.offset = '' }
}

function onTriggerPlatformChange(tr) {
  // 切换平台时重置特定字段
  if (tr.platform === 'time') { tr.at = tr.at || '08:00'; tr.entity_id = ''; tr.to = ''; tr.from = ''; tr.event_type = ''; tr.event = ''; tr.offset = ''; tr.above = ''; tr.below = ''; tr.for = ''; tr.weekday = '' }
  else if (tr.platform === 'state') { tr.at = ''; tr.event = 'sunrise'; tr.offset = ''; tr.above = ''; tr.below = '' }
  else if (tr.platform === 'sun') { tr.entity_id = ''; tr.to = ''; tr.from = ''; tr.event_type = ''; tr.at = ''; tr.above = ''; tr.below = '' }
  else if (tr.platform === 'numeric_state') { tr.to = ''; tr.event_type = ''; tr.at = ''; tr.event = ''; tr.offset = '' }
}

// 判断实体是否为二进制（有 on/off 状态）
const BINARY_DOMAINS = new Set([
  'light', 'switch', 'cover', 'valve', 'fan', 'garage_door', 'lock', 'door', 'window',
  'binary_sensor', 'person', 'device_tracker', 'camera', 'humidifier', 'dehumidifier',
  'plant', 'moisture', 'gas', 'smoke', 'sound_sensor', 'occupancy', 'presence',
  'motion', 'opening', 'water_leak', 'cold', 'heat', 'battery', 'connectivity',
])
function isBinaryEntity(entityId) {
  if (!entityId) return false
  const domain = entityId.split('.')[0]
  return BINARY_DOMAINS.has(domain)
}

// 编辑：拉取 HA 配置并回填（未知结构保留原文，保存时原样写回）。
async function openEdit(r) {
  if (!r._entity) return
  const w = blankWizard()
  w.mode = 'edit'
  w.entityId = r._entity
  wizard.value = w
  loadEntities()
  loadServiceCatalog()
  try {
    const { data } = await api.automationConfig(store.activeID, r._entity)
    applyConfig(data || {})
  } catch (e) {
    showToast(e.message || '读取配置失败')
    wizard.value = null
  }
}

function applyConfig(cfg) {
  const w = wizard.value
  w.alias = cfg.alias || ''
  w.description = cfg.description || ''
  const tr = Array.isArray(cfg.trigger) ? cfg.trigger : []

  if (tr.length === 0) {
    w.rawTrigger = null
    w.triggers = []
    w.triggerLogic = 'or'
    return
  }

  // 尝试将所有触发器解析为标准格式
  const parsed = []
  let allSimple = true
  for (const t of tr) {
    if (!t || typeof t !== 'object') { allSimple = false; break }
    const p = t.platform
    if (p === 'state') {
      parsed.push({
        platform: 'state',
        entity_id: t.entity_id || '',
        to: t.to || '',
        from: t.from || '',
        event_type: t.event_type || '',
        at: '', event: '', offset: '', above: '', below: '',
        for: t.for || '',
        weekday: t.weekday || '',
        _open: false, _search: '',
      })
    } else if (p === 'time') {
      parsed.push({
        platform: 'time', at: t.at || '08:00',
        entity_id: '', to: '', from: '', event_type: '',
        event: '', offset: '', above: '', below: '',
        for: t.for || '',
        weekday: t.weekday || '',
        _open: false, _search: '',
      })
    } else if (p === 'sun') {
      parsed.push({
        platform: 'sun', event: t.event || 'sunrise', offset: t.offset || '',
        entity_id: '', to: '', from: '', event_type: '', at: '',
        above: '', below: '',
        _open: false, _search: '',
      })
    } else if (p === 'numeric_state') {
      parsed.push({
        platform: 'numeric_state',
        entity_id: t.entity_id || '',
        above: String(t.above ?? ''),
        below: String(t.below ?? ''),
        to: '', from: '', event_type: '', at: '', event: '', offset: '',
        for: t.for || '',
        weekday: t.weekday || '',
        _open: false, _search: '',
      })
    } else {
      allSimple = false
    }
  }

  if (allSimple && parsed.length === tr.length) {
    w.rawTrigger = null
    w.triggers = parsed
    w.triggerLogic = 'or'
  } else {
    w.rawTrigger = tr
    w.triggers = []
  }

  // 条件
  const cnd = Array.isArray(cfg.condition) ? cfg.condition : []
  if (cnd.length) {
    const simpleCond = cnd.every((c) => c && typeof c === 'object' && c.platform)
    if (simpleCond) {
      w.rawCondition = null
      w.conditionLogic = 'or'
      w.conditions = cnd.map((c) => {
        const item = {
          id: ++_condIdCounter,
          platform: c.platform || 'state',
          entity_id: c.entity_id || '',
          to: c.to || '',
          from: c.from || '',
          at_from: c.at_from || c.at?.from || '',
          at_to: c.at_to || c.at?.to || '',
          event: c.event || 'sunrise',
          offset: c.offset || '',
          above: String(c.above ?? ''),
          below: String(c.below ?? ''),
          _open: false, _search: '',
        }
        return item
      })
    } else {
      w.rawCondition = cnd
      w.conditions = []
    }
  }

  // 动作
  const acts = Array.isArray(cfg.action) ? cfg.action : []
  if (acts.length) w.actions = acts.map((a) => parseAction(a))
}

// ---- 动作编辑器 ----
// 结构对齐 HA 的动作定义：调用服务 / 延时 / 等待 / 停止，顺序即执行顺序。
//   { service: "light.turn_on", entity_id, data: {...} }
//   { delay: { hours|minutes|seconds } }
//   { wait_template: "...", timeout: "00:05:00" }
//   { stop: "原因" }

// HA 服务目录（/api/services 透传），用于服务选择与参数表单。
const serviceCatalog = ref([])
let _catalogLoading = false

async function loadServiceCatalog() {
  if (serviceCatalog.value.length || _catalogLoading) return
  _catalogLoading = true
  try {
    const { data } = await api.serviceCatalog(store.activeID)
    serviceCatalog.value = Array.isArray(data) ? data : []
  } catch {
    serviceCatalog.value = []
  } finally {
    _catalogLoading = false
  }
}

// 拍平服务目录为可搜索列表。
const serviceOptions = computed(() => {
  const out = []
  for (const d of serviceCatalog.value) {
    const domain = d && d.domain
    if (!domain) continue
    for (const [name, meta] of Object.entries((d && d.services) || {})) {
      out.push({
        value: `${domain}.${name}`,
        label: (meta && meta.name) || name,
        fields: (meta && meta.fields) || {},
      })
    }
  }
  return out
})

// 服务下拉过滤：匹配 domain.service 或中文名，最多 50 条。
function filteredServices(q) {
  const t = (q || '').trim().toLowerCase()
  const list = t
    ? serviceOptions.value.filter((s) =>
      s.value.toLowerCase().includes(t) || (s.label || '').toLowerCase().includes(t))
    : serviceOptions.value
  return list.slice(0, 50)
}

function serviceLabel(value) {
  const hit = serviceOptions.value.find((s) => s.value === value)
  return hit ? `${hit.label}（${hit.value}）` : value
}

function selectActionService(i, value) {
  const a = wizard.value.actions[i]
  const prev = (a.service || '').split('.')[0]
  const next = (value || '').split('.')[0]
  a.service = value
  a._svcSearch = ''
  a._svcOpen = false
  // 换域时清空参数：旧参数对新服务多半非法（HA 同样会重置）。
  if (prev && prev !== next) a.params = {}
}

// HA selector → 输入控件类型。
function fieldMeta(name, f) {
  const sel = (f && f.selector) || {}
  let kind = 'text'
  if (sel.boolean) kind = 'boolean'
  else if (sel.number || sel.color_temp) kind = 'number'
  else if (sel.select) kind = 'select'
  const num = sel.number || sel.color_temp || {}
  return {
    name,
    description: (f && f.description) || '',
    required: !!(f && f.required),
    kind,
    options: (((sel.select && sel.select.options) || [])).map((o) =>
      typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label || o.value }),
    unit: num.unit_of_measurement || '',
    min: num.min,
    max: num.max,
    step: num.step,
  }
}

// 所选服务的可配置字段；目标类字段由「目标实体」统一处理，不重复渲染。
function serviceFields(a) {
  const hit = serviceOptions.value.find((s) => s.value === a.service)
  if (!hit) return []
  const skip = new Set(['entity_id', 'device_id', 'area_id', 'target'])
  return Object.entries(hit.fields || {})
    .filter(([name, f]) => {
      if (skip.has(name)) return false
      const sel = (f && f.selector) || {}
      return !sel.entity && !sel.device && !sel.area && !sel.target
    })
    .map(([name, f]) => fieldMeta(name, f))
}

function makeAction(type = 'service') {
  return {
    type,
    service: '',
    entity: '',
    params: {},
    extra: '',
    delayH: '',
    delayM: '',
    delayS: '',
    waitTemplate: '',
    waitTimeout: '',
    stopReason: '',
    raw: null,
    _svcOpen: false,
    _svcSearch: '',
  }
}

// HA 动作结构 → 编辑器模型；无法识别的结构（choose/repeat/device 等）放进 raw，
// 保存时原样写回，避免编辑后丢失配置。
function parseAction(a) {
  const raw = () => { const it = makeAction('service'); it.raw = a; return it }
  if (!a || typeof a !== 'object') return makeAction('service')

  if (a.delay !== undefined && Object.keys(a).length === 1) {
    const d = a.delay
    if (d && typeof d === 'object' &&
      Object.keys(d).every((k) => ['hours', 'minutes', 'seconds'].includes(k))) {
      const it = makeAction('delay')
      it.delayH = d.hours ?? ''
      it.delayM = d.minutes ?? ''
      it.delayS = d.seconds ?? ''
      return it
    }
    return raw()
  }

  if (a.wait_template !== undefined) {
    if (typeof a.wait_template !== 'string' ||
      Object.keys(a).some((k) => !['wait_template', 'timeout'].includes(k))) return raw()
    const it = makeAction('wait_template')
    it.waitTemplate = a.wait_template
    if (typeof a.timeout === 'string') it.waitTimeout = a.timeout
    return it
  }

  if (a.stop !== undefined && Object.keys(a).length === 1) {
    if (typeof a.stop !== 'string') return raw()
    const it = makeAction('stop')
    it.stopReason = a.stop
    return it
  }

  if (typeof a.service === 'string') {
    if (Object.keys(a).some((k) => !['service', 'entity_id', 'data', 'target'].includes(k))) return raw()
    const it = makeAction('service')
    it.service = a.service
    it.entity = a.entity_id || ''
    // HA 新版用 target.entity_id 表达目标；只识别单个实体，其它（区域/设备/多实体）原样保留。
    if (a.target !== undefined) {
      const t = a.target
      const one = t && typeof t === 'object' && Object.keys(t).length === 1 && t.entity_id !== undefined &&
        (typeof t.entity_id === 'string' ||
          (Array.isArray(t.entity_id) && t.entity_id.length === 1 && typeof t.entity_id[0] === 'string'))
      if (!one) return raw()
      it.entity = Array.isArray(t.entity_id) ? t.entity_id[0] : t.entity_id
    }
    if (a.data && typeof a.data === 'object') {
      it.params = { ...a.data }
      if (!it.entity && typeof it.params.entity_id === 'string') {
        it.entity = it.params.entity_id
        delete it.params.entity_id
      }
    } else if (typeof a.data === 'string') {
      it.extra = a.data
    }
    return it
  }

  return raw()
}

function addAction() {
  wizard.value.actions.push(makeAction('service'))
}

function removeAction(i) {
  wizard.value.actions.splice(i, 1)
}

// 动作顺序即执行顺序（HA 支持调整），这里用上移/下移实现。
function moveAction(i, delta) {
  const list = wizard.value.actions
  const j = i + delta
  if (j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item)
}

function onActionTypeChange(a) {
  a.raw = null // 从「复杂动作」切回标准类型时丢弃原样保留的结构
}

function buildTrigger() {
  const w = wizard.value
  if (w.rawTrigger) return w.rawTrigger
  // 返回所有有内容的触发器
  const result = w.triggers.filter((tr) => {
    if (tr.platform === 'state') return !!tr.entity_id
    if (tr.platform === 'time') return !!tr.at
    if (tr.platform === 'sun') return true
    if (tr.platform === 'numeric_state') return !!tr.entity_id
    return false
  }).map((tr) => {
    const item = { platform: tr.platform }
    if (tr.platform === 'state') {
      item.entity_id = tr.entity_id
      if (tr.to) item.to = tr.to
      if (tr.from) item.from = tr.from
      if (tr.event_type) item.event_type = tr.event_type
      if (tr.for) item.for = tr.for
      if (tr.weekday) item.weekday = tr.weekday
    } else if (tr.platform === 'time') {
      item.at = tr.at
    } else if (tr.platform === 'sun') {
      item.event = tr.event
      if (tr.offset) item.offset = tr.offset
    } else if (tr.platform === 'numeric_state') {
      item.entity_id = tr.entity_id
      if (tr.above) item.above = Number(tr.above)
      if (tr.below) item.below = Number(tr.below)
    }
    return item
  })
  return result
}

// 单个动作 → HA 动作结构；未填写完整时返回 null（保存前会拦截提示）。
function buildAction(a) {
  if (a.raw) return a.raw
  if (a.type === 'delay') {
    const d = {}
    if (a.delayH !== '' && a.delayH !== null && a.delayH !== undefined) d.hours = Number(a.delayH)
    if (a.delayM !== '' && a.delayM !== null && a.delayM !== undefined) d.minutes = Number(a.delayM)
    if (a.delayS !== '' && a.delayS !== null && a.delayS !== undefined) d.seconds = Number(a.delayS)
    return Object.keys(d).length ? { delay: d } : null
  }
  if (a.type === 'wait_template') {
    const tpl = (a.waitTemplate || '').trim()
    if (!tpl) return null
    const item = { wait_template: tpl }
    if (a.waitTimeout && a.waitTimeout.trim()) item.timeout = a.waitTimeout.trim()
    return item
  }
  if (a.type === 'stop') return { stop: (a.stopReason || '').trim() }
  const svc = (a.service || '').trim()
  if (!svc) return null
  const item = { service: svc }
  if (a.entity) item.entity_id = a.entity
  const data = {}
  for (const [k, v] of Object.entries(a.params || {})) {
    if (v === '' || v === null || v === undefined) continue
    data[k] = v
  }
  if (a.extra && a.extra.trim()) {
    try { Object.assign(data, JSON.parse(a.extra)) } catch { /* 非法 JSON 忽略，避免破坏自动化 */ }
  }
  if (Object.keys(data).length) item.data = data
  return item
}

// 完全空白的动作（用户没填任何内容）在保存时直接忽略。
function isActionEmpty(a) {
  if (a.raw) return false
  if (a.type === 'delay') return !(a.delayH || a.delayM || a.delayS)
  if (a.type === 'wait_template') return !(a.waitTemplate || '').trim()
  if (a.type === 'stop') return !(a.stopReason || '').trim()
  return !(a.service || '').trim() && !a.entity &&
    !Object.keys(a.params || {}).length && !(a.extra || '').trim()
}

function buildActions() {
  return wizard.value.actions
    .filter((a) => !isActionEmpty(a))
    .map(buildAction)
    .filter(Boolean)
}

function buildConditions() {
  const w = wizard.value
  if (w.rawCondition) return w.rawCondition
  return w.conditions
    .filter((c) => {
      if (c.platform === 'state') return !!c.entity_id
      if (c.platform === 'time') return !!(c.at_from || c.at_to)
      if (c.platform === 'sun') return true
      if (c.platform === 'numeric_state') return !!c.entity_id
      return false
    })
    .map((c) => {
      const item = { platform: c.platform }
      if (c.platform === 'state') {
        item.entity_id = c.entity_id
        if (c.to) item.to = c.to
        if (c.from) item.from = c.from
      } else if (c.platform === 'time') {
        item.at = {}
        if (c.at_from) item.at.from = c.at_from
        if (c.at_to) item.at.to = c.at_to
      } else if (c.platform === 'sun') {
        item.event = c.event
        if (c.offset) item.offset = c.offset
      } else if (c.platform === 'numeric_state') {
        item.entity_id = c.entity_id
        if (c.above) item.above = Number(c.above)
        if (c.below) item.below = Number(c.below)
      }
      return item
    })
}

async function saveWizard() {
  const w = wizard.value
  if (!w.alias.trim()) { showToast('请填写自动化名称'); return }
  // HA 的自动化必须至少有一个触发器，否则保存会被后端（HA）拒绝。
  if (!buildTrigger().length) { showToast('请至少添加一个触发器，并选择触发设备或时间'); return }
  const filled = w.actions.filter((a) => !isActionEmpty(a))
  if (!filled.length) { showToast('请至少添加一个动作'); return }
  if (filled.some((a) => buildAction(a) === null)) {
    showToast('有动作未填写完整：请选择服务、填写延时时长或等待条件')
    return
  }
  w.saving = true
  const cfg = {
    alias: w.alias.trim(),
    description: w.description.trim(),
    trigger: buildTrigger(),
    action: buildActions(),
    mode: 'single',
  }
  const conditions = buildConditions()
  if (conditions.length) cfg.condition = conditions
  try {
    if (w.mode === 'edit') {
      await api.updateAutomation(store.activeID, w.entityId, cfg)
      showToast('自动化已更新')
    } else {
      await api.createAutomation(store.activeID, cfg)
      showToast('自动化已创建')
    }
    wizard.value = null
    loadAutomations()
  } catch (e) {
    showToast(e.message || '保存失败')
  } finally {
    w.saving = false
  }
}

// 状态筛选与统计。
const filteredRules = computed(() => {
  if (!stateFilter.value) return rules.value
  return rules.value.filter((r) => (stateFilter.value === 'on') === !!r.on)
})

const stats = computed(() => {
  const sceneCount = scenes.value.filter((s) => s.on).length
  return [
    { label: '活跃场景', icon: 'scene', iconBg: 'bg-info/10', iconColor: 'text-info', value: `${sceneCount} <span class="text-xs text-muted font-body font-normal">个</span>`, valueColor: 'text-on-background' },
    { label: '自动化规则', icon: 'rule_folder', iconBg: 'bg-warning/10', iconColor: 'text-warning', value: `${rules.value.length} <span class="text-xs text-muted font-body font-normal">条</span>`, valueColor: 'text-on-background' },
    { label: '已启用', icon: 'toggle_on', iconBg: 'bg-success/10', iconColor: 'text-success', value: `${rules.value.filter((r) => r.on).length} <span class="text-xs text-muted font-body font-normal">条</span>`, valueColor: 'text-success' },
    { label: '最近日志', icon: 'receipt_long', iconBg: 'bg-primary/10', iconColor: 'text-primary', value: `${logs.value.length} <span class="text-xs text-muted font-body font-normal">条</span>`, valueColor: 'text-on-background' },
  ]
})

// 统一加载并更新同步时间戳
async function loadAll() {
  await Promise.all([loadScenes(), loadAutomations(), loadLogs()])
  if (!syncFailed.value) lastSync.value = Date.now()
}
onMounted(() => {
  loadAll()
  // 每 30s 自增 tick，驱动相对时间文案刷新
  syncTimer = setInterval(() => { syncTick.value++ }, 30000)
})
onUnmounted(() => { if (syncTimer) clearInterval(syncTimer) })
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
.rotate-180 {
  transform: rotate(180deg);
  transition: transform 0.15s ease;
}
</style>

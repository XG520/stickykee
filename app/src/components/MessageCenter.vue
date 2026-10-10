<template>
  <Teleport to="body">
    <Transition name="im-fade">
      <!-- 根层 fixed inset-0 但无背景：只是点击捕获层（点浮窗外即关闭），不遮蔽页面 -->
      <div v-if="imOpen" class="fixed inset-0 z-[80]" @click="closeIm">
        <!-- 气泡浮窗：
             手机端——底部浮层，四周留边距（app 仍可见，非全屏覆盖）；
             桌面端——右上角头像下方弹出的聊天窗，固定 24rem 宽 -->
        <div class="im-card-in absolute flex flex-col overflow-hidden bg-surface border border-border rounded-2xl shadow-2xl
                       left-2 right-2 bottom-2 top-auto h-[78dvh]
                       sm:left-auto sm:right-4 sm:bottom-auto sm:top-[4.5rem] sm:w-[24rem] sm:h-[min(36rem,calc(100vh-6rem))]"
          @click.stop>
          <!-- 会话列表面板 -->
          <div :class="['flex-1 min-h-0 flex-col bg-surface-alt/60', listVisible ? 'flex' : 'hidden']">
            <div class="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 class="font-headline text-on-background font-semibold text-base">消息与共享</h2>
              <button @click="closeIm" title="关闭" class="w-8 h-8 rounded-full hover:bg-surface flex items-center justify-center text-muted hover:text-on-surface transition-colors">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <!-- 新建会话 / 共享目标 -->
            <div class="px-3 pt-2">
              <button @click="togglePicker"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-on-primary text-sm font-medium hover:bg-primary-hover transition-colors">
                <span class="material-symbols-outlined text-base">add_comment</span> 发起会话 / 共享
              </button>
              <div v-if="showPicker" class="mt-2 max-h-56 overflow-y-auto rounded-xl bg-background border border-border p-1">
                <button v-for="u in candidates" :key="u"
                  @click="startChat(u)"
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-hover text-sm text-on-surface transition-colors text-left">
                  <span class="material-symbols-outlined text-accent text-base">account_circle</span> {{ u }}
                </button>
                <p v-if="!candidates.length" class="px-3 py-2 text-xs text-muted font-body">没有可聊天的用户</p>
              </div>
            </div>

            <!-- 会话列表 -->
            <div class="flex-1 overflow-y-auto py-2">
              <button v-for="c in convList" :key="c.user"
                @click="openConv(c.user)"
                class="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover/70 transition-colors text-left border-b border-border/50"
                :class="activeUser === c.user ? 'bg-surface-hover/70' : ''">
                <span class="material-symbols-outlined text-xl shrink-0"
                  :class="c.user === ASSISTANT ? 'text-primary' : 'text-accent'">{{ c.user === ASSISTANT ? 'smart_toy' : 'account_circle' }}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <p class="text-on-surface text-sm font-medium truncate">{{ displayName(c.user) }}</p>
                    <span v-if="c.pending && c.pending > 0" class="ml-2 px-1.5 py-0.5 rounded-full bg-error/15 text-error text-[10px] font-semibold shrink-0">共享{{ c.pending > 9 ? '9+' : c.pending }}</span>
                  </div>
                  <p class="text-muted text-xs truncate font-body">{{ lastPreview(c) }}</p>
                </div>
                <div class="flex flex-col items-end gap-0.5 shrink-0">
                  <span class="text-muted text-[10px] font-body">{{ fmtTime(c.last.created_at) }}</span>
                  <span v-if="c.unread > 0" class="w-5 h-5 rounded-full bg-error text-background text-[10px] font-bold flex items-center justify-center">{{ c.unread > 9 ? '9+' : c.unread }}</span>
                </div>
              </button>
              <p v-if="!conversations.length" class="px-4 py-6 text-muted text-xs text-center font-body">暂无会话</p>
            </div>
          </div>

          <!-- 消息线程 -->
          <div :class="['flex-1 min-h-0 flex-col min-w-0', threadVisible ? 'flex' : 'hidden']">
            <template v-if="activeUser">
              <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
                <button @click="backToList" title="返回会话列表" class="w-9 h-9 rounded-full -ml-1 hover:bg-surface-hover flex items-center justify-center text-muted hover:text-on-surface transition-colors shrink-0">
                  <span class="material-symbols-outlined">arrow_back</span>
                </button>
                <span class="material-symbols-outlined text-lg"
                  :class="isAssistant ? 'text-primary' : 'text-accent'">{{ isAssistant ? 'smart_toy' : 'account_circle' }}</span>
                <h3 class="text-on-background font-semibold text-sm truncate">{{ displayName(activeUser) }}</h3>
              </div>

              <div ref="listEl" class="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-background/40">
                <!-- 向上加载更早消息（游标分页） -->
                <div v-if="hasMore" class="text-center pb-1">
                  <button @click="loadOlder" :disabled="loadingOlder"
                    class="px-3 py-1 rounded-full border border-border text-muted hover:text-primary hover:border-primary/40 text-xs transition-colors disabled:opacity-60">
                    {{ loadingOlder ? '加载中…' : '加载更早消息' }}
                  </button>
                </div>
                <template v-for="m in messages" :key="m.id">
                  <!-- 撤回占位 -->
                  <div v-if="m.status === 'recalled'" class="flex" :class="m.from === auth.user ? 'justify-end' : 'justify-start'">
                    <p class="px-3 py-1 rounded-full bg-surface-alt border border-border text-muted text-xs italic font-body">
                      {{ m.from === auth.user ? '你撤回了一条消息' : `${m.from} 撤回了一条消息` }}
                    </p>
                  </div>
                  <div v-else class="flex group" :class="m.from === auth.user ? 'justify-end' : 'justify-start'">
                  <!-- 共享卡片 -->
                  <div v-if="m.type === 'share'" class="max-w-[85%] sm:max-w-[300px] w-full">
                    <div class="rounded-xl border border-border bg-surface-alt p-3 shadow-sm">
                      <p class="text-on-surface text-sm font-semibold flex items-center gap-1.5">
                        <span class="material-symbols-outlined text-primary text-base">dashboard</span> 仪表盘共享
                      </p>
                      <p class="mt-1 text-muted text-xs font-body">{{ shareStatus(m) }}</p>
                      <div v-if="showActions(m)" class="mt-2 flex gap-2">
                        <button @click="doAccept(m)" class="flex-1 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-on-primary text-xs font-semibold transition-colors">接受</button>
                        <button @click="doDecline(m)" class="flex-1 py-1.5 rounded-lg border border-border text-muted hover:text-error hover:border-error/40 text-xs transition-colors">拒绝</button>
                      </div>
                      <p v-if="m.status && !showActions(m)" class="mt-1.5 text-xs font-body" :class="m.status === 'accepted' ? 'text-success' : m.status === 'declined' ? 'text-muted' : 'text-accent'">
                        {{ m.status === 'accepted' ? '已接受' : m.status === 'declined' ? '已拒绝' : '待处理' }}
                      </p>
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body">{{ fmtTime(m.created_at) }}</p>
                  </div>

                  <!-- 设备卡片 -->
                  <div v-else-if="m.type === 'device'" class="max-w-[85%] sm:max-w-[300px] w-full">
                    <div class="rounded-xl border border-border bg-surface-alt p-3 shadow-sm"
                      :class="deviceAvailable(m) ? 'border-primary/30' : ''">
                      <div class="flex items-start gap-3">
                        <div class="w-10 h-10 rounded-xl bg-surface flex items-center justify-center border border-border shrink-0"
                          :class="{ 'bg-primary/15 border-primary/30': deviceAvailable(m) }">
                          <span class="material-symbols-outlined text-lg text-muted"
                            :class="{ 'text-primary': deviceAvailable(m), 'text-success': deviceBusyState(m) === 'on' }">
                            {{ deviceIcon(m) }}
                          </span>
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="text-on-surface text-sm font-semibold truncate">{{ deviceName(m) }}</p>
                          <p class="text-muted text-[11px] font-body truncate">{{ deviceEntityID(m) }}</p>
                          <p class="mt-1 text-xs font-body" :class="deviceStateTone(m)">{{ deviceStateText(m) }}</p>
                        </div>
                      </div>
                      <div class="mt-2.5 flex items-center gap-2">
                        <button v-if="deviceAvailable(m) && deviceTogglable(m)"
                          @click="deviceToggle(m)"
                          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          :class="deviceBusyState(m) === 'on'
                            ? 'bg-primary/15 text-on-primary hover:bg-primary/25'
                            : 'bg-primary hover:bg-primary-hover text-on-primary'">
                          <span class="material-symbols-outlined text-sm">{{ deviceBusyState(m) === 'on' ? 'toggle_on' : 'toggle_off' }}</span>
                          {{ deviceBusyState(m) === 'on' ? '已开启 · 点按关闭' : '关闭 · 点按开启' }}
                        </button>
                        <span v-else class="flex-1 text-center text-[11px] text-muted font-body py-1.5">匹配不到该设备</span>
                        <span v-if="debrief" class="text-success inline-flex items-center gap-0.5 text-[10px] font-body"><span class="material-symbols-outlined text-xs">done</span></span>
                      </div>
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body">{{ fmtTime(m.created_at) }}</p>
                  </div>

                  <!-- 图片消息 -->
                  <div v-else-if="m.type === 'image'" class="max-w-[85%] sm:max-w-[300px]">
                    <img :src="m.image?.url" :alt="m.image?.name || '图片'" loading="lazy"
                      @click="lightbox = m.image?.url || ''"
                      class="block max-h-64 w-auto rounded-2xl cursor-zoom-in border border-border shadow-sm bg-surface-alt"
                      :class="m.from === auth.user ? 'rounded-br-sm' : 'rounded-bl-sm'">
                    <p class="mt-1 px-1 text-muted text-[10px] font-body flex items-center gap-1" :class="m.from === auth.user ? 'justify-end' : ''">
                      {{ fmtTime(m.created_at) }}
                      <span v-if="m.from === auth.user" :class="m.read ? 'text-primary' : ''">{{ m.read ? '· 已读' : '· 已送达' }}</span>
                    </p>
                  </div>

                  <!-- 语音消息 -->
                  <div v-else-if="m.type === 'audio'" class="max-w-[85%]">
                    <div class="flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-2xl cursor-pointer active:opacity-80 transition-opacity"
                      :class="m.from === auth.user ? 'bg-primary text-on-primary rounded-br-sm' : 'bg-surface-alt border border-border text-on-surface rounded-bl-sm'"
                      @click="playAudio(m)">
                      <span class="material-symbols-outlined text-xl shrink-0">{{ playingId === m.id ? 'graphic_eq' : 'play_arrow' }}</span>
                      <div class="flex items-center gap-[2px] h-5">
                        <span v-for="i in 12" :key="i" class="w-[2px] rounded-full"
                          :class="m.from === auth.user ? 'bg-on-primary/80' : 'bg-primary/70'"
                          :style="{ height: waveBar(m, i) + 'px' }"></span>
                      </div>
                      <span class="text-xs tabular-nums shrink-0">{{ m.audio?.duration || 0 }}″</span>
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body flex items-center gap-1" :class="m.from === auth.user ? 'justify-end' : ''">
                      {{ fmtTime(m.created_at) }}
                      <span v-if="m.from === auth.user" :class="m.read ? 'text-primary' : ''">{{ m.read ? '· 已读' : '· 已送达' }}</span>
                    </p>
                  </div>

                  <!-- 文本气泡（含表情） -->
                  <div v-else class="max-w-[85%]">
                    <div class="px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words"
                      :class="m.from === auth.user ? 'bg-primary text-on-primary rounded-br-sm' : 'bg-surface-alt border border-border text-on-surface rounded-bl-sm'">
                      {{ m.content }}
                    </div>
                    <p class="mt-1 px-1 text-muted text-[10px] font-body flex items-center gap-1" :class="m.from === auth.user ? 'justify-end' : ''">
                      {{ fmtTime(m.created_at) }}
                      <span v-if="m.from === auth.user && m.to !== ASSISTANT" :class="m.read ? 'text-primary' : ''">{{ m.read ? '· 已读' : '· 已送达' }}</span>
                    </p>
                  </div>

                  <!-- 撤回按钮（自己的文本/图片/语音消息，悬停行内显示） -->
                  <button v-if="m.from === auth.user && (m.type === 'text' || m.type === 'image' || m.type === 'audio')" @click="doRecall(m)" title="撤回"
                    class="self-center w-7 h-7 rounded-full text-muted hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shrink-0">
                    <span class="material-symbols-outlined text-sm">undo</span>
                  </button>
                  </div>
                </template>
                <p v-if="!messages.length" class="text-muted text-center text-xs py-8 font-body">{{ isAssistant ? '向智家助手提问，如：打开客厅灯、今天天气怎样' : '没有消息，打个招呼吧' }}</p>
              </div>

              <!-- 输入区 -->
              <div class="border-t border-border px-4 py-3 bg-surface">
                <!-- 表情面板 -->
                <Transition name="im-pop">
                  <div v-if="showEmoji" class="mb-2 rounded-xl border border-border bg-background p-2 shadow-lg max-h-44 overflow-y-auto">
                    <div class="flex items-center gap-1 mb-1.5">
                      <span class="text-[10px] uppercase tracking-wide text-muted font-semibold font-body flex-1">表情</span>
                      <span class="material-symbols-outlined text-sm text-muted">emoticons</span>
                    </div>
                    <div class="grid grid-cols-6 sm:grid-cols-8 gap-1">
                      <button v-for="e in emojis" :key="e" @click="insertEmoji(e)"
                        class="w-9 h-9 sm:w-8 sm:h-8 rounded-lg hover:bg-surface-hover text-xl leading-none transition-colors flex items-center justify-center">{{ e }}</button>
                    </div>
                  </div>
                </Transition>
                <!-- 设备选择面板 -->
                <Transition name="im-pop">
                  <div v-if="showDevicePicker" class="mb-2 rounded-xl border border-border bg-background p-2 shadow-lg max-h-52 overflow-y-auto">
                    <div class="flex items-center gap-2 mb-1.5 px-1">
                      <span class="text-[10px] uppercase tracking-wide text-muted font-semibold font-body flex-1">发送设备（当前实例实体，对方按 entity_id 匹配后可直接控制）</span>
                      <button @click="reloadDevices" class="text-muted hover:text-primary transition-colors"><span class="material-symbols-outlined text-sm">refresh</span></button>
                    </div>
                    <p v-if="!deviceCandidates.length" class="px-2 py-3 text-center text-muted text-xs font-body">暂无实体，或尚未配置 HA token</p>
                    <div v-for="d in deviceCandidates" :key="d.entity_id" class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer" @click="sendDeviceCard(d)">
                      <span class="material-symbols-outlined text-base text-accent shrink-0">{{ domainIcon(d.domain) }}</span>
                      <span class="text-sm text-on-surface truncate flex-1">{{ d.friendly_name || d.entity_id }}</span>
                      <span class="text-muted text-[10px] font-body shrink-0">{{ d.domain }}</span>
                    </div>
                  </div>
                </Transition>

                <!-- 隐藏文件选择：相册 / 拍摄 -->
                <input ref="imgInput" type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" @change="onPickImage">
                <input ref="camInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onPickImage">

                <!-- 多人通话选择面板 -->
                <Transition name="im-pop">
                  <div v-if="showGroupPicker" class="mb-2 rounded-xl border border-border bg-background p-2 shadow-lg max-h-60 overflow-y-auto">
                    <div class="flex items-center justify-between mb-1.5 px-1">
                      <span class="text-[10px] uppercase tracking-wide text-muted font-semibold font-body">选择群聊成员</span>
                      <button @click="startGroupCall"
                        class="px-3 py-1 rounded-full bg-primary text-on-primary text-xs font-semibold">发起 ({{ groupCount }})</button>
                    </div>
                    <button v-for="u in candidates" :key="u" @click="toggleGroupUser(u)"
                      class="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-surface-hover text-sm text-on-surface transition-colors text-left">
                      <span class="w-5 h-5 rounded-md border flex items-center justify-center text-[10px]"
                        :class="groupSel[u] ? 'bg-primary border-primary text-on-primary' : 'border-border text-transparent'">check</span>
                      <span class="material-symbols-outlined text-accent text-base">account_circle</span> {{ u }}
                    </button>
                  </div>
                </Transition>

                <!-- 加号功能面板（微信式网格） -->
                <Transition name="im-pop">
                  <div v-if="showPlus" class="mb-2 grid grid-cols-4 gap-x-2 gap-y-3 rounded-xl border border-border bg-background p-3 shadow-lg">
                    <button @click="triggerCamera" class="im-plus-item flex flex-col items-center gap-1">
                      <span class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-accent">photo_camera</span></span>
                      <span class="text-[10px] text-muted font-body">拍摄</span>
                    </button>
                    <button @click="pickImage" class="im-plus-item flex flex-col items-center gap-1">
                      <span class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-accent">image</span></span>
                      <span class="text-[10px] text-muted font-body">相册</span>
                    </button>
                    <button @click="openDevicePicker" class="im-plus-item flex flex-col items-center gap-1">
                      <span class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-accent">devices_other</span></span>
                      <span class="text-[10px] text-muted font-body">设备</span>
                    </button>
                    <button @click="share" class="im-plus-item flex flex-col items-center gap-1">
                      <span class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-accent">share</span></span>
                      <span class="text-[10px] text-muted font-body">共享</span>
                    </button>
                    <button @click="beginOneCall" class="im-plus-item flex flex-col items-center gap-1">
                      <span class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-success">call</span></span>
                      <span class="text-[10px] text-muted font-body">语音通话</span>
                    </button>
                    <button @click="openGroupPicker" class="im-plus-item flex flex-col items-center gap-1">
                      <span class="w-11 h-11 rounded-xl bg-surface flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-success">groups</span></span>
                      <span class="text-[10px] text-muted font-body">语音群聊</span>
                    </button>
                  </div>
                </Transition>

                <!-- 输入行 -->
                <div class="flex items-center gap-2">
                  <button v-if="!isAssistant" @click="toggleVoiceMode" :title="voiceMode ? '切换键盘' : '切换语音'"
                    class="w-9 h-9 shrink-0 rounded-full text-muted hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors">
                    <span class="material-symbols-outlined text-xl">{{ voiceMode ? 'keyboard' : 'mic' }}</span>
                  </button>

                  <input v-if="!voiceMode" v-model="compose" @keyup.enter="send" :placeholder="isAssistant ? '问助手：天气、设备、闲聊…' : '输入消息…'"
                    :disabled="busy" @focus="closePanels"
                    class="flex-1 min-w-0 bg-background border border-border rounded-xl px-3 py-2 text-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none transition-colors">

                  <button v-else
                    class="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold text-on-surface active:bg-surface-hover transition-colors"
                    @touchstart.prevent="recStart" @touchend.prevent="recEnd" @touchmove.prevent="recMove" @touchcancel.prevent="recCancelOnly"
                    @mousedown="recStart" @mouseup="recEnd" @mouseleave="recEndIfActive">
                    按住&nbsp;说话
                  </button>

                  <button @click="toggleEmoji" :disabled="busy" title="表情"
                    class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors"
                    :class="showEmoji ? 'text-primary bg-primary/10' : 'text-muted hover:text-primary'">
                    <span class="material-symbols-outlined text-xl">mood</span>
                  </button>

                  <button v-if="!voiceMode && compose.trim()" @click="send"
                    class="shrink-0 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-on-primary text-sm font-semibold transition-colors">发送</button>
                  <button v-else-if="!isAssistant" @click="togglePlus" :disabled="busy" title="更多功能"
                    class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors"
                    :class="showPlus ? 'text-primary bg-primary/10' : 'text-muted hover:text-primary'">
                    <span class="material-symbols-outlined text-xl">add</span>
                  </button>
                </div>

                <!-- 录音中提示（浮窗内居中，微信式） -->
                <div v-if="recUI" class="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
                  <div class="rounded-2xl bg-black/75 px-6 py-5 flex flex-col items-center min-w-[8.5rem]">
                    <span class="material-symbols-outlined text-5xl" :class="recCancel ? 'text-error' : 'text-white'">
                      {{ recCancel ? 'mic_off' : 'mic' }}
                    </span>
                    <p class="mt-2 text-white text-sm font-semibold tabular-nums">{{ recSeconds }}″</p>
                    <p class="mt-1 text-white/70 text-[11px] font-body">{{ recCancel ? '松开手指，取消发送' : '松开发送，上滑取消' }}</p>
                  </div>
                </div>
                <p v-if="tip" class="mt-1.5 text-xs font-body" :class="tipErr ? 'text-error' : 'text-success'">{{ tip }}</p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
    <!-- 图片灯箱预览 -->
    <Transition name="im-fade">
      <div v-if="lightbox" class="fixed inset-0 z-[90] bg-black/85 flex items-center justify-center p-6 sm:p-10 cursor-zoom-out" @click="lightbox = ''">
        <img :src="lightbox" alt="预览" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl">
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import api from '@/api'
import { auth, imOpen, imRefresher, imConversations, closeIm, bumpIm, store, entityStates, requestEntityRefresh, refreshIm } from '@/store'
import { dashboardCardCount } from '@/utils/dashboard'
import { getPrefs } from '@/utils/prefs'
import { VoiceRecorder } from '@/utils/recorder'
import { startCall } from '@/utils/call'
import { openEnvelope, withCrypto } from '@/utils/crypto'

// ASSISTANT 与后端保留虚拟用户名一致（handler.AssistantUser）。
const ASSISTANT = 'ha-assistant'
const isAssistant = computed(() => activeUser.value === ASSISTANT)
function displayName(u) { return u === ASSISTANT ? '智家助手' : u }

// convList 会话列表：智家助手固定置顶——后端已有历史则展示真实条目（含未读），
// 否则补一条占位，保证入口常显。
const convList = computed(() => {
  const list = Array.isArray(conversations.value) ? conversations.value : []
  const ex = list.find((c) => c.user === ASSISTANT)
  const rest = list.filter((c) => c.user !== ASSISTANT)
  const head = ex || {
    user: ASSISTANT, unread: 0, pending: 0,
    last: { type: 'text', content: '问天气 · 控设备 · 聊家常' },
  }
  return [head, ...rest]
})

const conversations = imConversations
const activeUser = ref('')
const messages = ref([])
const compose = ref('')
const busy = ref(false)
const showPicker = ref(false)
const tip = ref('')
const tipErr = ref(false)
const listEl = ref(null)
const showEmoji = ref(false)
const showDevicePicker = ref(false)
const deviceCandidates = ref([])
const debrief = ref('')
// 图片消息 / 分页 / 撤回
const imgInput = ref(null)
const lightbox = ref('')
const hasMore = ref(false)
const loadingOlder = ref(false)
const PAGE = 50

// 浮窗为单列结构：列表与线程互斥切换（手机/桌面一致，类似客服气泡）。
// 会话列表可见：未进入会话时；消息线程可见：进入会话后。
const listVisible = computed(() => !activeUser.value)
const threadVisible = computed(() => !!activeUser.value)

function backToList() { activeUser.value = '' }
let debriefTimer = null

const emojis = [
  '😀','😁','😂','🤣','😊','😍','😘','😋',
  '😎','🤔','😴','🤗','🤩','😇','🙂','🥳',
  '😅','😭','😤','😡','🥺','😳','🤯','😱',
  '👍','👎','👏','🙌','🤝','💪','👌','✌️',
  '❤️','🔥','⭐','🎉','🎊','✨','💯','🌹',
  '❓','❗','✅','❌','🚀','🌙','☕','🍀',
]

const DOMAIN_ICONS = {
  light: 'lightbulb', switch: 'toggle_on', fan: 'mode_fan_off', cover: 'blinds',
  climate: 'thermostat', media_player: 'speaker_group', sensor: 'sensors',
  binary_sensor: 'sensors_off', lock: 'lock', camera: 'videocam', vacuum: 'cleaning_services',
  button: 'radio_button_checked', script: 'play_circle', scene: 'image', automation: 'bolt',
  number: 'tune', select: 'arrow_drop_down_circle', event: 'date_range', person: 'person',
}
function domainIcon(domain) { return DOMAIN_ICONS[domain] || 'devices_other' }

let tipTimer = null
function toast(msg, err = false) {
  tip.value = msg; tipErr.value = err
  if (tipTimer) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 5000)
}
function flash(marker) {
  debrief.value = marker
  if (debriefTimer) clearTimeout(debriefTimer)
  debriefTimer = setTimeout(() => (debrief.value = ''), 1800)
}

// 可选聊天对象：全部用户（去掉自己）。
const candidates = ref([])
async function loadCandidates() {
  try {
    const { data } = await api.listContacts()
    const list = Array.isArray(data) ? data : []
    candidates.value = list.filter((u) => u !== auth.user)
  } catch { candidates.value = [] }
}

// 展开选择器时重新拉取用户列表，保证刚新增的用户即时可选，无需刷新页面。
async function togglePicker() {
  showPicker.value = !showPicker.value
  if (showPicker.value) await loadCandidates()
}

function fmtTime(s) {
  if (!s) return ''
  const m = String(s).match(/(\d{2}):(\d{2})$/)
  return m ? `${m[1]}:${m[2]}` : String(s).slice(5, 16)
}

function lastPreview(c) {
  if (c.last?.status === 'recalled') return '消息已撤回'
  if (c.last?.type === 'share') return `🖥 ${c.card_count || '?'} 张卡片的仪表盘 · ${shareLabel(c.last.status)}`
  if (c.last?.type === 'device') {
    const name = c.last.device?.name || c.last.device?.entity_id || '设备'
    return `📟 ${name}`
  }
  if (c.last?.type === 'image') return '🖼 图片'
  if (c.last?.type === 'audio') return '🎤 语音消息'
  return c.last?.content || '新消息'
}

function shareLabel(st) {
  return st === 'accepted' ? '已接受' : st === 'declined' ? '已拒绝' : '待处理'
}
function shareStatus(m) {
  if (m.from === auth.user) return `已发送给 ${m.to}（${shareLabel(m.status)}），共一次快照`
  return `${m.from} 分享了一份仪表盘，接受后会覆盖你的仪表盘`
}
function showActions(m) {
  return m.type === 'share' && m.status === 'pending' && m.from !== auth.user
}

// ===== 设备卡片 =====
function deviceMeta(m) {
  const d = m.device || {}
  const eid = d.entity_id || ''
  return { name: d.name || d.friendlyName || (eid.split('.')[1] || ''), entity_id: eid, domain: d.domain || (eid.split('.')[0] || ''), device_class: d.device_class || '', icon: d.icon || '' }
}
function deviceName(m) { return deviceMeta(m).name || '设备' }
function deviceEntityID(m) { return deviceMeta(m).entity_id }
function deviceAvailable(m) { return !!entityStates[deviceEntityID(m)] }
function deviceState(m) { return entityStates[deviceEntityID(m)] || null }
function deviceBusyState(m) { return deviceState(m)?.state }
function deviceTogglable(m) {
  const dom = deviceMeta(m).domain
  return ['light', 'switch', 'fan', 'cover', 'media_player', 'lock', 'vacuum', 'climate', 'automation', 'script'].includes(dom)
}
function deviceIcon(m) {
  const meta = deviceMeta(m)
  return meta.icon === '' ? domainIcon(meta.domain) : domainIcon(meta.domain)
}
function deviceStateText(m) {
  const st = deviceState(m)
  if (!st) return '尚未匹配到该设备在你实例中的实体'
  const s = st.state
  const on = ['on', 'open', 'playing', 'unlocked'].includes(s)
  if (s === 'on' || s === 'open' || s === 'playing' || s === 'unlocked') return '● 开启中'
  if (s === 'off' || s === 'closed' || s === 'locked') return '○ 已关闭'
  if (st.unit_of_measurement != null || st.unit) return `${s}${st.unit_of_measurement || st.unit || ''}`
  return String(s).charAt(0).toUpperCase() + String(s).slice(1)
}
function deviceStateTone(m) {
  const s = deviceState(m)?.state
  if (['on', 'open', 'playing', 'unlocked'].includes(s)) return 'text-success'
  if (s === 'off' || s === 'closed' || s === 'locked') return 'text-muted'
  return 'text-on-surface'
}
async function deviceToggle(m) {
  if (busy.value) return
  const eid = deviceEntityID(m)
  if (!store.activeID || !eid) return
  busy.value = true
  try {
    await api.toggle(store.activeID, eid)
    requestEntityRefresh(250)
    flash('done')
  } catch (e) { toast(e.message || '控制失败', true) }
  finally { busy.value = false }
}

// ===== 设备选择 =====
async function openDevicePicker() {
  showDevicePicker.value = !showDevicePicker.value
  showEmoji.value = false
  showPlus.value = false
  showGroupPicker.value = false
  if (showDevicePicker.value && !deviceCandidates.value.length) await reloadDevices()
}
async function reloadDevices() {
  deviceCandidates.value = []
  if (!store.ready) return
  try {
    const { data } = await api.entities({ instance: store.activeID })
    deviceCandidates.value = Array.isArray(data)
      ? data.filter((e) => e.entity_id && ['light','switch','fan','cover','media_player','lock','vacuum','climate','automation','script'].includes(String(e.entity_id).split('.')[0]))
      : []
  } catch { deviceCandidates.value = [] }
}
async function sendDeviceCard(d) {
  if (busy.value || !activeUser.value) return
  busy.value = true
  try {
    const eid = d.entity_id
    const device = {
      entity_id: eid,
      name: d.friendly_name || (eid.split('.')[1] || eid),
      domain: eid.split('.')[0] || '',
      device_class: d.device_class || '',
      icon: d.icon || '',
    }
    await api.sendDevice(activeUser.value, device)
    showDevicePicker.value = false
    await loadMessages(activeUser.value)
    bumpIm()
    flash('done')
  } catch (e) { toast(e.message || '发送失败', true) }
  finally { busy.value = false }
}

// 表情
function insertEmoji(e) {
  compose.value += e
  showEmoji.value = false
}

async function loadMessages(user) {
  if (!user) return messages.value = []
  try {
    const { data } = await withCrypto(() => api.getMessages(user, PAGE))
    const plain = await openEnvelope(data)
    const list = Array.isArray(plain) ? plain : []
    messages.value = list
    hasMore.value = list.length >= PAGE
    scrollBottom()
  } catch { messages.value = [] }
}

// 向上加载更早消息：以当前最旧一条的 id 为游标；prepend 后保持视口停在原消息处
async function loadOlder() {
  if (loadingOlder.value || !activeUser.value || !messages.value.length) return
  loadingOlder.value = true
  const el = listEl.value
  const prevTop = el ? el.scrollTop : 0
  const prevHeight = el ? el.scrollHeight : 0
  try {
    const { data } = await withCrypto(() => api.getMessages(activeUser.value, PAGE, messages.value[0]?.id || 0))
    const olderRaw = await openEnvelope(data)
    const older = Array.isArray(olderRaw) ? olderRaw : []
    if (older.length) messages.value = [...older, ...messages.value]
    hasMore.value = older.length >= PAGE
    requestAnimationFrame(() => {
      if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight - prevHeight + prevTop
    })
  } catch (e) { toast(e.message || '加载失败', true) }
  finally { loadingOlder.value = false }
}

// 图片发送：本地预校验大小 → FormData 上传 → 刷新线程
function pickImage() { showPlus.value = false; imgInput.value?.click() }

// 拍摄：调起相机（桌面端降级为普通选图）
function triggerCamera() { showPlus.value = false; camInput.value?.click() }

// ================= 微信式面板与语音模式（各面板互斥） =================
const voiceMode = ref(false)
const showPlus = ref(false)
const showGroupPicker = ref(false)
const groupSel = reactive({})
const groupCount = computed(() => Object.values(groupSel).filter(Boolean).length)

function closePanels() {
  showEmoji.value = false
  showDevicePicker.value = false
  showPlus.value = false
  showGroupPicker.value = false
}
function toggleVoiceMode() { voiceMode.value = !voiceMode.value; closePanels() }
function toggleEmoji() {
  showEmoji.value = !showEmoji.value
  showDevicePicker.value = false
  showPlus.value = false
  showGroupPicker.value = false
}
function togglePlus() {
  showPlus.value = !showPlus.value
  showEmoji.value = false
  showDevicePicker.value = false
  showGroupPicker.value = false
}

// ================= 语音通话 =================
function beginOneCall() {
  if (!activeUser.value) return
  showPlus.value = false
  startCall([activeUser.value]).catch(() => {})
}
function openGroupPicker() {
  showGroupPicker.value = true
  showPlus.value = false
  showEmoji.value = false
  showDevicePicker.value = false
}
function toggleGroupUser(u) { groupSel[u] = !groupSel[u] }
async function startGroupCall() {
  const users = Object.keys(groupSel).filter((k) => groupSel[k])
  if (!users.length) { toast('请选择通话成员', true); return }
  showGroupPicker.value = false
  try { await startCall(users) } catch { /* 错误已提示 */ }
}

// ================= 按住说话（语音消息） =================
const recorder = new VoiceRecorder()
const recUI = ref(false)
const recCancel = ref(false)
const recSeconds = ref(0)
let recActive = false
let recTimer = null
let startY = 0
const CANCEL_PX = 60

async function recStart(e) {
  if (recActive || busy.value) return
  try {
    await recorder.start()
  } catch (err) { toast('无法访问麦克风：' + (err.message || ''), true); return }
  recActive = true
  recUI.value = true
  recCancel.value = false
  recSeconds.value = 0
  let n = 0
  recTimer = setInterval(() => { n++; recSeconds.value = n }, 1000)
  const t = e.touches ? e.touches[0] : e
  startY = t.clientY
}
function recMove(e) {
  if (!recActive) return
  const t = e.touches ? e.touches[0] : e
  recCancel.value = (startY - t.clientY) > CANCEL_PX
}
async function finishRec(cancel) {
  if (!recActive) return
  recActive = false
  recUI.value = false
  if (recTimer) { clearInterval(recTimer); recTimer = null }
  if (cancel) { await recorder.cancel(); return }
  const r = await recorder.stop()
  if (!r) return
  if (r.durationSec < 1) { toast('说话时间太短', true); return }
  const form = new FormData()
  form.append('file', r.blob, 'voice' + r.ext)
  form.append('duration', String(r.durationSec))
  try {
    await api.sendAudio(activeUser.value, form)
    bumpIm()
    scrollBottom()
  } catch (err) { toast(err.message || '语音发送失败', true) }
}
function recEnd() { finishRec(recCancel.value) }
function recCancelOnly() { finishRec(true) }
function recEndIfActive() { if (recActive) finishRec(recCancel.value) }

// ================= 语音消息播放（单例）与波形 =================
const playingId = ref('')
let audioEl = null
function playAudio(m) {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.onended = () => { playingId.value = '' }
    audioEl.onerror = () => { playingId.value = ''; toast('语音播放失败', true) }
  }
  if (playingId.value === m.id) {
    audioEl.pause(); audioEl.currentTime = 0; playingId.value = ''
    return
  }
  audioEl.src = m.audio?.url
  playingId.value = m.id
  audioEl.play().catch(() => { playingId.value = ''; toast('播放失败', true) })
}
// 波形条高度：消息 id + 位置生成稳定伪随机（5~18px）
function waveBar(m, i) {
  let h = (Number(m.id) || 0) + i * 7
  h = (h * 9301 + 49297) % 233280
  return 5 + (h / 233280) * 13
}
async function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !activeUser.value) return
  if (file.size > 8 * 1024 * 1024) { toast('图片不能超过 8MB', true); return }
  const form = new FormData()
  form.append('file', file)
  busy.value = true
  try {
    await api.sendImage(activeUser.value, form)
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (err2) { toast(err2.message || '图片发送失败', true) }
  finally { busy.value = false }
}

// 撤回自己的文本/图片消息
async function doRecall(m) {
  if (busy.value) return
  busy.value = true
  try {
    await api.recallMessage(m.id)
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (e) { toast(e.message || '撤回失败', true) }
  finally { busy.value = false }
}

function scrollBottom() {
  requestAnimationFrame(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

async function openConv(user) {
  activeUser.value = user
  showPicker.value = false
  if (user === ASSISTANT) voiceMode.value = false
  await loadMessages(user)
  try { await api.markMessageRead(user) } catch {}
  bumpIm()
}
function startChat(user) {
  openConv(user)
}

async function send() {
  const t = compose.value.trim()
  if (!t || !activeUser.value || busy.value) return
  busy.value = true
  try {
    await api.sendMessage(activeUser.value, t)
    compose.value = ''
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (e) { toast(e.message || '发送失败', true) }
  finally { busy.value = false }
}

async function share() {
  if (!activeUser.value || busy.value) return
  busy.value = true
  try {
    const { data } = await getPrefs()
    if (!data?.dashboard || dashboardCardCount(data.dashboard) === 0) {
      toast('当前仪表盘为空，请先在首页编辑并保存', true)
      return
    }
    await api.sendShare(activeUser.value, data.dashboard)
    await loadMessages(activeUser.value)
    bumpIm()
    toast('仪表盘已共享给对方')
  } catch (e) { toast(e.message || '共享失败', true) }
  finally { busy.value = false }
}

async function doAccept(m) {
  busy.value = true
  try {
    await api.acceptShare(m.id)
    await loadMessages(activeUser.value)
    bumpIm()
    toast('已接受，回到首页即为新的仪表盘')
  } catch (e) { toast(e.message || '接受失败', true) }
  finally { busy.value = false }
}
async function doDecline(m) {
  busy.value = true
  try {
    await api.declineShare(m.id)
    await loadMessages(activeUser.value)
    bumpIm()
  } catch (e) { toast(e.message || '操作失败', true) }
  finally { busy.value = false }
}

// 外部刷新信号：重拉会话，若在线程中则同步刷新消息。
watch(imRefresher, async () => {
  if (!imOpen.value) return
  if (activeUser.value) await loadMessages(activeUser.value)
})

// 线程保持打开期间，对方/助手的新消息到达时：store 收到 WS im 事件只刷新会话列表、
// 不 bump imRefresher，故这里监听「当前会话最后一条消息 id」的变化，自动重载消息并
// 标记已读，再直接 refreshIm 清角标（不 bump，避免 watcher 循环）。
// 否则用户正看着新消息（典型：助手问答的回复），顶栏与列表仍提示未读。
watch(
  () => imConversations.value.find((c) => c.user === activeUser.value)?.last?.id || 0,
  async (id, old) => {
    if (!imOpen.value || !activeUser.value || !id) return
    if (old == null || id <= old) return
    await loadMessages(activeUser.value)
    try {
      await api.markMessageRead(activeUser.value)
      await refreshIm()
    } catch { /* 忽略：下次打开该会话时 openConv 会补标 */ }
  },
)

// 打开抽屉时重拉可选用户（用户可能在别处新增过），关闭时收起选择器。
watch(imOpen, async (open) => {
  if (!open) { showPicker.value = false; return }
  await loadCandidates()
})

onMounted(async () => {
  await loadCandidates()
  bumpIm()
})
onBeforeUnmount(() => {
  if (tipTimer) clearTimeout(tipTimer)
  if (debriefTimer) clearTimeout(debriefTimer)
  if (audioEl) { audioEl.pause(); audioEl.src = '' }
  if (recActive) recorder.cancel()
})
</script>

<style>
.im-fade-enter-active, .im-fade-leave-active { transition: opacity .2s ease; }
.im-fade-enter-from, .im-fade-leave-to { opacity: 0; }
.im-pop-enter-active { transition: opacity .15s ease, transform .15s ease; }
.im-pop-leave-active { transition: opacity .12s ease, transform .12s ease; }
.im-pop-enter-from, .im-pop-leave-to { opacity: 0; transform: translateY(-4px); }

/* 气泡浮窗进场：上浮 + 轻微放大；手机端从右下角弹出，桌面端从头像方向（右上）弹出 */
@keyframes imCardIn {
  from { opacity: 0; transform: translateY(12px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
.im-card-in {
  animation: imCardIn .22s cubic-bezier(.2, .9, .3, 1.15);
  transform-origin: right bottom;
}
@media (min-width: 640px) {
  .im-card-in { transform-origin: right top; }
}
</style>
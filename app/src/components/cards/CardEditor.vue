<template>
  <Teleport to="body">
    <Transition name="ce">
      <div v-if="open && draft.type" class="ce-overlay" @mousedown.self="requestClose">
        <div class="ce-panel" role="dialog" aria-modal="true" aria-label="卡片工作室">
          <!-- ============ 顶栏 ============ -->
          <header class="ce-topbar">
            <div class="ce-brand">
              <div class="ce-type-icon" :class="meta.colorCls">
                <span class="material-symbols-outlined">{{ meta.icon }}</span>
              </div>
              <div class="ce-titles">
                <span class="ce-eyebrow">卡片工作室</span>
                <span class="ce-title">
                  {{ meta.label }}
                  <i v-if="dirty" class="ce-title-dot" title="有未保存的更改"></i>
                </span>
              </div>
            </div>
            <div class="ce-top-actions">
              <button class="ce-btn ce-ghost" @click="banner = banner === 'reset' ? null : 'reset'" title="将 HTML/CSS/JS 还原为该类型的默认模板">
                <span class="material-symbols-outlined">restart_alt</span>
                <span class="ce-btn-text">恢复默认</span>
              </button>
              <button class="ce-btn ce-ghost" :class="{ 'is-dirty': dirty }" @click="banner = banner === 'save-as-tpl' ? null : 'save-as-tpl'" title="把当前这张卡保存为模板（下次添加卡片时就能找到）">
                <span class="material-symbols-outlined">bookmark_add</span>
                <span class="ce-btn-text">保存为模板</span>
              </button>
              <button class="ce-btn ce-ghost" @click="requestClose">
                取消
                <kbd class="ce-kbd">Esc</kbd>
              </button>
              <button class="ce-btn ce-primary" :class="{ 'is-dirty': dirty }" @click="save">
                <span class="material-symbols-outlined">check</span>
                保存更改
                <kbd class="ce-kbd ce-kbd-light">Ctrl S</kbd>
              </button>
            </div>
          </header>

          <!-- 瞬时 toast：保存模板 / 保存更改 等操作的非阻断提示（顶栏下方，单条自动消失） -->
          <Transition name="ce-banner">
            <div v-if="topMsg" class="ce-banner" :class="{ 'ce-danger-banner': topMsg.err }">
              <span class="material-symbols-outlined ce-banner-icon">{{ topMsg.err ? 'error' : 'check_circle' }}</span>
              <span>{{ topMsg.text }}</span>
            </div>
          </Transition>

          <!-- ============ 二次确认横幅 ============ -->
          <Transition name="ce-banner">
            <div v-if="banner" class="ce-banner">
              <template v-if="banner === 'discard'">
                <span class="material-symbols-outlined ce-banner-icon">error</span>
                <span>有尚未保存的更改，关闭后这些修改将丢失。</span>
                <span class="ce-spacer"></span>
                <button class="ce-btn ce-ghost ce-btn-sm" @click="banner = null">继续编辑</button>
                <button class="ce-btn ce-danger-btn ce-btn-sm" @click="discardAndClose">放弃更改</button>
              </template>
              <template v-else-if="banner === 'save-as-tpl'">
                <span class="material-symbols-outlined ce-banner-icon">bookmark_add</span>
                <span class="flex items-center gap-2 flex-wrap">
                  <label class="ce-banner-label">模板名</label>
                  <input v-model="tplName" class="ce-input ce-input-sm w-40" maxlength="20" placeholder="我的模板" @keydown.enter="confirmSaveAsTpl" />
                  <label class="ce-banner-label">图标</label>
                  <input v-model="tplIcon" class="ce-input ce-input-sm w-28" maxlength="32" placeholder="construction" @keydown.enter="confirmSaveAsTpl" />
                  <label class="ce-banner-check ml-1">
                    <input type="checkbox" v-model="tplNeedEntity" />
                    需要绑定实体
                  </label>
                </span>
                <span class="ce-spacer"></span>
                <button class="ce-btn ce-ghost ce-btn-sm" @click="banner = null">取消</button>
                <button class="ce-btn ce-primary ce-btn-sm" :disabled="!tplName.trim() || savingAsTpl" @click="confirmSaveAsTpl">
                  <span class="material-symbols-outlined">{{ savingAsTpl ? 'progress_activity' : 'save' }}</span>保存为模板
                </button>
              </template>
              <template v-else-if="banner === 'reset'">
                <span class="material-symbols-outlined ce-banner-icon">restart_alt</span>
                <span>恢复默认会用内置模板覆盖当前的 HTML / CSS / JS 三段代码。</span>
                <span class="ce-spacer"></span>
                <button class="ce-btn ce-ghost ce-btn-sm" @click="banner = null">取消</button>
                <button class="ce-btn ce-primary ce-btn-sm" @click="resetToDefault">恢复</button>
              </template>
            </div>
          </Transition>

          <!-- ============ 主体：左功能栏 / 中画布 / 右面板 ============ -->
          <div class="ce-body">
            <!-- 左：功能图标栏（可折叠为纯图标） -->
            <aside class="ce-funcbar" :class="{ folded: funcFolded }">
              <button
                v-for="f in FUNC_ITEMS"
                :key="f.key"
                class="ce-func-btn"
                :class="{ on: !funcFolded && funcKey === f.key }"
                :title="f.label"
                @click="selectFunc(f.key)"
              >
                <span class="material-symbols-outlined">{{ f.icon }}</span>
                <span v-if="!funcFolded" class="ce-func-label">{{ f.label }}</span>
              </button>
              <span class="ce-spacer"></span>
              <button class="ce-func-btn ce-func-fold" :title="funcFolded ? '展开功能栏' : '折叠功能栏'" @click="funcFolded = !funcFolded">
                <span class="material-symbols-outlined">{{ funcFolded ? 'chevron_right' : 'chevron_left' }}</span>
              </button>
            </aside>

            <!-- 中：预览 / 图形设计舞台 -->
            <section class="ce-preview-col">
              <div class="ce-preview-head">
                <div class="ce-mode">
                  <button class="ce-mode-btn" :class="{ on: !designMode }" @click="designMode = false">
                    <span class="material-symbols-outlined">visibility</span>预览
                  </button>
                  <button class="ce-mode-btn" :class="{ on: designMode }" @click="enterDesign">
                    <span class="material-symbols-outlined">edit_note</span>设计
                  </button>
                </div>
                <span class="ce-preview-meta">{{ draft.w }}×{{ draft.h }} 格 · {{ pxW }}×{{ pxH }}px</span>
                <span class="ce-spacer"></span>
                <span class="ce-preview-scale">{{ Math.round(previewScale * 100) }}%</span>
              </div>
              <div ref="stageRef" class="ce-stage">
                <!-- 预览模式：1:1 渲染 + 等比缩放 -->
                <div v-if="!designMode" class="ce-slot" :style="slotStyle">
                  <div
                    :id="'preview-' + draft.uid"
                    class="ce-pholder"
                    :style="holderStyle"
                  >
                    <div class="hc-card-zoom" :style="zoomStyle">
                      <CodeCard :card="draft" :scope-id="'preview-' + draft.uid" />
                    </div>
                  </div>
                </div>
                <!-- 设计模式：可视化拖拽/改字/换图标/属性调整 -->
                <VisualStage
                  v-else
                  ref="visualStageRef"
                  :card="draft"
                  :scale="previewScale"
                  :cell-size="cellPx()"
                  :cols="cols"
                  :panel-el="designPanelRef"
                  @html="onVisualHtml"
                  @change-entity="onVisualChangeEntity"
                  @select="onVisualSelect"
                />
              </div>
            </section>

            <!-- 右：功能面板（随左栏选择切换） -->
            <aside class="ce-panel-col">
              <!-- 卡片设置：实体 / 标题 / 尺寸 / 图标 / 头像 -->
              <div v-show="funcKey === 'settings'" class="ce-panel-page ce-panel-scroll">
                <div class="ce-config">
                <div v-if="meta.needEntity || meta.entityOptional" class="ce-field ce-field-entity" ref="entityWrapRef">
                  <label class="ce-label">
                    绑定实体
                    <span v-if="multiEntity" class="ce-label-sub">已选 {{ draft.entity_ids.length }} 个 · 不限数量</span>
                  </label>
                  <!-- 单实体卡 -->
                  <div v-if="!multiEntity" class="ce-combobox">
                    <button type="button" class="ce-combo-btn" @click="toggleEntityMenu()">
                      <template v-if="currentEntity">
                        <span class="ce-domain-badge">{{ currentEntity.domain }}</span>
                        <span class="ce-combo-name">{{ currentEntity.friendly_name || currentEntity.entity_id }}</span>
                        <span class="ce-combo-id">{{ currentEntity.entity_id }}</span>
                      </template>
                      <span v-else class="ce-combo-empty">请选择 Home Assistant 实体…</span>
                      <span class="material-symbols-outlined ce-combo-caret">expand_more</span>
                    </button>
                    <Transition name="ce-menu">
                      <div v-if="entityMenu" class="ce-dropdown">
                        <div class="ce-search">
                          <span class="material-symbols-outlined">search</span>
                          <input
                            ref="entitySearchRef"
                            v-model="entityQuery"
                            class="ce-search-input"
                            type="text"
                            placeholder="搜索名称或 entity_id…"
                          />
                        </div>
                        <ul class="ce-entity-list">
                          <li
                            v-for="o in filteredEntities"
                            :key="o.id"
                            class="ce-entity-item"
                            :class="{ on: isEntityPicked(o.id) }"
                            @click="pickEntity(o.id)"
                          >
                            <span class="ce-domain-badge">{{ o.domain }}</span>
                            <span class="ce-en-text">
                              <span class="ce-en-name">{{ o.label }}</span>
                              <span class="ce-en-id">{{ o.id }}</span>
                            </span>
                            <span v-if="isEntityPicked(o.id)" class="material-symbols-outlined ce-en-check">check</span>
                          </li>
                          <!-- 可选实体卡（entityOptional）：提供「不绑定」出口，清除误绑/自动预选的实体 -->
                          <li
                            v-if="!multiEntity && meta.entityOptional && !meta.needEntity"
                            class="ce-entity-item"
                            :class="{ on: !draft.entity_id }"
                            @click="pickEntity('')"
                          >
                            <span class="ce-domain-badge"><span class="material-symbols-outlined" style="font-size:10px">block</span></span>
                            <span class="ce-en-text">
                              <span class="ce-en-name">不绑定实体</span>
                              <span class="ce-en-id">使用卡片默认数据源</span>
                            </span>
                            <span v-if="!draft.entity_id" class="material-symbols-outlined ce-en-check">check</span>
                          </li>
                          <li v-if="!filteredEntities.length" class="ce-entity-empty">
                            {{ entityOptions.length ? '没有匹配的实体' : '该类型暂无可用实体（需先连接 Home Assistant）' }}
                          </li>
                        </ul>
                      </div>
                    </Transition>
                  </div>
                  <!-- 多实体通用卡：已选列表 + 追加 -->
                  <div v-else class="ce-combobox ce-multi-box">
                    <ul class="ce-multi-list">
                      <li
                        v-for="(id, idx) in draft.entity_ids"
                        :key="id"
                        class="ce-entity-item ce-multi-item"
                      >
                        <span class="ce-domain-badge">{{ entityRowOf(id).domain }}</span>
                        <span class="ce-en-text">
                          <span class="ce-en-name">{{ entityRowOf(id).label }}</span>
                          <span class="ce-en-id">{{ id }}</span>
                        </span>
                        <span v-if="idx === 0" class="ce-primary-tag" title="卡片头部显示该实体">主</span>
                        <button type="button" class="ce-multi-del" title="移除该实体" @click="removeEntity(id)">
                          <span class="material-symbols-outlined">close</span>
                        </button>
                      </li>
                      <li v-if="!draft.entity_ids.length" class="ce-entity-empty">
                        尚未添加实体，点击下方按钮搜索添加
                      </li>
                    </ul>
                    <button type="button" class="ce-add-entity" @click="toggleEntityMenu(true)">
                      <span class="material-symbols-outlined">add</span>
                      添加实体
                      <span class="material-symbols-outlined ce-combo-caret" v-if="entityMenu">expand_less</span>
                    </button>
                    <Transition name="ce-menu">
                      <div v-if="entityMenu" class="ce-dropdown">
                        <div class="ce-search">
                          <span class="material-symbols-outlined">search</span>
                          <input
                            ref="entitySearchRef"
                            v-model="entityQuery"
                            class="ce-search-input"
                            type="text"
                            placeholder="搜索名称或 entity_id…"
                          />
                        </div>
                        <ul class="ce-entity-list">
                          <li
                            v-for="o in filteredEntities"
                            :key="o.id"
                            class="ce-entity-item"
                            :class="{ on: isEntityPicked(o.id) }"
                            @click="pickEntity(o.id)"
                          >
                            <span class="ce-domain-badge">{{ o.domain }}</span>
                            <span class="ce-en-text">
                              <span class="ce-en-name">{{ o.label }}</span>
                              <span class="ce-en-id">{{ o.id }}</span>
                            </span>
                            <span v-if="isEntityPicked(o.id)" class="material-symbols-outlined ce-en-check">check</span>
                          </li>
                          <li v-if="!filteredEntities.length" class="ce-entity-empty">
                            {{ entityOptions.length ? '没有匹配的实体' : '暂无可用实体（需先连接 Home Assistant）' }}
                          </li>
                        </ul>
                        <div class="ce-dd-foot">
                          <span class="ce-dd-tip">点击实体即可加入 / 移除，可连续添加，不限数量</span>
                          <button type="button" class="ce-btn ce-primary ce-btn-sm" @click="entityMenu = false">完成</button>
                        </div>
                      </div>
                    </Transition>
                  </div>
                </div>

                <!-- 人员信息卡：扩展绑定槽位（中部循环翻动 / 底部滚动轮播，均不限数量、不限域） -->
                <div v-for="slot in extraSlots" :key="slot.key" class="ce-field ce-field-entity ce-slot-box">
                  <label class="ce-label">
                    {{ slot.label }}
                    <span class="ce-label-sub">已选 {{ draft[slot.key].length }} 个 · 不限数量</span>
                  </label>
                  <!-- 默认折叠态：只显示数量摘要 + 添加按钮，避免多实体时每个槽位框占满 132px -->
                  <div v-if="!slotExpanded[slot.key]" class="ce-slot-collapsed">
                    <span class="ce-slot-num">{{ draft[slot.key].length }}</span>
                    <span class="ce-slot-num-sub">个实体</span>
                    <button type="button" class="ce-btn ce-ghost ce-btn-sm ce-slot-act" @click="slotExpanded[slot.key] = true">
                      <span class="material-symbols-outlined">expand_more</span>展开
                    </button>
                    <button type="button" class="ce-btn ce-primary ce-btn-sm" @click="toggleSlotMenu(slot.key)">
                      <span class="material-symbols-outlined">add</span>添加
                    </button>
                  </div>
                  <!-- 展开态：完整 chip list + 收起/添加按钮 -->
                  <template v-else>
                    <div class="ce-combobox ce-multi-box">
                      <ul class="ce-multi-list">
                        <li
                          v-for="(id, idx) in draft[slot.key]"
                          :key="id"
                          class="ce-entity-item ce-multi-item"
                        >
                          <span class="ce-domain-badge">{{ slotRowOf(id).domain }}</span>
                          <span class="ce-en-text">
                            <span class="ce-en-name">{{ slotRowOf(id).label }}</span>
                            <span class="ce-en-id">{{ id }}</span>
                          </span>
                          <span class="ce-multi-act">
                            <button type="button" class="ce-multi-mv" title="上移" :disabled="idx === 0" @click.stop="moveSlotEntity(slot.key, id, -1)">
                              <span class="material-symbols-outlined">expand_less</span>
                            </button>
                            <button type="button" class="ce-multi-mv" title="下移" :disabled="idx === draft[slot.key].length - 1" @click.stop="moveSlotEntity(slot.key, id, 1)">
                              <span class="material-symbols-outlined">expand_more</span>
                            </button>
                            <button type="button" class="ce-multi-del" title="移除该实体" @click.stop="removeSlotEntity(slot.key, id)">
                              <span class="material-symbols-outlined">close</span>
                            </button>
                          </span>
                        </li>
                        <li v-if="!draft[slot.key].length" class="ce-entity-empty">
                          {{ slot.empty }}
                        </li>
                      </ul>
                    </div>
                    <div class="ce-slot-actions">
                      <button type="button" class="ce-btn ce-ghost ce-btn-sm ce-slot-act" @click="slotExpanded[slot.key] = false">
                        <span class="material-symbols-outlined">expand_less</span>收起
                      </button>
                      <button type="button" class="ce-add-entity" @click="toggleSlotMenu(slot.key)">
                        <span class="material-symbols-outlined">add</span>添加实体
                        <span class="material-symbols-outlined ce-combo-caret" v-if="slotMenuKey === slot.key">expand_less</span>
                      </button>
                    </div>
                  </template>
                  <!-- 下拉搜索菜单：独立于折叠/展开，始终渲染，v-if 由 slotMenuKey 控制显示 -->
                  <Transition name="ce-menu">
                    <div v-if="slotMenuKey === slot.key" class="ce-dropdown">
                      <div class="ce-search">
                        <span class="material-symbols-outlined">search</span>
                        <input
                          ref="slotSearchRef"
                          v-model="slotQuery"
                          class="ce-search-input"
                          type="text"
                          placeholder="搜索名称或 entity_id…"
                        />
                      </div>
                      <ul class="ce-entity-list">
                        <li
                          v-for="o in filteredSlotEntities"
                          :key="o.id"
                          class="ce-entity-item"
                          :class="{ on: draft[slot.key].includes(o.id) }"
                          @click="pickSlotEntity(o.id)"
                        >
                          <span class="ce-domain-badge">{{ o.domain }}</span>
                          <span class="ce-en-text">
                            <span class="ce-en-name">{{ o.label }}</span>
                            <span class="ce-en-id">{{ o.id }}</span>
                          </span>
                          <span v-if="draft[slot.key].includes(o.id)" class="material-symbols-outlined ce-en-check">check</span>
                        </li>
                        <li v-if="!filteredSlotEntities.length" class="ce-entity-empty">
                          {{ allEntityOptions.length ? '没有匹配的实体' : '暂无可用实体（需先连接 Home Assistant）' }}
                        </li>
                      </ul>
                      <div class="ce-dd-foot">
                        <span class="ce-dd-tip">点击实体即可加入 / 移除，可连续添加，不限数量</span>
                        <button type="button" class="ce-btn ce-primary ce-btn-sm" @click="slotMenuKey = ''">完成</button>
                      </div>
                    </div>
                  </Transition>
                </div>

                <div v-if="meta.needEntity" class="ce-field ce-field-title">
                  <label class="ce-label">
                    卡片标题
                    <span class="ce-label-sub">设备卡建议用物理设备名，留空取首个实体名</span>
                  </label>
                  <input
                    class="ce-icon-input ce-title-input"
                    type="text"
                    v-model="draft.title"
                    placeholder="如 客厅吸顶灯"
                    spellcheck="false"
                  />
                </div>

                <div class="ce-field ce-field-size">
                  <label class="ce-label">卡片尺寸</label>
                  <div class="ce-sizepick">
                    <div
                      v-for="i in 12"
                      :key="i"
                      class="ce-size-cell"
                      :class="sizeCellClass(i)"
                      @mouseenter="hoverCell = i"
                      @mouseleave="hoverCell = 0"
                      @click="pickSize(i)"
                    ></div>
                  </div>
                  <span class="ce-size-text">{{ draft.w }} 格宽 × {{ draft.h }} 格高</span>
                </div>

                <div class="ce-field ce-field-icon">
                  <label class="ce-label">
                    自定义图标
                    <span class="ce-label-sub">留空使用实体 / 默认图标</span>
                  </label>
                  <div class="ce-icon-row">
                    <div class="ce-icon-preview" :title="draft.icon || '默认图标'">
                      <span class="material-symbols-outlined" :style="draft.icon ? 'color:rgb(var(--c-primary))' : ''">{{ draft.icon || 'image' }}</span>
                    </div>
                    <input
                      class="ce-icon-input"
                      type="text"
                      v-model="iconInput"
                      placeholder="图标名称，如 av_timer"
                      spellcheck="false"
                      @input="applyIconInput"
                      @keydown.enter.prevent="applyIconInput"
                    />
                    <button type="button" class="ce-btn ce-ghost ce-btn-sm" :disabled="!draft.icon" @click="clearCardIcon" title="恢复默认图标">
                      <span class="material-symbols-outlined">backspace</span>清除
                    </button>
                  </div>
                  <div class="ce-icon-sugs">
                    <button v-for="n in iconSugs" :key="n" type="button" class="ce-icon-sug" :class="{ on: draft.icon === n }" @click="pickCardIcon(n)" :title="n">
                      <span class="material-symbols-outlined">{{ n }}</span>
                    </button>
                  </div>
                </div>

                <!-- 自定义头像（人员位置卡 / 人员信息卡共用同一字段与上传逻辑） -->
                <div v-if="draft.type === 'person' || draft.type === 'personInfo'" class="ce-field ce-field-avatar">
                  <label class="ce-label">
                    自定义头像
                    <span class="ce-label-sub">上传图片（自动缩放 256px），留空使用实体图片</span>
                  </label>
                  <div class="ce-avatar-row">
                    <div class="ce-avatar-preview">
                      <img v-if="draft.avatar" :src="draft.avatar" alt="" />
                      <span v-else class="material-symbols-outlined">person</span>
                    </div>
                    <div class="ce-avatar-actions">
                      <label class="ce-btn ce-ghost ce-btn-sm" title="上传本地图片作为头像">
                        <span class="material-symbols-outlined">upload</span>上传
                        <input ref="avatarFileRef" type="file" accept="image/*" class="ce-hidden-input" @change="onPickAvatar" />
                      </label>
                      <button type="button" class="ce-btn ce-ghost ce-btn-sm" :disabled="!draft.avatar" @click="clearAvatar" title="恢复实体图片 / 默认头像">
                        <span class="material-symbols-outlined">backspace</span>清除
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              </div>

              <!-- 元素：选中元素的属性面板（VisualStage 注入） + 元素代码 -->
              <div v-show="funcKey === 'element'" class="ce-panel-page ce-panel-col-flex">
                <div v-if="!designMode" class="ce-panel-tipbox">
                  <span class="material-symbols-outlined">info</span>
                  <p>「模型」在图形设计模式下可用。请切换到中间画布的「设计」模式后点选模型。</p>
                  <button class="ce-btn ce-primary ce-btn-sm" @click="enterDesign">进入设计模式</button>
                </div>
                <template v-else>
                  <!-- 卡片所有元素列表：点击选中并联动画布/属性面板 -->
                  <div class="ce-elems">
                    <p v-if="!layerTree.length" class="ce-ly-empty">当前卡片没有可编辑的模型</p>
                    <div
                      v-for="row in layerTree"
                      :key="row.vid"
                      class="ce-ly-row"
                      :class="{ on: row.vid === elVid, surf: row.isSurface }"
                      :style="{ paddingLeft: 8 + row.depth * 12 + 'px' }"
                      @click="selectLayer(row)"
                    >
                      <span class="material-symbols-outlined ce-ly-ic">{{ layerIcon(row) }}</span>
                      <em class="ce-ly-name">{{ layerName(row) }}</em>
                      <i v-if="row.isPop" class="ce-ly-badge">弹窗</i>
                    </div>
                  </div>
                  <!-- 元素属性面板挂载点 -->
                  <div v-show="rightView === 'props'" ref="designPanelRef" class="ce-design-panel">
                    <div class="ce-dp-placeholder">
                      <span class="material-symbols-outlined">ads_click</span>
                      <p class="ce-dp-title">在上方列表或画布点选一个模型</p>
                    </div>
                  </div>
                  <!-- 选中元素：CSS 样式编辑（内联 style） + HTML 代码 -->
                  <template v-if="elVid">
                    <div class="ce-elcss">
                      <div class="ce-elcss-head">
                        <span class="material-symbols-outlined">palette</span>
                        <span class="ce-elcss-title">CSS 样式</span>
                        <span class="ce-spacer"></span>
                        <button class="ce-elcss-codebtn" :class="{ on: rightView === 'elcode' }" title="查看/编辑该模型完整 HTML" @click="rightView === 'elcode' ? (rightView = 'props') : openElCodeView()">
                          <span class="material-symbols-outlined">data_object</span>{{ rightView === 'elcode' ? '收起代码' : '模型代码' }}
                        </button>
                        <button class="ce-elcss-codebtn ce-elcss-del" :disabled="elIsSurface" title="删除该模型（画布上按 Delete 键同效）" @click="deleteSelectedEl">
                          <span class="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                      <textarea
                        v-show="rightView !== 'elcode'"
                        class="ce-elcss-ta"
                        :value="elCss"
                        placeholder="color:#fff; font-size:14px; border-radius:8px;"
                        spellcheck="false"
                        autocomplete="off"
                        @input="onElCssInput"
                      ></textarea>
                    </div>
                  </template>
                </template>
              </div>

              <!-- 组件库（插入元素）：点按插入到卡片中央，鼠标可拖到画布落点 -->
              <div v-show="funcKey === 'widgets'" class="ce-panel-page ce-panel-col-flex">
                <div v-if="!designMode" class="ce-panel-tipbox">
                  <span class="material-symbols-outlined">info</span>
                  <p>「模型库」在图形设计模式下可用。请切换到中间画布的「设计」模式。</p>
                  <button class="ce-btn ce-primary ce-btn-sm" @click="enterDesign">进入设计模式</button>
                </div>
                <div v-else class="ce-palette">
                  <p class="ce-pal-tip">
                    <span class="material-symbols-outlined">info</span>
                    点按插入到卡片中央；鼠标可按住拖到画布上指定位置（插入后自动选中，可在模型属性里微调）
                  </p>
                  <div v-for="g in WIDGET_GROUPS" :key="g.key" class="ce-pal-group">
                  <p class="ce-pal-gtitle">{{ g.label }}</p>
                  <div class="ce-pal-grid">
                    <button
                      v-for="w in widgetsOf(g.key)"
                      :key="w.key"
                      class="ce-pal-tile"
                      :title="'插入：' + w.label"
                      @click="insertWidgetAt(w)"
                      @pointerdown="onPaletteDown($event, w)"
                    >
                      <span class="material-symbols-outlined">{{ w.icon }}</span>
                      <em>{{ w.label }}</em>
                    </button>
                  </div>
                </div>
                <p v-if="paletteMsg" class="ce-pal-msg" :class="{ err: paletteMsg.err }">
                  <span class="material-symbols-outlined">{{ paletteMsg.err ? 'error' : 'check_circle' }}</span>{{ paletteMsg.text }}
                </p>
                </div>
              </div>

              <!-- 图层：元素树（点击选中）+ 同容器内顺序调整 -->
              <div v-show="funcKey === 'layers'" class="ce-panel-page ce-panel-col-flex">
                <div v-if="!designMode" class="ce-panel-tipbox">
                  <span class="material-symbols-outlined">info</span>
                  <p>「图层」在图形设计模式下可用。请切换到中间画布的「设计」模式。</p>
                  <button class="ce-btn ce-primary ce-btn-sm" @click="enterDesign">进入设计模式</button>
                </div>
                <div v-else class="ce-layers">
                <p class="ce-pal-tip">
                  <span class="material-symbols-outlined">info</span>
                  以 DOM 顺序为准；鼠标按住行可拖到同容器其它行之间重排
                </p>
                <p v-if="!layerTree.length" class="ce-ly-empty">当前卡片没有可编辑的模型</p>
                <div
                  v-for="(row, i) in layerTree"
                  :key="row.vid"
                  class="ce-ly-row"
                  :class="{ on: row.vid === elVid, surf: row.isSurface, drop: dropIndex === i }"
                  :style="{ paddingLeft: 8 + row.depth * 12 + 'px' }"
                  @click="selectLayer(row)"
                  @pointerdown="onLayerDown($event, i, row)"
                >
                  <span class="material-symbols-outlined ce-ly-ic">{{ layerIcon(row) }}</span>
                  <em class="ce-ly-name">{{ layerName(row) }}</em>
                  <i v-if="row.isPop" class="ce-ly-badge">弹窗</i>
                  <span class="ce-ly-acts" @pointerdown.stop @click.stop>
                    <button title="置于最上层" :disabled="row.isSurface" @click="doLayerOp(row, 'front')"><span class="material-symbols-outlined">vertical_align_top</span></button>
                    <button title="上移一层" :disabled="row.isSurface" @click="doLayerOp(row, 'up')"><span class="material-symbols-outlined">arrow_upward</span></button>
                    <button title="下移一层" :disabled="row.isSurface" @click="doLayerOp(row, 'down')"><span class="material-symbols-outlined">arrow_downward</span></button>
                    <button title="置于最下层" :disabled="row.isSurface" @click="doLayerOp(row, 'back')"><span class="material-symbols-outlined">vertical_align_bottom</span></button>
                  </span>
                </div>
                <p v-if="layerMsg" class="ce-pal-msg err">
                  <span class="material-symbols-outlined">error</span>{{ layerMsg }}
                </p>
                </div>
              </div>

              <!-- AI：自然语言生成整卡 HTML / CSS -->
              <div v-show="funcKey === 'ai'" class="ce-panel-page ce-panel-scroll">
                <div class="ce-ai">
                  <p class="ce-pal-tip">
                    <span class="material-symbols-outlined">info</span>
                    用自然语言描述想要的卡片，AI 会生成 HTML / CSS 并直接应用到当前卡片，可一键恢复生成前的内容。
                  </p>
                  <div class="ce-ai-field">
                    <label class="ce-label">
                      使用实体
                      <span v-if="aiPicked.length" class="ce-label-sub">已选 {{ aiPicked.length }}</span>
                    </label>
                    <input v-model="aiEntityFilter" class="ce-ai-input" placeholder="搜索实体名称或 entity_id…" />
                    <div class="ce-ai-entities">
                      <label
                        v-for="e in aiEntityRows"
                        :key="e.id"
                        class="ce-ai-entity"
                        :class="{ on: aiPicked.includes(e.id) }"
                      >
                        <input v-model="aiPicked" type="checkbox" :value="e.id" />
                        <span class="ce-ai-en-name">{{ e.name }}</span>
                        <span class="ce-ai-en-id">{{ e.id }}</span>
                      </label>
                      <p v-if="!aiEntityRows.length" class="ce-ai-empty">
                        {{ aiEntityFilter ? '没有匹配的实体' : '暂无可用实体（需先连接 Home Assistant）' }}
                      </p>
                    </div>
                    <p class="ce-ai-hint">勾选后生成会自动绑定第 1 个实体，AI 可用的实时占位符也会随之变化。</p>
                  </div>
                  <div class="ce-ai-field">
                    <label class="ce-label">描述</label>
                    <textarea
                      v-model="aiPrompt"
                      class="ce-ai-ta"
                      rows="5"
                      placeholder="例如：客厅温湿度卡片，大号温度数字，底部显示湿度和更新时间"
                    ></textarea>
                  </div>
                  <div class="ce-ai-sugs">
                    <button v-for="s in AI_SUGGESTIONS" :key="s" class="ce-ai-sug" @click="aiPrompt = s">{{ s }}</button>
                  </div>
                  <label class="ce-ai-check">
                    <input v-model="aiKeep" type="checkbox" />
                    以当前卡片为基础修改
                  </label>
                  <div class="ce-ai-actions">
                    <button class="ce-btn ce-primary" :disabled="aiBusy || !aiPrompt.trim()" @click="runAiGenerate">
                      <span class="material-symbols-outlined" :class="{ 'ce-ai-spin': aiBusy }">{{ aiBusy ? 'progress_activity' : 'auto_awesome' }}</span>
                      {{ aiBusy ? '生成中…' : '生成卡片' }}
                    </button>
                    <button v-if="aiBackup" class="ce-btn ce-ghost" :disabled="aiBusy" @click="restoreAi">恢复生成前</button>
                  </div>
                  <p v-if="aiErr" class="ce-pal-msg err">
                    <span class="material-symbols-outlined">error</span>{{ aiErr }}
                  </p>
                  <p v-else-if="aiMsg" class="ce-pal-msg">
                    <span class="material-symbols-outlined">check_circle</span>{{ aiMsg }}
                  </p>
                  <p class="ce-ai-hint">
                    使用「设置 → AI」中配置的模型（我的配置优先，其次管理员全局配置）。生成会覆盖 HTML / CSS，JS 与规则保持不变。
                  </p>
                </div>
              </div>

              <!-- 逻辑：ESPHome 式规则列表（如果…就…否则…），绑定画布 [data-vid] 元素 -->
              <div v-show="funcKey === 'logic'" class="ce-panel-page ce-panel-scroll">
                <LogicPanel :rules="draft.rules" :html="draft.html" />
              </div>

              <!-- 代码：卡片 HTML / CSS / JS 编辑 -->
              <div v-show="funcKey === 'code'" class="ce-panel-page ce-panel-col-flex">
                <div class="ce-tabs" role="tablist">
                  <button
                    v-for="t in langTabs"
                    :key="t.key"
                    role="tab"
                    class="ce-tab"
                    :class="{ on: tab === t.key }"
                    @click="switchTab(t.key)"
                  >
                    <i class="ce-lang-dot" :class="'dot-' + t.key"></i>
                    {{ t.label }}
                    <span class="ce-tab-len">{{ codeOf(t.key).split('\n').length }}</span>
                  </button>
                  <span class="ce-spacer"></span>
                  <span class="ce-tab-hint"><kbd class="ce-kbd">Ctrl</kbd>+<kbd class="ce-kbd">1~3</kbd> 切换</span>
                </div>
                <!-- 代码编辑区：行号 + 高亮层 + 透明 textarea -->
                <div class="ce-code">
                  <div class="ce-gutter" aria-hidden="true">
                    <div ref="gutterInnerRef" class="ce-gutter-inner">
                      <div v-for="n in lineCount" :key="n" class="ce-gutter-line">{{ n }}</div>
                    </div>
                  </div>
                  <div ref="scrollRef" class="ce-code-scroll">
                    <pre ref="preRef" class="ce-pre" aria-hidden="true"><code v-html="highlighted[tab]"></code></pre>
                    <textarea
                      ref="taRef"
                      class="ce-ta"
                      :class="{ 'is-composing': composing }"
                      :value="draft[tab]"
                      spellcheck="false"
                      autocapitalize="off"
                      autocomplete="off"
                      wrap="off"
                      :aria-label="currentTab.label + ' 代码'"
                      @input="onCodeInput"
                      @scroll="onScroll"
                      @keydown="onKeydown"
                      @compositionstart="composing = true"
                      @compositionend="composing = false"
                    ></textarea>
                  </div>
                </div>
              </div>

              <!-- 元素代码：只显示并编辑选中元素的 HTML（输入实时应用到卡片） -->
              <div v-show="funcKey === 'element' && designMode && rightView === 'elcode'" class="ce-elcode">
                <div class="ce-elcode-head">
                  <span class="material-symbols-outlined">data_object</span>
                  <span class="ce-elcode-title">模型代码</span>
                  <code class="ce-elcode-desc">{{ elDesc }}</code>
                  <span class="ce-spacer"></span>
                  <button class="ce-btn ce-ghost ce-btn-sm" title="放弃当前修改，重新载入该模型的代码" @click="refreshElCode">
                    还原
                  </button>
                  <button class="ce-btn ce-primary ce-btn-sm" title="将代码应用到卡片（输入时已实时应用）" @click="applyElCode">
                    应用
                  </button>
                </div>
                <div class="ce-code ce-elcode-editor">
                  <div class="ce-gutter" aria-hidden="true">
                    <div ref="elGutterRef" class="ce-gutter-inner">
                      <div v-for="n in elLineCount" :key="n" class="ce-gutter-line">{{ n }}</div>
                    </div>
                  </div>
                  <div ref="elScrollRef" class="ce-code-scroll">
                    <pre ref="elPreRef" class="ce-pre" aria-hidden="true"><code v-html="elHighlighted"></code></pre>
                    <textarea
                      ref="elTaRef"
                      class="ce-ta"
                      :class="{ 'is-composing': elComposing }"
                      spellcheck="false"
                      autocapitalize="off"
                      autocomplete="off"
                      wrap="off"
                      :value="elHtml"
                      :aria-label="'模型 ' + elDesc + ' HTML 代码'"
                      @input="onElInput"
                      @scroll="syncElScroll"
                      @keydown="onElKeydown"
                      @compositionstart="elComposing = true"
                      @compositionend="elComposing = false"
                    ></textarea>
                  </div>
                </div>
                <p v-if="elCodeErr" class="ce-elcode-err">
                  <span class="material-symbols-outlined">error</span>{{ elCodeErr }}
                </p>
              </div>
            </aside>
          </div>

          <!-- ============ 底部状态栏 ============ -->
          <footer class="ce-status">
            <span class="ce-status-item">
              <i class="ce-lang-dot" :class="'dot-' + tab"></i>
              {{ currentTab.name }} · {{ lineCount }} 行 · {{ charCount }} 字符
            </span>
            <span class="ce-status-item ce-dirty-state" :class="{ on: dirty }">
              <i class="ce-status-dot"></i>{{ dirty ? '未保存更改' : '所有更改已保存' }}
            </span>
            <span class="ce-spacer"></span>
            <span v-for="h in currentTab.hints" :key="h" class="ce-hint"><code>{{ h }}</code></span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { entityStates } from '@/store'
import api from '@/api'
import { computeData } from './data'
import { cardDefaults } from './defaults'
import { WIDGET_DEFS, WIDGET_GROUPS } from './widgets'
import { saveAsTemplate } from '@/composables/useCustomTemplates'
// 卡片设计师技能文档：作为 system prompt 注入 /ai/chat（Vite ?raw 原样内联，维护直接改 md 文件）
import CARD_DESIGNER_SKILL from '@/ai/card-designer.md?raw'
import CodeCard from './CodeCard.vue'
import VisualStage from './VisualStage.vue'
import LogicPanel from './LogicPanel.vue'
const props = defineProps({
  open: { type: Boolean, default: false },
  card: { type: Object, default: null },
  // 真实网格当前每格像素宽 / 列数（用于让预览与实际渲染 1:1 一致）
  cellSize: { type: Number, default: 0 },
  cols: { type: Number, default: 8 },
})
const emit = defineEmits(['close', 'save'])

const baseCell = 120

// ================= 草稿与脏状态 =================
const draft = reactive({ type: '', uid: '', entity_id: '', entity_ids: [], entity_ids2: [], entity_ids3: [], entity_ids_status: [], w: 1, h: 1, html: '', css: '', js: '', icon: '', avatar: '', title: '', _designerSchema: null, compiledHtml: '', entitySlotMap: {}, rules: [] })
let snapshot = ''
const dirty = computed(() => JSON.stringify(pickDraft()) !== snapshot)

function pickDraft() {
  return {
    w: draft.w, h: draft.h, html: draft.html, css: draft.css, js: draft.js,
    entity_id: metaOf(draft.type).needEntity || metaOf(draft.type).entityOptional ? draft.entity_id : '',
    entity_ids: ['generic', 'person', 'group'].includes(draft.type) ? [...draft.entity_ids] : [],
    entity_ids2: draft.type === 'personInfo' ? [...draft.entity_ids2] : [],
    entity_ids3: draft.type === 'personInfo' ? [...draft.entity_ids3] : [],
    entity_ids_status: draft.type === 'personInfo' ? [...draft.entity_ids_status] : [],
    icon: draft.icon,
    avatar: draft.avatar,
    title: draft.title || '',
    _designerSchema: draft._designerSchema,
    compiledHtml: draft.compiledHtml,
    entitySlotMap: draft.entitySlotMap,
    // 规则列表（如果…就…否则…）：深拷贝去响应式，空数组也保存以允许用户清空
    rules: JSON.parse(JSON.stringify(draft.rules || [])),
  }
}
// 通用卡与人员位置卡为多实体卡（不限数量）；其余卡仍为单实体
const multiEntity = computed(() => ['generic', 'person', 'group'].includes(draft.type))
function syncPrimaryEntity() { draft.entity_id = draft.entity_ids[0] || '' }
function metaOf(type) { return cardDefaults[type] || cardDefaults.greeting }
const meta = computed(() => metaOf(draft.type))

watch(
  () => props.open,
  (open) => {
    if (open && props.card) {
      draft.type = props.card.type
      draft.uid = props.card.uid
      draft.entity_id = props.card.entity_id || ''
      draft.entity_ids = Array.isArray(props.card.entity_ids)
        ? props.card.entity_ids.filter(Boolean)
        : (props.card.entity_id ? [props.card.entity_id] : [])
      draft.entity_ids2 = Array.isArray(props.card.entity_ids2) ? props.card.entity_ids2.filter(Boolean) : []
      draft.entity_ids3 = Array.isArray(props.card.entity_ids3) ? props.card.entity_ids3.filter(Boolean) : []
      draft.entity_ids_status = Array.isArray(props.card.entity_ids_status) ? props.card.entity_ids_status.filter(Boolean) : []
      draft.w = props.card.w || 1
      draft.h = props.card.h || 1
      draft.html = props.card.html || ''
      draft.css = props.card.css || ''
      draft.js = props.card.js || ''
      draft.icon = props.card.icon || ''
      iconInput.value = draft.icon
      draft.avatar = props.card.avatar || ''
      draft.title = props.card.title || ''
      draft._designerSchema = props.card._designerSchema || null
      draft.compiledHtml = props.card.compiledHtml || ''
      draft.entitySlotMap = props.card.entitySlotMap || {}
      // 规则列表深拷贝入草稿：编辑只改草稿，保存时才写回卡片
      draft.rules = Array.isArray(props.card.rules) ? JSON.parse(JSON.stringify(props.card.rules)) : []
      tab.value = 'html'
      banner.value = null
      entityQuery.value = ''
      slotMenuKey.value = ''
      slotQuery.value = ''
      hoverCell.value = 0
      designMode.value = false
      snapshot = JSON.stringify(pickDraft())
      nextTick(() => {
        syncScroll()
        computePreviewScale()
        if (stageRef.value && !ro) {
          ro = new ResizeObserver(computePreviewScale)
          ro.observe(stageRef.value)
        }
      })
    }
  },
  { immediate: true },
)

// ================= 顶栏操作 =================
const banner = ref(null)
function requestClose() {
  if (dirty.value && banner.value !== 'discard') banner.value = 'discard'
  else if (!dirty.value) emit('close')
}
function discardAndClose() {
  banner.value = null
  emit('close')
}
function resetToDefault() {
  const d = cardDefaults[draft.type]
  if (!d) return
  draft.html = d.html
  draft.css = d.css
  draft.js = d.js
  banner.value = null
  nextTick(syncScroll)
}

function save() {
  emit('save', { uid: draft.uid, ...pickDraft() })
}

// ================= 保存为用户自定义模板 =================
const tplName = ref('')
const tplIcon = ref('')
const tplNeedEntity = ref(false)
const savingAsTpl = ref(false)
// 打开保存对话框时预填当前 draft 的元信息，方便用户快速确认
watch(banner, (v) => {
  if (v !== 'save-as-tpl') return
  tplName.value = props.card?.title?.trim() || cardDefaults[draft.type]?.label || '我的模板'
  tplIcon.value = draft.icon || cardDefaults[draft.type]?.icon || 'construction'
  tplNeedEntity.value = !!metaOf(draft.type).needEntity
})
async function confirmSaveAsTpl() {
  if (savingAsTpl.value) return
  if (!tplName.value.trim()) return
  savingAsTpl.value = true
  try {
    const res = await saveAsTemplate(draft, {
      name: tplName.value.trim(),
      icon: tplIcon.value.trim() || 'construction',
      needEntity: tplNeedEntity.value,
    })
    if (res?.err === 'limit') showTopMsg(res.msg, true)
    else if (res?.err === 'no-name') showTopMsg('请输入模板名', true)
    else if (res?.err) showTopMsg('保存失败：' + res.err, true)
    else showTopMsg(`模板「${res.name}」已保存，下次添加卡片时就能找到了`)
    banner.value = null
  } finally { savingAsTpl.value = false }
}
function showTopMsg(text, err) {
  topMsg.value = { text, err: !!err }
  clearTimeout(topMsgTimer)
  topMsgTimer = setTimeout(() => { topMsg.value = null }, 3200)
}
const topMsg = ref(null)
let topMsgTimer = 0

// ================= 自定义图标 =================
const iconInput = ref('')
const iconSugs = ['home', 'lightbulb', 'av_timer', 'calendar_month', 'partly_cloudy_day', 'devices', 'sensors', 'thermostat', 'dashboard', 'bolt', 'battery_full', 'schedule']
function applyIconInput() { draft.icon = (iconInput.value || '').trim().replace(/\s+/g, '_') }
function pickCardIcon(n) { draft.icon = n; iconInput.value = n }
function clearCardIcon() { draft.icon = ''; iconInput.value = '' }

// ================= 自定义头像（人员位置卡） =================
const avatarFileRef = ref(null)
function onPickAvatar(ev) {
  const file = ev.target.files && ev.target.files[0]
  if (!file) return
  if (!file.type.startsWith('image/')) return
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    // 等比缩放至最长边 256px，转 jpeg dataURL 存储
    const max = 256
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d').drawImage(img, 0, 0, w, h)
    draft.avatar = cv.toDataURL('image/jpeg', 0.85)
    URL.revokeObjectURL(url)
    if (avatarFileRef.value) avatarFileRef.value.value = ''
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    if (avatarFileRef.value) avatarFileRef.value.value = ''
  }
  img.src = url
}
function clearAvatar() {
  draft.avatar = ''
  if (avatarFileRef.value) avatarFileRef.value.value = ''
}

// ================= 实体选择（可搜索下拉） =================
const entityWrapRef = ref(null)
const entityMenu = ref(false)
const entityQuery = ref('')
const entitySearchRef = ref(null)

const entityOptions = computed(() => {
  const m = meta.value
  const domains = m.entityDomains
  return Object.values(entityStates)
    .filter((e) => !domains || domains.includes(e.domain))
    .map((e) => ({
      id: e.entity_id,
      label: e.friendly_name || e.entity_id,
      domain: e.domain || e.entity_id.split('.')[0],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
})
const filteredEntities = computed(() => {
  const q = entityQuery.value.trim().toLowerCase()
  const list = entityOptions.value
  if (!q) return list
  return list.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
})
const currentEntity = computed(
  () => Object.values(entityStates).find((e) => e.entity_id === draft.entity_id) || null,
)
// 多实体卡列表项展示辅助
function entityRowOf(id) {
  return entityOptions.value.find((o) => o.id === id) || { id, label: id, domain: id.split('.')[0] }
}
function isEntityPicked(id) {
  return multiEntity.value ? draft.entity_ids.includes(id) : draft.entity_id === id
}
function toggleEntityMenu(force) {
  entityMenu.value = typeof force === 'boolean' ? force : !entityMenu.value
  if (entityMenu.value) nextTick(() => entitySearchRef.value?.focus())
}
function pickEntity(id) {
  if (multiEntity.value) {
    // 多选：点击即加入 / 再次点击移除，菜单保持打开，数量不限
    const i = draft.entity_ids.indexOf(id)
    if (i >= 0) draft.entity_ids.splice(i, 1)
    else draft.entity_ids.push(id)
    syncPrimaryEntity()
    return
  }
  draft.entity_id = id
  entityMenu.value = false
}
function removeEntity(id) {
  const i = draft.entity_ids.indexOf(id)
  if (i >= 0) draft.entity_ids.splice(i, 1)
  syncPrimaryEntity()
}

// ================= 人员信息卡：扩展绑定槽位（entity_ids2 循环翻动 / entity_ids3 滚动轮播） =================
// 与主实体框独立：不限域、不限数量；两个槽位共用一个打开中的下拉（slotMenuKey）与搜索词（slotQuery）
const extraSlots = computed(() => (draft.type === 'personInfo'
  ? [
    { key: 'entity_ids_status', label: '顶部状态跑马灯', empty: '可选：设备状态实体，从右向左滚动显示在标题与角标之间' },
    { key: 'entity_ids2', label: '循环翻动实体', empty: '可选：多个实体时状态在卡片中部轮流翻动显示' },
    { key: 'entity_ids3', label: '滚动轮播实体', empty: '可选：实体状态在卡片底部从左到右滚动显示' },
  ]
  : []))
const slotMenuKey = ref('')
const slotQuery = ref('')
const slotExpanded = ref({}) // { entity_ids2: true } 控制槽位框 chip list 默认折叠
const slotSearchRef = ref(null)
const allEntityOptions = computed(() =>
  Object.values(entityStates)
    .map((e) => ({ id: e.entity_id, label: e.friendly_name || e.entity_id, domain: e.domain || e.entity_id.split('.')[0] }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh')))
const filteredSlotEntities = computed(() => {
  const q = slotQuery.value.trim().toLowerCase()
  if (!q) return allEntityOptions.value
  return allEntityOptions.value.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
})
function slotRowOf(id) {
  return allEntityOptions.value.find((o) => o.id === id) || { id, label: id, domain: id.split('.')[0] }
}
function toggleSlotMenu(key) {
  slotMenuKey.value = slotMenuKey.value === key ? '' : key
  slotQuery.value = ''
  if (slotMenuKey.value) {
    // 确保下拉展开的槽位框可见，避免被 .ce-config 的 overflow 滚动容器裁剪
    nextTick(() => {
      const wrap = document.querySelector(`.ce-slot-box .ce-dropdown`)
      wrap?.closest?.('.ce-slot-box')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      const el = Array.isArray(slotSearchRef.value) ? slotSearchRef.value[0] : slotSearchRef.value
      el?.focus?.()
    })
  }
}
function pickSlotEntity(id) {
  const list = draft[slotMenuKey.value]
  if (!Array.isArray(list)) return
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}
function removeSlotEntity(key, id) {
  const list = draft[key]
  const i = Array.isArray(list) ? list.indexOf(id) : -1
  if (i >= 0) list.splice(i, 1)
}
// 调整槽位内实体顺序：dir = -1 上移 / +1 下移
function moveSlotEntity(key, id, dir) {
  const list = draft[key]
  if (!Array.isArray(list) || dir === 0) return
  const i = list.indexOf(id)
  if (i < 0) return
  const j = i + dir
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
}
function onDocMouseDown(e) {
  if (entityMenu.value && entityWrapRef.value && !entityWrapRef.value.contains(e.target)) entityMenu.value = false
  if (slotMenuKey.value && !e.target?.closest?.('.ce-slot-box')) slotMenuKey.value = ''
}

// ================= 可视化尺寸选择（4×3） =================
const hoverCell = ref(0)
function sizeCellClass(i) {
  const idx = i - 1
  const r = Math.floor(idx / 4)
  const c = idx % 4
  const hoverW = hoverCell.value ? ((hoverCell.value - 1) % 4) + 1 : 0
  const hoverH = hoverCell.value ? Math.floor((hoverCell.value - 1) / 4) + 1 : 0
  return {
    on: c < draft.w && r < draft.h,
    hover: hoverCell.value > 0 && c < hoverW && r < hoverH && !(c < draft.w && r < draft.h),
  }
}
function pickSize(i) {
  draft.w = ((i - 1) % 4) + 1
  draft.h = Math.floor((i - 1) / 4) + 1
}
watch(() => [draft.w, draft.h], () => nextTick(computePreviewScale))

// ================= 语言 Tabs =================
const langTabs = [
  { key: 'html', label: 'HTML', name: 'HTML 模板' },
  { key: 'css', label: 'CSS', name: 'CSS 样式' },
  { key: 'js', label: 'JS', name: 'JavaScript 逻辑' },
]
const tab = ref('html')
const currentTab = computed(() => langTabs.find((t) => t.key === tab.value))
const tabHints = {
  html: ['{{key}} 绑定数据', 'data-hc="toggle"', 'data-hc="svc"', 'data-hc="range"', 'data-hc="select"', 'data-hc="link"'],
  css: ['var(--hc-color) 领域色', '样式仅作用于本卡', '@media / @keyframes 可直接使用'],
  js: ['el 卡片根元素', 'card 卡片信息', 'data 实时数据', '渲染后自动执行'],
}
langTabs.forEach((t) => (t.hints = tabHints[t.key]))
function switchTab(k) {
  tab.value = k
  nextTick(syncScroll)
}
function codeOf(k) { return draft[k] || '' }

// ================= 代码编辑器：行号 / 高亮 / 缩进 =================
const taRef = ref(null)
const preRef = ref(null)
const scrollRef = ref(null)
const gutterInnerRef = ref(null)
const composing = ref(false)

const lineCount = computed(() => (draft[tab.value] || '').split('\n').length)
const charCount = computed(() => (draft[tab.value] || '').length)

function onCodeInput(e) {
  draft[tab.value] = e.target.value
  nextTick(syncScroll)
}
function onScroll() {
  syncScroll()
}
function syncScroll() {
  const ta = taRef.value
  if (!ta) return
  if (preRef.value) {
    preRef.value.scrollTop = ta.scrollTop
    preRef.value.scrollLeft = ta.scrollLeft
  }
  if (gutterInnerRef.value) gutterInnerRef.value.style.transform = `translateY(${-ta.scrollTop}px)`
}

// Tab / Shift+Tab 缩进，回车自动缩进，括号引号自动闭合
function onKeydown(e) {
  const ta = e.target
  if (e.key === 'Tab') {
    e.preventDefault()
    const { selectionStart: s, selectionEnd: en, value } = ta
    if (s !== en) {
      // 多行选区：整行加 / 减缩进
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const block = value.slice(lineStart, en)
      if (e.shiftKey) {
        const replaced = block.replace(/^ {1,2}/gm, '')
        draft[tab.value] = value.slice(0, lineStart) + replaced + value.slice(en)
        nextTick(() => setSel(ta, s, s + replaced.length - block.length + (en - s)))
      } else {
        const replaced = block.replace(/^/gm, '  ')
        draft[tab.value] = value.slice(0, lineStart) + replaced + value.slice(en)
        nextTick(() => setSel(ta, lineStart, lineStart + replaced.length))
      }
    } else if (!e.shiftKey) {
      draft[tab.value] = value.slice(0, s) + '  ' + value.slice(en)
      nextTick(() => setSel(ta, s + 2, s + 2))
    }
    nextTick(syncScroll)
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !composing.value) {
    const { selectionStart: s, value } = ta
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const line = value.slice(lineStart, s)
    const indent = (line.match(/^\s*/) || [''])[0]
    const extra = /[{\[(]\s*$/.test(line) ? '  ' : ''
    e.preventDefault()
    const insert = '\n' + indent + extra
    draft[tab.value] = value.slice(0, s) + insert + value.slice(ta.selectionEnd)
    nextTick(() => setSel(ta, s + insert.length, s + insert.length))
    nextTick(syncScroll)
    return
  }
  // 自动闭合
  const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }
  if (!composing.value && pairs[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const { selectionStart: s, selectionEnd: en, value } = ta
    const close = pairs[e.key]
    // 右括号：若紧邻同字符则跳过
    if ('`"\')]}'.includes(e.key) && value[s] === e.key && s === en) {
      e.preventDefault()
      draft[tab.value] = value
      nextTick(() => setSel(ta, s + 1, s + 1))
      return
    }
    if (s !== en) {
      e.preventDefault()
      const selected = value.slice(s, en)
      draft[tab.value] = value.slice(0, s) + e.key + selected + close + value.slice(en)
      nextTick(() => setSel(ta, s + 1, en + 1))
    } else {
      e.preventDefault()
      draft[tab.value] = value.slice(0, s) + e.key + close + value.slice(en)
      nextTick(() => setSel(ta, s + 1, s + 1))
    }
    nextTick(syncScroll)
  }
}
function setSel(ta, s, e) {
  ta.selectionStart = s
  ta.selectionEnd = e
}

// ---------------- 轻量语法高亮（先转义，再包 span） ----------------
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function span(cls, text) {
  return `<span class="tok-${cls}">${esc(text)}</span>`
}
// 用主正则扫描，token 着色，间隙文本做二次行内处理
function tokenize(src, re, onToken, onPlain) {
  let out = ''
  let last = 0
  let m
  re.lastIndex = 0
  while ((m = re.exec(src))) {
    if (m.index > last) out += onPlain(src.slice(last, m.index))
    out += onToken(m)
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < src.length) out += onPlain(src.slice(last))
  return out
}

const HTML_RE = /<!--[\s\S]*?-->|\{\{[\w.]+\}\}|<\/?[a-zA-Z][\w-]*|\/?>|&[a-zA-Z#0-9]+;|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[a-zA-Z_:][\w:.-]*(?=\s*=)/g
function hlHtml(src) {
  return tokenize(
    src,
    HTML_RE,
    (m) => {
      const t = m[0]
      if (t.startsWith('<!--')) return span('comment', t)
      if (t.startsWith('{{')) return span('ph', t)
      if (t[0] === '<') return span('tag', t)
      if (t === '>' || t === '/>') return span('punct', t)
      if (t[0] === '"' || t[0] === "'") return span('str', t)
      if (/^[a-zA-Z_:]/.test(t)) return span('attr', t)
      return esc(t)
    },
    esc,
  )
}

const CSS_RE = /(\/\*[\s\S]*?\*\/)|(var\(--hc-color\))|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b)|(\b\d+(?:\.\d+)?(?:px|rem|em|%|s|ms|vh|vw|fr|deg|dvh)?\b)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([^{}]*?\{)/g

const JS_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(const|let|var|function|return|if|else|for|while|do|of|in|new|try|catch|finally|throw|await|async|true|false|null|undefined|this|typeof|instanceof|switch|case|break|continue|default)\b|\b(\d+(?:\.\d+)?)\b|\b(el|card|data)\b/g
function hlJs(src) {
  return tokenize(
    src,
    JS_RE,
    (m) => {
      if (m[1]) return span('comment', m[1])
      if (m[2]) return span('str', m[2])
      if (m[3]) return span('kw', m[3])
      if (m[4]) return span('num', m[4])
      if (m[5]) return span('arg', m[5])
      return esc(m[0])
    },
    esc,
  )
}

// 规则体内的属性名着色（在已转义文本上操作，用函数替换避免 $ 反向引用问题）
function highlightCssPropsSafe(escapedPlain) {
  return escapedPlain.replace(/([\w-]+)(\s*:)/g, (_, name, colon) => `<span class="tok-prop">${name}</span>${colon}`)
}
function hlCss(src) {
  return tokenize(
    src,
    CSS_RE,
    (m) => {
      const t = m[0]
      if (m[1]) return span('comment', t)
      if (m[2]) return span('hc', t)
      if (m[3]) return span('kw', t)
      if (m[4] || m[5]) return span('num', t)
      if (m[6]) return span('str', t)
      if (m[7]) return span('sel', t.slice(0, -1)) + '{'
      return esc(t)
    },
    (plain) => highlightCssPropsSafe(esc(plain)),
  )
}

const highlighted = computed(() => {
  const tail = (s) => (s.endsWith('\n') ? s : s + '\n')
  return {
    html: hlHtml(tail(draft.html || '')),
    css: hlCss(tail(draft.css || '')),
    js: hlJs(tail(draft.js || '')),
  }
})

// ================= 图形设计模式 =================
const designMode = ref(false)
// 设计模式下右侧面板内部视图：props=元素属性（默认）/ elcode=元素代码
const rightView = ref('props')

// ================= 左功能栏（窄图标栏 + 可折叠） =================
// 点击某项在右侧面板展开对应功能；「模型/模型库/图层」仅设计模式可用，非设计模式时显示引导提示
const FUNC_ITEMS = [
  { key: 'settings', label: '设置', icon: 'tune' },
  { key: 'element', label: '模型', icon: 'select' },
  { key: 'widgets', label: '模型库', icon: 'add_box' },
  { key: 'layers', label: '图层', icon: 'layers' },
  { key: 'ai', label: 'AI', icon: 'auto_awesome' },
  { key: 'logic', label: '逻辑', icon: 'account_tree' },
  { key: 'code', label: '代码', icon: 'code' },
]
const funcKey = ref('settings')
const funcFolded = ref(false)
function selectFunc(key) {
  if (funcFolded.value) { funcFolded.value = false }
  funcKey.value = key
  // 元素面板：选中态显示属性，需编辑元素代码时进入 elcode
  if (key === 'element' && rightView.value === 'elcode' && !elVid.value) rightView.value = 'props'
  // 切到设计相关功能时自动进设计模式，减少一步手动切换
  if (['element', 'widgets', 'layers'].includes(key) && !designMode.value) enterDesign()
}

function enterDesign() {
  designMode.value = true
  rightView.value = 'props'
  nextTick(computePreviewScale)
}
// 新建的「自定义卡」需要自动进入图形化设计模式，并把功能面板切到组件库，
// 让用户第一眼就能开始搭积木（_autoDesign 是运行时瞬时标记，不会被持久化）。
watch(() => props.card, (v) => {
  if (v && v._autoDesign) {
    delete v._autoDesign
    enterDesign()
    funcKey.value = 'widgets'
    rightView.value = 'props'
  }
})
// VisualStage 的所有图形编辑都序列化为 HTML 回写草稿，右侧代码实时同步
function onVisualHtml(html) {
  draft.html = html
}
// 属性条「换实体」→ 打开右上配置区的实体搜索下拉
function onVisualChangeEntity() {
  if (!meta.value.needEntity && !meta.value.entityOptional) return
  entityMenu.value = true
  nextTick(() => entityWrapRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}

// ================= AI 生成卡片（右侧「AI」页） =================
// 由后端代理 OpenAI 兼容接口；前端只发提示词，不接触 API Key。
const AI_SUGGESTIONS = [
  '客厅温湿度卡片，大号温度数字，底部显示湿度',
  '灯光控制卡：大图标 + 开关按钮，显示亮度',
  '能耗概览卡片：今天用电、本月用电、费用',
]
const AI_FALLBACK_TOKENS = ['name', 'state', 'sub', 'glyph', 'rowsHtml', 'bigHtml', 'onColor']
const aiPrompt = ref('')
const aiKeep = ref(true)
const aiBusy = ref(false)
const aiErr = ref('')
const aiMsg = ref('')
const aiBackup = ref(null)

const aiPicked = ref([])
const aiEntityFilter = ref('')
// 可选实体清单：直接读实时实体表，供 AI 生成时注入上下文并自动绑定
const aiAllEntities = computed(() =>
  Object.values(entityStates)
    .map((e) => ({
      id: e.entity_id,
      name: e.friendly_name || e.entity_id,
      domain: e.domain || String(e.entity_id).split('.')[0],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
)
const aiEntityRows = computed(() => {
  const q = aiEntityFilter.value.trim().toLowerCase()
  const list = q
    ? aiAllEntities.value.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
    : aiAllEntities.value
  return list.slice(0, 60)
})
// 打开卡片 / 切换卡片时默认勾选已绑定的实体，避免生成时丢失既有绑定
watch(
  () => draft.uid,
  () => {
    const bound = draft.entity_ids.length ? draft.entity_ids : (draft.entity_id ? [draft.entity_id] : [])
    aiPicked.value = bound.filter((id) => entityStates[id])
    aiEntityFilter.value = ''
  },
  { immediate: true },
)

const aiEntity = computed(() => {
  const id = aiPicked.value[0] || draft.entity_id
  return id ? entityStates[id] || null : null
})
// 当前卡片真正可用的数据占位符：交给模型，避免生成 {{不存在的字段}} 导致空白
const aiTokenList = computed(() => {
  try {
    const entity = aiEntity.value
    const entities = (aiPicked.value.length ? aiPicked.value : draft.entity_ids || [])
      .map((id) => entityStates[id])
      .filter(Boolean)
    // 没选实体时没有任何实时占位符可用，避免模型编造
    if (!entity && !entities.length) return []
    const d = computeData(draft.type, {
      all: Object.values(entityStates),
      hasData: !!entity,
      entity,
      entities,
      entityId: entity ? entity.entity_id : '',
      now: new Date(),
      card: draft,
    })
    const keys = Object.keys(d || {}).filter((k) => /^[A-Za-z_]\w*$/.test(k) && d[k] != null && typeof d[k] !== 'object')
    return keys.length ? keys.slice(0, 32) : AI_FALLBACK_TOKENS
  } catch {
    return AI_FALLBACK_TOKENS
  }
})
function aiEntityLine(e, idx) {
  const attrs = e.attributes || {}
  const wanted = ['unit_of_measurement', 'device_class', 'current_temperature', 'temperature', 'humidity', 'battery_level', 'target_temp_step']
  const attrText = wanted.filter((k) => attrs[k] != null).map((k) => `${k}=${attrs[k]}`).join(', ')
  const unit = attrs.unit_of_measurement ? ' ' + attrs.unit_of_measurement : ''
  return `${idx}. ${e.entity_id}（${e.friendly_name || e.entity_id}，领域 ${String(e.entity_id).split('.')[0]}）；当前状态：${e.state}${unit}${attrText ? '；属性：' + attrText : ''}`
}
const aiEntityBrief = computed(() => {
  const picked = aiPicked.value.map((id) => entityStates[id]).filter(Boolean)
  if (picked.length) {
    return `可用实体（按勾选顺序，只有第 1 个可使用实时占位符；其余实体可用当前状态做静态展示）：\n${picked.map((e, i) => aiEntityLine(e, i + 1)).join('\n')}\n交互按钮 data-hc="toggle" 作用于第 1 个实体。`
  }
  const e = aiEntity.value
  if (!e) return '当前卡片未绑定实体，生成内容不要依赖实时数据占位符。'
  return `当前实体：${aiEntityLine(e, 1).replace(/^1\.\s*/, '')}`
})

function aiSystemPrompt() {
  const tokens = aiTokenList.value.join('、') || '（无）'
  const isModify = aiKeep.value && draft.html.trim()
  const current = isModify
    ? `\n\n当前卡片（在此基础上按需求修改，未要求改动的内容保持不变）：\nHTML:\n${draft.html}\nCSS:\n${draft.css}`
    : ''
  // 静态设计规范全部在 card-designer.md；此处只拼本次任务的动态上下文
  return `${CARD_DESIGNER_SKILL}

## 本次任务上下文

- 模式：${isModify ? '修改现有卡片' : '从零生成新卡片'}
- 本次可用占位符（只能用这些，禁止编造）：${tokens}
- ${aiEntityBrief.value}${current}`
}

function aiParseJson(text) {
  let s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1]
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('AI 未返回有效 JSON')
  return JSON.parse(s.slice(a, b + 1))
}

async function runAiGenerate() {
  const prompt = aiPrompt.value.trim()
  if (!prompt || aiBusy.value) return
  aiBusy.value = true
  aiErr.value = ''
  aiMsg.value = ''
  try {
    const { data } = await api.aiChat([
      { role: 'system', content: aiSystemPrompt() },
      { role: 'user', content: prompt },
    ])
    const raw = data?.choices?.[0]?.message?.content
    const text = Array.isArray(raw) ? raw.map((p) => p?.text || '').join('') : raw
    if (!text) throw new Error('AI 返回为空')
    const out = aiParseJson(text)
    if (!out.html || typeof out.html !== 'string') throw new Error('AI 结果缺少 html')

    aiBackup.value = {
      html: draft.html, css: draft.css, js: draft.js,
      w: draft.w, h: draft.h, title: draft.title, icon: draft.icon,
      entity_id: draft.entity_id, entity_ids: [...draft.entity_ids],
    }
    draft.html = out.html.trim()
    draft.css = typeof out.css === 'string' ? out.css : ''
    if (out.title) draft.title = String(out.title)
    if (out.icon) { draft.icon = String(out.icon); iconInput.value = draft.icon }
    if (Number.isFinite(Number(out.w))) draft.w = Math.min(4, Math.max(1, Math.round(Number(out.w))))
    if (Number.isFinite(Number(out.h))) draft.h = Math.min(4, Math.max(1, Math.round(Number(out.h))))
    // 勾选的实体自动绑定到卡片：否则占位符、data-hc="toggle" 与保存后的卡片都没有数据源
    const pickedIds = aiPicked.value.filter((id) => entityStates[id])
    if (pickedIds.length) {
      if (['generic', 'person', 'group'].includes(draft.type)) {
        draft.entity_ids = [...pickedIds]
        draft.entity_id = pickedIds[0]
      } else if (metaOf(draft.type).needEntity || metaOf(draft.type).entityOptional) {
        draft.entity_id = pickedIds[0]
      }
    }
    // 回到预览，直接看生成结果；需要继续搭积木再切「设计」
    designMode.value = false
    nextTick(() => {
      syncScroll()
      computePreviewScale()
    })
    aiMsg.value = `已应用 AI 生成的卡片${pickedIds.length ? `，并绑定 ${pickedIds.length} 个实体` : ''}，可继续手动调整或恢复生成前`
  } catch (e) {
    aiErr.value = e?.message || 'AI 生成失败'
  } finally {
    aiBusy.value = false
  }
}

function restoreAi() {
  const b = aiBackup.value
  if (!b) return
  draft.html = b.html
  draft.css = b.css
  draft.js = b.js
  draft.w = b.w
  draft.h = b.h
  draft.title = b.title
  draft.icon = b.icon
  draft.entity_id = b.entity_id || ''
  draft.entity_ids = Array.isArray(b.entity_ids) ? [...b.entity_ids] : []
  iconInput.value = draft.icon
  aiBackup.value = null
  aiErr.value = ''
  aiMsg.value = '已恢复生成前的内容'
  nextTick(() => {
    syncScroll()
    computePreviewScale()
  })
}

// ================= 组件库（右侧「组件」页） =================
// 低代码搭建入口：点按插入到卡片中央（触摸主路径），鼠标可按住拖到画布指定位置插入。
const visualStageRef = ref(null)
const elVid = ref('')
const paletteMsg = ref(null)
let paletteTimer = 0
// 鼠标拖入结束后紧随的 click 需要忽略，避免重复插入
let palSuppressUntil = 0
let palDrag = null
function widgetsOf(group) {
  return WIDGET_DEFS.filter((w) => w.group === group)
}
function showPaletteMsg(text, err) {
  paletteMsg.value = { text, err: !!err }
  clearTimeout(paletteTimer)
  paletteTimer = setTimeout(() => { paletteMsg.value = null }, 3000)
}
function insertWidgetAt(def, at) {
  if (Date.now() < palSuppressUntil) return
  const err = visualStageRef.value?.insertWidget(def.key, at || null)
  if (err === 'no-template') showPaletteMsg('该卡片需要先绑定实体（或模板为空），请在上方配置区选择实体后再设计', true)
  else if (err) showPaletteMsg('插入失败：' + err, true)
  else showPaletteMsg(`已插入「${def.label}」，可在左侧拖动或用方向键微调`)
}
function onPaletteDown(e, def) {
  // 触摸端不拦滚动，直接走点按插入
  if (e.pointerType !== 'mouse') return
  palDrag = { def, sx: e.clientX, sy: e.clientY, moved: false, inside: false, layer: null }
  window.addEventListener('pointermove', onPaletteMove)
  window.addEventListener('pointerup', onPaletteUp)
  window.addEventListener('pointercancel', onPaletteUp)
}
function onPaletteMove(e) {
  const d = palDrag
  if (!d) return
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
    d.moved = true
    d.layer = document.createElement('div')
    d.layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483500;pointer-events:none'
    d.box = document.createElement('div')
    d.chip = document.createElement('div')
    d.chip.textContent = d.def.label
    d.chip.style.cssText = 'position:absolute;transform:translate(-50%,-50%);padding:3px 9px;border-radius:8px;'
      + 'background:rgb(var(--c-primary) / .92);color:rgb(var(--c-on-primary));font:700 11px/1.3 system-ui,sans-serif;white-space:nowrap;'
      + 'box-shadow:0 6px 18px rgba(0,0,0,.45)'
    d.box.style.cssText = 'display:none'
    d.layer.append(d.box, d.chip)
    document.body.appendChild(d.layer)
  }
  d.chip.style.left = e.clientX + 'px'
  d.chip.style.top = e.clientY + 'px'
  const r = visualStageRef.value?.widgetDropRect(d.def.key, e.clientX, e.clientY)
  if (r && r.inside) {
    d.inside = true
    d.box.style.cssText = `position:absolute;left:${r.rect.left}px;top:${r.rect.top}px;width:${r.rect.width}px;`
      + `height:${r.rect.height}px;border:1.5px dashed rgba(245,166,35,.95);background:rgba(245,166,35,.12);border-radius:4px;box-sizing:border-box`
  } else {
    d.inside = false
    d.box.style.cssText = 'display:none'
  }
}
function onPaletteUp(e) {
  window.removeEventListener('pointermove', onPaletteMove)
  window.removeEventListener('pointercancel', onPaletteUp)
  const d = palDrag
  palDrag = null
  if (!d) return
  d.layer?.remove()
  if (!d.moved) return // 未拖动：交给 click 处理（插入到卡片中央）
  palSuppressUntil = Date.now() + 350
  if (d.inside) insertWidgetAt(d.def, { clientX: e.clientX, clientY: e.clientY })
}

// ================= 图层（右侧「图层」页） =================
const layerTree = ref([])
const layerMsg = ref('')
let layerMsgTimer = 0
let layerDrag = null
const dropIndex = ref(-1)
const LAYER_ICON = { div: 'crop_square', span: 'text_fields', button: 'smart_button', p: 'notes', img: 'image', svg: 'shapes', a: 'link', i: 'star' }
// 弹窗层模型（.hc-pop）固定 web_asset 图标，在模型/图层列表里一眼可辨
function layerIcon(row) { return row.isPop ? 'web_asset' : LAYER_ICON[row.tag] || 'widgets' }
function layerName(row) {
  if (row.isSurface) return '卡片根'
  if (row.isPop) return '弹窗层'
  return row.name
}
function showLayerMsg(text) {
  layerMsg.value = text
  clearTimeout(layerMsgTimer)
  layerMsgTimer = setTimeout(() => { layerMsg.value = '' }, 3000)
}
// 元素树从 VisualStage 现取（读模板文档），依赖 draft.html 但需等子组件重渲染完
function refreshLayers() {
  if (!designMode.value || !['layers', 'element'].includes(funcKey.value)) { layerTree.value = []; return }
  layerTree.value = visualStageRef.value?.getLayerTree() || []
}
watch([() => draft.html, funcKey, designMode], () => nextTick(refreshLayers))
function selectLayer(row) {
  if (row.vid === elVid.value) return
  visualStageRef.value?.selectVid(row.vid)
}
function doLayerOp(row, op) {
  const err = visualStageRef.value?.layerOp(row.vid, op) || ''
  if (err === 'single') showLayerMsg('该模型在所在容器内没有可调换的邻居')
  else if (err === 'surface') showLayerMsg('卡片根模型不能调整层级')
  else if (err === 'edge') showLayerMsg('已经到该方向的边界了')
  else if (err) showLayerMsg('调整失败：' + err)
}
// 鼠标按住行拖到同容器其它行之间重排（跨容器会被拒绝）
function onLayerDown(e, i, row) {
  if (e.pointerType !== 'mouse' || row.isSurface) return
  layerDrag = { vid: row.vid, from: i, sx: e.clientX, sy: e.clientY, moved: false, to: -1 }
  window.addEventListener('pointermove', onLayerMove)
  window.addEventListener('pointerup', onLayerUp)
  window.addEventListener('pointercancel', onLayerUp)
}
function onLayerMove(e) {
  const d = layerDrag
  if (!d) return
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
    d.moved = true
  }
  let idx = -1
  document.querySelectorAll('.ce-ly-row').forEach((el, k) => {
    const r = el.getBoundingClientRect()
    if (e.clientY >= r.top && e.clientY <= r.bottom) idx = k
  })
  d.to = idx
  dropIndex.value = idx
}
function onLayerUp() {
  window.removeEventListener('pointermove', onLayerMove)
  window.removeEventListener('pointercancel', onLayerUp)
  const d = layerDrag
  layerDrag = null
  dropIndex.value = -1
  if (!d || !d.moved) return
  const target = layerTree.value[d.to]
  if (!target || target.vid === d.vid) return
  if (target.isSurface) { showLayerMsg('卡片根模型不能作为排序目标'); return }
  const err = visualStageRef.value?.reorderLayer(d.vid, target.vid, d.to > d.from ? 'after' : 'before') || ''
  if (err === 'cross-parent') showLayerMsg('仅支持同一容器内的模型排序（跨容器请用代码编辑）')
  else if (err === 'surface') showLayerMsg('卡片根模型不能调整层级')
  else if (err) showLayerMsg('排序失败：' + err)
  else visualStageRef.value?.selectVid(d.vid)
}

// ================= 元素代码编辑（只编辑选中元素的 HTML） =================
const elDesc = ref('')
const elHtml = ref('')
const elCodeErr = ref('')
const elComposing = ref(false)
const elTaRef = ref(null)
const elPreRef = ref(null)
const elScrollRef = ref(null)
const elGutterRef = ref(null)

const elLineCount = computed(() => (elHtml.value || '').split('\n').length)
const elHighlighted = computed(() => {
  const s = elHtml.value || ''
  return hlHtml(s.endsWith('\n') ? s : s + '\n')
})

function onVisualSelect({ vid, desc }) {
  elVid.value = vid
  elDesc.value = desc
  if (!vid) {
    if (rightView.value === 'elcode') rightView.value = 'props'
    return
  }
  // 画布点选到元素：自动把功能面板切到「元素」，让用户立即看到属性
  if (funcKey.value !== 'element') funcKey.value = 'element'
  if (rightView.value === 'elcode') refreshElCode()
  refreshElCss()
}
// ================= 元素 CSS 编辑（内联 style） =================
const elCss = ref('')
function refreshElCss() {
  elCss.value = elVid.value ? (visualStageRef.value?.getElementCss() || '') : ''
}
function applyElCss() {
  visualStageRef.value?.applyElementCss(elCss.value)
}
function onElCssInput(e) {
  elCss.value = e.target.value
  applyElCss()
}
function openElCodeView() {
  rightView.value = 'elcode'
  refreshElCode()
}
function refreshElCode() {
  elCodeErr.value = ''
  elHtml.value = visualStageRef.value?.getElementHtml() || ''
  elDesc.value = visualStageRef.value?.getSelectedDescriptor() || elDesc.value
  nextTick(() => {
    syncElScroll()
    elTaRef.value?.focus()
  })
}
function onElInput(e) {
  elHtml.value = e.target.value
  applyElCode()
  nextTick(syncElScroll)
}
function applyElCode() {
  elCodeErr.value = visualStageRef.value?.applyElementHtml(elHtml.value) || ''
}
// 元素页删除选中元素（与画布属性条删除按钮 / Delete 键同效）；卡片根元素不可删
const elIsSurface = computed(() => !!layerTree.value.find((r) => r.vid === elVid.value)?.isSurface)
function deleteSelectedEl() {
  if (!elVid.value || elIsSurface.value) return
  visualStageRef.value?.deleteElement()
}
function syncElScroll() {
  const ta = elTaRef.value
  if (!ta) return
  if (elPreRef.value) {
    elPreRef.value.scrollTop = ta.scrollTop
    elPreRef.value.scrollLeft = ta.scrollLeft
  }
  if (elGutterRef.value) elGutterRef.value.style.transform = `translateY(${-ta.scrollTop}px)`
}
// Tab / 回车缩进（元素代码区）
function onElKeydown(e) {
  const ta = e.target
  if (e.key === 'Tab') {
    e.preventDefault()
    const { selectionStart: s, selectionEnd: en, value } = ta
    let next = null
    if (s !== en && e.shiftKey) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const replaced = value.slice(lineStart, en).replace(/^ {1,2}/gm, '')
      next = { v: value.slice(0, lineStart) + replaced + value.slice(en), s, e: s + replaced.length - (en - s) }
    } else if (s !== en) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1
      const replaced = value.slice(lineStart, en).replace(/^/gm, '  ')
      next = { v: value.slice(0, lineStart) + replaced + value.slice(en), s: lineStart, e: lineStart + replaced.length }
    } else {
      next = { v: value.slice(0, s) + '  ' + value.slice(en), s: s + 2, e: s + 2 }
    }
    elHtml.value = next.v
    applyElCode()
    nextTick(() => { ta.selectionStart = next.s; ta.selectionEnd = next.e })
    nextTick(syncElScroll)
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !elComposing.value) {
    const { selectionStart: s, value } = ta
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const line = value.slice(lineStart, s)
    const indent = (line.match(/^\s*/) || [''])[0]
    const extra = /[{\[(]\s*$/.test(line) ? '  ' : ''
    e.preventDefault()
    const insert = '\n' + indent + extra
    const v = value.slice(0, s) + insert + value.slice(ta.selectionEnd)
    elHtml.value = v
    applyElCode()
    nextTick(() => { ta.selectionStart = s + insert.length; ta.selectionEnd = s + insert.length })
    nextTick(syncElScroll)
    return
  }
}

// ================= 预览：1:1 基准渲染 + transform 等比缩放 =================
const stageRef = ref(null)
// 设计模式右侧「元素属性」面板的挂载点（VisualStage 用 Teleport 把属性条注入此处）
const designPanelRef = ref(null)
const previewScale = ref(1)
let ro = null
function cellPx() { return props.cellSize > 0 ? props.cellSize : 240 }
const pxW = computed(() => Math.round(Math.min(draft.w, props.cols) * cellPx()))
const pxH = computed(() => Math.round(Math.min(3, draft.h) * cellPx()))
const slotStyle = computed(() => ({
  width: Math.min(draft.w, props.cols) * cellPx() * previewScale.value + 'px',
  height: Math.min(3, draft.h) * cellPx() * previewScale.value + 'px',
}))
const holderStyle = computed(() => ({
  width: Math.min(draft.w, props.cols) * cellPx() + 'px',
  height: Math.min(3, draft.h) * cellPx() + 'px',
  transform: `scale(${previewScale.value})`,
  // 预览净缩放 = previewScale × (cellPx/baseCell)，边框厚度按它反向补偿，与仪表盘所见即所得
  '--card-bw': (1 / (previewScale.value * (cellPx() / baseCell) || 1)).toFixed(3) + 'px',
}))
const zoomStyle = computed(() => {
  const factor = cellPx() / baseCell
  return {
    // transform:scale 替代 zoom：zoom 触发同步重排且与 container-type/content-visibility 组合会反复失效重排
    transform: `scale(${factor})`,
    width: Math.min(draft.w, props.cols) * baseCell + 'px',
    height: Math.min(3, draft.h) * baseCell + 'px',
    display: 'flex',
    flexDirection: 'column',
    flex: 'none',
  }
})
function computePreviewScale() {
  if (!props.open) return
  const c = cellPx()
  const nw = Math.min(draft.w, props.cols) * c
  const nh = Math.min(3, draft.h) * c
  const el = stageRef.value
  const maxW = (el ? el.clientWidth : 360) - 40
  const maxH = (el ? el.clientHeight : 320) - 40
  previewScale.value = Math.max(0.1, Math.min(maxW / nw, maxH / nh, 1))
}

// ================= 全局快捷键 =================
function onDocKeydown(e) {
  if (!props.open) return
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    save()
  } else if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault()
    switchTab(langTabs[Number(e.key) - 1].key)
  } else if (e.key === 'Escape') {
    if (entityMenu.value) { entityMenu.value = false; return }
    if (banner.value) { banner.value = null; return }
    requestClose()
  }
}
document.addEventListener('keydown', onDocKeydown)
document.addEventListener('mousedown', onDocMouseDown)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKeydown)
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('pointermove', onPaletteMove)
  window.removeEventListener('pointerup', onPaletteUp)
  window.removeEventListener('pointercancel', onPaletteUp)
  window.removeEventListener('pointermove', onLayerMove)
  window.removeEventListener('pointerup', onLayerUp)
  window.removeEventListener('pointercancel', onLayerUp)
  clearTimeout(paletteTimer)
  clearTimeout(layerMsgTimer)
  palDrag?.layer?.remove()
  palDrag = null
  layerDrag = null
  if (ro) { ro.disconnect(); ro = null }
})
watch(
  () => props.open,
  (open) => {
    if (!open && ro) { ro.disconnect(); ro = null }
    if (open) nextTick(computePreviewScale)
  },
)
</script>

<style scoped>
/* ================= 覆盖层与面板 ================= */
.ce-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgb(var(--c-background));
  display: flex;
  padding: 0;
}
.ce-panel {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgb(var(--c-surface)) 0%, rgb(var(--c-surface)) 100%);
  border: none;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
}

/* ================= 顶栏 ================= */
.ce-topbar {
  flex: none;
  height: 58px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-on-surface) / 0.015);
}
.ce-brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
.ce-type-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--c-primary) / 0.12);
  border: 1px solid rgb(var(--c-primary) / 0.22);
  flex: none;
}
.ce-type-icon .material-symbols-outlined { font-size: 20px; }
.ce-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ce-eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--c-muted));
  font-weight: 600;
}
.ce-title {
  font-size: 15px;
  font-weight: 600;
  color: rgb(var(--c-on-background));
  display: flex;
  align-items: center;
  gap: 7px;
}
.ce-title-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--c-primary));
  box-shadow: 0 0 8px rgb(var(--c-primary) / 0.8);
}
.ce-top-actions { display: flex; align-items: center; gap: 8px; flex: none; }

.ce-btn {
  height: 34px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.08s;
  white-space: nowrap;
}
.ce-btn:active { transform: translateY(1px); }
.ce-btn .material-symbols-outlined { font-size: 16px; }
.ce-btn-sm { height: 28px; padding: 0 11px; font-size: 12px; }
.ce-ghost {
  background: transparent;
  color: rgb(var(--c-muted));
  border-color: rgb(var(--c-border));
}
.ce-ghost:hover { background: rgb(var(--c-on-surface) / 0.06); color: rgb(var(--c-on-background)); }
.ce-primary {
  background: rgb(var(--c-primary) / 0.28);
  color: rgb(var(--c-on-background));
  border-color: rgb(var(--c-primary) / 0.35);
}
.ce-primary:hover { background: rgb(var(--c-primary) / 0.4); }
.ce-primary.is-dirty {
  background: rgb(var(--c-primary));
  color: rgb(var(--c-on-primary));
  border-color: rgb(var(--c-primary));
  box-shadow: 0 6px 20px rgb(var(--c-primary) / 0.28), 0 0 0 1px rgb(var(--c-primary) / 0.35);
}
.ce-primary.is-dirty:hover { background: rgb(var(--c-primary-hover)); }
.ce-danger-btn {
  background: rgb(var(--c-error) / 0.16);
  color: rgb(var(--c-error));
  border-color: rgb(var(--c-error) / 0.35);
}
.ce-danger-btn:hover { background: rgb(var(--c-error) / 0.28); color: rgb(var(--c-error)); }

.ce-kbd {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 5px;
  background: rgb(var(--c-on-surface) / 0.06);
  border: 1px solid rgb(var(--c-on-surface) / 0.1);
  color: rgb(var(--c-muted));
}
.ce-kbd-light { background: rgb(var(--c-on-primary) / 0.14); border-color: rgb(var(--c-on-primary) / 0.2); color: rgb(var(--c-on-primary) / 0.75); }

/* ================= 横幅 ================= */
.ce-banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 16px;
  font-size: 12.5px;
  color: rgb(var(--c-on-surface));
  background: rgb(var(--c-primary) / 0.09);
  border-bottom: 1px solid rgb(var(--c-primary) / 0.22);
}
.ce-banner-icon { font-size: 17px; color: rgb(var(--c-primary)); }
.ce-banner-label { font-size: 12px; color: rgb(var(--c-on-surface)); white-space: nowrap; }
.ce-banner-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: rgb(var(--c-on-surface));
  white-space: nowrap;
}
.ce-banner-check input {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: rgb(var(--c-primary));
  }
/* 设计器输入框统一样式：与右侧面板输入框（.ce-ai-input 等）一致的深色底 + 细边框 */
.ce-input {
  box-sizing: border-box;
  border: 1px solid rgb(var(--c-border));
  border-radius: 7px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-family: inherit;
  font-size: 11.5px;
  transition: border-color 0.15s ease;
}
.ce-input-sm { padding: 4px 8px; }
.ce-input::placeholder { color: rgb(var(--c-faint)); }
.ce-input:focus { outline: none; border-color: rgb(var(--c-primary) / 0.55); }
.ce-spacer { flex: 1; }
.ce-banner-enter-active, .ce-banner-leave-active { transition: all 0.22s ease; }
.ce-banner-enter-from, .ce-banner-leave-to { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }

/* ================= 主体布局 ================= */
.ce-body {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 14px;
  gap: 14px;
}

/* ---------- 预览舞台 ---------- */
.ce-preview-col {
  flex: 5 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgb(var(--c-border));
  border-radius: 14px;
  overflow: hidden;
  background: rgb(var(--c-background));
}
.ce-preview-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  font-size: 11px;
  color: rgb(var(--c-muted));
  border-bottom: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-on-surface) / 0.015);
}
/* 预览 / 设计 模式切换 */
.ce-mode {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: rgb(var(--c-background));
  border: 1px solid rgb(var(--c-border));
  gap: 2px;
}
.ce-mode-btn {
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgb(var(--c-muted));
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ce-mode-btn .material-symbols-outlined { font-size: 14px; }
.ce-mode-btn:hover { color: rgb(var(--c-on-surface)); }
.ce-mode-btn.on {
  background: rgb(var(--c-primary) / 0.16);
  color: rgb(var(--c-primary));
  box-shadow: inset 0 0 0 1px rgb(var(--c-primary) / 0.25);
}
.ce-live { display: inline-flex; align-items: center; gap: 6px; color: rgb(var(--c-on-surface)); font-weight: 600; }
.ce-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--c-accent));
  box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0.5);
  animation: ce-pulse 2s ease-out infinite;
}
@keyframes ce-pulse {
  0% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0.45); }
  70% { box-shadow: 0 0 0 7px rgb(var(--c-accent) / 0); }
  100% { box-shadow: 0 0 0 0 rgb(var(--c-accent) / 0); }
}
.ce-preview-meta { font-family: ui-monospace, Menlo, Consolas, monospace; }
.ce-preview-scale {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-primary));
  font-weight: 600;
}
.ce-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: hidden;
  background-color: rgb(var(--c-background));
  background-image:
    radial-gradient(900px 480px at 50% -12%, rgb(var(--c-primary) / 0.07), transparent 62%),
    radial-gradient(rgb(var(--c-on-surface) / 0.05) 1px, transparent 1.2px);
  background-size: 100% 100%, 22px 22px;
}
.ce-slot { flex: none; position: relative; }
.ce-pholder {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  /* 与真实 .hc-card-holder 一致：不自带背景/阴影，视觉交给卡片壳自身，
     避免容器底色在卡片圆角外透出一圈浅色边 */
  border-radius: 14px;
  display: flex;
  flex-direction: column;
}
.hc-card-zoom { position: relative; flex: none; transform-origin: top left; }

/* ---------- 左：功能图标栏（可折叠） ---------- */
.ce-funcbar {
  flex: none;
  width: 116px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  transition: width 0.2s ease;
}
.ce-funcbar.folded { width: 52px; padding: 8px 6px; }
.ce-func-btn {
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: rgb(var(--c-muted));
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.ce-funcbar.folded .ce-func-btn { justify-content: center; padding: 0; }
.ce-func-btn .material-symbols-outlined { font-size: 20px; flex: none; }
.ce-func-btn:hover { background: rgb(var(--c-on-surface) / 0.05); color: rgb(var(--c-on-surface)); }
.ce-func-btn.on {
  background: rgb(var(--c-primary) / 0.14);
  color: rgb(var(--c-primary));
  border-color: rgb(var(--c-primary) / 0.3);
}
.ce-func-label { overflow: hidden; text-overflow: ellipsis; }
.ce-func-fold { margin-top: auto; }
.ce-funcbar .ce-spacer { display: none; }

/* ---------- 右：功能面板 ---------- */
.ce-panel-col {
  flex: 6 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ce-panel-page {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ce-panel-scroll { overflow-y: auto; }
.ce-panel-col-flex { display: flex; flex-direction: column; }
.ce-panel-tipbox {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  text-align: center;
  color: rgb(var(--c-muted));
  font-size: 12px;
  border: 1px dashed rgb(var(--c-border));
  border-radius: 12px;
  background: rgb(var(--c-surface));
}
.ce-panel-tipbox .material-symbols-outlined { font-size: 26px; color: rgb(var(--c-primary)); }
.ce-panel-tipbox p { margin: 0; line-height: 1.6; }

/* ---------- 右栏（旧 .ce-edit-col 已由 .ce-panel-col 取代，保留兼容） ---------- */
.ce-edit-col {
  flex: 6 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

/* 配置区 */
.ce-config {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 12px;
  overflow-y: auto;
  padding-right: 4px; /* 滚动条预留，避免 chip 贴边 */
}

/* 设计模式：元素属性 / 代码编辑 视图切换 */
.ce-viewswitch {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 10px;
}
.ce-vs-btn {
  flex: 1;
  min-width: 0;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: rgb(var(--c-muted));
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ce-vs-btn .material-symbols-outlined { font-size: 16px; }
.ce-vs-btn:hover { color: rgb(var(--c-on-surface)); }
.ce-vs-btn.on {
  background: rgb(var(--c-primary) / 0.14);
  color: rgb(var(--c-primary));
  box-shadow: inset 0 0 0 1px rgb(var(--c-primary) / 0.28);
}
.ce-vs-btn:disabled {
  opacity: 0.38;
  cursor: default;
}
.ce-vs-btn:disabled:hover { color: rgb(var(--c-muted)); }

/* ================= 组件库（组件页） ================= */
.ce-palette,
.ce-layers {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 10px;
}
.ce-pal-tip {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgb(var(--c-primary) / 0.08);
  color: rgb(var(--c-muted));
  font-size: 11px;
  line-height: 1.5;
}
.ce-pal-tip .material-symbols-outlined { font-size: 14px; color: rgb(var(--c-primary)); flex: none; margin-top: 1px; }
.ce-pal-group { flex: none; display: flex; flex-direction: column; gap: 6px; }
.ce-pal-gtitle {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--c-muted));
}
.ce-pal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 6px;
}
.ce-pal-tile {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 9px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 9px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-size: 12px;
  cursor: grab;
  touch-action: manipulation;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ce-pal-tile .material-symbols-outlined { font-size: 17px; color: rgb(var(--c-muted)); }
.ce-pal-tile em { font-style: normal; font-weight: 600; }
.ce-pal-tile:hover {
  background: rgb(var(--c-surface-alt));
  border-color: rgb(var(--c-primary) / 0.45);
  color: rgb(var(--c-primary));
}
.ce-pal-tile:hover .material-symbols-outlined { color: rgb(var(--c-primary)); }
.ce-pal-tile:active { cursor: grabbing; }
.ce-pal-msg {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgb(var(--c-accent) / 0.12);
  color: rgb(var(--c-accent));
  font-size: 11px;
  line-height: 1.5;
}
.ce-pal-msg.err { background: rgb(var(--c-error) / 0.12); color: rgb(var(--c-error)); }
.ce-pal-msg .material-symbols-outlined { font-size: 14px; flex: none; margin-top: 1px; }

/* ================= AI 页 ================= */
.ce-ai { display: flex; flex-direction: column; gap: 10px; }
.ce-ai-field { display: flex; flex-direction: column; gap: 6px; }
.ce-ai-ta {
  width: 100%;
  min-height: 86px;
  resize: vertical;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
}
.ce-ai-ta:focus { outline: none; border-color: rgb(var(--c-primary) / 0.55); }
.ce-ai-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 7px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-family: inherit;
  font-size: 11.5px;
}
.ce-ai-input:focus { outline: none; border-color: rgb(var(--c-primary) / 0.55); }
.ce-ai-entities {
  max-height: 156px;
  overflow-y: auto;
  border: 1px solid rgb(var(--c-border));
  border-radius: 7px;
  background: rgb(var(--c-surface));
}
.ce-ai-entity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 11.5px;
  color: rgb(var(--c-muted));
  cursor: pointer;
  border-bottom: 1px solid rgb(var(--c-on-surface) / 0.03);
}
.ce-ai-entity:last-child { border-bottom: none; }
.ce-ai-entity:hover { background: rgb(var(--c-on-surface) / 0.04); }
.ce-ai-entity.on { background: rgb(var(--c-primary) / 0.1); color: rgb(var(--c-primary)); }
.ce-ai-entity input { accent-color: rgb(var(--c-primary)); flex: none; }
.ce-ai-en-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ce-ai-en-id { flex: none; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgb(var(--c-muted)); font-size: 10px; }
.ce-ai-empty { margin: 0; padding: 8px; color: rgb(var(--c-muted)); font-size: 11px; text-align: center; }
.ce-ai-sugs { display: flex; flex-wrap: wrap; gap: 6px; }
.ce-ai-sug {
  padding: 4px 7px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 999px;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-muted));
  font-size: 10.5px;
  line-height: 1.3;
  cursor: pointer;
}
.ce-ai-sug:hover { border-color: rgb(var(--c-primary) / 0.45); color: rgb(var(--c-primary)); }
.ce-ai-check { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: rgb(var(--c-muted)); cursor: pointer; }
.ce-ai-check input { accent-color: rgb(var(--c-primary)); }
.ce-ai-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ce-ai-spin { animation: ce-ai-rotate 1s linear infinite; }
@keyframes ce-ai-rotate { to { transform: rotate(360deg); } }
.ce-ai-hint { margin: 0; color: rgb(var(--c-muted)); font-size: 10.5px; line-height: 1.5; }

/* ================= 图层页 ================= */
.ce-ly-empty { margin: 0; font-size: 12px; color: rgb(var(--c-muted)); }
.ce-ly-row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: rgb(var(--c-surface-alt));
  color: rgb(var(--c-on-surface));
  font-size: 12px;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.15s, border-color 0.15s;
}
.ce-ly-row:hover { background: rgb(var(--c-surface-alt)); }
.ce-ly-row.on {
  border-color: rgb(var(--c-primary) / 0.5);
  background: rgb(var(--c-primary) / 0.12);
  color: rgb(var(--c-primary));
}
.ce-ly-row.surf { color: rgb(var(--c-muted)); }
.ce-ly-row.drop { box-shadow: 0 -2px 0 0 rgb(var(--c-primary)); }
.ce-ly-ic { font-size: 15px; flex: none; color: rgb(var(--c-muted)); }
.ce-ly-row.on .ce-ly-ic { color: rgb(var(--c-primary)); }
.ce-ly-name {
  font-style: normal;
  font-weight: 600;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 弹窗层徽标：紧随名称的小胶囊，琥珀描边 */
.ce-ly-badge {
  flex: none;
  font-style: normal;
  font-size: 9px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 99px;
  color: rgb(var(--c-primary));
  border: 1px solid rgb(var(--c-primary) / 0.45);
  background: rgb(var(--c-primary) / 0.1);
}
.ce-ly-acts { flex: none; display: flex; gap: 2px; }
.ce-ly-acts button {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgb(var(--c-muted));
  cursor: pointer;
}
.ce-ly-acts button .material-symbols-outlined { font-size: 14px; }
.ce-ly-acts button:hover { background: rgb(var(--c-primary) / 0.16); color: rgb(var(--c-primary)); }
.ce-ly-acts button:disabled { opacity: 0.3; cursor: default; }
.ce-ly-acts button:disabled:hover { background: transparent; color: rgb(var(--c-muted)); }

/* 元素代码视图：只编辑选中元素的 HTML */
.ce-elcode {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ce-elcode-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  background: rgb(var(--c-surface-alt));
  font-size: 12px;
  color: rgb(var(--c-on-surface));
}
.ce-elcode-head > .material-symbols-outlined { font-size: 15px; color: rgb(var(--c-primary)); flex: none; }
.ce-elcode-title { font-weight: 700; flex: none; }
.ce-elcode-desc {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--c-info));
  background: rgb(var(--c-info) / 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-elcode-editor { flex: 1 1 auto; min-height: 0; }
.ce-elcode-err {
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 6px 12px;
  font-size: 11px;
  color: rgb(var(--c-error));
  background: rgb(var(--c-error) / 0.08);
  border: 1px solid rgb(var(--c-error) / 0.25);
  border-radius: 10px;
}
.ce-elcode-err .material-symbols-outlined { font-size: 13px; flex: none; }

/* 元素页：CSS 样式编辑区 */
.ce-elcss {
  flex: none;
  display: flex;
  flex-direction: column;
  border: 1px solid rgb(var(--c-border));
  border-radius: 10px;
  background: rgb(var(--c-surface));
  overflow: hidden;
  margin-top: 10px;
}
.ce-elcss-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 700;
  color: rgb(var(--c-on-surface));
  border-bottom: 1px solid rgb(var(--c-border));
}
.ce-elcss-head .material-symbols-outlined { font-size: 16px; color: rgb(var(--c-primary)); }
.ce-elcss-codebtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 7px;
  background: transparent;
  color: rgb(var(--c-muted));
  font-size: 11px;  font-weight: 600;
  cursor: pointer;
}
.ce-elcss-codebtn .material-symbols-outlined { font-size: 14px; }
.ce-elcss-codebtn:hover { color: rgb(var(--c-on-surface)); border-color: rgb(var(--c-border)); }
.ce-elcss-del { padding: 0 6px; }
.ce-elcss-del:hover:not(:disabled) { color: rgb(var(--c-error)); border-color: rgb(var(--c-error) / 0.4); background: rgb(var(--c-error) / 0.12); }
.ce-elcss-del:disabled { opacity: 0.35; cursor: not-allowed; }
.ce-elcss-codebtn.on { background: rgb(var(--c-primary) / 0.14); color: rgb(var(--c-primary)); border-color: rgb(var(--c-primary) / 0.3); }
.ce-elcss-ta {
  height: 90px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  outline: none;
  resize: vertical;
  color: rgb(var(--c-on-surface));
  font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
}

/* 元素页：所有元素列表（上半） + 选中元素属性面板（下半占满） */
.ce-elems {
  flex: none;
  max-height: 38%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid rgb(var(--c-border));
  border-radius: 10px;
  background: rgb(var(--c-surface));
  margin-bottom: 10px;
}

/* 元素属性面板：设计模式下占满原代码编辑区（属性条由 VisualStage 注入） */
.ce-design-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  padding: 10px 12px;
}
.ce-design-panel:has(.ve-bar) { padding: 0; }
.ce-dp-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  color: rgb(var(--c-muted));
  padding: 20px;
}
.ce-dp-placeholder > .material-symbols-outlined {
  font-size: 38px;
  color: rgb(var(--c-primary));
  opacity: 0.85;
}
.ce-dp-title { margin: 0; font-size: 14px; font-weight: 700; color: rgb(var(--c-on-surface)); }
.ce-dp-guides {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
}
.ce-dp-guides li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: rgb(var(--c-muted));
}
.ce-dp-guides .material-symbols-outlined {
  font-size: 17px;
  color: rgb(var(--c-accent));
  flex: none;
}
/* 属性条注入后隐藏占位提示 */
.ce-design-panel:has(.ve-bar) .ce-dp-placeholder { display: none; }
.ce-field {
  background: rgb(var(--c-surface-alt));
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  padding: 11px 13px;
  position: relative;
}
.ce-slot-box { position: relative; overflow: visible; z-index: 2; }
/* 槽位框在主实体之下时需要提升层级，防止下拉被下一个槽位框盖住 */
.ce-slot-box + .ce-slot-box { z-index: 1; }
.ce-field-entity { flex: 1 1 260px; min-width: 220px; }
.ce-field-size { flex: none; display: flex; flex-direction: column; gap: 7px; }
.ce-field-icon { flex: 0 1 auto; min-width: 0; }
.ce-label {
  display: block;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--c-muted));
  font-weight: 700;
  margin-bottom: 7px;
}
.ce-label-sub {
  float: right;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--c-primary));
}

/* 多实体（通用卡） */
.ce-multi-box { display: flex; flex-direction: column; gap: 6px; }
.ce-multi-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 132px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ce-multi-item { background: rgb(var(--c-surface)); border: 1px solid rgb(var(--c-border)); cursor: default; }
.ce-multi-item:hover { background: rgb(var(--c-surface)); }
/* ===== 槽位框折叠态 / 展开态 ===== */
.ce-slot-collapsed {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}
.ce-slot-num {
  font-size: 17px;
  font-weight: 800;
  color: rgb(var(--c-primary));
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.ce-slot-num-sub {
  font-size: 9px;
  color: rgb(var(--c-muted));
  margin-right: auto;
}
.ce-slot-act { flex: none; }
.ce-slot-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}
.ce-primary-tag {
  flex: none;
  font-size: 9px;
  font-weight: 700;
  color: rgb(var(--c-primary));
  background: rgb(var(--c-primary) / 0.12);
  border: 1px solid rgb(var(--c-primary) / 0.3);
  border-radius: 5px;
  padding: 1px 5px;
}
/* chip 右侧按钮组（上移 / 下移 / 删除） */
.ce-multi-act { display: inline-flex; align-items: center; gap: 1px; flex: none; margin-left: auto; }
.ce-multi-mv {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--c-muted));
  border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.ce-multi-mv:hover:not(:disabled) { background: rgb(var(--c-border)); color: rgb(var(--c-on-surface)); }
.ce-multi-mv:disabled { opacity: 0.3; cursor: not-allowed; }
.ce-multi-mv .material-symbols-outlined { font-size: 13px; line-height: 1; }
.ce-multi-del {
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(var(--c-muted));
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ce-multi-del .material-symbols-outlined { font-size: 14px; }
.ce-multi-del:hover { color: rgb(var(--c-error)); background: rgb(var(--c-error) / 0.1); }
.ce-add-entity {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 8px;
  background: transparent;
  border: 1px dashed rgb(var(--c-primary) / 0.45);
  color: rgb(var(--c-primary));
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ce-add-entity .material-symbols-outlined { font-size: 17px; }
.ce-add-entity:hover { background: rgb(var(--c-primary) / 0.08); border-color: rgb(var(--c-primary)); }
.ce-dd-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid rgb(var(--c-border));
}
.ce-dd-tip { flex: 1; min-width: 0; font-size: 11px; color: rgb(var(--c-muted)); }

/* 实体下拉 */
.ce-combobox { position: relative; }
.ce-combo-btn {
  width: 100%;
  min-height: 34px;
  height: auto;
  padding: 6px 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 8px;
  border-radius: 8px;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
}
.ce-combo-btn:hover { border-color: rgb(var(--c-primary) / 0.45); background: rgb(var(--c-surface)); }
.ce-combo-name {
  font-size: 12.5px;
  color: rgb(var(--c-on-surface));
  font-weight: 600;
  /* 不压缩实体名：允许换行完整显示 */
  white-space: normal;
  word-break: break-all;
  overflow: visible;
  min-width: 0;
  flex: 1 1 auto;
}
.ce-combo-id {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: rgb(var(--c-muted));
  /* 实体 ID 独占一行完整显示，不被压缩 */
  white-space: normal;
  word-break: break-all;
  overflow: visible;
  flex: 0 0 100%;
}
.ce-combo-empty { font-size: 12.5px; color: rgb(var(--c-muted)); }
.ce-combo-caret { margin-left: auto; font-size: 18px; color: rgb(var(--c-muted)); flex: none; }
.ce-domain-badge {
  flex: none;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: rgb(var(--c-info));
  background: rgb(var(--c-info) / 0.12);
  border: 1px solid rgb(var(--c-info) / 0.25);
  border-radius: 5px;
  padding: 2px 6px;
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 11px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.ce-menu-enter-active, .ce-menu-leave-active { transition: all 0.16s ease; transform-origin: top; }
.ce-menu-enter-from, .ce-menu-leave-to { opacity: 0; transform: scaleY(0.96) translateY(-4px); }
.ce-search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 9px;
  padding: 0 9px;
  height: 32px;
  border-radius: 8px;
  background: rgb(var(--c-background));
  border: 1px solid rgb(var(--c-border));
}
.ce-search .material-symbols-outlined { font-size: 16px; color: rgb(var(--c-muted)); }
.ce-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12.5px;
  color: rgb(var(--c-on-surface));
}
.ce-search-input::placeholder { color: rgb(var(--c-faint)); }
.ce-entity-list { list-style: none; margin: 0; padding: 0 6px 6px; max-height: 224px; overflow-y: auto; }
.ce-entity-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.ce-entity-item:hover { background: rgb(var(--c-primary) / 0.09); }
.ce-entity-item.on { background: rgb(var(--c-primary) / 0.13); }
.ce-en-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.ce-en-name {
  font-size: 12.5px;
  color: rgb(var(--c-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-en-id {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: rgb(var(--c-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ce-en-check { font-size: 17px; color: rgb(var(--c-primary)); flex: none; }
.ce-entity-empty { padding: 14px 10px; font-size: 12px; color: rgb(var(--c-muted)); text-align: center; }

/* 尺寸点选 */
.ce-sizepick {
  display: grid;
  grid-template-columns: repeat(4, 18px);
  grid-auto-rows: 18px;
  gap: 5px;
}
.ce-size-cell {
  border-radius: 4px;
  background: rgb(var(--c-border));
  border: 1px solid rgb(var(--c-on-surface) / 0.04);
  cursor: pointer;
  transition: background 0.1s, transform 0.08s;
}
.ce-size-cell:hover { transform: scale(1.08); }
.ce-size-cell.hover { background: rgb(var(--c-primary) / 0.4); }
.ce-size-cell.on { background: rgb(var(--c-primary)); border-color: rgb(var(--c-primary)); box-shadow: 0 0 8px rgb(var(--c-primary) / 0.35); }
.ce-size-text { font-size: 11px; color: rgb(var(--c-muted)); white-space: nowrap; }

/* 自定义图标 */
.ce-icon-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ce-icon-preview {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
}
.ce-icon-preview .material-symbols-outlined { font-size: 17px; color: rgb(var(--c-muted)); }
.ce-icon-input {
  flex: 1 0 160px;
  min-width: 160px;
  height: 30px;
  padding: 0 9px;
  font: 11px/1 ui-monospace, Menlo, Consolas, monospace;
  color: rgb(var(--c-on-surface));
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 8px;
  outline: none;
}
.ce-icon-input:focus { border-color: rgb(var(--c-accent) / 0.45); }
.ce-icon-sugs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.ce-icon-sug {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s;
}
.ce-icon-sug .material-symbols-outlined { font-size: 15px; color: rgb(var(--c-muted)); }
.ce-icon-sug:hover { border-color: rgb(var(--c-border)); background: rgb(var(--c-border)); }
.ce-icon-sug.on { border-color: rgb(var(--c-accent) / 0.5); background: rgb(var(--c-accent) / 0.08); }
.ce-icon-sug.on .material-symbols-outlined { color: rgb(var(--c-accent)); }

/* 自定义头像（人员位置卡） */
.ce-avatar-row { display: flex; align-items: center; gap: 8px; }
.ce-avatar-preview {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(var(--c-surface));
  border: 1px solid rgb(var(--c-border));
}
.ce-avatar-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ce-avatar-preview .material-symbols-outlined { font-size: 20px; color: rgb(var(--c-muted)); }
.ce-avatar-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ce-hidden-input { display: none; }

/* Tabs */
.ce-tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-bottom: 1px solid rgb(var(--c-border));
}
.ce-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--c-muted));
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  margin-bottom: -1px;
  border-radius: 8px 8px 0 0;
}
.ce-tab:hover { color: rgb(var(--c-on-surface)); }
.ce-tab.on {
  color: rgb(var(--c-on-background));
  border-bottom-color: rgb(var(--c-primary));
  background: rgb(var(--c-primary) / 0.07);
}
.ce-lang-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.dot-html { background: rgb(var(--c-primary)); }
.dot-css { background: rgb(var(--c-info)); }
.dot-js { background: rgb(var(--c-accent)); }
.ce-tab-len {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10px;
  color: rgb(var(--c-faint));
  background: rgb(var(--c-on-surface) / 0.05);
  border-radius: 4px;
  padding: 1px 5px;
}
.ce-tab.on .ce-tab-len { color: rgb(var(--c-primary)); background: rgb(var(--c-primary) / 0.1); }
.ce-tab-hint { font-size: 10.5px; color: rgb(var(--c-faint)); display: flex; align-items: center; gap: 3px; padding-right: 8px; }

/* 代码编辑区 */
.ce-code {
  flex: 1;
  min-height: 160px;
  display: flex;
  border: 1px solid rgb(var(--c-border));
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--c-background));
}
.ce-gutter {
  flex: none;
  width: 46px;
  overflow: hidden;
  background: rgb(var(--c-surface));
  border-right: 1px solid rgb(var(--c-border));
}
.ce-gutter-inner { padding: 10px 0; will-change: transform; }
.ce-gutter-line {
  height: 20px;
  padding-right: 10px;
  text-align: right;
  font: 12px/20px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: rgb(var(--c-border));
  user-select: none;
  -webkit-user-select: none;
}
.ce-code-scroll { position: relative; flex: 1; min-width: 0; }
.ce-pre,
.ce-ta {
  margin: 0;
  padding: 10px 14px;
  font: 12.5px/20px ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Roboto Mono', monospace;
  letter-spacing: 0;
  tab-size: 2;
  white-space: pre;
  border: 0;
}
.ce-pre {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  color: rgb(var(--c-on-surface));
  background: transparent;
}
.ce-pre code { font: inherit; white-space: pre; }
.ce-ta {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  resize: none;
  overflow: auto;
  color: transparent;
  caret-color: rgb(var(--c-primary));
  background: transparent;
  outline: none;
  -webkit-text-fill-color: transparent;
}
.ce-ta::selection {
  background: rgb(var(--c-primary) / 0.2);
  color: transparent;
}
/* 中文输入法组词期间临时显示文字（常态文字透明，仅显示下层语法高亮） */
.ce-ta.is-composing {
  color: rgb(var(--c-on-surface));
  -webkit-text-fill-color: rgb(var(--c-on-surface));
}
.ce-ta::placeholder { color: rgb(var(--c-border)); }

/* 语法 token 配色 */
.ce-pre :deep(.tok-comment) { color: rgb(var(--c-border)); font-style: italic; }
.ce-pre :deep(.tok-tag) { color: #7dd3fc; }
.ce-pre :deep(.tok-punct) { color: #7dd3fc; }
.ce-pre :deep(.tok-attr) { color: #e5c07b; }
.ce-pre :deep(.tok-str) { color: #98c379; }
.ce-pre :deep(.tok-ph) { color: rgb(var(--c-primary)); font-weight: 700; }
.ce-pre :deep(.tok-kw) { color: #c792ea; }
.ce-pre :deep(.tok-num) { color: #d19a66; }
.ce-pre :deep(.tok-sel) { color: #82aaff; }
.ce-pre :deep(.tok-prop) { color: #79c0ff; }
.ce-pre :deep(.tok-hc) { color: rgb(var(--c-primary)); font-style: italic; font-weight: 600; }
.ce-pre :deep(.tok-arg) { color: rgb(var(--c-accent)); }

/* ================= 状态栏 ================= */
.ce-status {
  flex: none;
  height: 34px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-top: 1px solid rgb(var(--c-border));
  background: rgb(var(--c-on-surface) / 0.015);
  font-size: 11px;
  color: rgb(var(--c-muted));
  overflow: hidden;
}
.ce-status-item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ce-status-dot { width: 6px; height: 6px; border-radius: 50%; background: rgb(var(--c-accent)); }
.ce-dirty-state { color: rgb(var(--c-muted)); }
.ce-dirty-state .ce-status-dot { background: rgb(var(--c-muted)); }
.ce-dirty-state.on { color: rgb(var(--c-primary)); }
.ce-dirty-state.on .ce-status-dot { background: rgb(var(--c-primary)); box-shadow: 0 0 6px rgb(var(--c-primary) / 0.8); }
.ce-hint { flex: none; }
.ce-hint code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: rgb(var(--c-muted));
  background: rgb(var(--c-on-surface) / 0.04);
  border: 1px solid rgb(var(--c-on-surface) / 0.06);
  border-radius: 5px;
  padding: 2px 6px;
  white-space: nowrap;
}

/* ================= 动效 ================= */
.ce-enter-active, .ce-leave-active { transition: opacity 0.2s ease; }
.ce-enter-active .ce-panel, .ce-leave-active .ce-panel { transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease; }
.ce-enter-from, .ce-leave-to { opacity: 0; }
.ce-enter-from .ce-panel, .ce-leave-to .ce-panel { transform: translateY(14px) scale(0.985); opacity: 0; }

/* ================= 响应式：窄屏上下布局 ================= */
@media (max-width: 860px) {
  .ce-overlay { padding: 0; }
  .ce-panel { border-radius: 0; border-left: none; border-right: none; }
  .ce-body { flex-direction: column; padding: 10px; gap: 10px; }
  /* 左功能栏在窄屏变为顶部横排图标条 */
  .ce-funcbar { width: 100%; flex-direction: row; flex-wrap: nowrap; overflow-x: auto; }
  .ce-funcbar.folded { width: 100%; }
  .ce-funcbar .ce-func-label { display: none; }
  .ce-funcbar.folded .ce-func-btn, .ce-func-btn { justify-content: center; padding: 0 10px; }
  .ce-func-fold { margin-top: 0; margin-left: auto; }
  .ce-preview-col { flex: none; height: 34vh; }
  .ce-panel-col { flex: 1; }
  .ce-btn-text { display: none; }
  .ce-kbd { display: none; }
  .ce-config { flex-direction: column; }
  .ce-tab-hint { display: none; }
  .ce-hint { display: none; }
}
</style>

<!-- 户型图页：可编辑平面图 + 2D/3D 切换 + 米家风格设备控制。
     文档存 user_prefs 的 floorplan_doc key（JSON），编辑后 800ms 防抖保存。
     查看态：点击设备图标弹控制窗（复用 EntityMoreInfo）、房间高亮浮层、移动端底部胶囊条。
     编辑态（仅桌面）：拖放设备、画墙/画房间、背景图上传、设备图标自定义。 -->
<template>
  <!-- 高度必须是确定值：移动端也要给 h-*（仅 min-h 会让 h-full 百分比链失效，
       画布 holder 塌陷为 0 高 → 缩放控件锚到顶部压住工具条、画布不可见） -->
  <div class="flex flex-col border border-border rounded-2xl overflow-hidden h-[calc(100dvh-12rem)] min-h-[24rem] lg:h-[calc(100vh-13rem)] lg:min-h-[26rem] bg-background/30">
    <!-- 工具栏 -->
    <FloorplanToolbar
      :view="view" @update:view="setView"
      :edit-mode="editMode" :can-edit="canEdit" @toggle-edit="toggleEdit"
      :tool="tool" @update:tool="tool = $event"
      :save-state="saveState" :floor-count="doc.floors.length"
      :can-undo="canUndo" :can-redo="canRedo"
      @add-floor="addFloor" @del-floor="delFloor" @bg-upload="onBgUpload" @save="saveNow"
      @undo="undo" @redo="redo"
    />

    <!-- 楼层切换 -->
    <div class="flex items-center gap-2 px-4 pt-3 pb-1 flex-wrap" @focusin.capture="pushHistory">
      <span class="text-muted text-xs font-body mr-1">楼层：</span>
      <button
        v-for="(f, i) in doc.floors" :key="f.id"
        class="px-3.5 py-1 rounded-full border text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :class="floorIdx === i ? 'border-primary/60 text-primary bg-primary/10' : 'border-border text-muted hover:text-on-surface'"
        :aria-pressed="floorIdx === i" @click="floorIdx = i"
      >{{ f.name }}</button>

      <!-- 画墙参数：墙高 / 墙厚 -->
      <div v-if="editMode && tool === 'wall'" class="flex items-center gap-3 ml-1">
        <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
          <span class="material-symbols-outlined text-sm" aria-hidden="true">height</span>
          <span>墙高</span>
          <input v-model.number="wallH" type="range" min="1.5" max="5" step="0.05" class="w-20 accent-primary cursor-pointer" :aria-label="'墙高 ' + wallH.toFixed(2) + ' 米'" />
          <span class="w-11 tabular-nums">{{ wallH.toFixed(2) }}m</span>
        </label>
        <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
          <span class="material-symbols-outlined text-sm" aria-hidden="true">width_normal</span>
          <span>墙厚</span>
          <input v-model.number="wallT" type="range" min="0.04" max="0.4" step="0.01" class="w-20 accent-primary cursor-pointer" :aria-label="'墙厚 ' + (wallT * 100).toFixed(0) + ' 厘米'" />
          <span class="w-11 tabular-nums">{{ (wallT * 100).toFixed(0) }}cm</span>
        </label>
      </div>

      <!-- 家具编辑工具（选中家具时）：旋转 / 宽深 / 删除 -->
      <div v-if="editMode && !tool && selectedFurniture" class="flex items-center gap-2 ml-1">
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="逆时针旋转 45°" @click="rotateFurniture(-45)"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">rotate_left</span>
        </button>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="顺时针旋转 45°" @click="rotateFurniture(45)"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">rotate_right</span>
        </button>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>宽</span>
          <input v-model.number="selectedFurniture.w" type="range" min="20" max="300" step="5" class="w-16 accent-primary cursor-pointer" :aria-label="'家具宽度 ' + selectedFurniture.w" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>深</span>
          <input v-model.number="selectedFurniture.d" type="range" min="20" max="300" step="5" class="w-16 accent-primary cursor-pointer" :aria-label="'家具深度 ' + selectedFurniture.d" />
        </label>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-error hover:border-error/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
          title="删除家具" @click="deleteSelectedFurniture"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">delete</span>
        </button>
      </div>

      <!-- 选中墙体的编辑工具：墙高 / 墙厚 / 删除 -->
      <div v-if="editMode && !tool && selectedWall" class="flex items-center gap-3 ml-1">
        <span class="text-[11px] font-body text-info font-medium">墙体</span>
        <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
          <span class="material-symbols-outlined text-sm" aria-hidden="true">height</span>
          <span>墙高</span>
          <input v-model.number="selectedWall.h" type="range" min="1.5" max="5" step="0.05" class="w-20 accent-primary cursor-pointer" :aria-label="'墙高 ' + (selectedWall.h || 2.8).toFixed(2) + ' 米'" />
          <span class="w-11 tabular-nums">{{ (selectedWall.h || 2.8).toFixed(2) }}m</span>
        </label>
        <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
          <span class="material-symbols-outlined text-sm" aria-hidden="true">width_normal</span>
          <span>墙厚</span>
          <input v-model.number="selectedWall.t" type="range" min="0.04" max="0.4" step="0.01" class="w-20 accent-primary cursor-pointer" :aria-label="'墙厚 ' + ((selectedWall.t || 0.12) * 100).toFixed(0) + ' 厘米'" />
          <span class="w-11 tabular-nums">{{ ((selectedWall.t || 0.12) * 100).toFixed(0) }}cm</span>
        </label>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-error hover:border-error/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
          title="删除墙体" @click="deleteSelectedWall"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">delete</span>
        </button>
      </div>

      <!-- 选中房间的编辑工具：改名 / 颜色 / 地板 / 删除 -->
      <div v-if="editMode && !tool && selectedRoom" class="flex items-center gap-3 ml-1 flex-wrap">
        <span class="text-[11px] font-body text-info font-medium">房间</span>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>名称</span>
          <input v-model="selectedRoom.name" type="text" class="w-24 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="房间名称" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>标记色</span>
          <input v-model="selectedRoom.color" type="color" class="w-6 h-6 rounded cursor-pointer" aria-label="房间标记颜色" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>地板色</span>
          <input v-model="selectedRoom.floorColor" type="color" class="w-6 h-6 rounded cursor-pointer" aria-label="地板颜色" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>地板纹理</span>
          <select v-model="selectedRoom.floorTexture" class="px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="地板纹理">
            <option v-for="t in FLOOR_TEXTURE_PRESETS" :key="t.key" :value="t.key">{{ t.name }}</option>
          </select>
        </label>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="从墙自动生成房间轮廓" @click="fillRoomFromWalls"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">auto_fix_high</span>
          <span>墙填充</span>
        </button>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-error hover:border-error/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
          title="删除房间" @click="deleteSelectedRoom"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">delete</span>
        </button>
      </div>

      <!-- 画布设置（编辑态始终可见） -->
      <div v-if="editMode && !tool" class="flex items-center gap-3 ml-1 flex-wrap">
        <span class="text-[11px] font-body font-medium text-muted">画布</span>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>宽</span>
          <input v-model.number="doc.canvas.w" type="number" min="400" max="4000" step="10" class="w-14 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="画布宽度" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>高</span>
          <input v-model.number="doc.canvas.h" type="number" min="300" max="3000" step="10" class="w-14 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="画布高度" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>网格</span>
          <input v-model.number="doc.canvas.grid" type="number" min="5" max="100" step="5" class="w-12 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="网格大小" />
        </label>
      </div>

      <!-- 地板编辑（有地板或选中时显示） -->
      <div v-if="editMode && !tool && (floor.floorPoly || selectedFloorId)" class="flex items-center gap-3 ml-1 flex-wrap">
        <span class="text-[11px] font-body font-medium" style="color:#B08AD9">地板</span>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>颜色</span>
          <input v-model="floor.floorColor" type="color" class="w-6 h-6 rounded cursor-pointer" aria-label="地板颜色" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>纹理</span>
          <select v-model="floor.floorTexture" class="px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="地板纹理">
            <option v-for="t in FLOOR_TEXTURE_PRESETS" :key="t.key" :value="t.key">{{ t.name }}</option>
          </select>
        </label>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-muted hover:text-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title="重新绘制地板轮廓" @click="tool = 'floor'"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">draw</span>
          <span>重画</span>
        </button>
        <button
          class="flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-error hover:border-error/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
          title="删除地板" @click="floor.floorPoly = null; selectedFloorId = ''"
        >
          <span class="material-symbols-outlined text-sm" aria-hidden="true">delete</span>
          <span>删除</span>
        </button>
      </div>

      <!-- 墙面编辑（编辑态显示，3D 材质实时生效） -->
      <div v-if="editMode && !tool" class="flex items-center gap-3 ml-1 flex-wrap">
        <span class="text-[11px] font-body font-medium" style="color:#6BA3D9">墙面</span>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>颜色</span>
          <input v-model="floor.wallColor" type="color" class="w-6 h-6 rounded cursor-pointer" aria-label="墙面颜色" />
        </label>
        <label class="flex items-center gap-1 text-[11px] font-body text-muted">
          <span>材质</span>
          <select v-model="floor.wallTexture" class="px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="墙面材质">
            <option v-for="t in WALL_TEXTURE_PRESETS" :key="t.key" :value="t.key">{{ t.name }}</option>
          </select>
        </label>
      </div>

      <span v-if="editMode" class="ml-auto text-[11px] font-body text-info flex items-center gap-1">
        <span class="material-symbols-outlined text-sm" aria-hidden="true">info</span>
        {{ toolHint }}
      </span>
    </div>

    <div class="flex flex-1 min-h-0 flex-col lg:flex-row">
      <!-- 画布区 -->
      <section class="flex-1 min-w-0 flex flex-col min-h-0">
        <div class="flex-1 min-h-0 relative p-3 sm:p-4">
          <div class="relative w-full h-full min-h-[16rem]">
            <!-- 2D / 3D 懒挂载：切走即销毁 -->
            <FloorplanCanvas2D
              v-if="view === '2d'"
              ref="canvas2d"
              :canvas="doc.canvas" :floor="floor" :items="items"
              :edit-mode="editMode" :tool="tool"
              :selected-id="selectedId" :selected-room-id="selectedRoomId" :selected-furniture-id="selectedFurnitureId" :selected-wall-id="selectedWallId"
              :multi-keys="multiKeys"
              @device-click="onDeviceClick" @device-moved="onDeviceMoved"
              @room-click="onRoomClick" @blank-click="onBlankClick"
              @wall-done="onWallDone" @room-done="onRoomDone" @floor-done="onFloorDone" @opening-place="onOpeningPlace"
              @furniture-click="onFurnitureClick" @furniture-moved="onFurnitureMoved"
              @wall-click="onWallClick" @wall-moved="onWallMoved" @room-moved="onRoomMoved"
              @edit-begin="pushHistory"
              @floor-click="onFloorClick" @floor-moved="onFloorMoved"
              @marquee-select="onMarqueeSelect" @context-menu="openContextMenu"
              :selected-floor-id="selectedFloorId"
            />
            <FloorplanCanvas3D
              v-else-if="!editMode"
              :canvas="doc.canvas" :floor="floor" :items="items"
              @device-click="onDeviceClick"
            />

            <!-- 房间高亮浮层 -->
            <button
              v-if="selectedRoom && !editMode"
              class="absolute bottom-3 left-3 bg-background/90 backdrop-blur-sm border border-border rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-xl hover:border-primary/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              @click="openRoomDevices"
            >
              <span class="material-symbols-outlined text-primary" aria-hidden="true">meeting_room</span>
              <span>
                <span class="block text-on-surface text-sm font-headline font-semibold leading-tight">{{ selectedRoom.name }}</span>
                <span class="block text-muted text-[11px] font-body">{{ roomDetail }}</span>
              </span>
            </button>
          </div>
        </div>

        <!-- 移动端：底部横向滚动设备胶囊条（按房间分组） -->
        <div v-if="mobileGroups.length" class="lg:hidden border-t border-border px-3 py-2 flex gap-4 overflow-x-auto overscroll-x-contain" role="list" aria-label="当前楼层设备">
          <div v-for="g in mobileGroups" :key="g.label" class="shrink-0" role="listitem">
            <p class="text-[10px] font-body text-muted mb-1">{{ g.label }}</p>
            <div class="flex gap-1.5">
              <button
                v-for="row in g.rows" :key="row.id"
                class="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :class="row.on ? 'border-primary/40 bg-primary/10' : 'border-border bg-surface-alt'"
                @click="openMore(row._entity)"
              >
                <span class="material-symbols-outlined text-sm" :class="row.on ? 'text-primary' : 'text-muted'" aria-hidden="true">{{ row.icon }}</span>
                <span class="text-[11px] font-body max-w-16 truncate" :class="row.on ? 'text-on-surface' : 'text-muted'">{{ row.name }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 图例（桌面） -->
        <div class="hidden lg:flex flex-wrap items-center gap-4 px-4 py-2.5 border-t border-border bg-background/50">
          <span class="text-muted text-xs font-body">设备状态：</span>
          <span class="flex items-center gap-2 text-muted text-xs font-body"><span class="w-3.5 h-3.5 rounded-full border border-primary/70 bg-primary/25 shadow-[0_0_6px] shadow-primary/40"></span>开启</span>
          <span class="flex items-center gap-2 text-muted text-xs font-body"><span class="w-3.5 h-3.5 rounded-full border border-border bg-surface-alt"></span>关闭</span>
          <span class="ml-auto text-muted text-xs font-body">本层 {{ floor.devices.length }} 台设备</span>
        </div>
      </section>

      <!-- 编辑态：3D 实时预览（2D 右侧并排）+ 渲染/材质面板 -->
      <section v-if="editMode" class="hidden lg:flex flex-1 min-w-0 flex-col min-h-0 border-l border-border">
        <div class="flex-1 min-h-0 relative p-3">
          <FloorplanCanvas3D
            :canvas="doc.canvas" :floor="floor" :items="items"
            :edit-mode="true" :selected-furniture-id="selectedFurnitureId"
            @device-click="onDeviceClick" @furniture-click="onFurnitureClick"
          />
        </div>

        <!-- 渲染/材质面板 -->
        <div class="border-t border-border bg-background/50 p-3 space-y-4 overflow-y-auto overscroll-contain max-h-72" @focusin.capture="pushHistory">
          <!-- 光照 / 阴影 -->
          <fieldset>
            <legend class="flex items-center gap-1.5 text-xs font-body font-semibold text-on-surface mb-2">
              <span class="material-symbols-outlined text-sm text-info" aria-hidden="true">light_mode</span>渲染设置
            </legend>
            <!-- 场景光照预设：一键切换白天/黄昏/夜晚 -->
            <div class="flex items-center gap-1 mb-2.5" role="group" aria-label="光照场景预设">
              <button v-for="p in LIGHT_PRESETS" :key="p.key" type="button"
                class="flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-body transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :class="lightPresetKey === p.key ? 'border-info/60 bg-info/10 text-info' : 'border-border bg-surface-alt text-muted hover:text-on-surface'"
                @click="applyLightPreset(p)">
                <span class="material-symbols-outlined text-sm" aria-hidden="true">{{ p.icon }}</span>
                <span>{{ p.name }}</span>
              </button>
            </div>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
              <span class="w-11">环境光</span>
              <input v-model.number="floor.lighting.ambient" type="range" min="0" max="6" step="0.1" class="flex-1 accent-primary cursor-pointer" :aria-label="'环境光强度 ' + floor.lighting.ambient" />
              <span class="w-8 tabular-nums">{{ floor.lighting.ambient.toFixed(1) }}</span>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">平行光</span>
              <input v-model.number="floor.lighting.dir" type="range" min="0" max="8" step="0.1" class="flex-1 accent-primary cursor-pointer" :aria-label="'平行光强度 ' + floor.lighting.dir" />
              <span class="w-8 tabular-nums">{{ floor.lighting.dir.toFixed(1) }}</span>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">色温</span>
              <input v-model="floor.lighting.color" type="color" class="w-7 h-6 rounded cursor-pointer" aria-label="光照色温" />
            </label>
            <label class="flex items-center gap-2 text-[11px] font-body text-muted mt-2 cursor-pointer">
              <input v-model="floor.lighting.shadow" type="checkbox" class="accent-primary" />
              <span>阴影</span>
            </label>
          </fieldset>

          <!-- 选中家具的材质设置 -->
          <fieldset v-if="selectedFurniture">
            <legend class="flex items-center gap-1.5 text-xs font-body font-semibold text-on-surface mb-2">
              <span class="material-symbols-outlined text-sm text-info" aria-hidden="true">palette</span>家具材质 · {{ selectedFurniture.name }}
            </legend>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
              <span class="w-11">颜色</span>
              <input v-model="selectedFurniture.color" type="color" class="w-7 h-6 rounded cursor-pointer" aria-label="家具颜色" />
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">金属度</span>
              <input v-model.number="selectedFurniture.metalness" type="range" min="0" max="1" step="0.01" class="flex-1 accent-primary cursor-pointer" :aria-label="'金属度 ' + selectedFurniture.metalness" />
              <span class="w-8 tabular-nums">{{ selectedFurniture.metalness.toFixed(2) }}</span>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">粗糙度</span>
              <input v-model.number="selectedFurniture.roughness" type="range" min="0" max="1" step="0.01" class="flex-1 accent-primary cursor-pointer" :aria-label="'粗糙度 ' + selectedFurniture.roughness" />
              <span class="w-8 tabular-nums">{{ selectedFurniture.roughness.toFixed(2) }}</span>
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">纹理</span>
              <select v-model="selectedFurniture.texture" class="flex-1 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="纹理预设">
                <option v-for="t in TEXTURE_PRESETS" :key="t.key" :value="t.key">{{ t.name }}</option>
              </select>
            </label>
            <div v-if="selectedFurniture.model" class="mt-2 space-y-1.5">
              <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
                <span class="w-11">OBJ</span>
                <input v-model="selectedFurniture.model.obj" type="text" class="flex-1 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" placeholder="models/furniture/…/x.obj" aria-label="OBJ 模型路径" />
              </label>
              <label v-if="selectedFurniture.model.mtl" class="flex items-center gap-1.5 text-[11px] font-body text-muted">
                <span class="w-11">MTL</span>
                <input v-model="selectedFurniture.model.mtl" type="text" class="flex-1 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" placeholder="models/furniture/…/x.mtl" aria-label="MTL 材质路径" />
              </label>
            </div>
          </fieldset>
          <!-- 选中房间的材质设置（房间地板独立铺装） -->
          <fieldset v-if="selectedRoom">
            <legend class="flex items-center gap-1.5 text-xs font-body font-semibold text-on-surface mb-2">
              <span class="material-symbols-outlined text-sm text-info" aria-hidden="true">door_front</span>房间材质 · {{ selectedRoom.name }}
            </legend>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted">
              <span class="w-11">名称</span>
              <input v-model="selectedRoom.name" type="text" class="flex-1 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="房间名称" />
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">地板色</span>
              <input v-model="selectedRoom.floorColor" type="color" class="w-7 h-6 rounded cursor-pointer" aria-label="房间地板颜色" />
            </label>
            <label class="flex items-center gap-1.5 text-[11px] font-body text-muted mt-1.5">
              <span class="w-11">地板</span>
              <select v-model="selectedRoom.floorTexture" class="flex-1 px-2 py-1 rounded-lg border border-border bg-surface-alt text-xs font-body text-on-surface" aria-label="房间地板材质">
                <option v-for="t in FLOOR_TEXTURE_PRESETS" :key="t.key" :value="t.key">{{ t.name }}</option>
              </select>
            </label>
          </fieldset>
        </div>
      </section>
      <section class="hidden lg:flex lg:w-2/5 xl:w-[36%] flex-col border-l border-border min-h-0 bg-background/20">
        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4">
          <template v-if="!editMode">
            <div class="flex items-center justify-between mb-3">
              <div class="min-w-0">
                <h1 class="font-headline text-lg font-bold text-on-background truncate">{{ floor.name }} · 设备</h1>
                <p class="text-muted text-xs font-body mt-0.5">{{ rows.length ? `${rows.length} 台设备` : '编辑模式下拖入设备' }}</p>
              </div>
            </div>
            <template v-if="rows.length">
              <div v-for="g in panelGroups" :key="g.label" class="mb-4">
                <div class="flex items-center gap-2 mb-2">
                  <div class="w-1 h-4 rounded-full bg-primary/70"></div>
                  <h2 class="font-body text-sm font-semibold text-on-surface truncate">{{ g.label }}</h2>
                  <span class="ml-auto text-[10px] font-body text-muted bg-surface-alt px-2 py-0.5 rounded-full border border-border">{{ g.rows.length }}</span>
                </div>
                <ControlRow
                  v-for="row in g.rows" :key="row.id"
                  :device="row" :model-value="row.on"
                  @update:model-value="onRowToggle(row, $event)"
                />
              </div>
            </template>
            <p v-else class="text-muted text-xs font-body py-6 text-center">
              本楼层还没有放置设备<template v-if="canEdit">，点上方「编辑」开始布置</template>
            </p>
          </template>

          <!-- 编辑态：设备 / 家具拖放面板 -->
          <template v-else>
            <h1 class="font-headline text-lg font-bold text-on-background mb-2">添加</h1>
            <div class="flex rounded-lg border border-border overflow-hidden mb-3" role="tablist" aria-label="添加类型">
              <button
                class="flex-1 py-1.5 text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :class="paletteTab === 'device' ? 'bg-primary text-on-primary' : 'bg-surface-alt text-muted hover:text-on-surface'"
                role="tab" :aria-selected="paletteTab === 'device'" @click="paletteTab = 'device'"
              >设备</button>
              <button
                class="flex-1 py-1.5 text-xs font-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                :class="paletteTab === 'furniture' ? 'bg-primary text-on-primary' : 'bg-surface-alt text-muted hover:text-on-surface'"
                role="tab" :aria-selected="paletteTab === 'furniture'" @click="paletteTab = 'furniture'"
              >家具</button>
            </div>
            <DevicePalette v-if="paletteTab === 'device'" @drag-start="onPaletteDragStart" @add="onPaletteAdd" />
            <FurniturePalette v-else @drag-start="onFurnitureDragStart" @add="onFurnitureAdd" />
          </template>
        </div>
      </section>
    </div>

    <!-- 拖放幽灵元素（跟随指针） -->
    <div
      v-if="paletteDrag"
      class="fixed z-[80] pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full border border-primary/60 bg-background/90 px-3 py-1.5 shadow-xl"
      :style="{ left: paletteDrag.x + 'px', top: paletteDrag.y + 'px' }"
      aria-hidden="true"
    >
      <span class="material-symbols-outlined text-primary text-base">{{ paletteDrag.glyph }}</span>
      <span class="text-xs font-body text-on-surface max-w-24 truncate">{{ paletteDrag.name }}</span>
    </div>

    <!-- 家具拖放幽灵元素（跟随指针） -->
    <div
      v-if="furnitureDrag"
      class="fixed z-[80] pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full border border-info/60 bg-background/90 px-3 py-1.5 shadow-xl"
      :style="{ left: furnitureDrag.x + 'px', top: furnitureDrag.y + 'px' }"
      aria-hidden="true"
    >
      <span class="material-symbols-outlined text-info text-base">{{ furnitureDrag.item.icon }}</span>
      <span class="text-xs font-body text-on-surface max-w-24 truncate">{{ furnitureDrag.item.name }}</span>
    </div>

    <!-- 设备设置弹窗（编辑态） -->
    <DeviceSettingsDialog
      v-if="settingsDev"
      :device="settingsDev" :entity="settingsEntity" :name="settingsName"
      @close="selectedId = ''" @delete="deleteSelected"
    />

    <!-- 设备控制弹窗（查看态，复用「更多信息」面板） -->
    <EntityMoreInfo v-if="moreEntity" :entity="moreEntity" @close="moreEntityId = ''" />

    <!-- 多选浮动操作条 -->
    <div
      v-if="editMode && multiKeys.length >= 2"
      class="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-full border border-border bg-surface/95 backdrop-blur shadow-xl pl-4 pr-1.5 py-1.5 text-sm"
    >
      <span class="text-muted mr-1">已选 {{ multiKeys.length }} 项</span>
      <button class="flex items-center gap-1.5 rounded-full px-3 py-1 text-on-surface hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" @click="duplicateMulti">
        <span class="material-symbols-outlined text-base" aria-hidden="true">content_copy</span>复制
      </button>
      <button class="flex items-center gap-1.5 rounded-full px-3 py-1 text-error hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40" @click="deleteMulti">
        <span class="material-symbols-outlined text-base" aria-hidden="true">delete</span>删除
      </button>
      <button class="w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-on-surface hover:bg-surface-alt" aria-label="取消选择" @click="multiKeys = []">
        <span class="material-symbols-outlined text-base" aria-hidden="true">close</span>
      </button>
    </div>

    <!-- 右键上下文菜单 -->
    <template v-if="contextMenu">
      <div class="fixed inset-0 z-40" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu"></div>
      <div
        role="menu"
        class="fixed z-50 min-w-44 rounded-xl border border-border bg-surface shadow-2xl py-1.5 text-sm"
        :style="contextMenuStyle"
      >
        <button role="menuitem" class="w-full flex items-center gap-2.5 px-3 py-1.5 text-muted hover:text-on-surface hover:bg-surface-alt disabled:opacity-40" :disabled="!canUndo" @click="ctxUndo">
          <span class="material-symbols-outlined text-base" aria-hidden="true">undo</span>撤销
        </button>
        <button role="menuitem" class="w-full flex items-center gap-2.5 px-3 py-1.5 text-muted hover:text-on-surface hover:bg-surface-alt disabled:opacity-40" :disabled="!canRedo" @click="ctxRedo">
          <span class="material-symbols-outlined text-base" aria-hidden="true">redo</span>重做
        </button>
        <div class="my-1 border-t border-border"></div>
        <button v-if="contextMenu.key || multiKeys.length" role="menuitem" class="w-full flex items-center gap-2.5 px-3 py-1.5 text-error hover:bg-error/10" @click="ctxDelete">
          <span class="material-symbols-outlined text-base" aria-hidden="true">delete</span>删除
        </button>
        <button
          v-if="multiKeys.length >= 2 || ['furniture','wall'].includes((contextMenu.key||'').split(':')[0])"
          role="menuitem" class="w-full flex items-center gap-2.5 px-3 py-1.5 text-on-surface hover:bg-surface-alt" @click="ctxDuplicate"
        >
          <span class="material-symbols-outlined text-base" aria-hidden="true">content_copy</span>复制
        </button>
        <button role="menuitem" class="w-full flex items-center gap-2.5 px-3 py-1.5 text-on-surface hover:bg-surface-alt" @click="ctxSelectAll">
          <span class="material-symbols-outlined text-base" aria-hidden="true">select_all</span>全选
        </button>
        <div class="my-1 border-t border-border"></div>
        <button role="menuitem" class="w-full flex items-center gap-2.5 px-3 py-1.5 text-on-surface hover:bg-surface-alt" @click="ctxFitView">
          <span class="material-symbols-outlined text-base" aria-hidden="true">fit_screen</span>适应视图
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import FloorplanCanvas2D from '@/components/floorplan/FloorplanCanvas2D.vue'
import FloorplanCanvas3D from '@/components/floorplan/FloorplanCanvas3D.vue'
import FloorplanToolbar from '@/components/floorplan/FloorplanToolbar.vue'
import DevicePalette from '@/components/floorplan/DevicePalette.vue'
import FurniturePalette from '@/components/floorplan/FurniturePalette.vue'
import DeviceSettingsDialog from '@/components/floorplan/DeviceSettingsDialog.vue'
import ControlRow from '@/components/ControlRow.vue'
import EntityMoreInfo from '@/components/EntityMoreInfo.vue'
import api from '@/api'
import { store, entityStates, registryDevices, loadRegistry, openDeviceDrawer, requestEntityRefresh } from '@/store'
import { getPrefs, putPrefs } from '@/utils/prefs'
import { isOn, iconFor, domainGlyph, attr, numVal } from '@/utils/entities'
import { parseDoc, defaultFloor, placementFromDevice, snap, clamp, uid, snapWallPts, furnitureFromCatalog, OPENING_CHOICES, TEXTURE_PRESETS, FLOOR_TEXTURE_PRESETS, WALL_TEXTURE_PRESETS } from '@/utils/floorplanDoc'
import { toast } from '@/utils/browserCommands'

// ================= 文档 =================
const doc = reactive(parseDoc(null))
const floorIdx = ref(0)
const floor = computed(() => doc.floors[clamp(floorIdx.value, 0, doc.floors.length - 1)])

// ================= 模式状态机 =================
const view = ref('2d')                       // '2d' | '3d'
const editMode = ref(false)
const tool = ref('')                         // '' | 'wall' | 'room'
const selectedId = ref('')                   // 编辑态选中设备
const selectedRoomId = ref('')               // 查看态高亮房间
const canvas2d = ref(null)
const wallH = ref(2.8)                        // 画墙默认墙高（米）
const wallT = ref(0.12)                       // 画墙默认墙厚（米）
const paletteTab = ref('device')              // 编辑侧栏：device | furniture
const selectedFurnitureId = ref('')           // 编辑态选中家具
const selectedWallId = ref('')                // 编辑态选中墙体
const selectedFloorId = ref('')               // 编辑态选中地板轮廓
const multiKeys = ref([])                     // 框选/多选对象键集合（≥2 时整组操作）
const contextMenu = ref(null)                 // 右键菜单 {x, y, key}
const contextMenuStyle = computed(() => {
  if (!contextMenu.value) return {}
  const x = Math.min(contextMenu.value.x, window.innerWidth - 180)
  const y = Math.min(contextMenu.value.y, window.innerHeight - 240)
  return { left: x + 'px', top: y + 'px' }
})
// 切换楼层：多选/右键菜单只在当前楼层有效
watch(floorIdx, () => { multiKeys.value = []; contextMenu.value = null })

const toolHint = computed(() => {
  switch (tool.value) {
    case 'wall': return '单击落点画墙，回车或「完成」结束'
    case 'room': return '单击落点围合房间，回车闭合'
    case 'door': return '单击墙段放置门'
    case 'window': return '单击墙段放置窗'
    case 'floor': return '单击落点画地板轮廓，回车闭合'
    default: return '拖动设备/墙体/房间调整位置，点击可选中编辑或删除'
  }
})

// 编辑能力门槛：粗指针（触屏）或窄屏禁用编辑
function computeCanEdit() {
  return !(window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
}
const canEdit = ref(computeCanEdit())
function onResize() {
  canEdit.value = computeCanEdit()
  if (!canEdit.value && editMode.value) toggleEdit()
}

function setView(v) {
  view.value = v
  if (v === '3d' && editMode.value) toggleEdit() // 3D 下不支持编辑
}
function toggleEdit() {
  editMode.value = !editMode.value
  if (editMode.value) view.value = '2d'   // 编辑固定以 2D 为主，3D 作为右侧实时预览
  tool.value = ''
  clearSelection()
}

// ================= 历史：撤销 / 重做（统一文档快照栈） =================
const HISTORY_LIMIT = 30
const histPast = ref([])
const histFuture = ref([])
const canUndo = computed(() => histPast.value.length > 0)
const canRedo = computed(() => histFuture.value.length > 0)

// 在任何结构修改「之前」调用：保存当前状态；与栈顶相同则跳过（如焦点移动未改动）
function pushHistory() {
  const snap = JSON.stringify(doc)
  const top = histPast.value[histPast.value.length - 1]
  if (top === snap) return
  histPast.value.push(snap)
  if (histPast.value.length > HISTORY_LIMIT) histPast.value.shift()
  histFuture.value = []
}
function restoreSnapshot(snap) {
  const parsed = JSON.parse(snap)
  if (parsed.canvas) doc.canvas = parsed.canvas
  if (Array.isArray(parsed.floors)) doc.floors = parsed.floors
  floorIdx.value = clamp(floorIdx.value, 0, doc.floors.length - 1)
}
function undo() {
  if (!histPast.value.length) return
  histFuture.value.push(JSON.stringify(doc))
  restoreSnapshot(histPast.value.pop())
}
function redo() {
  if (!histFuture.value.length) return
  histPast.value.push(JSON.stringify(doc))
  restoreSnapshot(histFuture.value.pop())
}

// ================= 持久化 =================
const saveState = ref('idle') // idle | saving | saved | error
let saveTimer = null
let loaded = false

async function loadDoc() {
  try {
    const { data } = await getPrefs()
    const parsed = parseDoc(data?.floorplan_doc || '')
    Object.assign(doc, parsed)
    floorIdx.value = 0
  } catch { /* 后端离线：用默认文档 */ }
  loaded = true
}

// 文档任意变化 → 800ms 防抖保存
watch(doc, () => {
  if (!loaded) return
  if (saveTimer) clearTimeout(saveTimer)
  saveState.value = 'saving'
  saveTimer = setTimeout(() => { saveTimer = null; saveNow() }, 800)
}, { deep: true })

// 手动保存：立即落盘并给出状态反馈
async function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveState.value = 'saving'
  try {
    await putPrefs({ floorplan_doc: JSON.stringify(doc) })
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
    toast('户型图保存失败，请检查后端连接')
  }
}

// ================= 设备项（文档放置 × 实时状态） =================
const regById = computed(() => {
  const m = new Map()
  for (const d of registryDevices.value) {
    const id = d.device && d.device.id ? String(d.device.id) : ''
    if (id) m.set(id, d)
  }
  return m
})

const items = computed(() => floor.value.devices.map((dev) => {
  const reg = dev.deviceId ? regById.value.get(dev.deviceId) : null
  const entity = dev.entityId ? entityStates[dev.entityId] : null
  const name = reg?.display_name || entity?.friendly_name || dev.entityId || ''
  return { dev, entity, name }
}))

// ================= 查看态：设备列表（按房间分组） =================
function rowFromPlacement(dev) {
  const reg = dev.deviceId ? regById.value.get(dev.deviceId) : null
  const me = dev.entityId ? entityStates[dev.entityId] : null
  if (!reg && !me) return null
  const e = me || (reg?.entities || [])[0]
  if (!e) return null
  const on = isOn(e)
  const dom = e.domain || 'switch'
  const colorCls = dom === 'light' ? 'text-primary' : dom === 'climate' ? 'text-info' : dom === 'cover' ? 'text-warning' : 'text-accent'
  const bg = (colorCls === 'text-primary' ? 'bg-primary/20' : colorCls === 'text-info' ? 'bg-info/20' : colorCls === 'text-warning' ? 'bg-warning/20' : 'bg-accent/20') + ' border-border'
  let value = 0, unit = '%', altText = ''
  if (dom === 'climate') { value = numVal(attr(e, 'temperature')) || 0; unit = '°C' }
  else if (dom === 'switch' || dom === 'plug') { value = numVal(attr(e, 'power')) || 0; unit = 'W' }
  else if (dom === 'cover') { value = numVal(attr(e, 'current_position')) || (on ? 100 : 0) }
  else if (dom === 'light') { value = numVal(attr(e, 'brightness')) || (on ? 100 : 0) }
  else { altText = e.state || '—'; unit = '' }
  return {
    id: dev.id, _entity: e.entity_id, roomId: dev.roomId || '',
    name: reg?.display_name || e.friendly_name || dev.entityId,
    icon: iconFor({ icon: reg?.main_icon || e.icon }, domainGlyph[dom] || 'widgets'),
    color: colorCls, bg, on, value, unit, altText,
  }
}

const rows = computed(() => floor.value.devices.map(rowFromPlacement).filter(Boolean))
const roomLabel = computed(() => {
  const m = new Map()
  for (const r of floor.value.rooms) m.set(r.id, r.name)
  return (id) => m.get(id) || '未分区'
})
function groupRows(list) {
  const m = new Map()
  for (const row of list) {
    const label = roomLabel.value(row.roomId)
    if (!m.has(label)) m.set(label, [])
    m.get(label).push(row)
  }
  return [...m.entries()].map(([label, rs]) => ({ label, rows: rs }))
}
const panelGroups = computed(() => groupRows(rows.value))
const mobileGroups = computed(() => groupRows(rows.value))

// 开关：乐观更新 + 后端 toggle + 兜底刷新
async function onRowToggle(row, val) {
  if (!row?._entity) return
  row.on = !!val
  try {
    await api.toggle(store.activeID, row._entity)
    requestEntityRefresh(400)
  } catch { row.on = !val }
}

// ================= 查看态：设备控制弹窗（复用 EntityMoreInfo） =================
const moreEntityId = ref('')
function findRegistryEntity(id) {
  for (const d of registryDevices.value) {
    const hit = (d.entities || []).find((e) => e.entity_id === id)
    if (hit) return hit
  }
  return null
}
const moreEntity = computed(() => {
  const id = moreEntityId.value
  if (!id) return null
  const reg = findRegistryEntity(id)
  const live = entityStates[id]
  if (!reg && !live) return null
  const attrs = { ...(reg?.attributes || {}), ...(live?.attributes || {}) }
  return {
    entity_id: id,
    domain: reg?.domain || live?.domain || id.split('.')[0],
    friendly_name: attrs.friendly_name || reg?.friendly_name || id,
    icon: reg?.icon || '',
    unit: attrs.unit_of_measurement || reg?.unit || '',
    state: live?.state !== undefined ? live.state : (reg?.state ?? ''),
    attributes: attrs,
  }
})
function openMore(entityId) { if (entityId) moreEntityId.value = entityId }

// ================= 画布事件 =================
function onDeviceClick(dev) {
  if (editMode.value) {
    multiKeys.value = []
    selectedId.value = dev.id; selectedRoomId.value = ''; selectedFurnitureId.value = ''; selectedWallId.value = ''
  }
  else openMore(dev.entityId)
}
function onDeviceMoved() { /* 位置已写入文档，深监听自动保存 */ }
function onRoomClick(r) {
  if (editMode.value) {
    // 编辑态：选中房间以便改名/改色/删除
    multiKeys.value = []
    selectedRoomId.value = r.id
    selectedId.value = ''
    selectedFurnitureId.value = ''
    selectedWallId.value = ''
    selectedFloorId.value = ''
  } else {
    selectedRoomId.value = selectedRoomId.value === r.id ? '' : r.id
  }
}
function onWallClick(w) {
  multiKeys.value = []
  selectedWallId.value = w.id
  selectedId.value = ''
  selectedRoomId.value = ''
  selectedFurnitureId.value = ''
  selectedFloorId.value = ''
}
function onWallMoved() { /* 位置已写入文档，深监听自动保存 */ }
function onRoomMoved() { /* 位置已写入文档，深监听自动保存 */ }
function onBlankClick() {
  multiKeys.value = []
  selectedRoomId.value = ''; selectedId.value = ''; selectedFurnitureId.value = ''; selectedWallId.value = ''; selectedFloorId.value = ''
}
function onFloorClick(f) {
  multiKeys.value = []
  selectedFloorId.value = f.id
  selectedId.value = ''; selectedRoomId.value = ''; selectedFurnitureId.value = ''; selectedWallId.value = ''
}
function onFloorMoved() { /* 位置已写入文档，深监听自动保存 */ }

// 房间浮层：显示该房间放置的设备数，点击打开设备抽屉（按区域名过滤）
const selectedRoom = computed(() => floor.value.rooms.find((r) => r.id === selectedRoomId.value) || null)

// ---- 光照场景预设（白天 / 黄昏 / 夜晚）：一键写入 lighting，滑块随之联动 ----
const LIGHT_PRESETS = [
  { key: 'day', name: '白天', icon: 'wb_sunny', ambient: 1.1, dir: 2.6, color: '#fff6e8', shadow: true },
  { key: 'dusk', name: '黄昏', icon: 'wb_twilight', ambient: 0.55, dir: 1.7, color: '#ffb066', shadow: true },
  { key: 'night', name: '夜晚', icon: 'dark_mode', ambient: 0.3, dir: 0.5, color: '#9db8ff', shadow: false },
]
// 当前参数命中哪个预设（容差内），用于按钮高亮；手动调滑块后自动取消高亮
const lightPresetKey = computed(() => {
  const L = floor.value.lighting
  for (const p of LIGHT_PRESETS) {
    if (Math.abs(L.ambient - p.ambient) < 0.06 && Math.abs(L.dir - p.dir) < 0.06
      && L.color.toLowerCase() === p.color.toLowerCase() && L.shadow === p.shadow) return p.key
  }
  return ''
})
function applyLightPreset(p) {
  pushHistory()
  const L = floor.value.lighting
  L.ambient = p.ambient; L.dir = p.dir; L.color = p.color; L.shadow = p.shadow
}
const selectedWall = computed(() => floor.value.walls.find((w) => w.id === selectedWallId.value) || null)
const selectedFloor = computed(() => selectedFloorId.value ? floor.value : null)
const roomDetail = computed(() => {
  if (!selectedRoom.value) return ''
  const n = floor.value.devices.filter((d) => d.roomId === selectedRoom.value.id).length
  return n ? `${n} 台设备 · 点击查看` : '点击查看该区域设备'
})
function openRoomDevices() {
  const area = (selectedRoom.value?.area || selectedRoom.value?.name || '').trim()
  if (area) openDeviceDrawer(`area:${area}`)
}

// ================= 编辑：画墙 / 画房间 =================
function onWallDone(pts) {
  // 端点吸附到既有墙的端点/墙段（L/T 连接）并自动闭合
  const snapped = snapWallPts(pts, floor.value.walls, (doc.canvas.grid || 20) / 2)
  if (snapped.length < 2) { tool.value = ''; return }
  pushHistory()
  floor.value.walls.push({ id: uid('w'), pts: snapped, h: wallH.value, t: wallT.value })
  tool.value = ''
}
function onRoomDone(poly) {
  const name = window.prompt('房间名称', '房间') || '房间'
  const colors = ['#F5A623', '#5EC4B0', '#6BA3D9', '#E8A84C', '#B08AD9']
  pushHistory()
  floor.value.rooms.push({
    id: uid('r'), name, area: name, poly,
    color: colors[floor.value.rooms.length % colors.length],
    floorColor: '', floorTexture: '',
  })
  tool.value = ''
}
function onFloorDone(poly) {
  pushHistory()
  floor.value.floorPoly = poly
  selectedFloorId.value = floor.value.id
  tool.value = ''
  toast('地板轮廓已设置，可在编辑栏调整材质')
}
function onOpeningPlace({ wallId, offset, kind }) {
  const spec = OPENING_CHOICES.find((o) => o.kind === kind) || { kind, name: '门', width: 90, height: 200 }
  pushHistory()
  floor.value.openings.push({
    id: uid('o'), wallId, offset,
    width: spec.width, height: spec.height,
    kind, name: spec.name,
  })
  tool.value = ''
}

// ================= 编辑：设备面板拖放 =================
const paletteDrag = ref(null)
function onPaletteDragStart({ device, x, y }) {
  paletteDrag.value = {
    reg: device, x, y,
    glyph: iconFor({ icon: device.main_icon }, domainGlyph[device.domain] || 'widgets'),
    name: device.display_name || '',
  }
  window.addEventListener('pointermove', onPaletteMove)
  window.addEventListener('pointerup', onPaletteUp, { once: true })
}
function onPaletteMove(e) {
  if (paletteDrag.value) { paletteDrag.value.x = e.clientX; paletteDrag.value.y = e.clientY }
}
function onPaletteUp(e) {
  window.removeEventListener('pointermove', onPaletteMove)
  const drag = paletteDrag.value
  paletteDrag.value = null
  if (!drag) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const hitCanvas = el && (el.closest ? el.closest('[data-fp-canvas]') : null)
  if (!hitCanvas || !canvas2d.value) return
  const p = canvas2d.value.toSvgPoint(e)
  const grid = doc.canvas.grid || 20
  const x = clamp(snap(p.x, grid), 20, doc.canvas.w - 20)
  const y = clamp(snap(p.y, grid), 20, doc.canvas.h - 20)
  // 同一设备不重复放置
  const devId = drag.reg.device && drag.reg.device.id ? String(drag.reg.device.id) : ''
  if (devId && floor.value.devices.some((d) => d.deviceId === devId)) {
    toast('该设备已在本楼层放置')
    return
  }
  const placement = placementFromDevice(drag.reg, x, y, domainGlyph)
  // 落在房间内则自动归属
  const room = roomAt(x, y)
  if (room) placement.roomId = room.id
  floor.value.devices.push(placement)
  selectedId.value = placement.id
}
// 点在多边形内判断（射线法）
function roomAt(x, y) {
  for (const r of floor.value.rooms) {
    const poly = r.poly || []
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (inside) return r
  }
  return null
}

// 点击/回车放置：放到画布中央（拖拽的键盘替代方案）
function onPaletteAdd(reg) {
  const grid = doc.canvas.grid || 20
  const x = snap(doc.canvas.w / 2, grid)
  const y = snap(doc.canvas.h / 2, grid)
  const devId = reg.device && reg.device.id ? String(reg.device.id) : ''
  if (devId && floor.value.devices.some((d) => d.deviceId === devId)) {
    toast('该设备已在本楼层放置')
    return
  }
  const placement = placementFromDevice(reg, x, y, domainGlyph)
  const room = roomAt(x, y)
  if (room) placement.roomId = room.id
  floor.value.devices.push(placement)
  selectedId.value = placement.id
}

// ================= 编辑：家具面板拖放 / 选中编辑 =================
const furnitureDrag = ref(null)
const selectedFurniture = computed(() => floor.value.furniture.find((f) => f.id === selectedFurnitureId.value) || null)

function onFurnitureDragStart({ item, x, y }) {
  furnitureDrag.value = { item, x, y }
  window.addEventListener('pointermove', onFurniturePaletteMove)
  window.addEventListener('pointerup', onFurniturePaletteUp, { once: true })
}
function onFurniturePaletteMove(e) {
  if (furnitureDrag.value) { furnitureDrag.value.x = e.clientX; furnitureDrag.value.y = e.clientY }
}
function onFurniturePaletteUp(e) {
  window.removeEventListener('pointermove', onFurniturePaletteMove)
  const drag = furnitureDrag.value
  furnitureDrag.value = null
  if (!drag) return
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const hitCanvas = el && (el.closest ? el.closest('[data-fp-canvas]') : null)
  if (!hitCanvas || !canvas2d.value) return
  const p = canvas2d.value.toSvgPoint(e)
  const grid = doc.canvas.grid || 20
  const x = clamp(snap(p.x, grid), 20, doc.canvas.w - 20)
  const y = clamp(snap(p.y, grid), 20, doc.canvas.h - 20)
  const fu = furnitureFromCatalog(drag.item, x, y)
  floor.value.furniture.push(fu)
  selectedFurnitureId.value = fu.id
}
function onFurnitureAdd(item) {
  const grid = doc.canvas.grid || 20
  const x = snap(doc.canvas.w / 2, grid)
  const y = snap(doc.canvas.h / 2, grid)
  const fu = furnitureFromCatalog(item, x, y)
  floor.value.furniture.push(fu)
  selectedFurnitureId.value = fu.id
}
function onFurnitureClick(fu) {
  multiKeys.value = []
  selectedFurnitureId.value = fu.id
  selectedWallId.value = ''
  selectedRoomId.value = ''
  selectedId.value = ''
}
function onFurnitureMoved() { /* 位置已写入文档，深监听自动保存 */ }
function rotateFurniture(d) {
  const fu = selectedFurniture.value
  if (!fu) return
  fu.rotation = ((fu.rotation || 0) + d) % 360
}
function deleteSelectedFurniture() {
  const i = floor.value.furniture.findIndex((f) => f.id === selectedFurnitureId.value)
  if (i < 0) { selectedFurnitureId.value = ''; return }
  pushHistory()
  floor.value.furniture.splice(i, 1)
  selectedFurnitureId.value = ''
}
function deleteSelectedWall() {
  const id = selectedWallId.value
  const i = floor.value.walls.findIndex((w) => w.id === id)
  if (i < 0) { selectedWallId.value = ''; return }
  pushHistory()
  floor.value.walls.splice(i, 1)
  // 连带删除挂在墙上的门窗洞口
  floor.value.openings = floor.value.openings.filter((o) => o.wallId !== id)
  selectedWallId.value = ''
}
function deleteSelectedRoom() {
  const i = floor.value.rooms.findIndex((r) => r.id === selectedRoomId.value)
  if (i < 0) { selectedRoomId.value = ''; return }
  pushHistory()
  floor.value.rooms.splice(i, 1)
  selectedRoomId.value = ''
}
// 删除自定义地板轮廓
function deleteSelectedFloorShape() {
  if (!floor.value.floorPoly) { selectedFloorId.value = ''; return }
  pushHistory()
  floor.value.floorPoly = null
  selectedFloorId.value = ''
}

// 从已画墙自动生成房间轮廓：提取所有墙段端点，计算凸包作为房间多边形
function fillRoomFromWalls() {
  if (!selectedRoom.value) return
  const walls = floor.value.walls
  if (!walls.length) { toast('当前楼层还没有画墙'); return }
  // 收集所有墙端点
  const pts = []
  for (const w of walls) {
    for (const p of (w.pts || [])) pts.push(p)
  }
  if (pts.length < 3) { toast('墙段端点不足，无法生成轮廓'); return }
  // Andrew 单调链凸包
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  const hull = [...lower, ...upper]
  if (hull.length < 3) { toast('无法生成有效轮廓'); return }
  pushHistory()
  selectedRoom.value.poly = hull
  toast(`已从 ${walls.length} 段墙生成房间轮廓（凸包近似）`)
}

// ================= 编辑：选中设备设置 =================
const settingsDev = computed(() => floor.value.devices.find((d) => d.id === selectedId.value) || null)
const settingsEntity = computed(() => (settingsDev.value?.entityId ? entityStates[settingsDev.value.entityId] : null) || null)
const settingsName = computed(() => {
  const dev = settingsDev.value
  if (!dev) return ''
  const reg = dev.deviceId ? regById.value.get(dev.deviceId) : null
  return reg?.display_name || settingsEntity.value?.friendly_name || dev.entityId || '设备'
})
function deleteSelected() {
  const list = floor.value.devices
  const i = list.findIndex((d) => d.id === selectedId.value)
  if (i < 0) { selectedId.value = ''; return }
  pushHistory()
  list.splice(i, 1)
  selectedId.value = ''
}

// ================= 编辑：楼层 / 背景图 =================
function addFloor() {
  pushHistory()
  doc.floors.push(defaultFloor(`${doc.floors.length + 1}层`))
  floorIdx.value = doc.floors.length - 1
}
function delFloor() {
  if (doc.floors.length <= 1) return
  if (!window.confirm(`删除楼层「${floor.value.name}」？`)) return
  pushHistory()
  doc.floors.splice(floorIdx.value, 1)
  floorIdx.value = Math.min(floorIdx.value, doc.floors.length - 1)
}
function onBgUpload(dataUrl) { pushHistory(); floor.value.bg.dataUrl = dataUrl }

// ================= 编辑：统一删除 / 清除选择 / 复制 =================
function deleteCurrentSelection() {
  if (multiKeys.value.length >= 2) { deleteMulti(); return }
  if (selectedId.value) { deleteSelected(); return }
  if (selectedWallId.value) { deleteSelectedWall(); return }
  if (selectedRoomId.value) { deleteSelectedRoom(); return }
  if (selectedFurnitureId.value) { deleteSelectedFurniture(); return }
  if (selectedFloorId.value) deleteSelectedFloorShape()
}
function clearSelection() {
  selectedId.value = ''
  selectedWallId.value = ''
  selectedRoomId.value = ''
  selectedFurnitureId.value = ''
  selectedFloorId.value = ''
  multiKeys.value = []
}
// 复制当前选中（家具 / 墙），偏移 28px 并选中新对象
function duplicateSelection() {
  if (selectedFurniture.value) {
    const fu = selectedFurniture.value
    const clone = JSON.parse(JSON.stringify(fu))
    clone.id = uid('fu')
    clone.x = clamp(fu.x + 28, 0, doc.canvas.w)
    clone.y = clamp(fu.y + 28, 0, doc.canvas.h)
    pushHistory()
    floor.value.furniture.push(clone)
    clearSelection()
    selectedFurnitureId.value = clone.id
    return
  }
  if (selectedWall.value) {
    const w = selectedWall.value
    pushHistory()
    const clone = { id: uid('w'), pts: w.pts.map((p) => [clamp(p[0] + 28, 0, doc.canvas.w), clamp(p[1] + 28, 0, doc.canvas.h)]), h: w.h, t: w.t }
    floor.value.walls.push(clone)
    clearSelection()
    selectedWallId.value = clone.id
    return
  }
  toast('选中家具或墙体后可复制')
}

// ================= 框选 / 多选操作 =================
function syncSingleFromKey(k) {
  const [t, id] = k.split(':')
  if (t === 'device') { selectedId.value = id; selectedWallId.value = ''; selectedRoomId.value = ''; selectedFurnitureId.value = ''; selectedFloorId.value = '' }
  else if (t === 'furniture') { selectedFurnitureId.value = id; selectedId.value = ''; selectedWallId.value = ''; selectedRoomId.value = ''; selectedFloorId.value = '' }
  else if (t === 'wall') { selectedWallId.value = id; selectedId.value = ''; selectedRoomId.value = ''; selectedFurnitureId.value = ''; selectedFloorId.value = '' }
  else if (t === 'room') { selectedRoomId.value = id; selectedId.value = ''; selectedWallId.value = ''; selectedFurnitureId.value = ''; selectedFloorId.value = '' }
  else if (t === 'floor') { selectedFloorId.value = id; selectedId.value = ''; selectedWallId.value = ''; selectedRoomId.value = ''; selectedFurnitureId.value = '' }
}
function onMarqueeSelect({ keys, additive }) {
  if (!keys.length) { if (!additive) multiKeys.value = []; return }
  let next
  if (additive) {
    const set = new Set(multiKeys.value)
    for (const k of keys) set.has(k) ? set.delete(k) : set.add(k)
    next = [...set]
  } else next = keys.slice()
  multiKeys.value = next
  if (next.length === 1) syncSingleFromKey(next[0])
  else { selectedId.value = ''; selectedWallId.value = ''; selectedRoomId.value = ''; selectedFurnitureId.value = ''; selectedFloorId.value = '' }
}
// 批量删除（含墙的连带洞口）
function deleteMulti() {
  if (!multiKeys.value.length) return
  pushHistory()
  const keys = new Set(multiKeys.value)
  floor.value.devices = floor.value.devices.filter((d) => !keys.has(`device:${d.id}`))
  floor.value.furniture = floor.value.furniture.filter((f) => !keys.has(`furniture:${f.id}`))
  const deadWalls = new Set()
  floor.value.walls = floor.value.walls.filter((w) => {
    if (keys.has(`wall:${w.id}`)) { deadWalls.add(w.id); return false }
    return true
  })
  floor.value.openings = floor.value.openings.filter((o) => !deadWalls.has(o.wallId))
  floor.value.rooms = floor.value.rooms.filter((r) => !keys.has(`room:${r.id}`))
  if (keys.has(`floor:${floor.value.id}`)) floor.value.floorPoly = null
  multiKeys.value = []
}
// 批量复制（设备/家具/墙），选中所有副本
function duplicateMulti() {
  if (!multiKeys.value.length) return
  pushHistory()
  const keys = new Set(multiKeys.value)
  const nk = []
  const cloneAt = (o, type) => {
    const c = JSON.parse(JSON.stringify(o))
    c.id = uid(type)
    c.x = clamp(o.x + 28, 0, doc.canvas.w)
    c.y = clamp(o.y + 28, 0, doc.canvas.h)
    return c
  }
  for (const d of floor.value.devices.filter((x) => keys.has(`device:${x.id}`))) {
    const c = cloneAt(d, 'd'); floor.value.devices.push(c); nk.push(`device:${c.id}`)
  }
  for (const f of floor.value.furniture.filter((x) => keys.has(`furniture:${x.id}`))) {
    const c = cloneAt(f, 'fu'); floor.value.furniture.push(c); nk.push(`furniture:${c.id}`)
  }
  for (const w of floor.value.walls.filter((x) => keys.has(`wall:${x.id}`))) {
    const c = { id: uid('w'), pts: w.pts.map((p) => [clamp(p[0] + 28, 0, doc.canvas.w), clamp(p[1] + 28, 0, doc.canvas.h)]), h: w.h, t: w.t }
    floor.value.walls.push(c); nk.push(`wall:${c.id}`)
  }
  multiKeys.value = nk
  if (nk.length === 1) syncSingleFromKey(nk[0])
}

// ================= 右键上下文菜单 =================
function openContextMenu({ x, y, key }) {
  // 右击对象：若与当前选择不符则切换选择
  if (key && !multiKeys.value.includes(key)) {
    clearSelection()
    syncSingleFromKey(key)
  }
  contextMenu.value = { x, y, key }
}
function closeContextMenu() { contextMenu.value = null }
function ctxDelete() { closeContextMenu(); if (multiKeys.value.length >= 2) deleteMulti(); else deleteCurrentSelection() }
function ctxDuplicate() { closeContextMenu(); if (multiKeys.value.length >= 2) duplicateMulti(); else duplicateSelection() }
function ctxSelectAll() {
  closeContextMenu()
  multiKeys.value = []
  const objs = []
  for (const d of floor.value.devices) objs.push(`device:${d.id}`)
  for (const f of floor.value.furniture) objs.push(`furniture:${f.id}`)
  for (const w of floor.value.walls) objs.push(`wall:${w.id}`)
  for (const r of floor.value.rooms) objs.push(`room:${r.id}`)
  if (floor.value.floorPoly) objs.push(`floor:${floor.value.id}`)
  multiKeys.value = objs
  if (objs.length === 1) syncSingleFromKey(objs[0])
}
function ctxFitView() { closeContextMenu(); canvas2d.value?.zoomToFit?.() }
function ctxUndo() { closeContextMenu(); undo() }
function ctxRedo() { closeContextMenu(); redo() }

// ================= 全局键盘快捷键 =================
function isEditableTarget(t) {
  if (!t || !t.tagName) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
}
function onGlobalKey(e) {
  if (!editMode.value) return
  const meta = e.ctrlKey || e.metaKey
  const k = e.key
  if (meta && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
  if (meta && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return }
  if (meta && (k === 'd' || k === 'D')) {
    e.preventDefault()
    if (multiKeys.value.length >= 2) duplicateMulti(); else duplicateSelection()
    return
  }
  if (meta && (k === 'a' || k === 'A')) {
    // 输入框内保留原生「全选文本」，仅在画布上全选对象
    if (isEditableTarget(e.target)) return
    e.preventDefault()
    ctxSelectAll()
    return
  }
  if (isEditableTarget(e.target)) return    // 输入框内不触发删除/Escape
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteCurrentSelection() }
  else if (k === 'Escape') {
    if (contextMenu.value) { closeContextMenu(); return }
    if (tool.value) return                     // 绘制中由 2D 子组件处理
    if (multiKeys.value.length) { multiKeys.value = []; return }
    clearSelection()
  }
}

// ================= 生命周期 =================
let stopWatch = null
onMounted(async () => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onGlobalKey)
  await loadDoc()
  if (store.ready && store.activeID > 0) loadRegistry()
  // 实例切换 → 注册表变化，重新拉取（文档为用户级，不随实例变）
  stopWatch = watch(() => store.activeID, (id) => { if (id > 0) loadRegistry(true) })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('pointermove', onPaletteMove)
  window.removeEventListener('pointermove', onFurniturePaletteMove)
  if (saveTimer) clearTimeout(saveTimer)
  if (stopWatch) stopWatch()
})
</script>

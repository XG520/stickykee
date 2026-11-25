package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/model"
	"stickykee/server/internal/icons"
	"stickykee/server/internal/store"
)

// 注册表刷新策略：按请求方用户按需刷新。个人 HA token 由每用户独立配置，
// 无法用无用户身份做后台刷新（会因缺 token 报 ErrNoHAToken），因此改为
// List 请求时用请求方身份拉取，并按 TTL 复用已成功快照以减小 HA WS 压力。
// 即使某次 HA WS 命令卡住，也会因超时返回而不会拖垮接口。
const (
	refreshInterval = 60 * time.Second // 缓存有效期（TTL）
	refreshTimeout  = 30 * time.Second // 单次刷新（3 条注册表命令 + 快照）整体超时
)

// regData 一次注册表拉取的聚合结果（对应 GET /registry/devices 的 data 体）。
type regData struct {
	Areas      []model.RegistryArea `json:"areas"`
	Devices    []*model.DeviceGraph `json:"devices"`
	Unassigned []model.GraphEntity  `json:"unassigned"`
}

// registrySnapshot 缓存中的一份已成功拉取的快照（预序列化 body，读取时零成本）。
type registrySnapshot struct {
	body    json.RawMessage // 预编码的 regData JSON
	active  int64           // 本次拉取时的 active 实例
	updated time.Time
}

// RegisteredEntities 提供官方「设备管理」页所需数据：
// 后台定时拉取 HA 的设备/实体/区域注册表（WS config_*_registry/list）并缓存，
// 再合并每个实体的实时状态与友善名称，按「一台物理设备聚合其下实体」返回。
// 实体图标应用本系统的自定义覆盖（entity_icons 表，只存本地不写回 HA）。
type RegisteredEntities struct {
	manager  *ha.Manager
	iconRepo *store.IconRepo
	log      *slog.Logger

	mu       sync.Mutex
	caches   map[int64]*registrySnapshot
	fetching map[int64]chan struct{} // 单飞：同实例并发的刷新合并为一次
}

// NewRegisteredEntities 构造 handler。注册表不再后台自动刷新：个人 token 无法用
// 无用户身份拉取，改由 List 请求按请求方身份按需刷新（配合缓存 TTL 复用）。
func NewRegisteredEntities(manager *ha.Manager, iconRepo *store.IconRepo) *RegisteredEntities {
	log := slog.Default()
	return &RegisteredEntities{
		manager:  manager,
		iconRepo: iconRepo,
		log:      log,
		caches:   map[int64]*registrySnapshot{},
		fetching: map[int64]chan struct{}{},
	}
}

// List GET /instances/{id}/registry/devices
// 返回 { areas: [...], devices: [DeviceGraph...], unassigned: [GraphEntity...] }
// areas：区域注册表（供按房间分组）；unassigned：未绑定任何设备的实体。
// 优先读缓存；缓存未就绪时才同步拉取一次。
func (h *RegisteredEntities) List(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), refreshTimeout)
	defer cancel()

	snap, err := h.load(ctx, id, false)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	WriteMeta(w, 200, json.RawMessage(snap.body), snap.active)
}

// load 返回实例 id 的注册表快照。force 为 true 时跳过缓存强制重新拉取。
// 缓存命中且未超过 TTL 时直接返回快照；超过 TTL 则用请求方用户的 token 重新拉取。
// 同一实例的并发 load 由单飞合并：后来者等待在途刷新完成后读其结果。
func (h *RegisteredEntities) load(ctx context.Context, id int64, force bool) (*registrySnapshot, error) {
	h.mu.Lock()
	if snap, ok := h.caches[id]; ok && !force && time.Since(snap.updated) < refreshInterval {
		h.mu.Unlock()
		return snap, nil
	}
	// 已有在途刷新：等待其完成即可，不重复拉取。
	if wc, ok := h.fetching[id]; ok {
		h.mu.Unlock()
		select {
		case <-wc:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		h.mu.Lock()
		snap := h.caches[id]
		h.mu.Unlock()
		if snap == nil {
			return nil, errors.New("ha registry unavailable")
		}
		return snap, nil
	}
	done := make(chan struct{})
	h.fetching[id] = done
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.fetching, id)
		h.mu.Unlock()
		close(done)
	}()

	data, active, err := h.fetch(ctx, id)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	snap := &registrySnapshot{body: body, active: active, updated: time.Now()}
	h.mu.Lock()
	h.caches[id] = snap
	h.mu.Unlock()
	return snap, nil
}

// fetch 真正拉取并聚合一次注册表数据（不缓存）。
func (h *RegisteredEntities) fetch(ctx context.Context, id int64) (*regData, int64, error) {
	devicesRaw, err := h.manager.CallCommand(ctx, id, "config/device_registry/list", nil)
	if err != nil {
		return nil, 0, err
	}
	entitiesRaw, err := h.manager.CallCommand(ctx, id, "config/entity_registry/list", nil)
	if err != nil {
		return nil, 0, err
	}
	areasRaw, err := h.manager.CallCommand(ctx, id, "config/area_registry/list", nil)
	if err != nil {
		return nil, 0, err
	}

	var devices []model.RegistryDevice
	var entities []model.RegistryEntity
	var areas []model.RegistryArea
	_ = json.Unmarshal(devicesRaw, &devices)
	_ = json.Unmarshal(entitiesRaw, &entities)
	_ = json.Unmarshal(areasRaw, &areas)

	// 实时状态快照（entity_id → EntityState）。
	states := map[string]model.EntityState{}
	if snap, err := h.manager.Snapshot(ctx, id); err == nil {
		for _, s := range snap {
			states[s.EntityID] = s
		}
	}

	// 本系统的实体图标覆盖（优先级最高：本地覆盖 > 注册表 icon > 状态 attributes.icon）。
	iconOverrides := map[string]string{}
	if h.iconRepo != nil {
		if m, err := h.iconRepo.Map(ctx, id); err == nil {
			iconOverrides = m
		}
	}

	areaName := map[string]string{}
	areaIcon := map[string]string{}
	for _, a := range areas {
		areaName[a.AreaID] = a.Name
		areaIcon[a.AreaID] = a.Icon
	}

	devByID := map[string]*model.DeviceGraph{}
	order := make([]*model.DeviceGraph, 0, len(devices))
	for i := range devices {
		d := &devices[i]
		g := &model.DeviceGraph{
			Device:      *d,
			DisplayName: deviceName(d),
			AreaID:      d.AreaID,
			AreaName:    areaName[d.AreaID],
			Disabled:    d.DisabledBy != "" || d.EntryType == "service",
			Entities:    []model.GraphEntity{},
		}
		devByID[d.ID] = g
		order = append(order, g)
	}

	unassigned := []model.GraphEntity{}
	for i := range entities {
		e := &entities[i]
		if e.EntityID == "" {
			continue
		}
		ge := buildGraphEntity(e, states[e.EntityID])
		if icon, ok := iconOverrides[e.EntityID]; ok && icon != "" {
			ge.Icon = "mdi:" + icon // 保持 HA 图标值语义（mdi:xxx），前端按此前缀走 SVG 渲染
		}
		if e.DeviceID != "" {
			if g, ok := devByID[e.DeviceID]; ok {
				g.Entities = append(g.Entities, ge)
			} else {
				unassigned = append(unassigned, ge)
			}
		} else {
			unassigned = append(unassigned, ge)
		}
	}

	// 补全设备级聚合字段；无属于该设备的实体时标记已禁用。
	for _, g := range order {
		aggregateDevice(g)
	}

	active, _ := h.manager.ActiveID(ctx)
	return &regData{Areas: areas, Devices: order, Unassigned: unassigned}, active, nil
}

// UpdateIcon PUT /instances/{id}/registry/entities/{entityID}/icon
// 设置/清除某实体的本地图标覆盖（body {"icon": "robot-vacuum"}；空串恢复默认）。
// 只写本系统 SQLite，不写回 HA；写入后立即使该实例注册表缓存失效以实时生效。
func (h *RegisteredEntities) UpdateIcon(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	entityID := chi.URLParam(r, "entityID")
	if entityID == "" {
		WriteErr(w, 400, "bad_request", "entity id required")
		return
	}
	var body struct {
		Icon string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteErr(w, 400, "bad_request", "invalid json body")
		return
	}
	icon := icons.Normalize(body.Icon)
	if icon != "" && !icons.Has(icon) {
		WriteErr(w, 400, "unknown_icon", "icon not found: "+icon)
		return
	}
	if err := h.iconRepo.Set(r.Context(), id, entityID, icon); err != nil {
		WriteErr(w, 500, "db_error", err.Error())
		return
	}
	// 缓存失效：下次 List 重新拉取并应用新覆盖。
	h.mu.Lock()
	delete(h.caches, id)
	h.mu.Unlock()
	WriteMeta(w, 200, json.RawMessage(`{"entity_id":"`+entityID+`","icon":"`+icon+`"}`), id)
}

// isOnGraph 判断实体状态是否视为"开启"（与前端 utils/entities isOn 对齐）。
func isOnGraph(state string) bool {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "on", "open", "opening", "playing", "unlocked", "disarmed":
		return true
	default:
		return false
	}
}

// deviceName 决定设备展示名：昵称 > 名称 > 厂商+型号 > ID。
func deviceName(d *model.RegistryDevice) string {
	if d.NameByUser != "" {
		return d.NameByUser
	}
	if d.Name != "" {
		return d.Name
	}
	if d.Manufacturer != "" || d.Model != "" {
		name := strings.TrimSpace(d.Manufacturer + " " + d.Model)
		if name != "" {
			return name
		}
	}
	return d.ID
}

// buildGraphEntity 组装实体行：注册信息 + 实时状态（ParseDisplay 负责 friendly_name/icon/unit 兜底）。
func buildGraphEntity(e *model.RegistryEntity, st model.EntityState) model.GraphEntity {
	disp := model.ParseDisplay(st)
	ge := model.GraphEntity{
		EntityID:     e.EntityID,
		Domain:       model.DomainOf(e.EntityID),
		FriendlyName: disp.FriendlyName,
		Icon:         disp.Icon,
		DeviceClass:  e.DeviceClass,
		Unit:         disp.Unit,
		State:        disp.State,
		Attributes:   disp.Attributes,
		Disabled:     e.DisabledBy != "",
		Platform:     e.Platform,
	}
	// 实体注册表中的友好名称优先于状态 attributes（HA 权威来源）。
	if e.Name != "" && (ge.FriendlyName == "" || !strings.Contains(ge.FriendlyName, e.EntityID)) {
		ge.FriendlyName = e.Name
	}
	if e.Icon != "" {
		ge.Icon = e.Icon
	}
	if ge.FriendlyName == "" {
		ge.FriendlyName = e.EntityID
	}
	return ge
}

// aggregateDevice 汇总设备下实体的域/主实体与开关统计。
func aggregateDevice(g *model.DeviceGraph) {
	g.EntityCount = len(g.Entities)
	counts := map[string]int{}
	for i := range g.Entities {
		e := &g.Entities[i]
		if e.Disabled {
			continue
		}
		counts[e.Domain]++
		if g.MainFriendly == "" {
			g.MainFriendly = e.FriendlyName
			g.MainIcon = e.Icon
			g.MainState = e.State
			g.Domain = e.Domain
		}
		if isOnGraph(e.State) {
			g.ActiveCount++
		}
	}
	if len(g.Entities) == 0 {
		g.Disabled = true
	}
}

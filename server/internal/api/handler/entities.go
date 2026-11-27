package handler

import (
	"errors"
	"net/http"
	"strings"

	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/client"
	"stickykee/server/internal/ha/model"
	"stickykee/server/internal/store"
)

// Entities 提供实体查询与开关控制。
type Entities struct {
	manager   *ha.Manager
	userPrefs *store.UserPrefs
}

// NewEntities 构造 handler。
func NewEntities(manager *ha.Manager, userPrefs *store.UserPrefs) *Entities {
	return &Entities{manager: manager, userPrefs: userPrefs}
}

// List GET /instances/{id}/entities?room=&domain=&type=
func (h *Entities) List(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		haErr(w, err)
		return
	}

	// 优先读实时快照缓存（由 HA WS 维护），失败时回退 REST 直连。
	states, err := h.snapshotStates(r, id, rst)
	if err != nil {
		if errors.Is(err, ha.ErrNoHAToken) {
			haErr(w, err)
			return
		}
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	displays := model.ParseDisplays(states)

	domain := r.URL.Query().Get("domain")
	typeF := r.URL.Query().Get("type")
	room := r.URL.Query().Get("room")
	q := strings.ToLower(r.URL.Query().Get("q"))

	out := make([]model.DisplayEntity, 0, len(displays))
	for _, d := range displays {
		if domain != "" && d.Domain != domain {
			continue
		}
		if typeF != "" && !matchesType(d, typeF) {
			continue
		}
		if room != "" && !containsRoom(d, room) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(d.EntityID+d.FriendlyName), q) {
			continue
		}
		// 记账相关实体（账本同步的传感器）仅对有查看权限的用户可见。
		if !FinanceEntityVisible(r.Context(), h.userPrefs, d.FriendlyName) {
			continue
		}
		out = append(out, d)
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, out, active)
}

// Get GET /instances/{id}/entities/{entityID}
func (h *Entities) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	entityID := strings.TrimSpace(r.PathValue("entityID"))
	if entityID == "" {
		WriteErr(w, 400, "bad_request", "entity_id required")
		return
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		haErr(w, err)
		return
	}
	states, err := h.snapshotStates(r, id, rst)
	if err != nil {
		if errors.Is(err, ha.ErrNoHAToken) {
			haErr(w, err)
			return
		}
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	for _, s := range states {
		if s.EntityID == entityID {
			disp := model.ParseDisplay(s)
			if !FinanceEntityVisible(r.Context(), h.userPrefs, disp.FriendlyName) {
				WriteErr(w, 403, "forbidden", "未获得记账模块授权，请联系管理员")
				return
			}
			active, _ := h.manager.ActiveID(r.Context())
			WriteMeta(w, 200, disp, active)
			return
		}
	}
	WriteErr(w, 404, "not_found", "entity not found")
}

// Toggle POST /instances/{id}/entities/{entityID}/toggle
func (h *Entities) Toggle(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	entityID := strings.TrimSpace(r.PathValue("entityID"))
	if entityID == "" {
		WriteErr(w, 400, "bad_request", "entity_id required")
		return
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		haErr(w, err)
		return
	}
	if h.financeBlocked(r, id, entityID) {
		WriteErr(w, 403, "forbidden", "未获得记账模块授权，请联系管理员")
		return
	}
	if err := rst.Toggle(r.Context(), entityID); err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{"toggled": entityID}, active)
}

// financeBlocked 判断实体是否属于记账相关且当前用户无权访问。
// 快照不可用（含实例未同步）时按放行处理：记账传感器本身不可切换，不会泄露数据。
func (h *Entities) financeBlocked(r *http.Request, id int64, entityID string) bool {
	states, err := h.manager.Snapshot(r.Context(), id)
	if err != nil {
		return false
	}
	for _, s := range states {
		if s.EntityID == entityID {
			return !FinanceEntityVisible(r.Context(), h.userPrefs, model.ParseDisplay(s).FriendlyName)
		}
	}
	return false
}

// snapshotStates 优先返回实例的实时快照缓存；缓存为空（尚未同步）时回退 REST 直连。
func (h *Entities) snapshotStates(r *http.Request, id int64, rst *client.Rest) ([]model.EntityState, error) {
	if snap, err := h.manager.Snapshot(r.Context(), id); err == nil && len(snap) > 0 {
		return snap, nil
	}
	return rst.GetStates(r.Context())
}

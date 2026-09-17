package handler

import (
	"net/http"
	"strings"

	"homecanvas/server/internal/ha"
	"homecanvas/server/internal/ha/client"
	"homecanvas/server/internal/ha/model"
)

// Entities 提供实体查询与开关控制。
type Entities struct {
	manager *ha.Manager
}

// NewEntities 构造 handler。
func NewEntities(manager *ha.Manager) *Entities { return &Entities{manager: manager} }

// List GET /instances/{id}/entities?room=&domain=&type=
func (h *Entities) List(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "no_instance", "no configured instance")
		return
	}

	// 优先读实时快照缓存（由 HA WS 维护），失败时回退 REST 直连。
	states, err := h.snapshotStates(r, id, rst)
	if err != nil {
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
		WriteErr(w, 404, "no_instance", "no configured instance")
		return
	}
	states, err := h.snapshotStates(r, id, rst)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	for _, s := range states {
		if s.EntityID == entityID {
			active, _ := h.manager.ActiveID(r.Context())
			WriteMeta(w, 200, model.ParseDisplay(s), active)
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
		WriteErr(w, 404, "no_instance", "no configured instance")
		return
	}
	if err := rst.Toggle(r.Context(), entityID); err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{"toggled": entityID}, active)
}

// snapshotStates 优先返回实例的实时快照缓存；缓存为空（尚未同步）时回退 REST 直连。
func (h *Entities) snapshotStates(r *http.Request, id int64, rst *client.Rest) ([]model.EntityState, error) {
	if snap, err := h.manager.Snapshot(r.Context(), id); err == nil && len(snap) > 0 {
		return snap, nil
	}
	return rst.GetStates(r.Context())
}

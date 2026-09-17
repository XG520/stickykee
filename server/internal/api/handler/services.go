package handler

import (
	"net/http"

	"homecanvas/server/internal/ha"
)

// Services 提供对 HA 服务的通用调用（控制设备）。
type Services struct {
	manager *ha.Manager
}

// NewServices 构造 handler。
func NewServices(manager *ha.Manager) *Services { return &Services{manager: manager} }

type servicePayload struct {
	Domain      string         `json:"domain"`
	Service     string         `json:"service"`
	EntityID    string         `json:"entity_id"`
	ServiceData map[string]any `json:"service_data"`
}

// List GET /instances/{id}/services —— 返回 HA 服务目录，供动作编辑器选择服务与字段。
func (h *Services) List(w http.ResponseWriter, r *http.Request) {
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
	catalog, err := rst.GetServices(r.Context())
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, catalog, active)
}

// Call POST /instances/{id}/services
func (h *Services) Call(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	var p servicePayload
	if err := DecodeBody(r, &p); err != nil || p.Domain == "" || p.Service == "" {
		WriteErr(w, 400, "bad_request", "domain/service required")
		return
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "no_instance", "no configured instance")
		return
	}
	if err := rst.CallService(r.Context(), p.Domain, p.Service, p.EntityID, p.ServiceData); err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{
		"domain":    p.Domain,
		"service":   p.Service,
		"entity_id": p.EntityID,
	}, active)
}

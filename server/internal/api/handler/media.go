package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"homecanvas/server/internal/ha"
)

// Media 代理 Home Assistant 的实体图片/头像资源。
type Media struct {
	manager *ha.Manager
}

// NewMedia 构造 handler。
func NewMedia(manager *ha.Manager) *Media { return &Media{manager: manager} }

// Picture GET /instances/{id}/picture?entity=person.xx
// 拉取该实体的 entity_picture 并从 HA 代理返回原始图片，方便前端作为人物头像显示。
func (m *Media) Picture(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	entity := r.URL.Query().Get("entity")
	if entity == "" {
		WriteErr(w, 400, "bad_request", "entity required")
		return
	}
	rst, err := m.manager.Rest(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "no_instance", "no configured instance")
		return
	}
	states, err := rst.GetStates(r.Context())
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	var pic string
	domain := strings.SplitN(entity, ".", 2)[0]
	for _, s := range states {
		if s.EntityID != entity {
			continue
		}
		// image 实体 state 即为 HA 内部图片代理路径（如 /api/image_proxy/xxx）。
		if pic == "" && domain == "image" && strings.HasPrefix(s.State, "/api/") {
			pic = s.State
		}
		var attrs map[string]any
		if json.Unmarshal(s.Attributes, &attrs) == nil {
			if v, ok := attrs["entity_picture"].(string); ok {
				pic = v
			}
		}
		break
	}
	// camera 实体无 entity_picture，使用实时画面代理接口。
	if pic == "" && domain == "camera" {
		pic = "/api/camera_proxy/" + entity
	}
	// 仅允许代理 HA 内部的图片接口路径，避免任意路径访问。
	if pic == "" || !strings.HasPrefix(pic, "/api/") {
		WriteErr(w, 404, "not_found", "no picture for entity")
		return
	}
	raw, ctype, err := rst.GetRaw(r.Context(), pic)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	if ctype == "" {
		ctype = "image/png"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(raw)
}

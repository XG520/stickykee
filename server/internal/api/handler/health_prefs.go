package handler

import (
	"net/http"

	"homecanvas/server/internal/store"
)

// Prefs 处理用户偏好（键值 JSON）。
type Prefs struct {
	repo *store.InstanceRepo
}

// NewPrefs 构造 handler。
func NewPrefs(repo *store.InstanceRepo) *Prefs { return &Prefs{repo: repo} }

// Get GET /prefs  返回全部偏好
func (h *Prefs) Get(w http.ResponseWriter, r *http.Request) {
	all := map[string]string{}
	for _, key := range []string{"theme", "font", "icons", "floorplan", "animation", "result", "map_config", "dashboard", "devices", "sensor_config"} {
		v, _ := h.repo.GetPref(r.Context(), key)
		if v != "" {
			all[key] = v
		}
	}
	WriteJSON(w, 200, all)
}

// Put PUT /prefs {key:value,...}
func (h *Prefs) Put(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	for k, v := range body {
		if err := h.repo.SetPref(r.Context(), k, v); err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
	}
	WriteJSON(w, 200, body)
}

// Health 健康检查。
type Health struct{}

// Healthz 存活探针。
func (Health) Healthz(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]string{"status": "ok"})
}

// Readyz 就绪探针。
func (Health) Readyz(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]string{"status": "ready"})
}

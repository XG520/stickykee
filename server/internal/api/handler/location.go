package handler

import (
	"net/http"

	"homecanvas/server/internal/ha"
)

// Location 处理浏览器定位同步到 Home Assistant（device_tracker.see）。
type Location struct {
	manager *ha.Manager
}

// NewLocation 构造 handler。
func NewLocation(manager *ha.Manager) *Location { return &Location{manager: manager} }

// locationPayload 浏览器定位参数。
type locationPayload struct {
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	Accuracy     float64 `json:"accuracy"`
	DevID        string  `json:"dev_id"`        // HA 设备标识，缺省 homecanvas
	LocationName string  `json:"location_name"` // 位置名（逆地理地址或 zone）
	HostName     string  `json:"host_name"`
}

// Update POST /instances/{id}/location 把浏览器定位写入 HA。
func (h *Location) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	var p locationPayload
	if err := DecodeBody(r, &p); err != nil || p.Lat == 0 || p.Lng == 0 {
		WriteErr(w, 400, "bad_request", "lat/lng required")
		return
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "no_instance", "no configured instance")
		return
	}
	devID := p.DevID
	if devID == "" {
		devID = "homecanvas"
	}
	data := map[string]any{
		"dev_id": devID,
		"gps":    []float64{p.Lat, p.Lng},
	}
	if p.Accuracy > 0 {
		data["gps_accuracy"] = p.Accuracy
	}
	if p.LocationName != "" {
		data["location_name"] = p.LocationName
	}
	if p.HostName == "" {
		p.HostName = devID
	}
	data["host_name"] = p.HostName
	// device_tracker.see 不需要实体 id，调用通用服务转发。
	if err := rst.CallService(r.Context(), "device_tracker", "see", "", data); err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{"synced": true, "dev_id": devID, "lat": p.Lat, "lng": p.Lng}, active)
}

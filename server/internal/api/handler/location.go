package handler

import (
	"context"
	"log/slog"
	"net/http"

	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/client"
)

// Location 处理浏览器定位同步到 Home Assistant。
//
// 经 HA 官方 mobile_app 的 update_location webhook 命令上报定位，
// HA 会自动创建/更新带 unique_id 的 device_tracker 实体并绑定到
// 该 mobile_app 注册的设备（与官方 App 行为一致），从而避免使用
// device_tracker.see 产生无法在 UI 管理的无 unique_id 实体。
type Location struct {
	manager *ha.Manager
	sensors *Sensors
}

// NewLocation 构造 handler，sensors 提供 mobile_app 注册与 webhook 探测复用。
func NewLocation(manager *ha.Manager, sensors *Sensors) *Location {
	return &Location{manager: manager, sensors: sensors}
}

// locationPayload 浏览器定位参数。
// DeviceID 由前端 ensureDevice() 提供（hc_device_id），用于定位 mobile_app 注册记录；
// 不再需要 dev_id/host_name，webhook 自带设备绑定。
// 不接收 location_name：一旦上报该字段，HA 会直接把它当作实体状态，
// 从而不再显示「在家/离家」，因此这里只上报经纬度交由 HA 依据 zone 计算。
type locationPayload struct {
	DeviceID string  `json:"device_id"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Accuracy float64 `json:"accuracy"`
}

// Update POST /instances/{id}/location 把浏览器定位写入 HA。
//
// 流程：
//  1. 解析 device_id（必填），获取实例 REST 客户端；
//  2. 查/创建 Sticky Kee 设备记录（用于稳定 dev_id 与 mobile_app 注册缓存键）；
//  3. 经 sensors.ensureRegistration 获取/复用 mobile_app webhook（含 get_config 探测失效）；
//  4. 用官方 update_location 命令经 webhook 上报 gps，HA 自动绑定到设备；
//  5. webhook 失效（设备被 HA 删除/集成不可用）→ 清缓存重注册后重试一次。
func (h *Location) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	var p locationPayload
	if err := DecodeBody(r, &p); err != nil || p.Lat == 0 || p.Lng == 0 || p.DeviceID == "" {
		WriteErr(w, 400, "bad_request", "device_id/lat/lng required")
		return
	}
	ctx := r.Context()
	username := rUsername(r)

	rst, err := h.manager.Rest(ctx, id)
	if err != nil {
		haErr(w, err)
		return
	}

	// 查/创建 Sticky Kee 设备记录（沿用 sensors.lookupDevice 以保证 dev_id 稳定）。
	dev := h.sensors.lookupDevice(ctx, username, p.DeviceID)
	if dev == nil {
		d, err := (&Devices{repo: h.sensors.repo, userPrefs: h.sensors.userPrefs, manager: h.sensors.manager}).upsert(ctx, username, p.DeviceID, "")
		if err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
		dev = &d
	}

	// 获取/复用 mobile_app webhook 注册（幂等）。
	reg, err := h.sensors.ensureRegistration(ctx, username, rst, dev, sensorReport{DeviceID: dev.DeviceID, DeviceName: dev.Name})
	if err != nil {
		slog.Warn("mobile_app registration failed (location)", "instance", id, "device", dev.DevID, "err", err.Error())
		WriteErr(w, 502, "mobile_app_unavailable", "mobile_app 集成不可用（默认由 default_config 启用，请检查 HA 配置是否移除了 default_config）")
		return
	}

	// 经官方 webhook 上报 update_location；webhook 失效则重注册后重试一次。
	if err = h.pushLocation(ctx, rst, reg, p); err != nil && webhookInvalid(err) {
		slog.Warn("mobile_app webhook stale, re-registering (location)", "instance", id, "device", dev.DevID, "err", err.Error())
		h.sensors.clearReg(ctx, username, dev.DeviceID)
		if reg2, err2 := h.sensors.ensureRegistration(ctx, username, rst, dev, sensorReport{DeviceID: dev.DeviceID, DeviceName: dev.Name}); err2 == nil {
			reg = reg2
			err = h.pushLocation(ctx, rst, reg, p)
		} else {
			err = err2
		}
	}
	if err != nil {
		slog.Warn("mobile_app location report failed", "instance", id, "device", dev.DevID, "err", err.Error())
		WriteErr(w, 502, "ha_unreachable", "HA 连接失败: "+err.Error())
		return
	}

	active, _ := h.manager.ActiveID(ctx)
	WriteMeta(w, 200, map[string]any{
		"synced":     true,
		"device_id":  dev.DeviceID,
		"dev_id":     dev.DevID,
		"webhook_id": reg.WebhookID,
		"lat":        p.Lat,
		"lng":        p.Lng,
	}, active)
}

// pushLocation 经 mobile_app webhook 上报 update_location 命令。
// 官方 payload：{"type":"update_location","data":{"gps":[lat,lng],"gps_accuracy":acc}}
// 仅上报经纬度，不带 location_name，HA 会依据 zone 计算出 home / not_home 状态。
func (h *Location) pushLocation(ctx context.Context, rest *client.Rest, reg *mobileReg, p locationPayload) error {
	data := map[string]any{
		"gps":          []float64{p.Lat, p.Lng},
		"gps_accuracy": p.Accuracy,
	}
	payload := map[string]any{"type": "update_location", "data": data}
	return rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID, payload, nil)
}

package handler

// 到家距离传感器（被动）：设备定位上报时计算当前位置到 HA zone.home 的直线距离，
// 经该设备 mobile_app webhook 以 sensor 实体上报（device_class=distance，单位 km），
// HA 中可直接用于「距家 >X km 提醒」「接近家自动开灯」等自动化。
//
// 计算节流（产品设定）：
//   - 与上次参与计算的位置相比移动超过 500 米才重新计算；
//   - 位置不变时每 2 小时兜底计算一次（地址解析/时间漂移）。
// 节流状态为内存态：服务重启后会多计算一次，无副作用。

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"stickykee/server/internal/ha/client"
)

const (
	distMoveThreshold = 500.0         // 米：与上次计算点相比位移超过该值才重新计算
	distRefreshEvery  = 2 * time.Hour // 位置不变时的兜底计算周期
	homeCacheTTL      = 10 * time.Minute
)

// homeCoord 家（zone.home）坐标。
type homeCoord struct {
	lat, lng float64
}

// distState 单设备的距离计算节流状态。
type distState struct {
	lat, lng float64
	at       time.Time
}

var (
	distMu     sync.Mutex
	distStates = map[string]*distState{} // key: username + "/" + devID
	homeMu     sync.Mutex
	homeCache  = map[int64]homeCoord{} // key: instanceID
	homeExpire = map[int64]time.Time{}
)

// homeCoordinate 读取 HA zone.home 坐标（实例级缓存，TTL 内不重复请求；
// 用户可能在 HA 中调整家的位置，故缓存需过期重取）。找不到/无效返回 false。
func homeCoordinate(ctx context.Context, rest *client.Rest, instanceID int64) (homeCoord, bool) {
	homeMu.Lock()
	defer homeMu.Unlock()
	if c, ok := homeCache[instanceID]; ok && time.Now().Before(homeExpire[instanceID]) {
		return c, true
	}
	raw, _, err := rest.GetRaw(ctx, "/api/states/zone.home")
	if err != nil {
		return homeCoord{}, false
	}
	var st struct {
		Attributes struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"attributes"`
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return homeCoord{}, false
	}
	if st.Attributes.Latitude == 0 && st.Attributes.Longitude == 0 {
		return homeCoord{}, false
	}
	c := homeCoord{lat: st.Attributes.Latitude, lng: st.Attributes.Longitude}
	homeCache[instanceID] = c
	homeExpire[instanceID] = time.Now().Add(homeCacheTTL)
	return c, true
}

// haversineMeters 两坐标球面距离（米）。
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	const earthR = 6371000.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthR * math.Asin(math.Sqrt(a))
}

// maybePushDistance 计算并上报「到家距离」传感器（尽力而为：任何失败仅记日志，
// 绝不影响 update_location 主流程；由 location.Update 在后台 goroutine 调用）。
func maybePushDistance(ctx context.Context, rest *client.Rest, webhookID, username, devID, devName string, instanceID int64, lat, lng float64) {
	// 1) 节流判定：位移 >500m 或距上次计算 >2h 才继续。
	key := username + "/" + devID
	distMu.Lock()
	if prev, ok := distStates[key]; ok {
		moved := haversineMeters(prev.lat, prev.lng, lat, lng)
		if moved <= distMoveThreshold && time.Since(prev.at) < distRefreshEvery {
			distMu.Unlock()
			return
		}
	}
	distStates[key] = &distState{lat: lat, lng: lng, at: time.Now()}
	distMu.Unlock()

	// 2) 家坐标。
	home, ok := homeCoordinate(ctx, rest, instanceID)
	if !ok {
		slog.Warn("distance sensor: zone.home unavailable", "instance", instanceID, "device", devID)
		distMu.Lock()
		delete(distStates, key) // 允许下次定位重试
		distMu.Unlock()
		return
	}

	// 3) 计算距离（米 → km 保留 2 位）。
	meters := haversineMeters(lat, lng, home.lat, home.lng)
	km := math.Round(meters/10) / 100

	// 4) 登记（幂等；HA 对已注册实体返回 already_registered，忽略）+ 上报状态。
	uniqueID := devID + "_distance_home"
	name := devName
	if name == "" {
		name = devID
	}
	regPayload := map[string]any{
		"type":                "sensor",
		"unique_id":           uniqueID,
		"name":                name + " 到家距离",
		"icon":                "mdi:map-marker-distance",
		"device_class":        "distance",
		"unit_of_measurement": "km",
		"state_class":         "measurement",
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID,
		map[string]any{"type": "register_sensor", "data": regPayload}, nil); err != nil &&
		!strings.Contains(err.Error(), "already_registered") {
		slog.Warn("distance sensor register failed", "device", devID, "err", err.Error())
		distMu.Lock()
		delete(distStates, key)
		distMu.Unlock()
		return
	}
	upPayload := map[string]any{"type": "update_sensor_states", "data": []map[string]any{{
		"unique_id": uniqueID,
		"state":     fmt.Sprintf("%.2f", km),
		"type":      "sensor",
		"icon":      "mdi:map-marker-distance",
		"attributes": map[string]any{
			"meters":         int(math.Round(meters)),
			"latitude":       lat,
			"longitude":      lng,
			"home_latitude":  home.lat,
			"home_longitude": home.lng,
			"at":             time.Now().Format(time.RFC3339),
		},
	}}}
	if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID, upPayload, nil); err != nil {
		slog.Warn("distance sensor update failed", "device", devID, "err", err.Error())
		distMu.Lock()
		delete(distStates, key)
		distMu.Unlock()
	}
}

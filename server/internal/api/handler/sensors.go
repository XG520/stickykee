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

	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/client"
	"stickykee/server/internal/store"
)

// SensorDef 传感器注册表项。
type SensorDef struct {
	Key         string `json:"key"`
	Name        string `json:"name"` // HA 实体显示名（中文；webhook JSON 为 UTF-8，HA 原生支持中文实体名）
	Icon        string `json:"icon"`
	Unit        string `json:"unit,omitempty"`
	DeviceClass string `json:"device_class,omitempty"`
	StateClass  string `json:"state_class,omitempty"`
	Category    string `json:"entity_category,omitempty"`
	Label       string `json:"label"` // 设置页中文名
	Desc        string `json:"desc"`  // 设置页说明
}

// SENSOR_DEFS 官方 App 同款传感器注册表（HA 侧实体显示名统一用中文）。
var SENSOR_DEFS = []SensorDef{
	{Key: "battery_level", Name: "电池电量", Icon: "mdi:battery", Unit: "%", DeviceClass: "battery", StateClass: "measurement", Category: "diagnostic", Label: "电池电量", Desc: "当前电池剩余电量百分比"},
	// 注意：battery_state / connection_type / network_quality / wifi_ssid 的值是字符串
	// （discharging / wifi / SSID 名），绝不能标 device_class(battery) 或 state_class(measurement)——
	// 新版 HA 会因此按数值传感器校验并对每条上报抛 ValueError 刷屏，且状态写入失败。
	{Key: "battery_state", Name: "充电状态", Icon: "mdi:battery-charging", Category: "diagnostic", Label: "充电状态", Desc: "充电中 / 未充电 / 已充满 / 放电中"},
	{Key: "connection_type", Name: "网络类型", Icon: "mdi:wifi", Category: "diagnostic", Label: "网络类型", Desc: "Wi-Fi / 蜂窝网络 / 有线 / 不可用"},
	{Key: "network_quality", Name: "网络质量", Icon: "mdi:signal", Category: "diagnostic", Label: "网络质量", Desc: "网络连接有效类型（4g / 3g / 2g / slow-2g）"},
	{Key: "wifi_ssid", Name: "Wi-Fi 名称", Icon: "mdi:wifi", Category: "diagnostic", Label: "Wi-Fi 名称", Desc: "当前连接的 Wi-Fi 名称（SSID）"},
	{Key: "screen_state", Name: "屏幕状态", Icon: "mdi:monitor", Category: "diagnostic", Label: "屏幕状态", Desc: "页面可见性（在前台 / 后台）"},
	{Key: "light_sensor", Name: "环境光强度", Icon: "mdi:white-balance-sunny", Unit: "lx", DeviceClass: "illuminance", StateClass: "measurement", Category: "diagnostic", Label: "环境光强度", Desc: "当前环境光照强度（勒克斯）"},
	{Key: "proximity", Name: "接近感应", Icon: "mdi:face-recognition", Category: "diagnostic", Label: "接近感应", Desc: "检测是否有人靠近（靠近时屏幕自动点亮）"},
	{Key: "public_ip", Name: "公网 IP", Icon: "mdi:ip-network", Category: "diagnostic", Label: "公网 IP", Desc: "设备的公网 IP 地址"},
	{Key: "current_time_zone", Name: "时区", Icon: "mdi:clock-outline", Category: "diagnostic", Label: "时区", Desc: "设备当前时区"},
	{Key: "last_update_trigger", Name: "更新触发原因", Icon: "mdi:update", Category: "diagnostic", Label: "更新触发原因", Desc: "本次传感器上报的触发原因（手动 / 事件 / 周期）"},
	{Key: "app_version", Name: "应用版本", Icon: "mdi:cellphone-information", Category: "diagnostic", Label: "应用版本", Desc: "Sticky Kee 应用版本"},
	{Key: "bssid", Name: "Wi-Fi 接入点 MAC", Icon: "mdi:access-point", Category: "diagnostic", Label: "Wi-Fi 接入点 MAC", Desc: "当前连接的无线接入点 MAC 地址"},
	{Key: "geocoded_location", Name: "所在位置", Icon: "mdi:map-marker", Category: "diagnostic", Label: "所在位置", Desc: "基于定位解析的地址（需浏览器授权定位）"},
	// 汽车相关（安卓车机）：全部来自 GPS fix，停车/无 fix 时按滞回与新鲜度规则上报。
	{Key: "car_speed", Name: "车速", Icon: "mdi:speedometer", Unit: "km/h", DeviceClass: "speed", StateClass: "measurement", Label: "车速", Desc: "GPS 推算的当前车速（车机场景，需定位权限）"},
	{Key: "car_heading", Name: "行驶方向", Icon: "mdi:compass-outline", Unit: "°", StateClass: "measurement", Label: "行驶方向", Desc: "GPS 推算的行驶方位角（0-360°，含中文方位属性）"},
	{Key: "driving", Name: "行驶中", Icon: "mdi:steering", Label: "行驶中", Desc: "按车速推断的行驶状态（≥5km/h 判行驶，<2km/h 判停车）"},
	{Key: "trip_today", Name: "今日行驶里程", Icon: "mdi:map-marker-distance", Unit: "km", DeviceClass: "distance", StateClass: "measurement", Label: "今日行驶里程", Desc: "按 GPS 位移累计的当天行驶公里数，每日零点自动清零"},
	{Key: "altitude", Name: "海拔高度", Icon: "mdi:image-filter-hdr", Unit: "m", StateClass: "measurement", Label: "海拔高度", Desc: "GPS 推算的当前海拔（米）"},
	{Key: "gps_accuracy", Name: "GPS 精度", Icon: "mdi:crosshairs-gps", Unit: "m", StateClass: "measurement", Category: "diagnostic", Label: "GPS 精度", Desc: "当前定位的水平精度半径（米，越小越准）"},
	{Key: "gps_satellites", Name: "GPS 卫星数", Icon: "mdi:satellite-variant", StateClass: "measurement", Category: "diagnostic", Label: "GPS 卫星数", Desc: "当前参与定位的在搜卫星数量"},
}

// sensorDefVersion 传感器定义版本：每次修改 SENSOR_DEFS 的元数据（device_class/state_class/unit）
// 就 +1。HA 侧实体注册信息只在首次注册时落库，后续不会再校验；版本升级后由 registerSensors
// 对已登记项重发一次 register_sensor，让 HA 按「更新」覆盖为新定义（含显式 null 清理旧字段），
// 否则历史误标 state_class 的字符串传感器会持续在 HA 日志刷 ValueError。
const sensorDefVersion = 5

// sensorDefByKey 按 key 查传感器注册表项；未命中返回空项（icon 默认 mdi:cellphone）。
func sensorDefByKey(key string) SensorDef {
	for _, d := range SENSOR_DEFS {
		if d.Key == key {
			return d
		}
	}
	return SensorDef{Key: key, Name: key, Icon: "mdi:cellphone"}
}

// Sensors 设备传感器：经 HA 官方 mobile_app 协议注册真实设备与 sensor 实体。
// 设备注册、传感器开关与 mobile_app 注册信息均按登录用户隔离，存于 user_prefs，
// 使每个用户只管理自己的设备、只向自己 HA 实例上报，互不串扰。
type Sensors struct {
	manager   *ha.Manager
	repo      *store.InstanceRepo
	userPrefs *store.UserPrefs
}

// NewSensors 构造 handler。
func NewSensors(manager *ha.Manager, repo *store.InstanceRepo, userPrefs *store.UserPrefs) *Sensors {
	return &Sensors{manager: manager, repo: repo, userPrefs: userPrefs}
}

// Definitions GET /sensors/definitions  返回传感器注册表（前端渲染开关面板用）。
func (h *Sensors) Definitions(w http.ResponseWriter, r *http.Request) {
	out := make([]map[string]string, 0, len(SENSOR_DEFS))
	for _, d := range SENSOR_DEFS {
		out = append(out, map[string]string{
			"key":   d.Key,
			"label": d.Label,
			"desc":  d.Desc,
			"icon":  d.Icon,
		})
	}
	WriteJSON(w, 200, out)
}

// sensorValue 单个传感器上报值。
type sensorValue struct {
	State      any            `json:"state"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// sensorReport 上报请求体。
type sensorReport struct {
	DeviceID     string                 `json:"device_id"`
	DeviceName   string                 `json:"device_name,omitempty"`
	Sensors      map[string]sensorValue `json:"sensors"`
	Manufacturer string                 `json:"manufacturer,omitempty"`
	Model        string                 `json:"model,omitempty"`
	OSName       string                 `json:"os_name,omitempty"`
	OSVersion    string                 `json:"os_version,omitempty"`
}

// mobileReg 已注册的 mobile_app 设备信息（persist 到 prefs 复用）。
type mobileReg struct {
	WebhookID string          `json:"webhook_id"`
	Secret    string          `json:"secret"`
	DeviceID  string          `json:"device_id"`
	DevID     string          `json:"dev_id"` // 稳定 dev_id，用于构造 unique_id
	Sensors   map[string]bool `json:"sensors"`
	// DefVersion 已按 sensorDefVersion 完成注册同步的定义版本；低于当前值说明需要重注册一遍。
	DefVersion int `json:"def_version,omitempty"`
}

// Report POST /instances/{id}/sensors/report
// body {device_id, device_name?, sensors:{key:{state, attributes?}}, manufacturer?, model?, os_name?, os_version?}
// 流程：确保设备注册（不存在则自动创建）→ 确保 mobile_app 设备注册（幂等）→
// 按 sensor_config 过滤启用项 → 经官方 webhook 协议注册传感器并上报状态。
// 即使未启用任何传感器也会注册 mobile_app 设备（与官方 App 一致：登录即出现设备）。
func (h *Sensors) Report(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 400, "bad_request", "invalid instance id")
		return
	}
	var body sensorReport
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	body.DeviceID = strings.TrimSpace(body.DeviceID)
	if body.DeviceID == "" {
		WriteErr(w, 400, "bad_request", "device_id required")
		return
	}
	ctx := r.Context()
	username := rUsername(r)

	// 1. REST 客户端（未配置个人 Token → 403 no_ha_token；无实例 → 404 no_instance）。
	rest, err := h.manager.Rest(ctx, id)
	if err != nil {
		haErr(w, err)
		return
	}

	// 2. 设备信息（dev_id 用于构造 unique_id）；未注册则自动创建。
	dev := h.lookupDevice(ctx, username, body.DeviceID)
	if dev == nil {
		d, err := (&Devices{repo: h.repo, userPrefs: h.userPrefs}).upsert(ctx, username, body.DeviceID, body.DeviceName)
		if err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
		dev = &d
	}

	// 3. 确保 mobile_app 设备已注册（幂等，复用 webhook_id）。无启用传感器也执行，保证 HA 中立即出现设备。
	reg, err := h.ensureRegistration(ctx, username, rest, dev, body)
	if err != nil {
		slog.Warn("mobile_app registration failed", "instance", id, "device", dev.DevID, "err", err.Error())
		WriteErr(w, 502, "mobile_app_unavailable", "mobile_app 集成不可用（默认由 default_config 启用，请检查 HA 配置是否移除了 default_config）")
		return
	}
	// 注册成功的 Info 日志只在真正发生注册时记录（见 doRegister），
	// 心跳上报每次都打会把日志刷屏。
	slog.Debug("mobile_app registration ensured", "instance", id, "device", dev.DevID, "webhook_id", reg.WebhookID)

	// 4. 按 sensor_config 过滤：仅登记/上报已启用的传感器。
	enabled := h.enabledSensors(ctx, username, body.DeviceID)
	if len(enabled) == 0 {
		slog.Info("mobile_app report: no enabled sensors", "instance", id, "device", dev.DevID)
		WriteJSON(w, 200, map[string]any{"registered": true, "reported": 0})
		return
	}

	// 5. 登记传感器实体并上报状态；若 webhook 失效（如 HA 侧删除了该设备），
	//    自动清除旧注册信息并重新注册后重试一次（与官方 App 的失效重注册一致）。
	reported, err := h.pushStates(ctx, username, rest, reg, body, enabled)
	if err != nil && webhookInvalid(err) {
		slog.Warn("mobile_app webhook stale, re-registering", "instance", id, "device", dev.DevID, "err", err.Error())
		h.clearReg(ctx, username, body.DeviceID)
		if reg2, err2 := h.ensureRegistration(ctx, username, rest, dev, body); err2 == nil {
			reg = reg2
			reported, err = h.pushStates(ctx, username, rest, reg, body, enabled)
		} else {
			err = err2
		}
	}
	if err != nil {
		slog.Warn("mobile_app report failed", "instance", id, "device", dev.DevID, "err", err.Error())
		WriteErr(w, 502, "ha_unreachable", "HA 连接失败: "+err.Error())
		return
	}
	WriteJSON(w, 200, map[string]any{"registered": true, "reported": reported})
}

// pushStates 登记未注册的传感器实体并上报状态，返回实际上报的传感器数量。
// 若 registerSensors 或 update_sensor_states 失败（设备已被 HA 删除），返回错误供上层重注册。
func (h *Sensors) pushStates(ctx context.Context, username string, rest *client.Rest, reg *mobileReg, body sensorReport, enabled map[string]bool) (int, error) {
	if err := h.registerSensors(ctx, username, rest, reg, enabled, body); err != nil {
		return 0, err
	}
	states := make([]map[string]any, 0, len(enabled))
	for key := range enabled {
		sv, ok := body.Sensors[key]
		if !ok {
			continue
		}
		def := sensorDefByKey(key)
		entry := map[string]any{
			// 官方协议：update_sensor_states 的 data 是数组，
			// 每项用注册时的 unique_id 标识实体（HA 按 webhook_id+unique_id 定位）。
			"unique_id": key,
			"state":     sv.State,
			"type":      "sensor",
			"icon":      def.Icon,
		}
		if len(sv.Attributes) > 0 {
			entry["attributes"] = sv.Attributes
		}
		states = append(states, entry)
	}
	if len(states) == 0 {
		return 0, nil
	}
	// 官方协议：{"type":"update_sensor_states","data":[{unique_id,state,type,icon,attributes},...]}
	upPayload := map[string]any{"type": "update_sensor_states", "data": states}
	if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID, upPayload, nil); err != nil {
		return 0, err
	}
	return len(states), nil
}

// webhookInvalid 判断错误是否由 webhook 失效（设备被删除/注册信息过期）导致。
func webhookInvalid(err error) bool {
	s := err.Error()
	return strings.Contains(s, "404") || strings.Contains(s, "401") || strings.Contains(s, "403") || strings.Contains(s, "410")
}

// webhookAlive 用官方 get_config 命令探测已缓存 webhook 是否仍有效。
// 官方 get_config 响应必含 hass_device_id 字段；据此判断设备是否仍注册：
//   - 网络层错误（连接/超时）：视为仍有效，避免 HA 短暂不可达时误删缓存反复注册；
//   - HTTP 4xx/410：设备已删除/集成不可用 → 失效需重新注册；
//   - HTTP 200：仍须校验响应体中存在 hass_device_id。
//     设备被删除后该 webhook 已被注销：HA 重启前其 webhook 端点恒返回 200 且响应体为空
//     （HA webhook 组件「始终返回 200 以隐藏 hook 是否存在」），此时响应体无 hass_device_id → 失效；
//     HA 重启后会将其重新注册为返回 410 的「Deleted Webhook」→ 同样失效。
func (h *Sensors) webhookAlive(ctx context.Context, rest *client.Rest, reg *mobileReg) bool {
	return probeWebhookAlive(ctx, rest, reg.WebhookID)
}

// probeAliveTTL 探活结果的信任期。APK 每 60s 上报一次传感器，若每次都发
// get_config 探测，等于每台设备每分钟多一次 HA 请求；5 分钟内复用作废。
// 失效仍会被后续 pushStates 的 4xx/410 兜住并触发重注册，不依赖探测本身。
const probeAliveTTL = 5 * time.Minute

var (
	probeAliveMu sync.Mutex
	probeAliveAt = map[string]time.Time{} // webhookID -> 上次确认仍有效的时间
)

// probeWebhookAlive 探测某个 webhook 是否仍然有效（包级工具，账号级生日传感器同步复用）。
// 有效结果缓存 {@link probeAliveTTL}；失效结果不缓存（下次调用继续探测并重注册）。
func probeWebhookAlive(ctx context.Context, rest *client.Rest, webhookID string) bool {
	probeAliveMu.Lock()
	at, ok := probeAliveAt[webhookID]
	probeAliveMu.Unlock()
	if ok && time.Since(at) < probeAliveTTL {
		return true
	}
	if !probeWebhookAliveRemote(ctx, rest, webhookID) {
		return false
	}
	probeAliveMu.Lock()
	probeAliveAt[webhookID] = time.Now()
	probeAliveMu.Unlock()
	return true
}

// probeWebhookAliveRemote 真正向 HA 发 get_config 探测。
//   - 网络层失败（连接/超时）：视为仍有效，避免 HA 短暂不可达时误删缓存反复注册；
//   - HTTP 4xx/410：设备已删除/集成不可用 → 失效需重新注册；
//   - HTTP 200：仍须校验响应体中存在 hass_device_id。
//     设备被删除后该 webhook 已被注销：HA 重启前其 webhook 端点恒返回 200 且响应体为空
//     （HA webhook 组件「始终返回 200 以隐藏 hook 是否存在」），此时响应体无 hass_device_id → 失效；
//     HA 重启后会将其重新注册为返回 410 的「Deleted Webhook」→ 同样失效。
func probeWebhookAliveRemote(ctx context.Context, rest *client.Rest, webhookID string) bool {
	status, resp, err := rest.ProbeWebhook(ctx, "/api/webhook/"+webhookID, map[string]any{"type": "get_config"})
	if err != nil {
		// 网络层失败 → 无法判定，保守视为仍有效
		return true
	}
	if status >= 200 && status < 300 {
		if _, ok := resp["hass_device_id"]; ok {
			return true
		}
		// 200 但无 hass_device_id（空体/空 JSON）→ 设备已被删除，webhook 失效
		return false
	}
	// 非 2xx（404/401/403/410 等）→ 失效
	return false
}

// clearReg 清除某设备的 mobile_app 注册缓存，触发下次上报重新注册。
func (h *Sensors) clearReg(ctx context.Context, username, deviceID string) {
	regs := h.readRegs(ctx, username)
	if _, ok := regs[deviceID]; ok {
		delete(regs, deviceID)
		_ = h.saveRegs(ctx, username, regs)
	}
}

// lookupDevice 按 device_id 查设备。
func (h *Sensors) lookupDevice(ctx context.Context, username, deviceID string) *Device {
	devices := (&Devices{repo: h.repo, userPrefs: h.userPrefs}).list(ctx, username)
	for i := range devices {
		if devices[i].DeviceID == deviceID {
			return &devices[i]
		}
	}
	return nil
}

// enabledSensors 返回某设备已启用的传感器 key 集（按注册表顺序，保证登记顺序稳定）。
func (h *Sensors) enabledSensors(ctx context.Context, username, deviceID string) map[string]bool {
	out := map[string]bool{}
	v := h.userPrefs.Get(ctx, username, "sensor_config")
	if v == "" {
		return out
	}
	var cfg map[string]map[string]bool
	if json.Unmarshal([]byte(v), &cfg) != nil {
		return out
	}
	if m, ok := cfg[deviceID]; ok {
		for _, def := range SENSOR_DEFS {
			if m[def.Key] {
				out[def.Key] = true
			}
		}
	}
	return out
}

func (h *Sensors) readRegs(ctx context.Context, username string) map[string]mobileReg {
	out := map[string]mobileReg{}
	v := h.userPrefs.Get(ctx, username, "mobile_app_reg")
	if v == "" {
		return out
	}
	_ = json.Unmarshal([]byte(v), &out)
	return out
}

func (h *Sensors) saveRegs(ctx context.Context, username string, regs map[string]mobileReg) error {
	b, _ := json.Marshal(regs)
	return h.userPrefs.Set(ctx, username, "mobile_app_reg", string(b))
}

// ensureRegistration 获取/注册 mobile_app 设备并返回 webhook_id。
// 有缓存时先用 get_config 探测 webhook 是否仍有效：HA 侧删除设备后 webhook 失效（404/410），
// 此时才清除缓存重新注册；设备仍存在则直接复用缓存，避免每次上报都重复注册设备。
func (h *Sensors) ensureRegistration(ctx context.Context, username string, rest *client.Rest, dev *Device, body sensorReport) (*mobileReg, error) {
	regs := h.readRegs(ctx, username)
	if r, ok := regs[dev.DeviceID]; ok && r.WebhookID != "" {
		if h.webhookAlive(ctx, rest, &r) {
			return &r, nil
		}
		slog.Warn("mobile_app webhook stale, clearing cache to re-register", "device", dev.DevID)
		// 在删除前保存旧记录，以便后续判断是否需要保留传感器登记状态。
		old := r
		delete(regs, dev.DeviceID)
		return h.doRegister(ctx, username, rest, dev, body, old, regs)
	}
	return h.doRegister(ctx, username, rest, dev, body, mobileReg{}, regs)
}

// doRegister 执行实际的 mobile_app 设备注册，返回注册结果。
// old 为被清除的旧注册记录；had=true 表示本次是从缓存失效触发的重注册。
func (h *Sensors) doRegister(ctx context.Context, username string, rest *client.Rest, dev *Device, body sensorReport, old mobileReg, regs map[string]mobileReg) (*mobileReg, error) {
	deviceName := dev.Name
	if deviceName == "" {
		deviceName = dev.DevID
	}
	manufacturer := body.Manufacturer
	if manufacturer == "" {
		manufacturer = "web"
	}
	model := body.Model
	if model == "" {
		model = "browser"
	}
	osName := body.OSName
	if osName == "" {
		osName = "web"
	}
	// HA 移动应用注册要求 os_version 存在：缺该字段时 HA 能创建条目，但每次启动
	// async_setup_entry 都会 KeyError('os_version')，设备与 webhook 全部不可用。
	// 协议允许任意字符串，非 App 上报场景（纯浏览器）用服务端版本号兜底，绝不留空。
	osVersion := body.OSVersion
	if osVersion == "" {
		osVersion = Version
	}
	payload := map[string]any{
		"app_id":              "stickykee",
		"app_name":            "stickykee",
		"app_version":         Version,
		"device_id":           "stickykee_" + dev.DevID,
		"device_name":         deviceName,
		"manufacturer":        manufacturer,
		"model":               model,
		"os_name":             osName,
		"os_version":          osVersion,
		"supports_encryption": false,
	}
	var resp struct {
		WebhookID string `json:"webhook_id"`
		Secret    string `json:"secret"`
	}
	if err := rest.PostJSON(ctx, "/api/mobile_app/registrations", payload, &resp); err != nil {
		return nil, err
	}
	if resp.WebhookID == "" {
		return nil, errors.New("mobile_app registration returned no webhook_id")
	}
	reg := mobileReg{
		WebhookID: resp.WebhookID,
		Secret:    resp.Secret,
		DeviceID:  dev.DeviceID,
		DevID:     dev.DevID,
		Sensors:   map[string]bool{},
	}
	// webhook_id 未变说明设备仍存在（复用注册）→ 保留已登记传感器记录；
	// webhook_id 变化或首次注册 → 清空记录，由 registerSensors 重新登记全部传感器实体。
	had := old.WebhookID != ""
	if had && old.WebhookID == resp.WebhookID && old.Sensors != nil {
		reg.Sensors = old.Sensors
	}
	regs[dev.DeviceID] = reg
	if err := h.saveRegs(ctx, username, regs); err != nil {
		return nil, err
	}
	slog.Info("mobile_app device registered", "user", username, "device", dev.DevID,
		"webhook_id", resp.WebhookID, "reregister", had)
	return &reg, nil
}

// sensorRegisterPayload 构造 register_sensor 的 data。
// device_class/unit_of_measurement/state_class/entity_category 一律显式给出（未设置时为 null）：
// HA 对已存在实体的重复注册按「更新」处理，会把请求里的字段覆盖到实体与注册表，
// 显式 null 才能清掉历史版本误标的 state_class（仅省略字段不会清除，旧值会一直保留）。
func sensorRegisterPayload(def SensorDef, sv *sensorValue) map[string]any {
	nullIfEmpty := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	p := map[string]any{
		"type":                "sensor",
		"unique_id":           def.Key,
		"name":                def.Name,
		"icon":                def.Icon,
		"unit_of_measurement": nullIfEmpty(def.Unit),
		"device_class":        nullIfEmpty(def.DeviceClass),
		"state_class":         nullIfEmpty(def.StateClass),
		"entity_category":     nullIfEmpty(def.Category),
	}
	// 重注册会顺带覆盖状态：必须带上本次上报的当前值，否则 HA 会把实体状态写成 unknown。
	if sv != nil {
		p["state"] = sv.State
		if len(sv.Attributes) > 0 {
			p["attributes"] = sv.Attributes
		}
	}
	return p
}

// registerSensors 经官方 webhook 协议登记传感器实体。
// 两类情况会重发 register_sensor：
//   - 首次启用（本地无登记记录）；
//   - 定义版本落后（sensorDefVersion 升级后清理/校正 HA 侧旧元数据），此时仅同步本次带值的项，
//     避免把未上报的传感器状态写成 unknown。
func (h *Sensors) registerSensors(ctx context.Context, username string, rest *client.Rest, reg *mobileReg, enabled map[string]bool, body sensorReport) error {
	regs := h.readRegs(ctx, username)
	current := regs[reg.DeviceID]
	if current.Sensors == nil {
		current.Sensors = map[string]bool{}
	}
	// 定义版本升级 → 对已登记项做一次同步重注册
	syncDefs := current.DefVersion < sensorDefVersion
	pending := false
	changed := false
	for _, def := range SENSOR_DEFS {
		if !enabled[def.Key] {
			continue
		}
		registered := current.Sensors[def.Key]
		if registered && !syncDefs {
			continue
		}
		var sv *sensorValue
		if v, ok := body.Sensors[def.Key]; ok {
			sv = &v
		}
		// 版本同步时若本次没有该项的值，跳过等下次上报，避免把状态刷成 unknown
		if registered && sv == nil {
			pending = true
			continue
		}
		// 官方 webhook 协议：POST /api/webhook/{webhook_id} {type: register_sensor, data: {...}}
		if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID,
			map[string]any{"type": "register_sensor", "data": sensorRegisterPayload(def, sv)}, nil); err != nil {
			// 旧版 HA 对重复注册返回 already_registered → 视为已登记
			if !strings.Contains(err.Error(), "already_registered") {
				return err
			}
		}
		current.Sensors[def.Key] = true
		changed = true
	}
	// 仍有未同步项 → 不推进版本号，下次带值上报时继续同步
	if syncDefs && !pending {
		current.DefVersion = sensorDefVersion
		changed = true
	}
	if changed {
		current.WebhookID = reg.WebhookID
		current.Secret = reg.Secret
		current.DeviceID = reg.DeviceID
		current.DevID = reg.DevID
		regs[reg.DeviceID] = current
		if err := h.saveRegs(ctx, username, regs); err != nil {
			return err
		}
	}
	return nil
}

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"homecanvas/server/internal/store"
)

// Device 设备注册项。DeviceID 是前端生成的持久唯一标识；DevID 是对应 Home Assistant 的 device_tracker 标识（稳定，避免重复添加）。
type Device struct {
	DeviceID  string `json:"device_id"`
	Name      string `json:"name"` // 别名
	DevID     string `json:"dev_id"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// Devices 设备注册表（按 device_id 去重，可设置别名）。
type Devices struct {
	repo *store.InstanceRepo
}

// NewDevices 构造 handler。
func NewDevices(repo *store.InstanceRepo) *Devices { return &Devices{repo: repo} }

var devSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.Trim(devSlugRe.ReplaceAllString(s, "_"), "_")
}

func (h *Devices) list(ctx context.Context) []Device {
	v, err := h.repo.GetPref(ctx, "devices")
	if err != nil || v == "" {
		return []Device{}
	}
	var out []Device
	if json.Unmarshal([]byte(v), &out) != nil {
		return []Device{}
	}
	if out == nil {
		out = []Device{}
	}
	return out
}

func (h *Devices) save(ctx context.Context, list []Device) error {
	if list == nil {
		list = []Device{}
	}
	b, _ := json.Marshal(list)
	return h.repo.SetPref(ctx, "devices", string(b))
}

// deviceUpsert 注册或更新设备（按 device_id 去重，不重复添加）。
func (h *Devices) upsert(ctx context.Context, deviceID, name string) (Device, error) {
	now := time.Now().Format(time.RFC3339)
	list := h.list(ctx)
	// 同一 device_id 已存在 → 更新别名与时间戳，保持 dev_id 不变。
	for i := range list {
		if list[i].DeviceID == deviceID {
			if name != "" {
				list[i].Name = name
			}
			if list[i].DevID == "" {
				list[i].DevID = slugify(deviceID)
			}
			list[i].UpdatedAt = now
			if err := h.save(ctx, list); err != nil {
				return Device{}, err
			}
			return list[i], nil
		}
	}
	// 新增：生成稳定 dev_id 并保证唯一。
	base := slugify(name)
	if base == "" {
		base = slugify(deviceID)
	}
	devID := base
	used := map[string]bool{}
	for _, d := range list {
		used[d.DevID] = true
	}
	for i := 2; used[devID]; i++ {
		devID = base + "_" + strconv.Itoa(i)
	}
	d := Device{DeviceID: deviceID, Name: name, DevID: devID, CreatedAt: now, UpdatedAt: now}
	if d.Name == "" {
		d.Name = devID
	}
	list = append(list, d)
	if err := h.save(ctx, list); err != nil {
		return Device{}, err
	}
	return d, nil
}

// List GET /devices  返回全部已注册设备。
func (h *Devices) List(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, h.list(r.Context()))
}

// Register POST /devices  {device_id, name?}  注册/更新当前设备（去重）。
func (h *Devices) Register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DeviceID string `json:"device_id"`
		Name     string `json:"name"`
	}
	if err := DecodeBody(r, &body); err != nil || strings.TrimSpace(body.DeviceID) == "" {
		WriteErr(w, 400, "bad_request", "device_id required")
		return
	}
	d, err := h.upsert(r.Context(), strings.TrimSpace(body.DeviceID), strings.TrimSpace(body.Name))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, d)
}

// Rename PUT /devices/{device_id}  {name}  修改设备别名（dev_id 保持不变）。
func (h *Devices) Rename(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "device_id")
	if id == "" {
		WriteErr(w, 400, "bad_request", "device_id required")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	list := h.list(r.Context())
	for i := range list {
		if list[i].DeviceID == id {
			list[i].Name = strings.TrimSpace(body.Name)
			if list[i].Name == "" {
				list[i].Name = list[i].DevID
			}
			list[i].UpdatedAt = time.Now().Format(time.RFC3339)
			if err := h.save(r.Context(), list); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
			WriteJSON(w, 200, list[i])
			return
		}
	}
	WriteErr(w, 404, "not_found", "device not found")
}

// Delete DELETE /devices/{device_id}  删除设备。
func (h *Devices) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "device_id")
	if id == "" {
		WriteErr(w, 400, "bad_request", "device_id required")
		return
	}
	list := h.list(r.Context())
	out := list[:0]
	found := false
	for _, d := range list {
		if d.DeviceID == id {
			found = true
			continue
		}
		out = append(out, d)
	}
	if !found {
		WriteErr(w, 404, "not_found", "device not found")
		return
	}
	if err := h.save(r.Context(), out); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	// 同步清理该设备的传感器配置与 mobile_app 注册信息，避免残留。
	h.clearDeviceSensors(r.Context(), id)
	WriteJSON(w, 200, map[string]bool{"deleted": true})
}

// clearDeviceSensors 删除设备的 sensor_config 与 mobile_app_reg 项。
func (h *Devices) clearDeviceSensors(ctx context.Context, deviceID string) {
	if v, err := h.repo.GetPref(ctx, "sensor_config"); err == nil && v != "" {
		var cfg map[string]map[string]bool
		if json.Unmarshal([]byte(v), &cfg) == nil {
			if _, ok := cfg[deviceID]; ok {
				delete(cfg, deviceID)
				if b, err := json.Marshal(cfg); err == nil {
					_ = h.repo.SetPref(ctx, "sensor_config", string(b))
				}
			}
		}
	}
	if v, err := h.repo.GetPref(ctx, "mobile_app_reg"); err == nil && v != "" {
		var regs map[string]mobileReg
		if json.Unmarshal([]byte(v), &regs) == nil {
			if _, ok := regs[deviceID]; ok {
				delete(regs, deviceID)
				if b, err := json.Marshal(regs); err == nil {
					_ = h.repo.SetPref(ctx, "mobile_app_reg", string(b))
				}
			}
		}
	}
}

package handler

// 服务端 HA 虚拟设备（每实例唯一）。
//
// 生日、记账、库存、计划等由服务端发布的全部实体，都经这里拿到**同一个**
// mobile_app 注册与 webhook，从而在 HA 中归到同一台设备下
// （device_id = stickykee_server_<instance_id>）。
//
// 为什么必须共用一条注册：HA 以 (app_id, device_id) 作为 mobile_app 配置条目的
// 唯一键，同一键再次 POST /api/mobile_app/registrations 会「更新」该条目并轮换
// webhook_id（旧 webhook 立即失效）。此前各模块各自注册、各存一份 webhook，
// 每次注册都会把其他模块的 webhook 踢掉，导致每个同步周期都要重新注册，
// 实体 unique_id 前缀反复搬迁、HA 侧实体抖动。现在只在这里注册一次。
//
// 修改设备显示名同样只在这里做（update_registration 需要完整注册字段，
// 单独发 device_name 会被 HA 的 schema 校验拒绝）。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"stickykee/server/internal/ha/client"
	"stickykee/server/internal/store"
)

// serverDeviceNameKey 全局 pref：HA 侧虚拟设备显示名（管理员可自定义；空则回退系统英文名 + " Server"）。
const serverDeviceNameKey = "server_device_name"

// serverDeviceBackendUser 注册缓存存放在后端虚拟用户名下（per-instance，不归属任何真实用户）。
const serverDeviceBackendUser = "__server__"

// serverDeviceRegKeyPrefix 共享注册缓存键前缀（+ instance_id）。
const serverDeviceRegKeyPrefix = "server_device_reg_"

// serverDeviceRegTTL 进程内 webhook 复用的信任期；到期后重新探活（探活结果本身另有 5 分钟缓存），
// 这样 HA 侧删除设备后最多几分钟即可自动重建。
const serverDeviceRegTTL = 5 * time.Minute

// legacyServerDeviceRegKeys 旧版本各模块独立保存 webhook 的缓存键前缀（+ instance_id）。
// 升级后首次同步按顺序尝试复用，避免无谓地重建设备。
var legacyServerDeviceRegKeys = []string{"server_birthday_reg_", "fin_reg_", "inventory_reg_"}

type serverDeviceReg struct {
	WebhookID string `json:"webhook_id"`
}

// ServerDevice 管理后端在 HA 侧的唯一虚拟设备及其 mobile_app 注册。
type ServerDevice struct {
	inst      *store.InstanceRepo
	userPrefs *store.UserPrefs

	// mu 串行化注册：并发 POST 会让 HA 连续轮换 webhook，必须一次只做一件事。
	mu       sync.Mutex
	webhooks map[int64]string    // instanceID -> 最近一次确认有效的 webhook_id
	checked  map[int64]time.Time // 上述确认时间
	lastName sync.Map            // instanceID -> 最近一次成功下发的设备名
}

// NewServerDevice 构造共享虚拟设备管理器（生日 / 记账 / 库存 / 计划共用同一实例）。
func NewServerDevice(inst *store.InstanceRepo, userPrefs *store.UserPrefs) *ServerDevice {
	return &ServerDevice{
		inst:      inst,
		userPrefs: userPrefs,
		webhooks:  map[int64]string{},
		checked:   map[int64]time.Time{},
	}
}

// DeviceName 虚拟设备显示名：server_device_name（管理员可自定义）优先，否则 site_name_en + " Server"。
func (d *ServerDevice) DeviceName(ctx context.Context) string {
	if v, _ := d.inst.GetPref(ctx, serverDeviceNameKey); strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	name, _ := d.inst.GetPref(ctx, "site_name_en")
	if name == "" {
		name = "Sticky Kee"
	}
	return strings.TrimSpace(name) + " Server"
}

// Ensure 返回该实例可用的 webhook_id；必要时注册（或重建）服务器虚拟设备。
// fresh 为 true 表示本次刚重新注册（HA 侧设备被删除 / 恢复备份等），
// 调用方应据此清掉推送缓存并全量重推，避免实体停在 unknown。
func (d *ServerDevice) Ensure(ctx context.Context, instanceID int64, rest *client.Rest) (webhookID string, fresh bool, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	want := d.DeviceName(ctx)

	if wid := d.cached(instanceID); wid != "" {
		d.syncName(ctx, rest, instanceID, wid, want)
		return wid, false, nil
	}

	if wid := d.readCachedWebhook(ctx, instanceID); wid != "" {
		if probeWebhookAlive(ctx, rest, wid) {
			d.remember(instanceID, wid)
			d.saveReg(ctx, instanceID, wid)
			d.syncName(ctx, rest, instanceID, wid, want)
			return wid, false, nil
		}
	}

	wid, err := d.register(ctx, instanceID, rest, want)
	if err != nil {
		return "", false, err
	}
	d.remember(instanceID, wid)
	d.saveReg(ctx, instanceID, wid)
	d.lastName.Store(instanceID, want) // 注册时已带上设备名
	return wid, true, nil
}

func (d *ServerDevice) cached(instanceID int64) string {
	wid, ok := d.webhooks[instanceID]
	if !ok {
		return ""
	}
	if time.Since(d.checked[instanceID]) > serverDeviceRegTTL {
		delete(d.webhooks, instanceID)
		delete(d.checked, instanceID)
		return ""
	}
	return wid
}

func (d *ServerDevice) remember(instanceID int64, wid string) {
	d.webhooks[instanceID] = wid
	d.checked[instanceID] = time.Now()
}

// readCachedWebhook 读共享缓存；没有则回退读旧版各模块的缓存（升级迁移）。
func (d *ServerDevice) readCachedWebhook(ctx context.Context, instanceID int64) string {
	prefixes := append([]string{serverDeviceRegKeyPrefix}, legacyServerDeviceRegKeys...)
	for _, prefix := range prefixes {
		raw := d.userPrefs.Get(ctx, serverDeviceBackendUser, fmt.Sprintf("%s%d", prefix, instanceID))
		if raw == "" {
			continue
		}
		var r serverDeviceReg
		if json.Unmarshal([]byte(raw), &r) != nil {
			continue
		}
		if wid := strings.TrimSpace(r.WebhookID); wid != "" {
			return wid
		}
	}
	return ""
}

func (d *ServerDevice) saveReg(ctx context.Context, instanceID int64, wid string) {
	b, _ := json.Marshal(serverDeviceReg{WebhookID: wid})
	_ = d.userPrefs.Set(ctx, serverDeviceBackendUser, fmt.Sprintf("%s%d", serverDeviceRegKeyPrefix, instanceID), string(b))
}

// register 向 HA 注册（或更新）服务器虚拟设备并返回新的 webhook_id。
func (d *ServerDevice) register(ctx context.Context, instanceID int64, rest *client.Rest, name string) (string, error) {
	payload := map[string]any{
		"app_id":              "stickykee",
		"app_name":            "stickykee",
		"app_version":         Version,
		"device_id":           fmt.Sprintf("stickykee_server_%d", instanceID),
		"device_name":         name,
		"manufacturer":        "stickykee",
		"model":               "server",
		"os_name":             "stickykee",
		"os_version":          Version,
		"supports_encryption": false,
	}
	var resp struct {
		WebhookID string `json:"webhook_id"`
	}
	if err := rest.PostJSON(ctx, "/api/mobile_app/registrations", payload, &resp); err != nil {
		return "", err
	}
	if resp.WebhookID == "" {
		return "", errors.New("mobile_app registration returned no webhook_id")
	}
	slog.Info("server device registered", "instance", instanceID, "webhook_id", resp.WebhookID)
	return resp.WebhookID, nil
}

// syncName 设备名变化时经 update_registration 下发 HA。
// 注意：HA 的 update_registration 校验要求 app_version / device_name / manufacturer / model
// 等完整字段（只发 device_name 会被拒绝），故这里带全量注册信息。
func (d *ServerDevice) syncName(ctx context.Context, rest *client.Rest, instanceID int64, webhookID, want string) {
	if prev, ok := d.lastName.Load(instanceID); ok && prev == want {
		return
	}
	payload := map[string]any{
		"type": "update_registration",
		"data": map[string]any{
			"app_version":  Version,
			"device_name":  want,
			"manufacturer": "stickykee",
			"model":        "server",
			"os_version":   Version,
		},
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID, payload, nil); err != nil {
		slog.Warn("server device rename failed", "instance", instanceID, "err", err.Error())
		return
	}
	d.lastName.Store(instanceID, want)
}

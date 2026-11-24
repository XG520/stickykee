package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/client"
	"stickynuo/server/internal/store"
)

// InventorySync 把库存统计同步为 HA 的两个传感器实体：
// sensor.hc_inventory_total（在库总件数）与 sensor.hc_inventory_expiring（临期件数）。
// 复用生日功能的 mobile_app 虚拟设备（device_id = stickynuo_server_<instance_id>），
// 但使用独立的注册缓存命名空间，避免覆盖生日传感器的 webhook 记录。
type InventorySync struct {
	manager   *ha.Manager
	inst      *store.InstanceRepo
	users     *store.UserRepo
	userPrefs *store.UserPrefs
	inv       *store.InventoryRepo

	mu       sync.Mutex
	lastSync map[int64]time.Time
}

const (
	inventoryRegBackendUser = "__server__"
	inventorySyncMinGap     = 5 * time.Second
)

type inventoryReg struct {
	WebhookID string `json:"webhook_id"`
}

// NewInventorySync 构造同步器。
func NewInventorySync(manager *ha.Manager, inst *store.InstanceRepo, users *store.UserRepo, userPrefs *store.UserPrefs, inv *store.InventoryRepo) *InventorySync {
	return &InventorySync{
		manager:   manager,
		inst:      inst,
		users:     users,
		userPrefs: userPrefs,
		inv:       inv,
		lastSync:  map[int64]time.Time{},
	}
}

func inventoryRegKey(instanceID int64) string {
	return fmt.Sprintf("inventory_reg_%d", instanceID)
}

func (h *InventorySync) readReg(ctx context.Context, instanceID int64) inventoryReg {
	var r inventoryReg
	if v := h.userPrefs.Get(ctx, inventoryRegBackendUser, inventoryRegKey(instanceID)); v != "" {
		_ = json.Unmarshal([]byte(v), &r)
	}
	return r
}

func (h *InventorySync) saveReg(ctx context.Context, instanceID int64, r inventoryReg) {
	b, _ := json.Marshal(r)
	_ = h.userPrefs.Set(ctx, inventoryRegBackendUser, inventoryRegKey(instanceID), string(b))
}

// deviceName 与生日功能保持同一虚拟设备名，避免在 HA 里出现两个同名设备。
func (h *InventorySync) deviceName(ctx context.Context) string {
	if v, _ := h.inst.GetPref(ctx, "server_device_name"); strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	name, _ := h.inst.GetPref(ctx, "site_name_en")
	if name == "" {
		name = "Sticky Kee"
	}
	return strings.TrimSpace(name) + " Server"
}

func (h *InventorySync) expiringDays(ctx context.Context) int {
	v, _ := h.inst.GetPref(ctx, "inventory_expiring_days")
	n, _ := strconv.Atoi(strings.TrimSpace(v))
	if n <= 0 {
		n = 3
	}
	return n
}

// adminRest 取一个配了 token 的管理员连接（与生日功能一致）。
func (h *InventorySync) adminRest(ctx context.Context, instanceID int64) *client.Rest {
	users, err := h.users.List(ctx)
	if err != nil {
		return nil
	}
	for _, u := range users {
		if !u.IsAdmin || h.userPrefs.Get(ctx, u.Username, "ha_token") == "" {
			continue
		}
		if rest, err := h.manager.RestForUser(ctx, instanceID, u.Username); err == nil {
			return rest
		}
	}
	return nil
}

// ensureReg 确保虚拟设备已注册（幂等；HA 对同一 device_id 返回同一 webhook_id）。
func (h *InventorySync) ensureReg(ctx context.Context, instanceID int64, rest *client.Rest) (*inventoryReg, error) {
	if reg := h.readReg(ctx, instanceID); reg.WebhookID != "" {
		return &reg, nil
	}
	payload := map[string]any{
		"app_id":              "stickynuo",
		"app_name":            "stickynuo",
		"app_version":         Version,
		"device_id":           fmt.Sprintf("stickynuo_server_%d", instanceID),
		"device_name":         h.deviceName(ctx),
		"manufacturer":        "stickynuo",
		"model":               "server",
		"os_name":             "stickynuo",
		"os_version":          Version,
		"supports_encryption": false,
	}
	var resp struct {
		WebhookID string `json:"webhook_id"`
	}
	if err := rest.PostJSON(ctx, "/api/mobile_app/registrations", payload, &resp); err != nil {
		return nil, err
	}
	if resp.WebhookID == "" {
		return nil, errors.New("mobile_app registration returned no webhook_id")
	}
	reg := inventoryReg{WebhookID: resp.WebhookID}
	h.saveReg(ctx, instanceID, reg)
	return &reg, nil
}

// SyncInstance 统计并推送某实例的库存传感器。
func (h *InventorySync) SyncInstance(ctx context.Context, instanceID int64) {
	rest := h.adminRest(ctx, instanceID)
	if rest == nil {
		return
	}
	reg, err := h.ensureReg(ctx, instanceID, rest)
	if err != nil {
		slog.Warn("inventory sync: register failed", "instance", instanceID, "err", err.Error())
		return
	}
	days := h.expiringDays(ctx)
	st, err := h.inv.Stats(ctx, instanceID, days)
	if err != nil {
		slog.Warn("inventory sync: stats failed", "instance", instanceID, "err", err.Error())
		return
	}
	sensors := []map[string]any{
		{
			"type":                "sensor",
			"unique_id":           "hc_inv_total",
			"name":                "库存总数",
			"icon":                "mdi:package-variant",
			"unit_of_measurement": "件",
			"state_class":         "measurement",
		},
		{
			"type":                "sensor",
			"unique_id":           "hc_inv_expiring",
			"name":                "库存临期",
			"icon":                "mdi:clock-alert-outline",
			"unit_of_measurement": "件",
			"state_class":         "measurement",
		},
	}
	for _, sensor := range sensors {
		if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID,
			map[string]any{"type": "register_sensor", "data": sensor}, nil); err != nil {
			if !strings.Contains(err.Error(), "already_registered") {
				slog.Warn("inventory sync: register sensor failed", "instance", instanceID, "err", err.Error())
				return
			}
		}
	}
	payload := map[string]any{
		"type": "update_sensor_states",
		"data": []map[string]any{
			{
				"type":      "sensor",
				"unique_id": "hc_inv_total",
				"state":     st.Total,
				"icon":      "mdi:package-variant",
				"attributes": map[string]any{
					"item_count":  st.ItemCount,
					"low_stock":   st.LowStock,
					"by_location": st.ByLocation,
				},
			},
			{
				"type":      "sensor",
				"unique_id": "hc_inv_expiring",
				"state":     st.Expiring,
				"icon":      "mdi:clock-alert-outline",
				"attributes": map[string]any{
					"expired":     st.Expired,
					"window_days": days,
				},
			},
		},
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID, payload, nil); err != nil {
		slog.Warn("inventory sync: push failed", "instance", instanceID, "err", err.Error())
	}
}

// RequestSync 在库存变更后触发一次异步同步（5s 去抖，避免连续操作放大 HA 请求）。
func (h *InventorySync) RequestSync(instanceID int64) {
	if instanceID <= 0 {
		return
	}
	h.mu.Lock()
	if t, ok := h.lastSync[instanceID]; ok && time.Since(t) < inventorySyncMinGap {
		h.mu.Unlock()
		return
	}
	h.lastSync[instanceID] = time.Now()
	h.mu.Unlock()
	go h.SyncInstance(context.Background(), instanceID)
}

// StartTicker 每小时全量同步一次（同时充当 HA 重启后的自愈兜底）。
func (h *InventorySync) StartTicker(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.SyncAll(context.Background())
			h.CheckReminders(context.Background())
		}
	}
}

// SyncAll 同步所有存在库存数据的实例。
func (h *InventorySync) SyncAll(ctx context.Context) {
	ids, err := h.inv.InstanceIDsWithInventory(ctx)
	if err != nil {
		return
	}
	for _, id := range ids {
		h.SyncInstance(ctx, id)
	}
}

// CheckReminders 扫描临期批次并通过 HA 持久通知提醒。
// 以「批次 + 日期」去重，同一批次每天最多提醒一次；单实例单次最多 10 条，避免刷屏。
func (h *InventorySync) CheckReminders(ctx context.Context) {
	ids, err := h.inv.InstanceIDsWithInventory(ctx)
	if err != nil {
		return
	}
	today := time.Now().Format("2006-01-02")
	days := h.expiringDays(ctx)
	for _, instanceID := range ids {
		rest := h.adminRest(ctx, instanceID)
		if rest == nil {
			continue
		}
		list, err := h.inv.ExpiringBatches(ctx, instanceID, days)
		if err != nil {
			continue
		}
		sent := 0
		for _, b := range list {
			if sent >= 10 {
				break
			}
			fresh, err := h.inv.MarkReminder(ctx, instanceID, b.BatchID, today)
			if err != nil || !fresh {
				continue
			}
			loc := b.LocationName
			if loc == "" {
				loc = "未指定位置"
			}
			message := fmt.Sprintf("%s 将于 %s 到期（%s，数量 %g）。", b.ItemName, b.ExpiryDate, loc, b.Quantity)
			if err := rest.PostJSON(ctx, "/api/services/persistent_notification/create", map[string]any{
				"title":           "库存临期提醒",
				"message":         message,
				"notification_id": fmt.Sprintf("hc_inv_%d", b.BatchID),
			}, nil); err != nil {
				slog.Warn("inventory reminder: notify failed", "instance", instanceID, "err", err.Error())
				continue
			}
			sent++
		}
	}
}

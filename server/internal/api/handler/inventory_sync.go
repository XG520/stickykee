package handler

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/client"
	"stickykee/server/internal/store"
)

// InventorySync 把库存与购物清单统计发布为 HA 传感器实体：
// 库存总数、库存价值、临期件数、需补货件数、待购清单项数。
// 复用服务器虚拟设备（ServerDevice）：与生日、记账、计划共用同一条 HA 注册，
// 实体全部归到同一台设备下。
type InventorySync struct {
	manager   *ha.Manager
	inst      *store.InstanceRepo
	users     *store.UserRepo
	userPrefs *store.UserPrefs
	inv       *store.InventoryRepo
	dev       *ServerDevice

	mu       sync.Mutex
	lastSync map[int64]time.Time
}

const inventorySyncMinGap = 5 * time.Second

// NewInventorySync 构造同步器。
func NewInventorySync(manager *ha.Manager, inst *store.InstanceRepo, users *store.UserRepo, userPrefs *store.UserPrefs, inv *store.InventoryRepo, dev *ServerDevice) *InventorySync {
	return &InventorySync{
		manager:   manager,
		inst:      inst,
		users:     users,
		userPrefs: userPrefs,
		inv:       inv,
		dev:       dev,
		lastSync:  map[int64]time.Time{},
	}
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

// SyncInstance 统计并推送某实例的库存 + 购物清单传感器。
func (h *InventorySync) SyncInstance(ctx context.Context, instanceID int64) {
	rest := h.adminRest(ctx, instanceID)
	if rest == nil {
		return
	}
	webhookID, _, err := h.dev.Ensure(ctx, instanceID, rest)
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
	shopping, err := h.inv.ListShopping(ctx, instanceID, false)
	if err != nil {
		slog.Warn("inventory sync: shopping failed", "instance", instanceID, "err", err.Error())
		shopping = nil
	}
	shoppingNames := make([]string, 0, len(shopping))
	for _, s := range shopping {
		if len(shoppingNames) >= 20 {
			break
		}
		shoppingNames = append(shoppingNames, s.Name)
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
			"unique_id":           "hc_inv_value",
			"name":                "库存价值",
			"icon":                "mdi:cash-multiple",
			"unit_of_measurement": "元",
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
		{
			"type":                "sensor",
			"unique_id":           "hc_inv_low_stock",
			"name":                "库存需补货",
			"icon":                "mdi:cart-alert",
			"unit_of_measurement": "件",
			"state_class":         "measurement",
		},
		{
			"type":                "sensor",
			"unique_id":           "hc_inv_shopping",
			"name":                "待购清单",
			"icon":                "mdi:cart-outline",
			"unit_of_measurement": "项",
			"state_class":         "measurement",
		},
	}
	for _, sensor := range sensors {
		if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID,
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
				"unique_id": "hc_inv_value",
				"state":     round2(st.TotalValue),
				"icon":      "mdi:cash-multiple",
				"attributes": map[string]any{
					"item_count": st.ItemCount,
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
			{
				"type":      "sensor",
				"unique_id": "hc_inv_low_stock",
				"state":     st.LowStock,
				"icon":      "mdi:cart-alert",
				"attributes": map[string]any{
					"expiring": st.Expiring,
					"expired":  st.Expired,
				},
			},
			{
				"type":      "sensor",
				"unique_id": "hc_inv_shopping",
				"state":     len(shopping),
				"icon":      "mdi:cart-outline",
				"attributes": map[string]any{
					"items": shoppingNames,
				},
			},
		},
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID, payload, nil); err != nil {
		slog.Warn("inventory sync: push failed", "instance", instanceID, "err", err.Error())
	}
}

// round2 保留两位小数（库存价值本身以元为单位）。
func round2(v float64) float64 {
	return math.Round(v*100) / 100
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

// StartTicker 启动时先全量同步一次，之后每小时同步（兼作 HA 重启后的自愈兜底）。
func (h *InventorySync) StartTicker(ctx context.Context) {
	h.SyncAll(context.Background())
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

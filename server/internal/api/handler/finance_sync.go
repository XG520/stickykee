package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/client"
	"stickykee/server/internal/store"
)

// FinanceSync 把账本概览发布为 HA 的四个传感器实体：
// sensor.hc_finance_expense / income / budget_left / balance。
// 复用 stickykee_server_<instance_id> 虚拟设备，但使用独立注册缓存命名空间 fin_reg，
// 避免覆盖生日（bdReg）与库存（inventory_reg）的 sensor 列表。
type FinanceSync struct {
	manager   *ha.Manager
	inst      *store.InstanceRepo
	users     *store.UserRepo
	userPrefs *store.UserPrefs
	fin       *store.FinanceRepo

	mu       sync.Mutex
	lastSync map[int64]time.Time
}

const (
	financeRegBackendUser = "__server__"
	financeSyncMinGap     = 5 * time.Second
)

type financeReg struct {
	WebhookID string `json:"webhook_id"`
}

// NewFinanceSync 构造同步器。
func NewFinanceSync(manager *ha.Manager, inst *store.InstanceRepo, users *store.UserRepo, userPrefs *store.UserPrefs, fin *store.FinanceRepo) *FinanceSync {
	return &FinanceSync{
		manager:   manager,
		inst:      inst,
		users:     users,
		userPrefs: userPrefs,
		fin:       fin,
		lastSync:  map[int64]time.Time{},
	}
}

func financeRegKey(instanceID int64) string {
	return fmt.Sprintf("fin_reg_%d", instanceID)
}

func (h *FinanceSync) readReg(ctx context.Context, instanceID int64) financeReg {
	var r financeReg
	if v := h.userPrefs.Get(ctx, financeRegBackendUser, financeRegKey(instanceID)); v != "" {
		_ = json.Unmarshal([]byte(v), &r)
	}
	return r
}

func (h *FinanceSync) saveReg(ctx context.Context, instanceID int64, r financeReg) {
	b, _ := json.Marshal(r)
	_ = h.userPrefs.Set(ctx, financeRegBackendUser, financeRegKey(instanceID), string(b))
}

func (h *FinanceSync) deviceName(ctx context.Context) string {
	if v, _ := h.inst.GetPref(ctx, "server_device_name"); strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	name, _ := h.inst.GetPref(ctx, "site_name_en")
	if name == "" {
		name = "Sticky Kee"
	}
	return strings.TrimSpace(name) + " Server"
}

// adminRest 取一个配了 token 的管理员连接。
func (h *FinanceSync) adminRest(ctx context.Context, instanceID int64) *client.Rest {
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

// ensureReg 确保虚拟设备已注册（HA 对同一 device_id 幂等）。
func (h *FinanceSync) ensureReg(ctx context.Context, instanceID int64, rest *client.Rest) (*financeReg, error) {
	if reg := h.readReg(ctx, instanceID); reg.WebhookID != "" {
		return &reg, nil
	}
	payload := map[string]any{
		"app_id":              "stickykee",
		"app_name":            "stickykee",
		"app_version":         Version,
		"device_id":           fmt.Sprintf("stickykee_server_%d", instanceID),
		"device_name":         h.deviceName(ctx),
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
		return nil, err
	}
	if resp.WebhookID == "" {
		return nil, errors.New("mobile_app registration returned no webhook_id")
	}
	reg := financeReg{WebhookID: resp.WebhookID}
	h.saveReg(ctx, instanceID, reg)
	return &reg, nil
}

// yuan 把分转换为元（保留两位小数），避免 3280 分发成 3280 元。
func yuan(cents int64) float64 {
	return math.Round(float64(cents)) / 100
}

// SyncInstance 统计并推送某实例的账本传感器。
func (h *FinanceSync) SyncInstance(ctx context.Context, instanceID int64) {
	rest := h.adminRest(ctx, instanceID)
	if rest == nil {
		return
	}
	reg, err := h.ensureReg(ctx, instanceID, rest)
	if err != nil {
		slog.Warn("finance sync: register failed", "instance", instanceID, "err", err.Error())
		return
	}
	month := time.Now().Format("2006-01")
	st, err := h.fin.Stats(ctx, instanceID, month)
	if err != nil {
		slog.Warn("finance sync: stats failed", "instance", instanceID, "err", err.Error())
		return
	}
	sensors := []map[string]any{
		{
			"type":                "sensor",
			"unique_id":           "hc_fin_expense",
			"name":                "本月支出",
			"icon":                "mdi:cash-minus",
			"unit_of_measurement": "元",
			"state_class":         "measurement",
		},
		{
			"type":                "sensor",
			"unique_id":           "hc_fin_income",
			"name":                "本月收入",
			"icon":                "mdi:cash-plus",
			"unit_of_measurement": "元",
			"state_class":         "measurement",
		},
		{
			"type":                "sensor",
			"unique_id":           "hc_fin_budget_left",
			"name":                "本月预算剩余",
			"icon":                "mdi:wallet",
			"unit_of_measurement": "元",
			"state_class":         "measurement",
		},
		{
			"type":                "sensor",
			"unique_id":           "hc_fin_balance",
			"name":                "总资产",
			"icon":                "mdi:bank",
			"unit_of_measurement": "元",
			"state_class":         "measurement",
		},
	}
	for _, sensor := range sensors {
		if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID,
			map[string]any{"type": "register_sensor", "data": sensor}, nil); err != nil {
			if !strings.Contains(err.Error(), "already_registered") {
				slog.Warn("finance sync: register sensor failed", "instance", instanceID, "err", err.Error())
				return
			}
		}
	}
	byCategory := map[string]float64{}
	for _, c := range st.ByCategory {
		byCategory[c.Name] = yuan(c.Amount)
	}
	byAccount := map[string]float64{}
	for _, a := range st.ByAccount {
		byAccount[a.Name] = yuan(a.Balance)
	}
	payload := map[string]any{
		"type": "update_sensor_states",
		"data": []map[string]any{
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_expense",
				"state":      yuan(st.Expense),
				"icon":       "mdi:cash-minus",
				"attributes": map[string]any{"month": month, "by_category": byCategory},
			},
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_income",
				"state":      yuan(st.Income),
				"icon":       "mdi:cash-plus",
				"attributes": map[string]any{"month": month},
			},
			{
				"type":      "sensor",
				"unique_id": "hc_fin_budget_left",
				"state":     yuan(st.BudgetLeft),
				"icon":      "mdi:wallet",
				"attributes": map[string]any{
					"month":        month,
					"budget_total": yuan(st.BudgetTotal),
					"usage_pct":    st.BudgetPct,
				},
			},
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_balance",
				"state":      yuan(st.Balance),
				"icon":       "mdi:bank",
				"attributes": map[string]any{"by_account": byAccount},
			},
		},
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+reg.WebhookID, payload, nil); err != nil {
		slog.Warn("finance sync: push failed", "instance", instanceID, "err", err.Error())
	}
	// 预算超支：按月+分类去重推送持久通知（同一 notification_id 覆盖更新，不重复堆叠）。
	if st.BudgetOverall {
		if st.BudgetLeft < 0 {
			h.notifyBudget(ctx, rest, instanceID, month, 0, "总预算", st.BudgetLeft, st.BudgetTotal, st.Expense)
		}
	} else {
		for _, b := range st.Budgets {
			if b.Left < 0 {
				h.notifyBudget(ctx, rest, instanceID, month, b.CategoryID, b.Name, b.Left, b.Budget, b.Spent)
			}
		}
	}
}

// notifyBudget 推送一条预算超支持久通知。
func (h *FinanceSync) notifyBudget(ctx context.Context, rest *client.Rest, instanceID int64,
	month string, categoryID int64, name string, left, budget, spent int64) {
	message := fmt.Sprintf("%s「%s」已超支 %s 元（预算 %s 元，已支出 %s 元）。",
		month, name, store.FormatCents(-left), store.FormatCents(budget), store.FormatCents(spent))
	if err := rest.PostJSON(ctx, "/api/services/persistent_notification/create", map[string]any{
		"title":           "预算超支提醒",
		"message":         message,
		"notification_id": fmt.Sprintf("hc_fin_budget_%s_%d", month, categoryID),
	}, nil); err != nil {
		slog.Warn("finance sync: budget notify failed", "instance", instanceID, "err", err.Error())
	}
}

// RequestSync 在账目变更后触发异步同步（5s 去抖）。
func (h *FinanceSync) RequestSync(instanceID int64) {
	if instanceID <= 0 {
		return
	}
	h.mu.Lock()
	if t, ok := h.lastSync[instanceID]; ok && time.Since(t) < financeSyncMinGap {
		h.mu.Unlock()
		return
	}
	h.lastSync[instanceID] = time.Now()
	h.mu.Unlock()
	go h.SyncInstance(context.Background(), instanceID)
}

// StartTicker 每小时生成周期账单并全量同步一次（兼作 HA 重启后的自愈兜底）。
func (h *FinanceSync) StartTicker(ctx context.Context) {
	_, _ = h.fin.RunRecurring(context.Background())
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, _ = h.fin.RunRecurring(context.Background())
			h.SyncAll(context.Background())
		}
	}
}

// SyncAll 同步所有存在账户的实例。
func (h *FinanceSync) SyncAll(ctx context.Context) {
	ids, err := h.fin.InstanceIDsWithFinance(ctx)
	if err != nil {
		return
	}
	for _, id := range ids {
		h.SyncInstance(ctx, id)
	}
}

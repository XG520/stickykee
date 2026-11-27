package handler

import (
	"context"
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

// FinanceSync 把账本概览与「计划」发布为 HA 传感器实体：
//   - 记账：支出、收入、结余、预算剩余、预算使用率、总资产；
//   - 计划：启用中的周期账单数量、月度总额、下一次执行日期。
//
// 复用服务器虚拟设备（ServerDevice）：与生日、库存、计划共用同一条 HA 注册，
// 实体全部归到同一台设备下。
type FinanceSync struct {
	manager   *ha.Manager
	users     *store.UserRepo
	userPrefs *store.UserPrefs
	fin       *store.FinanceRepo
	dev       *ServerDevice

	mu       sync.Mutex
	lastSync map[int64]time.Time
}

const financeSyncMinGap = 5 * time.Second

// NewFinanceSync 构造同步器。
func NewFinanceSync(manager *ha.Manager, users *store.UserRepo, userPrefs *store.UserPrefs, fin *store.FinanceRepo, dev *ServerDevice) *FinanceSync {
	return &FinanceSync{
		manager:   manager,
		users:     users,
		userPrefs: userPrefs,
		fin:       fin,
		dev:       dev,
		lastSync:  map[int64]time.Time{},
	}
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

// yuan 把分转换为元（保留两位小数），避免 3280 分发成 3280 元。
func yuan(cents int64) float64 {
	return math.Round(float64(cents)) / 100
}

// SyncInstance 统计并推送某实例的账本 + 计划传感器。
func (h *FinanceSync) SyncInstance(ctx context.Context, instanceID int64) {
	rest := h.adminRest(ctx, instanceID)
	if rest == nil {
		return
	}
	webhookID, _, err := h.dev.Ensure(ctx, instanceID, rest)
	if err != nil {
		slog.Warn("finance sync: register failed", "instance", instanceID, "err", err.Error())
		return
	}
	now := time.Now()
	month := now.Format("2006-01")
	st, err := h.fin.Stats(ctx, instanceID, month)
	if err != nil {
		slog.Warn("finance sync: stats failed", "instance", instanceID, "err", err.Error())
		return
	}

	// 计划：启用中的周期账单数量、月度总额与下一次执行日期。
	recs, err := h.fin.ListRecurring(ctx, instanceID)
	if err != nil {
		slog.Warn("finance sync: recurring failed", "instance", instanceID, "err", err.Error())
		recs = nil
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	enabledCount := 0
	var recurringTotal int64
	var nextDate time.Time
	var nextRec *store.FinRecurring
	recurringItems := make([]map[string]any, 0, len(recs))
	for i := range recs {
		r := recs[i]
		if !r.Enabled {
			continue
		}
		enabledCount++
		recurringTotal += r.Amount
		d := nextRecurringDate(r.DayOfMonth, r.LastRunMonth, now)
		if nextDate.IsZero() || d.Before(nextDate) {
			nextDate = d
			nextRec = &recs[i]
		}
		if len(recurringItems) < 20 {
			recurringItems = append(recurringItems, map[string]any{
				"name":      r.Name,
				"type":      r.Type,
				"amount":    yuan(r.Amount),
				"day":       r.DayOfMonth,
				"next_date": d.Format("2006-01-02"),
			})
		}
	}
	nextState := "unknown"
	nextAttrs := map[string]any{"count": enabledCount}
	if len(recurringItems) > 0 {
		nextAttrs["items"] = recurringItems
	}
	if nextRec != nil {
		nextState = nextDate.Format("2006-01-02")
		nextAttrs["name"] = nextRec.Name
		nextAttrs["amount"] = yuan(nextRec.Amount)
		daysLeft := int(nextDate.Sub(today).Hours() / 24)
		if daysLeft < 0 {
			daysLeft = 0
		}
		nextAttrs["days_left"] = daysLeft
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
			"unique_id":           "hc_fin_net",
			"name":                "本月结余",
			"icon":                "mdi:scale-balance",
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
			"unique_id":           "hc_fin_budget_pct",
			"name":                "预算使用率",
			"icon":                "mdi:gauge",
			"unit_of_measurement": "%",
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
		{
			"type":                "sensor",
			"unique_id":           "hc_fin_recurring_count",
			"name":                "周期账单数",
			"icon":                "mdi:calendar-clock",
			"unit_of_measurement": "条",
			"state_class":         "measurement",
		},
		{
			"type":                "sensor",
			"unique_id":           "hc_fin_recurring_total",
			"name":                "周期账单总额",
			"icon":                "mdi:calendar-multiple",
			"unit_of_measurement": "元",
			"state_class":         "measurement",
		},
		{
			"type":      "sensor",
			"unique_id": "hc_fin_recurring_next",
			"name":      "下次周期账单",
			"icon":      "mdi:calendar-arrow-right",
		},
	}
	for _, sensor := range sensors {
		if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID,
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
				"type":       "sensor",
				"unique_id":  "hc_fin_net",
				"state":      yuan(st.Income - st.Expense),
				"icon":       "mdi:scale-balance",
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
				"type":      "sensor",
				"unique_id": "hc_fin_budget_pct",
				"state":     st.BudgetPct,
				"icon":      "mdi:gauge",
				"attributes": map[string]any{
					"month":        month,
					"budget_total": yuan(st.BudgetTotal),
					"budget_left":  yuan(st.BudgetLeft),
				},
			},
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_balance",
				"state":      yuan(st.Balance),
				"icon":       "mdi:bank",
				"attributes": map[string]any{"by_account": byAccount},
			},
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_recurring_count",
				"state":      enabledCount,
				"icon":       "mdi:calendar-clock",
				"attributes": map[string]any{"month": month, "items": recurringItems},
			},
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_recurring_total",
				"state":      yuan(recurringTotal),
				"icon":       "mdi:calendar-multiple",
				"attributes": map[string]any{"month": month, "count": enabledCount},
			},
			{
				"type":       "sensor",
				"unique_id":  "hc_fin_recurring_next",
				"state":      nextState,
				"icon":       "mdi:calendar-arrow-right",
				"attributes": nextAttrs,
			},
		},
	}
	if err := rest.PostJSON(ctx, "/api/webhook/"+webhookID, payload, nil); err != nil {
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

// nextRecurringDate 计算周期账单的下一次执行日期：
//   - 本月已执行（last_run_month=本月）→ 下月同一天；
//   - 本月未执行且日期已过 → 今天（等待补跑）；
//   - 否则 → 本月该天。
//
// 日期超出当月天数时回退到当月最后一天（与自动记账逻辑一致）。
func nextRecurringDate(day int, lastRun string, now time.Time) time.Time {
	if lastRun == now.Format("2006-01") {
		return dayInMonth(now.Year(), now.Month()+1, day, now.Location())
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	cur := dayInMonth(now.Year(), now.Month(), day, now.Location())
	if cur.Before(today) {
		return today
	}
	return cur
}

func dayInMonth(year int, month time.Month, day int, loc *time.Location) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, loc).Day()
	if day < 1 {
		day = 1
	}
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, loc)
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

// StartTicker 启动时先补跑周期账单并全量同步一次，之后每小时同步（兼作 HA 重启后的自愈兜底）。
func (h *FinanceSync) StartTicker(ctx context.Context) {
	_, _ = h.fin.RunRecurring(context.Background())
	h.SyncAll(context.Background())
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

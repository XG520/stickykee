package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/model"
	"stickykee/server/internal/store"
)

// Aggregate 提供场景/自动化/能耗/历史/日志等聚合接口。
type Aggregate struct {
	manager   *ha.Manager
	userPrefs *store.UserPrefs
}

// NewAggregate 构造 handler。
func NewAggregate(manager *ha.Manager, userPrefs *store.UserPrefs) *Aggregate {
	return &Aggregate{manager: manager, userPrefs: userPrefs}
}

// rest 解析实例 id 并确保可访问；失败返回 ok=false 且已写错误。
func (h *Aggregate) rest(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return 0, false
	}
	if _, err := h.manager.Rest(r.Context(), id); err != nil {
		haErr(w, err)
		return 0, false
	}
	return id, true
}

// Scenes GET /instances/{id}/scenes
func (h *Aggregate) Scenes(w http.ResponseWriter, r *http.Request) {
	id, ok := h.rest(w, r)
	if !ok {
		return
	}
	rst, _ := h.manager.Rest(r.Context(), id)
	scenes, err := rst.GetScenes(r.Context())
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, model.ParseDisplays(scenes), active)
}

// Automations GET /instances/{id}/automations
func (h *Aggregate) Automations(w http.ResponseWriter, r *http.Request) {
	id, ok := h.rest(w, r)
	if !ok {
		return
	}
	rst, _ := h.manager.Rest(r.Context(), id)
	autos, err := rst.GetAutomations(r.Context())
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, model.ParseDisplays(autos), active)
}

// AutomationTurn POST /instances/{id}/automations/{entityID}/turn_on|off
func (h *Aggregate) AutomationTurn(w http.ResponseWriter, r *http.Request) {
	id, ok := h.rest(w, r)
	if !ok {
		return
	}
	entityID := r.PathValue("entityID")
	action := r.PathValue("action")
	if entityID == "" || (action != "turn_on" && action != "turn_off") {
		WriteErr(w, 400, "bad_request", "invalid automation action")
		return
	}
	rst, _ := h.manager.Rest(r.Context(), id)
	if err := rst.CallService(r.Context(), "automation", action, entityID, nil); err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{"action": action, "entity_id": entityID}, active)
}

// History GET /instances/{id}/history?start=&end=&entity=
func (h *Aggregate) History(w http.ResponseWriter, r *http.Request) {
	id, ok := h.rest(w, r)
	if !ok {
		return
	}
	start := parseTime(r.URL.Query().Get("start"))
	if start.IsZero() {
		start = time.Now().Add(-24 * time.Hour)
	}
	end := parseTime(r.URL.Query().Get("end"))
	var entities []string
	if e := r.URL.Query().Get("entity"); e != "" {
		entities = []string{e}
	}
	rst, _ := h.manager.Rest(r.Context(), id)
	// 记账相关实体的历史属于账本数据：无查看权限时直接拒绝，未指定实体则事后过滤。
	blocked := h.financeBlockedIDs(r.Context(), id)
	if len(entities) > 0 {
		if _, hit := blocked[entities[0]]; hit {
			WriteErr(w, 403, "forbidden", "未获得记账模块授权，请联系管理员")
			return
		}
	}
	hist, err := rst.GetHistory(r.Context(), entities, start, end)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	if len(entities) == 0 && len(blocked) > 0 {
		hist = filterBlockedHistory(hist, blocked)
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, hist, active)
}

// Statistics GET /instances/{id}/statistics?start=&end=
// 走 HA WebSocket recorder/statistics_during_period（REST 无此端点）。
func (h *Aggregate) Statistics(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	start := parseTime(r.URL.Query().Get("start"))
	if start.IsZero() {
		start = time.Now().Add(-24 * time.Hour)
	}
	end := parseTime(r.URL.Query().Get("end"))
	if end.IsZero() {
		end = time.Now()
	}
	meta := r.URL.Query().Get("statistic_ids")
	if meta != "" {
		if _, hit := h.financeBlockedIDs(r.Context(), id)[meta]; hit {
			WriteErr(w, 403, "forbidden", "未获得记账模块授权，请联系管理员")
			return
		}
	}
	payload := map[string]any{
		"statistic_ids": []string{},
		"start_time":    start.Format(time.RFC3339),
		"end_time":      end.Format(time.RFC3339),
		"period":        r.URL.Query().Get("period"),
	}
	if meta != "" {
		payload["statistic_ids"] = []string{meta}
	}
	if payload["period"] == "" {
		payload["period"] = "hour"
	}
	raw, err := h.manager.CallCommand(r.Context(), id, "recorder/statistics_during_period", payload)
	if err != nil {
		if errors.Is(err, ha.ErrNoHAToken) {
			haErr(w, err)
			return
		}
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, raw, active)
}

// SumStatistics GET /instances/{id}/statistics/sum 拉取能耗总和（按 period 聚合）。
func (h *Aggregate) SumStatistics(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	start := parseTime(r.URL.Query().Get("start"))
	if start.IsZero() {
		start = time.Now().Add(-24 * time.Hour)
	}
	end := parseTime(r.URL.Query().Get("end"))
	if end.IsZero() {
		end = time.Now()
	}
	var ids []string
	if s := r.URL.Query().Get("statistic_ids"); s != "" {
		if _, hit := h.financeBlockedIDs(r.Context(), id)[s]; hit {
			WriteErr(w, 403, "forbidden", "未获得记账模块授权，请联系管理员")
			return
		}
		ids = []string{s}
	}
	raw, err := h.manager.CallCommand(r.Context(), id, "recorder/statistics_during_period", map[string]any{
		"statistic_ids": ids,
		"start_time":    start.Format(time.RFC3339),
		"end_time":      end.Format(time.RFC3339),
		"period":        "day",
	})
	if err != nil {
		if errors.Is(err, ha.ErrNoHAToken) {
			haErr(w, err)
			return
		}
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, raw, active)
}

// Logs GET /instances/{id}/logs?start=&limit=  拉取 logbook 日志（limit 默认 50，避免全量传输）。
func (h *Aggregate) Logs(w http.ResponseWriter, r *http.Request) {
	id, ok := h.rest(w, r)
	if !ok {
		return
	}
	start := parseTime(r.URL.Query().Get("start"))
	if start.IsZero() {
		start = time.Now().Add(-24 * time.Hour)
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	rst, _ := h.manager.Rest(r.Context(), id)
	logs, err := rst.GetLogbook(r.Context(), start)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
	}
	if len(logs) > limit {
		logs = logs[:limit]
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, logs, active)
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	if unix, err := strconv.ParseInt(s, 10, 64); err == nil {
		return time.Unix(unix, 0)
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

// financeBlockedIDs 返回当前用户无权访问的记账相关实体 ID 集合；
// 有查看权限（含管理员）时返回空集合。基于实例实时快照的显示名判定。
func (h *Aggregate) financeBlockedIDs(ctx context.Context, instanceID int64) map[string]struct{} {
	out := map[string]struct{}{}
	username, ok := auth.User(ctx)
	if !ok || ReadFinancePerm(ctx, h.userPrefs, username).Allows(false) {
		return out
	}
	states, err := h.manager.Snapshot(ctx, instanceID)
	if err != nil {
		return out
	}
	for _, s := range states {
		if IsFinanceEntityName(model.ParseDisplay(s).FriendlyName) {
			out[s.EntityID] = struct{}{}
		}
	}
	return out
}

// filterBlockedHistory 从 HA 历史响应中剔除被屏蔽实体的分组（未指定 entity 时的全量拉取）。
func filterBlockedHistory(raw []json.RawMessage, blocked map[string]struct{}) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(raw))
	for _, item := range raw {
		var rows []struct {
			EntityID string `json:"entity_id"`
		}
		if err := json.Unmarshal(item, &rows); err == nil && len(rows) > 0 {
			if _, hit := blocked[rows[0].EntityID]; hit {
				continue
			}
		}
		out = append(out, item)
	}
	return out
}

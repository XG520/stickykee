package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/model"
)

// Aggregate 提供场景/自动化/能耗/历史/日志等聚合接口。
type Aggregate struct {
	manager *ha.Manager
}

// NewAggregate 构造 handler。
func NewAggregate(manager *ha.Manager) *Aggregate { return &Aggregate{manager: manager} }

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
	hist, err := rst.GetHistory(r.Context(), entities, start, end)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", err.Error())
		return
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

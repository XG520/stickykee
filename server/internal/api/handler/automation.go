package handler

import (
	"net/http"
	"strings"

	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/client"
)

// Automation 提供自动化配置的创建/读取/更新/删除（对接 HA REST 配置接口），
// 与 aggregate.Automations（列表）和 AutomationTurn（开关）互补。
type Automation struct {
	manager *ha.Manager
}

// NewAutomation 构造 handler。
func NewAutomation(manager *ha.Manager) *Automation { return &Automation{manager: manager} }

// automationPayload 创建/更新自动化请求体（字段与 HA 自动化配置结构一致）。
type automationPayload struct {
	Alias       string `json:"alias"`
	Description string `json:"description,omitempty"`
	Trigger     []any  `json:"trigger"`
	Condition   []any  `json:"condition,omitempty"`
	Action      []any  `json:"action"`
	Mode        string `json:"mode,omitempty"`
}

// rest 校验实例并返回 REST 客户端；失败时已写错误响应。
func (h *Automation) rest(w http.ResponseWriter, r *http.Request) (*client.Rest, bool) {
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return nil, false
	}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		haErr(w, err)
		return nil, false
	}
	return rst, true
}

// automationID 由 entity_id（automation.xxx）提取配置定位 id。
func automationID(entityID string) string {
	return strings.TrimPrefix(entityID, "automation.")
}

// cfgErr 包装 HA 配置接口错误：401/403 是令牌权限不足（需管理员），给出可操作提示。
func cfgErr(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if strings.Contains(s, "401") || strings.Contains(s, "403") {
		return "HA 令牌无自动化管理权限：请在 HA「个人资料→安全→长期访问令牌」用管理员账号生成新令牌，或在 HA 权限中为该用户授权 config.automation 域"
	}
	return s
}

// validate 校验必填字段；trigger/action 需为非空数组。
func (p *automationPayload) validate() bool {
	if strings.TrimSpace(p.Alias) == "" || len(p.Trigger) == 0 || len(p.Action) == 0 {
		return false
	}
	return true
}

// Create POST /instances/{id}/automations 创建自动化。
func (h *Automation) Create(w http.ResponseWriter, r *http.Request) {
	rst, ok := h.rest(w, r)
	if !ok {
		return
	}
	var p automationPayload
	if err := DecodeBody(r, &p); err != nil || !p.validate() {
		WriteErr(w, 400, "bad_request", "alias/trigger/action required")
		return
	}
	cfg := map[string]any{
		"alias":       p.Alias,
		"description": p.Description,
		"trigger":     p.Trigger,
		"action":      p.Action,
		"mode":        orDefault(p.Mode, "single"),
	}
	if len(p.Condition) > 0 {
		cfg["condition"] = p.Condition
	}
	autoID, err := rst.CreateAutomation(r.Context(), cfg)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", cfgErr(err))
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 201, map[string]any{"automation_id": autoID, "entity_id": "automation." + autoID}, active)
}

// Config GET /instances/{id}/automations/{entityID}/config 读取自动化配置。
func (h *Automation) Config(w http.ResponseWriter, r *http.Request) {
	rst, ok := h.rest(w, r)
	if !ok {
		return
	}
	id := automationID(r.PathValue("entityID"))
	if id == "" {
		WriteErr(w, 400, "bad_request", "invalid entity id")
		return
	}
	cfg, err := rst.GetAutomationConfig(r.Context(), id)
	if err != nil {
		WriteErr(w, 502, "ha_unreachable", cfgErr(err))
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, cfg, active)
}

// Update PUT /instances/{id}/automations/{entityID} 更新自动化配置。
func (h *Automation) Update(w http.ResponseWriter, r *http.Request) {
	rst, ok := h.rest(w, r)
	if !ok {
		return
	}
	id := automationID(r.PathValue("entityID"))
	if id == "" {
		WriteErr(w, 400, "bad_request", "invalid entity id")
		return
	}
	var p automationPayload
	if err := DecodeBody(r, &p); err != nil || !p.validate() {
		WriteErr(w, 400, "bad_request", "alias/trigger/action required")
		return
	}
	cfg := map[string]any{
		"alias":       p.Alias,
		"description": p.Description,
		"trigger":     p.Trigger,
		"action":      p.Action,
		"mode":        orDefault(p.Mode, "single"),
	}
	if len(p.Condition) > 0 {
		cfg["condition"] = p.Condition
	}
	if err := rst.UpdateAutomation(r.Context(), id, cfg); err != nil {
		WriteErr(w, 502, "ha_unreachable", cfgErr(err))
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{"automation_id": id, "entity_id": "automation." + id}, active)
}

// Delete DELETE /instances/{id}/automations/{entityID} 删除自动化。
func (h *Automation) Delete(w http.ResponseWriter, r *http.Request) {
	rst, ok := h.rest(w, r)
	if !ok {
		return
	}
	id := automationID(r.PathValue("entityID"))
	if id == "" {
		WriteErr(w, 400, "bad_request", "invalid entity id")
		return
	}
	if err := rst.DeleteAutomation(r.Context(), id); err != nil {
		WriteErr(w, 502, "ha_unreachable", cfgErr(err))
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{"deleted": true, "entity_id": "automation." + id}, active)
}

// orDefault 返回 s；为空时返回 def。
func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

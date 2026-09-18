package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// Im 提供用户间消息与仪表盘共享。
// 会话/文本/共享均按登录用户隔离；接受/拒绝等动作强校验归属（仅接收方可执行）。
type Im struct {
	msgs      *store.MessageRepo
	userPrefs *store.UserPrefs
	users     *store.UserRepo
	hub       *hub.Hub
}

// NewIm 构造 handler。
func NewIm(msgs *store.MessageRepo, userPrefs *store.UserPrefs, users *store.UserRepo, hb *hub.Hub) *Im {
	return &Im{msgs: msgs, userPrefs: userPrefs, users: users, hub: hb}
}

// requireTarget 校验目标用户存在；不存在返回 404 并写错误响应。
func (h *Im) requireTarget(w http.ResponseWriter, r *http.Request, to string) bool {
	if _, err := h.users.GetByUsername(r.Context(), to); err != nil {
		WriteErr(w, 404, "not_found", "目标用户不存在")
		return false
	}
	return true
}

// notify 尽力通过实时通道通知某用户刷新消息角标/会话。
func (h *Im) notify(each string) {
	if each == "" || h.hub == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{"type": "im", "data": map[string]any{}})
	h.hub.BroadcastUser(each, payload)
}

// Contacts GET /messages/contacts  返回所有其他用户名（供任意登录用户发起会话）。
// 仅返回用户名，不含角色/map/HA 等敏感信息。路由须注册在 /{user} 之前。
func (h *Im) Contacts(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	list, err := h.users.List(r.Context())
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	names := make([]string, 0, len(list))
	for _, u := range list {
		if u.Username != me {
			names = append(names, u.Username)
		}
	}
	WriteJSON(w, 200, names)
}

// Conversations GET /messages/conversations
func (h *Im) Conversations(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	list, err := h.msgs.Conversations(r.Context(), me)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// History GET /messages/{user}
func (h *Im) History(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	other := chi.URLParam(r, "user")
	if other == "" {
		WriteErr(w, 400, "bad_request", "user required")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := h.msgs.History(r.Context(), me, other, limit)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// MarkRead POST /messages/{user}/read  把 other 发给我的消息全部标已读。
func (h *Im) MarkRead(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	other := chi.URLParam(r, "user")
	if other == "" {
		WriteErr(w, 400, "bad_request", "user required")
		return
	}
	if err := h.msgs.SetFromRead(r.Context(), me, other); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// SendText POST /messages/{user}  {content}
func (h *Im) SendText(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if strings.TrimSpace(body.Content) == "" {
		WriteErr(w, 400, "bad_request", "content required")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "text", body.Content, "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// SendDevice POST /messages/{user}/device  {device:{entity_id,name,icon,domain,device_class,...}}
// 发送一张设备卡片；接收方按 entity_id 匹配自身实体后实时显示状态并可直接控制（toggle）。
func (h *Im) SendDevice(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Device map[string]any `json:"device"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if body.Device == nil {
		WriteErr(w, 400, "bad_request", "device required")
		return
	}
	entityID, _ := body.Device["entity_id"].(string)
	if strings.TrimSpace(entityID) == "" {
		WriteErr(w, 400, "bad_request", "device.entity_id required")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	payload, err := json.Marshal(body.Device)
	if err != nil {
		WriteErr(w, 500, "internal", "serialize device failed")
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "device", string(payload), "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// SendShare POST /messages/{user}/share  {dashboard}
func (h *Im) SendShare(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Dashboard string `json:"dashboard"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if strings.TrimSpace(body.Dashboard) == "" {
		WriteErr(w, 400, "bad_request", "dashboard required")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "share", body.Dashboard, "pending")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id, "card_count": store.CardCount(body.Dashboard)})
}

// Accept POST /messages/{id}/accept   接收方同意：复制仪表盘并标记为已接受。
func (h *Im) Accept(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	msg, dashboard, err := h.msgs.GetFull(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	if msg.To != me {
		WriteErr(w, 403, "forbidden", "仅接收方可接受该共享")
		return
	}
	if msg.Type != "share" {
		WriteErr(w, 400, "bad_request", "not a share message")
		return
	}
	if msg.Status == "accepted" {
		WriteJSON(w, 200, map[string]any{"ok": true, "status": "accepted"})
		return
	}
	if err := h.userPrefs.Set(r.Context(), me, "dashboard", dashboard); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	if err := h.msgs.SetStatus(r.Context(), id, "accepted"); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(msg.From)
	WriteJSON(w, 200, map[string]any{"ok": true, "status": "accepted", "card_count": store.CardCount(dashboard)})
}

// Decline POST /messages/{id}/decline  接收方拒绝。
func (h *Im) Decline(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	msg, _, err := h.msgs.GetFull(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	if msg.To != me {
		WriteErr(w, 403, "forbidden", "仅接收方可拒绝该共享")
		return
	}
	if msg.Type != "share" {
		WriteErr(w, 400, "bad_request", "not a share message")
		return
	}
	if err := h.msgs.SetStatus(r.Context(), id, "declined"); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(msg.From)
	WriteJSON(w, 200, map[string]any{"ok": true, "status": "declined"})
}

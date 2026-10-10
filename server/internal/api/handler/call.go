package handler

import (
	"encoding/json"
	"net/http"

	"stickynuo/server/internal/call"
	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/store"
)

// Call 提供语音通话信令中继。所有请求按登录用户隔离，
// 并强校验房间成员关系，防止跨房间投递 SDP/ICE。
type Call struct {
	rooms *call.Manager
	hb    *hub.Hub
	users *store.UserRepo
}

// NewCall 构造通话 handler。
func NewCall(rooms *call.Manager, hb *hub.Hub, users *store.UserRepo) *Call {
	return &Call{rooms: rooms, hb: hb, users: users}
}

// push 经 WebSocket 向某用户投递通话事件（离线则丢弃：通话类消息不补发）。
func (h *Call) push(user string, v any) {
	if h.hb == nil {
		return
	}
	msg, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.hb.BroadcastUser(user, msg)
}

// Start POST /api/v1/call/start  {members:[...]}
// 发起人创建房间，服务端向全部被邀请成员推送 invite（群聊一次邀请多人）。
func (h *Call) Start(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Members []string `json:"members"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	seen := map[string]bool{}
	members := []string{}
	for _, u := range body.Members {
		if u == "" || u == me || seen[u] {
			continue
		}
		if _, err := h.users.GetByUsername(r.Context(), u); err != nil {
			WriteErr(w, 404, "not_found", "用户不存在："+u)
			return
		}
		seen[u] = true
		members = append(members, u)
	}
	if len(members) == 0 {
		WriteErr(w, 400, "bad_request", "至少选择一位通话成员")
		return
	}

	room := h.rooms.Create(me, members)
	all := room.Members()
	ev := map[string]any{
		"type": "call", "event": "invite",
		"room": room.ID, "from": me, "owner": me, "members": all,
	}
	for _, u := range members {
		h.push(u, ev)
	}
	WriteJSON(w, 200, map[string]any{"id": room.ID, "owner": me, "members": all})
}

// Signal POST /api/v1/call/signal  {room,to,data:{kind:offer|answer|ice,...}}
// 中继 WebRTC 信令：仅房间成员间可投递。
func (h *Call) Signal(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room string          `json:"room"`
		To   string          `json:"to"`
		Data json.RawMessage `json:"data"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if body.Room == "" || body.To == "" || len(body.Data) == 0 {
		WriteErr(w, 400, "bad_request", "room/to/data required")
		return
	}
	if !h.rooms.HasMember(body.Room, me) || !h.rooms.HasMember(body.Room, body.To) {
		WriteErr(w, 403, "forbidden", "不是房间成员")
		return
	}
	h.push(body.To, map[string]any{
		"type": "call", "event": "signal",
		"room": body.Room, "from": me, "data": body.Data,
	})
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// Join POST /api/v1/call/join  {room}  被邀请方接受并加入房间。
func (h *Call) Join(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room string `json:"room"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	room, ok := h.rooms.Get(body.Room)
	if !ok {
		WriteErr(w, 404, "not_found", "通话已结束")
		return
	}
	if !h.rooms.HasMember(body.Room, me) {
		WriteErr(w, 403, "forbidden", "你不在该通话中")
		return
	}
	others := room.Members()
	h.push(room.Owner, map[string]any{
		"type": "call", "event": "joined",
		"room": room.ID, "user": me, "members": others,
	})
	WriteJSON(w, 200, map[string]any{"id": room.ID, "owner": room.Owner, "members": others})
}

// Leave POST /api/v1/call/leave  {room}  挂断；owner 离开则解散房间。
func (h *Call) Leave(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room string `json:"room"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	remain, ended := h.rooms.Leave(body.Room, me)
	for _, u := range remain {
		h.push(u, map[string]any{
			"type": "call", "event": "left",
			"room": body.Room, "user": me, "ended": ended,
		})
	}
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// Reject POST /api/v1/call/reject  {room}  拒接：仅通知发起人，不打扰其他成员。
func (h *Call) Reject(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room string `json:"room"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	room, ok := h.rooms.Get(body.Room)
	if !ok {
		WriteErr(w, 404, "not_found", "通话已结束")
		return
	}
	h.push(room.Owner, map[string]any{
		"type": "call", "event": "reject",
		"room": room.ID, "from": me,
	})
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

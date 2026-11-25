package handler

import (
	"encoding/json"
	"net/http"

	"stickykee/server/internal/call"
	"stickykee/server/internal/hub"
	"stickykee/server/internal/store"
)

// Call 提供语音通话信令中继。所有请求按登录用户隔离，
// 并强校验房间成员关系，防止跨房间投递 SDP/ICE。
//
// 多端语义：同一账号可在手机/Web/PC 多设备同时在线（hub.BroadcastUser
// 会推给该用户全部设备）。join/reject/leave 事件携带发起设备的 device id，
// 前端据此忽略"本设备自己触发的动作"，并让同账号其它设备停止振铃/退出通话。
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
// 响应附带 offline 列表：被邀请人当前无在线设备，前端可提示"对方不在线"。
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
	offline := []string{}
	ev := map[string]any{
		"type": "call", "event": "invite",
		"room": room.ID, "from": me, "owner": me, "members": all,
	}
	for _, u := range members {
		h.push(u, ev)
		if !h.hb.IsUserOnline(u) {
			offline = append(offline, u)
		}
	}
	WriteJSON(w, 200, map[string]any{"id": room.ID, "owner": me, "members": all, "offline": offline})
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

// Join POST /api/v1/call/join  {room, device}  被邀请方接受并加入房间。
// 除通知发起人外，同时回推给本人（含其它设备）：其它端收到 user==me 且
// device!=本机时停止振铃并提示"已在其他设备接听"。
func (h *Call) Join(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room   string `json:"room"`
		Device string `json:"device"`
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
	h.rooms.Join(body.Room, me, body.Device)
	others := room.Members()
	ev := map[string]any{
		"type": "call", "event": "joined",
		"room": room.ID, "user": me, "device": body.Device, "members": others,
	}
	// 通知全部其余成员（含发起人）与本人其它设备
	for _, u := range others {
		if u == me {
			continue
		}
		h.push(u, ev)
	}
	h.push(me, ev)
	WriteJSON(w, 200, map[string]any{"id": room.ID, "owner": room.Owner, "members": others})
}

// Leave POST /api/v1/call/leave  {room, device}  挂断；owner 离开则解散房间。
// 事件同时回推给离开者本人：其其它设备（可能仍在振铃/通话）据此退出并提示
// "已在其他设备挂断"；其余成员收到 left{ended} 区分普通退出与整通话结束。
func (h *Call) Leave(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room   string `json:"room"`
		Device string `json:"device"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	remain, ended := h.rooms.Leave(body.Room, me)
	for _, u := range remain {
		h.push(u, map[string]any{
			"type": "call", "event": "left",
			"room": body.Room, "user": me, "device": body.Device, "ended": ended,
		})
	}
	// 本人其它设备：同样推送（本机前端按 device 匹配自行忽略）
	h.push(me, map[string]any{
		"type": "call", "event": "left",
		"room": body.Room, "user": me, "device": body.Device, "ended": ended,
	})
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// Reject POST /api/v1/call/reject  {room, device}  拒接。
// 通知发起人（reject 事件）；同时回推本人其它设备停止振铃，
// 提示"已在其他设备拒绝"。若拒接后房间只剩发起人，房间解散。
func (h *Call) Reject(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	var body struct {
		Room   string `json:"room"`
		Device string `json:"device"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	owner, ok := h.rooms.Reject(body.Room, me)
	if !ok {
		WriteErr(w, 404, "not_found", "通话已结束")
		return
	}
	ev := map[string]any{
		"type": "call", "event": "reject",
		"room": body.Room, "from": me, "device": body.Device,
	}
	if owner != "" {
		h.push(owner, ev)
	}
	h.push(me, ev)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

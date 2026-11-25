package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/call"
	"stickykee/server/internal/ha"
	"stickykee/server/internal/ha/model"

	"github.com/gorilla/websocket"
)

const (
	wsWriteWait  = 10 * time.Second // 单帧写入允许耗时
	wsPingPeriod = 50 * time.Second // 服务端主动 ping 间隔（须小于读超时）
	wsPongWait   = 90 * time.Second // 等待客户端任何帧（含 pong）的超时
)

// upgrader 前端 WS 升级器。
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// 允许所有来源（前端可能是 Capacitor / 任意域名）。
	CheckOrigin: func(*http.Request) bool { return true },
}

// WS 处理前端 WebSocket：注册到 Hub，并把实例实时状态广播扇出给当前连接。
type WS struct {
	manager      *ha.Manager
	log          *slog.Logger
	authenticate func(token string) (auth.Identity, bool) // 校验会话 token，返回身份
	audio        func(user string, frame []byte)          // 通话语音二进制帧路由（可为 nil）
	callRooms    *call.Manager // 通话房间表，连接时补发振铃/通话状态（可为 nil）
}

// NewWS 构造 WS handler。audio 用于把客户端上行语音帧交给 call.Manager 中继；
// callRooms 用于连接时补发本用户通话房间状态（后台端重连接后仍振铃）。
func NewWS(manager *ha.Manager, log *slog.Logger, authenticate func(token string) (auth.Identity, bool),
	audio func(user string, frame []byte), callRooms *call.Manager) *WS {
	if log == nil {
		log = slog.Default()
	}
	return &WS{manager: manager, log: log, authenticate: authenticate, audio: audio, callRooms: callRooms}
}

// ServeHTTP GET /api/v1/ws?instance={id}&token={token}
func (h *WS) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 浏览器无法为 WebSocket 设置 Header，改从 query 读取会话 token 并校验。
	ident, ok := h.authenticate(r.URL.Query().Get("token"))
	if r.URL.Query().Get("token") == "" || !ok || ident.Username == "" {
		http.Error(w, `{"error":{"code":"unauthorized","message":"missing or invalid token"}}`, http.StatusUnauthorized)
		return
	}
	// 解析实例（查询参数 → 负数用 active）。
	var instanceID int64
	if q := r.URL.Query().Get("instance"); q != "" {
		parsed, err := strconv.ParseInt(q, 10, 64)
		if err != nil {
			WriteErr(w, 400, "bad_request", "invalid instance id")
			return
		}
		instanceID = parsed
	}
	active, err := h.manager.ActiveID(r.Context())
	if err != nil && instanceID <= 0 {
		WriteErr(w, 400, "no_instance", "no configured instance")
		return
	}
	if instanceID <= 0 {
		instanceID = active
	}

	// 后端 HA 连接按 (instance, user) 隔离：把已认证身份写入 ctx，
	// 供 manager.Live/Rest 解析该用户的个人 HA token（无 token 即禁用）。
	ctx := auth.WithIdentity(r.Context(), ident)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("ws upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	// 确保该用户的实例实时连接在运行，然后注册到 Hub。
	// 未配置个人 HA token 时 Live 返回 ErrNoHAToken：连接不关闭，降级为「仅控制通道」
	// （注册到 Hub 但不推送实体快照）——该端仍需在线接收 reload/instances 等广播，
	// 以便其它端配置好 token 后本端能被通知并重建数据通道（否则只能杀进程重进）。
	store, liveErr := h.manager.Live(ctx, instanceID)
	client := h.manager.Hub().Register(instanceID, ident.Username, r.URL.Query().Get("device"))
	defer h.manager.Hub().Unregister(instanceID, ident.Username, client)
	if liveErr != nil {
		h.log.Info("frontend ws degraded (no live)", "instance", instanceID, "err", liveErr)
	}

	// 首次连接即推送当前全量快照（统一为 DisplayEntity 富结构，与 REST /entities 一致）。
	// seq 为增量流当前序号：客户端据此判断之后的推送是否漏帧（漏则回退一次 REST 全量）。
	if store != nil {
		if snap := model.ParseDisplays(store.Snapshot()); len(snap) > 0 {
			if b, merr := json.Marshal(map[string]any{"type": "state", "seq": h.manager.Seq(ctx, instanceID), "data": snap}); merr == nil {
				_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if werr := conn.WriteMessage(websocket.TextMessage, b); werr != nil {
					conn.Close()
					return
				}
			}
		}
	}

	// 通话状态补发：通话事件按推送「离线即丢弃、不补发」，后台端（Doze 掐网络 /
	// 原生保活心跳重建 WS）时实时 invite 即永久丢失——该端 never 响铃，通话中端
	// 也不恢复语音。连接时按本用户房间状态补发 resumed（仅本连接，其它在线设备
	// 已持有实时状态）：joined=false 仍在振铃等待中，joined=true 已接听。
	if h.callRooms != nil {
		for _, ev := range h.callRooms.PendingFor(ident.Username) {
			if b, merr := json.Marshal(ev); merr == nil {
				_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if werr := conn.WriteMessage(websocket.TextMessage, b); werr != nil {
					conn.Close()
					return
				}
			}
		}
	}

	h.log.Info("frontend ws connected", "instance", instanceID, "remote", r.RemoteAddr)

	// 写循环：转发 Hub 广播；每帧写入前续期写超时，并定时发 ping 保活。
	// 截止时间必须逐帧刷新——一次性绝对超时会导致连接仍在、但 60s 后所有推送静默失败。
	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		ticker := time.NewTicker(wsPingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-client.Closed():
				return
			case msg := <-client.SendChan():
				_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(msg.Typ, msg.Data); err != nil {
					return
				}
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// 读循环：任何客户端帧（含 pong）都续期读超时；超时即判定断线，交由前端重连。
	_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	for {
		msgType, raw, err := conn.ReadMessage()
		if err != nil {
			// 读错误触发关闭（包括客户端离开 / 心跳超时）。
			break
		}
		_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
		// 通话语音二进制帧：交给 call.Manager 按房间中继（8080 媒体中继）。
		if msgType == websocket.BinaryMessage {
			if h.audio != nil {
				h.audio(ident.Username, raw)
			}
			continue
		}
		// 应用层心跳：前端发 JSON {"type":"ping"} 维持 TCP 活跃流量
		// （WebSocket 控制帧 ping/pong 不计入运营商 NAT 空闲判定），
		// 后端回 JSON {"type":"pong"} 让前端及时探测到连接存活。
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &probe); err == nil && probe.Type == "ping" {
			// pong 回复也必须经写通道扇出——gorilla/websocket 禁止并发 WriteMessage；
			// 直接 writeJSON 会与写协程的 hub 广播 / ping 并发，触发 panic。
			if b, merr := json.Marshal(map[string]any{"type": "pong"}); merr == nil {
				client.Send(b)
			}
		}
	}
	<-writeDone
}

func writeJSON(conn *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, b)
}

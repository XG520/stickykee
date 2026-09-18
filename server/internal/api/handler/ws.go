package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/model"

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
}

// NewWS 构造 WS handler。
func NewWS(manager *ha.Manager, log *slog.Logger, authenticate func(token string) (auth.Identity, bool)) *WS {
	if log == nil {
		log = slog.Default()
	}
	return &WS{manager: manager, log: log, authenticate: authenticate}
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
	store, err := h.manager.Live(ctx, instanceID)
	if err != nil {
		_ = writeJSON(conn, map[string]any{"type": "error", "message": err.Error()})
		return
	}
	client := h.manager.Hub().Register(instanceID, ident.Username, r.URL.Query().Get("device"))
	defer h.manager.Hub().Unregister(instanceID, ident.Username, client)

	// 首次连接即推送当前全量快照（统一为 DisplayEntity 富结构，与 REST /entities 一致）。
	if snap := model.ParseDisplays(store.Snapshot()); len(snap) > 0 {
		if b, merr := json.Marshal(map[string]any{"type": "state", "data": snap}); merr == nil {
			_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if werr := conn.WriteMessage(websocket.TextMessage, b); werr != nil {
				conn.Close()
				return
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
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
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
		if _, _, err := conn.ReadMessage(); err != nil {
			// 读错误触发关闭（包括客户端离开 / 心跳超时）。
			break
		}
		_ = conn.SetReadDeadline(time.Now().Add(wsPongWait))
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

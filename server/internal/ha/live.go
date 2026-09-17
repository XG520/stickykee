package ha

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"homecanvas/server/internal/ha/model"

	"github.com/gorilla/websocket"
)

// RTConfig 实时连接配置。
type RTConfig struct {
	InstanceID    int64
	BaseURL       string // 例如 http://host:8123
	Token         string
	SkipTLSVerify bool // 信任自签名证书（本地 HA 常用）
}

// Realtime 保持一条到 HA 的 WebSocket 连接：认证、全量拉取、
// 订阅 state_changed、维护 StateStore、断线指数退避重连。
type Realtime struct {
	cfg     RTConfig
	store   *StateStore
	conn    *websocket.Conn
	mu      sync.Mutex
	nextID  atomic.Uint64
	pending map[uint64]chan *wsMessage
	log     *slog.Logger
	writeMu sync.Mutex // gorilla 要求写串行化；命令写与心跳 ping 共用同一连接
}

// 心跳保活参数：每 keepAlive 间隔发送一次 ping；若 readStale 内没有任何消息
// （含 HA 应答的 pong）则判定连接停滞并重连。readStale 必须明显大于 keepAlive。
const (
	keepAlive = 25 * time.Second
	readStale = 90 * time.Second
	// connectOp 启动握手命令（get_states / subscribe_events）的超时。若在此窗口内
	// HA 认证后一直沉默（连接僵尸/半开），必须终止 run 触发重连，否则 run 会无限阻塞、
	// 后续所有 WS 命令持续超时而连接却永不重建。
	connectOp = 30 * time.Second
)

// wsMessage HA WS 消息的通用结构。
type wsMessage struct {
	ID      uint64          `json:"id,omitempty"`
	Type    string          `json:"type"`
	Success *bool           `json:"success,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
	Event map[string]any `json:"event,omitempty"`
}

// NewRealtime 构造实时连接（惰性，由 Start 发起）。
func NewRealtime(cfg RTConfig, store *StateStore, log *slog.Logger) *Realtime {
	return &Realtime{cfg: cfg, store: store, pending: map[uint64]chan *wsMessage{}, log: log}
}

// Start 阻塞式启动连接循环，直到 ctx 取消。
func (r *Realtime) Start(ctx context.Context) {
	backoff := 2 * time.Second
	for {
		if err := r.run(ctx); err != nil && ctx.Err() == nil {
			r.log.Warn("ha ws disconnected", "instance", r.cfg.InstanceID, "err", err)
		}
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
			if backoff < 10*time.Second {
				backoff *= 2
			}
		}
	}
}

// run 单次连接的完整生命周期。
func (r *Realtime) run(ctx context.Context) error {
	wsURL := r.wsURL()
	dialer := websocket.DefaultDialer
	dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: r.cfg.SkipTLSVerify} // #nosec G402: 本地 HA 自签名
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	r.mu.Lock()
	if r.conn != nil {
		_ = r.conn.Close()
	}
	r.conn = conn
	r.mu.Unlock()
	r.log.Info("ha ws connected", "instance", r.cfg.InstanceID, "url", wsURL)
	defer func() { _ = conn.Close() }()

	// 认证握手
	var authMsg wsMessage
	if err := conn.ReadJSON(&authMsg); err != nil {
		return err
	}
	if authMsg.Type != "auth_required" {
		return fmt.Errorf("unexpected handshake: %s", authMsg.Type)
	}
	if err := conn.WriteJSON(map[string]any{"type": "auth", "access_token": r.cfg.Token}); err != nil {
		return err
	}
	var authRes wsMessage
	if err := conn.ReadJSON(&authRes); err != nil {
		return err
	}
	if authRes.Type != "auth_ok" {
		return errors.New("ha auth failed")
	}

	// 启动独立读取 goroutine：负责读取并路由所有入站消息（命令响应按 id 投递、
	// 状态事件写入快照）。必须先于任何需要响应的命令启动，否则命令会因无人读取而死等。
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		for {
			// 心跳读超时：若长期读不到任何消息（含 pong）则判定连接停滞并触发重连。
			if err := conn.SetReadDeadline(time.Now().Add(readStale)); err != nil {
				return
			}
			msg := &wsMessage{}
			if err := conn.ReadJSON(msg); err != nil {
				if r.log != nil {
					r.log.Error("ha read error", "instance", r.cfg.InstanceID, "err", err)
				}
				return
			}
			if msg.ID != 0 && msg.Type == "result" {
				r.resolve(msg)
			} else if msg.Type == "event" {
				r.handleEvent(msg.Event)
			}
		}
	}()

	// 全量拉取并写入快照（由上方读取 goroutine 投递响应）。每个握手命令都有硬超时，
	// 防止 HA 认证后沉默的僵尸连接把 run 卡死在这里（进而让后续所有 WS 命令超时）。
	opCtx, opCancel := context.WithTimeout(ctx, connectOp)
	statesRes, err := r.call(opCtx, "get_states", nil)
	opCancel()
	if err != nil {
		return fmt.Errorf("get_states: %w", err)
	}
	if err := applyRawStates(r.store, statesRes.Result); err != nil {
		return fmt.Errorf("apply states: %w", err)
	}
	// 订阅状态变更
	opCtx2, opCancel2 := context.WithTimeout(ctx, connectOp)
	_, err = r.call(opCtx2, "subscribe_events", map[string]any{"event_type": "state_changed"})
	opCancel2()
	if err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	// 心跳保活：周期性发送 ping，HA 应答 pong，维持读取超时判定所需的流量。
	keepAliveCtx, stopKeepAlive := context.WithCancel(ctx)
	defer stopKeepAlive()
	go r.keepAlive(keepAliveCtx, conn)

	// 等待连接结束：ctx 取消（服务关闭）或读取 goroutine 因错误退出（触发重连）。
	select {
	case <-ctx.Done():
		return nil
	case <-readerDone:
		return errors.New("ha reader stopped")
	}
}

// keepAlive 周期性发送 ping 保活；连接关闭时退出。
func (r *Realtime) keepAlive(ctx context.Context, conn *websocket.Conn) {
	t := time.NewTicker(keepAlive)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.writeMu.Lock()
			_ = conn.WriteJSON(map[string]any{"type": "ping"})
			r.writeMu.Unlock()
		}
	}
}

// call 发送命令并等待结果。
func (r *Realtime) call(ctx context.Context, typ string, payload map[string]any) (*wsMessage, error) {
	id := r.nextID.Add(1)
	var body map[string]any
	if payload != nil {
		body = payload
	} else {
		body = map[string]any{}
	}
	body["type"] = typ
	body["id"] = id

	ch := make(chan *wsMessage, 1)
	r.mu.Lock()
	r.pending[id] = ch
	conn := r.conn
	r.mu.Unlock()
	if conn == nil {
		delete(r.pending, id)
		return nil, errors.New("ha not connected")
	}
	r.writeMu.Lock()
	err := conn.WriteJSON(body)
	r.writeMu.Unlock()
	if err != nil {
		delete(r.pending, id)
		if r.log != nil {
			r.log.Error("ha ws write failed", "instance", r.cfg.InstanceID, "type", typ, "id", id, "err", err)
		}
		return nil, err
	}
	select {
	case <-ctx.Done():
		// 命令在超时内无响应 → 连接疑似停滞/半开。主动关闭底层连接，
		// 让重连循环（Start）尽快建立新连接，而非让后续命令继续困在旧连接上。
		if r.log != nil {
			r.log.Warn("ha command timed out", "instance", r.cfg.InstanceID, "type", typ, "id", id)
		}
		r.mu.Lock()
		if r.conn == conn {
			_ = conn.Close()
		}
		r.mu.Unlock()
		delete(r.pending, id)
		return nil, ctx.Err()
	case res := <-ch:
		if res.Success != nil && !*res.Success {
			if r.log != nil {
				r.log.Warn("ha command failed", "instance", r.cfg.InstanceID, "type", typ, "id", id, "err", res.ErrorCode())
			}
			return res, errors.New(res.ErrorCode())
		}
		return res, nil
	}
}

// Call 对当前实例连接发送任意 HA WS 命令并返回 JSON 结果（如 recorder/statistics_during_period）。
func (r *Realtime) Call(ctx context.Context, typ string, payload map[string]any) ([]byte, error) {
	res, err := r.call(ctx, typ, payload)
	if err != nil {
		return nil, err
	}
	return res.Result, nil
}

// resolve 完成等待中的调用。
func (r *Realtime) resolve(m *wsMessage) {
	r.mu.Lock()
	ch, ok := r.pending[m.ID]
	if ok {
		delete(r.pending, m.ID)
	}
	r.mu.Unlock()
	if ok {
		ch <- m
	}
}

func (m *wsMessage) ErrorCode() string {
	if m.Error != nil {
		return m.Error.Code + ": " + m.Error.Message
	}
	return "ha command failed"
}

// handleEvent 处理收到的 HA 事件。
func (r *Realtime) handleEvent(ev map[string]any) {
	eventType, _ := ev["event_type"].(string)
	data, _ := ev["data"].(map[string]any)
	if eventType == "state_changed" && data != nil {
		if entityID, _ := data["entity_id"].(string); entityID != "" {
			if newState := asState(data["new_state"]); newState != nil {
				r.store.Apply(*newState)
			}
		}
	}
}

// wsURL 从 baseURL 推导 WS 地址。
func (r *Realtime) wsURL() string {
	u, err := url.Parse(r.cfg.BaseURL)
	if err != nil {
		return r.cfg.BaseURL
	}
	scheme := "ws"
	if u.Scheme == "https" {
		scheme = "wss"
	}
	return scheme + "://" + u.Host + "/api/websocket"
}

// applyRawStates 解析 get_states 的结果并替换快照。
func applyRawStates(store *StateStore, raw json.RawMessage) error {
	var all []model.EntityState
	if err := json.Unmarshal(raw, &all); err != nil {
		return err
	}
	store.Replace(all)
	return nil
}

// asState 把一个 map 化的 new_state 解析为实体状态。
func asState(v any) *model.EntityState {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var e model.EntityState
	if err := json.Unmarshal(b, &e); err != nil {
		return nil
	}
	return &e
}

// Package hub 管理前端 WebSocket 连接，并把按用户隔离的实例级实时事件扇出给订阅者。
package hub

import (
	"log/slog"
	"sync"
)

// Scope 标识一条 HA 连接的作用域：同一 (instance, user) 的前端连接共享该 HA 连接，
// 其状态广播与命令路由仅在作用域内扇出，实现按个人 token 的权限隔离。
type Scope struct {
	Instance int64
	User     string
}

// Hub 是前端 WS 连接注册中心与广播器。
type Hub struct {
	mu    sync.RWMutex
	byIns map[Scope]map[uint64]*Client
	dev   map[Scope]map[string]*Client // 按设备 id 索引，用于 HA→浏览器命令按设备定向路由
	seq   uint64
	log   *slog.Logger
}

// New 构造 Hub。
func New(log *slog.Logger) *Hub {
	return &Hub{byIns: map[Scope]map[uint64]*Client{}, dev: map[Scope]map[string]*Client{}, log: log}
}

// Client 表示一条已连接的前端 WS。
type Client struct {
	ID       uint64
	DeviceID string // 浏览器持久设备唯一标识（来自 query device）
	User     string // 已登录用户名
	hub      *Hub
	send     chan []byte // 写缓冲
	close    chan struct{}
}

// Register 把新连接注册到某实例的某用户作用域，返回 *Client。deviceID 非空时登记到设备索引，
// 供 Browser_mod 风格命令按设备定向路由。
func (h *Hub) Register(instanceID int64, user, deviceID string) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	c := &Client{
		ID:       h.seq,
		User:     user,
		DeviceID: deviceID,
		hub:      h,
		send:     make(chan []byte, 256),
		close:    make(chan struct{}),
	}
	scope := Scope{Instance: instanceID, User: user}
	if h.byIns[scope] == nil {
		h.byIns[scope] = map[uint64]*Client{}
	}
	h.byIns[scope][c.ID] = c
	if deviceID != "" {
		if h.dev[scope] == nil {
			h.dev[scope] = map[string]*Client{}
		}
		h.dev[scope][deviceID] = c
	}
	return c
}

// Unregister 注销连接并关闭其写通道。
func (h *Hub) Unregister(instanceID int64, user string, c *Client) {
	h.mu.Lock()
	scope := Scope{Instance: instanceID, User: user}
	if m := h.byIns[scope]; m != nil {
		if _, ok := m[c.ID]; ok {
			delete(m, c.ID)
		}
		if len(m) == 0 {
			delete(h.byIns, scope)
		}
	}
	if c.DeviceID != "" {
		if d := h.dev[scope]; d != nil {
			if cur, ok := d[c.DeviceID]; ok && cur.ID == c.ID {
				delete(d, c.DeviceID)
			}
			if len(d) == 0 {
				delete(h.dev, scope)
			}
		}
	}
	h.mu.Unlock()
	select {
	case <-c.close:
	default:
		close(c.close)
	}
}

// Send 向单个连接发送消息（非阻塞，缓冲满则丢弃该连接）。
func (c *Client) Send(msg []byte) {
	select {
	case <-c.close:
	case c.send <- msg:
	default:
		// 缓冲区满：丢弃
	}
}

// SendChan 返回连接给写循环用的通道只读视图。
func (c *Client) SendChan() <-chan []byte { return c.send }

// Closed 返回连接是否已关闭。
func (c *Client) Closed() <-chan struct{} { return c.close }

// Broadcast 向某实例某用户作用域内的全部前端连接广播消息。
func (h *Hub) Broadcast(scope Scope, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.byIns[scope] {
		c.Send(msg)
	}
}

// SendToDevice 仅向某作用域中指定设备的前端连接发送消息（Browser_mod 风格定向命令）。
// 未找到该设备则静默丢弃。
func (h *Hub) SendToDevice(scope Scope, deviceID string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if c, ok := h.dev[scope][deviceID]; ok {
		c.Send(msg)
	}
}

// BroadcastUser 向指定用户的全部前端连接广播消息（与实例作用域无关，用于用户间 IM）。
func (h *Hub) BroadcastUser(user string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for scope, m := range h.byIns {
		if scope.User != user {
			continue
		}
		for _, c := range m {
			c.Send(msg)
		}
	}
}

// Count 返回某实例的用户作用域内的连接数。
func (h *Hub) Count(instanceID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	n := 0
	for scope, m := range h.byIns {
		if scope.Instance == instanceID {
			n += len(m)
		}
	}
	return n
}

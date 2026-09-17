// Package hub 管理前端 WebSocket 连接，并把实例级实时事件扇出给订阅者。
package hub

import (
	"log/slog"
	"sync"
)

// Hub 是前端 WS 连接注册中心与广播器。
type Hub struct {
	mu    sync.RWMutex
	byIns map[int64]map[uint64]*Client
	seq   uint64
	log   *slog.Logger
}

// New 构造 Hub。
func New(log *slog.Logger) *Hub {
	return &Hub{byIns: map[int64]map[uint64]*Client{}, log: log}
}

// Client 表示一条已连接的前端 WS。
type Client struct {
	ID    uint64
	hub   *Hub
	send  chan []byte // 写缓冲
	close chan struct{}
}

// Register 把新连接注册到某实例，返回 *Client。
func (h *Hub) Register(instanceID int64) *Client {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	c := &Client{
		ID:    h.seq,
		hub:   h,
		send:  make(chan []byte, 256),
		close: make(chan struct{}),
	}
	if h.byIns[instanceID] == nil {
		h.byIns[instanceID] = map[uint64]*Client{}
	}
	h.byIns[instanceID][c.ID] = c
	return c
}

// Unregister 注销连接并关闭其写通道。
func (h *Hub) Unregister(instanceID int64, c *Client) {
	h.mu.Lock()
	if m := h.byIns[instanceID]; m != nil {
		if _, ok := m[c.ID]; ok {
			delete(m, c.ID)
		}
		if len(m) == 0 {
			delete(h.byIns, instanceID)
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

// Broadcast 向某实例的全部前端连接广播消息。
func (h *Hub) Broadcast(instanceID int64, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.byIns[instanceID] {
		c.Send(msg)
	}
}

// Count 返回某实例的连接数。
func (h *Hub) Count(instanceID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.byIns[instanceID])
}
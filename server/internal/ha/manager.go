// Package ha 管理 homecanvas 与多个 Home Assistant 实例的连接。
package ha

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"

	"homecanvas/server/internal/ha/client"
	"homecanvas/server/internal/ha/model"
	"homecanvas/server/internal/hub"
	"homecanvas/server/internal/store"
)

// runtime 单个实例的实时运行态。
type runtime struct {
	store  *StateStore
	rt     *Realtime
	cancel context.CancelFunc
}

// Manager 管理多个 HA 实例：active 解析、REST 缓存、实时连接与扇出。
type Manager struct {
	repo        *store.InstanceRepo
	hub         *hub.Hub
	log         *slog.Logger
	tlsInsecure bool // 信任自签名证书（本地 HA 常用）
	mu          sync.RWMutex
	clients     map[int64]*client.Rest
	runtimes    map[int64]*runtime
	seedRT      map[int64]bool // 已注册 store.onChange 标记（幂等）
}

// NewManager 构造管理器。
func NewManager(repo *store.InstanceRepo, h *hub.Hub, log *slog.Logger, tlsInsecure bool) *Manager {
	return &Manager{
		repo:        repo,
		hub:         h,
		log:         log,
		tlsInsecure: tlsInsecure,
		clients:     map[int64]*client.Rest{},
		runtimes:    map[int64]*runtime{},
		seedRT:      map[int64]bool{},
	}
}

// errNoInstance 未配置任何实例。
var errNoInstance = errors.New("no configured home assistant instance")

// resolve 解析实例；id<=0 时用 active 实例。
func (m *Manager) resolve(ctx context.Context, id int64) (store.Instance, error) {
	if id <= 0 {
		return m.repo.GetActiveInstance(ctx)
	}
	return m.repo.Get(ctx, id)
}

// Rest 返回实例的 REST 客户端（懒创建并缓存）。
func (m *Manager) Rest(ctx context.Context, id int64) (*client.Rest, error) {
	i, err := m.resolve(ctx, id)
	if err != nil {
		return nil, errNoInstance
	}
	skipTLS := i.SkipTLS || m.tlsInsecure // 每实例开关优先，全局环境变量兜底
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.clients[i.ID]; ok {
		return r, nil
	}
	r := client.NewRest(i.URL, i.Token, skipTLS)
	m.clients[i.ID] = r
	return r, nil
}

// Live 获取实例的实时状态缓存；必要时启动其 HA WebSocket 连接。
func (m *Manager) Live(ctx context.Context, id int64) (*StateStore, error) {
	i, err := m.resolve(ctx, id)
	if err != nil {
		return nil, errNoInstance
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if rt, ok := m.runtimes[i.ID]; ok {
		return rt.store, nil
	}
	store := NewStateStore()
	ctxLive, cancel := context.WithCancel(context.Background())
	rt := NewRealtime(RTConfig{
		InstanceID:    i.ID,
		BaseURL:       i.URL,
		Token:         i.Token,
		SkipTLSVerify: i.SkipTLS || m.tlsInsecure, // 每实例开关优先，全局环境变量兜底
	}, store, m.log)
	if !m.seedRT[i.ID] {
		ib := i.ID
		store.SetOnChange(func(entityID string) {
			m.pushEntityToLive(ib, entityID)
		})
		m.seedRT[ib] = true
	}
	go rt.Start(ctxLive)
	m.runtimes[i.ID] = &runtime{store: store, rt: rt, cancel: cancel}
	m.log.Info("ha live started", "instance", i.ID)
	return store, nil
}

// pushEntityToLive 把单个变化实体（DisplayEntity 富结构）增量广播给前端订阅者。
// 只推变化项：避免每次状态变化都序列化全量快照（实体多时单帧很大且引发前端全量替换）。
func (m *Manager) pushEntityToLive(instanceID int64, entityID string) {
	m.mu.RLock()
	rt := m.runtimes[instanceID]
	m.mu.RUnlock()
	if rt == nil {
		return
	}
	raw, ok := rt.store.Get(entityID)
	if !ok {
		return
	}
	b, err := json.Marshal(map[string]any{
		"type": "state",
		"data": []model.DisplayEntity{model.ParseDisplay(raw)},
	})
	if err != nil {
		return
	}
	m.hub.Broadcast(instanceID, b)
}

// Hub 返回全局前端连接中心。
func (m *Manager) Hub() *hub.Hub { return m.hub }

// Invalidate 使某实例的缓存失效并停止其实时连接（更新/删除后调用）。
func (m *Manager) Invalidate(id int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rt, ok := m.runtimes[id]; ok {
		rt.cancel()
		delete(m.runtimes, id)
		delete(m.seedRT, id)
	}
	delete(m.clients, id)
}

// StopAll 停止所有实时连接（优雅关闭用）。
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, rt := range m.runtimes {
		rt.cancel()
		delete(m.runtimes, id)
	}
}

// ActiveID 返回当前 active 实例 id。
func (m *Manager) ActiveID(ctx context.Context) (int64, error) {
	return m.repo.ActiveID(ctx)
}

// Snapshot 返回某实例的实时状态快照；若实时连接尚未同步则返回空。
func (m *Manager) Snapshot(ctx context.Context, id int64) ([]model.EntityState, error) {
	store, err := m.Live(ctx, id)
	if err != nil {
		return nil, err
	}
	return store.Snapshot(), nil
}

// CallCommand 对实例的 HA WS 连接发送一条命令并返回原始 JSON 结果。
// 用于基于 WebSocket 的统计/实体注册表等 REST 未暴露的能力。
func (m *Manager) CallCommand(ctx context.Context, id int64, typ string, payload map[string]any) ([]byte, error) {
	_, err := m.Live(ctx, id)
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	rt := m.runtimes[id]
	m.mu.RUnlock()
	if rt == nil {
		return nil, errNoInstance
	}
	return rt.rt.Call(ctx, typ, payload)
}

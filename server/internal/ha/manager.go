// Package ha 管理 Sticky Nuo 与多个 Home Assistant 实例的连接。
package ha

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/ha/client"
	"stickynuo/server/internal/ha/model"
	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/store"
)

// runtime 单条 HA 连接（按 (instance,user) 隔离）的实时运行态。
type runtime struct {
	store  *StateStore
	rt     *Realtime
	cancel context.CancelFunc
}

// connKey 后端到 HA 的一条连接标识：实例 URL 全局（管理员），token 按用户解析。
// 同一用户在同一实例共享一条连接；不同用户各自独立连接，实现个人 token 权限隔离。
type connKey struct {
	instance int64
	user     string
}

// Manager 管理多条按用户隔离的 HA 连接：active 解析、REST 缓存、实时连接与扇出。
type Manager struct {
	repo        *store.InstanceRepo
	userPrefs   *store.UserPrefs
	hub         *hub.Hub
	log         *slog.Logger
	tlsInsecure bool // 信任自签名证书（本地 HA 常用）
	mu          sync.RWMutex
	clients     map[connKey]*client.Rest
	runtimes    map[connKey]*runtime
	seedRT      map[connKey]bool // 已注册 store.onChange 标记（幂等）
}

// NewManager 构造管理器。
// userPrefs 提供每个用户各自的 HA 个人 token（key=ha_token），无 token 即禁用。
func NewManager(repo *store.InstanceRepo, userPrefs *store.UserPrefs, h *hub.Hub, log *slog.Logger, tlsInsecure bool) *Manager {
	return &Manager{
		repo:        repo,
		userPrefs:   userPrefs,
		hub:         h,
		log:         log,
		tlsInsecure: tlsInsecure,
		clients:     map[connKey]*client.Rest{},
		runtimes:    map[connKey]*runtime{},
		seedRT:      map[connKey]bool{},
	}
}

// errNoInstance 未配置任何实例。
var errNoInstance = errors.New("no configured home assistant instance")

// ErrNoHAToken 当前用户未配置个人 HA token，访问被禁用。
var ErrNoHAToken = errors.New("no personal home assistant token configured")

// personalToken 返回用户在指定实例上使用的个人 HA token。
// 无 token → 返回 ok=false，即「未配置即禁用」。
func (m *Manager) personalToken(ctx context.Context, user string, skipTLS bool) (string, bool) {
	if user == "" {
		return "", false
	}
	tok := m.userPrefs.Get(ctx, user, "ha_token")
	return tok, tok != ""
}

// fromCtx 读取当前请求的用户名；无身份则返回空串。
func (m *Manager) fromCtx(ctx context.Context) string {
	if id, ok := auth.From(ctx); ok {
		return id.Username
	}
	return ""
}

// resolve 解析实例；id<=0 时用 active 实例。
func (m *Manager) resolve(ctx context.Context, id int64) (store.Instance, error) {
	if id <= 0 {
		return m.repo.GetActiveInstance(ctx)
	}
	return m.repo.Get(ctx, id)
}

// resolveKey 解析连接标识与生效的个人 token。
// 用户未配置 token 时返回 ErrNoHAToken（连接禁用）。
func (m *Manager) resolveKey(ctx context.Context, id int64) (connKey, store.Instance, error) {
	i, err := m.resolve(ctx, id)
	if err != nil {
		return connKey{}, i, errNoInstance
	}
	user := m.fromCtx(ctx)
	if _, ok := m.personalToken(ctx, user, i.SkipTLS); !ok {
		return connKey{}, i, ErrNoHAToken
	}
	return connKey{instance: i.ID, user: user}, i, nil
}

// Rest 返回实例的 REST 客户端（懒创建并缓存），按当前用户个人 token 建立。
func (m *Manager) Rest(ctx context.Context, id int64) (*client.Rest, error) {
	key, i, err := m.resolveKey(ctx, id)
	if err != nil {
		return nil, err
	}
	skipTLS := i.SkipTLS || m.tlsInsecure // 每实例开关优先，全局环境变量兜底
	tok := m.userPrefs.Get(ctx, key.user, "ha_token")
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, ok := m.clients[key]; ok {
		return r, nil
	}
	r := client.NewRest(i.URL, tok, skipTLS)
	m.clients[key] = r
	return r, nil
}

// Live 获取某用户在某实例上的实时状态缓存；必要时启动其各自 HA WebSocket 连接。
func (m *Manager) Live(ctx context.Context, id int64) (*StateStore, error) {
	key, i, err := m.resolveKey(ctx, id)
	if err != nil {
		return nil, err
	}
	tok := m.userPrefs.Get(ctx, key.user, "ha_token")
	m.mu.Lock()
	defer m.mu.Unlock()
	if rt, ok := m.runtimes[key]; ok {
		return rt.store, nil
	}
	store := NewStateStore()
	ctxLive, cancel := context.WithCancel(context.Background())
	rt := NewRealtime(RTConfig{
		InstanceID:    i.ID,
		BaseURL:       i.URL,
		Token:         tok,
		SkipTLSVerify: i.SkipTLS || m.tlsInsecure, // 每实例开关优先，全局环境变量兜底
	}, store, m.log)
	// 注入 Browser_mod 风格命令回调：HA 事件 → 按设备路由到该用户的前端 WS。
	kk := key
	rt.OnCommand(func(deviceID string, payload []byte) {
		m.SendCommand(kk, deviceID, payload)
	})
	if !m.seedRT[key] {
		store.SetOnChange(func(entityID string) {
			m.pushEntityToLive(kk, entityID)
		})
		m.seedRT[key] = true
	}
	go rt.Start(ctxLive)
	m.runtimes[key] = &runtime{store: store, rt: rt, cancel: cancel}
	m.log.Info("ha live started", "instance", i.ID, "user", key.user)
	return store, nil
}

// pushEntityToLive 把单个变化实体（DisplayEntity 富结构）增量广播给该用户在该实例上的订阅者。
func (m *Manager) pushEntityToLive(key connKey, entityID string) {
	m.mu.RLock()
	rt := m.runtimes[key]
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
	m.hub.Broadcast(hub.Scope{Instance: key.instance, User: key.user}, b)
}

// Hub 返回全局前端连接中心。
func (m *Manager) Hub() *hub.Hub { return m.hub }

// SendCommand 把一条 Browser_mod 风格命令路由到指定用户作用域内的设备前端连接。
// deviceID 为空或 "all" 时广播到该作用域全部连接。
func (m *Manager) SendCommand(key connKey, deviceID string, payload []byte) {
	scope := hub.Scope{Instance: key.instance, User: key.user}
	if deviceID == "" || deviceID == "all" {
		m.hub.Broadcast(scope, payload)
		return
	}
	m.hub.SendToDevice(scope, deviceID, payload)
}

// Invalidate 使某实例的全部用户连接失效并停止其实时连接（实例更新/删除后调用）。
func (m *Manager) Invalidate(id int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, rt := range m.runtimes {
		if key.instance == id {
			rt.cancel()
			delete(m.runtimes, key)
			delete(m.seedRT, key)
		}
	}
	for key := range m.clients {
		if key.instance == id {
			delete(m.clients, key)
		}
	}
}

// InvalidateUser 使某用户在实例上的连接失效（个人 token 修改/切换后调用，即时生效）。
func (m *Manager) InvalidateUser(id int64, user string) {
	if user == "" {
		return
	}
	key := connKey{instance: id, user: user}
	m.mu.Lock()
	defer m.mu.Unlock()
	if rt, ok := m.runtimes[key]; ok {
		rt.cancel()
		delete(m.runtimes, key)
		delete(m.seedRT, key)
	}
	delete(m.clients, key)
}

// InvalidateActive 使某用户在 active 实例上失效（个人 token 写入后，按 active 实例即时重建）。
func (m *Manager) InvalidateActive(ctx context.Context, user string) {
	id, err := m.repo.ActiveID(ctx)
	if err != nil || id <= 0 {
		return
	}
	m.InvalidateUser(id, user)
}

// StopAll 停止所有实时连接（优雅关闭用）。
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key, rt := range m.runtimes {
		rt.cancel()
		delete(m.runtimes, key)
	}
}

// ActiveID 返回当前 active 实例 id。
func (m *Manager) ActiveID(ctx context.Context) (int64, error) {
	return m.repo.ActiveID(ctx)
}

// Snapshot 返回某用户在某实例上的实时状态快照；若实时连接尚未同步则返回空。
func (m *Manager) Snapshot(ctx context.Context, id int64) ([]model.EntityState, error) {
	store, err := m.Live(ctx, id)
	if err != nil {
		return nil, err
	}
	return store.Snapshot(), nil
}

// CallCommand 对某用户的 HA WS 连接发送一条命令并返回原始 JSON 结果。
func (m *Manager) CallCommand(ctx context.Context, id int64, typ string, payload map[string]any) ([]byte, error) {
	_, err := m.Live(ctx, id)
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	rt := m.runtimes[connKey{instance: id, user: m.fromCtx(ctx)}]
	m.mu.RUnlock()
	if rt == nil {
		return nil, errNoInstance
	}
	return rt.rt.Call(ctx, typ, payload)
}

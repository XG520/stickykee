// Package ha 管理 Sticky Kee 与多个 Home Assistant 实例的连接。
package ha

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/ha/client"
	"stickykee/server/internal/ha/model"
	"stickykee/server/internal/hub"
	"stickykee/server/internal/store"
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
	seedRT      map[connKey]bool         // 已注册 store.onChange 标记（幂等）
	batchers    map[connKey]*liveBatcher // 增量合并器（惰性创建，随 runtime 一起停止）
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
		batchers:    map[connKey]*liveBatcher{},
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

// RestForUser 同 Rest，但显式指定用户（供后台任务 / 管理员代操作场景：
// 这些调用链上没有请求身份上下文，无法经 fromCtx 解析用户）。
// 复用同一 connKey 缓存与失效逻辑（InvalidateUser 对两者一致生效）。
func (m *Manager) RestForUser(ctx context.Context, id int64, user string) (*client.Rest, error) {
	i, err := m.resolve(ctx, id)
	if err != nil {
		return nil, errNoInstance
	}
	if user == "" {
		return nil, ErrNoHAToken
	}
	tok := m.userPrefs.Get(ctx, user, "ha_token")
	if tok == "" {
		return nil, ErrNoHAToken
	}
	key := connKey{instance: i.ID, user: user}
	skipTLS := i.SkipTLS || m.tlsInsecure
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
	// 注入 HA mobile_app 通知回调：HA 侧调用 notify.mobile_app_<device> 服务后 fire 事件，
	// 按 webhook_id 反查该用户注册的 APK 设备 → 定向推送原生通知；反查不到则广播给全用户在线端。
	user := key.user
	rt.OnNotify(func(webhookID, title, message string, extra json.RawMessage) {
		deviceID := m.deviceIDByWebhook(user, webhookID)
		scope := hub.Scope{Instance: kk.instance, User: user}
		payload, err := json.Marshal(map[string]any{
			"type":      "notify_apk",
			"device_id": deviceID,
			"title":     title,
			"message":   message,
			"data":      json.RawMessage(extra),
		})
		if err != nil {
			return
		}
		if deviceID != "" {
			m.hub.SendToDevice(scope, deviceID, payload)
		} else {
			m.hub.Broadcast(scope, payload)
		}
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

// deviceIDByWebhook 在指定用户的 mobile_app 注册缓存里查 webhook_id 对应的 deviceID。
// 返回空串表示该用户名下无匹配注册（设备被删除或 webhook 过期）。
func (m *Manager) deviceIDByWebhook(user, webhookID string) string {
	if webhookID == "" {
		return ""
	}
	v := m.userPrefs.Get(context.Background(), user, "mobile_app_reg")
	if v == "" {
		return ""
	}
	var regs map[string]struct {
		WebhookID string `json:"webhook_id"`
		DeviceID  string `json:"device_id"`
	}
	if json.Unmarshal([]byte(v), &regs) != nil {
		return ""
	}
	for devID, r := range regs {
		if r.WebhookID == webhookID {
			if r.DeviceID != "" {
				return r.DeviceID
			}
			return devID
		}
	}
	return ""
}

// pushEntityToLive 记录一个变化的实体，交给合并器按窗口批量推送。
// 这里只做一次 map 写入：本函数在 HA 读取循环里同步调用，不能阻塞（原先在此直接
// 读取快照 + json.Marshal + 广播，事件密集时会拖慢读取循环）。
func (m *Manager) pushEntityToLive(key connKey, entityID string) {
	if b := m.batcherFor(key); b != nil {
		b.add(entityID)
	}
}

// batcherFor 取该连接的增量合并器；首次调用时惰性创建并启动。
// 没有实时运行时返回 nil（此时没有订阅者，无需推送）。
func (m *Manager) batcherFor(key connKey) *liveBatcher {
	m.mu.RLock()
	b := m.batchers[key]
	_, live := m.runtimes[key]
	m.mu.RUnlock()
	if b != nil {
		return b
	}
	if !live {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if b = m.batchers[key]; b != nil {
		return b
	}
	b = newLiveBatcher()
	m.batchers[key] = b
	go b.run(func(ids []string) { m.flushEntities(key, ids) })
	return b
}

// flushEntities 把一批实体合并成一条消息广播（同实体只发最后值），并带自增序号。
// 由合并器的单个 goroutine 串行调用，所以序号顺序与广播顺序一致。
func (m *Manager) flushEntities(key connKey, ids []string) {
	m.mu.RLock()
	rt := m.runtimes[key]
	b := m.batchers[key]
	m.mu.RUnlock()
	if rt == nil || b == nil {
		return
	}
	states := rt.store.GetMany(ids)
	if len(states) == 0 {
		return
	}
	displays := make([]model.DisplayEntity, 0, len(states))
	for _, s := range states {
		displays = append(displays, model.ParseDisplay(s))
	}
	payload, err := json.Marshal(map[string]any{
		"type": "state",
		"seq":  b.nextSeq(),
		"data": displays,
	})
	if err != nil {
		return
	}
	m.hub.Broadcast(hub.Scope{Instance: key.instance, User: key.user}, payload)
}

// Seq 返回该用户在该实例上增量流的当前序号；无实时连接/尚无增量时返回 0。
// WS 首帧快照会带上它，客户端据此判断后续推送是否漏帧。
func (m *Manager) Seq(ctx context.Context, id int64) uint64 {
	key, _, err := m.resolveKey(ctx, id)
	if err != nil {
		return 0
	}
	m.mu.RLock()
	b := m.batchers[key]
	m.mu.RUnlock()
	if b == nil {
		return 0
	}
	return b.Seq()
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
	for key := range m.runtimes {
		if key.instance == id {
			m.dropRuntime(key)
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
	m.dropRuntime(key)
	delete(m.clients, key)
}

// dropRuntime 停止并清理某条连接的实时运行态与增量合并器（调用方需持有写锁）。
// 合并器的 goroutine 必须一并停掉，否则连接重建后会留下泄漏的定时器。
func (m *Manager) dropRuntime(key connKey) {
	if rt, ok := m.runtimes[key]; ok {
		rt.cancel()
		delete(m.runtimes, key)
	}
	delete(m.seedRT, key)
	if b, ok := m.batchers[key]; ok {
		b.stop()
		delete(m.batchers, key)
	}
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

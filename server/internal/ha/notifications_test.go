package ha

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"stickynuo/server/internal/ha/model"
)

func TestNotificationEntities(t *testing.T) {
	raw := json.RawMessage(`{
		"Notice-01": {"notification_id":"Notice-01","title":"配置检查","message":"发现 2 项问题","created_at":"2026-10-09T12:00:00Z"},
		"legacy":    {"notification_id":"legacy","title":"","message":"旧版毫秒时间戳","creationDate":1760000000000},
		"":          {"notification_id":"","title":"缺 id","message":"应被跳过"}
	}`)
	list := notificationEntities(raw)
	if len(list) != 2 {
		t.Fatalf("expect 2 entities, got %d: %s", len(list), mustJSON(list))
	}
	byID := map[string]model.EntityState{}
	for _, e := range list {
		byID[e.EntityID] = e
	}

	// created_at（ISO）解析 + id 清洗（大写/连字符 → 小写下划线）+ 属性透传
	e, ok := byID["persistent_notification.notice_01"]
	if !ok {
		t.Fatalf("missing sanitized entity; got %s", keys(byID))
	}
	if e.State != "发现 2 项问题" {
		t.Errorf("state = %q, want message text", e.State)
	}
	var attrs map[string]string
	if err := json.Unmarshal(e.Attributes, &attrs); err != nil {
		t.Fatalf("attributes unmarshal: %v", err)
	}
	if attrs["notification_id"] != "Notice-01" {
		t.Errorf("notification_id = %q, want original raw id", attrs["notification_id"])
	}
	if attrs["title"] != "配置检查" || attrs["message"] != "发现 2 项问题" {
		t.Errorf("attrs = %v", attrs)
	}
	want := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	if !e.LastUpdated.Equal(want) {
		t.Errorf("LastUpdated = %v, want %v (created_at)", e.LastUpdated, want)
	}

	// creationDate（毫秒）回退解析；空 title 回退为 id
	le, ok := byID["persistent_notification.legacy"]
	if !ok {
		t.Fatalf("missing legacy entity; got %s", keys(byID))
	}
	if le.State != "旧版毫秒时间戳" {
		t.Errorf("legacy state = %q", le.State)
	}
	if le.LastUpdated.Year() != 2025 { // 1760000000000ms = 2025-10-09 UTC
		t.Errorf("creationDate not applied: %v", le.LastUpdated)
	}
	var lattrs map[string]string
	_ = json.Unmarshal(le.Attributes, &lattrs)
	if lattrs["title"] != "legacy" {
		t.Errorf("empty title should fall back to id, got %q", lattrs["title"])
	}
}

func TestSlug(t *testing.T) {
	cases := map[string]string{
		"Notice-01": "notice_01",
		"ok_id":     "ok_id",
		"空格 id":     "_______id", // 多字节字符逐字节替换为 _（空格=3B 格=3B 空格=1B → 7 个 _）
		"!!!":       "___",
		"":          "notification",
	}
	for in, want := range cases {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
}

// fakeHA 模拟 HA WebSocket 端点：认证握手、命令应答与事件推送。
// notifs 由 mu 保护（handler goroutine 读、测试 goroutine 写）；
// 所有对 conn 的写经 writeMu 串行（gorilla 要求）。
type fakeHA struct {
	mu      sync.Mutex
	notifs  map[string]map[string]any
	writeMu sync.Mutex
	conn    *websocket.Conn
	connCh  chan *websocket.Conn
	subID   uint64 // persistent_notification/subscribe 的消息 id
}

func (f *fakeHA) snapshot() map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := make(map[string]any, len(f.notifs))
	for k, v := range f.notifs {
		cp[k] = v
	}
	return cp
}

func (f *fakeHA) reply(id any, result any) {
	f.writeMu.Lock()
	defer f.writeMu.Unlock()
	_ = f.conn.WriteJSON(map[string]any{"id": id, "type": "result", "success": true, "result": result})
}

// pushNotifEvent 模拟 HA persistent_notification/subscribe 的更新推送：
// 载荷恒为当前全量通知 dict。
func (f *fakeHA) pushNotifEvent(updateType string) {
	f.mu.Lock()
	subID := f.subID
	f.mu.Unlock()
	f.writeMu.Lock()
	defer f.writeMu.Unlock()
	_ = f.conn.WriteJSON(map[string]any{
		"type": "event",
		"id":   subID,
		"event": map[string]any{
			"type":          updateType,
			"notifications": f.snapshot(),
		},
	})
}

func TestNotificationPipeline(t *testing.T) {
	f := &fakeHA{
		notifs: map[string]map[string]any{
			"cfg_check": {"notification_id": "cfg_check", "title": "配置检查", "message": "hello", "created_at": "2026-10-09T00:00:00Z"},
		},
		connCh: make(chan *websocket.Conn, 4),
	}
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		f.mu.Lock()
		f.conn = conn
		f.mu.Unlock()
		select {
		case f.connCh <- conn:
		default:
		}
		_ = conn.WriteJSON(map[string]any{"type": "auth_required"})
		var authMsg map[string]any
		if err := conn.ReadJSON(&authMsg); err != nil || authMsg["type"] != "auth" {
			return
		}
		f.writeMu.Lock()
		_ = conn.WriteJSON(map[string]any{"type": "auth_ok"})
		f.writeMu.Unlock()
		for {
			var m map[string]any
			if err := conn.ReadJSON(&m); err != nil {
				return
			}
			id := m["id"]
			switch typ, _ := m["type"].(string); typ {
			case "auth/current_user":
				f.reply(id, map[string]any{"name": "admin", "is_admin": true})
			case "get_states":
				f.reply(id, []any{map[string]any{
					"entity_id": "light.a", "state": "on",
					"attributes": map[string]any{"friendly_name": "灯"},
				}})
			case "subscribe_events":
				f.reply(id, nil)
			case "persistent_notification/subscribe":
				f.mu.Lock()
				if fid, ok := id.(float64); ok {
					f.subID = uint64(fid)
				}
				f.mu.Unlock()
				f.reply(id, nil)
				f.pushNotifEvent("current") // HA 行为：订阅成功后立即推送 current 全量
			case "ping":
				f.writeMu.Lock()
				_ = conn.WriteJSON(map[string]any{"type": "pong"})
				f.writeMu.Unlock()
			default:
				if id != nil {
					f.reply(id, nil) // 未知命令也回 success，避免测试期间 call 超时
				}
			}
		}
	}))
	defer srv.Close()

	store := NewStateStore()
	seen := map[string]bool{}
	var seenMu sync.Mutex
	store.SetOnChange(func(entityID string) {
		seenMu.Lock()
		seen[entityID] = true
		seenMu.Unlock()
	})
	rt := NewRealtime(RTConfig{
		InstanceID: 1, BaseURL: srv.URL, Token: "t",
	}, store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go rt.Start(ctx)

	// 1) 初始拉取：通知被合成为实体并进入快照，onChange 触发
	waitFor(t, 5*time.Second, func() bool { return hasEntity(store, "persistent_notification.cfg_check") })
	if e, _ := store.Get("persistent_notification.cfg_check"); e.State != "hello" {
		t.Fatalf("initial notification state = %q, want %q", e.State, "hello")
	}
	seenMu.Lock()
	fired := seen["persistent_notification.cfg_check"]
	seenMu.Unlock()
	if !fired {
		t.Error("onChange not fired for initial notification")
	}

	// 2) 通知更新推送：新增一条 + 删除旧条目 → 全量替换后增删同时生效
	f.mu.Lock()
	f.notifs = map[string]map[string]any{
		"second": {"notification_id": "second", "title": "新版本", "message": "2.1 可用"},
	}
	f.mu.Unlock()
	f.pushNotifEvent("removed")
	waitFor(t, 5*time.Second, func() bool {
		return hasEntity(store, "persistent_notification.second") && !hasEntity(store, "persistent_notification.cfg_check")
	})

	// 3) get_states 全量替换不得清掉合成通知
	if err := applyRawStates(store, json.RawMessage(
		`[{"entity_id":"light.b","state":"off","attributes":{}}]`)); err != nil {
		t.Fatalf("applyRawStates: %v", err)
	}
	waitFor(t, 2*time.Second, func() bool {
		return hasEntity(store, "light.b") && hasEntity(store, "persistent_notification.second")
	})
}

// ---- helpers ----

func hasEntity(s *StateStore, id string) bool {
	_, ok := s.Get(id)
	return ok
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}

func keys(m map[string]model.EntityState) string {
	b, _ := json.Marshal(m)
	return string(b)
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

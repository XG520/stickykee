// Package diag 提供运行期诊断会话：在管理员开启诊断后收集后端日志 / HTTP 请求异常，
// 结束时长后交给 AI 生成诊断报告。默认没有任何会话时不做任何收集。
package diag

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxEntries = 2500
	maxMsgLen  = 1200
)

// Entry 一条诊断日志（后端 / HTTP / 浏览器）。
type Entry struct {
	Seq    int64     `json:"seq"`
	TS     time.Time `json:"ts"`
	Source string    `json:"source"`
	Level  string    `json:"level"`
	Msg    string    `json:"msg"`
}

// Snapshot 诊断会话的只读快照。
type Snapshot struct {
	ID          string            `json:"id"`
	Status      string            `json:"status"` // collecting / analyzing / done / failed
	StartedAt   time.Time         `json:"started_at"`
	EndsAt      time.Time         `json:"ends_at"`
	DurationMin int               `json:"duration_min"`
	Entries     []Entry           `json:"-"`
	ClientCount int               `json:"client_count"`
	Report      string            `json:"report,omitempty"`
	Error       string            `json:"error,omitempty"`
	Meta        map[string]string `json:"meta,omitempty"`
}

type session struct {
	id          string
	username    string
	status      string
	startedAt   time.Time
	endsAt      time.Time
	durationMin int
	entries     []Entry
	clientCount int
	report      string
	errText     string
	meta        map[string]string
}

// Manager 管理所有诊断会话。默认无会话 = 不收集。
type Manager struct {
	mu       sync.Mutex
	seq      int64
	sessions map[string]*session // username -> 最近一次会话
}

var defaultManager = NewManager()

// Default 返回进程内共享的诊断管理器。
func Default() *Manager { return defaultManager }

var (
	sinkMu  sync.RWMutex
	logSink func(source, level, msg string)
)

// SetSink 注册持久化日志写入器（数据库就绪后由 main 调用）。
// 未注册时只保留诊断会话内的内存日志。
func SetSink(fn func(source, level, msg string)) {
	sinkMu.Lock()
	logSink = fn
	sinkMu.Unlock()
}

// Record 写入持久化日志（已脱敏），不依赖诊断会话是否开启。
func Record(source, level, msg string) {
	sinkMu.RLock()
	fn := logSink
	sinkMu.RUnlock()
	if fn == nil {
		return
	}
	msg = strings.TrimSpace(sanitize(msg))
	if msg == "" {
		return
	}
	fn(source, level, msg)
}

func NewManager() *Manager {
	return &Manager{sessions: map[string]*session{}}
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Active 是否有正在收集日志的会话（HTTP 中间件与日志捕获据此快速返回）。
func (m *Manager) Active() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if s.status == "collecting" {
			return true
		}
	}
	return false
}

// Start 开启诊断；已有进行中的会话时返回 false。
func (m *Manager) Start(username string, minutes int, meta map[string]string) (*Snapshot, bool) {
	if minutes <= 0 {
		minutes = 5
	}
	if minutes > 120 {
		minutes = 120
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur := m.sessions[username]; cur != nil && (cur.status == "collecting" || cur.status == "analyzing") {
		return m.snapshotLocked(cur), false
	}
	now := time.Now()
	s := &session{
		id:          newID(),
		username:    username,
		status:      "collecting",
		startedAt:   now,
		endsAt:      now.Add(time.Duration(minutes) * time.Minute),
		durationMin: minutes,
		meta:        meta,
	}
	m.sessions[username] = s
	m.appendServerLocked(s, "server", "INFO", fmt.Sprintf("诊断会话开始：持续 %d 分钟", minutes))
	return m.snapshotLocked(s), true
}

// Stop 提前结束收集；返回会话快照与是否真的改变了状态。
func (m *Manager) Stop(username string) (*Snapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[username]
	if s == nil || s.status != "collecting" {
		if s == nil {
			return nil, false
		}
		return m.snapshotLocked(s), false
	}
	s.endsAt = time.Now()
	m.appendServerLocked(s, "server", "INFO", "用户提前结束诊断，开始生成报告")
	return m.snapshotLocked(s), true
}

// Due 返回已到达结束时间、等待分析的会话用户。
func (m *Manager) Due() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	var out []string
	for user, s := range m.sessions {
		if s.status == "collecting" && !now.Before(s.endsAt) {
			out = append(out, user)
		}
	}
	return out
}

// MarkAnalyzing 把收集中的会话切换为分析中（原子，避免重复触发 AI）。
func (m *Manager) MarkAnalyzing(username string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[username]
	if s == nil || s.status != "collecting" {
		return false
	}
	s.status = "analyzing"
	return true
}

// Finish 写入报告或失败原因。
func (m *Manager) Finish(username, report, errText string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[username]
	if s == nil {
		return
	}
	if errText != "" {
		s.status = "failed"
		s.errText = errText
		return
	}
	s.status = "done"
	s.report = report
	s.errText = ""
}

// Snapshot 读取用户最近一次诊断会话。
func (m *Manager) Snapshot(username string) (*Snapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[username]
	if s == nil {
		return nil, false
	}
	return m.snapshotLocked(s), true
}

func (m *Manager) snapshotLocked(s *session) *Snapshot {
	entries := make([]Entry, len(s.entries))
	copy(entries, s.entries)
	meta := make(map[string]string, len(s.meta))
	for k, v := range s.meta {
		meta[k] = v
	}
	return &Snapshot{
		ID:          s.id,
		Status:      s.status,
		StartedAt:   s.startedAt,
		EndsAt:      s.endsAt,
		DurationMin: s.durationMin,
		Entries:     entries,
		ClientCount: s.clientCount,
		Report:      s.report,
		Error:       s.errText,
		Meta:        meta,
	}
}

// AppendServer 记录一条后端日志（无收集会话时直接返回）。
func (m *Manager) AppendServer(source, level, msg string) {
	if !m.Active() {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if s.status != "collecting" {
			continue
		}
		m.appendServerLocked(s, source, level, msg)
	}
}

func (m *Manager) appendServerLocked(s *session, source, level, msg string) {
	m.seq++
	s.entries = append(s.entries, Entry{
		Seq:    m.seq,
		TS:     time.Now(),
		Source: source,
		Level:  strings.ToUpper(level),
		Msg:    sanitize(msg),
	})
	if len(s.entries) > maxEntries {
		// 丢弃最旧的一半，保留最近日志
		s.entries = append([]Entry(nil), s.entries[len(s.entries)-maxEntries/2:]...)
	}
}

// AppendClient 合并浏览器端日志。
func (m *Manager) AppendClient(username string, entries []Entry) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[username]
	if s == nil || s.status != "collecting" {
		return
	}
	for _, e := range entries {
		if strings.TrimSpace(e.Msg) == "" {
			continue
		}
		msg := sanitize(e.Msg)
		// 浏览器日志也进入持久化日志（即使诊断会话尚未结束）
		Record("client", e.Level, msg)
		m.seq++
		s.entries = append(s.entries, Entry{
			Seq:    m.seq,
			TS:     time.Now(),
			Source: "client",
			Level:  strings.ToUpper(e.Level),
			Msg:    msg,
		})
		s.clientCount++
	}
	if len(s.entries) > maxEntries {
		s.entries = append([]Entry(nil), s.entries[len(s.entries)-maxEntries/2:]...)
	}
}

// EntriesAfter 返回 seq > after 的日志（供前端轮询实时展示）。
func (m *Manager) EntriesAfter(username string, after int64, limit int) []Entry {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[username]
	if s == nil {
		return nil
	}
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	out := make([]Entry, 0, limit)
	for _, e := range s.entries {
		if e.Seq > after {
			out = append(out, e)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}

var (
	// 凭证类：请求头整行直接抹掉（Authorization / Cookie 等）
	credHeaderRe = regexp.MustCompile(`(?i)\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)\b\s*[:=]\s*[^\r\n]+`)
	bearerRe     = regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]+`)
	// JWT：三段式 Base64URL
	jwtRe = regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}\b`)
	// 键值对凭证：token=... / "api_key":"..." / password: ...
	secretKVRe = regexp.MustCompile(`(?i)\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|passphrase|private[_-]?key|session[_-]?id|jsessionid|amap[_-]?key|token)"?\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&"}']+)`)
	// 账号字段：username=... / "account":"..." / email: ...
	accountKVRe = regexp.MustCompile(`(?i)\b(user(?:name)?|account|login|owner|author|nick(?:name)?|email|phone|mobile)"?\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&"}']+)`)
	// 个人信息
	emailRe = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	phoneRe = regexp.MustCompile(`(?:\+?86[-\s]?)?\b1[3-9]\d{9}\b`)
	ipv4Re  = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	ipv6Re  = regexp.MustCompile(`(?i)\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b`)
	// 压缩写法的 IPv6（fe80::1 / ::1），要求出现 "::" 以免误伤时间戳
	ipv6ShortRe = regexp.MustCompile(`(?i)(?:[0-9a-f]{1,4}:)+:(?:[0-9a-f]{1,4})?`)
	macRe       = regexp.MustCompile(`(?i)\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b`)
	// URL 路径中的账号：/api/v1/messages/alice、/api/v1/users/admin
	accountPathRe = regexp.MustCompile(`(/(?:messages|users|contacts|conversations|share)/)[^/\s?"'#]+`)
)

// RedactForAI 在把日志交给外部模型前做二次脱敏：
// 凭证、账号字段、邮箱、电话、IP/MAC、URL 中的账号，以及系统内已知用户名。
// 只作用于报告 prompt，不影响管理员本地实时日志。
func RedactForAI(text string, names []string) string {
	if text == "" {
		return text
	}
	text = credHeaderRe.ReplaceAllString(text, "$1: ***")
	text = bearerRe.ReplaceAllString(text, "Bearer ***")
	text = jwtRe.ReplaceAllString(text, "***")
	text = secretKVRe.ReplaceAllString(text, "$1=***")
	text = accountKVRe.ReplaceAllString(text, "$1=***")
	text = emailRe.ReplaceAllString(text, "***@***")
	text = phoneRe.ReplaceAllString(text, "***")
	text = macRe.ReplaceAllString(text, "***")
	text = ipv4Re.ReplaceAllString(text, "***")
	text = ipv6ShortRe.ReplaceAllString(text, "***")
	text = ipv6Re.ReplaceAllString(text, "***")
	text = accountPathRe.ReplaceAllString(text, "$1***")
	return maskNames(text, names)
}

// maskNames 屏蔽系统中的已知账号名。ASCII 账号按单词边界匹配；
// 含非 ASCII 的账号（如中文名）直接替换（中文无空格边界）。
func maskNames(text string, names []string) string {
	if len(names) == 0 || text == "" {
		return text
	}
	list := make([]string, 0, len(names))
	for _, n := range names {
		if n = strings.TrimSpace(n); n != "" {
			list = append(list, n)
		}
	}
	// 长账号优先，避免 short 先匹配掉 long 的一部分
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) })
	for _, n := range list {
		if hasNonASCII(n) {
			text = strings.ReplaceAll(text, n, "***")
			continue
		}
		re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(n) + `\b`)
		text = re.ReplaceAllString(text, "***")
	}
	return text
}

func hasNonASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return true
		}
	}
	return false
}

// sanitize 在日志入库时去除凭证，并限制单条长度（个人信息仅在提交 AI 前二次过滤）。
func sanitize(msg string) string {
	msg = credHeaderRe.ReplaceAllString(msg, "$1: ***")
	msg = bearerRe.ReplaceAllString(msg, "Bearer ***")
	msg = secretKVRe.ReplaceAllString(msg, "$1=***")
	msg = strings.ReplaceAll(msg, "\x00", "")
	if len(msg) > maxMsgLen {
		msg = msg[:maxMsgLen] + "…"
	}
	return msg
}

// CaptureHandler 把 slog 记录写入持久化日志，同时在诊断会话开启时送入实时收集器。
type CaptureHandler struct {
	base  slog.Handler
	attrs []slog.Attr
	group string
}

func NewCaptureHandler(base slog.Handler) *CaptureHandler {
	return &CaptureHandler{base: base}
}

func (h *CaptureHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.base.Enabled(ctx, l)
}

func (h *CaptureHandler) Handle(ctx context.Context, r slog.Record) error {
	var b strings.Builder
	if h.group != "" {
		b.WriteString(h.group + ".")
	}
	b.WriteString(r.Message)
	for _, a := range h.attrs {
		b.WriteString(" " + a.Key + "=" + a.Value.String())
	}
	r.Attrs(func(a slog.Attr) bool {
		b.WriteString(" " + a.Key + "=" + a.Value.String())
		return true
	})
	// 持久化日志始终记录（与诊断会话无关）；会话开启时再叠加一份实时日志。
	Record("server", r.Level.String(), b.String())
	if defaultManager.Active() {
		defaultManager.AppendServer("server", r.Level.String(), b.String())
	}
	return h.base.Handle(ctx, r)
}

func (h *CaptureHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	next = append(next, h.attrs...)
	next = append(next, attrs...)
	return &CaptureHandler{base: h.base.WithAttrs(attrs), attrs: next, group: h.group}
}

func (h *CaptureHandler) WithGroup(name string) slog.Handler {
	g := name
	if h.group != "" {
		g = h.group + "." + name
	}
	return &CaptureHandler{base: h.base.WithGroup(name), attrs: h.attrs, group: g}
}

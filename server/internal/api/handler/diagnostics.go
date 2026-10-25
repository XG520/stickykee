package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/diag"
	"stickynuo/server/internal/store"
)

// Diagnostics AI 诊断：管理员开启后收集前后端日志，时长结束后交给 AI 生成报告。
// 功能默认关闭（没有会话时不收集任何日志）。提交 AI 前会做隐私脱敏。
type Diagnostics struct {
	mgr   *diag.Manager
	ai    *AI
	users *store.UserRepo
}

func NewDiagnostics(mgr *diag.Manager, ai *AI, users *store.UserRepo) *Diagnostics {
	return &Diagnostics{mgr: mgr, ai: ai, users: users}
}

// usernames 读取系统内全部账号名，供提交 AI 前屏蔽。
func (d *Diagnostics) usernames(ctx context.Context) []string {
	return usernamesOf(ctx, d.users)
}

// usernamesOf 读取系统内全部账号名（诊断与历史日志分析共用）。
func usernamesOf(ctx context.Context, users *store.UserRepo) []string {
	if users == nil {
		return nil
	}
	list, err := users.List(ctx)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, u := range list {
		if strings.TrimSpace(u.Username) != "" {
			out = append(out, u.Username)
		}
	}
	return out
}

type diagStatusResp struct {
	Status      string `json:"status"` // idle / collecting / analyzing / done / failed
	Progress    int    `json:"progress"`
	StartedAt   string `json:"started_at,omitempty"`
	EndsAt      string `json:"ends_at,omitempty"`
	DurationMin int    `json:"duration_min,omitempty"`
	Collected   int    `json:"collected"`
	ClientCount int    `json:"client_count"`
	ReportReady bool   `json:"report_ready"`
	Error       string `json:"error,omitempty"`
}

func statusOf(s *diag.Snapshot) diagStatusResp {
	if s == nil {
		return diagStatusResp{Status: "idle"}
	}
	now := time.Now()
	progress := 100
	if s.Status == "collecting" {
		total := s.EndsAt.Sub(s.StartedAt).Seconds()
		if total > 0 {
			progress = int(now.Sub(s.StartedAt).Seconds() / total * 100)
		}
		if progress < 0 {
			progress = 0
		}
		if progress > 99 {
			progress = 99
		}
	}
	return diagStatusResp{
		Status:      s.Status,
		Progress:    progress,
		StartedAt:   s.StartedAt.Format(time.RFC3339),
		EndsAt:      s.EndsAt.Format(time.RFC3339),
		DurationMin: s.DurationMin,
		Collected:   len(s.Entries),
		ClientCount: s.ClientCount,
		ReportReady: s.Status == "done" && s.Report != "",
		Error:       s.Error,
	}
}

// StartTicker 在后台检查会话是否到期，到期自动生成报告。
func (d *Diagnostics) StartTicker(ctx context.Context) {
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				for _, username := range d.mgr.Due() {
					go d.analyze(username)
				}
			}
		}
	}()
}

// Start POST /diagnostics/start { duration_min, client_meta }
func (d *Diagnostics) Start(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可开启诊断")
		return
	}
	var body struct {
		DurationMin int               `json:"duration_min"`
		ClientMeta  map[string]string `json:"client_meta"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "参数不合法")
		return
	}
	if body.ClientMeta == nil {
		body.ClientMeta = map[string]string{}
	}
	s, created := d.mgr.Start(rUsername(r), body.DurationMin, body.ClientMeta)
	if !created {
		WriteErr(w, 409, "diag_active", "已有诊断正在进行")
		return
	}
	WriteJSON(w, 200, statusOf(s))
}

// Stop POST /diagnostics/stop 提前结束并立即生成报告。
func (d *Diagnostics) Stop(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可操作诊断")
		return
	}
	username := rUsername(r)
	s, changed := d.mgr.Stop(username)
	if s == nil {
		WriteErr(w, 404, "diag_not_found", "当前没有诊断会话")
		return
	}
	if changed {
		go d.analyze(username)
	}
	WriteJSON(w, 200, statusOf(s))
}

// Status GET /diagnostics/status
func (d *Diagnostics) Status(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可查看诊断")
		return
	}
	s, ok := d.mgr.Snapshot(rUsername(r))
	if !ok {
		WriteJSON(w, 200, statusOf(nil))
		return
	}
	WriteJSON(w, 200, statusOf(s))
}

// Logs GET /diagnostics/logs?after=<seq> 返回实时日志（轮询展示用）。
func (d *Diagnostics) Logs(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可查看诊断")
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	entries := d.mgr.EntriesAfter(rUsername(r), after, 300)
	if entries == nil {
		entries = []diag.Entry{}
	}
	WriteJSON(w, 200, map[string]any{"entries": entries})
}

// ClientLogs POST /diagnostics/logs { entries:[{level,msg}] } 合并浏览器日志。
func (d *Diagnostics) ClientLogs(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可提交诊断日志")
		return
	}
	var body struct {
		Entries []struct {
			Level string `json:"level"`
			Msg   string `json:"msg"`
		} `json:"entries"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "参数不合法")
		return
	}
	entries := make([]diag.Entry, 0, len(body.Entries))
	for _, e := range body.Entries {
		entries = append(entries, diag.Entry{Level: e.Level, Msg: e.Msg})
	}
	d.mgr.AppendClient(rUsername(r), entries)
	WriteJSON(w, 200, map[string]any{"ok": true})
}

// Report GET /diagnostics/report
func (d *Diagnostics) Report(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可查看诊断报告")
		return
	}
	s, ok := d.mgr.Snapshot(rUsername(r))
	if !ok || s.Report == "" {
		WriteErr(w, 404, "diag_report_missing", "诊断报告尚未生成")
		return
	}
	WriteJSON(w, 200, map[string]any{
		"report":     s.Report,
		"started_at": s.StartedAt.Format(time.RFC3339),
		"ends_at":    s.EndsAt.Format(time.RFC3339),
		"duration":   s.DurationMin,
	})
}

// analyze 组装日志摘要并调用 AI 生成 Markdown 报告。
func (d *Diagnostics) analyze(username string) {
	if !d.mgr.MarkAnalyzing(username) {
		return
	}
	s, ok := d.mgr.Snapshot(username)
	if !ok {
		d.mgr.Finish(username, "", "诊断会话不存在")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	// 客户端环境信息只保留诊断必需的非标识字段（丢弃完整 UA、屏幕、时区等设备指纹）
	meta := map[string]any{
		"server_time":  time.Now().Format(time.RFC3339),
		"go_version":   runtime.Version(),
		"os":           runtime.GOOS,
		"arch":         runtime.GOARCH,
		"duration_min": s.DurationMin,
		"started_at":   s.StartedAt.Format(time.RFC3339),
		"ended_at":     s.EndsAt.Format(time.RFC3339),
		"client_meta":  safeClientMeta(s.Meta),
	}
	metaJSON, _ := json.MarshalIndent(meta, "", "  ")

	counts := map[string]int{}
	anomalies := make([]diag.Entry, 0, 200)
	recent := make([]diag.Entry, 0, 200)
	for _, e := range s.Entries {
		counts[e.Source+"/"+e.Level]++
		if e.Level == "ERROR" || e.Level == "WARN" || looksAnomalous(e.Msg) {
			anomalies = append(anomalies, e)
		} else {
			recent = append(recent, e)
		}
	}
	if len(recent) > 200 {
		recent = recent[len(recent)-200:]
	}
	countsJSON, _ := json.Marshal(counts)

	systemPrompt := `你是一名资深的 Home Assistant / Web 应用运维诊断专家。根据前后端日志与客户端环境信息，生成一份中文 Markdown 诊断报告。
要求：
1. 使用清晰的 Markdown 结构，标题为「# HomeCanvas 诊断报告」。
2. 章节依次为：一、总体结论；二、关键异常与证据；三、可能原因；四、处理建议（按优先级）；五、仍需补充的信息或复现步骤。
3. 只根据提供的日志推断，引用日志时保留时间与来源；不要编造不存在的日志行或错误。
4. 证据不足时明确说明「日志不足以判断」，并给出下一步需要收集的信息。
5. 不要输出 API Key、Token、密码等敏感信息。
6. 日志中的账号、用户名、邮箱、电话、IP/MAC 等个人信息已被替换为 ***；不要尝试还原、猜测或在报告中复述这些信息，需要指代用户时统一使用「某账号」。
7. 全文控制在 800~1500 字，重点突出、可执行。`

	userPrompt := fmt.Sprintf(`诊断时间范围：%s ~ %s（共 %d 分钟）

客户端环境信息：
%s

日志级别统计：
%s

【异常日志（ERROR / WARN / 关键字）】
%s

【其他最近日志（最后 200 条）】
%s`, s.StartedAt.Format("2006-01-02 15:04:05"), s.EndsAt.Format("2006-01-02 15:04:05"), s.DurationMin, metaJSON, countsJSON, formatEntries(anomalies, 30000), formatEntries(recent, 12000))
	if len(userPrompt) > 70000 {
		userPrompt = userPrompt[:70000] + "\n…（日志已截断）"
	}
	// 交给外部模型前统一脱敏：凭证、账号、个人信息、URL 中的账号与系统内已知用户名。
	userPrompt = diag.RedactForAI(userPrompt, d.usernames(ctx))

	report, err := d.ai.CompleteByUser(ctx, username, []map[string]any{
		{"role": "system", "content": systemPrompt},
		{"role": "user", "content": userPrompt},
	}, 0.2)
	if err != nil {
		d.mgr.Finish(username, "", err.Error())
		return
	}
	d.mgr.Finish(username, report, "")
}

func formatEntries(entries []diag.Entry, maxChars int) string {
	if len(entries) == 0 {
		return "（无）"
	}
	var b strings.Builder
	used := 0
	for _, e := range entries {
		line := fmt.Sprintf("[%s] %s %s %s\n", e.TS.Format("15:04:05"), e.Source, e.Level, e.Msg)
		if used+len(line) > maxChars {
			b.WriteString("…（已截断）\n")
			break
		}
		b.WriteString(line)
		used += len(line)
	}
	return b.String()
}

func looksAnomalous(msg string) bool {
	m := strings.ToLower(msg)
	for _, kw := range []string{"error", "fail", "timeout", "timed out", "refused", "panic", "exception", "401", "403", "500", "502", "504", "重连", "失败", "超时", "异常"} {
		if strings.Contains(m, kw) {
			return true
		}
	}
	return false
}

// safeClientMeta 只向模型暴露诊断必需的非标识字段，丢弃完整 UA、屏幕尺寸、时区、平台等设备指纹。
func safeClientMeta(meta map[string]string) map[string]string {
	out := map[string]string{}
	for _, k := range []string{"viewport", "online", "connection", "language", "js_memory"} {
		if v := strings.TrimSpace(meta[k]); v != "" {
			out[k] = diag.RedactForAI(v, nil)
		}
	}
	if ua := meta["ua"]; ua != "" {
		out["ua_brief"] = briefUA(ua)
	}
	if route := meta["route"]; route != "" {
		out["route"] = diag.RedactForAI(route, nil)
	}
	return out
}

// briefUA 把完整 User-Agent 归并为粗粒度浏览器 / 系统标签。
func briefUA(ua string) string {
	browser := "unknown"
	switch {
	case strings.Contains(ua, "Edg/"):
		browser = "Edge"
	case strings.Contains(ua, "Chrome/") || strings.Contains(ua, "CriOS/"):
		browser = "Chrome"
	case strings.Contains(ua, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "Safari/"):
		browser = "Safari"
	}
	osName := "unknown"
	switch {
	case strings.Contains(ua, "Windows"):
		osName = "Windows"
	case strings.Contains(ua, "Android"):
		osName = "Android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		osName = "iOS"
	case strings.Contains(ua, "Mac OS X"):
		osName = "macOS"
	case strings.Contains(ua, "Linux"):
		osName = "Linux"
	}
	return browser + " / " + osName
}

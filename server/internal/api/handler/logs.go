package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/diag"
	"stickykee/server/internal/store"
)

const (
	logRetentionDays = 30   // 日志保留天数
	logAnalysisMax   = 3000 // 单次 AI 分析最多读取的日志条数
)

// Logs 运行日志：持久化查询 + 按级别/来源/时间段筛选后交给 AI 分析。
// 全部接口仅管理员可用；提交 AI 前统一脱敏。
type Logs struct {
	repo  *store.LogRepo
	ai    *AI
	users *store.UserRepo

	mu   sync.Mutex
	jobs map[string]*logAnalysisJob // username -> 最近一次分析任务
}

type logAnalysisJob struct {
	Status     string // running / done / failed
	StartedAt  time.Time
	FinishedAt time.Time
	Collected  int
	Report     string
	Error      string
}

func NewLogs(repo *store.LogRepo, ai *AI, users *store.UserRepo) *Logs {
	return &Logs{repo: repo, ai: ai, users: users, jobs: map[string]*logAnalysisJob{}}
}

// StartRetention 启动保留策略：启动时清理一次，之后每小时清理超过 30 天的日志。
func (h *Logs) StartRetention(ctx context.Context) {
	purge := func() {
		n, err := h.repo.PurgeBefore(ctx, time.Now().AddDate(0, 0, -logRetentionDays))
		if err != nil {
			if ctx.Err() == nil {
				slog.Warn("purge old logs", "err", err)
			}
			return
		}
		if n > 0 {
			slog.Info("purged old logs", "count", n, "retention_days", logRetentionDays)
		}
	}
	go func() {
		purge()
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				purge()
			}
		}
	}()
}

// ---- 查询条件 ----

type logsFilter struct {
	Levels  []string
	Sources []string
	From    time.Time
	To      time.Time
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// parseLogFilter 解析级别/来源/时间段；时间缺省为最近 24 小时。
func parseLogFilter(levels, sources []string, fromStr, toStr string) logsFilter {
	f := logsFilter{Levels: levels, Sources: sources}
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(fromStr)); err == nil {
		f.From = t
	}
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(toStr)); err == nil {
		f.To = t
	}
	if f.To.IsZero() {
		f.To = time.Now()
	}
	if f.From.IsZero() {
		f.From = f.To.Add(-24 * time.Hour)
	}
	if !f.From.Before(f.To) {
		f.From = f.To.Add(-24 * time.Hour)
	}
	return f
}

// List GET /logs?levels=ERROR,WARN&sources=server,http&from=...&to=...&limit=&offset=
func (h *Logs) List(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可查看运行日志")
		return
	}
	q := r.URL.Query()
	f := parseLogFilter(splitCSV(q.Get("levels")), splitCSV(q.Get("sources")), q.Get("from"), q.Get("to"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	entries, total, err := h.repo.Query(r.Context(), store.LogFilter{
		Levels:  f.Levels,
		Sources: f.Sources,
		From:    f.From,
		To:      f.To,
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		WriteErr(w, 500, "logs_query", "日志查询失败")
		return
	}
	WriteJSON(w, 200, map[string]any{
		"entries":        entries,
		"total":          total,
		"retention_days": logRetentionDays,
		"from":           f.From.Format(time.RFC3339),
		"to":             f.To.Format(time.RFC3339),
	})
}

// AnalysisStatus GET /logs/analysis 返回最近一次 AI 分析进度与报告。
func (h *Logs) AnalysisStatus(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可查看日志分析")
		return
	}
	h.mu.Lock()
	job := h.jobs[rUsername(r)]
	h.mu.Unlock()
	WriteJSON(w, 200, jobResponse(job))
}

func jobResponse(j *logAnalysisJob) map[string]any {
	if j == nil {
		return map[string]any{"status": "idle", "collected": 0}
	}
	out := map[string]any{
		"status":    j.Status,
		"collected": j.Collected,
	}
	if !j.StartedAt.IsZero() {
		out["started_at"] = j.StartedAt.Format(time.RFC3339)
	}
	if !j.FinishedAt.IsZero() {
		out["finished_at"] = j.FinishedAt.Format(time.RFC3339)
	}
	if j.Report != "" {
		out["report"] = j.Report
	}
	if j.Error != "" {
		out["error"] = j.Error
	}
	return out
}

// AnalysisStart POST /logs/analysis { levels, sources, from, to }
// 启动后台分析并立即返回；前端轮询 /logs/analysis 获取结果。
func (h *Logs) AnalysisStart(w http.ResponseWriter, r *http.Request) {
	username := rUsername(r)
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可发起日志分析")
		return
	}
	var body struct {
		Levels  []string `json:"levels"`
		Sources []string `json:"sources"`
		From    string   `json:"from"`
		To      string   `json:"to"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "参数不合法")
		return
	}
	f := parseLogFilter(body.Levels, body.Sources, body.From, body.To)

	entries, _, err := h.repo.Query(context.Background(), store.LogFilter{
		Levels:  f.Levels,
		Sources: f.Sources,
		From:    f.From,
		To:      f.To,
		Limit:   logAnalysisMax,
	})
	if err != nil {
		WriteErr(w, 500, "logs_query", "日志查询失败")
		return
	}
	if len(entries) == 0 {
		WriteErr(w, 400, "no_logs", "所选条件下没有日志，请调整筛选范围")
		return
	}

	h.mu.Lock()
	if cur := h.jobs[username]; cur != nil && cur.Status == "running" {
		h.mu.Unlock()
		WriteErr(w, 409, "analysis_running", "已有分析正在进行，请稍候")
		return
	}
	job := &logAnalysisJob{Status: "running", StartedAt: time.Now(), Collected: len(entries)}
	h.jobs[username] = job
	h.mu.Unlock()

	go h.runAnalysis(username, f, entries)
	WriteJSON(w, 202, jobResponse(job))
}

func (h *Logs) runAnalysis(username string, f logsFilter, entries []store.LogEntry) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	counts := map[string]int{}
	for _, e := range entries {
		counts[e.Level]++
	}
	countJSON, _ := json.Marshal(counts)

	systemPrompt := `你是一名资深的 Home Assistant / Web 应用运维诊断专家。根据用户筛选出的历史运行日志，生成一份中文 Markdown 诊断报告。
要求：
1. 标题为「# HomeCanvas 日志分析报告」。
2. 章节依次为：一、总体结论；二、关键异常与证据；三、可能原因；四、处理建议（按优先级）；五、仍需补充的信息。
3. 只根据提供的日志推断，引用日志时保留时间与来源；不要编造不存在的日志行或错误。
4. 日志中的账号、用户名、邮箱、电话、IP/MAC 等个人信息已被替换为 ***；不要尝试还原、猜测或在报告中复述，指代用户时统一使用「某账号」。
5. 不要输出 API Key、Token、密码等敏感信息。
6. 全文控制在 800~1500 字，重点突出、可执行。`

	userPrompt := fmt.Sprintf(`分析时间范围：%s ~ %s
筛选级别：%s
筛选来源：%s
读取日志条数：%d

日志级别统计：
%s

【日志明细（按时间正序）】
%s`,
		f.From.Format("2006-01-02 15:04:05"), f.To.Format("2006-01-02 15:04:05"),
		joinOr(f.Levels, "全部"), joinOr(f.Sources, "全部"), len(entries),
		countJSON, formatLogEntries(entries, 60000))

	// 提交 AI 前统一脱敏：凭证、账号、个人信息、URL 中的账号与系统内已知用户名。
	userPrompt = diag.RedactForAI(userPrompt, usernamesOf(ctx, h.users))

	report, err := h.ai.CompleteByUser(ctx, username, []map[string]any{
		{"role": "system", "content": systemPrompt},
		{"role": "user", "content": userPrompt},
	}, 0.2)

	h.mu.Lock()
	defer h.mu.Unlock()
	job := h.jobs[username]
	if job == nil {
		return
	}
	job.FinishedAt = time.Now()
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		return
	}
	job.Status = "done"
	job.Report = report
}

func joinOr(list []string, fallback string) string {
	if len(list) == 0 {
		return fallback
	}
	return strings.Join(list, " / ")
}

// formatLogEntries 按时间正序拼接日志，超过 maxChars 时截断。
func formatLogEntries(entries []store.LogEntry, maxChars int) string {
	if len(entries) == 0 {
		return "（无）"
	}
	var b strings.Builder
	used := 0
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		line := fmt.Sprintf("[%s] %s %s %s\n", e.TS, e.Source, e.Level, e.Msg)
		if used+len(line) > maxChars {
			b.WriteString("…（日志已截断）\n")
			break
		}
		b.WriteString(line)
		used += len(line)
	}
	return b.String()
}

package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// LogEntry 一条持久化运行日志（级别 + 来源分类）。
type LogEntry struct {
	ID     int64  `json:"id"`
	TS     string `json:"ts"`
	Level  string `json:"level"`
	Source string `json:"source"`
	Msg    string `json:"msg"`
}

// LogFilter 日志查询条件：级别 / 来源 / 时间范围。
type LogFilter struct {
	Levels  []string
	Sources []string
	From    time.Time
	To      time.Time
	Limit   int
	Offset  int
}

// LogRepo 运行日志仓储。
type LogRepo struct {
	db *sql.DB
}

func NewLogRepo(db *sql.DB) *LogRepo { return &LogRepo{db: db} }

var validLogLevels = map[string]bool{"DEBUG": true, "INFO": true, "WARN": true, "ERROR": true}
var validLogSources = map[string]bool{"server": true, "http": true, "client": true}

// NormalizeLogLevel 把任意 slog 级别归并到 DEBUG / INFO / WARN / ERROR。
func NormalizeLogLevel(l string) string {
	l = strings.ToUpper(strings.TrimSpace(l))
	switch {
	case strings.HasPrefix(l, "DEBUG"):
		return "DEBUG"
	case strings.HasPrefix(l, "WARN"):
		return "WARN"
	case strings.HasPrefix(l, "ERROR"):
		return "ERROR"
	default:
		return "INFO"
	}
}

// NormalizeLogSource 把来源归并到 server / http / client。
func NormalizeLogSource(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if validLogSources[s] {
		return s
	}
	return "server"
}

// Append 写入一条日志。调用方已完成脱敏，这里只负责限长与入库。
func (r *LogRepo) Append(source, level, msg string) {
	if r == nil || r.db == nil {
		return
	}
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	if len(msg) > 2000 {
		msg = msg[:2000] + "…"
	}
	_, _ = r.db.Exec(
		`INSERT INTO app_logs(ts_ms, level, source, msg) VALUES(?,?,?,?)`,
		time.Now().UnixMilli(), NormalizeLogLevel(level), NormalizeLogSource(source), msg)
}

func (r *LogRepo) buildWhere(f LogFilter) (string, []any) {
	where := make([]string, 0, 3)
	args := make([]any, 0, 4)
	if len(f.Levels) > 0 {
		ph := make([]string, 0, len(f.Levels))
		seen := map[string]bool{}
		for _, l := range f.Levels {
			n := NormalizeLogLevel(l)
			if seen[n] {
				continue
			}
			seen[n] = true
			ph = append(ph, "?")
			args = append(args, n)
		}
		where = append(where, "level IN ("+strings.Join(ph, ",")+")")
	}
	if len(f.Sources) > 0 {
		ph := make([]string, 0, len(f.Sources))
		seen := map[string]bool{}
		for _, s := range f.Sources {
			n := NormalizeLogSource(s)
			if seen[n] {
				continue
			}
			seen[n] = true
			ph = append(ph, "?")
			args = append(args, n)
		}
		where = append(where, "source IN ("+strings.Join(ph, ",")+")")
	}
	if !f.From.IsZero() {
		where = append(where, "ts_ms >= ?")
		args = append(args, f.From.UnixMilli())
	}
	if !f.To.IsZero() {
		where = append(where, "ts_ms <= ?")
		args = append(args, f.To.UnixMilli())
	}
	if len(where) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(where, " AND "), args
}

// Query 按条件分页查询日志，返回当前页与总条数。
func (r *LogRepo) Query(ctx context.Context, f LogFilter) ([]LogEntry, int, error) {
	if r == nil || r.db == nil {
		return []LogEntry{}, 0, nil
	}
	where, args := r.buildWhere(f)

	var total int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM app_logs`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit := f.Limit
	if limit <= 0 {
		limit = 200
	}
	if limit > 3000 {
		limit = 3000
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	q := `SELECT id, ts_ms, level, source, msg FROM app_logs` + where + ` ORDER BY id DESC LIMIT ? OFFSET ?`
	rows, err := r.db.QueryContext(ctx, q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]LogEntry, 0, limit)
	for rows.Next() {
		var id, ts int64
		var level, source, msg string
		if err := rows.Scan(&id, &ts, &level, &source, &msg); err != nil {
			return nil, 0, err
		}
		out = append(out, LogEntry{
			ID:     id,
			TS:     time.UnixMilli(ts).Format(time.RFC3339),
			Level:  level,
			Source: source,
			Msg:    msg,
		})
	}
	return out, total, rows.Err()
}

// PurgeBefore 删除早于 cutoff 的日志，返回删除条数。
func (r *LogRepo) PurgeBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	if r == nil || r.db == nil {
		return 0, nil
	}
	res, err := r.db.ExecContext(ctx, `DELETE FROM app_logs WHERE ts_ms < ?`, cutoff.UnixMilli())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

package store

import (
	"context"
	"database/sql"
)

// UserPrefs 提供按用户隔离的个性化配置存取（theme/dashboard/map_config 等）。
// 数据存于 user_prefs 表，以 (username, key) 唯一。
type UserPrefs struct{ db *sql.DB }

// NewUserPrefs 构造仓储。
func NewUserPrefs(db *sql.DB) *UserPrefs { return &UserPrefs{db: db} }

// Get 读取某用户某键的配置；不存在返回空串。
func (r *UserPrefs) Get(ctx context.Context, username, key string) string {
	var v string
	err := r.db.QueryRowContext(ctx,
		`SELECT value FROM user_prefs WHERE username=? AND key=?`, username, key).Scan(&v)
	if err != nil {
		return "" // sql.ErrNoRows 视为无配置
	}
	return v
}

// Set 写入/覆盖某用户某键的配置。
func (r *UserPrefs) Set(ctx context.Context, username, key, value string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO user_prefs(username, key, value) VALUES(?,?,?)
		 ON CONFLICT(username, key) DO UPDATE SET value=excluded.value`,
		username, key, value)
	return err
}

// DeleteUser 删除某用户的全部个性化配置（用户删除时调用）。
func (r *UserPrefs) DeleteUser(ctx context.Context, username string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM user_prefs WHERE username=?`, username)
	return err
}

// AllForUser 列出某用户的全部个性化键值对。
// 用于扫描键名随设备 ID 动态变化的按设备隔离键（dashboard_apk_<deviceId> 布局 /
// dashboard_apk_cols_<deviceId> 列数）：这些键无法列入固定白名单，GET 时全量取出
// 后按前缀过滤返回前端。用户级偏好量级很小（数十键），全量扫描代价可忽略。
func (r *UserPrefs) AllForUser(ctx context.Context, username string) (map[string]string, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT key, value FROM user_prefs WHERE username=?`, username)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, nil
}
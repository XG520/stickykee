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
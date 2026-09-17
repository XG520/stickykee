package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrUserExists 表示用户名已存在。
var ErrUserExists = errors.New("username already exists")

// ErrNoUser 表示用户不存在。
var ErrNoUser = errors.New("user not found")

// User 表示一个已注册用户。
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	IsAdmin      bool   `json:"is_admin"`
	CreatedAt    string `json:"created_at"`
}

// UserRepo 提供用户与登录会话的持久化访问。
type UserRepo struct{ db *sql.DB }

// NewUserRepo 构造仓储。
func NewUserRepo(db *sql.DB) *UserRepo { return &UserRepo{db: db} }

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	var admin int
	var createdAt sql.NullString
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &admin, &createdAt)
	u.IsAdmin = admin != 0
	u.CreatedAt = createdAt.String
	return u, err
}

// Count 返回用户数量。
func (r *UserRepo) Count(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// CreateUser 新增用户。first 为 true 时设为管理员。
func (r *UserRepo) CreateUser(ctx context.Context, username, passwordHash string, first bool) (User, error) {
	f, err := r.db.ExecContext(ctx,
		`INSERT INTO users(username, password_hash, is_admin) VALUES(?,?,?)`,
		username, passwordHash, boolToInt(first))
	if err != nil {
		if errSQLiteUnique(err) {
			return User{}, ErrUserExists
		}
		return User{}, err
	}
	_ = f
	return r.GetByUsername(ctx, username)
}

// GetByUsername 按用户名查询用户。
func (r *UserRepo) GetByUsername(ctx context.Context, username string) (User, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, is_admin, created_at FROM users WHERE username=?`, username)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNoUser
	}
	return u, err
}

// SetPassword 更新用户密码哈希。
func (r *UserRepo) SetPassword(ctx context.Context, username, newHash string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash=? WHERE username=?`, newHash, username)
	return err
}

// CreateSession 写入一条登录会话 (id=token)。
func (r *UserRepo) CreateSession(ctx context.Context, token, username string, expiresAt time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO sessions(id, user, expires_at) VALUES(?,?,?)`,
		token, username, expiresAt.UTC().Format(time.RFC3339))
	return err
}

// UserByToken 校验会话 token，返回对应用户名；过期会话会被删除。
func (r *UserRepo) UserByToken(ctx context.Context, token string) (string, bool) {
	if token == "" {
		return "", false
	}
	var username string
	var expires string
	err := r.db.QueryRowContext(ctx,
		`SELECT user, expires_at FROM sessions WHERE id=?`, token).Scan(&username, &expires)
	if err != nil {
		return "", false
	}
	exp, perr := time.Parse(time.RFC3339, expires)
	if perr != nil || !time.Now().Before(exp) {
		_, _ = r.db.ExecContext(ctx, `DELETE FROM sessions WHERE id=?`, token)
		return "", false
	}
	return username, true
}

// DeleteSession 删除单条会话。
func (r *UserRepo) DeleteSession(ctx context.Context, token string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE id=?`, token)
	return err
}

// DeleteUserSessions 删除某用户的全部会话（改密后调用）。
func (r *UserRepo) DeleteUserSessions(ctx context.Context, username string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE user=?`, username)
	return err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// errSQLiteUnique 识别 SQLite 唯一约束冲突。
func errSQLiteUnique(err error) bool {
	msg := fmt.Sprintf("%v", err)
	const uniq = "UNIQUE constraint failed"
	return len(msg) >= len(uniq) && msg[:len(uniq)] == uniq
}

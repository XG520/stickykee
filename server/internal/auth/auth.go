// Package auth 提供前端会话鉴权中间件。
package auth

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const userKey ctxKey = 0

// Identity 表示已认证的登录用户身份。
type Identity struct {
	Username string
	IsAdmin  bool
}

// User 从 context 读取当前登录用户名。
func User(ctx context.Context) (string, bool) {
	id, ok := From(ctx)
	return id.Username, ok
}

// IsAdmin 判断当前登录用户是否为管理员。
func IsAdmin(ctx context.Context) bool {
	id, ok := From(ctx)
	return ok && id.IsAdmin
}

// From 读取当前登录用户的完整身份（用户名 + 管理员标记）。
func From(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(userKey).(Identity)
	return id, ok
}

// WithIdentity 把登录身份写入 context（供鉴权中间件与底层按用户解析的连接复用）。
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, userKey, id)
}

// Option 配置鉴权行为。
type Option struct {
	// Authenticate 校验 bearer token，返回用户身份 (username + is_admin, ok)。
	Authenticate func(token string) (Identity, bool)
}

// Middleware 返回鉴权中间件：一律要求有效 Bearer token，否则 401。
func Middleware(opt Option) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearer(r.Header.Get("Authorization"))
			id, ok := opt.Authenticate(token)
			if token == "" || !ok || id.Username == "" {
				http.Error(w, `{"error":{"code":"unauthorized","message":"missing or invalid token"}}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), userKey, id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearer(h string) string {
	const p = "Bearer "
	if strings.HasPrefix(h, p) {
		return strings.TrimSpace(h[len(p):])
	}
	return ""
}

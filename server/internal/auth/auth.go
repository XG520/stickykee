// Package auth 提供前端会话鉴权中间件。
package auth

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const userKey ctxKey = 0

// User 从 context 读取当前登录用户。
func User(ctx context.Context) (string, bool) {
	u, ok := ctx.Value(userKey).(string)
	return u, ok
}

// Option 配置鉴权行为。
type Option struct {
	// Authenticate 校验 bearer token，返回 (username, ok)。
	// 由外部绑定到会话存储（如 userRepo.UserByToken）。
	Authenticate func(token string) (string, bool)
}

// Middleware 返回鉴权中间件：一律要求有效 Bearer token，否则 401。
func Middleware(opt Option) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearer(r.Header.Get("Authorization"))
			username, ok := opt.Authenticate(token)
			if token == "" || !ok || username == "" {
				http.Error(w, `{"error":{"code":"unauthorized","message":"missing or invalid token"}}`, http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), userKey, username)
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

package handler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/store"
)

// Auth 处理用户注册/登录/登出/改密与状态查询。
type Auth struct {
	repo      *store.UserRepo
	userPrefs *store.UserPrefs
}

// NewAuth 构造 handler。
func NewAuth(repo *store.UserRepo, userPrefs *store.UserPrefs) *Auth {
	return &Auth{repo: repo, userPrefs: userPrefs}
}

// sessionTTL 会话有效期。
const sessionTTL = 30 * 24 * time.Hour

// minPasswordLen 密码最短长度。
const minPasswordLen = 6

// Status GET /api/v1/auth/status —— 是否已有用户，供前端决定是否展示注册。
func (h *Auth) Status(w http.ResponseWriter, r *http.Request) {
	n, err := h.repo.Count(r.Context())
	if err != nil {
		WriteErr(w, 500, "internal", "database error")
		return
	}
	WriteJSON(w, 200, map[string]any{"has_users": n > 0})
}

// Register POST /api/v1/auth/register —— 仅当无任何用户时可注册（首个用户为管理员）。
func (h *Auth) Register(w http.ResponseWriter, r *http.Request) {
	n, err := h.repo.Count(r.Context())
	if err != nil {
		WriteErr(w, 500, "internal", "database error")
		return
	}
	if n > 0 {
		WriteErr(w, 403, "forbidden", "registration is closed")
		return
	}
	var p credentials
	if err := DecodeBody(r, &p); err != nil || !p.valid() {
		WriteErr(w, 400, "bad_request", "username and password (>="+strconv.Itoa(minPasswordLen)+" chars) required")
		return
	}
	if strings.EqualFold(p.Username, AssistantUser) {
		WriteErr(w, 400, "reserved", "该用户名为系统保留（智家助手）")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		WriteErr(w, 500, "internal", "hash failed")
		return
	}
	u, err := h.repo.CreateUser(r.Context(), p.Username, string(hash), true)
	if err != nil {
		WriteErr(w, 500, "internal", "create user failed")
		return
	}
	h.issueSession(w, r.Context(), u.Username, u.IsAdmin)
}

// Login POST /api/v1/auth/login —— 校验密码并签发会话。
func (h *Auth) Login(w http.ResponseWriter, r *http.Request) {
	var p credentials
	if err := DecodeBody(r, &p); err != nil || p.Username == "" || p.Password == "" {
		WriteErr(w, 400, "bad_request", "username and password required")
		return
	}
	u, err := h.repo.GetByUsername(r.Context(), p.Username)
	if errors.Is(err, store.ErrNoUser) {
		WriteErr(w, 401, "unauthorized", "invalid username or password")
		return
	}
	if err != nil {
		WriteErr(w, 500, "internal", "database error")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(p.Password)) != nil {
		WriteErr(w, 401, "unauthorized", "invalid username or password")
		return
	}
	h.issueSession(w, r.Context(), u.Username, u.IsAdmin)
}

// Logout POST /api/v1/auth/logout —— 删除当前会话。
func (h *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token != "" {
		_ = h.repo.DeleteSession(r.Context(), token)
	}
	WriteJSON(w, 200, map[string]any{"ok": true})
}

// ChangePassword POST /api/v1/auth/change-password —— 校验旧密码、更新密码并重发会话。
func (h *Auth) ChangePassword(w http.ResponseWriter, r *http.Request) {
	username, ok := auth.User(r.Context())
	if !ok {
		WriteErr(w, 401, "unauthorized", "missing token")
		return
	}
	var p struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := DecodeBody(r, &p); err != nil || p.NewPassword == "" {
		WriteErr(w, 400, "bad_request", "old_password and new_password required")
		return
	}
	if len(p.NewPassword) < minPasswordLen {
		WriteErr(w, 400, "bad_request", "new password too short (>= "+strconv.Itoa(minPasswordLen)+")")
		return
	}
	u, err := h.repo.GetByUsername(r.Context(), username)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(p.OldPassword)) != nil {
		WriteErr(w, 401, "unauthorized", "old password is incorrect")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		WriteErr(w, 500, "internal", "hash failed")
		return
	}
	if err := h.repo.SetPassword(r.Context(), username, string(hash)); err != nil {
		WriteErr(w, 500, "internal", "update failed")
		return
	}
	// 使该用户其它会话失效，然后重签当前会话。
	_ = h.repo.DeleteUserSessions(r.Context(), username)
	h.issueSession(w, r.Context(), u.Username, u.IsAdmin)
}

// Me GET /api/v1/auth/me —— 返回当前登录用户。
func (h *Auth) Me(w http.ResponseWriter, r *http.Request) {
	username, ok := auth.User(r.Context())
	if !ok {
		WriteErr(w, 401, "unauthorized", "missing token")
		return
	}
	u, err := h.repo.GetByUsername(r.Context(), username)
	if err != nil {
		WriteErr(w, 401, "unauthorized", "user not found")
		return
	}
	// 记账权限随登录态返回：管理员恒为 true；普通用户默认 false（须管理员授权）。
	perm := ReadFinancePerm(r.Context(), h.userPrefs, u.Username)
	WriteJSON(w, 200, map[string]any{
		"username":        u.Username,
		"is_admin":        u.IsAdmin,
		"finance_view":    perm.Allows(false),
		"finance_operate": perm.Operate,
	})
}

// issueSession 生成 token、写入会话并返回登录态。
// 登录响应与 /auth/me 保持一致：一并返回记账权限，否则前端 setAuth 会把权限置为 false，
// 登录后记账入口要等下一次 /me（刷新或 WS reload）才出现，表现为「页面出来了但记账区很久才显示」。
func (h *Auth) issueSession(w http.ResponseWriter, ctx context.Context, username string, isAdmin bool) {
	token := newToken()
	if err := h.repo.CreateSession(ctx, token, username, time.Now().Add(sessionTTL)); err != nil {
		WriteErr(w, 500, "internal", "session create failed")
		return
	}
	// 登录时 ctx 尚无身份，不能直接用 ReadFinancePerm 的管理员兜底：按 isAdmin 显式处理。
	perm := FinancePerm{View: isAdmin, Operate: isAdmin}
	if !isAdmin {
		perm = ReadStoredFinancePerm(ctx, h.userPrefs, username)
	}
	WriteJSON(w, 200, map[string]any{
		"token":           token,
		"username":        username,
		"is_admin":        isAdmin,
		"finance_view":    perm.Allows(false),
		"finance_operate": perm.Operate,
	})
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (c credentials) valid() bool {
	return c.Username != "" && len(c.Password) >= minPasswordLen
}

// newToken 生成 32 字节随机 HEX token。
func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// 极低概率；回退到时间戳加随机，仅兜底。
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(b)
}

// bearerToken 从请求头取原样 token（登出用）。
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if strings.HasPrefix(h, p) {
		return strings.TrimSpace(h[len(p):])
	}
	return ""
}

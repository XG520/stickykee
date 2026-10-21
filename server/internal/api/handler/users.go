package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// Users 处理用户管理（仅管理员可用）。
type Users struct {
	repo      *store.UserRepo
	userPrefs *store.UserPrefs
	manager   *ha.Manager
}

// NewUsers 构造 handler。
func NewUsers(repo *store.UserRepo, userPrefs *store.UserPrefs, manager *ha.Manager) *Users {
	return &Users{repo: repo, userPrefs: userPrefs, manager: manager}
}

func (h *Users) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	return requireAdmin(w, r)
}

// List GET /users —— 列出全部用户（含各自地图 Key 使用策略）。
func (h *Users) List(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	list, err := h.repo.List(r.Context())
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	type view struct {
		ID          int64  `json:"id"`
		Username    string `json:"username"`
		IsAdmin     bool   `json:"is_admin"`
		CreatedAt   string `json:"created_at"`
		MapUseAdmin bool   `json:"map_use_admin"`
		HasHAToken  bool   `json:"has_ha_token"`
	}
	out := make([]view, 0, len(list))
	for _, u := range list {
		mc := parseMapConfig(h.userPrefs.Get(r.Context(), u.Username, "map_config"))
		out = append(out, view{
			ID:          u.ID,
			Username:    u.Username,
			IsAdmin:     u.IsAdmin,
			CreatedAt:   u.CreatedAt,
			MapUseAdmin: boolVal(mc["use_admin"]),
			HasHAToken:  h.userPrefs.Get(r.Context(), u.Username, "ha_token") != "",
		})
	}
	WriteJSON(w, 200, out)
}

// Create POST /users —— 创建用户，仅管理员。
func (h *Users) Create(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var p struct {
		Username string `json:"username"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if p.Username == "" || len(p.Password) < minPasswordLen {
		WriteErr(w, 400, "bad_request", "username and password (>=6 chars) required")
		return
	}
	if strings.EqualFold(p.Username, AssistantUser) {
		WriteErr(w, 400, "reserved", "该用户名为系统保留（智家助手）")
		return
	}
	if p.Username == bdRegBackendUser {
		WriteErr(w, 400, "reserved", "该用户名为系统保留（服务端虚拟设备）")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(p.Password), bcrypt.DefaultCost)
	if err != nil {
		WriteErr(w, 500, "internal", "hash failed")
		return
	}
	u, err := h.repo.Create(r.Context(), p.Username, string(hash), p.IsAdmin)
	if err != nil {
		if err == store.ErrUserExists {
			WriteErr(w, 409, "user_exists", "username already exists")
			return
		}
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 201, u)
}

// Update PUT /users/{username} —— 重置密码 / 改组角色，仅管理员。
func (h *Users) Update(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	username := chi.URLParam(r, "username")
	var p struct {
		Password *string `json:"password"`
		IsAdmin  *bool   `json:"is_admin"`
	}
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if p.Password != nil {
		if len(*p.Password) < minPasswordLen {
			WriteErr(w, 400, "bad_request", "password too short (>=6 chars)")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(*p.Password), bcrypt.DefaultCost)
		if err != nil {
			WriteErr(w, 500, "internal", "hash failed")
			return
		}
		if err := h.repo.SetPassword(r.Context(), username, string(hash)); err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
		// 改密后使该用户旧会话失效
		_ = h.repo.DeleteUserSessions(r.Context(), username)
	}
	if p.IsAdmin != nil {
		if err := h.protectLastAdmin(r, username, *p.IsAdmin); err != nil {
			WriteErr(w, 403, "forbidden", err.Error())
			return
		}
		if err := h.repo.SetIsAdmin(r.Context(), username, *p.IsAdmin); err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
	}
	u, err := h.repo.GetByUsername(r.Context(), username)
	if err != nil {
		WriteErr(w, 404, "not_found", "user not found")
		return
	}
	WriteJSON(w, 200, u)
}

// SetMapPolicy PUT /users/{username}/map —— 管理员决定该用户高德 key 用谁的。
func (h *Users) SetMapPolicy(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	username := chi.URLParam(r, "username")
	var p struct {
		UseAdmin *bool `json:"use_admin"`
	}
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if p.UseAdmin == nil {
		WriteErr(w, 400, "bad_request", "use_admin required")
		return
	}
	cur := map[string]any{}
	if v := h.userPrefs.Get(r.Context(), username, "map_config"); v != "" {
		_ = json.Unmarshal([]byte(v), &cur)
	}
	cur["use_admin"] = *p.UseAdmin
	b, _ := json.Marshal(cur)
	if err := h.userPrefs.Set(r.Context(), username, "map_config", string(b)); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]any{"username": username, "use_admin": *p.UseAdmin})
}

// SetHAToken PUT /users/{username}/ha —— 管理员代配（或清除）该用户的 HA 个人 token。
// 修改后立即重建该用户的 HA 连接，无需重启服务器。
func (h *Users) SetHAToken(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	username := chi.URLParam(r, "username")
	if _, err := h.repo.GetByUsername(r.Context(), username); err != nil {
		WriteErr(w, 404, "not_found", "user not found")
		return
	}
	var p struct {
		Token string `json:"token"`
	}
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if err := h.userPrefs.Set(r.Context(), username, "ha_token", p.Token); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.manager.InvalidateActive(r.Context(), username)
	slog.Info("admin set ha token", "user", username, "configured", p.Token != "")
	WriteJSON(w, 200, map[string]any{
		"username":     username,
		"has_ha_token": p.Token != "",
	})
}

// Delete DELETE /users/{username} —— 删除用户，仅管理员；禁止删除最后一个管理员与自身。
func (h *Users) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	username := chi.URLParam(r, "username")
	me, ok := auth.User(r.Context())
	if ok && me == username {
		WriteErr(w, 403, "forbidden", "cannot delete self")
		return
	}
	u, err := h.repo.GetByUsername(r.Context(), username)
	if err != nil {
		WriteErr(w, 404, "not_found", "user not found")
		return
	}
	if u.IsAdmin {
		n, err := h.repo.CountAdmins(r.Context())
		if err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
		if n <= 1 {
			WriteErr(w, 403, "forbidden", "cannot delete the last admin")
			return
		}
	}
	if err := h.repo.Delete(r.Context(), username); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	_ = h.repo.DeleteUserSessions(r.Context(), username)
	_ = h.userPrefs.DeleteUser(r.Context(), username)
	WriteJSON(w, 200, map[string]any{"ok": true})
}

// protectLastAdmin 在降级管理员前保护最后一个管理员。返回 error 表示应拒绝。
func (h *Users) protectLastAdmin(r *http.Request, username string, targetAdmin bool) error {
	if targetAdmin {
		return nil // 设为管理员无需保护
	}
	u, err := h.repo.GetByUsername(r.Context(), username)
	if err != nil || !u.IsAdmin {
		return nil // 该用户本就不是管理员
	}
	n, err := h.repo.CountAdmins(r.Context())
	if err != nil {
		return err
	}
	if n <= 1 {
		return errLastAdmin
	}
	return nil
}

var errLastAdmin = &errUnavailable{msg: "cannot demote the last admin"}

type errUnavailable struct{ msg string }

func (e *errUnavailable) Error() string { return e.msg }

package handler

import (
	"context"
	"net/http"
	"strconv"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// Instances 提供实例 CRUD 与切换。
type Instances struct {
	repo    *store.InstanceRepo
	manager *ha.Manager
}

// NewInstances 构造 handler。
func NewInstances(repo *store.InstanceRepo, manager *ha.Manager) *Instances {
	return &Instances{repo: repo, manager: manager}
}

type instancePayload struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Token   string `json:"token"`
	SkipTLS bool   `json:"skip_tls"` // 忽略 TLS 证书验证
}

// List GET /instances
func (h *Instances) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.List(r.Context())
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, list, active)
}

// requireAdmin 校验当前用户是否为管理员；非管理员返回 403 并返回 false。
func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if auth.IsAdmin(r.Context()) {
		return true
	}
	WriteErr(w, 403, "forbidden", "admin required")
	return false
}

// Create POST /instances
func (h *Instances) Create(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var p instancePayload
	if err := DecodeBody(r, &p); err != nil || p.URL == "" {
		WriteErr(w, 400, "bad_request", "name/url required")
		return
	}
	if p.Name == "" {
		p.Name = p.URL
	}
	i, err := h.repo.Create(r.Context(), p.Name, p.URL, p.Token, p.SkipTLS)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 201, i, active)
}

func (h *Instances) idParam(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func (h *Instances) require(c context.Context, id int64, w http.ResponseWriter) bool {
	if _, err := h.repo.Get(c, id); err != nil {
		WriteErr(w, 404, "not_found", "instance not found")
		return false
	}
	return true
}

// Update PUT /instances/{id}
func (h *Instances) Update(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	id, ok := h.idParam(r)
	if !ok || !h.require(r.Context(), id, w) {
		return
	}
	var p instancePayload
	if err := DecodeBody(r, &p); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if p.Name == "" {
		p.Name = p.URL
	}
	if err := h.repo.Update(r.Context(), id, p.Name, p.URL, p.Token, p.SkipTLS); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.manager.Invalidate(id)
	i, _ := h.repo.Get(r.Context(), id)
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, i, active)
}

// Delete DELETE /instances/{id}
func (h *Instances) Delete(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	id, ok := h.idParam(r)
	if !ok {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		WriteErr(w, 404, "not_found", "instance not found")
		return
	}
	h.manager.Invalidate(id)
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, true, active)
}

// Switch POST /instances/{id}/switch 把实例置为 active
func (h *Instances) Switch(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	id, ok := h.idParam(r)
	if !ok || !h.require(r.Context(), id, w) {
		return
	}
	if err := h.repo.SetActive(r.Context(), id); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteMeta(w, 200, id, id)
}

// Status GET /instances/{id}/status 探测连接状态
func (h *Instances) Status(w http.ResponseWriter, r *http.Request) {
	id, ok := h.idParam(r)
	if !ok || !h.require(r.Context(), id, w) {
		return
	}
	state := "connected"
	detail := map[string]any{}
	rst, err := h.manager.Rest(r.Context(), id)
	if err != nil {
		state = "error"
	} else if cfg, cerr := rst.GetConfig(r.Context()); cerr != nil {
		state = "error"
		detail["error"] = cerr.Error()
	} else {
		detail["instance_name"] = cfg["location_name"]
		detail["version"] = cfg["version"]
	}
	active, _ := h.manager.ActiveID(r.Context())
	WriteMeta(w, 200, map[string]any{
		"id":     id,
		"state":  state,
		"detail": detail,
	}, active)
}

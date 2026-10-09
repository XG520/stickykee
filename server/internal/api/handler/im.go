package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/store"

	"github.com/go-chi/chi/v5"
)

// imMaxUpload 聊天图片大小上限（8MB）。
const imMaxUpload = 8 << 20

// imExts 允许的图片扩展名（配合 MIME 嗅探双重校验）。
var imExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
}

// Im 提供用户间消息与仪表盘共享。
// 会话/文本/共享均按登录用户隔离；接受/拒绝等动作强校验归属（仅接收方可执行）。
type Im struct {
	msgs      *store.MessageRepo
	userPrefs *store.UserPrefs
	users     *store.UserRepo
	hub       *hub.Hub
	uploadDir string // 聊天图片落盘根目录（空串禁用图片发送）
}

// NewIm 构造 handler。uploadDir 为空时图片上传/读取不可用。
func NewIm(msgs *store.MessageRepo, userPrefs *store.UserPrefs, users *store.UserRepo, hb *hub.Hub, uploadDir string) *Im {
	return &Im{msgs: msgs, userPrefs: userPrefs, users: users, hub: hb, uploadDir: uploadDir}
}

// requireTarget 校验目标用户存在；不存在返回 404 并写错误响应。
func (h *Im) requireTarget(w http.ResponseWriter, r *http.Request, to string) bool {
	if _, err := h.users.GetByUsername(r.Context(), to); err != nil {
		WriteErr(w, 404, "not_found", "目标用户不存在")
		return false
	}
	return true
}

// notify 尽力通过实时通道通知某用户刷新消息角标/会话。
func (h *Im) notify(each string) {
	if each == "" || h.hub == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{"type": "im", "data": map[string]any{}})
	h.hub.BroadcastUser(each, payload)
}

// Contacts GET /messages/contacts  返回所有其他用户名（供任意登录用户发起会话）。
// 仅返回用户名，不含角色/map/HA 等敏感信息。路由须注册在 /{user} 之前。
func (h *Im) Contacts(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	list, err := h.users.List(r.Context())
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	names := make([]string, 0, len(list))
	for _, u := range list {
		if u.Username != me {
			names = append(names, u.Username)
		}
	}
	WriteJSON(w, 200, names)
}

// Conversations GET /messages/conversations
func (h *Im) Conversations(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	list, err := h.msgs.Conversations(r.Context(), me)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// History GET /messages/{user}
func (h *Im) History(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	other := chi.URLParam(r, "user")
	if other == "" {
		WriteErr(w, 400, "bad_request", "user required")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	list, err := h.msgs.History(r.Context(), me, other, limit, before)
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, list)
}

// MarkRead POST /messages/{user}/read  把 other 发给我的消息全部标已读。
func (h *Im) MarkRead(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	other := chi.URLParam(r, "user")
	if other == "" {
		WriteErr(w, 400, "bad_request", "user required")
		return
	}
	if err := h.msgs.SetFromRead(r.Context(), me, other); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	// 通知发送方：已读回执实时可见（对方线程里「已读」角标即刻更新）
	h.notify(other)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// SendText POST /messages/{user}  {content}
func (h *Im) SendText(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if strings.TrimSpace(body.Content) == "" {
		WriteErr(w, 400, "bad_request", "content required")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "text", body.Content, "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// SendDevice POST /messages/{user}/device  {device:{entity_id,name,icon,domain,device_class,...}}
// 发送一张设备卡片；接收方按 entity_id 匹配自身实体后实时显示状态并可直接控制（toggle）。
func (h *Im) SendDevice(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Device map[string]any `json:"device"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if body.Device == nil {
		WriteErr(w, 400, "bad_request", "device required")
		return
	}
	entityID, _ := body.Device["entity_id"].(string)
	if strings.TrimSpace(entityID) == "" {
		WriteErr(w, 400, "bad_request", "device.entity_id required")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	payload, err := json.Marshal(body.Device)
	if err != nil {
		WriteErr(w, 500, "internal", "serialize device failed")
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "device", string(payload), "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// SendShare POST /messages/{user}/share  {dashboard}
func (h *Im) SendShare(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Dashboard string `json:"dashboard"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if strings.TrimSpace(body.Dashboard) == "" {
		WriteErr(w, 400, "bad_request", "dashboard required")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "share", body.Dashboard, "pending")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id, "card_count": store.CardCount(body.Dashboard)})
}

// Accept POST /messages/{id}/accept   接收方同意：复制仪表盘并标记为已接受。
func (h *Im) Accept(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	msg, dashboard, err := h.msgs.GetFull(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	if msg.To != me {
		WriteErr(w, 403, "forbidden", "仅接收方可接受该共享")
		return
	}
	if msg.Type != "share" {
		WriteErr(w, 400, "bad_request", "not a share message")
		return
	}
	if msg.Status == "accepted" {
		WriteJSON(w, 200, map[string]any{"ok": true, "status": "accepted"})
		return
	}
	if err := h.userPrefs.Set(r.Context(), me, "dashboard", dashboard); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	if err := h.msgs.SetStatus(r.Context(), id, "accepted"); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(msg.From)
	WriteJSON(w, 200, map[string]any{"ok": true, "status": "accepted", "card_count": store.CardCount(dashboard)})
}

// Decline POST /messages/{id}/decline  接收方拒绝。
func (h *Im) Decline(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	msg, _, err := h.msgs.GetFull(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	if msg.To != me {
		WriteErr(w, 403, "forbidden", "仅接收方可拒绝该共享")
		return
	}
	if msg.Type != "share" {
		WriteErr(w, 400, "bad_request", "not a share message")
		return
	}
	if err := h.msgs.SetStatus(r.Context(), id, "declined"); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(msg.From)
	WriteJSON(w, 200, map[string]any{"ok": true, "status": "declined"})
}

// imRandName 生成随机文件名（16 字节 hex），防猜测/防覆盖/防路径注入。
func imRandName(ext string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b) + ext
}

// SendImage POST /messages/{user}/image  multipart{file}
// 聊天图片：扩展名白名单 + MIME 嗅探双重校验，随机名落盘 <uploadDir>/im/，
// 消息 payload 只存相对 URL，读取走鉴权的 ImageFiles 接口。
func (h *Im) SendImage(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	if h.uploadDir == "" {
		WriteErr(w, 501, "not_implemented", "服务端未启用图片存储目录")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, imMaxUpload)
	if err := r.ParseMultipartForm(imMaxUpload); err != nil {
		WriteErr(w, 400, "bad_request", "图片上传失败或超过 8MB 限制")
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		WriteErr(w, 400, "bad_request", "缺少 file 字段")
		return
	}
	defer f.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	if !imExts[ext] {
		WriteErr(w, 400, "bad_request", "仅支持 jpg/png/gif/webp 图片")
		return
	}
	// MIME 嗅探：防改扩展名伪装；明确拒绝 SVG（可携带脚本，不宜作为用户上传图片）
	head := make([]byte, 512)
	n, _ := f.Read(head)
	ctype := http.DetectContentType(head[:n])
	if ctype == "image/svg+xml" || !strings.HasPrefix(ctype, "image/") {
		WriteErr(w, 400, "bad_request", "文件内容不是受支持的位图图片")
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		WriteErr(w, 500, "internal", "读取文件失败")
		return
	}
	dir := filepath.Join(h.uploadDir, "im")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		WriteErr(w, 500, "internal", "创建图片目录失败")
		return
	}
	name := imRandName(ext)
	dst, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		WriteErr(w, 500, "internal", "写入图片失败")
		return
	}
	if _, err := io.Copy(dst, f); err != nil {
		dst.Close()
		WriteErr(w, 500, "internal", "写入图片失败")
		return
	}
	dst.Close()
	payload, _ := json.Marshal(map[string]string{
		"url":  "/api/v1/im-files/im/" + name,
		"name": hdr.Filename,
	})
	id, err := h.msgs.Create(r.Context(), me, to, "image", string(payload), "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// ImageFiles GET /im-files/*  已登录用户读取聊天图片。
// 限定 uploadDir 目录内（清洗路径 + 双重前缀校验防穿越）。
func (h *Im) ImageFiles(w http.ResponseWriter, r *http.Request) {
	if h.uploadDir == "" {
		WriteErr(w, 501, "not_implemented", "服务端未启用图片存储目录")
		return
	}
	rel := chi.URLParam(r, "*")
	// Clean 强制以 / 开头解析，任何 .. 逃逸都会被规整出来，再整体拒绝
	cleaned := path.Clean("/" + rel)
	if cleaned == "/" || strings.Contains(cleaned, "..") {
		WriteErr(w, 400, "bad_request", "invalid path")
		return
	}
	full := filepath.Join(h.uploadDir, filepath.FromSlash(strings.TrimPrefix(cleaned, "/")))
	// 双保险：最终路径必须仍在 uploadDir 下
	absRoot, err1 := filepath.Abs(h.uploadDir)
	absFull, err2 := filepath.Abs(full)
	if err1 != nil || err2 != nil || !strings.HasPrefix(absFull, absRoot+string(filepath.Separator)) {
		WriteErr(w, 400, "bad_request", "invalid path")
		return
	}
	fh, err := os.Open(absFull)
	if err != nil {
		WriteErr(w, 404, "not_found", "file not found")
		return
	}
	defer fh.Close()
	st, err := fh.Stat()
	if err != nil || st.IsDir() {
		WriteErr(w, 404, "not_found", "file not found")
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(strings.ToLower(filepath.Ext(absFull))))
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, st.Name(), st.ModTime(), fh)
}

// Recall POST /messages/{id}/recall  发送方撤回文本/图片消息（share/device 有独立流转，不支持撤回）。
// 撤回后 status=recalled，历史读取时载荷已被清空，双方仅显示「消息已撤回」占位。
func (h *Im) Recall(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	id, ok := pathID(r)
	if !ok {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	msg, _, err := h.msgs.GetFull(r.Context(), id)
	if err != nil {
		WriteErr(w, 404, "not_found", "message not found")
		return
	}
	if msg.From != me {
		WriteErr(w, 403, "forbidden", "仅发送方可撤回消息")
		return
	}
	if msg.Type != "text" && msg.Type != "image" {
		WriteErr(w, 400, "bad_request", "该类型消息不支持撤回")
		return
	}
	if msg.Status == "recalled" {
		WriteJSON(w, 200, map[string]any{"ok": true})
		return
	}
	if err := h.msgs.SetStatus(r.Context(), id, "recalled"); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(msg.To)
	WriteJSON(w, 200, map[string]any{"ok": true})
}

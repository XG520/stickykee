package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/client"
	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/secure"
	"stickynuo/server/internal/store"
	"stickynuo/server/internal/tts"

	"github.com/go-chi/chi/v5"
)

// imMaxUpload 聊天文件大小上限（图片/语音 8MB）。
const imMaxUpload = 8 << 20

// imExts 允许的图片扩展名（配合 MIME 嗅探双重校验）。
var imExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
}

// imAudioExts 允许的语音扩展名。
// webm/opus：安卓 Chrome 与多数桌面浏览器；m4a/mp4(aac)：iOS Safari/WebView；ogg：部分安卓。
var imAudioExts = map[string]bool{
	".webm": true, ".m4a": true, ".mp4": true, ".aac": true, ".ogg": true, ".wav": true,
}

func init() {
	// 确保语音文件读取时 Content-Type 正确（部分平台 mime 表缺这些映射）
	_ = mime.AddExtensionType(".webm", "audio/webm")
	_ = mime.AddExtensionType(".m4a", "audio/mp4")
	_ = mime.AddExtensionType(".aac", "audio/aac")
	_ = mime.AddExtensionType(".ogg", "audio/ogg")
	_ = mime.AddExtensionType(".wav", "audio/wav")
}

// AssistantUser 是 Home Assistant 语音助手在聊天系统中的保留虚拟用户名。
// 不允许注册同名真实用户；消息线程与普通用户一致地落库。
const AssistantUser = "ha-assistant"

// AssistantName 助手在 UI 上的显示名。
const AssistantName = "智家助手"

// Im 提供用户间消息与仪表盘共享。
// 会话/文本/共享均按登录用户隔离；接受/拒绝等动作强校验归属（仅接收方可执行）。
type Im struct {
	msgs      *store.MessageRepo
	userPrefs *store.UserPrefs
	users     *store.UserRepo
	hub       *hub.Hub
	keys      *secure.Store // 会话密钥（信封加解密）
	ha        *ha.Manager   // 助手线程：调用 active 实例的 conversation/process
	uploadDir string        // 聊天图片落盘根目录（空串禁用图片发送）
}

// NewIm 构造 handler。uploadDir 为空时图片上传/读取不可用。
func NewIm(msgs *store.MessageRepo, userPrefs *store.UserPrefs, users *store.UserRepo, hb *hub.Hub, keys *secure.Store, haMgr *ha.Manager, uploadDir string) *Im {
	return &Im{msgs: msgs, userPrefs: userPrefs, users: users, hub: hb, keys: keys, ha: haMgr, uploadDir: uploadDir}
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
	_ = writeEnvelope(h.keys, w, r, list)
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
	_ = writeEnvelope(h.keys, w, r, list)
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
	if err := decodeEnvelope(h.keys, r, &body); err != nil {
		if errors.Is(err, errNoSessionKey) {
			WriteErr(w, 400, "no_session_key", "会话密钥不存在，请重新握手")
			return
		}
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if strings.TrimSpace(body.Content) == "" {
		WriteErr(w, 400, "bad_request", "content required")
		return
	}
	// 虚拟会话：HA 语音助手（不走用户存在性校验）
	if to == AssistantUser {
		h.chatAssistant(w, r, me, body.Content)
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "text", body.Content, "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	_ = writeEnvelope(h.keys, w, r, map[string]any{"id": id})
}

// haUnavailableReply 把 HA 连接类错误转成给用户的中文提示（聊天会话内展示）。
func haUnavailableReply(err error) string {
	if errors.Is(err, ha.ErrNoHAToken) {
		return "还没有配置 Home Assistant 个人 Token，请在「设置 → Home Assistant」中填写后再来找我。"
	}
	return "还没有连接 Home Assistant 实例，请先在设置中添加实例并填写个人 Token。"
}

// ListAgents GET /api/v1/messages/assistant/agents
// 枚举 HA 中可用的对话代理（内置 + 已安装的 LLM 代理），供设置页选择。
// selected 为当前保存的偏好：空/"auto" 表示自动选择。
func (h *Im) ListAgents(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	rest, err := h.ha.Rest(r.Context(), 0)
	if err != nil {
		haErr(w, err)
		return
	}
	agents, err := rest.ListAgents(r.Context())
	if err != nil {
		haErr(w, err)
		return
	}
	WriteJSON(w, 200, map[string]any{
		"agents":   agents,
		"selected": h.userPrefs.Get(r.Context(), me, "ha_assist_agent"),
	})
}

// ListTTS GET /api/v1/messages/tts/services
// 枚举 HA 中可用的 TTS 引擎（tts.* 实体），供朗读引擎下拉动态展示（刷新方式与对话代理一致）。
func (h *Im) ListTTS(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	rest, err := h.ha.Rest(r.Context(), 0)
	if err != nil {
		haErr(w, err)
		return
	}
	svcs, err := rest.ListTTSServices(r.Context())
	if err != nil {
		haErr(w, err)
		return
	}
	WriteJSON(w, 200, map[string]any{
		"services": svcs,
		"selected": h.userPrefs.Get(r.Context(), me, "tts_engine"),
	})
}

// chatAssistant 处理与 HA Assist 的会话：
// 用户消息先落库 → 调 active 实例 /api/conversation/process（携带上次 conversation_id 保持上下文）
// → 助手回复落库 → 实时通知本人 → 密文返回两条消息 id。
func (h *Im) chatAssistant(w http.ResponseWriter, r *http.Request, me, text string) {
	id1, err := h.msgs.Create(r.Context(), me, AssistantUser, "text", text, "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	rest, err := h.ha.Rest(r.Context(), 0) // 0 = active 实例，使用本人 token
	if err != nil {
		// 连接不可用（未配实例/未填 Token）：以助手身份在会话内给出友好提示，
		// 保证对话线程总能得到应答，而不是向用户抛英文原始错误。
		id2, cerr := h.msgs.Create(r.Context(), AssistantUser, me, "text", haUnavailableReply(err), "", "")
		if cerr != nil {
			WriteErr(w, 500, "internal", cerr.Error())
			return
		}
		h.notify(me)
		_ = writeEnvelope(h.keys, w, r, map[string]any{"id": id1, "reply_id": id2})
		return
	}
	cid := h.userPrefs.Get(r.Context(), me, "ha_chat_cid")
	// 对话代理：用户偏好优先（设置页可选），留空则自动发现已安装的 LLM 代理
	agent := strings.TrimSpace(h.userPrefs.Get(r.Context(), me, "ha_assist_agent"))
	reply, newCID, err := rest.Conversation(r.Context(), text, cid, agent)
	if err != nil {
		WriteErr(w, 502, "assistant_error", "助手暂不可用："+err.Error())
		return
	}
	if newCID != "" && newCID != cid {
		_ = h.userPrefs.Set(r.Context(), me, "ha_chat_cid", newCID)
	}
	id2, err := h.msgs.Create(r.Context(), AssistantUser, me, "text", reply, "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(me)
	_ = writeEnvelope(h.keys, w, r, map[string]any{"id": id1, "reply_id": id2})
}

// chatAssistantVoice 处理发给 HA Assist 的语音消息：
// 用户音频落库 → 经 Assist pipeline WebSocket（STT → intent）得到文字回复
// → 助手回复落库 → 实时通知本人 → 密文返回两条消息 id。
// 识别失败时也以助手文字回复收尾，保证线程总能得到应答。
func (h *Im) chatAssistantVoice(w http.ResponseWriter, r *http.Request, me string, audio []byte, mime, payload string) {
	id1, err := h.msgs.Create(r.Context(), me, AssistantUser, "audio", payload, "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	rest, err := h.ha.Rest(r.Context(), 0)
	if err != nil {
		haErr(w, err)
		return
	}
	cid := h.userPrefs.Get(r.Context(), me, "ha_chat_cid")

	var reply, newCID string
	if mime == "audio/wav" {
		reply, newCID, err = rest.PipelineVoice(r.Context(), audio, cid)
	} else {
		err = fmt.Errorf("语音识别需要 WAV 格式，请更新客户端后重试")
	}
	if err != nil {
		if errors.Is(err, ha.ErrNoHAToken) || strings.Contains(err.Error(), "no configured home assistant instance") {
			reply = haUnavailableReply(err)
		} else {
			reply = "这段语音我没听清（" + err.Error() + "）。可以再试一次，或改用文字输入。"
		}
	}
	if newCID != "" && newCID != cid {
		_ = h.userPrefs.Set(r.Context(), me, "ha_chat_cid", newCID)
	}
	id2, err := h.msgs.Create(r.Context(), AssistantUser, me, "text", reply, "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(me)
	_ = writeEnvelope(h.keys, w, r, map[string]any{"id": id1, "reply_id": id2})
}

// mimeFromExt 根据扩展名推断 MIME（HA conversation input.audio 需要）。
func mimeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".webm":
		return "audio/webm"
	case ".m4a", ".aac":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".wav":
		return "audio/wav"
	default:
		return "audio/webm"
	}
}

// AssistantTTS GET /messages/assistant/tts?text=...
// 合成语音并返回音频流：
//   - tts_engine 以 "edge" 开头（如 edge / edge:zh-CN-YunxiNeural）→ 微软 Edge TTS（免费、高质量中文）
//   - 否则 → HA 已配置的 TTS 引擎（留空用 HA 默认）
func (h *Im) AssistantTTS(w http.ResponseWriter, r *http.Request) {
	text := strings.TrimSpace(r.URL.Query().Get("text"))
	if text == "" {
		WriteErr(w, 400, "bad_request", "text required")
		return
	}
	// 支持调用方显式指定引擎（网页端/手机端设置分离后由前端按端传入）；缺省回退存储的网页端设置
	engine := strings.TrimSpace(r.URL.Query().Get("engine"))
	if engine == "" {
		engine = strings.TrimSpace(h.userPrefs.Get(r.Context(), rUsername(r), "tts_engine"))
	}
	// 旧版兼容：曾把「智能选择」持久化为 "auto"，等价于留空
	if engine == "auto" {
		engine = ""
	}
	// browser 为浏览器端 Web Speech API 引擎，不经后端；误路由到此接口时明确报错
	if engine == "browser" {
		WriteErr(w, 400, "bad_request", "浏览器 TTS 在客户端合成，无需请求后端")
		return
	}

	var audio []byte
	var ctype string
	var err error

	if strings.HasPrefix(engine, "edge") {
		// Edge TTS：微软免费在线服务，音色与 Azure TTS 一致，接近豆包质量
		voice := "zh-CN-XiaoxiaoNeural"
		if idx := strings.Index(engine, ":"); idx >= 0 {
			voice = strings.TrimSpace(engine[idx+1:])
		}
		edge := tts.NewEdgeTTS()
		audio, ctype, err = edge.Synth(r.Context(), text, voice)
	} else {
		// HA TTS / 智能选择：engine 非空为显式选择的 HA 引擎 ID；为空则智能选择。
		var rest *client.Rest
		rest, err = h.ha.Rest(r.Context(), 0)
		if err == nil {
			audio, ctype, err = rest.TTS(r.Context(), engine, text)
		}
		// 智能选择模式下 HA 不可用（未配置实例）或 TTS 失败时，回退 Edge TTS，
		// 避免「只有浏览器自带 TTS 有声音」的兜底体验。
		if err != nil && engine == "" {
			audio, ctype, err = tts.NewEdgeTTS().Synth(r.Context(), text, "zh-CN-XiaoxiaoNeural")
		}
	}
	if err != nil {
		WriteErr(w, 502, "tts_error", err.Error())
		return
	}
	if ctype == "" {
		ctype = "audio/wav"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(audio)
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
	id, err := h.msgs.Create(r.Context(), me, to, "device", string(payload), "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// shareTargetsValid 分享目标端取值集合。
var shareTargetsValid = map[string]bool{"web": true, "apk": true}

// normalizeShareTargets 规整目标端：小写、去重、仅保留 web/apk；
// 未指定时默认仅 Web 端（兼容旧客户端）；给了非法值但无合法值时报错。
func normalizeShareTargets(in []string) ([]string, bool) {
	if len(in) == 0 {
		return []string{"web"}, true
	}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || !shareTargetsValid[t] {
			continue
		}
		seen[t] = true
	}
	switch {
	case seen["web"] && seen["apk"]:
		return []string{"web", "apk"}, true
	case seen["apk"]:
		return []string{"apk"}, true
	case seen["web"]:
		return []string{"web"}, true
	}
	return nil, false
}

// SendShare POST /messages/{user}/share  {dashboard, targets}
// targets：分享目标端 ["web","apk"] 子集，决定接收方接受后覆盖哪一端的仪表盘。
func (h *Im) SendShare(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	var body struct {
		Dashboard string   `json:"dashboard"`
		Targets   []string `json:"targets"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	if strings.TrimSpace(body.Dashboard) == "" {
		WriteErr(w, 400, "bad_request", "dashboard required")
		return
	}
	targets, ok := normalizeShareTargets(body.Targets)
	if !ok {
		WriteErr(w, 400, "bad_request", "targets 仅支持 web / apk")
		return
	}
	if !h.requireTarget(w, r, to) {
		return
	}
	meta, _ := json.Marshal(targets)
	id, err := h.msgs.Create(r.Context(), me, to, "share", body.Dashboard, "pending", string(meta))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id, "card_count": store.CardCount(body.Dashboard), "targets": targets})
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
	// 目标端决定覆盖哪些键：web→dashboard，apk→dashboard_apk（全局回退键）。
	// apk 写入 dashboard_apk 而非某台设备的 dashboard_apk_<deviceId>，因为分享时无法
	// 指定具体设备——写入全局回退键后，所有尚未单独定制的手机都会经回退链
	// （dashboard_apk_<deviceId> → dashboard_apk → dashboard）拾取这份共享布局；
	// 已单独定制的手机不受影响（其自身键优先）。旧消息无 targets 按仅 Web 端处理。
	targets := msg.Targets
	if len(targets) == 0 {
		targets = []string{"web"}
	}
	keys := make([]string, 0, len(targets))
	for _, t := range targets {
		k := "dashboard"
		if t == "apk" {
			k = "dashboard_apk"
		}
		if err := h.userPrefs.Set(r.Context(), me, k, dashboard); err != nil {
			WriteErr(w, 500, "internal", err.Error())
			return
		}
		keys = append(keys, k)
	}
	// 通知接收者本人全部设备热刷新仪表盘：keys 指明受影响的布局键
	// （dashboard=Web 端 / dashboard_apk=手机端全局回退），前端按本端键前缀过滤，
	// 未受影响的端不重载（另端排版不受影响）。
	if h.hub != nil {
		if b, err := json.Marshal(map[string]any{"type": "prefs", "keys": keys}); err == nil {
			h.hub.BroadcastUser(me, b)
		}
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
	id, err := h.msgs.Create(r.Context(), me, to, "image", string(payload), "", "")
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.notify(to)
	WriteJSON(w, 200, map[string]any{"id": id})
}

// SendAudio POST /messages/{user}/audio  multipart{file, duration}
// 语音消息：扩展名白名单 + MIME 嗅探（纯音频 webm/mp4 常被嗅探成 video/*，按容器一并接受），
// 随机名落盘 <uploadDir>/im/，消息 payload 存 {url,name,duration}。
func (h *Im) SendAudio(w http.ResponseWriter, r *http.Request) {
	me := rUsername(r)
	to := chi.URLParam(r, "user")
	if to == "" || to == me {
		WriteErr(w, 400, "bad_request", "invalid target")
		return
	}
	// 虚拟会话：HA 智家助手（不走用户存在性校验）
	if to != AssistantUser {
		if !h.requireTarget(w, r, to) {
			return
		}
	}
	if h.uploadDir == "" {
		WriteErr(w, 501, "not_implemented", "服务端未启用文件存储目录")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, imMaxUpload)
	if err := r.ParseMultipartForm(imMaxUpload); err != nil {
		WriteErr(w, 400, "bad_request", "语音上传失败或超过 8MB 限制")
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		WriteErr(w, 400, "bad_request", "缺少 file 字段")
		return
	}
	defer f.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	if !imAudioExts[ext] {
		WriteErr(w, 400, "bad_request", "仅支持 webm/m4a/aac/ogg/wav 语音")
		return
	}
	// MIME 嗅探：webm/mp4 容器纯音频常被识别为 video/webm、video/mp4，属正常；
	// 其余必须是 audio/*
	head := make([]byte, 512)
	n, _ := f.Read(head)
	ctype := http.DetectContentType(head[:n])
	okAudio := strings.HasPrefix(ctype, "audio/") || strings.Contains(ctype, "webm") || ctype == "video/mp4"
	if !okAudio {
		WriteErr(w, 400, "bad_request", "文件内容不是受支持的语音")
		return
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		WriteErr(w, 500, "internal", "读取文件失败")
		return
	}
	dir := filepath.Join(h.uploadDir, "im")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		WriteErr(w, 500, "internal", "创建语音目录失败")
		return
	}
	name := imRandName(ext)
	dst, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		WriteErr(w, 500, "internal", "写入语音失败")
		return
	}
	if _, err := io.Copy(dst, f); err != nil {
		dst.Close()
		WriteErr(w, 500, "internal", "写入语音失败")
		return
	}
	dst.Close()
	duration, _ := strconv.Atoi(strings.TrimSpace(r.FormValue("duration")))
	if duration < 0 {
		duration = 0
	}
	payload, _ := json.Marshal(map[string]any{
		"url":      "/api/v1/im-files/im/" + name,
		"name":     hdr.Filename,
		"duration": duration,
	})
	// 发给 HA 智家助手的语音：落库音频消息后走 Assist 语音对话（STT）
	if to == AssistantUser {
		audioBytes, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			WriteErr(w, 500, "internal", "读取语音失败")
			return
		}
		h.chatAssistantVoice(w, r, me, audioBytes, mimeFromExt(ext), string(payload))
		return
	}
	id, err := h.msgs.Create(r.Context(), me, to, "audio", string(payload), "", "")
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
	if msg.Type != "text" && msg.Type != "image" && msg.Type != "audio" {
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

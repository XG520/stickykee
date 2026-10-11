// Package client 封装对 Home Assistant 的 HTTP/REST 与 WebSocket 访问。
package client

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"stickynuo/server/internal/ha/model"
)

// Rest 是 HA REST API 客户端。
type Rest struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewRest 构造 REST 客户端；insecureTLS 为 true 时信任自签名证书（本地 HA 常用）。
func NewRest(baseURL, token string, insecureTLS bool) *Rest {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureTLS}, // #nosec G402: 本地 HA 自签名
	}
	return &Rest{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second, Transport: transport},
	}
}

// do 发起带 Bearer 认证的请求并解析 JSON 到 out。
func (c *Rest) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("ha request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("ha status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// GetRaw 获取 HA 原始资源（如图片/头像）的字节内容与 content-type。
// path 支持相对路径与绝对 URL（如 TTS proxy 返回的完整地址）。
func (c *Rest) GetRaw(ctx context.Context, path string) ([]byte, string, error) {
	addr := path
	if !strings.HasPrefix(path, "http://") && !strings.HasPrefix(path, "https://") {
		addr = c.baseURL + path
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, addr, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("ha raw: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("ha status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, "", err
	}
	return body, resp.Header.Get("Content-Type"), nil
}

// PostJSON 通用 POST 请求（带 Bearer 认证），用于 mobile_app 设备注册等自定义接口。
func (c *Rest) PostJSON(ctx context.Context, path string, body any, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out)
}

// ProbeWebhook POST 到 HA webhook 并显式返回 HTTP 状态码与响应体（不要求 2xx）。
// 用于探测 webhook 是否仍有效：区分「网络错误」「HTTP 非 2xx」与「200 但空响应体」。
// 返回的 err 仅表示网络层面失败（连接/超时等）；HTTP 响应一律以 status 体现，
// 空响应体的 200 会解析为空的 map（不再因 Decode 失败误判为有效）。
func (c *Rest) ProbeWebhook(ctx context.Context, path string, body any) (int, map[string]any, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	out := map[string]any{}
	if resp.StatusCode < 300 {
		_ = json.NewDecoder(resp.Body).Decode(&out) // 忽略解码错误：空/非 JSON 响应体保持空 map
	}
	return resp.StatusCode, out, nil
}

// GetStates 拉取全部实体状态。
func (c *Rest) GetStates(ctx context.Context) ([]model.EntityState, error) {
	var out []model.EntityState
	if err := c.do(ctx, http.MethodGet, "/api/states", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetConfig 拉取 HA 配置（instance_name 等）。
func (c *Rest) GetConfig(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	if err := c.do(ctx, http.MethodGet, "/api/config", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ServiceData 控制设备：domain+service+entity_id+data。
func (c *Rest) CallService(ctx context.Context, domain, service, entityID string, data map[string]any) error {
	payload := map[string]any{}
	if entityID != "" {
		payload["entity_id"] = entityID
	}
	for k, v := range data {
		payload[k] = v
	}
	var out json.RawMessage
	if err := c.do(ctx, http.MethodPost,
		"/api/services/"+url.PathEscape(domain)+"/"+url.PathEscape(service),
		payload, &out); err != nil {
		return err
	}
	return nil
}

// Toggle 快捷开关：按域映射到实际存在的 HA 服务。
// 多数域（light/switch/fan/cover/media_player 等）提供 toggle 服务，
// 但 lock（仅 lock/unlock/open）、script（run）、scene（turn_on）、
// button/input_button（press）没有 toggle，直接调用会被 HA 以 404 拒绝。
func (c *Rest) Toggle(ctx context.Context, entityID string) error {
	domain := model.DomainOf(entityID)
	switch domain {
	case "lock":
		return c.toggleLock(ctx, entityID)
	case "script":
		return c.CallService(ctx, domain, "run", entityID, nil)
	case "scene":
		return c.CallService(ctx, domain, "turn_on", entityID, nil)
	case "button", "input_button":
		return c.CallService(ctx, domain, "press", entityID, nil)
	default:
		return c.CallService(ctx, domain, "toggle", entityID, nil)
	}
}

// toggleLock 按当前状态选择服务：locked / unlocking → unlock，其余 → lock。
func (c *Rest) toggleLock(ctx context.Context, entityID string) error {
	var st struct {
		State string `json:"state"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/states/"+url.PathEscape(entityID), nil, &st); err != nil {
		return err
	}
	svc := "lock"
	if st.State == "locked" || st.State == "unlocking" {
		svc = "unlock"
	}
	return c.CallService(ctx, "lock", svc, entityID, nil)
}

// GetHistory 拉取某个实体的状态历史（HA 默认最多 1 天，可传 start）。
func (c *Rest) GetHistory(ctx context.Context, entityIDs []string, start time.Time, end time.Time) ([]json.RawMessage, error) {
	q := url.Values{}
	if len(entityIDs) > 0 {
		q.Set("filter_entity_id", strings.Join(entityIDs, ","))
	}
	q.Set("start_time", start.Format(time.RFC3339))
	if !end.IsZero() {
		q.Set("end_time", end.Format(time.RFC3339))
	}
	q.Set("include_start_time_state", "false")
	var out []json.RawMessage
	if err := c.do(ctx, http.MethodGet, "/api/history/period?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetServices 拉取 HA 服务目录（/api/services）：每个域下的服务及其字段定义（fields），
// 供前端「调用服务」动作选择服务并生成参数表单。结构直接透传，避免与 HA 版本漂移。
func (c *Rest) GetServices(ctx context.Context) ([]map[string]any, error) {
	var out []map[string]any
	if err := c.do(ctx, http.MethodGet, "/api/services", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetScenes 拉取全部场景。
func (c *Rest) GetScenes(ctx context.Context) ([]model.EntityState, error) {
	var states []model.EntityState
	if err := c.do(ctx, http.MethodGet, "/api/states", nil, &states); err != nil {
		return nil, err
	}
	scenes := make([]model.EntityState, 0, len(states))
	for _, s := range states {
		if model.DomainOf(s.EntityID) == "scene" {
			scenes = append(scenes, s)
		}
	}
	return scenes, nil
}

// GetAutomations 拉取全部自动化实体。
func (c *Rest) GetAutomations(ctx context.Context) ([]model.EntityState, error) {
	var states []model.EntityState
	if err := c.do(ctx, http.MethodGet, "/api/states", nil, &states); err != nil {
		return nil, err
	}
	out := make([]model.EntityState, 0, len(states))
	for _, s := range states {
		if model.DomainOf(s.EntityID) == "automation" {
			out = append(out, s)
		}
	}
	return out, nil
}

// GetLogbook 拉取自动化/场景/事件日志。
func (c *Rest) GetLogbook(ctx context.Context, start time.Time) ([]json.RawMessage, error) {
	q := url.Values{}
	q.Set("start_time", start.Format(time.RFC3339))
	var out []json.RawMessage
	if err := c.do(ctx, http.MethodGet, "/api/logbook?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetAutomationConfig 读取单个自动化配置（读/改/删均以 automation_id 定位，
// 即 entity_id 去掉 "automation." 前缀的部分）。
func (c *Rest) GetAutomationConfig(ctx context.Context, automationID string) (map[string]any, error) {
	var out map[string]any
	if err := c.do(ctx, http.MethodGet, "/api/config/automation/config/"+automationID, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// CreateAutomation 创建自动化。创建端点 /api/config/automation/config/new 需要管理员权限，
// 该路径不存在时（旧版 HA）回退到无 id 的 POST；其余错误（如 401 令牌非管理员）直接上抛，
// 避免被回退路径的 404 覆盖成误导性报错。
func (c *Rest) CreateAutomation(ctx context.Context, cfg map[string]any) (string, error) {
	var out struct {
		AutomationID string `json:"automation_id"`
	}
	errNew := c.do(ctx, http.MethodPost, "/api/config/automation/config/new", cfg, &out)
	if errNew == nil && out.AutomationID != "" {
		return out.AutomationID, nil
	}
	if errNew != nil && !strings.Contains(errNew.Error(), "404") {
		return "", errNew
	}
	// 回退新版端点（部分 HA 版本仅支持无 id 的 POST）。
	if err := c.do(ctx, http.MethodPost, "/api/config/automation/config", cfg, &out); err != nil {
		return "", err
	}
	return out.AutomationID, nil
}

// UpdateAutomation 更新自动化配置。
func (c *Rest) UpdateAutomation(ctx context.Context, automationID string, cfg map[string]any) error {
	return c.do(ctx, http.MethodPost, "/api/config/automation/config/"+automationID, cfg, nil)
}

// DeleteAutomation 删除自动化。
func (c *Rest) DeleteAutomation(ctx context.Context, automationID string) error {
	return c.do(ctx, http.MethodDelete, "/api/config/automation/config/"+automationID, nil, nil)
}

// preferredAgent 从实体注册表发现用户安装的对话代理（conversation.* 实体）。
// 排除内置代理 conversation.home_assistant（只认设备控制意图），按实体 ID 排序
// 取第一个，保证多代理时选择稳定。查询失败或未安装 LLM 代理时返回空串，走 HA 默认。
func (c *Rest) preferredAgent(ctx context.Context) string {
	agents, err := c.ListAgents(ctx)
	if err != nil {
		return ""
	}
	for _, a := range agents {
		if !a.Builtin {
			return a.ID
		}
	}
	return ""
}

// Agent 描述一个对话代理实体。
type Agent struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Builtin bool   `json:"builtin"`
}

// ListAgents 枚举 HA 中的对话代理（conversation.* 实体），内置代理排最前，其余按 ID 排序。
func (c *Rest) ListAgents(ctx context.Context) ([]Agent, error) {
	var states []struct {
		EntityID   string         `json:"entity_id"`
		Attributes map[string]any `json:"attributes"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/states", nil, &states); err != nil {
		return nil, err
	}
	agents := []Agent{}
	for _, st := range states {
		if !strings.HasPrefix(st.EntityID, "conversation.") {
			continue
		}
		name, _ := st.Attributes["friendly_name"].(string)
		if name == "" {
			name = st.EntityID
		}
		agents = append(agents, Agent{ID: st.EntityID, Name: name, Builtin: st.EntityID == "conversation.home_assistant"})
	}
	sort.Slice(agents, func(i, j int) bool {
		if agents[i].Builtin != agents[j].Builtin {
			return agents[i].Builtin
		}
		return agents[i].ID < agents[j].ID
	})
	return agents, nil
}

// Conversation 调用 HA Assist：POST /api/conversation/process。
// conversationID 为空时由 HA 开新会话；返回 (中文回复, conversation_id)。
// 动作类意图常不返回语音文本，按 data.success/failed 生成中文回执。
// agentID：用户在设置页选择的代理实体 ID；为空或 "auto" 时自动发现
// 已安装的 LLM 代理——内置代理只认设备控制意图，闲聊类问题会答非所问。
func (c *Rest) Conversation(ctx context.Context, text, conversationID, agentID string) (string, string, error) {
	req := map[string]any{"text": text, "language": "zh-CN"}
	if agentID == "" || agentID == "auto" {
		agentID = c.preferredAgent(ctx)
	}
	if agentID != "" {
		req["agent_id"] = agentID
	}
	if conversationID != "" {
		req["conversation_id"] = conversationID
	}
	var out struct {
		ConversationID string `json:"conversation_id"`
		Response       struct {
			ConversationID string `json:"conversation_id"`
			ResponseType   string `json:"response_type"`
			Speech         struct {
				Plain struct {
					Speech string `json:"speech"`
				} `json:"plain"`
			} `json:"speech"`
			Data struct {
				Success []struct {
					Name    string `json:"name"`
					Success bool   `json:"success"`
				} `json:"success"`
				Failed []struct {
					Path string `json:"path"`
				} `json:"failed"`
			} `json:"data"`
		} `json:"response"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/conversation/process", req, &out); err != nil {
		return "", "", err
	}
	cid := out.Response.ConversationID
	if cid == "" {
		cid = out.ConversationID
	}
	if speech := strings.TrimSpace(out.Response.Speech.Plain.Speech); speech != "" {
		return speech, cid, nil
	}
	if len(out.Response.Data.Failed) > 0 {
		return "有设备没能控制成功，要不要看看设备状态？", cid, nil
	}
	if len(out.Response.Data.Success) > 0 {
		names := make([]string, 0, len(out.Response.Data.Success))
		for _, s := range out.Response.Data.Success {
			if s.Success && s.Name != "" {
				names = append(names, s.Name)
			}
		}
		if len(names) > 0 {
			return "好的，已执行：" + strings.Join(names, "、"), cid, nil
		}
		return "好的，已执行", cid, nil
	}
	return "我没太理解，可以再说清楚一些吗？", cid, nil
}

// TTS 调用 HA 的 TTS 生成语音，返回音频字节与 MIME。
// engine 为 TTS 实体 ID（如 tts.piper）；为空时自动发现第一个可用 TTS 实体。
// 依赖：HA 侧已配置任意 TTS 集成（如 Piper / Edge TTS / 火山引擎 / 阿里云 / XTTS 等）。
func (c *Rest) TTS(ctx context.Context, engine, text string) ([]byte, string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, "", fmt.Errorf("empty text")
	}
	// 未指定引擎：从实体注册表里找第一个 tts.* 实体
	if engine == "" {
		var states []struct {
			EntityID string `json:"entity_id"`
		}
		if err := c.do(ctx, http.MethodGet, "/api/states", nil, &states); err != nil {
			return nil, "", fmt.Errorf("发现 TTS 引擎失败: %w", err)
		}
		for _, st := range states {
			if strings.HasPrefix(st.EntityID, "tts.") {
				engine = st.EntityID
				break
			}
		}
	}
	if engine == "" {
		return nil, "", fmt.Errorf("HA 未配置 TTS 引擎，请在 Home Assistant 中安装 TTS 集成（如 Piper / Edge TTS / 火山引擎等）")
	}
	// 官方接口：POST /api/tts_get_url {engine_id|platform, message} → {url}
	var out struct {
		URL  string `json:"url"`
		Path string `json:"path"`
	}
	req := map[string]any{"engine_id": engine, "message": text, "language": "zh-CN"}
	if err := c.do(ctx, http.MethodPost, "/api/tts_get_url", req, &out); err != nil {
		// 兼容旧参数名 platform 再试一次
		req2 := map[string]any{"platform": engine, "message": text, "language": "zh-CN"}
		if err2 := c.do(ctx, http.MethodPost, "/api/tts_get_url", req2, &out); err2 != nil {
			return nil, "", fmt.Errorf("tts_get_url: %w", err)
		}
	}
	// tts_proxy 返回二进制音频（url 可能为绝对地址）
	audio, ctype, err := c.GetRaw(ctx, out.URL)
	if err != nil && out.Path != "" {
		audio, ctype, err = c.GetRaw(ctx, out.Path)
	}
	if err != nil {
		return nil, "", fmt.Errorf("tts fetch: %w", err)
	}
	return audio, ctype, nil
}

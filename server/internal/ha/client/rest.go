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
	"strings"
	"time"

	"homecanvas/server/internal/ha/model"
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
func (c *Rest) GetRaw(ctx context.Context, path string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
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

// Toggle 快捷开关（调用 domain 的 toggle 服务）。
func (c *Rest) Toggle(ctx context.Context, entityID string) error {
	domain := model.DomainOf(entityID)
	return c.CallService(ctx, domain, "toggle", entityID, nil)
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

// CreateAutomation 创建自动化。HA 多数版本用 POST /api/config/automation/config/new 创建，
// 新版也支持直接 POST /api/config/automation/config。返回 automation_id。
func (c *Rest) CreateAutomation(ctx context.Context, cfg map[string]any) (string, error) {
	var out struct {
		AutomationID string `json:"automation_id"`
	}
	// 先试 /new（旧版 HA 唯一创建端点；该路径不存在时返回 404）。
	if err := c.do(ctx, http.MethodPost, "/api/config/automation/config/new", cfg, &out); err == nil && out.AutomationID != "" {
		return out.AutomationID, nil
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

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"stickykee/server/internal/store"
)

const (
	// 交互式请求（卡片生成 / 连通测试）超时。
	aiInteractiveTimeout = 90 * time.Second
	// 后台任务的 HTTP 超时必须大于其调用方 context（诊断 / 日志分析均为 3 分钟），
	// 否则长上下文推理会在 context 到期之前被 client 提前打断。
	aiBackgroundTimeout = 5 * time.Minute
)

// AI OpenAI 兼容接口转发：前端卡片工作室的「AI 生成」功能经本端点请求模型。
// 配置解析顺序：当前用户自己的 ai_config（必须含 key）→ 管理员全局 ai_config。
// key 永不回传明文，也不允许前端直接持有——转发时由后端注入。
type AI struct {
	userPrefs *store.UserPrefs
	repo      *store.InstanceRepo
	client    *http.Client
	bgClient  *http.Client
}

func NewAI(userPrefs *store.UserPrefs, repo *store.InstanceRepo) *AI {
	return &AI{
		userPrefs: userPrefs,
		repo:      repo,
		client:    &http.Client{Timeout: aiInteractiveTimeout},
		bgClient:  &http.Client{Timeout: aiBackgroundTimeout},
	}
}

type aiConfig struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`
}

func parseAIConfig(raw string) aiConfig {
	var cfg aiConfig
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg)
	}
	return cfg
}

// resolveConfig 返回当前请求实际生效的 AI 配置及来源（user / global / none）。
// 用户自配的 key 优先；没有则回退管理员全局配置。
func (h *AI) resolveConfig(r *http.Request) (aiConfig, string) {
	return h.resolveConfigFor(r.Context(), rUsername(r))
}

// resolveConfigFor 按用户名解析生效配置（诊断等后台任务没有 http.Request 时使用）。
func (h *AI) resolveConfigFor(ctx context.Context, username string) (aiConfig, string) {
	if username != "" {
		own := parseAIConfig(h.userPrefs.Get(ctx, username, "ai_config"))
		if strings.TrimSpace(own.APIKey) != "" {
			return own, "user"
		}
	}
	globalRaw, _ := h.repo.GetPref(ctx, "ai_config")
	global := parseAIConfig(globalRaw)
	if strings.TrimSpace(global.APIKey) != "" {
		return global, "global"
	}
	return aiConfig{}, "none"
}

// normalizeBase 补默认地址并去掉尾部斜杠。
func normalizeBase(base string) string {
	base = strings.TrimSpace(base)
	if base == "" {
		return "https://api.openai.com/v1"
	}
	return strings.TrimRight(base, "/")
}

// upstream 以 OpenAI chat/completions 协议请求模型，返回原始 JSON 与耗时。
func (h *AI) upstream(ctx context.Context, cfg aiConfig, payload map[string]any) ([]byte, int, time.Duration, error) {
	return h.do(h.client, ctx, cfg, payload)
}

// do 使用指定 client 发起请求：交互式请求与后台长任务使用不同的超时。
func (h *AI) do(client *http.Client, ctx context.Context, cfg aiConfig, payload map[string]any) ([]byte, int, time.Duration, error) {
	upBody, _ := json.Marshal(payload)
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, normalizeBase(cfg.BaseURL)+"/chat/completions", bytes.NewReader(upBody))
	if err != nil {
		return nil, 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, time.Since(start), err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return raw, resp.StatusCode, time.Since(start), err
}

// Chat POST /ai/chat 请求体：{ messages: [{role, content}, ...] }（OpenAI chat 格式）。
// 非流式转发 {base_url}/chat/completions，按统一响应包返回模型 JSON。
func (h *AI) Chat(w http.ResponseWriter, r *http.Request) {
	cfg, _ := h.resolveConfig(r)
	if cfg.APIKey == "" {
		WriteErr(w, 400, "ai_not_configured", "请先在「设置 → AI」配置 API Key（或由管理员配置全局 AI）")
		return
	}
	if strings.TrimSpace(cfg.Model) == "" {
		WriteErr(w, 400, "ai_not_configured", "请先在「设置 → AI」配置模型名称")
		return
	}

	var body struct {
		Messages []map[string]string `json:"messages"`
	}
	if err := DecodeBody(r, &body); err != nil || len(body.Messages) == 0 {
		WriteErr(w, 400, "bad_request", "messages 不能为空")
		return
	}
	// 限制上下文规模，防止异常大请求打满上游配额
	for _, m := range body.Messages {
		if len(m["content"]) > 48000 {
			WriteErr(w, 400, "bad_request", "单条消息过长")
			return
		}
	}

	raw, status, _, err := h.upstream(r.Context(), cfg, map[string]any{
		"model":       cfg.Model,
		"messages":    body.Messages,
		"temperature": 0.3,
	})
	if err != nil {
		WriteErr(w, 502, "ai_upstream", "请求模型服务失败："+err.Error())
		return
	}
	if status != http.StatusOK {
		WriteErr(w, 502, "ai_upstream", "模型服务返回 "+http.StatusText(status)+"："+string(raw[:min(len(raw), 300)]))
		return
	}

	// 上游 JSON 原样作为 data 返回，前端按 OpenAI 响应结构取 choices[0].message.content。
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		WriteErr(w, 502, "ai_upstream", "模型返回内容不是合法 JSON")
		return
	}
	WriteJSON(w, 200, out)
}

// Test POST /ai/test 用已保存的有效配置发一条最小请求，验证 URL / Key / 模型是否可用。
func (h *AI) Test(w http.ResponseWriter, r *http.Request) {
	cfg, source := h.resolveConfig(r)
	if cfg.APIKey == "" {
		WriteErr(w, 400, "ai_not_configured", "尚未配置 API Key")
		return
	}
	if strings.TrimSpace(cfg.Model) == "" {
		WriteErr(w, 400, "ai_not_configured", "尚未配置模型名称")
		return
	}

	raw, status, elapsed, err := h.upstream(r.Context(), cfg, map[string]any{
		"model":      cfg.Model,
		"messages":   []map[string]string{{"role": "user", "content": "ping"}},
		"max_tokens": 1,
	})
	if err != nil {
		WriteErr(w, 502, "ai_upstream", "连接失败："+err.Error())
		return
	}
	if status != http.StatusOK {
		WriteErr(w, 502, "ai_upstream", "模型服务返回 "+http.StatusText(status)+"："+string(raw[:min(len(raw), 300)]))
		return
	}
	WriteJSON(w, 200, map[string]any{
		"ok":         true,
		"model":      cfg.Model,
		"base_url":   normalizeBase(cfg.BaseURL),
		"source":     source,
		"latency_ms": elapsed.Milliseconds(),
	})
}

// CompleteByUser 供后台任务（如诊断报告）按用户名调用模型，直接返回文本内容。
func (h *AI) CompleteByUser(ctx context.Context, username string, messages []map[string]any, temperature float64) (string, error) {
	cfg, _ := h.resolveConfigFor(ctx, username)
	if strings.TrimSpace(cfg.APIKey) == "" {
		return "", fmt.Errorf("尚未配置 AI：请在「设置 → AI」填写 API Key")
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return "", fmt.Errorf("尚未配置 AI 模型名称")
	}
	raw, status, elapsed, err := h.do(h.bgClient, ctx, cfg, map[string]any{
		"model":       cfg.Model,
		"messages":    messages,
		"temperature": temperature,
	})
	if err != nil {
		// 长日志 + 长上下文推理可能超过 90 秒；这里用后台专用超时，并在超时报错时给出排查方向。
		if errors.Is(err, context.DeadlineExceeded) || elapsed >= aiBackgroundTimeout {
			return "", fmt.Errorf("请求模型服务超时（已等待 %d 秒）：请检查「设置 → AI」的 Base URL 是否以 /v1 结尾、模型是否可用，或缩小筛选的日志范围后重试", int(elapsed.Seconds()))
		}
		return "", fmt.Errorf("请求模型服务失败：%w", err)
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("模型服务返回 %s：%s", http.StatusText(status), string(raw[:min(len(raw), 300)]))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("模型返回内容无法解析")
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("模型返回为空")
	}
	return out.Choices[0].Message.Content, nil
}

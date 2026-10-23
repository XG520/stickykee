package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/store"
)

// AI OpenAI 兼容接口转发：前端卡片设计器的「AI 设计」功能经本端点请求模型。
// base_url / api_key / model 存于当前用户的 ai_config 偏好（api_key 永不回传明文，
// 也不允许前端直接持有——转发时由后端注入），避免密钥暴露给浏览器与其他用户。
type AI struct {
	userPrefs *store.UserPrefs
	client    *http.Client
}

func NewAI(userPrefs *store.UserPrefs) *AI {
	return &AI{userPrefs: userPrefs, client: &http.Client{Timeout: 55 * time.Second}}
}

type aiConfig struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`
}

// Chat POST /ai/chat 请求体：{ messages: [{role, content}, ...] }（OpenAI chat 格式）。
// 非流式转发 {base_url}/chat/completions，把模型的 JSON 响应原样回给前端。
func (h *AI) Chat(w http.ResponseWriter, r *http.Request) {
	id, ok := auth.From(r.Context())
	if !ok || id.Username == "" {
		WriteErr(w, 401, "unauthorized", "missing token")
		return
	}

	var cfg aiConfig
	if raw := h.userPrefs.Get(r.Context(), id.Username, "ai_config"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg)
	}
	if cfg.APIKey == "" {
		WriteErr(w, 400, "ai_not_configured", "请先在 AI 设置中配置 API Key")
		return
	}
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		base = "https://api.openai.com/v1"
	}
	if cfg.Model == "" {
		WriteErr(w, 400, "ai_not_configured", "请先在 AI 设置中配置模型名称")
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
		if len(m["content"]) > 32000 {
			WriteErr(w, 400, "bad_request", "单条消息过长")
			return
		}
	}

	upBody, _ := json.Marshal(map[string]any{
		"model":       cfg.Model,
		"messages":    body.Messages,
		"temperature": 0.2,
	})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base+"/chat/completions", bytes.NewReader(upBody))
	if err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	resp, err := h.client.Do(req)
	if err != nil {
		WriteErr(w, 502, "ai_upstream", "请求模型服务失败："+err.Error())
		return
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		WriteErr(w, 502, "ai_upstream", "读取模型响应失败")
		return
	}
	if resp.StatusCode != http.StatusOK {
		WriteErr(w, 502, "ai_upstream", "模型服务返回 "+resp.Status+"："+string(raw[:min(len(raw), 300)]))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	_, _ = w.Write(raw)
}

package handler

import (
	"encoding/json"
	"net/http"
)

// meta 放置响应元信息。
type meta struct {
	ActiveInstance int64 `json:"active_instance,omitempty"`
}

// envelope 统一响应包装。
type envelope struct {
	Data  any      `json:"data,omitempty"`
	Meta  *meta    `json:"meta,omitempty"`
	Error *errBody `json:"error,omitempty"`
}

type errBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteJSON 写标准响应。
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Data: data})
}

// WriteMeta 带回 active 实例信息的响应。
func WriteMeta(w http.ResponseWriter, status int, data any, activeID int64) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Data: data, Meta: &meta{ActiveInstance: activeID}})
}

// WriteErr 写错误响应。
func WriteErr(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Error: &errBody{Code: code, Message: message}})
}

// DecodeBody 解析请求体。
func DecodeBody(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}
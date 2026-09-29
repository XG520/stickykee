package api

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"net/http"
	"strings"
)

// etagJSON 为「GET + JSON 响应」计算 ETag，并支持 If-None-Match → 304。
//
// 做法：把响应体缓冲起来，处理完再决定回 304 还是回正文（ETag 必须拿到完整正文才能算）。
// 只对 JSON 生效：图片/图标/媒体以及 WebSocket 升级请求（带 Upgrade 头）直接透传，不缓冲。
//
// 配合 `Cache-Control: private, no-cache`（可缓存但每次必须校验），浏览器会带着
// If-None-Match 复用已存副本，未变化的接口（实体全量、偏好、注册表）重复访问几乎零流量。
// 用 private 是因为这些响应是按用户鉴权的，不允许共享缓存。
//
// 注意：这里不设置 Content-Length，交给外层压缩中间件与 net/http 自行决定，
// 否则压缩后长度不一致会导致客户端等待超时。
func etagJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 非 GET 或 WebSocket 升级：不拦截（升级依赖 Hijack，必须让原始 writer 直通）
		if r.Method != http.MethodGet || r.Header.Get("Upgrade") != "" {
			next.ServeHTTP(w, r)
			return
		}

		rec := &bufferedWriter{header: make(http.Header), status: http.StatusOK, body: &bytes.Buffer{}}
		next.ServeHTTP(rec, r)

		// 只处理成功的 JSON 响应；其余（图片、静态资源、错误码）原样回写
		if rec.status != http.StatusOK || !strings.HasPrefix(rec.header.Get("Content-Type"), "application/json") {
			copyHeader(w.Header(), rec.header)
			w.WriteHeader(rec.status)
			_, _ = w.Write(rec.body.Bytes())
			return
		}

		sum := sha1.Sum(rec.body.Bytes())
		etag := `"` + hex.EncodeToString(sum[:16]) + `"`

		copyHeader(w.Header(), rec.header)
		if w.Header().Get("Vary") == "" {
			w.Header().Set("Vary", "Accept-Encoding")
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "private, no-cache")

		if matchETag(r.Header.Get("If-None-Match"), etag) {
			// 304 无正文：删掉 Content-Type，避免外层压缩中间件仍按 JSON 处理
			w.Header().Del("Content-Type")
			w.WriteHeader(http.StatusNotModified)
			return
		}

		w.WriteHeader(rec.status)
		_, _ = w.Write(rec.body.Bytes())
	})
}

// bufferedWriter 只记录 header/status/body，不立即写出。
type bufferedWriter struct {
	header http.Header
	status int
	body   *bytes.Buffer
	wrote  bool
}

func (b *bufferedWriter) Header() http.Header { return b.header }

func (b *bufferedWriter) WriteHeader(code int) {
	if !b.wrote {
		b.status = code
		b.wrote = true
	}
}

func (b *bufferedWriter) Write(p []byte) (int, error) {
	b.wrote = true
	return b.body.Write(p)
}

func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

// matchETag 判断 If-None-Match 是否命中（支持逗号分隔的多值与 *）。
func matchETag(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(part), "W/"))
		if part == etag || part == "*" {
			return true
		}
	}
	return false
}
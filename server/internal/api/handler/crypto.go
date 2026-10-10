package handler

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"stickynuo/server/internal/secure"
)

// encVersion 密文信封版本号，便于未来协议升级时兼容。
const encVersion = 1

// maxEnvelopeBody 信封请求体大小上限（聊天文本远小于此，1MB 足够）。
const maxEnvelopeBody = 1 << 20

// Crypto 处理加密握手：公钥下发与会话密钥协商。
type Crypto struct {
	srv  *secure.Server
	keys *secure.Store
}

// NewCrypto 构造 handler：生成进程级 ECDH P-256 私钥。
func NewCrypto(keys *secure.Store) (*Crypto, error) {
	srv, err := secure.NewServer()
	if err != nil {
		return nil, err
	}
	return &Crypto{srv: srv, keys: keys}, nil
}

// PubKey GET /crypto/pubkey —— 公开接口：下发 ECDH P-256 公钥（未压缩点 hex）。
func (h *Crypto) PubKey(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]any{
		"ver":  encVersion,
		"alg":  "ECDH-P256 + HKDF-SHA256 + AES-256-GCM",
		"pub":  h.srv.PubHex(),
		"info": secure.Info,
	})
}

// Handshake POST /crypto/handshake {pub} —— 登录态：提交客户端临时公钥，
// 服务端 ECDH 派生会话密钥，按会话 token 存入内存。
func (h *Crypto) Handshake(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Pub string `json:"pub"`
	}
	if err := DecodeBody(r, &body); err != nil || body.Pub == "" {
		WriteErr(w, 400, "bad_request", "pub required")
		return
	}
	pubBytes, err := hex.DecodeString(body.Pub)
	if err != nil {
		WriteErr(w, 400, "bad_request", "invalid public key hex")
		return
	}
	key, err := h.srv.Derive(pubBytes)
	if err != nil {
		WriteErr(w, 400, "bad_request", err.Error())
		return
	}
	h.keys.Set(bearerToken(r), key)
	WriteJSON(w, 200, map[string]bool{"ok": true})
}

// Drop 删除当前会话的密钥（登出后调用；不写响应，可与 Logout 串联）。
func (h *Crypto) Drop(r *http.Request) {
	h.keys.Delete(bearerToken(r))
}

// envelopeBody 密文线包：{"enc":1,"d":"<base64(nonce||ciphertext)>"}。
type envelopeBody struct {
	Enc int    `json:"enc"`
	D   string `json:"d"`
}

// errNoSessionKey 信封加解密时会话密钥缺失。
var errNoSessionKey = errors.New("no session key")

// decodeEnvelope 解析请求体到 dst：支持密文信封（enc:1）与普通明文 JSON。
// 密文时按当前会话 token 取密钥，AES-GCM 解密后再解析。
func decodeEnvelope(keys *secure.Store, r *http.Request, dst any) error {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxEnvelopeBody))
	if err != nil {
		return err
	}
	var env envelopeBody
	if json.Unmarshal(raw, &env) == nil && env.Enc == encVersion && env.D != "" {
		key, ok := keys.Get(bearerToken(r))
		if !ok {
			return errNoSessionKey
		}
		blob, err := base64.StdEncoding.DecodeString(env.D)
		if err != nil {
			return err
		}
		plain, err := secure.Open(key, blob)
		if err != nil {
			return err
		}
		return json.Unmarshal(plain, dst)
	}
	// 明文兼容（理论上新版前端始终发信封）
	return json.Unmarshal(raw, dst)
}

// writeEnvelope 用当前会话密钥密封响应并写出。
// 会话密钥缺失（服务重启后尚未重新握手）→ 400 no_session_key，客户端据此重握手重试。
func writeEnvelope(keys *secure.Store, w http.ResponseWriter, r *http.Request, v any) error {
	key, ok := keys.Get(bearerToken(r))
	if !ok {
		WriteErr(w, 400, "no_session_key", "会话密钥不存在，请重新握手")
		return errNoSessionKey
	}
	plain, err := json.Marshal(v)
	if err != nil {
		WriteErr(w, 500, "internal", "marshal failed")
		return err
	}
	blob, err := secure.Seal(key, plain)
	if err != nil {
		WriteErr(w, 500, "internal", "seal failed")
		return err
	}
	WriteJSON(w, 200, envelopeBody{Enc: encVersion, D: base64.StdEncoding.EncodeToString(blob)})
	return nil
}

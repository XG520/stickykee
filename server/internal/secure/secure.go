// Package secure 提供聊天数据的应用层加密传输：
// ECDH P-256 协商共享密钥，HKDF-SHA256 派生会话密钥，AES-256-GCM 密封消息体。
// 全部使用标准库；会话密钥仅存进程内存，服务重启后客户端重新握手即可。
package secure

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"sync"

	"golang.org/x/crypto/hkdf"
)

// Info 是 HKDF 的上下文字符串：客户端与服务端必须一致，防止密钥跨用途复用。
const Info = "stickykee-im-v1"

// gcmStandardNonceSize AES-GCM 标准 nonce 长度。
const gcmStandardNonceSize = 12

// Store 按会话 token 保存协商出的对称密钥（一个登录会话一把密钥）。
type Store struct {
	mu sync.RWMutex
	m  map[string][]byte
}

// NewStore 构造空的会话密钥存储。
func NewStore() *Store { return &Store{m: map[string][]byte{}} }

// Set 写入/覆盖某会话的密钥（重复握手即轮换）。
func (s *Store) Set(session string, key []byte) {
	if session == "" {
		return
	}
	cp := append([]byte(nil), key...)
	s.mu.Lock()
	s.m[session] = cp
	s.mu.Unlock()
}

// Get 读取某会话密钥；不存在返回 ok=false。
func (s *Store) Get(session string) ([]byte, bool) {
	s.mu.RLock()
	key, ok := s.m[session]
	s.mu.RUnlock()
	return key, ok
}

// Delete 删除某会话密钥（登出/换密后调用）。
func (s *Store) Delete(session string) {
	s.mu.Lock()
	delete(s.m, session)
	s.mu.Unlock()
}

// Seal 用 AES-256-GCM 加密明文，返回 nonce||ciphertext。
func Seal(key, plain []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("secure: key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcmStandardNonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	// Seal 把密文与认证标签追加到 nonce 后
	return g.Seal(nonce, nonce, plain, nil), nil
}

// Open 解密 Seal 产出的 nonce||ciphertext，并校验认证标签。
func Open(key, blob []byte) ([]byte, error) {
	if len(blob) < gcmStandardNonceSize {
		return nil, errors.New("secure: ciphertext too short")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return g.Open(nil, blob[:gcmStandardNonceSize], blob[gcmStandardNonceSize:], nil)
}

// Server 是每进程一把的 ECDH P-256 静态私钥（仅用于密钥协商）。
type Server struct{ priv *ecdh.PrivateKey }

// NewServer 生成服务端 ECDH P-256 私钥。
func NewServer() (*Server, error) {
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &Server{priv: priv}, nil
}

// PubHex 返回服务端未压缩公钥点的十六进制（04 开头，共 65 字节）。
func (s *Server) PubHex() string {
	return hex.EncodeToString(s.priv.PublicKey().Bytes())
}

// Derive 校验客户端未压缩公钥点，ECDH 后经 HKDF-SHA256 派生 32 字节会话密钥。
func (s *Server) Derive(clientPub []byte) ([]byte, error) {
	cu, err := ecdh.P256().NewPublicKey(clientPub)
	if err != nil {
		return nil, errors.New("invalid client public key")
	}
	shared, err := s.priv.ECDH(cu)
	if err != nil {
		return nil, err
	}
	r := hkdf.New(sha256.New, shared, nil, []byte(Info))
	key := make([]byte, 32)
	if _, err := io.ReadFull(r, key); err != nil {
		return nil, err
	}
	return key, nil
}

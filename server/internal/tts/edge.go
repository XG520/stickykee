// Package tts 封装第三方语音合成（Edge TTS 等）。
package tts

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// EdgeTTS 调用微软 Edge 在线语音合成（免费、无需 Key、支持中文）。
// 音色与微软 Azure TTS 一致，质量接近豆包等商用语音。
type EdgeTTS struct {
	httpClient *http.Client
}

// NewEdgeTTS 构造 Edge TTS 客户端。
func NewEdgeTTS() *EdgeTTS {
	return &EdgeTTS{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

const edgeTrustedToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"

// 鉴权所需的浏览器指纹常量（与微软 Read Aloud 扩展一致，过旧值会被 403 拒绝）。
const (
	edgeChromiumFullVersion = "143.0.3650.75"
	edgeUserAgent           = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"
	edgeOrigin              = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
)

// secMsgGEC 计算 Edge TTS 鉴权 token Sec-MS-GEC。
// 公式（微软 Read Aloud 扩展 DRM）：取当前 UTC 时间 + Windows 纪元（11644473600s），
// 向下对齐 5 分钟窗口，转 100ns ticks 后拼接受信 token 求 SHA-256，输出大写十六进制。
// 该值必须随 URL 查询串传递（Sec-MS-GEC / Sec-MS-GEC-Version），放请求头会被 403 拒绝。
func secMsgGEC(now time.Time) string {
	sec := now.Unix() + 11644473600
	sec -= sec % 300
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d%s", sec*10000000, edgeTrustedToken)))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// Synth 合成语音，返回音频字节与 MIME。voice 为微软语音名（如 zh-CN-XiaoxiaoNeural）。
func (e *EdgeTTS) Synth(ctx context.Context, text, voice string) ([]byte, string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, "", fmt.Errorf("empty text")
	}
	if voice == "" {
		voice = "zh-CN-XiaoxiaoNeural"
	}
	connID := newUUID()
	ts := fmt.Sprintf("%d", time.Now().UnixMilli())
	gec := secMsgGEC(time.Now())

	url := fmt.Sprintf(
		"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=%s&ConnectionId=%s&Sec-MS-GEC=%s&Sec-MS-GEC-Version=1-%s",
		edgeTrustedToken, connID, gec, edgeChromiumFullVersion)
	header := http.Header{}
	header.Set("User-Agent", edgeUserAgent)
	header.Set("Accept-Encoding", "gzip, deflate, br, zstd")
	header.Set("Accept-Language", "en-US,en;q=0.9")
	header.Set("Pragma", "no-cache")
	header.Set("Cache-Control", "no-cache")
	header.Set("Origin", edgeOrigin)

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}
	conn, _, err := dialer.DialContext(ctx, url, header)
	if err != nil {
		return nil, "", fmt.Errorf("edge tts dial: %w", err)
	}
	defer conn.Close()

	// 1. 发送配置
	cfg := map[string]any{
		"context": map[string]any{
			"synthesis": map[string]any{
				"audio": map[string]any{
					"metadataoptions": map[string]any{
						"sentenceBoundaryEnabled": false,
						"wordBoundaryEnabled":     false,
					},
					"outputFormat": "audio-24khz-48kbitrate-mono-mp3",
				},
			},
		},
	}
	cfgBytes, _ := json.Marshal(cfg)
	if err := conn.WriteMessage(websocket.TextMessage,
		append([]byte("X-Timestamp:"+ts+"\r\nX-RequestId:"+connID+"\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"), cfgBytes...)); err != nil {
		return nil, "", fmt.Errorf("edge tts write config: %w", err)
	}

	// 2. 发送 SSML
	ssml := fmt.Sprintf(`<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"><voice name="%s"><prosody rate="+0%%" pitch="+0Hz" volume="medium">%s</prosody></voice></speak>`,
		voice, escapeXML(text))
	ssmlBytes := append([]byte("X-Timestamp:"+ts+"\r\nX-RequestId:"+connID+"\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n"), ssml...)
	if err := conn.WriteMessage(websocket.TextMessage, ssmlBytes); err != nil {
		return nil, "", fmt.Errorf("edge tts write ssml: %w", err)
	}

	// 3. 接收音频流
	var audio []byte
	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			if len(audio) > 0 {
				break
			}
			return nil, "", fmt.Errorf("edge tts read: %w", err)
		}
		if mt == websocket.BinaryMessage {
			// 二进制帧格式：[2字节大端头长度][头文本(含 Path:audio)][音频数据]。
			// 必须按头长度跳过整个头文本，否则 ASCII 头会混入 MP3 流导致解码失败。
			if len(msg) > 2 {
				hdrLen := int(msg[0])<<8 | int(msg[1])
				if 2+hdrLen <= len(msg) {
					audio = append(audio, msg[2+hdrLen:]...)
				}
			}
		} else if mt == websocket.TextMessage {
			// 文本帧：可能是 turn.end 等控制消息
			s := string(msg)
			if strings.Contains(s, "Path:turn.end") {
				break
			}
		}
	}
	if len(audio) == 0 {
		return nil, "", fmt.Errorf("edge tts: no audio received")
	}
	// 合法性自检：MP3 应以 ID3 标签或 MPEG 帧同步字开头
	if !(len(audio) > 3 && audio[0] == 'I' && audio[1] == 'D' && audio[2] == '3' ||
		len(audio) > 2 && audio[0] == 0xFF && audio[1]&0xE0 == 0xE0) {
		return nil, "", fmt.Errorf("edge tts: invalid audio stream (header %q)", string(audio[:min(16, len(audio))]))
	}
	return audio, "audio/mpeg", nil
}

// Voices 返回常用中文音色列表（id -> 描述）。
var EdgeVoices = map[string]string{
	"zh-CN-XiaoxiaoNeural": "晓晓（女声，温柔）",
	"zh-CN-YunxiNeural":    "云希（男声，阳光）",
	"zh-CN-YunjianNeural":  "云健（男声，沉稳）",
	"zh-CN-XiaoyiNeural":   "晓伊（女声，活泼）",
	"zh-CN-YunyangNeural":  "云扬（男声，新闻）",
	"zh-CN-XiaohanNeural":  "晓涵（女声，知性）",
	"zh-CN-XiaomoNeural":   "晓墨（女声，成熟）",
	"zh-CN-YunxiaNeural":   "云夏（男声，青年）",
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}

var (
	uuidOnce sync.Once
	uuidRand *rand.Rand
)

func newUUID() string {
	uuidOnce.Do(func() {
		uuidRand = rand.New(rand.NewSource(time.Now().UnixNano()))
	})
	b := make([]byte, 16)
	_, _ = uuidRand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// 确保 io 被引用（保留导入以备扩展）
var _ = io.EOF
var _ = bytes.NewReader

package client

// Assist pipeline WebSocket 客户端：把语音（WAV/PCM）交给 HA 的 Assist 管道做
// 语音识别（STT）+ 意图识别（intent），返回助手文字回复。REST /api/conversation/process
// 只接受文本输入，音频必须走本 WebSocket 协议（详见 HA 开发者文档 Assist pipelines）。

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// wsURL 把 HA 的 http(s) base URL 换成 WebSocket 地址。
func (c *Rest) wsURL() string {
	u := c.baseURL
	if strings.HasPrefix(u, "https://") {
		u = "wss://" + strings.TrimPrefix(u, "https://")
	} else {
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u + "/api/websocket"
}

// wavPCM 解析 WAV 容器：返回 (采样率, PCM 采样, 错误)。只支持 16-bit PCM mono/stereo。
// 语音消息由前端固定录制为 16kHz mono，这里仍做通用解析以兼容不同来源。
func wavPCM(b []byte) (int, []byte, error) {
	if len(b) < 44 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0, nil, fmt.Errorf("不是 WAV 文件")
	}
	pos := 12
	for pos+8 <= len(b) {
		id := string(b[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(b[pos+4 : pos+8]))
		body := pos + 8
		if body+size > len(b) {
			size = len(b) - body
		}
		switch id {
		case "fmt ":
			if size < 16 {
				return 0, nil, fmt.Errorf("WAVE fmt 块异常")
			}
			audioFormat := binary.LittleEndian.Uint16(b[body : body+2])
			channels := int(binary.LittleEndian.Uint16(b[body+2 : body+4]))
			sampleRate := int(binary.LittleEndian.Uint32(b[body+4 : body+8]))
			bitsPerSample := int(binary.LittleEndian.Uint16(b[body+14 : body+16]))
			if audioFormat != 1 || bitsPerSample != 16 {
				return 0, nil, fmt.Errorf("仅支持 16-bit PCM WAV")
			}
			if sampleRate <= 0 || channels <= 0 {
				return 0, nil, fmt.Errorf("WAV 头异常")
			}
			// 记录采样率与声道；数据块在后续 data 块中
			pos = body + size + (size & 1)
			for pos+8 <= len(b) {
				id2 := string(b[pos : pos+4])
				size2 := int(binary.LittleEndian.Uint32(b[pos+4 : pos+8]))
				body2 := pos + 8
				if body2+size2 > len(b) {
					size2 = len(b) - body2
				}
				if id2 == "data" {
					if channels > 1 {
						// 立体声 → mono（取第一声道）
						frame := channels * 2
						mono := make([]byte, 0, size2/frame*2)
						for off := 0; off+frame <= size2; off += frame {
							mono = append(mono, b[body2+off], b[body2+off+1])
						}
						return sampleRate, mono, nil
					}
					return sampleRate, b[body2 : body2+size2], nil
				}
				pos = body2 + size2 + (size2 & 1)
			}
			return 0, nil, fmt.Errorf("WAV 缺少 data 块")
		default:
			pos = body + size + (size & 1)
		}
	}
	return 0, nil, fmt.Errorf("WAV 缺少 fmt 块")
}

// PipelineVoice 把一段 WAV 语音交给 HA Assist 管道：STT → intent，
// 返回 (回复文本, conversation_id, 错误)。HA 侧需已配置 STT（如 Whisper）。
func (c *Rest) PipelineVoice(ctx context.Context, wav []byte, conversationID string) (string, string, error) {
	sampleRate, pcm, err := wavPCM(wav)
	if err != nil {
		return "", "", err
	}
	if len(pcm) == 0 {
		return "", "", fmt.Errorf("语音内容为空")
	}

	wsAddr := c.wsURL()
	hdr := map[string][]string{}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, wsAddr, hdr)
	if err != nil {
		return "", "", fmt.Errorf("connect ha websocket: %w", err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))

	// ---- 鉴权：auth_required → auth → auth_ok ----
	if err := expectType(conn, "auth_required"); err != nil {
		return "", "", err
	}
	if err := conn.WriteJSON(map[string]string{"type": "auth", "access_token": c.token}); err != nil {
		return "", "", err
	}
	if err := expectType(conn, "auth_ok"); err != nil {
		return "", "", err
	}

	// ---- 启动管道：stt → intent ----
	run := map[string]any{
		"id":          1,
		"type":        "assist_pipeline/run",
		"start_stage": "stt",
		"end_stage":   "intent",
		"input":       map[string]any{"sample_rate": sampleRate},
		"timeout":     60,
	}
	if conversationID != "" {
		run["conversation_id"] = conversationID
	}
	if err := conn.WriteJSON(run); err != nil {
		return "", "", err
	}

	// ---- 读事件流：run-start 拿二进制通道 id；stt-start 后发音频；intent-end 拿回复 ----
	var handlerID byte
	var reply, cid string
	sentAudio := false
	chunk := 4096
	for {
		mt, msg, err := conn.ReadMessage()
		if err != nil {
			return "", "", fmt.Errorf("ha pipeline read: %w", err)
		}
		if mt != websocket.TextMessage {
			continue
		}
		var env struct {
			ID      int    `json:"id"`
			Type    string `json:"type"`
			Success bool   `json:"success"`
			Error   *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
			Event struct {
				EventID string `json:"event_type"`
				Data    struct {
					Code       string `json:"code"`
					Message    string `json:"message"`
					RunnerData *struct {
						STTBinaryHandlerID int `json:"stt_binary_handler_id"`
					} `json:"runner_data"`
					STTOutput *struct {
						Text string `json:"text"`
					} `json:"stt_output"`
					IntentOutput *struct {
						ConversationID string `json:"conversation_id"`
						Speech         struct {
							Plain struct {
								Speech string `json:"speech"`
							} `json:"plain"`
						} `json:"speech"`
					} `json:"intent_output"`
				} `json:"data"`
			} `json:"event"`
		}
		if err := json.Unmarshal(msg, &env); err != nil {
			continue
		}
		// 命令结果：失败直接报错
		if env.ID == 1 && env.Type == "result" {
			if !env.Success {
				code, detail := "pipeline_error", ""
				if env.Error != nil {
					code, detail = env.Error.Code, env.Error.Message
				}
				return "", "", fmt.Errorf("%s: %s", code, detail)
			}
			continue
		}
		if env.Type != "event" {
			continue
		}
		switch env.Event.EventID {
		case "run-start":
			if env.Event.Data.RunnerData != nil {
				handlerID = byte(env.Event.Data.RunnerData.STTBinaryHandlerID)
			}
		case "stt-start":
			// 分块发送 PCM：每块前置 1 字节 handler id；末尾单字节表示结束
			for off := 0; off < len(pcm); off += chunk {
				end := off + chunk
				if end > len(pcm) {
					end = len(pcm)
				}
				frame := make([]byte, 0, end-off+1)
				frame = append(frame, handlerID)
				frame = append(frame, pcm[off:end]...)
				if err := conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
					return "", "", fmt.Errorf("send audio: %w", err)
				}
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, []byte{handlerID}); err != nil {
				return "", "", fmt.Errorf("send audio end: %w", err)
			}
			sentAudio = true
			_ = conn.SetWriteDeadline(time.Time{})
		case "stt-end":
			if env.Event.Data.STTOutput != nil && strings.TrimSpace(env.Event.Data.STTOutput.Text) == "" {
				return "", "", fmt.Errorf("没有听清语音内容")
			}
		case "intent-end":
			if out := env.Event.Data.IntentOutput; out != nil {
				cid = out.ConversationID
				reply = strings.TrimSpace(out.Speech.Plain.Speech)
			}
		case "error":
			return "", "", fmt.Errorf("%s: %s", env.Event.Data.Code, env.Event.Data.Message)
		case "run-end":
			if reply == "" && !sentAudio {
				return "", "", fmt.Errorf("pipeline 未完成")
			}
			return reply, cid, nil
		}
	}
}

// expectType 读一条 WS 消息并要求 type 匹配（鉴权握手用）。
func expectType(conn *websocket.Conn, want string) error {
	var env struct {
		Type  string `json:"type"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := conn.ReadJSON(&env); err != nil {
		return fmt.Errorf("ha websocket %s: %w", want, err)
	}
	if env.Type == "auth_invalid" || (env.Error != nil && env.Error.Message != "") {
		return fmt.Errorf("ha websocket 鉴权失败，请检查 HA 访问令牌")
	}
	if env.Type != want {
		return fmt.Errorf("ha websocket 期待 %s 实际 %s", want, env.Type)
	}
	return nil
}

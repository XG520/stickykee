package handler

import (
	"net/http"
	"os"
	"strings"
)

// IceServers 返回 WebRTC ICE 配置（登录后调用）。
// TURN 中继通过环境变量配置：SN_ICE_URLS（逗号分隔多个 url）、SN_ICE_USER、SN_ICE_PASS。
// 未配置时仅返回公共 STUN（仅能打洞）；跨运营商 NAT 场景无 TURN 会 P2P 失败（双方无声），
// 部署 coturn 后由 runner.sh 注入以上环境变量。
func IceServers(w http.ResponseWriter, r *http.Request) {
	type iceServer struct {
		URLs       []string `json:"urls"`
		Username   string   `json:"username,omitempty"`
		Credential string   `json:"credential,omitempty"`
	}
	servers := []iceServer{
		{URLs: []string{"stun:stun.qq.com:3478", "stun:stun.miwifi.com:3478"}},
	}
	if u := strings.TrimSpace(os.Getenv("SN_ICE_URLS")); u != "" {
		s := iceServer{URLs: strings.Split(u, ",")}
		if user := strings.TrimSpace(os.Getenv("SN_ICE_USER")); user != "" {
			s.Username = user
			s.Credential = os.Getenv("SN_ICE_PASS")
		}
		servers = append(servers, s)
	}
	WriteJSON(w, 200, map[string]any{"iceServers": servers})
}

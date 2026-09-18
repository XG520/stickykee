package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/ha/model"

	"github.com/go-chi/chi/v5"
)

// rUsername 返回当前登录用户名；未登录（路由已鉴权，正常不会发生）返回空串。
func rUsername(r *http.Request) string {
	id, _ := auth.From(r.Context())
	return id.Username
}

// haErr 统一把底层 HA 连接错误映射为前端可读错误。
// 个人 token 未配置（无配置即禁用）时给出明确指引，其余按「未配置实例」处理。
func haErr(w http.ResponseWriter, err error) {
	if errors.Is(err, ha.ErrNoHAToken) {
		WriteErr(w, 403, "no_ha_token", "未配置 Home Assistant 个人 Token（无 Token 时 HA 访问被禁用），请在设置中填写")
		return
	}
	WriteErr(w, 404, "no_instance", "no configured instance")
}

// pathID 解析路径中的 {id} 实例名。
func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// attrContains 判断实体 attributes 中某字符串字段是否含子串。
func attrContains(attrs json.RawMessage, key, sub string) bool {
	m := map[string]any{}
	if json.Unmarshal(attrs, &m) != nil {
		return false
	}
	if v, ok := m[key].(string); ok {
		return strings.Contains(v, sub)
	}
	return false
}

// matchesType 判断实体是否匹配前端归类的 type（轻量映射）。
func matchesType(d model.DisplayEntity, typ string) bool {
	switch strings.ToLower(strings.TrimSpace(typ)) {
	case "lighting":
		return d.Domain == "light" || strings.Contains(d.FriendlyName, "灯")
	case "climate":
		return d.Domain == "climate" || strings.Contains(d.FriendlyName, "空调") || strings.Contains(d.FriendlyName, "恒温")
	case "security":
		return d.Domain == "lock" || d.Domain == "alarm_control_panel" || d.Domain == "camera" || strings.Contains(d.FriendlyName, "摄像头") || strings.Contains(d.FriendlyName, "门锁")
	case "switch":
		return d.Domain == "switch" || d.Domain == "plug"
	case "fan":
		return d.Domain == "fan" || d.Domain == "humidifier"
	case "sensor":
		return d.Domain == "sensor" || d.Domain == "binary_sensor"
	default:
		return true
	}
}

// containsRoom 判断实体是否属于某房间（用 friendly_name / 分区信息模糊匹配）。
func containsRoom(d model.DisplayEntity, room string) bool {
	if room == "" {
		return true
	}
	fn := d.FriendlyName + d.EntityID
	if strings.Contains(fn, room) {
		return true
	}
	return attrContains(d.Attributes, "area", room)
}

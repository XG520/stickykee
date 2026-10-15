package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/store"
)

// Prefs 处理偏好配置。用户级偏好（theme/dashboard/map_config/ha_token 等）按用户隔离，
// 存于 user_prefs；管理员全局数据（devices/sensor_config/管理员高德 key 等）存于 prefs。
// ha_token 采用「无配置即禁用」：用户须配置自己的 HA 个人 token 才能连接 HA。
type Prefs struct {
	repo      *store.InstanceRepo
	userPrefs *store.UserPrefs
	manager   *ha.Manager
	hb        *hub.Hub
}

// NewPrefs 构造 handler。hb 用于仪表盘变更后向本人全部设备推送刷新通知。
func NewPrefs(repo *store.InstanceRepo, userPrefs *store.UserPrefs, manager *ha.Manager, hb *hub.Hub) *Prefs {
	return &Prefs{repo: repo, userPrefs: userPrefs, manager: manager, hb: hb}
}

// 用户级偏好 key：按登录用户隔离；无值回退全局 prefs。
// tts_engine（网页端引擎）与 tts_engine_apk（手机端引擎）都必须在列：
// 缺失时手机端读不到自己的引擎设置，会错误回退到网页端引擎（如 Kokoro）。
// dashboard（Web 端仪表盘）与 dashboard_apk（手机端仪表盘）分键存储，两端排版互不影响。
var userScoped = []string{"theme", "font", "icons", "floorplan", "floorplan_doc", "animation", "wakeWord", "dashboard", "dashboard_apk", "tts_engine", "tts_engine_apk"}

// 设备级偏好 key：按登录用户隔离（设备/传感器均属个人），无全局回退。
var deviceScoped = []string{"devices", "sensor_config"}

// 全局偏好 key：系统/管理员级别，所有人共用。
var globalKeys = []string{"result"}

// siteNameKey 系统名称（全局 prefs），默认回退「归祺」。
const siteNameKey = "site_name"
const defaultSiteName = "糯米"

// 读取当前用户（未登录时 readOnly 场景用空用户名）。
func (h *Prefs) currentUser(r *http.Request) (string, bool) {
	id, ok := auth.From(r.Context())
	return id.Username, ok
}

// parseMapConfig 解析 map_config 的 JSON 字符串；失败返回空对象与空 admin key。
func parseMapConfig(s string) map[string]any {
	m := map[string]any{}
	if s != "" {
		_ = json.Unmarshal([]byte(s), &m)
	}
	return m
}

// Get GET /prefs 返回当前用户的偏好（按用户隔离 + 全局回退）。
func (h *Prefs) Get(w http.ResponseWriter, r *http.Request) {
	username, _ := h.currentUser(r)

	all := map[string]string{}

	// 用户级：先用户配置，无则回退全局
	for _, key := range userScoped {
		v := ""
		if username != "" {
			v = h.userPrefs.Get(r.Context(), username, key)
		}
		if v == "" {
			g, _ := h.repo.GetPref(r.Context(), key)
			v = g
		}
		if v != "" {
			all[key] = v
		}
	}

	// 设备级：按用户隔离，无全局回退（各自管理自己的设备/传感器）
	for _, key := range deviceScoped {
		if username == "" {
			continue
		}
		if v := h.userPrefs.Get(r.Context(), username, key); v != "" {
			all[key] = v
		}
	}

	// 全局（系统级）
	for _, key := range globalKeys {
		v, _ := h.repo.GetPref(r.Context(), key)
		if v != "" {
			all[key] = v
		}
	}

	// map_config：组合管理员全局 key 与当前用户策略，返回生效 key
	all["map_config"] = h.assembleMapConfig(r)

	// ha_token：不回传 token 明文，仅以布尔告知当前用户是否已配置个人 HA token。
	hasToken := false
	if username != "" {
		hasToken = h.userPrefs.Get(r.Context(), username, "ha_token") != ""
	}
	all["ha_token_configured"] = strconv.FormatBool(hasToken)

	WriteJSON(w, 200, all)
}

// assembleMapConfig 组装 map_config：返回 { amap_key:<生效>, use_admin, has_own_key, admin_amap_key }。
// 管理员始终用自己的全局 key；普通用户由 use_admin 决定用管理员 key 还是本人 key。
func (h *Prefs) assembleMapConfig(r *http.Request) string {
	username, _ := h.currentUser(r)
	admin, _ := h.repo.GetPref(r.Context(), "map_config")
	adminKey := toString(parseMapConfig(admin)["amap_key"])

	useAdmin := false
	var ownKey string
	if username != "" {
		own := parseMapConfig(h.userPrefs.Get(r.Context(), username, "map_config"))
		useAdmin = boolVal(own["use_admin"])
		ownKey = toString(own["amap_key"])
	}
	isAdmin := auth.IsAdmin(r.Context())

	effective := ownKey
	if useAdmin || isAdmin {
		effective = adminKey
	}

	out := map[string]any{
		"amap_key":       effective,
		"use_admin":      useAdmin,
		"has_own_key":    ownKey != "",
		"admin_amap_key": "",
	}
	if isAdmin {
		out["admin_amap_key"] = adminKey
	}
	b, _ := json.Marshal(out)
	return string(b)
}

// SiteName GET /site-name 公开：返回系统显示名称，登录页/启动页可用。
func (h *Prefs) SiteName(w http.ResponseWriter, r *http.Request) {
	name, _ := h.repo.GetPref(r.Context(), siteNameKey)
	if name == "" {
		name = defaultSiteName
	}
	WriteJSON(w, 200, map[string]string{"name": name})
}

// PutSiteName PUT /site-name 管理员：修改系统显示名称。
func (h *Prefs) PutSiteName(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可修改系统名称")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		WriteErr(w, 400, "bad_request", "名称不能为空")
		return
	}
	if utf8.RuneCountInString(name) > 20 {
		WriteErr(w, 400, "bad_request", "名称最多 20 个字符")
		return
	}
	if err := h.repo.SetPref(r.Context(), siteNameKey, name); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]string{"name": name})
}
func (h *Prefs) Put(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	username, ok := h.currentUser(r)
	if !ok || username == "" {
		WriteErr(w, 401, "unauthorized", "missing token")
		return
	}
	isAdmin := auth.IsAdmin(r.Context())
	// 本次写入涉及哪些仪表盘键（dashboard=Web 端 / dashboard_apk=手机端）：
	// 写库后按受影响端通知本人全部设备热刷新，未受影响的端不重载
	dashKeys := []string{}

	userSet := map[string]bool{}
	for _, k := range userScoped {
		userSet[k] = true
	}
	deviceSet := map[string]bool{}
	for _, k := range deviceScoped {
		deviceSet[k] = true
	}

	for k, v := range body {
		if k == "dashboard" || k == "dashboard_apk" {
			dashKeys = append(dashKeys, k) // 仪表盘变更：写库后通知本人全部设备热刷新
		}
		switch {
		case k == "ha_token":
			// 个人 HA token：写当前用户，并即时重建其 HA 连接（不需重启服务器）。
			if err := h.userPrefs.Set(r.Context(), username, "ha_token", v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
			h.manager.InvalidateActive(r.Context(), username)
		case k == "map_config":
			if isAdmin {
				// 管理员写全局 key（合并 amap_key / location_name）
				g, _ := h.repo.GetPref(r.Context(), "map_config")
				cur := parseMapConfig(g)
				merged := mergeMapConfig(cur, parseMapConfig(v))
				b, _ := json.Marshal(merged)
				if err := h.repo.SetPref(r.Context(), "map_config", string(b)); err != nil {
					WriteErr(w, 500, "internal", err.Error())
					return
				}
			} else {
				// 普通用户写本人 key；use_admin 由管理员经 /users/{username}/map 决定，这里保留现值
				cur := parseMapConfig(h.userPrefs.Get(r.Context(), username, "map_config"))
				if kk := toString(parseMapConfig(v)["amap_key"]); kk != "" {
					cur["amap_key"] = kk
				}
				b, _ := json.Marshal(cur)
				if err := h.userPrefs.Set(r.Context(), username, "map_config", string(b)); err != nil {
					WriteErr(w, 500, "internal", err.Error())
					return
				}
			}
		case userSet[k]:
			// 用户级：写当前用户的 user_prefs
			if err := h.userPrefs.Set(r.Context(), username, k, v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
		case deviceSet[k]:
			// 设备级（设备注册表/传感器开关）：写当前用户的 user_prefs，按用户隔离
			if err := h.userPrefs.Set(r.Context(), username, k, v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
		default:
			// site_name 仅允许经 PUT /site-name 由管理员修改，普通用户禁止走通用通道。
			if k == siteNameKey {
				WriteErr(w, 403, "forbidden", "系统名称仅管理员可修改")
				return
			}
			// 全局（系统级）：写全局 prefs
			if err := h.repo.SetPref(r.Context(), k, v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
		}
	}
	// 仪表盘已变更：经 WebSocket 通知本人全部设备热刷新（含发起保存的设备，
	// 前端对「刚在本地保存过」的端做时间窗去重，不会打断当前界面）。
	// keys 指明受影响的布局键（dashboard=Web 端 / dashboard_apk=手机端），
	// 前端按本端使用的键过滤，未受影响的端不重载。
	if len(dashKeys) > 0 && h.hb != nil {
		if b, err := json.Marshal(map[string]any{"type": "prefs", "keys": dashKeys}); err == nil {
			h.hb.BroadcastUser(username, b)
		}
	}
	WriteJSON(w, 200, body)
}

// mergeMapConfig 把用户传入的合法字段合并进 cur（供管理员用）。
func mergeMapConfig(cur, mv map[string]any) map[string]any {
	for k, val := range mv {
		switch k {
		case "amap_key":
			if toString(val) != "" {
				cur["amap_key"] = val
			}
		case "location_name":
			if toString(val) != "" {
				cur["location_name"] = val
			}
		}
	}
	return cur
}

func toString(v any) string {
	s, _ := v.(string)
	return s
}

func boolVal(v any) bool {
	b, _ := v.(bool)
	return b
}

// Health 健康检查。
type Health struct{}

// PublicCORS 为公开端点附加 CORS 响应头（GET 简单请求无需预检）。
func PublicCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		next(w, r)
	}
}

// Version 后端版本号：随发布递增，经 healthz 暴露，供前端设置页与 APK 壳页
// 确认当前连接的服务端版本（排查「更新没生效」类问题）。
const Version = "1.4.5"

// Healthz 存活探针（公开：附带后端版本号）。
func (Health) Healthz(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]string{"status": "ok", "version": Version})
}

// Readyz 就绪探针。
func (Health) Readyz(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]string{"status": "ready"})
}

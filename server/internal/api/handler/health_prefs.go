package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"stickykee/server/internal/auth"
	"stickykee/server/internal/ha"
	"stickykee/server/internal/hub"
	"stickykee/server/internal/store"
)

// Prefs 处理偏好配置。用户级偏好（theme/dashboard/map_config/ha_token 等）按用户隔离，
// 存于 user_prefs；管理员全局数据（devices/sensor_config/管理员高德 key 等）存于 prefs。
// ha_token 采用「无配置即禁用」：用户须配置自己的 HA 个人 token 才能连接 HA。
type Prefs struct {
	repo      *store.InstanceRepo
	userPrefs *store.UserPrefs
	manager   *ha.Manager
	hb        *hub.Hub
	bd        *Birthdays // 生日写入后触发 HA 传感器同步（账号级，见 birthdays.go）
}

// NewPrefs 构造 handler。hb 用于仪表盘变更后向本人全部设备推送刷新通知；
// bd 可为 nil（未启用生日同步时）。
func NewPrefs(repo *store.InstanceRepo, userPrefs *store.UserPrefs, manager *ha.Manager, hb *hub.Hub, bd *Birthdays) *Prefs {
	return &Prefs{repo: repo, userPrefs: userPrefs, manager: manager, hb: hb, bd: bd}
}

// 用户级偏好 key：按登录用户隔离；无值回退全局 prefs。
// tts_engine（网页端引擎）与 tts_engine_apk（手机端引擎）都必须在列：
// 缺失时手机端读不到自己的引擎设置，会错误回退到网页端引擎。
// dashboard（Web 端仪表盘）与 dashboard_apk（手机端全局回退仪表盘）分键存储。
// 按设备隔离的键 dashboard_apk_<deviceId>（布局）/ dashboard_apk_cols_<deviceId>
// （列数）键名随设备 ID 动态变化，无法列入此固定清单，由 GET 全量扫描后按前缀
// 放行、PUT 按前缀写入（见 isUserLayoutKey）。
var userScoped = []string{"theme", "font", "icons", "bgfx", "site_display", "saved_themes", "floorplan", "floorplan_doc", "animation", "wakeWord", "dashboard", "dashboard_apk", "tts_engine", "tts_engine_apk", "birthdays", "ai_config"}

// isUserLayoutKey 判断 k 是否为用户级仪表盘布局键（需按用户隔离写入）。
// dashboard=Web 端；dashboard_apk=手机端全局回退；dashboard_apk_<deviceId>=按设备隔离。
// dashboard_apk_cols_<deviceId> 是列数偏好（同样用户级，但非布局键，不触发布局重载广播）。
func isUserLayoutKey(k string) bool {
	if k == "dashboard" || k == "dashboard_apk" {
		return true
	}
	return strings.HasPrefix(k, "dashboard_apk_") && !strings.HasPrefix(k, "dashboard_apk_cols_")
}

// isUserDashPref 判断 k 是否为用户级仪表盘偏好键（布局或列数），均按用户隔离写入。
func isUserDashPref(k string) bool {
	return k == "dashboard" || k == "dashboard_apk" ||
		strings.HasPrefix(k, "dashboard_apk_") // 含 dashboard_apk_cols_<deviceId>
}

// 设备级偏好 key：按登录用户隔离（设备/传感器均属个人），无全局回退。
var deviceScoped = []string{"devices", "sensor_config"}

// 全局偏好 key：系统/管理员级别，所有人共用。
var globalKeys = []string{"result"}

// siteNameKey 系统名称（全局 prefs），默认回退「归祺」。
const siteNameKey = "site_name"
const defaultSiteName = "糯米"

// siteNameEnKey 系统英文名称（全局 prefs，顶栏副标题），默认「Sticky Kee」。
const siteNameEnKey = "site_name_en"
const defaultSiteNameEn = "Sticky Kee"

// siteIconKey 系统图标（Material Symbol 名，全局 prefs）。
const siteIconKey = "site_icon"
const defaultSiteIcon = "bolt"

// siteIconImgKey 自定义图标图片（data URL，全局 prefs）。与 Material 名互斥：
// 非空时各端优先渲染图片；重新选择 Material 图标时自动清除。
const siteIconImgKey = "site_icon_img"

// broadcastBrand 品牌设置（名称/英文名/图标）变更后通知全部在线端即时热刷新，
// 无需杀掉 APP 或刷新页面重进。
func (h *Prefs) broadcastBrand() {
	if h.hb == nil {
		return
	}
	if b, err := json.Marshal(map[string]any{"type": "brand"}); err == nil {
		h.hb.BroadcastAll(b)
	}
}

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

	// 按设备隔离的仪表盘键：dashboard_apk_<deviceId>（布局）/ dashboard_apk_cols_<deviceId>
	// （列数）。键名随设备 ID 变化，不在 userScoped 固定清单内，全量扫描用户偏好后按
	// 前缀取出。网页端编辑器据此按选中的手机设备读取对应布局与列数。
	if username != "" {
		if extra, err := h.userPrefs.AllForUser(r.Context(), username); err == nil {
			for k, v := range extra {
				if strings.HasPrefix(k, "dashboard_apk_") && v != "" {
					all[k] = v
				}
			}
		}
	}

	// map_config：组合管理员全局 key 与当前用户策略，返回生效 key
	all["map_config"] = h.assembleMapConfig(r)

	// barcode_config：扫码商品库 Key 属系统级配置，仅管理员返回（用于设置页编辑）
	if auth.IsAdmin(r.Context()) {
		if v, _ := h.repo.GetPref(r.Context(), "barcode_config"); v != "" {
			all["barcode_config"] = v
		}
	}

	// ha_token：不回传 token 明文，仅以布尔告知当前用户是否已配置个人 HA token。
	hasToken := false
	if username != "" {
		hasToken = h.userPrefs.Get(r.Context(), username, "ha_token") != ""
	}
	all["ha_token_configured"] = strconv.FormatBool(hasToken)

	// ai_config：api_key 永不明文回传，只回传 base_url/model 与 has_key 状态。
	// 生效顺序与 /ai/chat 一致：用户自配的 key 优先，否则回退管理员全局配置。
	if username != "" {
		own := parseMapConfig(h.userPrefs.Get(r.Context(), username, "ai_config"))
		globalRaw, _ := h.repo.GetPref(r.Context(), "ai_config")
		global := parseMapConfig(globalRaw)
		effective := own
		source := "user"
		if toString(own["api_key"]) == "" {
			effective = global
			source = "global"
			if toString(global["api_key"]) == "" {
				source = "none"
			}
		}
		out := map[string]any{
			"base_url":       toString(effective["base_url"]),
			"model":          toString(effective["model"]),
			"has_key":        toString(effective["api_key"]) != "",
			"source":         source,
			"own_base_url":   toString(own["base_url"]),
			"own_model":      toString(own["model"]),
			"own_has_key":    toString(own["api_key"]) != "",
			"global_has_key": toString(global["api_key"]) != "",
		}
		// 管理员额外拿到全局配置值（不含 key），用于设置页编辑。
		if auth.IsAdmin(r.Context()) {
			out["global_base_url"] = toString(global["base_url"])
			out["global_model"] = toString(global["model"])
		}
		b, _ := json.Marshal(out)
		all["ai_config"] = string(b)
	}

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

// SiteName GET /site-name 公开：返回系统显示名称（含英文名），登录页/启动页可用。
func (h *Prefs) SiteName(w http.ResponseWriter, r *http.Request) {
	name, _ := h.repo.GetPref(r.Context(), siteNameKey)
	if name == "" {
		name = defaultSiteName
	}
	nameEn, _ := h.repo.GetPref(r.Context(), siteNameEnKey)
	if nameEn == "" {
		nameEn = defaultSiteNameEn
	}
	WriteJSON(w, 200, map[string]string{"name": name, "name_en": nameEn})
}

// PutSiteName PUT /site-name 管理员：修改系统显示名称（name_en 可选，一并修改英文名）。
// 保存成功后经 WebSocket 广播全部在线端即时热刷新。
func (h *Prefs) PutSiteName(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可修改系统名称")
		return
	}
	var body struct {
		Name   string `json:"name"`
		NameEn string `json:"name_en"`
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
	// 英文名：请求携带 name_en 字段时一并更新（空串回退默认值，不单独报错）
	nameEn := strings.TrimSpace(body.NameEn)
	if body.NameEn != "" {
		if utf8.RuneCountInString(nameEn) > 40 {
			WriteErr(w, 400, "bad_request", "英文名称最多 40 个字符")
			return
		}
		if nameEn != "" {
			if err := h.repo.SetPref(r.Context(), siteNameEnKey, nameEn); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
		}
	}
	if nameEn == "" {
		nameEn, _ = h.repo.GetPref(r.Context(), siteNameEnKey)
		if nameEn == "" {
			nameEn = defaultSiteNameEn
		}
	}
	h.broadcastBrand()
	// 系统英文名是 HA 虚拟设备默认名的来源：改名后异步同步一次（设备名随之下发更新）。
	if h.bd != nil {
		go h.bd.SyncAll(context.Background())
	}
	WriteJSON(w, 200, map[string]string{"name": name, "name_en": nameEn})
}

// SiteIcon GET /site-icon 公开：返回系统显示图标（Material Symbol 名 + 自定义图片 data URL）。
// img 非空时前端优先渲染图片；为空则渲染 Material 图标。
func (h *Prefs) SiteIcon(w http.ResponseWriter, r *http.Request) {
	v, _ := h.repo.GetPref(r.Context(), siteIconKey)
	if v == "" {
		v = defaultSiteIcon
	}
	img, _ := h.repo.GetPref(r.Context(), siteIconImgKey)
	WriteJSON(w, 200, map[string]string{"icon": v, "img": img})
}

// PutSiteIcon PUT /site-icon 管理员：修改系统显示图标。
func (h *Prefs) PutSiteIcon(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可修改系统图标")
		return
	}
	var body struct {
		Icon string `json:"icon"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	icon := strings.TrimSpace(body.Icon)
	if icon == "" {
		WriteErr(w, 400, "bad_request", "图标不能为空")
		return
	}
	if utf8.RuneCountInString(icon) > 40 {
		WriteErr(w, 400, "bad_request", "图标名称过长")
		return
	}
	// Material Symbol 名只允许小写字母、数字与下划线/连字符。
	for _, r := range icon {
		if !(r == '_' || r == '-' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			WriteErr(w, 400, "bad_request", "图标名称格式不合法（仅小写字母、数字、下划线、连字符）")
			return
		}
	}
	if err := h.repo.SetPref(r.Context(), siteIconKey, icon); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	// 选用 Material 图标：清掉自定义图片（两者互斥，img 非空时优先渲染图片）
	_ = h.repo.SetPref(r.Context(), siteIconImgKey, "")
	h.broadcastBrand()
	WriteJSON(w, 200, map[string]string{"icon": icon})
}

// PutSiteIconImage PUT /site-icon/image 管理员：上传自定义图标图片（data URL）。
// 保存成功后经 WebSocket 广播全部在线端即时热刷新；重新选择 Material 图标自动清除。
func (h *Prefs) PutSiteIconImage(w http.ResponseWriter, r *http.Request) {
	if !auth.IsAdmin(r.Context()) {
		WriteErr(w, 403, "forbidden", "仅管理员可修改系统图标")
		return
	}
	var body struct {
		Img string `json:"img"`
	}
	if err := DecodeBody(r, &body); err != nil {
		WriteErr(w, 400, "bad_request", "bad payload")
		return
	}
	img := strings.TrimSpace(body.Img)
	if img == "" {
		WriteErr(w, 400, "bad_request", "图片不能为空")
		return
	}
	// 仅允许常见图标图片格式的 data URL；限制体积（base64 ≤350KB，约原始 256KB）。
	ok := false
	for _, p := range []string{"data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "data:image/gif;base64,", "data:image/svg+xml;base64,"} {
		if strings.HasPrefix(img, p) {
			ok = true
			break
		}
	}
	if !ok {
		WriteErr(w, 400, "bad_request", "仅支持 PNG/JPEG/WebP/GIF/SVG 图片")
		return
	}
	if len(img) > 350*1024 {
		WriteErr(w, 400, "bad_request", "图片过大（请压缩到 256KB 以内）")
		return
	}
	if err := h.repo.SetPref(r.Context(), siteIconImgKey, img); err != nil {
		WriteErr(w, 500, "internal", err.Error())
		return
	}
	h.broadcastBrand()
	icon, _ := h.repo.GetPref(r.Context(), siteIconKey)
	WriteJSON(w, 200, map[string]string{"icon": icon, "img": img})
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
	// 本次写入涉及哪些仪表盘键（dashboard / dashboard_apk / dashboard_apk_<deviceId> 布局 /
	// dashboard_apk_cols_<deviceId> 列数）：写库后按受影响端通知本人全部设备。
	// 前端按前缀区分：布局键触发重载热刷新；列数键不触发布局重载，仅让正在代管
	// 该设备的网页端编辑器实时更新预览列数（见 store 的 apkColsRev）。
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
		if isUserLayoutKey(k) || strings.HasPrefix(k, "dashboard_apk_cols_") {
			dashKeys = append(dashKeys, k) // 布局/列数变更：写库后通知本人全部设备
		}
		switch {
		case k == "ha_token":
			// 个人 HA token：写当前用户，并即时重建其 HA 连接（不需重启服务器）。
			// 粘贴板常带入首尾空格/换行：统一清理，避免 HA 401 难排查。
			v = strings.TrimSpace(v)
			if err := h.userPrefs.Set(r.Context(), username, "ha_token", v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
			h.manager.InvalidateActive(r.Context(), username)
			// 通知该用户全部在线端（含降级连接的 APK）立即重连重建数据通道
			if h.hb != nil {
				if b, err := json.Marshal(map[string]any{"type": "reload", "reason": "ha_token"}); err == nil {
					h.hb.BroadcastUser(username, b)
				}
			}
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
		case k == "barcode_config":
			// 扫码商品库 Key：系统级配置，仅管理员可写；变更后清空识别缓存，
			// 否则此前的「未收录」结果会继续拦截新的查询。
			if !isAdmin {
				continue
			}
			cfg := parseMapConfig(v)
			next, _ := json.Marshal(map[string]string{
				"taobao_app_key":    strings.TrimSpace(toString(cfg["taobao_app_key"])),
				"taobao_app_secret": strings.TrimSpace(toString(cfg["taobao_app_secret"])),
				"apizero_key":       strings.TrimSpace(toString(cfg["apizero_key"])),
			})
			if old, _ := h.repo.GetPref(r.Context(), "barcode_config"); old != string(next) {
				if err := h.repo.SetPref(r.Context(), "barcode_config", string(next)); err != nil {
					WriteErr(w, 500, "internal", err.Error())
					return
				}
				clearBarcodeCache()
			}
		case k == "ai_config":
			// AI 配置：api_key 为空表示「保留原 key 不变」，clear_key 明确清除。
			// scope=global：管理员写全局默认（所有未自配用户共用）；否则写当前用户自己的配置。
			in := parseMapConfig(v)
			global := isAdmin && toString(in["scope"]) != "user"
			cur := map[string]any{}
			if global {
				raw, _ := h.repo.GetPref(r.Context(), "ai_config")
				cur = parseMapConfig(raw)
			} else {
				cur = parseMapConfig(h.userPrefs.Get(r.Context(), username, "ai_config"))
			}
			if boolVal(in["clear_key"]) {
				delete(cur, "api_key")
			} else if kk := toString(in["api_key"]); kk != "" {
				cur["api_key"] = kk
			}
			cur["base_url"] = strings.TrimRight(strings.TrimSpace(toString(in["base_url"])), "/")
			cur["model"] = strings.TrimSpace(toString(in["model"]))
			b, _ := json.Marshal(cur)
			if global {
				if err := h.repo.SetPref(r.Context(), "ai_config", string(b)); err != nil {
					WriteErr(w, 500, "internal", err.Error())
					return
				}
			} else if err := h.userPrefs.Set(r.Context(), username, "ai_config", string(b)); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
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
		case isUserDashPref(k):
			// 按设备隔离的仪表盘偏好键（dashboard_apk_<deviceId> 布局 /
			// dashboard_apk_cols_<deviceId> 列数）：与 dashboard/dashboard_apk 同属用户级，
			// 写当前用户的 user_prefs。dashboard / dashboard_apk 已被上面的 userSet 命中，
			// 此分支只到达带 deviceId 后缀的动态键。
			if err := h.userPrefs.Set(r.Context(), username, k, v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
		default:
			// site_name / site_name_en / site_icon / site_icon_img 仅允许经专用接口由管理员修改，普通用户禁止走通用通道。
			if k == siteNameKey || k == siteNameEnKey || k == siteIconKey || k == siteIconImgKey {
				WriteErr(w, 403, "forbidden", "系统名称与图标仅管理员可修改")
				return
			}
			// server_device_name（HA 侧虚拟设备显示名）：仅管理员可改；保存后异步同步到 HA。
			if k == serverDeviceNameKey {
				if !auth.IsAdmin(r.Context()) {
					WriteErr(w, 403, "forbidden", "HA 设备名仅管理员可修改")
					return
				}
				v = strings.TrimSpace(v)
				if utf8.RuneCountInString(v) > 40 {
					WriteErr(w, 400, "bad_request", "HA 设备名最多 40 个字符")
					return
				}
			}
			// 全局（系统级）：写全局 prefs
			if err := h.repo.SetPref(r.Context(), k, v); err != nil {
				WriteErr(w, 500, "internal", err.Error())
				return
			}
			if k == serverDeviceNameKey && h.bd != nil {
				go h.bd.SyncAll(context.Background()) // 改名经 ensureReg→syncDeviceName 下发 HA
			}
		}
	}
	// 生日变更：异步同步该账号的 HA 生日传感器（限频入口，防高频写放大 HA 请求）
	if _, touched := body["birthdays"]; touched && h.bd != nil {
		h.bd.RequestSync(username)
	}

	// 仪表盘已变更：经 WebSocket 通知本人全部设备热刷新（含发起保存的设备，
	// 前端对「刚在本地保存过」的端做时间窗去重，不会打断当前界面）。
	// keys 指明受影响的布局键（dashboard=Web 端 / dashboard_apk=手机端全局回退 /
	// dashboard_apk_<deviceId>=按设备隔离），前端按本端使用的键前缀过滤，
	// 未受影响的端不重载。
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
const Version = "1.6.11"

// Healthz 存活探针（公开：附带后端版本号）。
func (Health) Healthz(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]string{"status": "ok", "version": Version})
}

// Readyz 就绪探针。
func (Health) Readyz(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, 200, map[string]string{"status": "ready"})
}

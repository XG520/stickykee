package api

import (
	"encoding/json"
	"net/http"
	"time"

	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/call"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/secure"
	"stickynuo/server/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"stickynuo/server/internal/api/handler"
	"stickynuo/server/internal/icons"
)

// Router 组装全部 HTTP 路由。uploadDir 为聊天图片存储根目录（空串禁用图片功能）。
func Router(repo *store.InstanceRepo, userRepo *store.UserRepo, userPrefs *store.UserPrefs, msgRepo *store.MessageRepo, hb *hub.Hub, manager *ha.Manager, authOpt auth.Option, uploadDir string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// 传输压缩：实体全量 JSON 体积最大，gzip 后通常只剩两三成，首屏收益最明显。
	// 放在 etagJSON 之外层，先算好 ETag / 再压缩输出；图片与 WebSocket 升级不受影响。
	r.Use(middleware.Compress(5, "application/json", "text/plain", "text/html", "text/css", "application/javascript", "image/svg+xml"))
	// 条件请求：GET JSON 命中 If-None-Match 时回 304，重复访问不再传正文。
	r.Use(etagJSON)

	// 健康探针（跳过鉴权）。healthz 附加 CORS 头：APK 壳页（http://localhost 源）
	// 需要跨源读取版本号展示；接口无敏感数据。
	health := handler.Health{}
	r.Get("/healthz", handler.PublicCORS(health.Healthz))
	r.Get("/readyz", health.Readyz)

	// 结构图标资源（公开：静态资源、浏览器 <img> 无法携带鉴权头）。
	// 列表：/api/v1/icons 与 /api/v1/icons/；单图标：/api/v1/icons/{name}.svg
	r.Get("/api/v1/icons", http.HandlerFunc(icons.ListHandler))
	r.Get("/api/v1/icons/", http.HandlerFunc(icons.ListHandler))
	r.Get("/api/v1/icons/{name}", http.HandlerFunc(icons.Handler))

	// 聊天图片（公开读取：同 <img> 鉴权限制；安全性依赖上传时生成的
	// 128-bit 随机文件名不可枚举，读取路径限定在 uploads 目录内防穿越）。
	// 会话密钥存储（进程内存）+ ECDH 握手 handler
	keyStore := secure.NewStore()
	cryptoHandler, err := handler.NewCrypto(keyStore)
	if err != nil {
		panic(err)
	}

	im := handler.NewIm(msgRepo, userPrefs, userRepo, hb, keyStore, manager, uploadDir)
	r.Get("/api/v1/im-files/", im.ImageFiles)
	r.Get("/api/v1/im-files/*", im.ImageFiles)

	// 资源 handlers
	authHandler := handler.NewAuth(userRepo)
	instances := handler.NewInstances(repo, manager)
	entities := handler.NewEntities(manager)
	services := handler.NewServices(manager)
	prefs := handler.NewPrefs(repo, userPrefs, manager, hb)
	users := handler.NewUsers(userRepo, userPrefs, manager)
	ws := handler.NewWS(manager, nil, authOpt.Authenticate)
	agg := handler.NewAggregate(manager)
	automation := handler.NewAutomation(manager)
	devices := handler.NewDevices(repo, userPrefs, manager)
	registrations := handler.NewRegisteredEntities(manager)
	sensors := handler.NewSensors(manager, repo, userPrefs)
	// Location 复用 sensors 的 mobile_app 注册与 webhook 探测能力，使
	// device_tracker 实体经官方 update_location 命令自动绑定到注册设备。
	location := handler.NewLocation(manager, sensors)
	media := handler.NewMedia(manager)

	// 语音通话：内存房间 + WebRTC 信令中继。
	// push 回调供房间超时清理时向全员推送 ended 事件（如无人接听自动结束）。
	callManager := call.NewManager(func(user string, ev map[string]any) {
		if msg, err := json.Marshal(ev); err == nil {
			hb.BroadcastUser(user, msg)
		}
	})
	callHandler := handler.NewCall(callManager, hb, userRepo)

	r.Route("/api/v1", func(r chi.Router) {
		// 认证：status/register/login 公开，me/logout/change-password 需登录。
		r.Route("/auth", func(r chi.Router) {
			r.Get("/status", authHandler.Status)
			r.Post("/register", authHandler.Register)
			r.Post("/login", authHandler.Login)
			r.Group(func(pr chi.Router) {
				pr.Use(auth.Middleware(authOpt))
				pr.Get("/me", authHandler.Me)
				pr.Post("/logout", func(w http.ResponseWriter, r *http.Request) {
					authHandler.Logout(w, r)
					cryptoHandler.Drop(r)
				})
				pr.Post("/change-password", authHandler.ChangePassword)
			})
		})

		// WebSocket：浏览器无法携带 Header，改用 query token 自行鉴权。
		r.Get("/ws", ws.ServeHTTP)

		// 加密：公钥公开下发（公钥本就可公开）；握手需登录，在下方鉴权组内。
		r.Get("/crypto/pubkey", cryptoHandler.PubKey)

		// 系统显示名称：公开读取（登录页展示用）；修改需管理员，在鉴权组内。
		r.Get("/site-name", prefs.SiteName)

		// 以下接口均要求登录（Group 创建独立子路由，先注册中间件再注册路由）。
		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware(authOpt))
			r.Route("/instances", func(r chi.Router) {
				r.Get("/", instances.List)
				r.Post("/", instances.Create)
				r.Route("/{id}", func(r chi.Router) {
					r.Put("/", instances.Update)
					r.Delete("/", instances.Delete)
					r.Post("/switch", instances.Switch)
					r.Get("/status", instances.Status)
					r.Post("/location", location.Update)
					r.Get("/picture", media.Picture)
					r.Get("/entities", entities.List)
					r.Route("/entities/{entityID}", func(r chi.Router) {
						r.Get("/", entities.Get)
						r.Post("/toggle", entities.Toggle)
					})
					r.Post("/services", services.Call)
					r.Get("/services", services.List)
					r.Get("/scenes", agg.Scenes)
					r.Get("/automations", agg.Automations)
					r.Route("/automations/{entityID}", func(r chi.Router) {
						// 具体路径注册在前，避免被 {action} 通配拦截。
						r.Get("/config", automation.Config)
						r.Put("/", automation.Update)
						r.Delete("/", automation.Delete)
						r.Post("/{action}", agg.AutomationTurn)
					})
					r.Post("/automations", automation.Create)
					r.Get("/history", agg.History)
					r.Get("/statistics", agg.Statistics)
					r.Get("/statistics/sum", agg.SumStatistics)
					r.Get("/logs", agg.Logs)
					r.Post("/sensors/report", sensors.Report)
					r.Get("/registry/devices", registrations.List)
				})
			})
			r.Get("/sensors/definitions", sensors.Definitions)
			r.Get("/prefs", prefs.Get)
			r.Put("/prefs", prefs.Put)
			r.Put("/site-name", prefs.PutSiteName)

			// App 安装包：需登录（防外链盗刷下载）；前端经 fetch 携带令牌取流保存。
			r.Get("/app/info", handler.AppInfo)
			r.Get("/app/download", handler.AppDownload)
			// WebRTC ICE 配置（STUN/TURN 中继，跨网通话用）
			r.Get("/ice", handler.IceServers)
			r.Get("/devices", devices.List)
			r.Post("/devices", devices.Register)
			r.Put("/devices/{device_id}", devices.Rename)
			r.Delete("/devices/{device_id}", devices.Delete)

			// 用户间消息 & 仪表盘共享（全部登录可见，action 端做归属校验）
			r.Post("/crypto/handshake", cryptoHandler.Handshake)
			r.Get("/messages/conversations", im.Conversations)
			r.Get("/messages/contacts", im.Contacts)
			r.Get("/messages/assistant/tts", im.AssistantTTS)
			r.Get("/messages/assistant/agents", im.ListAgents)
			r.Get("/messages/tts/services", im.ListTTS)
			r.Get("/messages/{user}", im.History)
			r.Post("/messages/{user}", im.SendText)
			r.Post("/messages/{user}/share", im.SendShare)
			r.Post("/messages/{user}/device", im.SendDevice)
			r.Post("/messages/{user}/image", im.SendImage)
			r.Post("/messages/{user}/audio", im.SendAudio)
			r.Post("/messages/{user}/read", im.MarkRead)
			r.Post("/messages/{id}/accept", im.Accept)
			r.Post("/messages/{id}/decline", im.Decline)
			r.Post("/messages/{id}/recall", im.Recall)

			// 语音通话信令（一对一/多人 mesh）
			r.Route("/call", func(r chi.Router) {
				r.Post("/start", callHandler.Start)
				r.Post("/signal", callHandler.Signal)
				r.Post("/join", callHandler.Join)
				r.Post("/leave", callHandler.Leave)
				r.Post("/reject", callHandler.Reject)
			})

			// 用户管理（仅管理员可用，handler 内部校验）
			r.Route("/users", func(r chi.Router) {
				r.Get("/", users.List)
				r.Post("/", users.Create)
				r.Put("/{username}", users.Update)
				r.Put("/{username}/map", users.SetMapPolicy)
				r.Put("/{username}/ha", users.SetHAToken)
				r.Delete("/{username}", users.Delete)
			})
		})
	})

	return r
}

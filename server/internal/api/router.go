package api

import (
	"net/http"
	"time"

	"homecanvas/server/internal/auth"
	"homecanvas/server/internal/ha"
	"homecanvas/server/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"homecanvas/server/internal/api/handler"
	"homecanvas/server/internal/icons"
)

// Router 组装全部 HTTP 路由。
func Router(repo *store.InstanceRepo, userRepo *store.UserRepo, manager *ha.Manager, authOpt auth.Option) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// 健康探针（跳过鉴权）
	health := handler.Health{}
	r.Get("/healthz", health.Healthz)
	r.Get("/readyz", health.Readyz)

	// 结构图标资源（公开：静态资源、浏览器 <img> 无法携带鉴权头）。
	// 列表：/api/v1/icons 与 /api/v1/icons/；单图标：/api/v1/icons/{name}.svg
	r.Get("/api/v1/icons", http.HandlerFunc(icons.ListHandler))
	r.Get("/api/v1/icons/", http.HandlerFunc(icons.ListHandler))
	r.Get("/api/v1/icons/{name}", http.HandlerFunc(icons.Handler))

	// 资源 handlers
	authHandler := handler.NewAuth(userRepo)
	instances := handler.NewInstances(repo, manager)
	entities := handler.NewEntities(manager)
	services := handler.NewServices(manager)
	prefs := handler.NewPrefs(repo)
	ws := handler.NewWS(manager, nil, authOpt.Authenticate)
	agg := handler.NewAggregate(manager)
	automation := handler.NewAutomation(manager)
	location := handler.NewLocation(manager)
	media := handler.NewMedia(manager)
	devices := handler.NewDevices(repo)
	registrations := handler.NewRegisteredEntities(manager)
	sensors := handler.NewSensors(manager, repo)

	r.Route("/api/v1", func(r chi.Router) {
		// 认证：status/register/login 公开，me/logout/change-password 需登录。
		r.Route("/auth", func(r chi.Router) {
			r.Get("/status", authHandler.Status)
			r.Post("/register", authHandler.Register)
			r.Post("/login", authHandler.Login)
			r.Group(func(pr chi.Router) {
				pr.Use(auth.Middleware(authOpt))
				pr.Get("/me", authHandler.Me)
				pr.Post("/logout", authHandler.Logout)
				pr.Post("/change-password", authHandler.ChangePassword)
			})
		})

		// WebSocket：浏览器无法携带 Header，改用 query token 自行鉴权。
		r.Get("/ws", ws.ServeHTTP)

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
			r.Get("/devices", devices.List)
			r.Post("/devices", devices.Register)
			r.Put("/devices/{device_id}", devices.Rename)
			r.Delete("/devices/{device_id}", devices.Delete)
		})
	})

	return r
}

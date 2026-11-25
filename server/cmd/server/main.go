// Command server 启动 Sticky Kee 后端服务。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"stickykee/server/internal/api"
	"stickykee/server/internal/auth"
	"stickykee/server/internal/config"
	"stickykee/server/internal/diag"
	"stickykee/server/internal/ha"
	"stickykee/server/internal/hub"
	"stickykee/server/internal/icons"
	"stickykee/server/internal/store"
)

func main() {
	cfg := config.Load()
	setupLogger(cfg.LogLevel)
	icons.Init(cfg.IconCache)

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		slog.Error("open db", "err", err)
		os.Exit(1)
	}
	defer db.Close()
	repo := store.NewInstanceRepo(db.DB())
	urepo := store.NewUserRepo(db.DB())
	uprefs := store.NewUserPrefs(db.DB())
	mrepo := store.NewMessageRepo(db.DB())
	iconRepo := store.NewIconRepo(db.DB())
	invRepo := store.NewInventoryRepo(db.DB())
	finRepo := store.NewFinanceRepo(db.DB())
	// 运行日志持久化：注册 slog 写入器（保留 30 天由 API 层定时清理）
	logRepo := store.NewLogRepo(db.DB())
	diag.SetSink(logRepo.Append)
	hb := hub.New(slog.Default())

	// 可选：注入种子实例
	if cfg.SeedURL != "" {
		if _, gerr := repo.GetActiveInstance(context.Background()); gerr != nil {
			if _, cerr := repo.Create(context.Background(), cfg.SeedURL, cfg.SeedURL, cfg.SeedToken, true); cerr != nil {
				slog.Error("seed instance", "err", cerr)
			} else {
				slog.Info("seeded default ha instance", "url", cfg.SeedURL)
			}
		}
	}

	manager := ha.NewManager(repo, uprefs, hb, slog.Default(), cfg.TLSInsecure)
	// 聊天图片与数据库同级存放：<data>/uploads/im/
	uploadDir := filepath.Join(filepath.Dir(cfg.DBPath), "uploads")
	handler := api.Router(repo, urepo, uprefs, mrepo, logRepo, iconRepo, invRepo, finRepo, hb, manager, auth.Option{
		Authenticate: func(token string) (auth.Identity, bool) {
			u, isAdmin, ok := urepo.IdentityByToken(context.Background(), token)
			return auth.Identity{Username: u, IsAdmin: isAdmin}, ok
		},
	}, uploadDir)

	// 生产部署：SN_STATIC_DIR 指向前端构建产物目录时，由后端直接托管 Web 端
	// （Docker 单镜像前后端同源）。API/健康检查前缀仍由内层路由处理，其余 GET
	// 回退到 index.html（前端 history 路由）。开发模式不设该变量，前端继续走
	// vite dev server 代理，互不影响。
	root := http.Handler(handler)
	if staticDir := os.Getenv("SN_STATIC_DIR"); staticDir != "" {
		root = withSPA(handler, staticDir)
		slog.Info("static web hosting enabled", "dir", staticDir)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           root,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// 优雅关闭
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	slog.Info("Sticky Kee server started", "addr", cfg.HTTPAddr, "db", cfg.DBPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server", "err", err)
		os.Exit(1)
	}
}

func setupLogger(level string) {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	// 原样输出到 stdout，同时在 AI 诊断会话开启时把日志送入诊断收集器。
	base := slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: l})
	slog.SetDefault(slog.New(diag.NewCaptureHandler(base)))
}

// withSPA 把前端静态目录挂到 API 路由之外：请求命中真实文件则直接返回
// （http.ServeFile 自带内容嗅探与 Last-Modified 协商缓存），否则回退
// index.html 支持前端 history 路由。路径先 Clean 归一，杜绝目录穿越。
func withSPA(api http.Handler, dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
			r.URL.Path = p
		}
		if strings.HasPrefix(p, "/api/") || p == "/api" || p == "/healthz" || p == "/readyz" ||
			r.Method != http.MethodGet && r.Method != http.MethodHead {
			api.ServeHTTP(w, r)
			return
		}
		full := filepath.Join(dir, filepath.FromSlash(path.Clean("/"+p)))
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			// /assets/ 为 vite 指纹产物，长缓存安全；根级文件（index.html 等）
			// 每次协商，保证发版即生效。
			if strings.HasPrefix(p, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			http.ServeFile(w, r, full)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

// Command server 启动 Sticky Nuo 后端服务。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stickynuo/server/internal/api"
	"stickynuo/server/internal/auth"
	"stickynuo/server/internal/config"
	"stickynuo/server/internal/ha"
	"stickynuo/server/internal/hub"
	"stickynuo/server/internal/icons"
	"stickynuo/server/internal/store"
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
	handler := api.Router(repo, urepo, uprefs, mrepo, hb, manager, auth.Option{
		Authenticate: func(token string) (auth.Identity, bool) {
			u, isAdmin, ok := urepo.IdentityByToken(context.Background(), token)
			return auth.Identity{Username: u, IsAdmin: isAdmin}, ok
		},
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
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

	slog.Info("Sticky Nuo server started", "addr", cfg.HTTPAddr, "db", cfg.DBPath)
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
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: l})))
}

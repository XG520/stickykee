// Package config 加载服务运行配置。
package config

import (
	"os"
	"path/filepath"
)

// Config 后端服务运行配置。
type Config struct {
	HTTPAddr    string // HTTP 监听地址，如 :8080
	DBPath      string // SQLite 数据库文件路径
	LogLevel    string // 日志级别
	SeedURL     string // 可选：种子 HA 实例地址
	SeedToken   string // 可选：种子 HA 实例 Long-Lived Token
	Standalone  bool   // 无鉴权模式（开发用）
	TLSInsecure bool   // 信任自签名证书（本地 HA 常用，跳过 TLS 校验）
	IconCache   string // 远程图标磁盘缓存目录
}

// Load 从环境变量加载配置，未设置时用默认值。
func Load() *Config {
	dbPath := getenv("SN_DB_PATH", "data/stickynuo.db")
	return &Config{
		HTTPAddr:    getenv("SN_HTTP_ADDR", ":8080"),
		DBPath:      dbPath,
		LogLevel:    getenv("SN_LOG_LEVEL", "info"),
		SeedURL:     os.Getenv("HA_DEFAULT_URL"),
		SeedToken:   os.Getenv("HA_DEFAULT_TOKEN"),
		Standalone:  os.Getenv("SN_STANDALONE") == "1",
		TLSInsecure: getenv("SN_TLS_SKIP_VERIFY", "1") == "1",
		IconCache:   getenv("SN_ICON_CACHE_DIR", filepath.Join(filepath.Dir(dbPath), "icons")),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

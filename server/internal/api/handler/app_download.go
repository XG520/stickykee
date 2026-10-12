package handler

// 安卓 App 安装包下载：Docker 构建时把 release/stickykee-app.apk 打进镜像，
// 运行时由此端点对外提供下载。两接口均要求登录（auth 中间件，见 router），
// 防止安装包外链被恶意批量盗刷；未登录请求返回 401。
// APK 路径解析：SN_APK_FILE 环境变量优先，否则回退 <SN_STATIC_DIR>/downloads/stickykee-app.apk。

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// appAPKPath 解析 APK 文件路径；都未配置时返回空串（下载端点回 404）。
func appAPKPath() string {
	if p := strings.TrimSpace(os.Getenv("SN_APK_FILE")); p != "" {
		return p
	}
	if dir := strings.TrimSpace(os.Getenv("SN_STATIC_DIR")); dir != "" {
		return filepath.Join(dir, "downloads", "stickykee-app.apk")
	}
	return ""
}

// AppInfo 查询 App 安装包信息（公开）：版本号与是否可下载。
// GET /api/v1/app/info → {version, downloadUrl, apkAvailable}
func AppInfo(w http.ResponseWriter, r *http.Request) {
	p := appAPKPath()
	st, err := os.Stat(p)
	WriteJSON(w, 200, map[string]any{
		"version":      Version,
		"downloadUrl":  "/api/v1/app/download",
		"apkAvailable": err == nil && !st.IsDir() && st.Size() > 0,
	})
}

// AppDownload 提供 APK 安装包下载（公开）。http.ServeFile 自带 Content-Type 嗅探
// （.apk → application/vnd.android.package-archive）与 Range 断点续传支持。
func AppDownload(w http.ResponseWriter, r *http.Request) {
	p := appAPKPath()
	if st, err := os.Stat(p); err != nil || st.IsDir() || st.Size() == 0 {
		WriteErr(w, 404, "not_found", "APK 未随服务端发布，请使用打包了安装包的 Docker 镜像")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="StickyKee-`+Version+`.apk"`)
	http.ServeFile(w, r, p)
}

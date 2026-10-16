package handler

// 安卓 App 安装包下载：Docker 构建时把 release/stickykee-app.apk 打进镜像，
// 运行时由此端点对外提供下载。两接口均要求登录（auth 中间件，见 router），
// 防止安装包外链被恶意批量盗刷；未登录请求返回 401。
// APK 路径解析：SN_APK_FILE 环境变量优先，否则回退 <SN_STATIC_DIR>/downloads/stickykee-app.apk。
// APK 版本解析：SN_APK_VERSION_FILE 环境变量指向 sidecar 文件（打包流程自动写入），
// 否则尝试 APK 文件所在目录下的 app_version.txt；都取不到时 fallback 到后端自身 Version
// （仅用于展示，不影响 APK 实际版本判断——原生 APK 版本由 app/build.gradle 的 versionName 决定）。

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

// appAPKVersion 解析 APK 版本：优先读 SN_APK_VERSION_FILE 环境变量指向的 sidecar 文件，
// 其次尝试 APK 文件同目录的 app_version.txt；都取不到时返回空串（由调用方 fallback）。
func appAPKVersion() string {
	// 1) 显式指定的 sidecar 文件
	if p := strings.TrimSpace(os.Getenv("SN_APK_VERSION_FILE")); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			if v := strings.TrimSpace(string(b)); v != "" {
				return v
			}
		}
	}
	// 2) APK 同目录的 app_version.txt
	if apk := appAPKPath(); apk != "" {
		sidecar := filepath.Join(filepath.Dir(apk), "app_version.txt")
		if b, err := os.ReadFile(sidecar); err == nil {
			if v := strings.TrimSpace(string(b)); v != "" {
				return v
			}
		}
	}
	return ""
}

// AppInfo 查询 App 安装包信息（公开）：APK 版本号、下载地址与可用性。
// GET /api/v1/app/info → {version, backendVersion, downloadUrl, apkAvailable}
// version 为 APK 自身版本（build.gradle versionName），backendVersion 为服务端版本——
// 两者独立，APK 更新检查只比对 apk 原生版本与这里的 version。
func AppInfo(w http.ResponseWriter, r *http.Request) {
	p := appAPKPath()
	st, err := os.Stat(p)
	apkVersion := appAPKVersion()
	if apkVersion == "" {
		apkVersion = Version // 向后兼容：没有 sidecar 时退回后端版本
	}
	WriteJSON(w, 200, map[string]any{
		"version":        apkVersion,
		"backendVersion": Version,
		"downloadUrl":    "/api/v1/app/download",
		"apkAvailable":   err == nil && !st.IsDir() && st.Size() > 0,
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
	// 下载文件名带 APK 自身版本（若取得到），便于用户识别；否则退回后端版本。
	ver := appAPKVersion()
	if ver == "" {
		ver = Version
	}
	w.Header().Set("Content-Disposition", `attachment; filename="StickyKee-`+ver+`.apk"`)
	http.ServeFile(w, r, p)
}

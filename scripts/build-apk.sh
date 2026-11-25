#!/usr/bin/env bash
# ============================================================================
# Sticky Kee / 糯米 —— APK 容器内构建脚本
#
# 运行位置：Dockerfile.apk-builder 容器内（JDK17 + Android SDK 34 + Node 20）。
# 由 scripts/deploy.sh 调用（宿主仓库挂载到 /src）：
#   docker run --rm -v "$PWD:/src" stickykee-apk-builder:latest
#
# 链路（等价于 Windows 打包机 build-apk.ps1，但全在 Linux 容器里跑）：
#   0. 版本一致性校验（4 处版本号，防漏 bump）
#   1. app:  npm ci + vite build                    -> app/dist
#   2. 镜像  dist -> apk/www（Capacitor webDir）     -> 壳页 + 前端产物内置进 APK
#   3. apk:  npm ci + cap sync android               -> android 工程 assets/插件
#   4. gradlew assembleRelease（仓库统一 keystore）  -> app-release.apk
#   5. 分发  -> release/stickykee-app.apk（主 Dockerfile 的 COPY 输入）
#
# 可选环境变量：
#   APK_SKIP_WEB=1   跳过步骤 1（app/dist 与 apk/www 已就绪时用，如复用宿主侧产物）
#   GRADLE_ARGS      追加 gradle 参数
# ============================================================================
set -euo pipefail

SRC="${SRC:-/src}"
cd "$SRC"
GRADLE_ARGS="${GRADLE_ARGS:-}"

log() { printf '\n\033[1;36m== [apk] %s ==\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[apk FAIL] %s\033[0m\n' "$*" >&2; exit 1; }

# ---- 0. 版本一致性（4 处 + versionCode，与 bump-version.ps1 校验等价） ----
log "版本一致性校验"
ver_pkg="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' app/package.json | head -1)"
ver_gradle="$(sed -n 's/.*versionName[[:space:]]*"\([^"]*\)".*/\1/p' apk/android/app/build.gradle | head -1)"
ver_go="$(sed -n 's/.*const Version = "\(.*\)".*/\1/p' server/internal/api/handler/health_prefs.go | head -1)"
ver_sidecar="$(cat release/app_version.txt 2>/dev/null | tr -d '[:space:]')"
[ -n "$ver_pkg" ] || fail "无法从 app/package.json 提取 version"
[ -n "$ver_gradle" ] || fail "无法从 build.gradle 提取 versionName"
[ -n "$ver_go" ] || fail "无法从 health_prefs.go 提取 Version"
[ -n "$ver_sidecar" ] || fail "release/app_version.txt 缺失或为空"
[ "$ver_pkg" = "$ver_gradle" ] && [ "$ver_go" = "$ver_pkg" ] && [ "$ver_sidecar" = "$ver_pkg" ] \
  || fail "版本号不一致：pkg=$ver_pkg gradle=$ver_gradle go=$ver_go sidecar=$ver_sidecar（发版前先 bump-version）"
echo "  版本一致：$ver_pkg"

# ---- 1. 前端构建 ----
if [ "${APK_SKIP_WEB:-0}" = "1" ] && [ -f app/dist/index.html ]; then
  log "前端构建（APK_SKIP_WEB=1，复用已有 app/dist）"
else
  log "前端 vite build"
  (
    cd app
    [ -f package-lock.json ] && { npm ci --no-audit --no-fund --ignore-scripts; } || npm install --no-audit --no-fund --ignore-scripts
    npm run build
  )
  [ -f app/dist/index.html ] || fail "app/dist/index.html 缺失，前端构建异常"
fi

# ---- 2. 镜像 dist -> apk/www（等价 robocopy /MIR：内容同步 + 清理多余文件） ----
log "镜像 app/dist -> apk/www"
rm -rf apk/www
mkdir -p apk/www
cp -a app/dist/. apk/www/

# ---- 3. cap sync（生成 android 工程 assets/public、capacitor.plugins.json 等） ----
log "npm ci + cap sync android"
(
  cd apk
  [ -f package-lock.json ] && { npm ci --no-audit --no-fund; } || npm install --no-audit --no-fund
  npx cap sync android
)

# ---- 4. gradlew assembleRelease（release 构建类型已配置统一 keystore 签名） ----
log "gradlew assembleRelease"
# 优先用镜像固定的 JAVA_HOME；否则从 java 路径反推
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
fi
export JAVA_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
echo "  JAVA_HOME=$JAVA_HOME  ANDROID_SDK_ROOT=$ANDROID_HOME"
(
  cd apk/android
  # gradlew 在 Windows 检出时行尾为 CRLF，Linux 容器内 sh 直接执行会报 "not found"。
  # 归一化为同目录 LF 副本再执行（gradlew 靠脚本位置定位 APP_HOME，必须在原地生成；
  # 不改仓库源文件，仅本次构建临时生成，用完即删）
  tr -d '\r' < gradlew > gradlew.lf
  sh gradlew.lf --no-daemon --console=plain \
    -Pandroid.builder.sdkDownload=false \
    -Dorg.gradle.java.home="$JAVA_HOME" \
    assembleRelease $GRADLE_ARGS
  rm -f gradlew.lf
)

apk_out="apk/android/app/build/outputs/apk/release/app-release.apk"
[ -s "$apk_out" ] || fail "APK 产物不存在：$apk_out"

# ---- 5. 分发到主 Dockerfile 的 COPY 输入路径 ----
log "分发 APK -> release/stickykee-app.apk"
mkdir -p release
cp -f "$apk_out" release/stickykee-app.apk

sz_kb="$(du -k release/stickykee-app.apk | cut -f1)"
echo "  版本：$ver_pkg（versionCode 见 build.gradle）"
echo "  产物：release/stickykee-app.apk（$sz_kb KB）"
echo "  时间：$(date '+%Y-%m-%d %H:%M:%S')"
log "APK 构建完成，可继续 docker build 主镜像"

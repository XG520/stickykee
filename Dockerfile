# syntax=docker/dockerfile:1
# 归祺 Sticky Kee —— 前后端单镜像（Go 直接托管前端静态产物，同源免代理）。
# 在仓库根（本文件所在目录）执行：
#   docker build -t stickynuo:latest .
#   docker run -d --name stickynuo -p 8080:8080 -v stickynuo-data:/data \
#     -e SN_JWT_SECRET=<改成随机串> --restart unless-stopped stickynuo:latest

# ---------- 前端构建（npmmirror 国内源） ----------
FROM node:20-alpine AS web
WORKDIR /web
RUN npm config set registry https://registry.npmmirror.com
COPY app/package.json app/package-lock.json ./
# --ignore-scripts：跳过 onnxruntime-node 的 postinstall（仅 Node 端推理用，
# 浏览器构建不需要；其安装脚本需直连国外源下载二进制，国内网络会失败）。
# esbuild/rollup 的 linux 二进制走 optionalDependencies 预编译包，无需脚本。
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY app/ ./
RUN npm run build

# ---------- 后端构建（goproxy.cn 国内代理，静态编译） ----------
FROM golang:1.26-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOPROXY=https://goproxy.cn,direct
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/stickynuo ./cmd/server

# ---------- 运行层：单二进制 + 前端产物，数据统一落 /data 卷 ----------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -g 10001 sn && adduser -D -u 10001 -G sn sn
WORKDIR /app
COPY --from=build /out/stickynuo ./stickynuo
COPY --from=web /web/dist ./dist
# 安卓 App 安装包打进镜像：设置页「系统信息」与 /api/v1/app/download 提供下载。
# 构建镜像前需先产出 APK 并复制到仓库根 release/stickykee-app.apk：
#   apk/android $ ./gradlew assembleDebug
#   $ mkdir -p release && cp apk/android/app/build/outputs/apk/debug/app-debug.apk release/stickykee-app.apk
# 无 APK 时此 COPY 会构建失败——按需注释掉下行与 SN_APK_FILE。
COPY release/stickykee-app.apk ./dist/downloads/stickykee-app.apk
# 数据库、聊天图片（/data/uploads/im）、图标缓存（/data/icons）都在 /data 下
ENV SN_HTTP_ADDR=:8080 \
    SN_DB_PATH=/data/stickynuo.db \
    SN_STATIC_DIR=/app/dist \
    SN_APK_FILE=/app/dist/downloads/stickykee-app.apk
VOLUME /data
EXPOSE 8080
USER sn
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/app/stickynuo"]

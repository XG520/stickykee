# 糯米 Sticky Kee

基于 Home Assistant 的智能家画布应用：酷家乐式户型图编辑器（2D 绘制 + 3D 渲染）、智能仪表盘卡片、聊天与系统通知（文本/图片/语音消息/一对一及多人语音通话/内置 HA 智家助手）、移动端适配。前端 Vue 3 + Vite + Tailwind，后端 Go（chi + modernc SQLite，纯 Go 免 CGO），WebSocket 实时同步 HA 实体状态。

## 目录结构

```
homecanvas/
├── app/                 # Vue 3 前端（vite，构建产物 dist/）
├── server/              # Go 后端（cmd/server 入口）
│   └── Dockerfile       # 纯后端镜像（前后端分离部署用）
├── apk/                 # Capacitor Android 壳工程（APK 打包）
│   └── dist/            # APK 产物输出
└── Dockerfile           # 前后端合一镜像（推荐部署方式）
```

## 本地开发

```powershell
# 前端（vite dev server，/api 代理到 localhost:8080）
cd app
npm install          # 使用 npmmirror 国内源
npm run dev          # http://localhost:5173

# 后端（另开终端）
cd server
go run ./cmd/server/main.go    # 监听 :8080，数据库 data/stickynuo.db
```

后端默认无鉴权跳过 HA 自签证书校验（SN_TLS_SKIP_VERIFY=1）。登录后在「设置 → Home Assistant 连接」配置 HA 地址与个人 Token。

## Docker 部署

### 方式一：前后端合一镜像（推荐）

后端直接托管前端静态产物，网页与 APK 同源访问，无需额外反向代理或跨域配置。

```bash
# 构建（在仓库根目录）
docker build -t stickynuo:latest .

# 运行
docker run -d --name stickynuo \
  -p 8080:8080 \
  -v stickynuo-data:/data \
  -e SN_JWT_SECRET=<改成随机长串> \
  --restart unless-stopped \
  stickynuo:latest
```

- 访问 `http://<主机IP>:8080` 即为完整应用（SPA history 路由已回退支持）。
- 所有数据（SQLite 数据库、聊天图片 `uploads/im/`、图标缓存 `icons/`）统一落在 `/data` 卷内，升级镜像不丢数据。
- 容器以非 root 用户运行，内置 `/healthz` 健康检查。

### 方式二：纯后端镜像（前后端分离）

`server/Dockerfile` 仅打包 Go 后端（数据库在 `/app/data`），适合前端单独托管到 nginx 等场景：

```bash
docker build -t stickynuo-server:latest ./server

docker run -d --name stickynuo-server \
  -p 8080:8080 \
  -v stickynuo-data:/app/data \
  -e SN_JWT_SECRET=<改成随机长串> \
  --restart unless-stopped \
  stickynuo-server:latest
```

此方式下后端不提供静态页面，前端需另行部署并将 `/api`、`/api/v1/ws` 反向代理到该服务（或开发模式用 vite 代理）。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SN_HTTP_ADDR` | `:8080` | HTTP 监听地址 |
| `SN_DB_PATH` | `data/stickynuo.db` | SQLite 数据库路径（图标缓存默认建在其同目录） |
| `SN_JWT_SECRET` | `dev-secret-change-me` | **生产必须改为随机长串**，否则会话可被伪造 |
| `SN_STATIC_DIR` | 空（不托管） | 设为前端 `dist/` 目录后由后端托管网页（合一镜像已内置 `/app/dist`） |
| `SN_LOG_LEVEL` | `info` | 日志级别：debug / info / warn / error |
| `SN_STANDALONE` | `0` | `1` 为无鉴权模式，仅限本地开发，生产禁用 |
| `SN_TLS_SKIP_VERIFY` | `1` | 跳过 HA 自签证书校验；HA 用可信证书时设 `0` |
| `SN_ICON_CACHE_DIR` | `<数据库目录>/icons` | HA 实体图标缓存目录 |
| `HA_DEFAULT_URL` / `HA_DEFAULT_TOKEN` | 空 | 可选：首个 HA 实例的种子地址与长期访问令牌 |

## Android APK

产物：`apk/android/app/build/outputs/apk/debug/app-debug.apk`（debug 签名，可直接安装）。

- **首次打开**：显示服务器地址配置页，可手动填写或点「自动识别内网服务器」；支持保存多个地址（内网/外网），WiFi 时优先内网、移动数据时优先外网，自动探测后整页进入应用。
- **地址变更**：所有地址均不可达时自动回到地址列表；可随时添加、编辑、删除地址。
- **保持登录**：登录页勾选「保持登录」后，关闭 APP 再打开无需重新登录（令牌持久化 30 天）；不勾选则仅本次会话有效。
- **前端更新**：APK 只是壳，页面在服务器上——重新 `docker build` 镜像后 APK 内自动生效，无需重装。
- **语音功能**：聊天内可发语音消息（按住说话、上滑取消），并支持一对一及多人语音通话（WebRTC mesh，建议 ≤6 人）。首次录音时系统弹麦克风授权，Manifest 已声明 RECORD_AUDIO。
- **智家助手**：消息列表置顶的「智家助手」即 HA Assist（conversation/process），可用自然语言问天气、控设备、闲聊；多轮上下文由 HA conversation_id 保持。需要在设置中配置 HA 地址与个人 Token，且 HA 已配置助手（默认 Assist 即可）。

### 打包命令（自行打包）

前置：JDK 17、Android SDK（环境变量 `JAVA_HOME` 指向 JDK；Android SDK 可通过 Android Studio 或命令行工具安装）。

```powershell
# 1. 安装壳工程依赖（仅首次或依赖变更时）
cd apk
npm install

# 2. 同步壳页（www/）与配置到 Android 工程
npx cap sync android

# 3. 构建 APK
$env:JAVA_HOME = "C:\path\to\jdk-17"   # 若未全局配置
cd android
.\gradlew.bat assembleDebug            # Debug 包
# .\gradlew.bat assembleRelease        # Release 包（需自行配置签名 keystore）

# 4. 产物路径
# app\build\outputs\apk\debug\app-debug.apk
```

依赖与 Gradle 发行版均走阿里云/腾讯云国内镜像，无需代理。壳页 `apk/www/index.html` 有改动时，重新执行第 2、3 步即可；仅 `app/` 前端改动（语音、卡片等）无需 sync，更新服务器镜像后直接生效。

### 语音通话网络说明

- 通话语音走 **WebRTC P2P**，服务器只中继信令（经现有 /ws，反向代理按 WebSocket 配置即可）。
- 同一直局域网无需 STUN 直连；跨网（如外网拨入）依赖 STUN 打洞（已内置腾讯/小米公共 STUN）。
- 对称型 NAT 打洞失败时需自备 **TURN** 中继（coturn），在 [call.js](app/src/utils/call.js) 的 ICE_SERVERS 中加入 `turn:` 配置。

## 安全与加密

聊天数据采用**应用层加密**（在 TLS 之外再加一层，内网 http 部署同样生效）：

- 登录后客户端与服务端经 **ECDH P-256** 协商共享密钥（临时密钥，每次握手轮换；纯 JS 实现 [@noble](https://github.com/paulmillr/noble) ，兼容 APK WebView 的 http 非安全上下文）。
- **HKDF-SHA256** 派生会话密钥，**AES-256-GCM** 密封消息体（带完整性校验，密钥仅存服务端内存，重启即重新握手）。
- 加密范围：文本消息（含智家助手会话）、会话列表、历史消息。图片/语音文件经鉴权接口 + 不可枚举随机名传输，公网部署建议同时启用 HTTPS（见下）。
- 服务重启或改密导致密钥失效时，客户端自动重新握手并重试一次。

## 反向代理（可选）

公网部署建议前置 nginx/caddy 做 HTTPS 终结，并将 `/api/v1/ws` 升级为 WebSocket：

```nginx
location /api/v1/ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
location / {
    proxy_pass http://127.0.0.1:8080;
}
```

## 常见问题

- **端口占用**：`bind: Only one usage of each socket address` 表示 8080 已被旧实例占用，先停掉旧进程再启动。
- **数据库锁**：同一 `SN_DB_PATH` 不要被多个后端实例同时使用。
- **镜像源**：项目默认配置国内源（npm npmmirror、Go goproxy.cn、Gradle 阿里云/腾讯云），无需额外设置。

docker run -d --name stickynuo \
  --restart unless-stopped \
  -p 8080:8080 \
  -v ./data:/data \
  -e SN_JWT_SECRET=<用 openssl rand -hex 32 生成随机长串> \
  -e TZ=Asia/Shanghai \
  stickynuo:latest
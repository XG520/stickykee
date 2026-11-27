# 糯米 Sticky Kee

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883.svg)](https://vuejs.org/)
[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8.svg)](https://go.dev/)
[![Android](https://img.shields.io/badge/Android-7.0+-3DDC84.svg)](https://developer.android.com/)

基于 Home Assistant 的智能家画布应用：酷家乐式户型图编辑器（2D 绘制 + 3D 渲染；个人精力有限没有测试，户型图只是个雏形）、智能仪表盘卡片、聊天与系统通知（文本/图片/语音消息/一对一及多人语音通话/内置 HA 智家助手）、移动端适配。代码完全由ai生成，个人精力有限，功能可能有缺失或错误。欢迎提交pull request或反馈问题。

## 功能特性

### 户型图编辑器
- **2D 绘制**：墙体绘制、房间识别、门窗放置、家具摆放
- **3D 渲染**：实时 3D 预览、材质切换、光照调节
- **家具库**：内置 15 种家具模型（来自 Sweet Home 3D 免费模型库）
- **导出**：支持导出为图片或 PDF

### 智能仪表盘
- **卡片系统**：可视化拖拽搭建、图层管理、模板保存
- **数据绑定**：自动同步 HA 实体状态、实时刷新
- **自定义组件**：文字、图标、进度条、状态圆点等
- **多设备适配**：手机/平板/电脑自适应布局

### 消息与通话
- **即时消息**：文本、图片、语音消息
- **语音通话**：一对一及多人通话（≤6 人）
- **智家助手**：集成 HA Assist，自然语言控制设备
- **应用层加密**：ECDH + AES-256-GCM，内网 http 同样安全

### 移动端
- **Android APP**：原生壳 + 远程加载，自动更新
- **传感器上报**：电池、网络、位置、环境光等
- **后台运行**：常驻保活、开机自启动
- **扫码录入**：条码识别、商品自动填充

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Vite + Tailwind CSS + Three.js |
| 后端 | Go (chi + modernc SQLite，纯 Go 免 CGO) |
| 实时通信 | WebSocket |
| 移动端 | Capacitor (Android) |
| 部署 | Docker / Docker Compose |

## 目录结构

```
homecanvas/
├── app/                 # Vue 3 前端（vite，构建产物 dist/）
├── server/              # Go 后端（cmd/server 入口）
│   └── Dockerfile       # 纯后端镜像（前后端分离部署用）
├── apk/                 # Capacitor Android 壳工程（APK 打包，产物在 android/app/build/outputs/apk/）
├── release/             # 构建镜像前放置 stickykee-app.apk（被根 Dockerfile COPY 进镜像供服务端下载）
└── Dockerfile           # 前后端合一镜像（推荐部署方式）
```

## 快速开始

### 方式一：Docker 部署（推荐）

日常发版用部署脚本（容器内自动编译 APK + 前后端 + 重启，详见 [打包指南](docs/打包指南.md)）：

```bash
bash scripts/deploy.sh update
```

手动分步（等价于脚本内部动作；主镜像构建前 `release/stickykee-app.apk` 必须存在，否则 `COPY` 失败）：

```bash
# 1. 先出 APK（容器编译）
bash scripts/deploy.sh apk

# 2. 构建镜像
docker build -t stickykee:latest .

# 3. 运行容器
docker run -d --name stickykee \
  --network host \
  -v stickykee-data:/data \
  -e TZ=Asia/Shanghai \
  --restart unless-stopped \
  stickykee:latest
```

访问 `http://<主机IP>:18480` 即可使用。

### 方式二：本地开发

```powershell
# 前端（vite dev server，/api 代理到 localhost:18480）
cd app
npm install          # 使用 npmmirror 国内源
npm run dev          # http://localhost:5173

# 后端（另开终端）
cd server
go run ./cmd/server/main.go    # 监听 :18480，数据库 data/stickynuo.db
```

登录后在「设置 → Home Assistant 连接」配置 HA 地址与个人 Token。

## 详细文档

- [使用手册](docs/使用手册.md) - 完整功能说明
- [打包指南](docs/打包指南.md) - APK 打包与发版流程
- [更新日志](docs/更新日志.md) - 版本更新记录
- [传感器开发规范](docs/传感器原生采集开发规范.md) - 原生传感器开发
- [库存系统设计](docs/库存系统设计.md) - 库存与扫码功能
- [记账系统设计](docs/记账系统设计.md) - 记账模块设计

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SN_HTTP_ADDR` | `:18480` | HTTP 监听地址 |
| `SN_DB_PATH` | `data/stickynuo.db` | SQLite 数据库路径 |
| `SN_STATIC_DIR` | 空（不托管） | 设为前端 `dist/` 目录后由后端托管网页 |
| `SN_LOG_LEVEL` | `info` | 日志级别：debug / info / warn / error |
| `SN_STANDALONE` | `0` | `1` 为无鉴权模式，仅限本地开发 |
| `SN_TLS_SKIP_VERIFY` | `1` | 跳过 HA 自签证书校验 |
| `SN_ICON_CACHE_DIR` | `<数据库目录>/icons` | HA 实体图标缓存目录 |
| `SN_APK_FILE` | 空 | 安卓安装包路径 |
| `HA_DEFAULT_URL` / `HA_DEFAULT_TOKEN` | 空 | 首个 HA 实例的种子地址与令牌 |
| `TZ` | UTC | 时区，国内部署设 `Asia/Shanghai` |

## Android APK

### 服务端下载（推荐）

合一镜像构建时已内置 APK，用户可直接下载：
- 网页端：「设置 → 系统信息 → 安卓 App → 下载安装包」
- APP 内：检测到新版本时显示「发现新版本，立即更新」

### 自行打包

推荐：部署机上一条命令（容器内自动完成 前端构建 → cap sync → gradle 编译 → 签名）：

```bash
# 仓库根目录，需已装 Docker；APK 由 Docker 构建容器现场编译
# （工具链：JDK17 + Android SDK34 + Node20，gradle/npm 全走国内镜像）
bash scripts/deploy.sh apk
# 产物：release/stickykee-app.apk（已签名，可直接安装）
```

前置：发版前先用 `scripts/bump-version.ps1` 同步 4 处版本号（容器编译会校验，不一致直接失败）。

若确需本机手工打包（需 JDK 17 + Android SDK）：

```powershell
cd apk
npm install && npx cap sync android
cd android
$env:JAVA_HOME = "C:\path\to\jdk-17"
.\gradlew.bat assembleDebug
```

详见 [打包指南](docs/打包指南.md)。

## 安全与加密

聊天数据采用**应用层加密**（在 TLS 之外再加一层，内网 http 部署同样生效）：

- **密钥协商**：ECDH P-256，临时密钥每次握手轮换
- **密钥派生**：HKDF-SHA256
- **消息加密**：AES-256-GCM，带完整性校验
- **加密范围**：文本消息、会话列表、历史消息

## 反向代理（可选）

公网部署建议前置 nginx/caddy 做 HTTPS 终结：

```nginx
location /api/v1/ws {
    proxy_pass http://127.0.0.1:18480;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
location / {
    proxy_pass http://127.0.0.1:18480;
}
```

## 常见问题

- **端口占用**：`bind: Only one usage of each socket address` 表示 18480 已被旧实例占用，先停掉旧进程再启动
- **数据库锁**：同一 `SN_DB_PATH` 不要被多个后端实例同时使用
- **镜像源**：项目默认配置国内源（npm npmmirror、Go goproxy.cn、Gradle 阿里云/腾讯云），无需额外设置

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交改动 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 许可证

本项目以 [MIT](LICENSE) 许可证开源，可自由使用、修改与分发，请保留版权与许可声明。

- **作者 / GitHub**：[XG520](https://github.com/XG520)
- **版权**：Copyright (c) 2026 XG520

## 第三方资源

- **3D 家具模型**（`app/public/models/furniture/`）：来自 [Sweet Home 3D 免费模型库](https://www.sweethome3d.com/free-3d-models/)，作者署名嵌入各 `.obj`/`.mtl` 头部；许可条件为 **Free Art License 或 CC-BY 3.0 二选一**（可免费商用，须保留作者署名）
- **图标字体**：Material Symbols、Material Design Icons（Apache-2.0）
- **前端框架**：Vue 3（MIT）、Vite（MIT）、Tailwind CSS（MIT）
- **3D 引擎**：Three.js（MIT）
- **后端框架**：chi（MIT）、modernc.org/sqlite（BSD-3-Clause）

## 致谢

- [Home Assistant](https://www.home-assistant.io/) - 智能家居平台
- [Sweet Home 3D](https://www.sweethome3d.com/) - 3D 模型库
- [Vue.js](https://vuejs.org/) - 渐进式前端框架
- [Go](https://go.dev/) - 高效后端语言

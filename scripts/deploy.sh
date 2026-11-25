#!/usr/bin/env bash
# ============================================================================
# Sticky Kee / 糯米 —— 服务器部署脚本（Docker：容器编译 APK + 单镜像发布）
#
# 用法（在部署目录 = git 仓库根 下执行）：
#   bash scripts/deploy.sh                # 默认 = update 全流程发版：
#                                         #   git pull → 容器编译 APK → build 主镜像 → 重启 → prune
#   bash scripts/deploy.sh update         # 同上（显式）
#   bash scripts/deploy.sh apk            # 只编译 APK（git pull + 容器编译），不动主容器
#   bash scripts/deploy.sh frontend      # 只重建主镜像并重启（复用已有 APK，不 pull、不编译 APK）
#   bash scripts/deploy.sh backend       # 同 frontend（前后端烘焙在同一镜像里）
#   bash scripts/deploy.sh build         # 只构建主镜像，不重启
#   bash scripts/deploy.sh restart       # 不构建，按当前 .env 重新部署
#   bash scripts/deploy.sh status        # 容器状态 + /healthz + 内置版本
#   bash scripts/deploy.sh logs [-f]     # 查看日志（-f 跟随）
#   bash scripts/deploy.sh prune          # 清理悬挂镜像与构建缓存
#   bash scripts/deploy.sh stop          # 停止并移除容器（数据卷保留）
#
# 可选参数（与子命令自由组合）：
#   --no-apk          update 时跳过 APK 编译（复用 release/ 里已有 APK；前端/后端-only 发版）
#   --skip-web        APK 编译时跳过前端 vite build（APK_SKIP_WEB=1，仅壳页/原生层改动时用）
#   --keep-temp       成功后不清理工作区中间物（默认 update/apk/frontend/backend 成功后
#                     自动清理 node_modules / dist / apk/www / gradle 产物等临时目录）
#   --skip-git        跳过 git pull（用工作区当前代码）
#   --rebuild-builder 强制重建 APK 构建镜像（工具链升级、换源时用）
#   --no-prune        跳过收尾的镜像清理
#   -h | --help       显示帮助
#
# 发版链路（日常只需一条命令）：
#   1. 本地发版机：scripts\bump-version.ps1 <新版本>（4 处版本号一致）
#   2. git push
#   3. 部署机：bash scripts/deploy.sh update
#      （APK 由 Docker 构建容器现场编译：Dockerfile.apk-builder = JDK17 + Android SDK34
#       + Node20，gradle/npm 全走国内镜像；产物 release/stickykee-app.apk 打进主镜像，
#       经 /api/v1/app/download 下发、App 内更新检测比对版本号）
#
# 配置：scripts/.env（cp .env.example .env 按需修改）——只含通用部署项；
#       HA 地址、API key 等业务密钥在应用启动后的「系统配置」里填，不进 Docker。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
APK_OUT="$ROOT/release/stickykee-app.apk"

NO_APK=0
NO_PRUNE=0
KEEP_TEMP=0
SKIP_GIT=0
REBUILD_BUILDER=0
SKIP_WEB=0
LOG_FOLLOW=0
CMD="update"

usage() {
  awk 'NR>1 { if ($0 ~ /^# ?/) { sub(/^# ?/, ""); print; next } else exit }' "$0"
}

# ---------- 解析命令行（子命令与参数可自由穿插） ----------
for a in "$@"; do
  case "$a" in
    update|frontend|backend|apk|build|restart|status|logs|prune|stop) CMD="$a" ;;
    --no-apk)          NO_APK=1 ;;
    --skip-web)        SKIP_WEB=1 ;;
    --keep-temp)       KEEP_TEMP=1 ;;
    --skip-git)        SKIP_GIT=1 ;;
    --rebuild-builder) REBUILD_BUILDER=1 ;;
    --no-prune)        NO_PRUNE=1 ;;
    -f)                LOG_FOLLOW=1 ;;
    -h|--help)         usage; exit 0 ;;
    *) echo "未知参数：$a" >&2; echo; usage; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[WARN] %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; }

# ---------- 读取 .env（KEY=VALUE；跳过空行/注释；去 CRLF 与包裹引号） ----------
declare -a ENV_K=() ENV_V=()
get() { # get KEY [DEFAULT]
  local k="$1" def="${2:-}" found="" i
  for i in "${!ENV_K[@]}"; do
    [[ "${ENV_K[$i]}" == "$k" ]] && found="${ENV_V[$i]}"
  done
  printf '%s' "${found:-$def}"
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    warn "未找到 $ENV_FILE —— 使用内置默认（stickykee / 8080 / stickykee-data:/data / TZ=Asia/Shanghai）"
  else
    log "加载配置：$ENV_FILE"
    local line k v
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      [[ -z "$line" || "$line" == \#* ]] && continue
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
        if [[ "$v" == \"*\" && ${#v} -ge 2 ]]; then v="${v:1:${#v}-2}"; fi
        if [[ "$v" == \'*\' && ${#v} -ge 2 ]]; then v="${v:1:${#v}-2}"; fi
        ENV_K+=("$k"); ENV_V+=("$v")
        printf '  %s=%s\n' "$k" "$v"
      else
        warn ".env 解析失败（忽略）：$line"
      fi
    done < "$ENV_FILE"
  fi
  CONTAINER="$(get CONTAINER stickykee)"
  IMAGE="$(get IMAGE stickykee:latest)"
  BUILDER="$(get BUILDER stickykee-apk-builder:latest)"
  PORT_MAP="$(get PORT_MAP 8080:8080)"
  VOLUME="$(get VOLUME stickykee-data:/data)"
  RESTART="$(get RESTART unless-stopped)"
  TZ="$(get TZ Asia/Shanghai)"
}

# ---------- 预检 ----------
precheck() {
  command -v docker >/dev/null 2>&1 || { err "未找到 docker，请先安装"; exit 1; }
  [[ -f "$ROOT/Dockerfile" ]] || { err "找不到 $ROOT/Dockerfile，请在仓库根执行"; exit 1; }
  [[ -f "$ROOT/Dockerfile.apk-builder" ]] || { err "找不到 $ROOT/Dockerfile.apk-builder"; exit 1; }
  [[ -f "$ROOT/release/app_version.txt" ]] || { err "release/app_version.txt 缺失（git pull 后应存在）"; exit 1; }
}

run_git_pull() {
  if [[ "$SKIP_GIT" -eq 1 ]]; then
    warn "--skip-git：跳过 git pull"
    return 0
  fi
  log "git pull"
  git -C "$ROOT" pull
}

# ---------- APK 容器编译 ----------
ensure_builder() {
  if [[ "$REBUILD_BUILDER" -eq 1 ]]; then
    log "重建 APK 构建镜像（--rebuild-builder）"
  elif docker image inspect "$BUILDER" >/dev/null 2>&1; then
    return 0
  else
    log "构建 APK 构建镜像（首次，工具链：JDK17 + Android SDK34 + Node20，国内源）"
  fi
  local -a build_args=( -f "$ROOT/Dockerfile.apk-builder" -t "$BUILDER" )
  local base; base="$(get BUILDER_BASE ubuntu:22.04)"
  if [[ "$base" != "ubuntu:22.04" ]]; then
    build_args+=( --build-arg "BUILDER_BASE=$base" )
    log "base image 覆盖：$base（国内拉不到 docker.io 时用）"
  fi
  docker build "${build_args[@]}" "$ROOT"
}

apk_build() {
  local cache_vol="stickykee-apk-cache"
  ensure_builder
  log "容器内编译 APK（$BUILDER）"
  docker volume inspect "$cache_vol" >/dev/null 2>&1 || docker volume create "$cache_vol" >/dev/null
  docker run --rm \
    -v "$ROOT:/src" \
    -v "$cache_vol:/cache" \
    -e GRADLE_USER_HOME=/cache/gradle \
    -e NPM_CONFIG_CACHE=/cache/npm \
    -e APK_SKIP_WEB="$SKIP_WEB" \
    "$BUILDER"
  [[ -s "$APK_OUT" ]] || { err "APK 产物缺失：$APK_OUT（容器构建未成功）"; exit 1; }
  local sz; sz="$(du -h "$APK_OUT" | cut -f1)"
  log "APK 就绪：$APK_OUT（$sz）"
}

# 复用已有 APK（frontend/backend/build 路径；主 Dockerfile 的 COPY 要求文件必须存在）
require_apk() {
  [[ -s "$APK_OUT" ]] || {
    err "缺少 $APK_OUT —— 主镜像构建必需"
    echo "  先执行：bash $0 apk        # 容器内编译 APK（不重启容器）"
    echo "  或    ：bash $0 update     # 全流程（含 APK 编译 + 重启）"
    exit 1
  }
  log "复用已有 APK：$APK_OUT"
}

# 清理容器构建产生的工作区中间物（不碰 release/ 产物与 stickykee-apk-cache 缓存卷）
cleanup_temp() {
  [[ "$KEEP_TEMP" -eq 1 ]] && { log "跳过临时文件清理（--keep-temp）"; return 0; }
  log "清理临时文件（node_modules / 构建产物 / gradle 中间目录）"
  local d removed=0
  for d in app/node_modules app/dist apk/node_modules apk/www \
           apk/android/.gradle apk/android/build apk/android/app/build; do
    if [[ -e "$ROOT/$d" ]]; then rm -rf "$ROOT/$d" && removed=$((removed + 1)); fi
  done
  [[ "$removed" -gt 0 ]] && log "已清理 $removed 个目录（release/ 产物与 apk 构建缓存卷保留）" \
                        || log "无临时文件需要清理"
}

# ---------- 主镜像构建与部署 ----------
build_main() {
  log "构建主镜像 $IMAGE"
  docker build -t "$IMAGE" "$ROOT"
  docker images "$IMAGE" --format '  {{.Repository}}:{{.Tag}}  {{.Size}}  {{.CreatedSince}}'
}

deploy_container() {
  local args=(-d --name "$CONTAINER" --restart "$RESTART" "$PORT_MAP" "$VOLUME" -e "TZ=$TZ")
  local v
  v="$(get SN_LOG_LEVEL "")"
  [[ -n "$v" ]] && args+=(-e "SN_LOG_LEVEL=$v")
  args+=("$IMAGE")

  log "部署容器 $CONTAINER"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run "${args[@]}"
}

wait_health() {
  local i st
  for i in 1 2 3; do
    sleep 10
    st="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
    case "$st" in
      healthy)  log "容器健康 ✔"; return 0 ;;
      running|starting) : ;;
      *) err "容器状态异常：$st，最近日志："; docker logs --tail 30 "$CONTAINER" >&2 || true; return 1 ;;
    esac
  done
  st="$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
  [[ "$st" == running ]] && { log "容器已运行（health 评估中），稍后 bash $0 status 确认"; return 0; }
  err "容器未运行（状态：$st），最近日志："; docker logs --tail 30 "$CONTAINER" >&2 || true; return 1
}

prune_images() {
  [[ "$NO_PRUNE" -eq 1 ]] || return 0
  log "清理悬挂镜像与构建缓存"
  docker image prune -af >/dev/null 2>&1 || true
  docker builder prune -f >/dev/null 2>&1 || true
}

status() {
  load_env
  log "容器状态"
  docker ps -a --filter "name=$CONTAINER" --format '  {{.Names}}  {{.Status}}  {{.Size}}' 2>/dev/null || true
  log "健康检查"
  local body
  body="$(curl -fsS "http://127.0.0.1:$(get PORT 8080)/healthz" 2>/dev/null || echo '（无法访问 /healthz，容器可能未运行）')"
  echo "  $body"
  log "内置版本"
  echo "  release/app_version.txt：$(cat "$ROOT/release/app_version.txt" 2>/dev/null || echo 缺失)"
  echo "  release/stickykee-app.apk：$( [[ -s "$APK_OUT" ]] && echo "存在（$(du -h "$APK_OUT" | cut -f1)）" || echo 缺失 )"
}

cmd_logs() { load_env; if [[ "$LOG_FOLLOW" -eq 1 ]]; then docker logs -f --tail 50 "$CONTAINER"; else docker logs --tail 80 "$CONTAINER"; fi; }
cmd_stop() { load_env; docker stop "$CONTAINER" && docker rm "$CONTAINER"; log "已停止并移除 $CONTAINER（数据卷保留）"; }

# ---------- 主流程 ----------
case "$CMD" in
  update)
    precheck; load_env
    run_git_pull
    if [[ "$NO_APK" -eq 1 ]]; then require_apk; else apk_build; fi
    build_main; deploy_container; wait_health; cleanup_temp; prune_images ;;
  apk)
    precheck; load_env
    run_git_pull
    apk_build; cleanup_temp ;;
  frontend|backend)
    precheck; load_env
    require_apk
    build_main; deploy_container; wait_health; cleanup_temp; prune_images ;;
  build)
    precheck; load_env
    require_apk
    build_main ;;
  restart)
    load_env; deploy_container; wait_health ;;
  status)  status ;;
  logs)    cmd_logs ;;
  prune)   prune_images ;;
  stop)    cmd_stop ;;
esac

case "$CMD" in
  update|apk|frontend|backend|build|restart|prune|stop)
    log "完成。访问 http://<主机IP>:$(get PORT 8080)" ;;
esac

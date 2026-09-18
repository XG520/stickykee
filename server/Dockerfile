# ---- build stage ----
FROM golang:1.26-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO_ENABLED=0 静态编译（modernc sqlite 纯 Go，免 CGO）。
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/stickynuo-server ./cmd/server

# ---- runtime stage ----
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 1001 app

WORKDIR /app
COPY --from=builder /out/stickynuo-server /app/stickynuo-server

# 预建数据目录并授予 app 用户：命名卷首次挂载时会继承该目录的属主，
# 否则卷目录为 root 所有，非 root 进程无法创建 SQLite 库，部署时自动建库会失败。
RUN mkdir -p /app/data && chown -R app:app /app
USER app

ENV SN_HTTP_ADDR=:8080 \
    SN_DB_PATH=/app/data/stickynuo.db \
    SN_STANDALONE=0 \
    TZ=Asia/Shanghai

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

ENTRYPOINT ["/app/stickynuo-server"]
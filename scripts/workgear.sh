#!/usr/bin/env bash
#
# WorkGear 服务管理脚本
# 用法: workgear.sh {start|stop|restart|status|logs}
#

set -euo pipefail

# ─── 路径 ───────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_DIR="$ROOT_DIR/pids"
LOG_DIR="$ROOT_DIR/logs"

# ─── 服务定义 ───────────────────────────────────────────
SERVICES=(web api orchestrator)

# 端口映射（兼容 bash 3.2）
get_port() {
  case "$1" in
    web) echo 3000 ;;
    api) echo 4000 ;;
    orchestrator) echo 50051 ;;
  esac
}

# ─── 颜色 ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── 工具函数 ───────────────────────────────────────────
info()  { echo -e "${CYAN}ℹ${NC}  $*"; }
ok()    { echo -e "${GREEN}✅${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠️${NC}  $*"; }
fail()  { echo -e "${RED}❌${NC} $*"; }

pid_file() { echo "$PID_DIR/$1.pid"; }
log_file() { echo "$LOG_DIR/$1.log"; }

is_running() {
  local pf
  pf="$(pid_file "$1")"
  if [ -f "$pf" ]; then
    local pid
    pid="$(cat "$pf")"
    if ps -p "$pid" > /dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

read_pid() {
  cat "$(pid_file "$1")" 2>/dev/null || echo ""
}

check_port() {
  nc -z localhost "$1" > /dev/null 2>&1
}

wait_for_port() {
  local port=$1 name=$2 timeout=$3
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if check_port "$port"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
}

# ─── 检查前置条件 ───────────────────────────────────────
check_prereqs() {
  # Docker 数据库
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q workgear-postgres; then
    warn "PostgreSQL 容器未运行，正在启动..."
    (cd "$ROOT_DIR/docker" && docker-compose up -d)
    sleep 3
  fi

  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q workgear-redis; then
    warn "Redis 容器未运行，正在启动..."
    (cd "$ROOT_DIR/docker" && docker-compose up -d)
    sleep 2
  fi
}

# ─── 构建服务 ───────────────────────────────────────────
build_service() {
  local svc=$1
  case "$svc" in
    web)
      info "构建 Web..."
      (cd "$ROOT_DIR/packages/web" && pnpm build) >> "$(log_file web)" 2>&1
      ;;
    api)
      info "构建 API..."
      (cd "$ROOT_DIR/packages/api" && pnpm build) >> "$(log_file api)" 2>&1
      ;;
    orchestrator)
      info "构建 Orchestrator..."
      (cd "$ROOT_DIR/packages/orchestrator" && make build) >> "$(log_file orchestrator)" 2>&1
      ;;
  esac
}

# ─── 启动单个服务 ────────────────────────────────────────
start_service() {
  local svc=$1

  if is_running "$svc"; then
    warn "$svc 已在运行 (PID: $(read_pid "$svc"))"
    return 0
  fi

  # 检查端口是否被占用
  local port
  port="$(get_port "$svc")"
  if check_port "$port"; then
    fail "端口 $port 已被占用，无法启动 $svc"
    echo "    占用进程: $(lsof -i :"$port" -t 2>/dev/null || echo '未知')"
    return 1
  fi

  build_service "$svc"

  local log
  log="$(log_file "$svc")"
  echo "--- $(date '+%Y-%m-%d %H:%M:%S') start ---" >> "$log"

  case "$svc" in
    web)
      (cd "$ROOT_DIR/packages/web" && \
        nohup pnpm preview --host 0.0.0.0 --port 3000 --strictPort >> "$log" 2>&1 &
        echo $! > "$(pid_file web)")
      ;;
    api)
      (cd "$ROOT_DIR/packages/api" && \
        nohup node dist/server.js >> "$log" 2>&1 &
        echo $! > "$(pid_file api)")
      ;;
    orchestrator)
      (cd "$ROOT_DIR/packages/orchestrator" && \
        if [ -f .env ]; then set -a && source .env && set +a; fi && \
        nohup ./bin/orchestrator >> "$log" 2>&1 &
        echo $! > "$(pid_file orchestrator)")
      ;;
  esac

  local pid
  pid="$(read_pid "$svc")"
  ok "$svc 已启动 (PID: $pid)"
}

# ─── 停止单个服务 ────────────────────────────────────────
stop_service() {
  local svc=$1
  local pf
  pf="$(pid_file "$svc")"

  if [ ! -f "$pf" ]; then
    warn "$svc 未在运行（无 PID 文件）"
    return 0
  fi

  local pid
  pid="$(cat "$pf")"

  if ! ps -p "$pid" > /dev/null 2>&1; then
    warn "$svc 进程已不存在 (PID: $pid)，清理 PID 文件"
    rm -f "$pf"
    return 0
  fi

  info "正在停止 $svc (PID: $pid)..."

  # 获取端口用于兜底清理
  local port
  port="$(get_port "$svc")"

  # 先尝试优雅退出（主进程 + 子进程树）
  kill -TERM "$pid" 2>/dev/null || true
  pkill -TERM -P "$pid" 2>/dev/null || true

  # 等待 3 秒
  local waited=0
  while [ "$waited" -lt 3 ]; do
    if ! ps -p "$pid" > /dev/null 2>&1; then
      ok "$svc 已停止"
      rm -f "$pf"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  # 强制 kill（主进程 + 子进程树）
  warn "$svc 未响应 SIGTERM，强制终止..."
  kill -9 "$pid" 2>/dev/null || true
  pkill -9 -P "$pid" 2>/dev/null || true
  sleep 0.5

  # 端口兜底清理（如果端口还被占用）
  if check_port "$port"; then
    warn "端口 $port 仍被占用，按端口清理残留进程..."
    lsof -i :"$port" -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi

  if ! ps -p "$pid" > /dev/null 2>&1; then
    ok "$svc 已强制停止"
  else
    fail "$svc 无法停止 (PID: $pid)，请手动处理"
  fi
  rm -f "$pf"
}

# ─── 健康检查 ───────────────────────────────────────────
health_check() {
  echo ""
  info "等待服务启动..."
  sleep 3
  
  info "检查服务健康状态..."
  local all_ok=true

  for svc in "${SERVICES[@]}"; do
    local port
    port="$(get_port "$svc")"
    local timeout=20
    [ "$svc" = "orchestrator" ] && timeout=15

    if wait_for_port "$port" "$svc" "$timeout"; then
      ok "$svc 正在监听 :$port"
    else
      fail "$svc 未能在 ${timeout}s 内监听 :$port"
      echo "    最近日志:"
      tail -5 "$(log_file "$svc")" 2>/dev/null | sed 's/^/    /'
      all_ok=false
    fi
  done

  echo ""
  if $all_ok; then
    ok "所有服务已就绪"
    echo ""
    echo "  前端:        http://localhost:3000"
    echo "  API:         http://localhost:4000"
    echo "  Orchestrator: localhost:50051"
  else
    fail "部分服务启动失败，请检查日志: $LOG_DIR/"
  fi
}

# ─── 命令: start ────────────────────────────────────────
cmd_start() {
  info "启动 WorkGear 服务..."
  echo ""
  ensure_dirs
  check_prereqs

  for svc in "${SERVICES[@]}"; do
    start_service "$svc" || true
  done

  health_check
}

# ─── 命令: stop ─────────────────────────────────────────
cmd_stop() {
  info "停止 WorkGear 服务..."
  echo ""

  for svc in "${SERVICES[@]}"; do
    stop_service "$svc"
  done

  echo ""
  ok "所有服务已停止"
}

# ─── 命令: restart ──────────────────────────────────────
cmd_restart() {
  cmd_stop
  echo ""
  cmd_start
}

# ─── 命令: status ───────────────────────────────────────
cmd_status() {
  echo ""
  printf "  %-16s %-10s %-8s %-6s\n" "SERVICE" "STATUS" "PID" "PORT"
  printf "  %-16s %-10s %-8s %-6s\n" "───────────────" "─────────" "───────" "─────"

  for svc in "${SERVICES[@]}"; do
    local port pid status
    port="$(get_port "$svc")"
    pid="$(read_pid "$svc")"

    if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
      if check_port "$port"; then
        status="${GREEN}RUNNING${NC}"
      else
        status="${YELLOW}STARTING${NC}"
      fi
    else
      status="${RED}STOPPED${NC}"
      pid="-"
    fi

    printf "  %-16s %-20b %-8s %-6s\n" "$svc" "$status" "$pid" ":$port"
  done
  echo ""
}

# ─── 命令: logs ─────────────────────────────────────────
cmd_logs() {
  local svc="${1:-}"
  if [ -z "$svc" ]; then
    # tail 所有日志
    tail -f "$LOG_DIR"/*.log
  elif [ -f "$(log_file "$svc")" ]; then
    tail -f "$(log_file "$svc")"
  else
    fail "日志文件不存在: $(log_file "$svc")"
    exit 1
  fi
}

# ─── 入口 ───────────────────────────────────────────────
usage() {
  echo "用法: $0 {start|stop|restart|status|logs [service]}"
  echo ""
  echo "命令:"
  echo "  start     后台启动所有服务（构建 + 启动 + 健康检查）"
  echo "  stop      停止所有服务（优雅退出 + 强制终止）"
  echo "  restart   重启所有服务"
  echo "  status    查看服务运行状态"
  echo "  logs      查看日志（可选指定服务: web/api/orchestrator）"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  *)       usage; exit 1 ;;
esac

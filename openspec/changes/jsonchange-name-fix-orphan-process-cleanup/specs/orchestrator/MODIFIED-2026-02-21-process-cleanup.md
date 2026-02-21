# Delta Spec: 服务停止时的子进程树清理

> **Type:** MODIFIED
> **Module:** orchestrator
> **Date:** 2026-02-21
> **Change:** jsonchange-name-fix-orphan-process-cleanup

## 概述

修复 `workgear.sh` 脚本中 `stop_service()` 函数的进程清理逻辑，确保服务停止时主进程及其所有子进程都被彻底清理，防止孤儿进程占用端口和资源。

---

## 场景

### Scenario 1: 优雅停止时清理主进程和子进程树

```gherkin
Given Web 服务正在运行（主进程 PID 1234，子进程 1235、1236）
  And PID 文件 pids/web.pid 存在且内容为 1234
When 用户执行 workgear.sh stop
Then stop_service("web") 读取 PID 1234
  And 发送 SIGTERM 到主进程 1234
  And 同时执行 pkill -TERM -P 1234 清理所有子进程
  And 等待最多 3 秒检查主进程是否退出
When 主进程在 3 秒内退出
Then 输出 "web 已停止"
  And 删除 PID 文件 pids/web.pid
  And 所有子进程（1235、1236）也已退出
  And 端口 3000 被释放
```

### Scenario 2: 进程未响应 SIGTERM 时强制清理

```gherkin
Given API 服务正在运行（主进程 PID 5678，子进程 5679）
  And 主进程因某种原因无法响应 SIGTERM
When 用户执行 workgear.sh stop
Then stop_service("api") 发送 SIGTERM 到主进程和子进程
  And 等待 3 秒后主进程仍在运行
  And 输出警告 "api 未响应 SIGTERM，强制终止..."
  And 发送 SIGKILL 到主进程 5678
  And 同时执行 pkill -9 -P 5678 强制清理所有子进程
  And sleep 0.5 秒等待进程退出
Then 主进程和所有子进程都被强制终止
  And 输出 "api 已强制停止"
  And 删除 PID 文件 pids/api.pid
  And 端口 4000 被释放
```

### Scenario 3: 端口被占用时的兜底清理

```gherkin
Given Orchestrator 服务的主进程已退出
  But 某个子进程（PID 9999）仍在监听端口 50051
  And pkill -9 -P 未能清理该子进程（如子进程已成为孤儿进程）
When stop_service("orchestrator") 执行完 SIGKILL 和 pkill -9
  And 检查端口 50051 仍被占用（nc -z localhost 50051 返回成功）
Then 输出警告 "端口 50051 仍被占用，按端口清理残留进程..."
  And 执行 lsof -i :50051 -t 获取占用端口的进程 PID
  And 执行 kill -9 9999 强制终止该进程
  And 端口 50051 被释放
  And 输出 "orchestrator 已强制停止"
```

### Scenario 4: 主进程已不存在但 PID 文件残留

```gherkin
Given PID 文件 pids/web.pid 存在且内容为 1234
  But 进程 1234 已不存在（如被手动 kill 或系统重启）
When 用户执行 workgear.sh stop
Then stop_service("web") 读取 PID 1234
  And 检查进程 1234 不存在（ps -p 1234 失败）
  And 输出警告 "web 进程已不存在 (PID: 1234)，清理 PID 文件"
  And 删除 PID 文件 pids/web.pid
  And 不执行任何 kill 或 pkill 操作
```

### Scenario 5: 停止所有服务时按顺序清理

```gherkin
Given Web、API、Orchestrator 三个服务都在运行
When 用户执行 workgear.sh stop
Then 按顺序调用 stop_service("web")、stop_service("api")、stop_service("orchestrator")
  And 每个服务都执行完整的清理流程（SIGTERM + pkill -TERM → SIGKILL + pkill -9 → 端口兜底）
  And 所有主进程和子进程都被清理
  And 所有端口（3000、4000、50051）都被释放
  And 所有 PID 文件都被删除
  And 输出 "所有服务已停止"
```

### Scenario 6: macOS 环境下的兼容性

```gherkin
Given 脚本在 macOS 环境下运行
  And macOS 不支持 setsid 命令
When 用户执行 workgear.sh stop
Then stop_service() 使用 pkill -P 清理子进程（macOS 支持）
  And 不使用 setsid 或其他 Linux 特有命令
  And 进程清理逻辑正常工作
  And 端口正确释放
```

---

## 技术细节

### stop_service() 函数修改点

```bash
# 优雅退出（主进程 + 子进程树）
kill -TERM "$pid" 2>/dev/null || true
pkill -TERM -P "$pid" 2>/dev/null || true  # 新增

# 等待 3 秒
# ...

# 强制终止（主进程 + 子进程树）
kill -9 "$pid" 2>/dev/null || true
pkill -9 -P "$pid" 2>/dev/null || true     # 新增
sleep 0.5

# 端口兜底清理（保持不变）
if check_port "$port"; then
  lsof -i :"$port" -t 2>/dev/null | xargs kill -9 2>/dev/null || true
fi
```

### 命令兼容性

| 命令 | Linux | macOS | 说明 |
|------|-------|-------|------|
| `pkill -P $pid` | ✅ | ✅ | 清理父进程为 $pid 的所有子进程 |
| `kill -TERM $pid` | ✅ | ✅ | 发送 SIGTERM 信号 |
| `kill -9 $pid` | ✅ | ✅ | 发送 SIGKILL 信号 |
| `lsof -i :port` | ✅ | ✅ | 查找占用端口的进程 |
| `nc -z` | ✅ | ✅ | 检查端口是否被监听 |

# Proposal: 修复服务停止时的孤儿进程清理问题

## 背景（Why）

在 WorkGear 服务管理脚本 `workgear.sh` 的实际使用中，发现服务停止时存在进程清理不彻底的问题，导致端口被占用、资源泄漏等异常情况。

### 用户痛点

1. **服务停止后端口仍被占用**：执行 `workgear.sh stop` 后，主进程虽然被终止，但其子进程（如 Vite 的 esbuild worker、Node.js 的 worker threads）仍在运行，导致端口（3000/4000/50051）无法释放。用户再次启动服务时会遇到 "端口已被占用" 错误。

2. **孤儿进程持续消耗资源**：子进程未被清理时会成为孤儿进程，继续占用 CPU、内存和文件句柄，影响系统性能。在开发环境中频繁重启服务时，这些孤儿进程会累积。

3. **macOS 兼容性问题**：早期版本使用了 `setsid` 命令（在 Linux 上用于创建新会话），但该命令在 macOS 上不可用，导致脚本在 macOS 环境下无法正常工作。

### 根因分析

1. **缺少子进程树清理**：`stop_service()` 函数仅 kill 主进程 PID，未使用 `pkill -P` 递归清理子进程树
2. **SIGTERM 超时后未强制清理子进程**：等待 3 秒后仅对主进程发送 SIGKILL，子进程未被处理
3. **端口兜底清理不可靠**：依赖 `lsof -i :port` 查找进程，但在某些情况下（如进程已僵死但未释放端口）无法准确定位

## 目标（What）

修复 `workgear.sh` 脚本中的进程清理逻辑，确保服务停止时主进程及其所有子进程都被彻底清理，端口正确释放。

### 具体方案

1. **增强 stop_service() 的子进程清理**：
   - 在发送 SIGTERM 时同时使用 `pkill -TERM -P $pid` 清理子进程树
   - 在强制 SIGKILL 时同时使用 `pkill -9 -P $pid` 清理残留子进程
   - 保留端口兜底清理作为最后防线

2. **优化清理流程**：
   ```
   1. kill -TERM $pid + pkill -TERM -P $pid  (优雅退出)
   2. 等待 3 秒，检查主进程是否退出
   3. kill -9 $pid + pkill -9 -P $pid        (强制终止)
   4. 检查端口是否释放，如未释放则按端口清理
   ```

3. **移除 macOS 不兼容的命令**：
   - 已在之前的提交中移除 `setsid`（commit bbb66b5）
   - 确认当前版本使用 `nohup` + 后台运行，兼容 macOS 和 Linux

### 用户体验改进

| 场景 | 改进前 | 改进后 |
|------|--------|--------|
| 停止 Web 服务 | Vite 主进程退出，esbuild worker 残留 | 主进程和所有 worker 都被清理 |
| 停止 API 服务 | Node.js 主进程退出，worker threads 残留 | 主进程和所有 worker threads 都被清理 |
| 重启服务 | 端口被占用，启动失败 | 端口正确释放，启动成功 |
| macOS 环境 | 脚本报错（setsid 不存在） | 脚本正常运行 |

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| orchestrator | Spec 更新 + 代码变更 | workgear.sh 脚本的 stop_service() 函数 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `scripts/workgear.sh` | MODIFY | stop_service() 增加 pkill -P 子进程清理逻辑 |

### 不涉及

- 前端代码无变更
- 后端 API 代码无变更
- 数据库 schema 无变更
- Docker Compose 配置无变更
- 服务启动逻辑无变更（start_service() 保持不变）

## 非目标

- 不重构整个 workgear.sh 脚本架构
- 不引入第三方进程管理工具（如 PM2、systemd）
- 不修改服务的启动方式（仍使用 nohup + 后台运行）
- 不处理 Docker 容器内的进程管理（PostgreSQL 和 Redis 由 Docker Compose 管理）

## 风险评估

- **风险等级：低** — 仅修改脚本的进程清理逻辑，不影响服务运行时行为
- `pkill -P` 是 POSIX 标准命令，在 Linux 和 macOS 上都可用
- 保留端口兜底清理作为最后防线，确保极端情况下也能清理干净
- 已在 Git 历史中验证 macOS 兼容性修复（commit bbb66b5）

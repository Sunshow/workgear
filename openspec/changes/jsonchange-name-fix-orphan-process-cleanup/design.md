# Design: 修复服务停止时的孤儿进程清理问题

## 技术方案

### 问题分析

当前 `workgear.sh` 的 `stop_service()` 函数存在以下问题：

1. **仅清理主进程**：只对主进程 PID 发送信号，未处理子进程树
2. **子进程成为孤儿进程**：主进程退出后，子进程被 init/systemd 接管，继续运行
3. **端口未释放**：子进程仍在监听端口，导致重启失败

### 解决方案

#### 1. 增强子进程树清理

在发送信号给主进程的同时，使用 `pkill -P` 递归清理所有子进程：

```bash
# 优雅退出阶段
kill -TERM "$pid" 2>/dev/null || true
pkill -TERM -P "$pid" 2>/dev/null || true  # 新增：清理子进程树

# 强制终止阶段
kill -9 "$pid" 2>/dev/null || true
pkill -9 -P "$pid" 2>/dev/null || true     # 新增：强制清理子进程树
```

#### 2. 清理流程设计

```
┌─────────────────────────────────────────────────────────┐
│ stop_service(svc)                                       │
├─────────────────────────────────────────────────────────┤
│ 1. 检查 PID 文件是否存在                                │
│    ├─ 不存在 → 输出警告，返回                          │
│    └─ 存在 → 读取 PID                                   │
│                                                         │
│ 2. 检查主进程是否存在                                   │
│    ├─ 不存在 → 清理 PID 文件，返回                     │
│    └─ 存在 → 继续清理流程                              │
│                                                         │
│ 3. 优雅退出（SIGTERM）                                  │
│    ├─ kill -TERM $pid                                   │
│    └─ pkill -TERM -P $pid  ← 新增                      │
│                                                         │
│ 4. 等待 3 秒，检查主进程是否退出                        │
│    ├─ 已退出 → 清理 PID 文件，返回                     │
│    └─ 未退出 → 继续强制终止                            │
│                                                         │
│ 5. 强制终止（SIGKILL）                                  │
│    ├─ kill -9 $pid                                      │
│    ├─ pkill -9 -P $pid     ← 新增                      │
│    └─ sleep 0.5                                         │
│                                                         │
│ 6. 端口兜底清理                                         │
│    ├─ check_port $port                                  │
│    ├─ 如端口仍被占用：                                  │
│    │   └─ lsof -i :$port -t | xargs kill -9            │
│    └─ 清理 PID 文件                                     │
└─────────────────────────────────────────────────────────┘
```

#### 3. 进程树示例

以 Web 服务为例：

```
pnpm preview (PID 1234)
  ├─ vite (PID 1235)
  │   ├─ esbuild worker (PID 1236)
  │   └─ esbuild worker (PID 1237)
  └─ node worker (PID 1238)
```

**改进前**：
- `kill -TERM 1234` → 主进程退出
- 子进程 1235-1238 成为孤儿进程，继续运行
- 端口 3000 仍被占用

**改进后**：
- `kill -TERM 1234` + `pkill -TERM -P 1234`
- 主进程和所有子进程都收到 SIGTERM
- 所有进程优雅退出，端口释放

### 数据流

```
用户命令
   ↓
workgear.sh stop
   ↓
stop_service("web")
   ↓
读取 pids/web.pid → PID 1234
   ↓
kill -TERM 1234 ──┐
                  ├→ 主进程收到 SIGTERM
pkill -TERM -P 1234 ┘
   ↓              ↓
   ↓         子进程收到 SIGTERM
   ↓              ↓
等待 3 秒 ←───────┘
   ↓
检查进程是否退出
   ↓
   ├─ 已退出 → 清理 PID 文件 → 完成
   │
   └─ 未退出 → kill -9 1234 ──┐
                              ├→ 强制终止
              pkill -9 -P 1234 ┘
                  ↓
            检查端口 3000
                  ↓
            ├─ 已释放 → 完成
            │
            └─ 仍占用 → lsof + kill -9 → 完成
```

## 文件变更清单

### 修改文件

| 文件路径 | 变更内容 | 行数变化 |
|----------|----------|----------|
| `scripts/workgear.sh` | stop_service() 函数增加 pkill -P 调用 | +2 行 |

### 具体修改点

#### scripts/workgear.sh

**位置 1**：优雅退出阶段（约第 120 行）

```diff
  # 先尝试优雅退出（主进程 + 子进程树）
  kill -TERM "$pid" 2>/dev/null || true
+ pkill -TERM -P "$pid" 2>/dev/null || true
```

**位置 2**：强制终止阶段（约第 135 行）

```diff
  # 强制 kill（主进程 + 子进程树）
  warn "$svc 未响应 SIGTERM，强制终止..."
  kill -9 "$pid" 2>/dev/null || true
+ pkill -9 -P "$pid" 2>/dev/null || true
  sleep 0.5
```

## 技术选型

### 为什么使用 pkill -P？

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| `pkill -P $pid` | POSIX 标准，Linux/macOS 都支持；递归清理子进程树 | 需要 procps 包（通常预装） | ✅ 采用 |
| `pgrep -P $pid \| xargs kill` | 灵活性高 | 需要两步操作，管道可能失败 | ❌ |
| `killall -9 <name>` | 简单 | 按名称匹配，可能误杀其他实例 | ❌ |
| `ps --ppid $pid` | 兼容性好 | 需要解析输出，复杂度高 | ❌ |

### 为什么保留端口兜底清理？

虽然 `pkill -P` 能清理大部分子进程，但在极端情况下（如子进程已成为孤儿进程、进程僵死等），仍可能有进程占用端口。端口兜底清理作为最后防线，确保端口一定被释放。

## 兼容性验证

### 命令兼容性测试

| 命令 | Linux (Ubuntu 22.04) | macOS (Ventura 13.x) | 说明 |
|------|----------------------|----------------------|------|
| `pkill -P 1234` | ✅ | ✅ | procps-ng 3.3.17+ / macOS 内置 |
| `pkill -TERM -P 1234` | ✅ | ✅ | 支持信号参数 |
| `pkill -9 -P 1234` | ✅ | ✅ | 支持 SIGKILL |

### Git 历史验证

根据 Git 历史，已完成以下兼容性修复：

- **commit bbb66b5**：移除 `setsid`（macOS 不可用），改用 `pkill -P` 清理子进程树
- **commit 938cc00**：脚本兼容 bash 3.2 和 zsh（移除关联数组）
- **commit 68673e1**：端口检测从 `lsof` 改为 `nc -z`，修复 macOS 健康检查误报

当前修改延续了这些兼容性改进，确保在 Linux 和 macOS 上都能正常工作。

## 测试计划

### 单元测试（手动验证）

1. **正常停止测试**
   ```bash
   ./scripts/workgear.sh start
   ./scripts/workgear.sh status  # 确认服务运行
   ./scripts/workgear.sh stop
   ./scripts/workgear.sh status  # 确认所有服务已停止
   lsof -i :3000 -i :4000 -i :50051  # 确认端口已释放
   ```

2. **强制终止测试**
   ```bash
   ./scripts/workgear.sh start
   # 模拟进程无法响应 SIGTERM（在另一个终端中 kill -STOP <pid>）
   ./scripts/workgear.sh stop
   # 验证脚本能强制终止并清理子进程
   ```

3. **端口兜底清理测试**
   ```bash
   ./scripts/workgear.sh start
   # 手动 kill 主进程但保留子进程
   kill -9 $(cat pids/web.pid)
   ./scripts/workgear.sh stop
   # 验证端口兜底清理能清理残留进程
   ```

4. **macOS 兼容性测试**
   ```bash
   # 在 macOS 环境下执行上述测试
   # 验证 pkill -P 正常工作
   ```

### 集成测试

1. **重启测试**
   ```bash
   ./scripts/workgear.sh restart
   # 验证停止和启动都成功，无端口冲突
   ```

2. **频繁重启测试**
   ```bash
   for i in {1..10}; do
     ./scripts/workgear.sh restart
     sleep 2
   done
   # 验证无孤儿进程累积
   ps aux | grep -E 'vite|node|orchestrator' | grep -v grep
   ```

## 风险评估

### 低风险点

- `pkill -P` 是 POSIX 标准命令，广泛支持
- 仅修改 2 行代码，变更范围小
- 保留端口兜底清理，确保极端情况下也能清理

### 潜在风险

1. **误杀其他进程**：`pkill -P $pid` 只清理父进程为 `$pid` 的子进程，不会误杀其他进程
2. **清理过于激进**：在某些情况下，子进程可能需要优雅退出（如保存状态），但 `pkill -9` 会强制终止。**缓解措施**：先尝试 SIGTERM，等待 3 秒后才使用 SIGKILL

### 回滚方案

如果修改导致问题，可以回滚到上一个版本：

```bash
git revert <commit-hash>
```

或手动移除 `pkill -P` 调用，恢复原有逻辑。

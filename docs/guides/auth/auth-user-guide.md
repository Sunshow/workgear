# 用户认证使用指南

> 本文档面向 WorkGear 用户，介绍如何注册账号、登录系统、管理项目权限和浏览公开项目。

---

## 目录

- [注册账号](#注册账号)
- [登录与退出](#登录与退出)
- [项目可见性](#项目可见性)
- [公开项目浏览](#公开项目浏览)
- [项目成员与角色](#项目成员与角色)
- [自举项目](#自举项目)
- [常见问题](#常见问题)

---

## 注册账号

### 步骤

1. 访问 WorkGear 首页，未登录时会自动跳转到登录页
2. 点击页面底部的 **"注册"** 链接
3. 填写以下信息：

| 字段 | 要求 |
|------|------|
| 用户名 | 必填，你的显示名称 |
| 邮箱 | 必填，用于登录，不可重复 |
| 密码 | 必填，至少 8 位 |
| 确认密码 | 必填，需与密码一致 |

4. 点击 **"注册"**，注册成功后自动登录并跳转到项目列表页

### 注意事项

- 邮箱不区分大小写，`User@Example.com` 和 `user@example.com` 视为同一账号
- 密码建议使用字母 + 数字 + 特殊字符的组合
- 注册后无需邮箱验证，即可使用所有功能

---

## 登录与退出

### 登录

1. 访问 `/login` 页面
2. 输入注册时使用的邮箱和密码
3. 点击 **"登录"**

登录成功后：
- 浏览器会保存一个 HttpOnly Cookie（Refresh Token），有效期 7 天
- 关闭浏览器后重新打开，会自动恢复登录状态（7 天内无需重新登录）

### 退出

1. 点击左侧边栏底部的用户头像
2. 在下拉菜单中点击 **"退出登录"**

退出后会清除登录状态，需要重新输入邮箱和密码。

---

## 项目可见性

每个项目都有一个可见性设置：**私有（Private）** 或 **公开（Public）**。

### 私有项目

- 默认设置
- 仅项目成员可以查看和操作
- 不会出现在"探索"页面中

### 公开项目

- 所有已登录用户都可以在"探索"页面中看到
- 任何人都可以只读查看项目的看板、任务、流程执行状态
- 只有项目成员才能进行写操作（创建任务、启动流程、编辑等）

### 设置项目可见性

#### 创建项目时

在"新建项目"对话框中，选择"可见性"下拉框：
- **私有 — 仅成员可见**
- **公开 — 所有人可查看**

#### 修改已有项目

项目 Owner 可以在项目设置中切换可见性（通过 API 更新 `visibility` 字段）。

---

## 公开项目浏览

### 探索页面

1. 登录后，点击左侧边栏的 **"探索"** 入口
2. 页面会展示所有公开项目的卡片列表
3. 点击任意项目卡片，进入该项目的看板页面

### 公开项目中的操作权限

| 操作 | 项目成员 | 非成员（已登录） |
|------|---------|----------------|
| 查看看板和任务 | ✅ | ✅ |
| 查看流程执行状态 | ✅ | ✅ |
| 查看产物和 Spec 文档 | ✅ | ✅ |
| 创建/编辑/删除任务 | ✅ | ❌ |
| 启动流程 | ✅ | ❌ |
| Review / Approve / Reject | ✅ | ❌ |
| 修改项目设置 | Owner | ❌ |
| 删除项目 | Owner | ❌ |

---

## 项目成员与角色

### 角色说明

| 角色 | 权限 |
|------|------|
| Owner | 完全控制：修改项目设置、删除项目、管理成员 |
| Admin | 管理权限：管理任务、流程、成员（不能删除项目） |
| Member | 操作权限：创建任务、启动流程、Review |

### 成员管理

- 创建项目时，创建者自动成为 Owner
- Owner 可以通过 API 添加/移除项目成员（前端成员管理 UI 将在后续版本中提供）

#### 通过 API 添加成员

```bash
# 目前通过数据库直接操作（后续会提供 API）
# project_members 表：projectId + userId + role
```

---

## 自举项目

WorkGear 支持"自举"——用自身来管理自身的迭代开发。

### 什么是自举项目

在首次部署时，运行 `pnpm db:seed:bootstrap` 会自动创建：

1. **管理员账号** — 默认 `admin@workgear.dev`（可通过环境变量配置）
2. **WorkGear 公开项目** — 一个名为 "WorkGear" 的公开项目，关联 WorkGear 自身的 Git 仓库

### 使用方式

1. 用管理员账号登录
2. 在 "WorkGear" 项目中创建 Task，描述你想要改进的功能
3. 使用 OpenSpec 流程模板，让 Agent 按 SDD 方法论生成 Spec 和代码
4. Review Agent 的产出，Approve 后合并到 WorkGear 仓库
5. 重新部署更新后的 WorkGear

这样 WorkGear 就实现了"用自己改进自己"的闭环。

### 配置管理员账号

在 `packages/api/.env` 中设置：

```env
ADMIN_EMAIL=admin@workgear.dev
ADMIN_PASSWORD=your-strong-password
ADMIN_NAME=Admin
```

然后运行：

```bash
cd packages/api
pnpm db:seed:bootstrap
```

---

## 常见问题

### Q: 忘记密码怎么办？

当前版本暂不支持密码重置功能。请联系管理员直接在数据库中重置密码，或重新注册一个新账号。

### Q: 可以同时在多个设备登录吗？

可以。每个设备会获得独立的 Refresh Token，互不影响。在一个设备上退出不会影响其他设备的登录状态。

### Q: 登录状态会持续多久？

- 关闭浏览器后重新打开，7 天内会自动恢复登录
- 超过 7 天未使用，需要重新登录
- 主动点击"退出登录"会立即清除登录状态

### Q: 如何将私有项目改为公开？

项目 Owner 可以通过 API 更新项目的 `visibility` 字段：

```bash
curl -X PUT http://localhost:4000/api/projects/<project-id> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-access-token>" \
  -d '{"visibility": "public"}'
```

后续版本会在前端项目设置中提供可视化的切换开关。

### Q: 公开项目的敏感信息会泄露吗？

- Git Access Token 在 API 返回时会自动脱敏（只显示前 4 位 + ****）
- 公开项目的非成员只能进行 GET（只读）操作
- 数据库连接信息、API Key 等不会通过 API 暴露

### Q: 如何部署为独立网站？

参考 `docker/docker-compose.prod.yml` 和 `docker/.env.prod.example`：

```bash
cd docker
cp .env.prod.example .env
# 编辑 .env，设置 JWT_SECRET 和数据库密码
docker compose -f docker-compose.prod.yml up -d
```

首次部署后，进入 API 容器运行 bootstrap seed：

```bash
docker compose -f docker-compose.prod.yml exec api \
  node -e "import('./src/seeds/seed-bootstrap.ts')"
```

---

**最后更新**: 2026-02-14
**适用版本**: Phase 5 (用户认证)

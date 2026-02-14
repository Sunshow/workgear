# 用户认证技术架构文档

> 本文档面向 WorkGear 开发者，介绍用户认证系统的技术实现、代码结构和扩展方式。

---

## 目录

- [架构概览](#架构概览)
- [代码变更清单](#代码变更清单)
- [数据库 Schema](#数据库-schema)
- [API 层](#api-层)
- [认证中间件](#认证中间件)
- [前端层](#前端层)
- [Token 生命周期](#token-生命周期)
- [安全考虑](#安全考虑)
- [扩展指南](#扩展指南)

---

## 架构概览

WorkGear 采用 **JWT + HttpOnly Cookie 双 Token** 方案：

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 (React)                                                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ auth-store (Zustand)                                │    │
│  │  - user: User | null                                │    │
│  │  - accessToken: string | null (内存，不持久化)       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ api.ts (ky)                                         │    │
│  │  - beforeRequest: 附加 Authorization: Bearer <token>│    │
│  │  - afterResponse: 401 → 自动 refresh                │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP + Cookie
┌──────────────────────▼──────────────────────────────────────┐
│ API Server (Fastify)                                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ @fastify/jwt                                        │    │
│  │  - 签发 Access Token (15min, JWT)                   │    │
│  │  - 验证 Authorization header                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ @fastify/cookie                                     │    │
│  │  - 签发 Refresh Token (7d, HttpOnly Cookie)         │    │
│  │  - 读取 Cookie 中的 refreshToken                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 认证中间件                                           │    │
│  │  - authenticate: 强制登录                           │    │
│  │  - optionalAuth: 可选登录                           │    │
│  │  - requireProjectAccess: 项目权限检查               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ SQL
┌──────────────────────▼──────────────────────────────────────┐
│ PostgreSQL                                                  │
│                                                             │
│  - users (id, email, passwordHash, name, avatarUrl)         │
│  - refresh_tokens (id, userId, tokenHash, expiresAt)        │
│  - project_members (projectId, userId, role)                │
│  - projects (id, name, visibility, ownerId, ...)            │
└─────────────────────────────────────────────────────────────┘
```

### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Access Token 存储 | 前端内存（Zustand store） | 防止 XSS 攻击窃取 token |
| Refresh Token 存储 | HttpOnly Cookie | 防止 JS 读取，自动随请求发送 |
| Access Token 有效期 | 15 分钟 | 短期有效，减少泄露风险 |
| Refresh Token 有效期 | 7 天 | 用户体验平衡（无需频繁登录） |
| Refresh Token 轮换 | 每次 refresh 删除旧 token | 防止 token 重放攻击 |
| 密码哈希 | bcrypt (12 rounds) | 行业标准，抗暴力破解 |

---

## 代码变更清单

### 新增的文件

| 文件 | 说明 |
|------|------|
| `packages/api/src/routes/auth.ts` | 认证 API 路由（5 个端点） |
| `packages/api/src/middleware/auth.ts` | 认证中间件（3 个函数） |
| `packages/api/src/seeds/seed-bootstrap.ts` | 自举种子数据（管理员 + WorkGear 项目） |
| `packages/web/src/stores/auth-store.ts` | 前端认证状态管理 |
| `packages/web/src/components/auth-guard.tsx` | 路由守卫组件 |
| `packages/web/src/components/layout/user-menu.tsx` | 用户菜单组件 |
| `packages/web/src/pages/auth/login.tsx` | 登录页 |
| `packages/web/src/pages/auth/register.tsx` | 注册页 |
| `packages/web/src/pages/explore/index.tsx` | 公开项目浏览页 |
| `packages/api/Dockerfile` | API Server 生产镜像 |
| `packages/web/Dockerfile` | Web 前端生产镜像 |
| `packages/web/nginx.conf` | Nginx 配置（SPA fallback + API 代理） |
| `docker/docker-compose.prod.yml` | 生产环境编排 |
| `docker/.env.prod.example` | 生产环境变量模板 |

### 修改的文件

| 文件 | 变更内容 |
|------|---------|
| `packages/api/src/db/schema.ts` | 新增 `users` / `refreshTokens` / `projectMembers` 表；`projects` 表新增 `visibility` / `ownerId` 字段 |
| `packages/api/src/server.ts` | 注册 `@fastify/jwt` / `@fastify/cookie` 插件；注册 `authRoutes` |
| `packages/api/src/routes/projects.ts` | 所有路由加认证；新增 `GET /public` 端点；创建项目时设置 `ownerId` 和 `projectMembers` |
| `packages/api/src/routes/boards.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/src/routes/tasks.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/src/routes/workflows.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/src/routes/flow-runs.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/src/routes/artifacts.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/src/routes/node-runs.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/src/routes/openspec.ts` | 所有路由加 `authenticate` 中间件 |
| `packages/api/package.json` | 新增依赖；新增 `db:seed:bootstrap` 脚本 |
| `packages/web/src/lib/api.ts` | 改造 ky 实例：自动附加 Bearer token + 401 自动 refresh |
| `packages/web/src/lib/types.ts` | `Project` 类型新增 `visibility` / `ownerId` 字段 |
| `packages/web/src/App.tsx` | 新增路由；主路由包裹 `AuthGuard` |
| `packages/web/src/components/layout/sidebar.tsx` | 新增"探索"入口；底部新增用户菜单 |
| `packages/web/src/pages/projects/create-dialog.tsx` | 新增 visibility 下拉选择 |
| `packages/web/src/pages/projects/index.tsx` | 项目卡片显示 visibility 标识 |

---

## 数据库 Schema

### users 表

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
```

- `email` 唯一索引，不区分大小写（存储时统一转小写）
- `password_hash` 使用 bcrypt 哈希（12 rounds）

### refresh_tokens 表

```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
```

- `token_hash` 存储 SHA256 哈希，不存储明文 token
- 支持多设备登录（一个用户可以有多个有效 refresh token）
- Token 轮换：每次 refresh 时删除旧 token，插入新 token

### project_members 表

```sql
CREATE TABLE project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(project_id, user_id)
);
```

- `role` 枚举：`owner` / `admin` / `member`
- 创建项目时自动插入 owner 记录

### projects 表新增字段

```sql
ALTER TABLE projects ADD COLUMN visibility VARCHAR(20) DEFAULT 'private' NOT NULL;
ALTER TABLE projects ADD COLUMN owner_id UUID REFERENCES users(id);
```

- `visibility` 枚举：`private` / `public`
- `owner_id` 可为 null（兼容迁移前的旧项目）

---

## API 层

### 认证端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册新用户 | 无 |
| POST | `/api/auth/login` | 登录 | 无 |
| POST | `/api/auth/refresh` | 刷新 Access Token | 无（需 Cookie） |
| POST | `/api/auth/logout` | 退出登录 | 需登录 |
| GET  | `/api/auth/me` | 获取当前用户信息 | 需登录 |

### register 端点

请求体：

```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}
```

响应：

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "avatarUrl": null,
    "createdAt": "2026-02-14T10:00:00Z"
  }
}
```

同时设置 `refreshToken` Cookie（HttpOnly, Secure, SameSite=Lax, Path=/api/auth, MaxAge=7d）。

### login 端点

请求体：

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

响应：同 register。

### refresh 端点

请求：无 body，从 Cookie 中读取 `refreshToken`。

响应：

```json
{
  "accessToken": "new-jwt-token",
  "user": { "id": "...", "email": "...", "name": "...", "avatarUrl": null, "createdAt": "..." }
}
```

同时设置新的 `refreshToken` Cookie（Token 轮换）。

### logout 端点

请求：无 body。需要 `Authorization: Bearer <token>` header。

响应：

```json
{ "success": true }
```

清除 `refreshToken` Cookie，并从数据库中删除对应记录。

---

## 认证中间件

位置：`packages/api/src/middleware/auth.ts`

### authenticate

强制登录中间件。从 `Authorization: Bearer <token>` header 中解析 JWT，验证失败返回 401，成功后挂载 `request.userId` 和 `request.userEmail`。

### optionalAuth

可选登录中间件。Token 存在且有效则挂载 `request.userId`，Token 不存在或无效则静默忽略。用于 public 项目的只读访问。

### requireProjectAccess

项目权限检查中间件，支持角色限制。

逻辑：
1. 从 `request.params` 中取 `projectId` 或 `id`
2. 查询项目 visibility
3. Public 项目 + GET 请求 → 放行（只读）
4. 非 public 或非 GET → 必须登录
5. 查询 `project_members` 表检查成员关系
6. 可选 `requiredRole` 参数限制最低角色（owner > admin > member）

使用示例：

```typescript
// 任何成员都可以访问，public 项目允许匿名 GET
app.get('/:id', { preHandler: [optionalAuth, requireProjectAccess()] }, handler)

// 只有 owner 可以访问
app.delete('/:id', { preHandler: [authenticate, requireProjectAccess('owner')] }, handler)
```

---

## 前端层

### auth-store

位置：`packages/web/src/stores/auth-store.ts`

- `user` 和 `accessToken` 存储在内存中，刷新页面会丢失
- `initialized` 标记是否已尝试恢复会话（通过 refresh 端点）

### api.ts 改造

位置：`packages/web/src/lib/api.ts`

- `beforeRequest` hook：每个请求自动附加 Bearer token
- `afterResponse` hook：遇到 401 时自动调用 `/api/auth/refresh`，刷新成功后重试原请求，失败则清除登录状态
- 并发刷新保护：多个请求同时 401 时只触发一次 refresh

### AuthGuard 组件

位置：`packages/web/src/components/auth-guard.tsx`

- 首次渲染时尝试用 refresh token 恢复会话
- 恢复成功 → 显示子组件
- 恢复失败 → 跳转 `/login`

---

## Token 生命周期

### 注册/登录

```
用户 → 前端 → POST /auth/login → API → bcrypt.compare()
                                     → 签发 Access Token (JWT, 15min)
                                     → 生成 Refresh Token (UUID)
                                     → INSERT refresh_tokens (hash)
                                     → Set-Cookie: refreshToken (HttpOnly)
                                     → 返回 {accessToken, user}
```

### 自动刷新

```
前端 → GET /api/projects (expired token) → API → 401
前端 → POST /auth/refresh (Cookie) → API → 验证 token hash
                                         → DELETE old token
                                         → 签发新 Access Token
                                         → 签发新 Refresh Token
                                         → Set-Cookie: new refreshToken
                                         → 返回 {accessToken, user}
前端 → 重试 GET /api/projects (new token) → API → 200 OK
```

### 退出登录

```
前端 → POST /auth/logout → API → DELETE refresh_tokens
                                → Clear-Cookie: refreshToken
前端 → logout() (清除 store) → 跳转 /login
```

---

## 安全考虑

### XSS 防护

- Access Token 存储在内存（Zustand store），不存 localStorage
- Refresh Token 使用 HttpOnly Cookie，JS 无法读取
- React 自动转义，防止 XSS 注入

### CSRF 防护

- Refresh Token Cookie 设置 `SameSite=Lax`
- Access Token 通过 Authorization header 传递，不受 CSRF 影响

### Token 泄露防护

- Access Token 短期有效（15 分钟）
- Refresh Token 轮换，每次使用后立即失效
- 数据库存储 SHA256 哈希，不存明文

### 密码安全

- bcrypt 哈希（12 rounds）
- 注册时强制 8 位以上密码
- 登录失败统一返回 "Invalid email or password"（不泄露用户是否存在）

### 生产环境配置

```env
JWT_SECRET=<随机生成的强密钥>
POSTGRES_PASSWORD=<强密码>
ADMIN_PASSWORD=<强密码>
NODE_ENV=production  # 自动启用 Secure Cookie
```

---

## 扩展指南

### 添加 OAuth2 登录（GitHub / Google）

1. 安装 `@fastify/oauth2`
2. 在 `server.ts` 中注册 OAuth2 插件，配置 GitHub/Google credentials
3. 在 `auth.ts` 中添加回调处理：获取第三方用户信息 → 查找或创建 users 记录 → 签发 WorkGear tokens

### 添加新的项目角色

1. 在 `requireProjectAccess` 中的 `roleHierarchy` 添加新角色和权重
2. 前端 UI 中添加角色选择

### 添加邮箱验证

1. 在 `users` 表新增 `email_verified` 字段
2. 注册时生成验证 token，发送邮件
3. 新增 `GET /api/auth/verify-email?token=<token>` 端点

### 添加密码重置

1. 新增 `password_reset_tokens` 表
2. 新增 `POST /api/auth/forgot-password` 端点（发送重置邮件）
3. 新增 `POST /api/auth/reset-password` 端点（验证 token 并重置密码）

### 添加多因素认证（MFA）

1. 安装 `speakeasy` 和 `qrcode`
2. 在 `users` 表新增 `mfa_secret` 和 `mfa_enabled` 字段
3. 新增 MFA setup / verify 端点
4. 在 `login` 端点中检查 `mfa_enabled`，要求二次验证

---

**最后更新**: 2026-02-14
**适用版本**: Phase 5 (用户认证)

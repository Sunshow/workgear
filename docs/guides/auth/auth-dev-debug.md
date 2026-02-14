# 用户认证开发调试指南

> 本文档面向 WorkGear 开发者，介绍如何在本地开发和调试用户认证功能。

---

## 目录

- [环境准备](#环境准备)
- [初始化用户](#初始化用户)
- [API 调试](#api-调试)
- [前端调试](#前端调试)
- [Token 调试](#token-调试)
- [项目权限调试](#项目权限调试)
- [常见问题](#常见问题)

---

## 环境准备

### 1. 启动数据库

```bash
cd docker
docker-compose up -d
```

### 2. 推送 Schema

认证功能新增了 `users`、`refresh_tokens`、`project_members` 三张表，以及 `projects` 表的 `visibility` / `owner_id` 字段。

```bash
cd packages/api
pnpm db:push
```

验证表已创建：

```bash
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "\dt users; \dt refresh_tokens; \dt project_members;"
```

### 3. 安装依赖

认证功能依赖 `@fastify/jwt`、`@fastify/cookie`、`bcrypt`：

```bash
cd packages/api
pnpm install
```

如果遇到 bcrypt 编译问题，确保已批准构建脚本：

```bash
# 在项目根目录
pnpm approve-builds
# 或手动 rebuild
cd packages/api && pnpm rebuild bcrypt
```

### 4. 环境变量

在 `packages/api/.env` 中确认以下变量（开发环境可使用默认值）：

```env
# 数据库
DATABASE_URL=postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev

# Auth（开发环境默认值即可）
JWT_SECRET=dev-secret-change-in-production
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=7

# Admin（用于 seed:bootstrap）
ADMIN_EMAIL=admin@workgear.dev
ADMIN_PASSWORD=workgear2026
ADMIN_NAME=Admin
```

### 5. 启动服务

```bash
# 启动所有服务
pnpm dev

# 或单独启动 API
pnpm run dev:api
```

---

## 初始化用户

### 方式一：Bootstrap Seed（推荐）

一键创建管理员账号和 WorkGear 自举项目：

```bash
cd packages/api
pnpm db:seed:bootstrap
```

输出：

```
🚀 Starting bootstrap seed...
✅ Created admin user: admin@workgear.dev
✅ Created WorkGear bootstrap project (public, id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
🎉 Bootstrap seed complete!
```

默认管理员账号：
- 邮箱：`admin@workgear.dev`
- 密码：`workgear2026`

可通过环境变量 `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` 自定义。

### 方式二：通过 API 注册

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test1234",
    "name": "Test User"
  }' | jq
```

预期响应：

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "test@example.com",
    "name": "Test User",
    "avatarUrl": null,
    "createdAt": "2026-02-14T..."
  }
}
```

### 方式三：直接操作数据库

```bash
# 进入 Drizzle Studio
cd packages/api
pnpm db:studio
# 访问 http://localhost:4983，在 users 表中查看/编辑
```

注意：直接插入数据库时 `password_hash` 需要是 bcrypt 哈希值，不能填明文密码。可以用 Node.js 生成：

```bash
node -e "import('bcrypt').then(b => b.hash('your-password', 12).then(console.log))"
```

---

## API 调试

### 注册

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "dev@test.com", "password": "password123", "name": "Dev"}' \
  -c cookies.txt | jq
```

`-c cookies.txt` 会将 Set-Cookie 保存到文件，后续请求可用 `-b cookies.txt` 发送。

### 登录

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@workgear.dev", "password": "workgear2026"}' \
  -c cookies.txt | jq
```

记下返回的 `accessToken`，后续请求需要用到：

```bash
export TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

### 获取当前用户

```bash
curl http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

### 刷新 Token

```bash
curl -X POST http://localhost:4000/api/auth/refresh \
  -b cookies.txt \
  -c cookies.txt | jq
```

注意：每次 refresh 会轮换 Cookie 中的 refreshToken，所以用 `-c cookies.txt` 更新。

### 退出登录

```bash
curl -X POST http://localhost:4000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -b cookies.txt | jq
```

### 测试认证保护

```bash
# 无 Token 访问受保护路由 → 401
curl http://localhost:4000/api/projects -v
# 应返回 {"error":"Unauthorized"}

# 带 Token 访问 → 200
curl http://localhost:4000/api/projects \
  -H "Authorization: Bearer $TOKEN" | jq
```

### 常见错误码

| 状态码 | 错误 | 原因 |
|--------|------|------|
| 401 | `Unauthorized` | 未提供 Token 或 Token 过期 |
| 401 | `Invalid email or password` | 邮箱或密码错误 |
| 401 | `No refresh token` | Cookie 中没有 refreshToken |
| 401 | `Invalid or expired refresh token` | Refresh Token 无效或已过期 |
| 403 | `Forbidden: not a project member` | 用户不是该项目的成员 |
| 403 | `Forbidden: requires owner role` | 操作需要 owner 角色 |
| 409 | `Email already registered` | 邮箱已被注册 |
| 422 | `Password must be at least 8 characters` | 密码太短 |

---

## 前端调试

### 查看 auth-store 状态

在浏览器 DevTools Console 中：

```javascript
// 查看当前用户
JSON.parse(JSON.stringify(
  document.querySelector('#root')?.__reactFiber$ // React 内部
))

// 更简单的方式：在任意组件中临时添加
console.log(useAuthStore.getState())
```

或者安装 [Zustand DevTools](https://github.com/beerose/simple-zustand-devtools)。

### 调试 api.ts 拦截器

在 `packages/web/src/lib/api.ts` 中添加临时日志：

```typescript
beforeRequest: [
  (request) => {
    const token = useAuthStore.getState().accessToken
    console.log('[api] beforeRequest, hasToken:', !!token)
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`)
    }
  },
],
afterResponse: [
  async (request, _options, response) => {
    console.log('[api] afterResponse, status:', response.status, request.url)
    if (response.status === 401 && !request.url.includes('/api/auth/')) {
      console.log('[api] 401 detected, attempting refresh...')
      // ...
    }
    return response
  },
],
```

### 调试 AuthGuard 行为

AuthGuard 在首次渲染时会调用 `POST /api/auth/refresh` 尝试恢复会话。

在 Network 面板中观察：
1. 页面加载 → `POST /api/auth/refresh`
2. 如果有有效的 refreshToken Cookie → 返回 200，自动登录
3. 如果没有 Cookie 或已过期 → 返回 401，跳转 `/login`

### 清除登录状态

在浏览器 DevTools 中：

```javascript
// 清除 Cookie
document.cookie = 'refreshToken=; Path=/api/auth; Max-Age=0'

// 刷新页面，会跳转到登录页
location.reload()
```

或者在 Application → Cookies 中手动删除 `refreshToken`。

---

## Token 调试

### 解码 JWT（Access Token）

Access Token 是标准 JWT，可以在 [jwt.io](https://jwt.io) 上解码，或用命令行：

```bash
# 解码 payload（中间部分）
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

预期 payload：

```json
{
  "sub": "user-uuid",
  "email": "admin@workgear.dev",
  "iat": 1739520000,
  "exp": 1739520900
}
```

- `sub` — 用户 ID
- `iat` — 签发时间（Unix 时间戳）
- `exp` — 过期时间（iat + 15 分钟）

### 查看 Refresh Token Cookie

在浏览器 DevTools → Application → Cookies → `localhost` 中查看：

| 属性 | 值 |
|------|------|
| Name | `refreshToken` |
| Value | UUID 格式 |
| Path | `/api/auth` |
| HttpOnly | ✅ |
| Secure | ❌（开发环境）/ ✅（生产环境） |
| SameSite | Lax |

注意：HttpOnly Cookie 在 Console 中用 `document.cookie` 看不到，只能在 Application 面板中查看。

### 查询数据库中的 Refresh Token

```bash
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "SELECT id, user_id, LEFT(token_hash, 16) || '...' as token_hash, expires_at, created_at FROM refresh_tokens ORDER BY created_at DESC LIMIT 5;"
```

### 手动过期 Token（测试刷新流程）

将 `JWT_EXPIRES_IN` 设为极短时间来测试自动刷新：

```env
# packages/api/.env
JWT_EXPIRES_IN=10s  # 10 秒后过期
```

重启 API Server 后：
1. 登录获取 Token
2. 等待 10 秒
3. 访问任意受保护路由
4. 观察前端是否自动 refresh 并重试

测试完记得改回 `15m`。

---

## 项目权限调试

### 测试 Public 项目访问

```bash
# 1. 创建一个 public 项目
curl -X POST http://localhost:4000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Public Test", "visibility": "public"}' | jq

# 记下 project ID
export PROJECT_ID="..."

# 2. 注册另一个用户
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "other@test.com", "password": "password123", "name": "Other"}' | jq

# 记下新用户的 token
export OTHER_TOKEN="..."

# 3. 用新用户 GET public 项目 → 200（只读访问）
curl http://localhost:4000/api/projects/$PROJECT_ID \
  -H "Authorization: Bearer $OTHER_TOKEN" | jq

# 4. 用新用户 PUT public 项目 → 403（非成员不能写）
curl -X PUT http://localhost:4000/api/projects/$PROJECT_ID \
  -H "Authorization: Bearer $OTHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Hacked"}' -v
# 应返回 403 Forbidden
```

### 测试 Private 项目访问

```bash
# 1. 创建 private 项目（默认）
curl -X POST http://localhost:4000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Private Test"}' | jq

export PRIVATE_ID="..."

# 2. 用其他用户访问 → 403
curl http://localhost:4000/api/projects/$PRIVATE_ID \
  -H "Authorization: Bearer $OTHER_TOKEN" -v
# 应返回 403 Forbidden
```

### 测试公开项目列表

```bash
# 无需 Token 也能获取公开项目列表
curl http://localhost:4000/api/projects/public | jq
```

### 查看项目成员关系

```bash
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "SELECT pm.project_id, p.name as project_name, pm.user_id, u.email, pm.role
      FROM project_members pm
      JOIN projects p ON p.id = pm.project_id
      JOIN users u ON u.id = pm.user_id
      ORDER BY p.name;"
```

---

## 常见问题

### 1. 401 循环（页面不断刷新）

**现象**：登录后页面不断跳转到 `/login`，或 Network 面板中看到大量 `/api/auth/refresh` 请求。

**原因**：Refresh Token 无效或已过期，但前端不断尝试刷新。

**排查**：
```bash
# 检查 Cookie 是否存在
# 浏览器 DevTools → Application → Cookies

# 检查数据库中是否有有效的 refresh token
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "SELECT * FROM refresh_tokens WHERE expires_at > NOW();"
```

**解决**：清除浏览器 Cookie，重新登录。

### 2. Cookie 不随请求发送

**现象**：`POST /api/auth/refresh` 返回 401 `No refresh token`，但 Cookie 确实存在。

**原因**：
- Cookie 的 `Path` 是 `/api/auth`，只有请求路径匹配时才会发送
- 前端请求未设置 `credentials: 'include'`

**排查**：
```javascript
// 确认 api.ts 中 ky 配置了 credentials
const api = ky.create({
  credentials: 'include',  // 必须
  // ...
})
```

### 3. bcrypt 编译失败

**现象**：`pnpm install` 或 `pnpm dev` 时报 bcrypt 相关错误。

**解决**：

```bash
# 方式一：批准构建脚本
cd /path/to/workgear
pnpm approve-builds

# 方式二：手动 rebuild
cd packages/api
pnpm rebuild bcrypt

# 方式三：检查 package.json 中的 onlyBuiltDependencies
# 确保包含 "bcrypt"
```

### 4. JWT_SECRET 未配置

**现象**：API 启动正常，但 Token 验证行为不一致（重启后旧 Token 失效）。

**原因**：未设置 `JWT_SECRET` 环境变量，使用了默认值 `dev-secret-change-in-production`。每次重启如果默认值不变则不影响，但生产环境必须配置固定的强密钥。

**解决**：

```env
# packages/api/.env
JWT_SECRET=your-random-secret-at-least-32-chars
```

### 5. CORS 错误

**现象**：前端请求 API 时浏览器报 CORS 错误。

**原因**：`@fastify/cors` 配置中未启用 `credentials`。

**排查**：确认 `server.ts` 中：

```typescript
await app.register(cors, { origin: true, credentials: true })
```

### 6. 注册时报 "Email already registered"

**现象**：注册新用户时返回 409。

**排查**：

```bash
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "SELECT id, email, name FROM users ORDER BY created_at;"
```

**解决**：使用不同的邮箱，或删除已有用户重新注册。

### 7. 重置开发环境

如果认证状态混乱，可以完全重置：

```bash
# 清空认证相关表
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "DELETE FROM refresh_tokens; DELETE FROM project_members; DELETE FROM users;"

# 重新初始化
cd packages/api
pnpm db:seed:bootstrap

# 清除浏览器 Cookie
# DevTools → Application → Cookies → 全部删除

# 重新登录
# admin@workgear.dev / workgear2026
```

---

**最后更新**: 2026-02-14
**适用版本**: Phase 5 (用户认证)

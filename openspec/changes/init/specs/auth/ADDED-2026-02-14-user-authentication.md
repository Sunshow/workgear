# User Authentication

> Source of Truth — 描述用户认证模块的行为规范

## Scenario: User Registration

### Given
- User provides email, password (min 8 chars), and name
- Email is not already registered in the system

### When
- POST /api/auth/register with `{ email, password, name }`

### Then
- Password is hashed with bcrypt (12 salt rounds)
- User record is created in `users` table
- JWT access token is signed with `{ sub: userId, email }` (expires in 15m)
- Refresh token (UUID) is generated and stored as SHA-256 hash in `refresh_tokens` table (expires in 7 days)
- Refresh token is set as httpOnly cookie at path `/api/auth`
- Response: 201 with `{ accessToken, user: { id, email, name, avatarUrl, createdAt } }`
- Password hash is excluded from response

---

## Scenario: User Registration with Duplicate Email

### Given
- Email already exists in `users` table (case-insensitive)

### When
- POST /api/auth/register with existing email

### Then
- Response: 409 Conflict with `{ error: 'Email already registered' }`
- No user is created

---

## Scenario: User Login

### Given
- User exists with valid email and password

### When
- POST /api/auth/login with `{ email, password }`

### Then
- Email is normalized (lowercase, trimmed)
- Password is verified with bcrypt.compare against stored hash
- JWT access token is signed (expires in 15m)
- New refresh token is generated and stored (expires in 7 days)
- Refresh token is set as httpOnly cookie
- Response: 200 with `{ accessToken, user }` (password hash excluded)

---

## Scenario: Login with Invalid Credentials

### Given
- Email does not exist OR password does not match

### When
- POST /api/auth/login with invalid credentials

### Then
- Response: 401 Unauthorized with `{ error: 'Invalid email or password' }`
- No tokens are issued

---

## Scenario: Token Refresh

### Given
- Valid refresh token exists in httpOnly cookie
- Token has not expired and exists in `refresh_tokens` table

### When
- POST /api/auth/refresh (credentials: include)

### Then
- Refresh token is validated by SHA-256 hash lookup
- Old refresh token is deleted (token rotation)
- New access token is signed (expires in 15m)
- New refresh token is generated and stored (expires in 7 days)
- New refresh token is set as httpOnly cookie
- Response: 200 with `{ accessToken, user }`

---

## Scenario: Token Refresh with Invalid Token

### Given
- Refresh token is missing, expired, or not found in database

### When
- POST /api/auth/refresh

### Then
- Refresh token cookie is cleared
- Response: 401 Unauthorized with `{ error: 'Invalid or expired refresh token' }` or `{ error: 'No refresh token' }`

---

## Scenario: User Logout

### Given
- User is authenticated with valid access token

### When
- POST /api/auth/logout with Authorization header

### Then
- Refresh token is deleted from `refresh_tokens` table by hash lookup
- Refresh token cookie is cleared
- Response: 200 with `{ success: true }`

---

## Scenario: Get Current User Info

### Given
- User is authenticated with valid JWT access token

### When
- GET /api/auth/me with Authorization: Bearer {accessToken}

### Then
- JWT is verified and userId is extracted from `sub` claim
- User data is fetched from `users` table
- Response: 200 with `{ id, email, name, avatarUrl, createdAt }`
- Password hash is excluded from response

---

## Scenario: Protected Route Access with AuthGuard

### Given
- User navigates to protected route in frontend
- No valid session exists

### When
- AuthGuard component mounts and attempts POST /api/auth/refresh

### Then
- If refresh succeeds: user and accessToken are stored in auth-store (Zustand)
- If refresh fails: user is redirected to /login
- Access token is stored in Zustand and used for subsequent API calls via Authorization header

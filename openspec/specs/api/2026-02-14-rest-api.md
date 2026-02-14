# REST API

> Source of Truth — 描述 REST API 层的行为规范

## Scenario: Fastify server initialization

### Given
- Server configuration from environment: PORT (default 4000), HOST (default 0.0.0.0), JWT_SECRET

### When
- Server starts up

### Then
- Fastify 5 server initializes with Pino logger (pino-pretty transport)
- Registers @fastify/cors plugin with origin: true, credentials: true
- Registers @fastify/cookie plugin
- Registers @fastify/jwt plugin with JWT_SECRET
- Registers @fastify/websocket plugin
- Listens on configured HOST:PORT
- Logs "WorkGear API Server running at http://{HOST}:{PORT}"

---

## Scenario: Plugin-based route registration with prefixes

### Given
- Route modules export Fastify plugin functions
- Each plugin handles specific resource domain

### When
- Server registers route plugins during startup

### Then
- Health routes registered at /api prefix
- Auth routes registered at /api/auth prefix
- Project routes registered at /api/projects prefix
- Kanban routes registered at /api/kanbans prefix
- Task routes registered at /api/tasks prefix
- Workflow template routes registered at /api/workflow-templates prefix
- Workflow routes registered at /api/workflows prefix
- Flow run routes registered at /api/flow-runs prefix
- Artifact routes registered at /api/artifacts prefix
- Node run routes registered at /api/node-runs prefix
- OpenSpec routes registered at /api/projects/:projectId/openspec prefix
- WebSocket gateway registered at /ws endpoint

---

## Scenario: Health check endpoint

### Given
- Server is running

### When
- Client sends GET /api/health

### Then
- Server responds with 200 OK
- Response body contains { status: "ok", timestamp: <ISO8601> }
- No authentication required

---

## Scenario: JWT authentication middleware on protected routes

### Given
- Client has valid JWT access token from /api/auth/login
- Protected route requires authentication

### When
- Client sends request to protected route with Authorization: Bearer <token>

### Then
- Middleware calls fastify.jwt.verify() to validate token
- If valid, extracts user payload and attaches to request.user
- Route handler executes with authenticated context
- If invalid or missing, responds with 401 Unauthorized

---

## Scenario: Resource CRUD operations with Drizzle ORM

### Given
- Database schema defined in src/db/schema.ts using Drizzle ORM
- Route handler needs to query or mutate data

### When
- Handler calls db.select(), db.insert(), db.update(), or db.delete()

### Then
- Drizzle generates type-safe SQL query
- Query executes against PostgreSQL database
- Results returned as typed objects
- Errors propagated to Fastify error handler

---

## Scenario: Request body validation with Zod

### Given
- Route expects JSON request body
- Validation schema defined with Zod

### When
- Client sends POST/PUT/PATCH request with JSON body
- Handler calls schema.parse(request.body)

### Then
- Zod validates body against schema
- If valid, returns typed data object
- If invalid, throws ZodError with detailed validation errors
- Fastify error handler converts to 400 Bad Request with error details

---

## Scenario: CORS configuration for frontend integration

### Given
- Frontend runs on different origin during development
- Vite dev server proxies /api/* requests to localhost:4000

### When
- Browser sends preflight OPTIONS request
- OR browser sends actual API request with Origin header

### Then
- Server responds with Access-Control-Allow-Origin: <origin>
- Server responds with Access-Control-Allow-Credentials: true
- Server responds with Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS
- Browser allows cross-origin request to proceed

---

## Scenario: OpenSpec project-scoped routes

### Given
- Project has ID "abc-123"
- User is authenticated and has access to project

### When
- Client sends GET /api/projects/abc-123/openspec/specs
- OR POST /api/projects/abc-123/openspec/changes

### Then
- Route handler extracts projectId from URL params
- Handler verifies user has project access
- Handler queries OpenSpec data scoped to project
- Returns project-specific OpenSpec resources
- If no access, responds with 403 Forbidden

---

## Scenario: WebSocket gateway for real-time events

### Given
- Orchestrator publishes events to event bus
- API server subscribes to event bus via gRPC EventStream

### When
- Client connects to WebSocket at /ws
- Orchestrator publishes node.started, node.completed, flow.completed events

### Then
- WebSocket gateway receives events from gRPC stream
- Gateway broadcasts events to connected WebSocket clients
- Clients receive real-time updates without polling
- Connection closes gracefully on client disconnect or server shutdown

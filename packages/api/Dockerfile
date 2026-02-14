FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/shared/ packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @workgear/api

# Copy source
COPY packages/api/ packages/api/

# Build
RUN pnpm --filter @workgear/api build

# Production stage
FROM node:22-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/api/package.json packages/api/
COPY --from=builder /app/packages/shared/ packages/shared/

RUN pnpm install --frozen-lockfile --filter @workgear/api --prod

COPY --from=builder /app/packages/api/dist packages/api/dist/
COPY --from=builder /app/packages/api/src/seeds packages/api/src/seeds/
COPY --from=builder /app/packages/api/drizzle.config.ts packages/api/

EXPOSE 4000
WORKDIR /app/packages/api
CMD ["node", "dist/server.js"]

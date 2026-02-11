#!/bin/bash

echo "🚀 Starting WorkGear Development Environment..."

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Installing pnpm..."
    npm install -g pnpm@10.28.2
fi

# 检查 Node.js 版本
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    echo "❌ Node.js version must be >= 22. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo "✅ pnpm version: $(pnpm -v)"

# 启动数据库
echo "📦 Starting PostgreSQL and Redis..."
cd docker
docker-compose up -d
cd ..

# 等待数据库就绪
echo "⏳ Waiting for databases to be ready..."
sleep 5

# 安装依赖
echo "📥 Installing dependencies..."
pnpm install

# 推送数据库 schema
echo "🗄️  Pushing database schema..."
cd packages/api
pnpm db:push
cd ../..

echo "✅ Development environment is ready!"
echo ""
echo "To start the services:"
echo "  pnpm dev"
echo ""
echo "Services will be available at:"
echo "  - Frontend: http://localhost:3000"
echo "  - API: http://localhost:4000"
echo "  - Orchestrator gRPC: localhost:50051"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis: localhost:6379"

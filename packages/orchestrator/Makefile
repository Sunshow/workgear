.PHONY: proto build run clean

PROTO_DIR := ../../packages/shared/proto
PROTO_OUT := ./internal/grpc

# 生成 protobuf Go 代码
proto:
	protoc --go_out=$(PROTO_OUT) --go_opt=paths=source_relative \
		--go-grpc_out=$(PROTO_OUT) --go-grpc_opt=paths=source_relative \
		-I $(PROTO_DIR) \
		$(PROTO_DIR)/orchestrator.proto

# 构建
build:
	go build -o bin/orchestrator ./cmd/server

# 运行（从 .env 加载环境变量）
run:
	@if [ -f .env ]; then set -a && . ./.env && set +a; fi && go run ./cmd/server

# 清理
clean:
	rm -rf bin/

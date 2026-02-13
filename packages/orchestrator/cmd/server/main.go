package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"
	grpclib "google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	"github.com/sunshow/workgear/orchestrator/internal/agent"
	"github.com/sunshow/workgear/orchestrator/internal/db"
	"github.com/sunshow/workgear/orchestrator/internal/engine"
	"github.com/sunshow/workgear/orchestrator/internal/event"
	grpcserver "github.com/sunshow/workgear/orchestrator/internal/grpc"
)

func main() {
	// Initialize logger
	logger, _ := zap.NewDevelopment()
	defer logger.Sync()
	sugar := logger.Sugar()

	port := os.Getenv("GRPC_PORT")
	if port == "" {
		port = "50051"
	}

	// Graceful shutdown context
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// 1. Connect to PostgreSQL
	dbClient, err := db.NewClient(ctx, sugar)
	if err != nil {
		sugar.Fatalf("Failed to connect to database: %v", err)
	}
	defer dbClient.Close()

	// 2. Create event bus
	eventBus := event.NewBus(sugar)

	// 3. Create agent registry (Docker + API Key required)
	registry := agent.NewRegistry()

	promptBuilder := agent.NewPromptBuilder()
	dockerExec, err := agent.NewDockerExecutor(sugar)
	if err != nil {
		sugar.Fatalf("Docker is required but not available: %v", err)
	}
	defer dockerExec.Close()

	if os.Getenv("ANTHROPIC_API_KEY") == "" && os.Getenv("ANTHROPIC_AUTH_TOKEN") == "" {
		sugar.Fatalf("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN must be set")
	}

	claudeAdapter := agent.NewCombinedAdapter(
		agent.NewClaudeCodeAdapter(promptBuilder, os.Getenv("CLAUDE_MODEL")),
		dockerExec,
	)
	registry.Register(claudeAdapter)
	registry.MapRole("general-developer", "claude-code")
	registry.MapRole("requirement-analyst", "claude-code")
	registry.MapRole("code-reviewer", "claude-code")
	registry.MapRole("qa-engineer", "claude-code")
	registry.MapRole("spec-architect", "claude-code")
	sugar.Info("ClaudeCode adapter enabled (Docker + API credentials verified)")

	// 4. Create flow executor
	executor := engine.NewFlowExecutor(dbClient, eventBus, registry, sugar)

	// 5. Start the worker loop (recovers stale state + polls for work)
	if err := executor.Start(ctx); err != nil {
		sugar.Fatalf("Failed to start executor: %v", err)
	}

	// 6. Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%s", port))
	if err != nil {
		sugar.Fatalf("Failed to listen: %v", err)
	}

	server := grpclib.NewServer()

	// Register health check
	healthServer := health.NewServer()
	healthpb.RegisterHealthServer(server, healthServer)
	healthServer.SetServingStatus("orchestrator", healthpb.HealthCheckResponse_SERVING)

	// Register orchestrator service
	orchServer := grpcserver.NewOrchestratorServer(executor, eventBus, sugar)
	orchServer.Register(server)

	sugar.Infof("WorkGear Orchestrator gRPC server listening on :%s", port)
	sugar.Info("Phase 4: Persistent state machine + Docker agent support")

	go func() {
		if err := server.Serve(lis); err != nil {
			sugar.Fatalf("Failed to serve: %v", err)
		}
	}()

	<-ctx.Done()
	sugar.Info("Shutting down gRPC server...")
	server.GracefulStop()
	sugar.Info("Server stopped")
}

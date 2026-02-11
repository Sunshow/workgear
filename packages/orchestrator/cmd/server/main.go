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

	// 3. Create agent registry with mock adapter
	registry := agent.NewRegistry()
	registry.Register(agent.NewMockAdapter())
	// Map all roles to mock for now
	registry.MapRole("general-developer", "mock")
	registry.MapRole("requirement-analyst", "mock")
	registry.MapRole("code-reviewer", "mock")
	registry.MapRole("qa-engineer", "mock")

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
	sugar.Info("Phase 3: Persistent state machine + Mock agent mode")

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

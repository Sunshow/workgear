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

	// 3. Create agent registry (load from database)
	registry := agent.NewRegistry()

	promptBuilder := agent.NewPromptBuilder()

	// Create agent factory registry
	factoryRegistry := agent.NewAgentFactoryRegistry()
	factoryRegistry.Register(&agent.ClaudeCodeFactory{PromptBuilder: promptBuilder})
	factoryRegistry.Register(&agent.CodexFactory{PromptBuilder: promptBuilder})

	// Load providers from database
	providers, err := dbClient.GetAllAgentProviders(ctx)
	if err != nil {
		sugar.Fatalf("Failed to load agent providers: %v", err)
	}

	if len(providers) > 0 {
		for _, p := range providers {
			defaultModel, _ := dbClient.GetDefaultModelForProvider(ctx, p.ID)
			modelName := ""
			if defaultModel != nil {
				modelName = defaultModel.ModelName
			}

			adapter, err := factoryRegistry.CreateAdapter(sugar, p.AgentType, p.ID, p.Config, modelName)
			if err != nil {
				sugar.Warnw("Failed to create adapter, skipping", "type", p.AgentType, "name", p.Name, "error", err)
				continue
			}
			registry.RegisterProvider(p.ID, adapter)
			sugar.Infow("Registered provider", "id", p.ID, "type", p.AgentType, "name", p.Name, "default", p.IsDefault)
		}
	} else {
		// Fallback: use environment variables (backward compat)
		if os.Getenv("ANTHROPIC_API_KEY") != "" || os.Getenv("ANTHROPIC_AUTH_TOKEN") != "" {
			envConfig := map[string]any{
				"auth_token": os.Getenv("ANTHROPIC_AUTH_TOKEN"),
				"base_url":   os.Getenv("ANTHROPIC_BASE_URL"),
			}
			if envConfig["auth_token"] == "" {
				envConfig["auth_token"] = os.Getenv("ANTHROPIC_API_KEY")
			}
			adapter, err := factoryRegistry.CreateAdapter(sugar, "claude-code", "env-fallback", envConfig, os.Getenv("CLAUDE_MODEL"))
			if err != nil {
				sugar.Fatalf("Failed to create env fallback adapter: %v", err)
			}
			registry.RegisterProvider("env-fallback", adapter)
			sugar.Warn("No providers in database, using environment variable fallback")
		} else {
			sugar.Fatalf("No agent providers configured in database and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment")
		}
	}

	// Load role mappings from database
	roleConfigs, err := dbClient.GetAllAgentRoleConfigs(ctx)
	if err != nil {
		sugar.Fatalf("Failed to load agent role configs: %v", err)
	}

	for slug, rc := range roleConfigs {
		providerID := ""
		modelName := ""

		if rc.ProviderID != nil {
			// Role has explicit provider
			providerID = *rc.ProviderID
			if rc.ModelID != nil {
				// Role has explicit model
				m, _ := dbClient.GetAgentModel(ctx, *rc.ModelID)
				if m != nil {
					modelName = m.ModelName
				}
			} else {
				// Use provider's default model
				m, _ := dbClient.GetDefaultModelForProvider(ctx, providerID)
				if m != nil {
					modelName = m.ModelName
				}
			}
		} else {
			// Use default provider for agent type
			dp, _ := dbClient.GetDefaultProviderForType(ctx, rc.AgentType)
			if dp != nil {
				providerID = dp.ID
				m, _ := dbClient.GetDefaultModelForProvider(ctx, dp.ID)
				if m != nil {
					modelName = m.ModelName
				}
			} else if len(providers) == 0 {
				// Env fallback
				providerID = "env-fallback"
				modelName = os.Getenv("CLAUDE_MODEL")
			}
		}

		if providerID != "" {
			registry.MapRoleToProvider(slug, providerID, modelName)
			sugar.Infow("Mapped role", "role", slug, "provider", providerID, "model", modelName)
		} else {
			sugar.Warnw("No provider found for role", "role", slug, "agent_type", rc.AgentType)
		}
	}

	// Ensure common roles are mapped (fallback for roles not in DB)
	defaultRoles := []string{"general-developer", "requirement-analyst", "code-reviewer", "qa-engineer", "spec-architect"}
	for _, role := range defaultRoles {
		if _, err := registry.GetAdapter(role); err != nil {
			// Try to map to default provider for claude-code
			dp, _ := dbClient.GetDefaultProviderForType(ctx, "claude-code")
			if dp != nil {
				m, _ := dbClient.GetDefaultModelForProvider(ctx, dp.ID)
				mn := ""
				if m != nil {
					mn = m.ModelName
				}
				registry.MapRoleToProvider(role, dp.ID, mn)
				sugar.Infow("Auto-mapped default role", "role", role, "provider", dp.ID)
			} else if len(providers) == 0 {
				registry.MapRoleToProvider(role, "env-fallback", os.Getenv("CLAUDE_MODEL"))
			}
		}
	}

	sugar.Infof("Agent registry initialized with %d providers", len(providers))

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
	orchServer := grpcserver.NewOrchestratorServer(executor, eventBus, registry, factoryRegistry, sugar)
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

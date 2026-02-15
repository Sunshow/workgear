package grpc

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"
	grpclib "google.golang.org/grpc"

	"github.com/sunshow/workgear/orchestrator/internal/agent"
	"github.com/sunshow/workgear/orchestrator/internal/engine"
	"github.com/sunshow/workgear/orchestrator/internal/event"
	pb "github.com/sunshow/workgear/orchestrator/internal/grpc/pb"
)

// OrchestratorServer implements the gRPC OrchestratorService
type OrchestratorServer struct {
	pb.UnimplementedOrchestratorServiceServer
	executor        *engine.FlowExecutor
	eventBus        *event.Bus
	registry        *agent.Registry
	factoryRegistry *agent.AgentFactoryRegistry
	logger          *zap.SugaredLogger
}

// NewOrchestratorServer creates a new gRPC server
func NewOrchestratorServer(executor *engine.FlowExecutor, eventBus *event.Bus, registry *agent.Registry, factoryRegistry *agent.AgentFactoryRegistry, logger *zap.SugaredLogger) *OrchestratorServer {
	return &OrchestratorServer{
		executor:        executor,
		eventBus:        eventBus,
		registry:        registry,
		factoryRegistry: factoryRegistry,
		logger:          logger,
	}
}

// Register registers the service with a gRPC server
func (s *OrchestratorServer) Register(server *grpclib.Server) {
	pb.RegisterOrchestratorServiceServer(server, s)
}

// ─── Flow Management ───

func (s *OrchestratorServer) StartFlow(ctx context.Context, req *pb.StartFlowRequest) (*pb.StartFlowResponse, error) {
	s.logger.Infow("StartFlow called",
		"flow_run_id", req.FlowRunId,
		"task_id", req.TaskId,
		"workflow_id", req.WorkflowId,
	)

	if err := s.executor.StartFlow(ctx, req.FlowRunId, req.WorkflowDsl, req.Variables); err != nil {
		s.logger.Errorw("StartFlow failed", "error", err)
		return &pb.StartFlowResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.StartFlowResponse{Success: true}, nil
}

func (s *OrchestratorServer) CancelFlow(ctx context.Context, req *pb.CancelFlowRequest) (*pb.CancelFlowResponse, error) {
	s.logger.Infow("CancelFlow called", "flow_run_id", req.FlowRunId)

	if err := s.executor.CancelFlow(ctx, req.FlowRunId); err != nil {
		s.logger.Errorw("CancelFlow failed", "error", err)
		return &pb.CancelFlowResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.CancelFlowResponse{Success: true}, nil
}

// ─── Human Actions ───

func (s *OrchestratorServer) ApproveNode(ctx context.Context, req *pb.ApproveNodeRequest) (*pb.NodeActionResponse, error) {
	s.logger.Infow("ApproveNode called", "node_run_id", req.NodeRunId)

	if err := s.executor.HandleApprove(ctx, req.NodeRunId); err != nil {
		s.logger.Errorw("ApproveNode failed", "error", err)
		return &pb.NodeActionResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.NodeActionResponse{Success: true}, nil
}

func (s *OrchestratorServer) RejectNode(ctx context.Context, req *pb.RejectNodeRequest) (*pb.NodeActionResponse, error) {
	s.logger.Infow("RejectNode called", "node_run_id", req.NodeRunId, "feedback", req.Feedback)

	if err := s.executor.HandleReject(ctx, req.NodeRunId, req.Feedback); err != nil {
		s.logger.Errorw("RejectNode failed", "error", err)
		return &pb.NodeActionResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.NodeActionResponse{Success: true}, nil
}

func (s *OrchestratorServer) EditNode(ctx context.Context, req *pb.EditNodeRequest) (*pb.NodeActionResponse, error) {
	s.logger.Infow("EditNode called", "node_run_id", req.NodeRunId)

	if err := s.executor.HandleEdit(ctx, req.NodeRunId, req.EditedContent, req.ChangeSummary); err != nil {
		s.logger.Errorw("EditNode failed", "error", err)
		return &pb.NodeActionResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.NodeActionResponse{Success: true}, nil
}

func (s *OrchestratorServer) SubmitHumanInput(ctx context.Context, req *pb.SubmitHumanInputRequest) (*pb.NodeActionResponse, error) {
	s.logger.Infow("SubmitHumanInput called", "node_run_id", req.NodeRunId)

	if err := s.executor.HandleHumanInput(ctx, req.NodeRunId, req.DataJson); err != nil {
		s.logger.Errorw("SubmitHumanInput failed", "error", err)
		return &pb.NodeActionResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.NodeActionResponse{Success: true}, nil
}

func (s *OrchestratorServer) RetryNode(ctx context.Context, req *pb.RetryNodeRequest) (*pb.NodeActionResponse, error) {
	s.logger.Infow("RetryNode called", "node_run_id", req.NodeRunId)

	if err := s.executor.HandleRetry(ctx, req.NodeRunId); err != nil {
		s.logger.Errorw("RetryNode failed", "error", err)
		return &pb.NodeActionResponse{Success: false, Error: err.Error()}, nil
	}

	return &pb.NodeActionResponse{Success: true}, nil
}

// ─── Event Stream ───

func (s *OrchestratorServer) EventStream(req *pb.EventStreamRequest, stream pb.OrchestratorService_EventStreamServer) error {
	s.logger.Infow("EventStream started", "flow_run_id", req.FlowRunId)

	ctx := stream.Context()
	ch := make(chan *event.Event, 100)
	var once sync.Once

	// Determine subscription channel
	subChannel := "*"
	if req.FlowRunId != "" {
		subChannel = "flow-run:" + req.FlowRunId
	}

	// Subscribe to events
	s.eventBus.Subscribe(subChannel, func(evt *event.Event) {
		select {
		case ch <- evt:
		default:
			// Channel full, drop event (client too slow)
			s.logger.Warnw("Event dropped, client too slow", "event_type", evt.Type)
		}
	})

	defer func() {
		once.Do(func() {
			s.eventBus.Unsubscribe(subChannel)
			close(ch)
		})
	}()

	for {
		select {
		case <-ctx.Done():
			s.logger.Infow("EventStream closed", "flow_run_id", req.FlowRunId)
			return nil
		case evt, ok := <-ch:
			if !ok {
				return nil
			}

			dataJSON := "{}"
			if evt.Data != nil {
				if b, err := json.Marshal(evt.Data); err == nil {
					dataJSON = string(b)
				}
			}

			if err := stream.Send(&pb.ServerEvent{
				EventType: evt.Type,
				FlowRunId: evt.FlowRunID,
				NodeRunId: evt.NodeRunID,
				NodeId:    evt.NodeID,
				DataJson:  dataJSON,
				Timestamp: evt.Timestamp,
			}); err != nil {
				s.logger.Warnw("Failed to send event", "error", err)
				return err
			}
		}
	}
}

// ─── Agent Test ───

func (s *OrchestratorServer) TestAgent(ctx context.Context, req *pb.TestAgentRequest) (*pb.TestAgentResponse, error) {
	s.logger.Infow("TestAgent called",
		"role_id", req.RoleId,
		"agent_type", req.AgentType,
		"prompt_len", len(req.TestPrompt),
	)

	// Build AgentRequest with test mode
	agentReq := &agent.AgentRequest{
		TaskID:     "test-" + req.RoleId,
		FlowRunID:  "test-flow",
		NodeID:     "test-node",
		Mode:       "test",
		Prompt:     req.TestPrompt,
		RolePrompt: req.SystemPrompt,
		Context:    make(map[string]any),
	}

	// Set model from request
	if req.ModelName != nil {
		agentReq.Model = *req.ModelName
	}

	// Try to get adapter from registry by role_id first, then build ad-hoc
	var adapterInstance agent.Adapter

	// Try provider-based lookup
	providerID := ""
	if req.ProviderId != nil {
		providerID = *req.ProviderId
	}

	if providerID != "" {
		// Try registry first (adapter already registered at startup)
		if registeredAdapter, ok := s.registry.GetAdapterByProvider(providerID); ok {
			adapterInstance = registeredAdapter
		} else {
			// Build a temporary adapter via factory with the provider config from the request
			configMap := make(map[string]any)
			for k, v := range req.ProviderConfig {
				configMap[k] = v
			}

			modelName := ""
			if req.ModelName != nil {
				modelName = *req.ModelName
			}

			adapter, err := s.factoryRegistry.CreateAdapter(s.logger, req.AgentType, providerID, configMap, modelName)
			if err != nil {
				return &pb.TestAgentResponse{
					Success: false,
					Error:   strPtr(err.Error()),
				}, nil
			}
			adapterInstance = adapter
		}
	} else {
		return &pb.TestAgentResponse{
			Success: false,
			Error:   strPtr("No provider_id specified for test"),
		}, nil
	}

	// Collect logs
	var logs []string
	var logsMu sync.Mutex
	if combined, ok := adapterInstance.(*agent.CombinedAdapter); ok {
		if dockerExec, ok := combined.Executor().(*agent.DockerExecutor); ok {
			dockerExec.SetLogEventCallback(func(evt agent.ClaudeStreamEvent) {
				logLine := fmt.Sprintf("[%s] %s", evt.Type, evt.Subtype)
				if evt.Message != nil {
					for _, block := range evt.Message.Content {
						if block.Type == "text" && block.Text != "" {
							logLine += ": " + truncateStr(block.Text, 200)
						}
					}
				}
				logsMu.Lock()
				logs = append(logs, logLine)
				logsMu.Unlock()
			})
		}
	}

	// Execute with timeout
	testCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	resp, err := adapterInstance.Execute(testCtx, agentReq)
	if err != nil {
		return &pb.TestAgentResponse{
			Success: false,
			Error:   strPtr(err.Error()),
			Logs:    logs,
		}, nil
	}

	// Serialize result
	resultJSON, _ := json.Marshal(resp.Output)

	return &pb.TestAgentResponse{
		Success: true,
		Result:  strPtr(string(resultJSON)),
		Logs:    logs,
	}, nil
}

func strPtr(s string) *string { return &s }

func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

package grpc

import (
	"context"

	"go.uber.org/zap"
	grpclib "google.golang.org/grpc"
)

// OrchestratorServer 实现 gRPC 服务（Phase 1 为 Mock 实现）
type OrchestratorServer struct {
	UnimplementedOrchestratorServiceServer
	logger *zap.SugaredLogger
}

// RegisterServices 注册 gRPC 服务
func RegisterServices(server *grpclib.Server, logger *zap.SugaredLogger) {
	RegisterOrchestratorServiceServer(server, &OrchestratorServer{logger: logger})
}

func (s *OrchestratorServer) StartFlow(ctx context.Context, req *StartFlowRequest) (*StartFlowResponse, error) {
	s.logger.Infow("StartFlow called (mock)",
		"flow_run_id", req.FlowRunId,
	)
	return &StartFlowResponse{Success: true}, nil
}

func (s *OrchestratorServer) CancelFlow(ctx context.Context, req *CancelFlowRequest) (*CancelFlowResponse, error) {
	s.logger.Infow("CancelFlow called (mock)",
		"flow_run_id", req.FlowRunId,
	)
	return &CancelFlowResponse{Success: true}, nil
}

func (s *OrchestratorServer) RejectNode(ctx context.Context, req *RejectNodeRequest) (*RejectNodeResponse, error) {
	s.logger.Infow("RejectNode called (mock)",
		"node_run_id", req.NodeRunId,
		"feedback", req.Feedback,
	)
	return &RejectNodeResponse{Success: true}, nil
}

func (s *OrchestratorServer) ApproveNode(ctx context.Context, req *ApproveNodeRequest) (*ApproveNodeResponse, error) {
	s.logger.Infow("ApproveNode called (mock)",
		"node_run_id", req.NodeRunId,
	)
	return &ApproveNodeResponse{Success: true}, nil
}

func (s *OrchestratorServer) EditNode(ctx context.Context, req *EditNodeRequest) (*EditNodeResponse, error) {
	s.logger.Infow("EditNode called (mock)",
		"node_run_id", req.NodeRunId,
	)
	return &EditNodeResponse{Success: true}, nil
}

func (s *OrchestratorServer) RetryNode(ctx context.Context, req *RetryNodeRequest) (*RetryNodeResponse, error) {
	s.logger.Infow("RetryNode called (mock)",
		"node_run_id", req.NodeRunId,
	)
	return &RetryNodeResponse{Success: true}, nil
}

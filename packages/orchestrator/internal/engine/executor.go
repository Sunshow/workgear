package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/sunshow/workgear/orchestrator/internal/agent"
	"github.com/sunshow/workgear/orchestrator/internal/db"
	"github.com/sunshow/workgear/orchestrator/internal/event"
)

// FlowExecutor is the core engine that drives flow execution
type FlowExecutor struct {
	db       *db.Client
	eventBus *event.Bus
	registry *agent.Registry
	logger   *zap.SugaredLogger
	workerID string
}

// NewFlowExecutor creates a new flow executor
func NewFlowExecutor(
	dbClient *db.Client,
	eventBus *event.Bus,
	registry *agent.Registry,
	logger *zap.SugaredLogger,
) *FlowExecutor {
	return &FlowExecutor{
		db:       dbClient,
		eventBus: eventBus,
		registry: registry,
		logger:   logger,
		workerID: fmt.Sprintf("worker-%s", uuid.New().String()[:8]),
	}
}

// Start initializes the executor: recovers stale state and starts the worker loop
func (e *FlowExecutor) Start(ctx context.Context) error {
	// 1. Recovery: reset stale RUNNING nodes from dead workers
	count, err := e.db.ResetStaleRunningNodes(ctx)
	if err != nil {
		return fmt.Errorf("reset stale nodes: %w", err)
	}
	if count > 0 {
		e.logger.Infow("Recovered stale running nodes", "count", count)
	}

	// 2. Start worker loop
	e.logger.Infow("Starting worker loop", "worker_id", e.workerID)
	go e.runWorkerLoop(ctx)

	return nil
}

// runWorkerLoop continuously polls DB for queued node runs
func (e *FlowExecutor) runWorkerLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			e.logger.Info("Worker loop stopped")
			return
		default:
			nodeRun, err := e.db.AcquireNextNodeRun(ctx, e.workerID)
			if err != nil {
				e.logger.Errorw("Failed to acquire node run", "error", err)
				time.Sleep(1 * time.Second)
				continue
			}
			if nodeRun == nil {
				// No work available, sleep briefly
				time.Sleep(500 * time.Millisecond)
				continue
			}

			e.logger.Infow("Acquired node run",
				"node_run_id", nodeRun.ID,
				"node_id", nodeRun.NodeID,
				"node_type", ptrStr(nodeRun.NodeType),
				"flow_run_id", nodeRun.FlowRunID,
			)

			// Publish node.started event
			e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.started", nil)

			// Execute the node
			if err := e.executeNode(ctx, nodeRun); err != nil {
				e.logger.Errorw("Node execution failed",
					"node_run_id", nodeRun.ID,
					"node_id", nodeRun.NodeID,
					"error", err,
				)
				e.handleNodeError(ctx, nodeRun, err)
			}

			// Advance DAG after node execution
			if err := e.advanceDAG(ctx, nodeRun.FlowRunID); err != nil {
				e.logger.Errorw("Failed to advance DAG",
					"flow_run_id", nodeRun.FlowRunID,
					"error", err,
				)
			}
		}
	}
}

// executeNode dispatches execution based on node type
func (e *FlowExecutor) executeNode(ctx context.Context, nodeRun *db.NodeRun) error {
	nodeType := ptrStr(nodeRun.NodeType)

	switch nodeType {
	case "agent_task":
		return e.executeAgentTask(ctx, nodeRun)
	case "human_review":
		return e.executeHumanReview(ctx, nodeRun)
	case "human_input":
		return e.executeHumanInput(ctx, nodeRun)
	default:
		return fmt.Errorf("unknown node type: %s", nodeType)
	}
}

// handleNodeError marks a node as failed and publishes error event
func (e *FlowExecutor) handleNodeError(ctx context.Context, nodeRun *db.NodeRun, execErr error) {
	errMsg := execErr.Error()
	if err := e.db.UpdateNodeRunError(ctx, nodeRun.ID, db.StatusFailed, errMsg); err != nil {
		e.logger.Errorw("Failed to update node error", "error", err)
	}

	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.failed", map[string]any{
		"error": errMsg,
	})

	// Mark flow as failed
	if err := e.db.UpdateFlowRunError(ctx, nodeRun.FlowRunID, db.StatusFailed, errMsg); err != nil {
		e.logger.Errorw("Failed to update flow run error", "error", err)
	}

	e.publishEvent(nodeRun.FlowRunID, "", "", "flow.failed", map[string]any{
		"error":   errMsg,
		"node_id": nodeRun.NodeID,
	})
}

// publishEvent is a helper to publish events through the event bus
func (e *FlowExecutor) publishEvent(flowRunID, nodeRunID, nodeID, eventType string, data map[string]any) {
	e.eventBus.Publish(&event.Event{
		Type:      eventType,
		FlowRunID: flowRunID,
		NodeRunID: nodeRunID,
		NodeID:    nodeID,
		Data:      data,
	})
}

// ptrStr safely dereferences a string pointer
func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// strPtr creates a pointer to a string
func strPtr(s string) *string {
	return &s
}

// jsonStr marshals a value to JSON string pointer
func jsonStr(v any) *string {
	b, _ := json.Marshal(v)
	s := string(b)
	return &s
}

package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/sunshow/workgear/orchestrator/internal/agent"
	"github.com/sunshow/workgear/orchestrator/internal/db"
	"github.com/sunshow/workgear/orchestrator/internal/event"
	"github.com/sunshow/workgear/orchestrator/internal/repo"
)

// FlowExecutor is the core engine that drives flow execution
type FlowExecutor struct {
	db          *db.Client
	eventBus    *event.Bus
	registry    *agent.Registry
	logger      *zap.SugaredLogger
	workerID    string
	repoManager *repo.RepoManager // Git repo cache manager (nil = disabled)

	// Concurrency control
	maxConcurrency int            // global max concurrent agent executions
	sem            chan struct{}   // semaphore to limit concurrency
	wg             sync.WaitGroup // wait group for graceful shutdown

	// per-flow cancel context management (supports multiple concurrent nodes per flow)
	flowCancels   map[string]map[string]context.CancelFunc // flowRunID → {nodeRunID → cancel}
	flowCancelsMu sync.Mutex

	// per-flow DAG advancement mutex (prevents duplicate node activation)
	dagMutexes   map[string]*sync.Mutex
	dagMutexesMu sync.Mutex
}

// NewFlowExecutor creates a new flow executor
func NewFlowExecutor(
	dbClient *db.Client,
	eventBus *event.Bus,
	registry *agent.Registry,
	logger *zap.SugaredLogger,
	maxConcurrency int,
	repoManager *repo.RepoManager,
) *FlowExecutor {
	if maxConcurrency <= 0 {
		maxConcurrency = 5
	}
	return &FlowExecutor{
		db:             dbClient,
		eventBus:       eventBus,
		registry:       registry,
		logger:         logger,
		workerID:       fmt.Sprintf("worker-%s", uuid.New().String()[:8]),
		maxConcurrency: maxConcurrency,
		sem:            make(chan struct{}, maxConcurrency),
		flowCancels:    make(map[string]map[string]context.CancelFunc),
		dagMutexes:     make(map[string]*sync.Mutex),
		repoManager:    repoManager,
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

	// 2. Cancel flow_runs stuck in 'running' for over 2 hours with no active nodes
	staleFlows, err := e.db.CancelStaleFlowRuns(ctx, 2*time.Hour)
	if err != nil {
		e.logger.Warnw("Failed to cancel stale flow_runs", "error", err)
	} else if staleFlows > 0 {
		e.logger.Infow("Cancelled stale flow_runs", "count", staleFlows)
	}

	// 2b. Sync stale DSL snapshots: update active flow_runs whose dsl_snapshot differs from workflows.dsl
	synced, err := e.db.SyncStaleDslSnapshots(ctx)
	if err != nil {
		e.logger.Warnw("Failed to sync stale DSL snapshots", "error", err)
	} else if synced > 0 {
		e.logger.Warnw("Synced stale DSL snapshots to match current workflow DSL", "count", synced)
	}

	// 2c. Re-advance running flows: ensure pending nodes with all deps completed get queued
	// (handles cases where nodes were manually marked completed but advanceDAG wasn't called)
	runningFlows, err := e.db.GetRunningFlowRunIDs(ctx)
	if err != nil {
		e.logger.Warnw("Failed to get running flow runs for re-advance", "error", err)
	} else {
		for _, fid := range runningFlows {
			if err := e.advanceDAG(ctx, fid); err != nil {
				e.logger.Warnw("Failed to re-advance flow", "flow_run_id", fid, "error", err)
			}
		}
		if len(runningFlows) > 0 {
			e.logger.Infow("Re-advanced running flows on startup", "count", len(runningFlows))
		}
	}

	// 3. Start worker loop
	e.logger.Infow("Starting worker loop", "worker_id", e.workerID, "max_concurrency", e.maxConcurrency)
	go e.runWorkerLoop(ctx)

	return nil
}

// runWorkerLoop continuously polls DB for queued node runs and dispatches them concurrently
func (e *FlowExecutor) runWorkerLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			e.logger.Info("Worker loop stopping, waiting for in-flight executions...")
			e.wg.Wait()
			e.logger.Info("Worker loop stopped")
			return
		case e.sem <- struct{}{}: // acquire semaphore slot
			nodeRun, err := e.db.AcquireNextNodeRun(ctx, e.workerID)
			if err != nil {
				<-e.sem // release slot
				if ctx.Err() != nil {
					return
				}
				e.logger.Errorw("Failed to acquire node run", "error", err)
				time.Sleep(1 * time.Second)
				continue
			}
			if nodeRun == nil {
				<-e.sem // release slot — no work available
				time.Sleep(500 * time.Millisecond)
				continue
			}

			e.logger.Infow("Acquired node run",
				"node_run_id", nodeRun.ID,
				"node_id", nodeRun.NodeID,
				"node_type", ptrStr(nodeRun.NodeType),
				"flow_run_id", nodeRun.FlowRunID,
			)

			e.wg.Add(1)

			// Create and register cancel context BEFORE goroutine starts
			// to prevent race with CancelFlow
			flowCtx, cancel := context.WithCancel(ctx)
			e.registerFlowCancel(nodeRun.FlowRunID, nodeRun.ID, cancel)

			go func(nr *db.NodeRun, fCtx context.Context, cancelFn context.CancelFunc) {
				defer e.wg.Done()
				defer func() { <-e.sem }() // release semaphore slot when done
				e.executeNodeAsync(ctx, fCtx, cancelFn, nr)
			}(nodeRun, flowCtx, cancel)
		}
	}
}

// executeNodeAsync handles the full lifecycle of a single node execution in its own goroutine.
// ctx is the parent context for DB operations; flowCtx is the per-node cancellable context.
func (e *FlowExecutor) executeNodeAsync(ctx context.Context, flowCtx context.Context, cancel context.CancelFunc, nodeRun *db.NodeRun) {
	defer func() {
		e.unregisterFlowCancel(nodeRun.FlowRunID, nodeRun.ID)
		cancel()
	}()

	// Fast-fail: check if already cancelled between register and execution start
	if flowCtx.Err() != nil {
		e.logger.Infow("Node already cancelled before execution started",
			"node_run_id", nodeRun.ID,
			"node_id", nodeRun.NodeID,
		)
		return
	}

	// Publish node.started event
	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.started", nil)

	// Execute the node
	if err := e.executeNode(flowCtx, nodeRun); err != nil {
		if flowCtx.Err() == context.Canceled {
			// Flow was cancelled — CancelFlow already handled status updates
			e.logger.Infow("Node execution cancelled by flow cancel",
				"node_run_id", nodeRun.ID,
				"node_id", nodeRun.NodeID,
			)
			return
		}
		e.logger.Errorw("Node execution failed",
			"node_run_id", nodeRun.ID,
			"node_id", nodeRun.NodeID,
			"error", err,
		)
		e.handleNodeError(ctx, nodeRun, err)
	}

	// Advance DAG only if flow was not cancelled
	if flowCtx.Err() != context.Canceled {
		if err := e.advanceDAG(ctx, nodeRun.FlowRunID); err != nil {
			e.logger.Errorw("Failed to advance DAG",
				"flow_run_id", nodeRun.FlowRunID,
				"error", err,
			)
		}
	}
}

// ─── Flow Cancel Context Management ───

func (e *FlowExecutor) registerFlowCancel(flowRunID, nodeRunID string, cancel context.CancelFunc) {
	e.flowCancelsMu.Lock()
	defer e.flowCancelsMu.Unlock()
	if e.flowCancels[flowRunID] == nil {
		e.flowCancels[flowRunID] = make(map[string]context.CancelFunc)
	}
	e.flowCancels[flowRunID][nodeRunID] = cancel
}

func (e *FlowExecutor) unregisterFlowCancel(flowRunID, nodeRunID string) {
	e.flowCancelsMu.Lock()
	defer e.flowCancelsMu.Unlock()
	if m, ok := e.flowCancels[flowRunID]; ok {
		delete(m, nodeRunID)
		if len(m) == 0 {
			delete(e.flowCancels, flowRunID)
		}
	}
}

func (e *FlowExecutor) cancelFlowContext(flowRunID string) {
	e.flowCancelsMu.Lock()
	defer e.flowCancelsMu.Unlock()
	if m, ok := e.flowCancels[flowRunID]; ok {
		for _, cancel := range m {
			cancel()
		}
	}
}

// ─── DAG Mutex Management ───

func (e *FlowExecutor) getDAGMutex(flowRunID string) *sync.Mutex {
	e.dagMutexesMu.Lock()
	defer e.dagMutexesMu.Unlock()
	if e.dagMutexes[flowRunID] == nil {
		e.dagMutexes[flowRunID] = &sync.Mutex{}
	}
	return e.dagMutexes[flowRunID]
}

func (e *FlowExecutor) cleanupDAGMutex(flowRunID string) {
	e.dagMutexesMu.Lock()
	defer e.dagMutexesMu.Unlock()
	delete(e.dagMutexes, flowRunID)
}

// executeNode dispatches execution based on node type
func (e *FlowExecutor) executeNode(ctx context.Context, nodeRun *db.NodeRun) error {
	nodeType := ptrStr(nodeRun.NodeType)

	switch nodeType {
	case "agent_task":
		return e.executeAgentTask(ctx, nodeRun)
	case "agent_dispatch":
		return e.executeAgentDispatch(ctx, nodeRun)
	case "human_review":
		return e.executeHumanReview(ctx, nodeRun)
	case "human_input":
		return e.executeHumanInput(ctx, nodeRun)
	case "system_init":
		return e.executeSystemInit(ctx, nodeRun)
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

	// Don't immediately mark flow as failed — let advanceDAG check if all nodes are terminal
	// This allows other parallel nodes to continue executing
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

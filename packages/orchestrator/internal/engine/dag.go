package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/sunshow/workgear/orchestrator/internal/db"
)

// ─── DAG Advancement ───

// advanceDAG checks and activates downstream nodes after a node completes.
// Uses per-flow mutex to prevent concurrent advanceDAG calls from duplicating node activations.
func (e *FlowExecutor) advanceDAG(ctx context.Context, flowRunID string) error {
	mu := e.getDAGMutex(flowRunID)
	mu.Lock()
	defer mu.Unlock()

	// 0. Early exit if flow is already in terminal state (idempotency guard)
	flowRun, err := e.db.GetFlowRun(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCompleted || flowRun.Status == db.StatusFailed || flowRun.Status == db.StatusCancelled {
		return nil
	}

	// 1. Load DAG
	dag, err := e.getDAG(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("load DAG: %w", err)
	}

	// 2. Get completed node IDs
	completedNodes, err := e.db.GetCompletedNodeIDs(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("get completed nodes: %w", err)
	}

	// 3. Get pending node runs
	pendingNodes, err := e.db.GetPendingNodeRuns(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("get pending nodes: %w", err)
	}

	// 4. For each pending node, check if all dependencies are completed
	for _, pending := range pendingNodes {
		deps := dag.GetDependencies(pending.NodeID)
		allDepsCompleted := true
		for _, depID := range deps {
			if !completedNodes[depID] {
				allDepsCompleted = false
				break
			}
		}

		if allDepsCompleted {
			// Resolve input from upstream outputs
			input, err := e.resolveNodeInput(ctx, flowRunID, dag, pending.NodeID, completedNodes)
			if err != nil {
				e.logger.Warnw("Failed to resolve node input", "node_id", pending.NodeID, "error", err)
			}
			if input == nil {
				input = make(map[string]any)
			}

			// For agent_task nodes, check if previous flow has reusable output
			nodeType := ptrStr(pending.NodeType)
			if nodeType == "agent_task" {
				hasReuse, err := e.db.HasPreviousFlowOutput(ctx, flowRunID, pending.NodeID)
				if err != nil {
					e.logger.Warnw("Failed to check reuse", "node_id", pending.NodeID, "error", err)
				}
				if hasReuse {
					input["_reuse_available"] = true
					inputJSON := jsonStr(input)
					if err := e.db.UpdateNodeRunInput(ctx, pending.ID, inputJSON); err != nil {
						e.logger.Warnw("Failed to update node input", "node_id", pending.NodeID, "error", err)
					}
					// Set to waiting_human so scheduler won't pick it up
					if err := e.db.UpdateNodeRunStatus(ctx, pending.ID, db.StatusWaitingHuman); err != nil {
						e.logger.Errorw("Failed to set node waiting_human for reuse", "node_id", pending.NodeID, "error", err)
						continue
					}
					e.logger.Infow("Paused node for reuse check", "node_id", pending.NodeID, "flow_run_id", flowRunID)
					e.publishEvent(flowRunID, pending.ID, pending.NodeID, "node.waiting_human", map[string]any{"reuse_available": true})
					continue
				}
			}

			// Update input if resolved
			inputJSON := jsonStr(input)
			if err := e.db.UpdateNodeRunInput(ctx, pending.ID, inputJSON); err != nil {
				e.logger.Warnw("Failed to update node input", "node_id", pending.NodeID, "error", err)
			}

			// Activate: PENDING → QUEUED
			if err := e.db.UpdateNodeRunStatus(ctx, pending.ID, db.StatusQueued); err != nil {
				e.logger.Errorw("Failed to queue node", "node_id", pending.NodeID, "error", err)
				continue
			}

			e.logger.Infow("Activated node", "node_id", pending.NodeID, "flow_run_id", flowRunID)
			e.publishEvent(flowRunID, pending.ID, pending.NodeID, "node.queued", nil)
		}
	}

	// 5. Check if flow is complete (all nodes completed successfully)
	allCompleted, err := e.db.AllNodesCompleted(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("check all completed: %w", err)
	}

	if allCompleted {
		if err := e.db.UpdateFlowRunStatus(ctx, flowRunID, db.StatusCompleted); err != nil {
			return fmt.Errorf("complete flow: %w", err)
		}

		e.publishEvent(flowRunID, "", "", "flow.completed", nil)

		// Record timeline
		flowRun, _ := e.db.GetFlowRun(ctx, flowRunID)
		if flowRun != nil {
			e.recordTimeline(ctx, flowRun.TaskID, flowRunID, "", "flow_completed", map[string]any{
				"message": "流程执行完成",
			})

			// Auto-move task to "Done" column
			if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "Done"); err != nil {
				e.logger.Warnw("Failed to move task to Done", "task_id", flowRun.TaskID, "error", err)
			}
		}

		// Cleanup per-flow DAG mutex
		e.cleanupDAGMutex(flowRunID)

		// Async cleanup git repo cache worktrees
		e.asyncCleanupFlowRepoState(flowRunID)

		e.logger.Infow("Flow completed", "flow_run_id", flowRunID)
		return nil
	}

	// 6. Check if all nodes are terminal but not all completed (some failed)
	allTerminal, err := e.db.AllNodesTerminal(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("check all terminal: %w", err)
	}

	if allTerminal {
		// All nodes finished but some failed — mark flow as failed
		if err := e.db.UpdateFlowRunError(ctx, flowRunID, db.StatusFailed, "部分节点执行失败"); err != nil {
			return fmt.Errorf("fail flow: %w", err)
		}

		e.publishEvent(flowRunID, "", "", "flow.failed", map[string]any{
			"error": "部分节点执行失败",
		})

		// Record timeline
		flowRun, _ := e.db.GetFlowRun(ctx, flowRunID)
		if flowRun != nil {
			e.recordTimeline(ctx, flowRun.TaskID, flowRunID, "", "flow_failed", map[string]any{
				"message": "流程执行失败：部分节点执行失败",
			})
		}

		// Cleanup per-flow DAG mutex
		e.cleanupDAGMutex(flowRunID)

		// Async cleanup git repo cache worktrees
		e.asyncCleanupFlowRepoState(flowRunID)

		e.logger.Infow("Flow failed (some nodes failed)", "flow_run_id", flowRunID)
	}

	return nil
}

// resolveNodeInput collects outputs from upstream nodes as input for the current node
func (e *FlowExecutor) resolveNodeInput(ctx context.Context, flowRunID string, dag *DAG, nodeID string, completedNodes map[string]bool) (map[string]any, error) {
	deps := dag.GetDependencies(nodeID)
	if len(deps) == 0 {
		return nil, nil
	}

	input := make(map[string]any)

	for _, depID := range deps {
		depNodeRun, err := e.db.GetNodeRunByFlowAndNode(ctx, flowRunID, depID)
		if err != nil || depNodeRun == nil {
			continue
		}
		if depNodeRun.Output != nil {
			var output map[string]any
			if err := json.Unmarshal([]byte(*depNodeRun.Output), &output); err == nil {
				// Store under the upstream node's ID
				input[depID] = output
			}
		}
	}

	// For linear flows with single dependency, flatten the input
	if len(deps) == 1 {
		if upstream, ok := input[deps[0]]; ok {
			if upstreamMap, ok := upstream.(map[string]any); ok {
				// Merge upstream output directly into input
				for k, v := range upstreamMap {
					input[k] = v
				}
			}
		}
	}

	return input, nil
}

// ─── Flow Lifecycle ───

// StartFlow initializes a flow run: parses DSL, creates node runs, activates entry nodes
func (e *FlowExecutor) StartFlow(ctx context.Context, flowRunID, dsl string, variables map[string]string) error {
	// 1. Render params variables in DSL ({{params.xxx}} → actual values)
	renderedDSL := RenderParams(dsl, variables)

	// 2. Parse DSL
	wf, dag, err := ParseDSL(renderedDSL)
	if err != nil {
		return fmt.Errorf("parse DSL: %w", err)
	}
	_ = wf

	// 3. Save rendered DSL snapshot to flow run (preserves runtime template vars)
	if err := e.db.SaveFlowRunDslSnapshot(ctx, flowRunID, renderedDSL, variables); err != nil {
		return fmt.Errorf("save DSL snapshot: %w", err)
	}

	// 3. Update flow run status to running
	if err := e.db.UpdateFlowRunStatus(ctx, flowRunID, db.StatusRunning); err != nil {
		return fmt.Errorf("update flow status: %w", err)
	}

	// 4. Get flow run for task_id
	flowRun, err := e.db.GetFlowRun(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}

	// 5. Create NodeRun for each node in the DAG
	entryNodes := dag.GetEntryNodes()
	entryNodeIDs := make(map[string]bool)
	for _, n := range entryNodes {
		entryNodeIDs[n.ID] = true
	}

	for _, nodeID := range dag.NodeOrder {
		node := dag.Nodes[nodeID]
		status := db.StatusPending
		if entryNodeIDs[nodeID] {
			status = db.StatusQueued // Entry nodes start as QUEUED
		}

		// Extract config from DSL for frontend use
		var configJSON *string
		if node.Config != nil {
			configMap := map[string]any{
				"artifact_scope": node.Config.ArtifactScope,
				"mode":           node.Config.Mode,
				"transient":      node.Config.Transient,
				"editable":       node.Config.Editable,
			}
			if b, err := json.Marshal(configMap); err == nil {
				s := string(b)
				configJSON = &s
			}
		}

		nr := &db.NodeRun{
			ID:        uuid.New().String(),
			FlowRunID: flowRunID,
			NodeID:    node.ID,
			NodeType:  strPtr(node.Type),
			NodeName:  strPtr(node.Name),
			Status:    status,
			Attempt:   1,
			Config:    configJSON,
			CreatedAt: time.Now(),
		}

		if err := e.db.CreateNodeRun(ctx, nr); err != nil {
			return fmt.Errorf("create node run for %s: %w", node.ID, err)
		}

		e.logger.Infow("Created node run",
			"node_run_id", nr.ID,
			"node_id", node.ID,
			"status", status,
		)
	}

	// 6. Publish flow started event
	e.publishEvent(flowRunID, "", "", "flow.started", map[string]any{
		"workflow_name": wf.Name,
		"node_count":   len(dag.NodeOrder),
	})

	// 7. Record timeline
	e.recordTimeline(ctx, flowRun.TaskID, flowRunID, "", "flow_started", map[string]any{
		"message":       fmt.Sprintf("流程已启动：%s", wf.Name),
		"workflow_name": wf.Name,
	})

	// 8. Auto-move task to "In Progress" column
	if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "In Progress"); err != nil {
		e.logger.Warnw("Failed to move task to In Progress", "task_id", flowRun.TaskID, "error", err)
	}

	return nil
}

// CancelFlow cancels a running flow and all its active nodes
func (e *FlowExecutor) CancelFlow(ctx context.Context, flowRunID string) error {
	mu := e.getDAGMutex(flowRunID)
	mu.Lock()
	defer mu.Unlock()

	flowRun, err := e.db.GetFlowRun(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}

	if flowRun.Status == db.StatusCompleted || flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("cannot cancel flow in status: %s", flowRun.Status)
	}

	// 1. Get active nodes before cancelling (for event publishing)
	activeNodes, err := e.db.GetActiveNodeRuns(ctx, flowRunID)
	if err != nil {
		e.logger.Warnw("Failed to get active nodes for cancel", "error", err)
	}

	// 2. Trigger per-flow context cancel (terminates running Docker containers)
	e.cancelFlowContext(flowRunID)

	// 3. Cancel all active nodes in DB
	if err := e.db.CancelPendingNodeRuns(ctx, flowRunID); err != nil {
		return fmt.Errorf("cancel active nodes: %w", err)
	}

	// 4. Publish node.cancelled event for each affected node
	for _, node := range activeNodes {
		e.publishEvent(flowRunID, node.ID, node.NodeID, "node.cancelled", map[string]any{
			"previous_status": node.Status,
		})
	}

	// 5. Update flow status
	if err := e.db.UpdateFlowRunStatus(ctx, flowRunID, db.StatusCancelled); err != nil {
		return fmt.Errorf("update flow status: %w", err)
	}

	e.publishEvent(flowRunID, "", "", "flow.cancelled", nil)

	e.recordTimeline(ctx, flowRun.TaskID, flowRunID, "", "flow_cancelled", map[string]any{
		"message": "流程已取消",
	})

	// Cleanup per-flow DAG mutex
	e.cleanupDAGMutex(flowRunID)

	// Async cleanup git repo cache worktrees
	e.asyncCleanupFlowRepoState(flowRunID)

	// Auto-move task back to "Backlog" column
	if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "Backlog"); err != nil {
		e.logger.Warnw("Failed to move task to Backlog", "task_id", flowRun.TaskID, "error", err)
	}

	return nil
}

// ─── Human Actions ───

// HandleApprove processes an approve action on a human_review node
func (e *FlowExecutor) HandleApprove(ctx context.Context, nodeRunID string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	// Check if flow has been cancelled
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("flow has been cancelled")
	}

	if nodeRun.Status != db.StatusWaitingHuman {
		return fmt.Errorf("node is not waiting for human action, current status: %s", nodeRun.Status)
	}

	// Record review
	if err := e.db.UpdateNodeRunReview(ctx, nodeRunID, "approve", ""); err != nil {
		return fmt.Errorf("record review: %w", err)
	}

	// Pass input through as output (approved content)
	var output map[string]any
	if nodeRun.Input != nil {
		_ = json.Unmarshal([]byte(*nodeRun.Input), &output)
	}
	if output == nil {
		output = map[string]any{"approved": true}
	}
	output["_review_action"] = "approve"

	if err := e.db.UpdateNodeRunOutput(ctx, nodeRunID, output); err != nil {
		return fmt.Errorf("save output: %w", err)
	}

	if err := e.db.UpdateNodeRunStatus(ctx, nodeRunID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	e.publishEvent(nodeRun.FlowRunID, nodeRunID, nodeRun.NodeID, "node.completed", map[string]any{
		"review_action": "approve",
	})

	// Record timeline (flowRun already fetched above)
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "review_approved", map[string]any{
		"node_id":   nodeRun.NodeID,
		"node_name": ptrStr(nodeRun.NodeName),
		"message":   fmt.Sprintf("审核通过：%s", ptrStr(nodeRun.NodeName)),
	})

	// Advance DAG
	return e.advanceDAG(ctx, nodeRun.FlowRunID)
}

// HandleReject processes a reject action — rolls back to the target node
func (e *FlowExecutor) HandleReject(ctx context.Context, nodeRunID, feedback string, force bool) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	// Check if flow has been cancelled
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("flow has been cancelled")
	}
	// Force mode allows recovery from failed flows
	if !force && flowRun.Status == db.StatusFailed {
		return fmt.Errorf("flow has failed")
	}

	// Force mode allows rejected nodes, normal mode requires waiting_human
	if !force && nodeRun.Status != db.StatusWaitingHuman {
		return fmt.Errorf("node is not waiting for human action, current status: %s", nodeRun.Status)
	}
	if force && nodeRun.Status != db.StatusWaitingHuman && nodeRun.Status != db.StatusRejected {
		return fmt.Errorf("node cannot be force-rejected, current status: %s", nodeRun.Status)
	}

	// Record review
	if err := e.db.UpdateNodeRunReview(ctx, nodeRunID, "reject", feedback); err != nil {
		return fmt.Errorf("record review: %w", err)
	}

	// Mark current node as REJECTED
	if err := e.db.UpdateNodeRunStatus(ctx, nodeRunID, db.StatusRejected); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	e.publishEvent(nodeRun.FlowRunID, nodeRunID, nodeRun.NodeID, "node.rejected", map[string]any{
		"feedback": feedback,
	})

	// Find the target node to roll back to (flowRun already fetched above)
	nodeDef, err := e.getNodeDef(flowRun, nodeRun.NodeID)
	if err != nil {
		return fmt.Errorf("get node def: %w", err)
	}

	// Determine rollback target
	targetNodeID := ""
	if nodeDef.OnReject != nil && nodeDef.OnReject.Goto != "" {
		targetNodeID = nodeDef.OnReject.Goto
	} else {
		// Default: roll back to the previous node in the DAG
		_, dag, err := ParseDSL(*flowRun.DslSnapshot)
		if err != nil {
			return fmt.Errorf("parse DSL: %w", err)
		}
		prevNode := dag.GetPreviousNode(nodeRun.NodeID)
		if prevNode != nil {
			targetNodeID = prevNode.ID
		}
	}

	if targetNodeID == "" {
		return fmt.Errorf("no rollback target found for node %s", nodeRun.NodeID)
	}

	// Check max_loops (skip if force=true)
	if !force {
		maxLoops := nodeDef.OnReject.GetMaxLoops()
		if maxLoops > 0 {
			targetNodeRun, _ := e.db.GetNodeRunByFlowAndNode(ctx, nodeRun.FlowRunID, targetNodeID)
			if targetNodeRun != nil && targetNodeRun.Attempt >= maxLoops {
				// Max loops reached — fail the flow
				errMsg := fmt.Sprintf("打回次数已达上限 (%d)，节点: %s", maxLoops, nodeRun.NodeID)
				if err := e.db.UpdateFlowRunError(ctx, nodeRun.FlowRunID, db.StatusFailed, errMsg); err != nil {
					return err
				}
				e.publishEvent(nodeRun.FlowRunID, "", "", "flow.failed", map[string]any{
					"error": errMsg,
				})
				return nil
			}
		}
	}

	// Get the existing target node run to determine attempt number
	existingTarget, _ := e.db.GetNodeRunByFlowAndNode(ctx, nodeRun.FlowRunID, targetNodeID)
	attempt := 1
	if existingTarget != nil {
		attempt = existingTarget.Attempt + 1
	}

	// Get target node def
	_, dag, _ := ParseDSL(*flowRun.DslSnapshot)
	targetDef := dag.GetNode(targetNodeID)

	// Build input with feedback injection
	input := make(map[string]any)
	input["_feedback"] = feedback
	input["_reject_from"] = nodeRun.NodeID
	input["_attempt"] = attempt

	// Extract config from DSL for frontend use
	var configJSON *string
	if targetDef.Config != nil {
		configMap := map[string]any{
			"artifact_scope": targetDef.Config.ArtifactScope,
			"mode":           targetDef.Config.Mode,
			"transient":      targetDef.Config.Transient,
			"editable":       targetDef.Config.Editable,
		}
		if b, err := json.Marshal(configMap); err == nil {
			s := string(b)
			configJSON = &s
		}
	}

	// Create new QUEUED node run for the target
	newNodeRun := &db.NodeRun{
		ID:        uuid.New().String(),
		FlowRunID: nodeRun.FlowRunID,
		NodeID:    targetNodeID,
		NodeType:  strPtr(targetDef.Type),
		NodeName:  strPtr(targetDef.Name),
		Status:    db.StatusQueued,
		Attempt:   attempt,
		Input:     jsonStr(input),
		Config:    configJSON,
		CreatedAt: time.Now(),
	}

	if err := e.db.CreateNodeRun(ctx, newNodeRun); err != nil {
		return fmt.Errorf("create rollback node run: %w", err)
	}

	// Also reset nodes between target and current (mark them as needing re-execution)
	// For linear flows, we need to re-create PENDING nodes for nodes between target and current
	e.resetIntermediateNodes(ctx, flowRun, dag, targetNodeID, nodeRun.NodeID)

	// Restore flow status to running if it was failed (force reject from max_loops)
	if flowRun.Status == db.StatusFailed {
		if err := e.db.UpdateFlowRunStatus(ctx, flowRun.ID, db.StatusRunning); err != nil {
			return fmt.Errorf("restore flow status: %w", err)
		}
	}

	// Record timeline
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "review_rejected", map[string]any{
		"node_id":        nodeRun.NodeID,
		"node_name":      ptrStr(nodeRun.NodeName),
		"feedback":       feedback,
		"rollback_to":    targetNodeID,
		"attempt":        attempt,
		"message":        fmt.Sprintf("审核打回：%s → 回退到 %s（第 %d 次）", ptrStr(nodeRun.NodeName), targetNodeID, attempt),
	})

	e.logger.Infow("Rejected and rolling back",
		"from_node", nodeRun.NodeID,
		"to_node", targetNodeID,
		"attempt", attempt,
	)

	return nil
}

// HandleEdit processes an edit_and_approve action
func (e *FlowExecutor) HandleEdit(ctx context.Context, nodeRunID, editedContent, changeSummary string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	// Check if flow has been cancelled
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("flow has been cancelled")
	}

	if nodeRun.Status != db.StatusWaitingHuman {
		return fmt.Errorf("node is not waiting for human action, current status: %s", nodeRun.Status)
	}

	// Record review
	if err := e.db.UpdateNodeRunReview(ctx, nodeRunID, "edit_and_approve", changeSummary); err != nil {
		return fmt.Errorf("record review: %w", err)
	}

	// Parse edited content as output
	var output map[string]any
	if err := json.Unmarshal([]byte(editedContent), &output); err != nil {
		// If not valid JSON, wrap it
		output = map[string]any{
			"edited_content": editedContent,
			"change_summary": changeSummary,
		}
	}
	output["_review_action"] = "edit_and_approve"

	if err := e.db.UpdateNodeRunOutput(ctx, nodeRunID, output); err != nil {
		return fmt.Errorf("save output: %w", err)
	}

	if err := e.db.UpdateNodeRunStatus(ctx, nodeRunID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	e.publishEvent(nodeRun.FlowRunID, nodeRunID, nodeRun.NodeID, "node.completed", map[string]any{
		"review_action": "edit_and_approve",
	})

	// Record timeline (flowRun already fetched above)
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "review_edited", map[string]any{
		"node_id":        nodeRun.NodeID,
		"node_name":      ptrStr(nodeRun.NodeName),
		"change_summary": changeSummary,
		"message":        fmt.Sprintf("编辑后通过：%s", ptrStr(nodeRun.NodeName)),
	})

	return e.advanceDAG(ctx, nodeRun.FlowRunID)
}

// HandleHumanInput processes submitted human input
func (e *FlowExecutor) HandleHumanInput(ctx context.Context, nodeRunID, dataJSON string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	// Check if flow has been cancelled
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("flow has been cancelled")
	}

	if nodeRun.Status != db.StatusWaitingHuman {
		return fmt.Errorf("node is not waiting for human action, current status: %s", nodeRun.Status)
	}

	// Parse submitted data as output
	var output map[string]any
	if err := json.Unmarshal([]byte(dataJSON), &output); err != nil {
		return fmt.Errorf("invalid input data: %w", err)
	}

	if err := e.db.UpdateNodeRunOutput(ctx, nodeRunID, output); err != nil {
		return fmt.Errorf("save output: %w", err)
	}

	if err := e.db.UpdateNodeRunStatus(ctx, nodeRunID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	e.publishEvent(nodeRun.FlowRunID, nodeRunID, nodeRun.NodeID, "node.completed", map[string]any{
		"input_submitted": true,
	})

	// Record timeline (flowRun already fetched above)
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "human_input_submitted", map[string]any{
		"node_id":   nodeRun.NodeID,
		"node_name": ptrStr(nodeRun.NodeName),
		"message":   fmt.Sprintf("人工输入已提交：%s", ptrStr(nodeRun.NodeName)),
	})

	return e.advanceDAG(ctx, nodeRun.FlowRunID)
}

// HandleSkipNode skips a node by injecting previous flow's output and marking it completed
func (e *FlowExecutor) HandleSkipNode(ctx context.Context, nodeRunID, outputJSON string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("flow has been cancelled")
	}

	// Allow skipping nodes in pending, queued, or waiting_human status
	switch nodeRun.Status {
	case db.StatusPending, db.StatusQueued, db.StatusWaitingHuman:
		// OK
	default:
		return fmt.Errorf("cannot skip node in status: %s", nodeRun.Status)
	}

	// Verify all upstream dependencies are completed before allowing skip
	dag, err := e.getDAG(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("load DAG: %w", err)
	}
	completedNodes, err := e.db.GetCompletedNodeIDs(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get completed nodes: %w", err)
	}
	for _, depID := range dag.GetDependencies(nodeRun.NodeID) {
		if !completedNodes[depID] {
			return fmt.Errorf("上游节点 %s 尚未完成，无法跳过当前节点", depID)
		}
	}

	if err := e.db.UpdateNodeRunOutputRaw(ctx, nodeRunID, outputJSON); err != nil {
		return fmt.Errorf("save output: %w", err)
	}

	if err := e.db.UpdateNodeRunStatus(ctx, nodeRunID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	e.publishEvent(nodeRun.FlowRunID, nodeRunID, nodeRun.NodeID, "node.completed", map[string]any{
		"skipped": true,
	})

	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "node_skipped", map[string]any{
		"node_id":   nodeRun.NodeID,
		"node_name": ptrStr(nodeRun.NodeName),
		"message":   fmt.Sprintf("复用历史产物跳过节点：%s", ptrStr(nodeRun.NodeName)),
	})

	// Write artifact to git if node has file_path configured
	nodeDef, defErr := e.getNodeDef(flowRun, nodeRun.NodeID)
	if defErr == nil && nodeDef.Config != nil && nodeDef.Config.Artifact != nil && nodeDef.Config.Artifact.FilePath != "" {
		var output map[string]any
		if err := json.Unmarshal([]byte(outputJSON), &output); err == nil {
			content := extractArtifactContent(nodeDef.Config.Artifact.Type, output)
			if content != "" {
				runtimeCtx := e.buildRuntimeContext(ctx, flowRun, nodeRun)
				filePath := nodeDef.Config.Artifact.FilePath
				if rendered, renderErr := RenderTemplate(filePath, runtimeCtx); renderErr == nil && rendered != "" {
					filePath = rendered
				}
				e.writeSkippedArtifactToGit(ctx, flowRun, nodeRun, filePath, content, nodeDef.Config.Artifact.Type)
			}
		}
	}

	return e.advanceDAG(ctx, nodeRun.FlowRunID)
}

// HandleRetry retries a failed node
func (e *FlowExecutor) HandleRetry(ctx context.Context, nodeRunID string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	if nodeRun.Status != db.StatusFailed {
		return fmt.Errorf("can only retry failed nodes, current status: %s", nodeRun.Status)
	}

	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}

	_, dag, err := ParseDSL(*flowRun.DslSnapshot)
	if err != nil {
		return fmt.Errorf("parse DSL: %w", err)
	}

	nodeDef := dag.GetNode(nodeRun.NodeID)
	if nodeDef == nil {
		return fmt.Errorf("node %s not found in DAG", nodeRun.NodeID)
	}

	// Extract config from DSL for frontend use
	var configJSON *string
	if nodeDef.Config != nil {
		configMap := map[string]any{
			"artifact_scope": nodeDef.Config.ArtifactScope,
			"mode":           nodeDef.Config.Mode,
			"transient":      nodeDef.Config.Transient,
			"editable":       nodeDef.Config.Editable,
		}
		if b, err := json.Marshal(configMap); err == nil {
			s := string(b)
			configJSON = &s
		}
	}

	// Create new QUEUED node run
	newNodeRun := &db.NodeRun{
		ID:        uuid.New().String(),
		FlowRunID: nodeRun.FlowRunID,
		NodeID:    nodeRun.NodeID,
		NodeType:  nodeRun.NodeType,
		NodeName:  nodeRun.NodeName,
		Status:    db.StatusQueued,
		Attempt:   nodeRun.Attempt + 1,
		Input:     nodeRun.Input,
		Config:    configJSON,
		CreatedAt: time.Now(),
	}

	if err := e.db.CreateNodeRun(ctx, newNodeRun); err != nil {
		return fmt.Errorf("create retry node run: %w", err)
	}

	// Reset flow status to running if it was failed
	if flowRun.Status == db.StatusFailed {
		if err := e.db.UpdateFlowRunStatus(ctx, flowRun.ID, db.StatusRunning); err != nil {
			return fmt.Errorf("update flow status: %w", err)
		}
	}

	e.publishEvent(nodeRun.FlowRunID, newNodeRun.ID, nodeRun.NodeID, "node.queued", map[string]any{
		"retry":  true,
		"attempt": newNodeRun.Attempt,
	})

	return nil
}

// ─── Internal Helpers ───

// resetIntermediateNodes re-creates PENDING node runs for nodes between target and current
func (e *FlowExecutor) resetIntermediateNodes(ctx context.Context, flowRun *db.FlowRun, dag *DAG, targetNodeID, currentNodeID string) {
	// For linear flows: find nodes between target and current, create new PENDING runs
	// Walk from target's successors to current
	visited := make(map[string]bool)
	e.walkAndReset(ctx, flowRun, dag, targetNodeID, currentNodeID, visited)
}

func (e *FlowExecutor) walkAndReset(ctx context.Context, flowRun *db.FlowRun, dag *DAG, fromNodeID, untilNodeID string, visited map[string]bool) {
	successors := dag.GetSuccessors(fromNodeID)
	for _, succID := range successors {
		if visited[succID] {
			continue
		}
		visited[succID] = true

		succDef := dag.GetNode(succID)
		if succDef == nil {
			continue
		}

		// Query existing max attempt to increment properly
		existing, err := e.db.GetNodeRunByFlowAndNode(ctx, flowRun.ID, succID)
		if err != nil {
			e.logger.Warnw("Failed to get latest node run for intermediate reset", "node_id", succID, "error", err)
		}
		attempt := 1
		if existing != nil {
			attempt = existing.Attempt + 1
		}

		// Extract config from DSL for frontend use
		var configJSON *string
		if succDef.Config != nil {
			configMap := map[string]any{
				"artifact_scope": succDef.Config.ArtifactScope,
				"mode":           succDef.Config.Mode,
				"transient":      succDef.Config.Transient,
				"editable":       succDef.Config.Editable,
			}
			if b, err := json.Marshal(configMap); err == nil {
				s := string(b)
				configJSON = &s
			}
		}

		// Create a new PENDING node run for this node (including the rejected node itself)
		nr := &db.NodeRun{
			ID:        uuid.New().String(),
			FlowRunID: flowRun.ID,
			NodeID:    succID,
			NodeType:  strPtr(succDef.Type),
			NodeName:  strPtr(succDef.Name),
			Status:    db.StatusPending,
			Attempt:   attempt,
			Config:    configJSON,
			CreatedAt: time.Now(),
		}

		if err := e.db.CreateNodeRun(ctx, nr); err != nil {
			e.logger.Warnw("Failed to create intermediate node run", "node_id", succID, "error", err)
		}

		// Don't recurse past the rejected node — only reset nodes between target and current
		if succID != untilNodeID {
			e.walkAndReset(ctx, flowRun, dag, succID, untilNodeID, visited)
		}
	}
}

// HandleRerun re-executes a completed agent_task node and resets all successor nodes
func (e *FlowExecutor) HandleRerun(ctx context.Context, nodeRunID string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	if nodeRun.Status != db.StatusCompleted {
		return fmt.Errorf("can only rerun completed nodes, current status: %s", nodeRun.Status)
	}

	// Lock per-flow DAG mutex to prevent concurrent rerun/advance races
	mu := e.getDAGMutex(nodeRun.FlowRunID)
	mu.Lock()
	defer mu.Unlock()

	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}
	if flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("flow has been cancelled")
	}
	if flowRun.Status == db.StatusCompleted {
		return fmt.Errorf("cannot rerun nodes in completed flow")
	}

	if flowRun.DslSnapshot == nil {
		return fmt.Errorf("flow run %s has no DSL snapshot", flowRun.ID)
	}

	_, dag, err := ParseDSL(*flowRun.DslSnapshot)
	if err != nil {
		return fmt.Errorf("parse DSL: %w", err)
	}

	// Check for active nodes — disallow rerun if any non-successor node is active
	// Successor nodes will be reset during rerun, so they should not block the operation
	successorSet := collectAllSuccessors(dag, nodeRun.NodeID)
	activeNodes, err := e.db.GetActiveNodeRuns(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("check active nodes: %w", err)
	}
	conflictingActive := 0
	for _, an := range activeNodes {
		if !successorSet[an.NodeID] {
			conflictingActive++
		}
	}
	if conflictingActive > 0 {
		return fmt.Errorf("cannot rerun: flow has %d active non-successor node(s), wait for them to complete first", conflictingActive)
	}

	nodeDef := dag.GetNode(nodeRun.NodeID)
	if nodeDef == nil {
		return fmt.Errorf("node %s not found in DAG", nodeRun.NodeID)
	}

	// Use the latest attempt for this node (not the passed nodeRunId's attempt)
	latestNodeRun, err := e.db.GetNodeRunByFlowAndNode(ctx, nodeRun.FlowRunID, nodeRun.NodeID)
	if err != nil {
		return fmt.Errorf("get latest node run: %w", err)
	}
	// Verify this is the latest attempt for the node
	if latestNodeRun != nil && latestNodeRun.ID != nodeRunID {
		return fmt.Errorf("can only rerun the latest attempt, got attempt %d but latest is %d", nodeRun.Attempt, latestNodeRun.Attempt)
	}
	newAttempt := 1
	if latestNodeRun != nil {
		newAttempt = latestNodeRun.Attempt + 1
	}

	// 1. Create new QUEUED node run for the target node
	newNodeRun := &db.NodeRun{
		ID:        uuid.New().String(),
		FlowRunID: nodeRun.FlowRunID,
		NodeID:    nodeRun.NodeID,
		NodeType:  nodeRun.NodeType,
		NodeName:  nodeRun.NodeName,
		Status:    db.StatusQueued,
		Attempt:   newAttempt,
		Input:     nodeRun.Input,
		Config:    nodeRun.Config,
		CreatedAt: time.Now(),
	}

	if err := e.db.CreateNodeRun(ctx, newNodeRun); err != nil {
		return fmt.Errorf("create rerun node run: %w", err)
	}

	// 2. Reset all successor nodes to PENDING
	if err := e.resetSuccessorNodes(ctx, flowRun, dag, nodeRun.NodeID); err != nil {
		e.logger.Errorw("Rerun partially failed: target node created but successor reset failed",
			"flow_run_id", flowRun.ID, "new_node_run_id", newNodeRun.ID, "error", err)
		return fmt.Errorf("reset successor nodes (target node already created): %w", err)
	}

	// 3. Update flow status to running last (triggers scheduler pickup)
	if flowRun.Status != db.StatusRunning {
		if err := e.db.UpdateFlowRunStatus(ctx, flowRun.ID, db.StatusRunning); err != nil {
			e.logger.Errorw("Rerun partially failed: nodes created but flow status update failed",
				"flow_run_id", flowRun.ID, "new_node_run_id", newNodeRun.ID, "error", err)
			return fmt.Errorf("update flow status (nodes already created): %w", err)
		}
	}

	// 4. Publish event
	e.publishEvent(nodeRun.FlowRunID, newNodeRun.ID, nodeRun.NodeID, "node.queued", map[string]any{
		"rerun":   true,
		"attempt": newNodeRun.Attempt,
	})

	// 5. Record timeline
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, newNodeRun.ID, "node_rerun", map[string]any{
		"node_id":   nodeRun.NodeID,
		"node_name": ptrStr(nodeRun.NodeName),
		"attempt":   newNodeRun.Attempt,
		"message":   fmt.Sprintf("重跑节点：%s（第 %d 次）", ptrStr(nodeRun.NodeName), newNodeRun.Attempt),
	})

	e.logger.Infow("Rerunning completed node",
		"node_id", nodeRun.NodeID,
		"node_run_id", newNodeRun.ID,
		"attempt", newNodeRun.Attempt,
	)

	return nil
}

// collectAllSuccessors recursively collects all downstream node IDs from the given node
func collectAllSuccessors(dag *DAG, nodeID string) map[string]bool {
	result := make(map[string]bool)
	var walk func(id string)
	walk = func(id string) {
		for _, succID := range dag.GetSuccessors(id) {
			if !result[succID] {
				result[succID] = true
				walk(succID)
			}
		}
	}
	walk(nodeID)
	return result
}

// resetSuccessorNodes creates new PENDING node runs for all nodes downstream of the given node
func (e *FlowExecutor) resetSuccessorNodes(ctx context.Context, flowRun *db.FlowRun, dag *DAG, fromNodeID string) error {
	visited := make(map[string]bool)
	return e.walkAndResetAll(ctx, flowRun, dag, fromNodeID, visited)
}

func (e *FlowExecutor) walkAndResetAll(ctx context.Context, flowRun *db.FlowRun, dag *DAG, fromNodeID string, visited map[string]bool) error {
	successors := dag.GetSuccessors(fromNodeID)
	for _, succID := range successors {
		if visited[succID] {
			continue
		}
		visited[succID] = true

		succDef := dag.GetNode(succID)
		if succDef == nil {
			continue
		}

		// Query existing max attempt to increment properly
		existing, err := e.db.GetNodeRunByFlowAndNode(ctx, flowRun.ID, succID)
		if err != nil {
			return fmt.Errorf("get latest node run for %s: %w", succID, err)
		}
		attempt := 1
		if existing != nil {
			attempt = existing.Attempt + 1
		}

		// Extract config from DSL for frontend use
		var configJSON *string
		if succDef.Config != nil {
			configMap := map[string]any{
				"artifact_scope": succDef.Config.ArtifactScope,
				"mode":           succDef.Config.Mode,
				"transient":      succDef.Config.Transient,
				"editable":       succDef.Config.Editable,
			}
			if b, err := json.Marshal(configMap); err == nil {
				s := string(b)
				configJSON = &s
			}
		}

		// Create a new PENDING node run
		nr := &db.NodeRun{
			ID:        uuid.New().String(),
			FlowRunID: flowRun.ID,
			NodeID:    succID,
			NodeType:  strPtr(succDef.Type),
			NodeName:  strPtr(succDef.Name),
			Status:    db.StatusPending,
			Attempt:   attempt,
			Config:    configJSON,
			CreatedAt: time.Now(),
		}

		if err := e.db.CreateNodeRun(ctx, nr); err != nil {
			return fmt.Errorf("create successor node run for %s: %w", succID, err)
		}

		// Continue walking to the end of the DAG
		if err := e.walkAndResetAll(ctx, flowRun, dag, succID, visited); err != nil {
			return err
		}
	}
	return nil
}

// recordTimeline creates a timeline event
func (e *FlowExecutor) recordTimeline(ctx context.Context, taskID, flowRunID, nodeRunID, eventType string, content map[string]any) {
	contentJSON, _ := json.Marshal(content)

	evt := &db.TimelineEvent{
		ID:        uuid.New().String(),
		TaskID:    taskID,
		EventType: eventType,
		Content:   string(contentJSON),
		CreatedAt: time.Now(),
	}

	if flowRunID != "" {
		evt.FlowRunID = &flowRunID
	}
	if nodeRunID != "" {
		evt.NodeRunID = &nodeRunID
	}

	if err := e.db.CreateTimelineEvent(ctx, evt); err != nil {
		e.logger.Warnw("Failed to create timeline event", "error", err)
	}
}

// writeSkippedArtifactToGit writes artifact content to git when a node is skipped (reused).
// Creates a temporary worktree, writes the file, commits, integrates, and pushes.
func (e *FlowExecutor) writeSkippedArtifactToGit(ctx context.Context, flowRun *db.FlowRun, nodeRun *db.NodeRun, filePath, content, artifactType string) {
	if e.repoManager == nil || flowRun.ProjectID == nil || *flowRun.ProjectID == "" {
		e.logger.Debugw("Skipping git write for skipped artifact: no repo manager or project", "node_id", nodeRun.NodeID)
		return
	}

	projectID := *flowRun.ProjectID

	gitRepoURL, _, gitAccessToken, _, _, _, _, _, err := e.db.GetTaskGitInfoFull(ctx, flowRun.TaskID)
	if err != nil || gitRepoURL == "" {
		e.logger.Warnw("Cannot write skipped artifact to git: no git info", "error", err)
		return
	}

	// Ensure bare repo
	if _, err := e.repoManager.EnsureBareRepo(ctx, projectID, gitRepoURL, gitAccessToken); err != nil {
		e.logger.Warnw("EnsureBareRepo failed for skipped artifact", "error", err)
		return
	}

	// Ensure flow integration ref
	integrationRef, integrationHeadSHA, err := e.repoManager.EnsureFlowIntegration(ctx, projectID, flowRun.ID, "main", "main")
	if err != nil {
		e.logger.Warnw("EnsureFlowIntegration failed for skipped artifact", "error", err)
		return
	}

	// Create temp worktree
	worktreePath, err := e.repoManager.EnsureNodeWorktree(ctx, projectID, flowRun.ID, nodeRun.ID, integrationHeadSHA)
	if err != nil {
		e.logger.Warnw("EnsureNodeWorktree failed for skipped artifact", "error", err)
		return
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = e.repoManager.CleanupNodeWorktree(cleanupCtx, projectID, flowRun.ID, nodeRun.ID)
	}()

	// Write file and commit
	commitSHA, err := writeArtifactToGit(ctx, worktreePath, filePath, content, artifactType)
	if err != nil {
		e.logger.Warnw("Failed to write skipped artifact to git", "error", err, "file_path", filePath)
		return
	}

	// Integrate commit
	newHeadSHA, err := e.repoManager.IntegrateNodeCommit(ctx, projectID, flowRun.ID, nodeRun.ID, commitSHA)
	if err != nil {
		e.logger.Warnw("Failed to integrate skipped artifact commit", "error", err)
		return
	}

	// Update flow integration head
	if err := e.db.UpdateFlowRunIntegration(ctx, flowRun.ID, integrationRef, newHeadSHA); err != nil {
		e.logger.Warnw("Failed to update flow integration head", "error", err)
	}

	// Push
	gitBranch := "main"
	if taskURL, taskBranch, _ := e.db.GetTaskGitInfo(ctx, flowRun.TaskID); taskURL != "" && taskBranch != "" {
		gitBranch = taskBranch
	}
	if err := e.repoManager.PushIntegration(ctx, projectID, flowRun.ID, gitRepoURL, gitAccessToken, gitBranch); err != nil {
		e.logger.Warnw("Failed to push skipped artifact", "error", err)
		return
	}

	e.logger.Infow("Wrote skipped artifact to git", "file_path", filePath, "commit", commitSHA, "node_id", nodeRun.NodeID)
}

// asyncCleanupFlowRepoState asynchronously cleans up git repo cache state for a completed/failed/cancelled flow.
func (e *FlowExecutor) asyncCleanupFlowRepoState(flowRunID string) {
	if e.repoManager == nil {
		return
	}

	go func() {
		// Retry cleanup with exponential backoff to avoid race with container shutdown
		maxRetries := 3
		for attempt := 1; attempt <= maxRetries; attempt++ {
			if attempt > 1 {
				time.Sleep(time.Duration(attempt*10) * time.Second)
			}

			cleanupCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)

			flowRun, err := e.db.GetFlowRun(cleanupCtx, flowRunID)
			if err != nil {
				e.logger.Warnw("Failed to get flow run for repo cleanup", "error", err, "flow_run_id", flowRunID, "attempt", attempt)
				cancel()
				continue
			}

			if flowRun.ProjectID == nil || *flowRun.ProjectID == "" {
				cancel()
				return
			}

			if err := e.repoManager.CleanupFlowState(cleanupCtx, *flowRun.ProjectID, flowRunID); err != nil {
				e.logger.Warnw("Failed to cleanup flow repo state", "error", err, "flow_run_id", flowRunID, "attempt", attempt)
				cancel()
				if attempt < maxRetries {
					continue
				}
			} else {
				cancel()
				return
			}
			cancel()
		}
	}()
}

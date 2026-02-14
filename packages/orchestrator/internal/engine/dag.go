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

// advanceDAG checks and activates downstream nodes after a node completes
func (e *FlowExecutor) advanceDAG(ctx context.Context, flowRunID string) error {
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

			// Update input if resolved
			if input != nil {
				inputJSON := jsonStr(input)
				if err := e.db.UpdateNodeRunInput(ctx, pending.ID, inputJSON); err != nil {
					e.logger.Warnw("Failed to update node input", "node_id", pending.NodeID, "error", err)
				}
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

	// 5. Check if flow is complete
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
		}

		e.logger.Infow("Flow completed", "flow_run_id", flowRunID)
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

		nr := &db.NodeRun{
			ID:        uuid.New().String(),
			FlowRunID: flowRunID,
			NodeID:    node.ID,
			NodeType:  strPtr(node.Type),
			NodeName:  strPtr(node.Name),
			Status:    status,
			Attempt:   1,
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

	return nil
}

// CancelFlow cancels a running flow and all its pending/queued nodes
func (e *FlowExecutor) CancelFlow(ctx context.Context, flowRunID string) error {
	flowRun, err := e.db.GetFlowRun(ctx, flowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}

	if flowRun.Status == db.StatusCompleted || flowRun.Status == db.StatusCancelled {
		return fmt.Errorf("cannot cancel flow in status: %s", flowRun.Status)
	}

	// Cancel all pending/queued nodes
	if err := e.db.CancelPendingNodeRuns(ctx, flowRunID); err != nil {
		return fmt.Errorf("cancel pending nodes: %w", err)
	}

	// Update flow status
	if err := e.db.UpdateFlowRunStatus(ctx, flowRunID, db.StatusCancelled); err != nil {
		return fmt.Errorf("update flow status: %w", err)
	}

	e.publishEvent(flowRunID, "", "", "flow.cancelled", nil)

	e.recordTimeline(ctx, flowRun.TaskID, flowRunID, "", "flow_cancelled", map[string]any{
		"message": "流程已取消",
	})

	return nil
}

// ─── Human Actions ───

// HandleApprove processes an approve action on a human_review node
func (e *FlowExecutor) HandleApprove(ctx context.Context, nodeRunID string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
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

	// Record timeline
	flowRun, _ := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if flowRun != nil {
		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "review_approved", map[string]any{
			"node_id":   nodeRun.NodeID,
			"node_name": ptrStr(nodeRun.NodeName),
			"message":   fmt.Sprintf("审核通过：%s", ptrStr(nodeRun.NodeName)),
		})
	}

	// Advance DAG
	return e.advanceDAG(ctx, nodeRun.FlowRunID)
}

// HandleReject processes a reject action — rolls back to the target node
func (e *FlowExecutor) HandleReject(ctx context.Context, nodeRunID, feedback string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
	}

	if nodeRun.Status != db.StatusWaitingHuman {
		return fmt.Errorf("node is not waiting for human action, current status: %s", nodeRun.Status)
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

	// Find the target node to roll back to
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("get flow run: %w", err)
	}

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

	// Check max_loops
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
		CreatedAt: time.Now(),
	}

	if err := e.db.CreateNodeRun(ctx, newNodeRun); err != nil {
		return fmt.Errorf("create rollback node run: %w", err)
	}

	// Also reset nodes between target and current (mark them as needing re-execution)
	// For linear flows, we need to re-create PENDING nodes for nodes between target and current
	e.resetIntermediateNodes(ctx, flowRun, dag, targetNodeID, nodeRun.NodeID)

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

	// Record timeline
	flowRun, _ := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if flowRun != nil {
		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "review_edited", map[string]any{
			"node_id":        nodeRun.NodeID,
			"node_name":      ptrStr(nodeRun.NodeName),
			"change_summary": changeSummary,
			"message":        fmt.Sprintf("编辑后通过：%s", ptrStr(nodeRun.NodeName)),
		})
	}

	return e.advanceDAG(ctx, nodeRun.FlowRunID)
}

// HandleHumanInput processes submitted human input
func (e *FlowExecutor) HandleHumanInput(ctx context.Context, nodeRunID, dataJSON string) error {
	nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
	if err != nil {
		return fmt.Errorf("get node run: %w", err)
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

	// Record timeline
	flowRun, _ := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if flowRun != nil {
		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRunID, "human_input_submitted", map[string]any{
			"node_id":   nodeRun.NodeID,
			"node_name": ptrStr(nodeRun.NodeName),
			"message":   fmt.Sprintf("人工输入已提交：%s", ptrStr(nodeRun.NodeName)),
		})
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
		existing, _ := e.db.GetNodeRunByFlowAndNode(ctx, flowRun.ID, succID)
		attempt := 1
		if existing != nil {
			attempt = existing.Attempt + 1
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

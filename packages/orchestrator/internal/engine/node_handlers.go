package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/sunshow/workgear/orchestrator/internal/agent"
	"github.com/sunshow/workgear/orchestrator/internal/db"
)

// ─── agent_task ───

func (e *FlowExecutor) executeAgentTask(ctx context.Context, nodeRun *db.NodeRun) error {
	// 1. Load DAG to get node config
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("load flow run: %w", err)
	}

	nodeDef, err := e.getNodeDef(flowRun, nodeRun.NodeID)
	if err != nil {
		return err
	}

	// 2. Build runtime template context
	runtimeCtx := e.buildRuntimeContext(ctx, flowRun, nodeRun)

	// 3. Resolve agent role (may contain template vars, render it)
	role := "general-developer"
	if nodeDef.Agent != nil && nodeDef.Agent.Role != "" {
		role = nodeDef.Agent.Role
		// Render role in case it contains template variables
		if rendered, err := RenderTemplate(role, runtimeCtx); err == nil {
			role = rendered
		}
	}

	// 4. Get adapter from registry
	adapter, err := e.registry.GetAdapter(role)
	if err != nil {
		return fmt.Errorf("get agent adapter: %w", err)
	}

	// 5. Build agent request
	mode := "execute"
	prompt := ""
	if nodeDef.Config != nil {
		if nodeDef.Config.Mode != "" {
			mode = nodeDef.Config.Mode
		}
		// Render prompt_template with runtime context
		if nodeDef.Config.PromptTemplate != "" {
			rendered, err := RenderTemplate(nodeDef.Config.PromptTemplate, runtimeCtx)
			if err != nil {
				e.logger.Warnw("Failed to render prompt template", "error", err)
				prompt = nodeDef.Config.PromptTemplate // fallback to original
			} else {
				prompt = rendered
			}
		}
	}

	// Parse input context
	var inputCtx map[string]any
	if nodeRun.Input != nil {
		_ = json.Unmarshal([]byte(*nodeRun.Input), &inputCtx)
	}
	if inputCtx == nil {
		inputCtx = make(map[string]any)
	}

	// Get git information from task (full version with access token and title)
	gitRepoURL, gitBranch, gitAccessToken, taskTitle, err := e.db.GetTaskGitInfoFull(ctx, flowRun.TaskID)
	if err != nil {
		e.logger.Warnw("Failed to get git info", "error", err)
	}

	// Extract feedback from context (for reject/retry scenarios)
	feedback := ""
	if fb, ok := inputCtx["_feedback"]; ok {
		if fbStr, ok := fb.(string); ok {
			feedback = fbStr
		}
	}

	// Store role in context for prompt builder
	inputCtx["_role"] = role

	agentReq := &agent.AgentRequest{
		TaskID:         nodeRun.ID,
		FlowRunID:     nodeRun.FlowRunID,
		NodeID:         nodeRun.NodeID,
		Mode:           mode,
		Prompt:         prompt,
		Context:        inputCtx,
		GitRepoURL:     gitRepoURL,
		GitBranch:      gitBranch,
		GitAccessToken: gitAccessToken,
		TaskTitle:      taskTitle,
		NodeName:       ptrStr(nodeRun.NodeName),
		Feedback:       feedback,
	}

	// Resolve OpenSpec config for opsx_plan / opsx_apply modes
	if nodeDef.Config != nil && nodeDef.Config.Opsx != nil {
		opsxDef := nodeDef.Config.Opsx
		changeName := opsxDef.ChangeName
		// Render change_name template expression
		if rendered, err := RenderTemplate(changeName, runtimeCtx); err == nil {
			changeName = rendered
		}
		agentReq.OpsxConfig = &agent.OpsxConfig{
			ChangeName:    changeName,
			Schema:        opsxDef.Schema,
			InitIfMissing: opsxDef.InitIfMissing,
			Action:        opsxDef.Action,
		}
	}

	// 5. Execute
	e.logger.Infow("Executing agent task",
		"node_id", nodeRun.NodeID,
		"role", role,
		"mode", mode,
		"adapter", adapter.Name(),
		"git_repo", gitRepoURL,
		"git_branch", gitBranch,
	)

	resp, err := adapter.Execute(ctx, agentReq)
	if err != nil {
		return fmt.Errorf("agent execution failed: %w", err)
	}

	// 6. Save output and mark completed
	if err := e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, resp.Output); err != nil {
		return fmt.Errorf("save output: %w", err)
	}
	if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	// 7. Publish completion event
	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.completed", map[string]any{
		"output": resp.Output,
	})

	// 8. Record timeline event
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "agent_completed", map[string]any{
		"node_id":   nodeRun.NodeID,
		"node_name": ptrStr(nodeRun.NodeName),
		"mode":      mode,
		"role":      role,
		"output":    resp.Output,
	})

	return nil
}

// ─── human_review ───

func (e *FlowExecutor) executeHumanReview(ctx context.Context, nodeRun *db.NodeRun) error {
	// Human review: set status to WAITING_HUMAN and return immediately
	// The worker is released — no goroutine blocked
	// Human action will be submitted via gRPC (ApproveNode / RejectNode / EditNode)

	if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusWaitingHuman); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	// Build review context from upstream node output
	var reviewData map[string]any
	if nodeRun.Input != nil {
		_ = json.Unmarshal([]byte(*nodeRun.Input), &reviewData)
	}

	// Publish waiting_human event
	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.waiting_human", map[string]any{
		"review_target": reviewData,
		"node_name":     ptrStr(nodeRun.NodeName),
	})

	// Record timeline
	flowRun, _ := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if flowRun != nil {
		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "waiting_review", map[string]any{
			"node_id":   nodeRun.NodeID,
			"node_name": ptrStr(nodeRun.NodeName),
			"message":   fmt.Sprintf("等待人工审核：%s", ptrStr(nodeRun.NodeName)),
		})
	}

	return nil
}

// ─── human_input ───

func (e *FlowExecutor) executeHumanInput(ctx context.Context, nodeRun *db.NodeRun) error {
	// Human input: set status to WAITING_HUMAN and return immediately
	// Human will submit data via gRPC (SubmitHumanInput)

	if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusWaitingHuman); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	// Get form config from DSL
	flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
	if err != nil {
		return fmt.Errorf("load flow run: %w", err)
	}

	nodeDef, _ := e.getNodeDef(flowRun, nodeRun.NodeID)
	var formFields []FormFieldDef
	if nodeDef != nil && nodeDef.Config != nil {
		formFields = nodeDef.Config.Form
	}

	// Publish waiting_human event with form definition
	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.waiting_human", map[string]any{
		"node_name": ptrStr(nodeRun.NodeName),
		"form":      formFields,
		"input_type": "human_input",
	})

	// Record timeline
	if flowRun != nil {
		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "waiting_input", map[string]any{
			"node_id":   nodeRun.NodeID,
			"node_name": ptrStr(nodeRun.NodeName),
			"message":   fmt.Sprintf("等待人工输入：%s", ptrStr(nodeRun.NodeName)),
		})
	}

	return nil
}

// ─── Helpers ───

// getNodeDef loads the DAG from the flow run's DSL snapshot and returns the node definition
func (e *FlowExecutor) getNodeDef(flowRun *db.FlowRun, nodeID string) (*NodeDef, error) {
	if flowRun.DslSnapshot == nil {
		return nil, fmt.Errorf("flow run %s has no DSL snapshot", flowRun.ID)
	}

	_, dag, err := ParseDSL(*flowRun.DslSnapshot)
	if err != nil {
		return nil, fmt.Errorf("parse DSL: %w", err)
	}

	node := dag.GetNode(nodeID)
	if node == nil {
		return nil, fmt.Errorf("node %s not found in DAG", nodeID)
	}

	return node, nil
}

// getDAG loads and parses the DAG from a flow run
func (e *FlowExecutor) getDAG(ctx context.Context, flowRunID string) (*DAG, error) {
	flowRun, err := e.db.GetFlowRun(ctx, flowRunID)
	if err != nil {
		return nil, err
	}
	if flowRun.DslSnapshot == nil {
		return nil, fmt.Errorf("flow run %s has no DSL snapshot", flowRunID)
	}
	_, dag, err := ParseDSL(*flowRun.DslSnapshot)
	if err != nil {
		return nil, err
	}
	return dag, nil
}

// buildRuntimeContext constructs the pongo2 template context for runtime rendering.
// Includes: params, nodes (upstream outputs), review (feedback), task (id/title).
func (e *FlowExecutor) buildRuntimeContext(ctx context.Context, flowRun *db.FlowRun, nodeRun *db.NodeRun) map[string]any {
	runtimeCtx := make(map[string]any)

	// 1. params — restore from flow run variables
	if flowRun.Variables != nil {
		var vars map[string]string
		if err := json.Unmarshal([]byte(*flowRun.Variables), &vars); err == nil {
			runtimeCtx["params"] = vars
		}
	}
	if runtimeCtx["params"] == nil {
		runtimeCtx["params"] = map[string]string{}
	}

	// 2. nodes — collect all completed node outputs as {nodeID: {outputs: {...}}}
	nodeOutputs, err := e.db.GetAllNodeRunOutputs(ctx, flowRun.ID)
	if err != nil {
		e.logger.Warnw("Failed to get node outputs for template", "error", err)
		nodeOutputs = make(map[string]map[string]any)
	}
	// Wrap each node's output under "outputs" key to match {{nodes.xxx.outputs.yyy}} syntax
	nodesCtx := make(map[string]any)
	for nodeID, output := range nodeOutputs {
		nodesCtx[nodeID] = map[string]any{
			"outputs": output,
		}
	}
	runtimeCtx["nodes"] = nodesCtx

	// 3. review — extract feedback from node input context
	review := map[string]any{}
	if nodeRun.Input != nil {
		var input map[string]any
		if err := json.Unmarshal([]byte(*nodeRun.Input), &input); err == nil {
			if fb, ok := input["_feedback"]; ok {
				review["comment"] = fb
			}
		}
	}
	runtimeCtx["review"] = review

	// 4. task — basic info
	taskCtx := map[string]any{"id": flowRun.TaskID}
	if id, title, err := e.db.GetTaskBasicInfo(ctx, flowRun.TaskID); err == nil {
		taskCtx["id"] = id
		taskCtx["title"] = title
		// slug alias for backward compat with templates using task.slug
		taskCtx["slug"] = title
	}
	runtimeCtx["task"] = taskCtx

	return runtimeCtx
}

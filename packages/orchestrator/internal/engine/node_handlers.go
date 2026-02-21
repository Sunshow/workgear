package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

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

	// 4. Get adapter from registry (now returns model name too)
	adapter, registryModel, err := e.registry.GetAdapterForRole(role)
	if err != nil {
		return fmt.Errorf("get agent adapter: %w", err)
	}

	// 5. Get role config from database
	roleConfig, err := e.db.GetAgentRoleConfig(ctx, role)
	if err != nil {
		e.logger.Warnw("Failed to get role config from DB", "role", role, "error", err)
	}

	// 5a. Load skills associated with the role
	var skills []*db.Skill
	if roleConfig != nil && len(roleConfig.SkillIDs) > 0 {
		skills, err = e.db.GetSkillsByIDs(ctx, roleConfig.SkillIDs)
		if err != nil {
			e.logger.Warnw("Failed to load skills for role", "role", role, "error", err)
			skills = []*db.Skill{} // Continue without skills on error
			
			// Record timeline event to notify user of skill loading failure
			e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "skill_load_failed", map[string]any{
				"node_id":   nodeRun.NodeID,
				"node_name": ptrStr(nodeRun.NodeName),
				"role":      role,
				"error":     err.Error(),
				"message":   fmt.Sprintf("无法加载角色 %s 的技能配置，将继续执行但可能影响结果", role),
			})
		} else {
			e.logger.Infow("Loaded skills for role", "role", role, "skill_count", len(skills))
		}
	}

	// 6. Determine model: DSL explicit config > registry mapping > adapter default
	model := ""
	if nodeDef.Agent != nil && nodeDef.Agent.Model != "" {
		model = nodeDef.Agent.Model
		// Render model in case it contains template variables
		if rendered, err := RenderTemplate(model, runtimeCtx); err == nil {
			model = rendered
		}
	}
	if model == "" && registryModel != "" {
		model = registryModel
	}

	// 7. Use system prompt from database (overrides hardcoded prompt)
	rolePrompt := ""
	if roleConfig != nil {
		rolePrompt = roleConfig.SystemPrompt
	}

	// 8. Build agent request
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
	gitRepoURL, gitBranch, gitAccessToken, taskTitle, gitProviderType, gitBaseUrl, gitUsername, gitPassword, err := e.db.GetTaskGitInfoFull(ctx, flowRun.TaskID)
	if err != nil {
		e.logger.Warnw("Failed to get git info", "error", err)
	}

	// ─── Git repo cache: prepare worktree ───
	var worktreePath, depsPath, baseSHA string
	var integrationRef, integrationHeadSHA string
	useRepoCache := e.repoManager != nil && gitRepoURL != "" && flowRun.ProjectID != nil && *flowRun.ProjectID != ""

	var projectID string
	if useRepoCache {
		projectID = *flowRun.ProjectID

		// 1. Ensure bare repo exists and is up-to-date
		if _, err := e.repoManager.EnsureBareRepo(ctx, projectID, gitRepoURL, gitAccessToken); err != nil {
			e.logger.Warnw("EnsureBareRepo failed, falling back to clone mode",
				"error", err, "project_id", projectID)
			useRepoCache = false
		}

		if useRepoCache {
			// 2. Ensure flow integration ref
			featureBranch := gitBranch
			if featureBranch == "" {
				featureBranch = "main"
			}
			integrationRef, integrationHeadSHA, err = e.repoManager.EnsureFlowIntegration(
				ctx, projectID, flowRun.ID, "main", featureBranch)
			if err != nil {
				e.logger.Warnw("EnsureFlowIntegration failed, falling back to clone mode",
					"error", err, "flow_run_id", flowRun.ID)
				useRepoCache = false
			}
		}

		if useRepoCache {
			baseSHA = integrationHeadSHA

			// 3. Create node worktree
			worktreePath, err = e.repoManager.EnsureNodeWorktree(
				ctx, projectID, flowRun.ID, nodeRun.ID, baseSHA)
			if err != nil {
				e.logger.Warnw("EnsureNodeWorktree failed, falling back to clone mode",
					"error", err, "node_run_id", nodeRun.ID)
				useRepoCache = false
			} else {
				depsPath = e.repoManager.GetDepsPath(projectID)

				// Persist git state to DB
				if dbErr := e.db.UpdateNodeRunGitState(ctx, nodeRun.ID, baseSHA, "", worktreePath); dbErr != nil {
					e.logger.Warnw("Failed to save node git state", "error", dbErr)
				}
				if dbErr := e.db.UpdateFlowRunIntegration(ctx, flowRun.ID, integrationRef, integrationHeadSHA); dbErr != nil {
					e.logger.Warnw("Failed to save flow integration state", "error", dbErr)
				}
			}
		}
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

	// Parse timeout from DSL: priority nodeDef.Timeout > nodeDef.Config.Timeout
	timeoutStr := ""
	if nodeDef.Timeout != "" {
		timeoutStr = nodeDef.Timeout
	} else if nodeDef.Config != nil && nodeDef.Config.Timeout != "" {
		timeoutStr = nodeDef.Config.Timeout
	}

	var timeout time.Duration
	if timeoutStr != "" {
		parsed, err := time.ParseDuration(timeoutStr)
		if err != nil {
			e.logger.Warnw("Invalid timeout format in DSL, using default", "timeout", timeoutStr, "error", err)
		} else {
			timeout = parsed
		}
	}

	agentReq := &agent.AgentRequest{
		TaskID:          nodeRun.ID,
		FlowRunID:       nodeRun.FlowRunID,
		NodeID:          nodeRun.NodeID,
		Mode:            mode,
		Prompt:          prompt,
		Context:         inputCtx,
		GitRepoURL:      gitRepoURL,
		GitBranch:       gitBranch,
		GitAccessToken:  gitAccessToken,
		GitProviderType: gitProviderType,
		GitBaseUrl:      gitBaseUrl,
		GitUsername:     gitUsername,
		GitPassword:     gitPassword,
		TaskTitle:       taskTitle,
		NodeName:        ptrStr(nodeRun.NodeName),
		RolePrompt:      rolePrompt,
		Feedback:        feedback,
		Model:           model,
		Timeout:         timeout,
		Skills:          skills,
		WorktreePath:    worktreePath,
		DepsPath:        depsPath,
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
		"model", model,
		"adapter", adapter.Name(),
		"git_repo", gitRepoURL,
		"git_branch", gitBranch,
	)

	// 5a. Build real-time log streaming callback (per-execution, thread-safe)
	var logEvents []map[string]any
	var logMutex sync.Mutex

	// Text buffer for merging consecutive assistant text blocks
	var textBuffer strings.Builder
	var textBufferTimestamp int64

	flushTextBuffer := func() {
		if textBuffer.Len() == 0 {
			return
		}
		flatEvent := map[string]any{
			"type":      "assistant",
			"content":   textBuffer.String(),
			"timestamp": textBufferTimestamp,
		}
		e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.log_stream", flatEvent)
		logMutex.Lock()
		logEvents = append(logEvents, flatEvent)
		logMutex.Unlock()
		textBuffer.Reset()
		textBufferTimestamp = 0
	}

	logCallback := agent.LogEventCallback(func(event agent.ClaudeStreamEvent) {
		// Skip system/init events
		if event.Type == "system" {
			return
		}

		// Flatten nested structure into frontend-friendly events
		if event.Message != nil {
			for _, block := range event.Message.Content {
				switch block.Type {
				case "text":
					// Accumulate text blocks into buffer
					if textBuffer.Len() == 0 {
						textBufferTimestamp = event.Timestamp
					}
					textBuffer.WriteString(block.Text)
					
				case "tool_use":
					// Flush text buffer before tool_use
					flushTextBuffer()
					
					flatEvent := map[string]any{
						"type":       "tool_use",
						"tool_name":  block.Name,
						"tool_input": block.Input,
						"timestamp":  event.Timestamp,
					}
					e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.log_stream", flatEvent)
					logMutex.Lock()
					logEvents = append(logEvents, flatEvent)
					logMutex.Unlock()
					
				case "tool_result":
					// Flush text buffer before tool_result
					flushTextBuffer()
					
					flatEvent := map[string]any{
						"type":        "tool_result",
						"content":     fmt.Sprintf("%v", block.Content),
						"tool_use_id": block.ToolUseID,
						"timestamp":   event.Timestamp,
					}
					e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.log_stream", flatEvent)
					logMutex.Lock()
					logEvents = append(logEvents, flatEvent)
					logMutex.Unlock()
					
				default:
					// Flush text buffer before unknown block type
					flushTextBuffer()
					
					flatEvent := map[string]any{
						"type":      block.Type,
						"content":   fmt.Sprintf("%v", block),
						"timestamp": event.Timestamp,
					}
					e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.log_stream", flatEvent)
					logMutex.Lock()
					logEvents = append(logEvents, flatEvent)
					logMutex.Unlock()
				}
			}
			return
		}

		// Handle result event (flush text buffer first)
		if event.Type == "result" {
			flushTextBuffer()
			
			flatEvent := map[string]any{
				"type":      "result",
				"timestamp": event.Timestamp,
				"subtype":   event.Subtype,
				"result":    event.Result,
			}
			e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.log_stream", flatEvent)
			logMutex.Lock()
			logEvents = append(logEvents, flatEvent)
			logMutex.Unlock()
		}
	})

	// 5b. Execute via CombinedAdapter with per-request callback, or fallback to plain Execute
	var resp *agent.AgentResponse
	if combinedAdapter, ok := adapter.(*agent.CombinedAdapter); ok {
		resp, err = combinedAdapter.ExecuteWithCallback(ctx, agentReq, logCallback)
	} else {
		resp, err = adapter.Execute(ctx, agentReq)
	}
	
	// Flush any remaining text in buffer after execution completes
	flushTextBuffer()
	
	if err != nil {
		// Persist logs even on failure
		if len(logEvents) > 0 {
			if dbErr := e.db.UpdateNodeRunLogStream(ctx, nodeRun.ID, logEvents); dbErr != nil {
				e.logger.Warnw("Failed to save log stream on error", "error", dbErr)
			}
		}
		return fmt.Errorf("agent execution failed: %w", err)
	}

	// 5a-2. Persist log stream to database
	if len(logEvents) > 0 {
		if dbErr := e.db.UpdateNodeRunLogStream(ctx, nodeRun.ID, logEvents); dbErr != nil {
			e.logger.Warnw("Failed to save log stream", "error", dbErr)
			// Non-fatal: don't block flow execution
		}
	}

	// 5b. Post-process generate_change_name mode: extract change_name from agent output
	if mode == "generate_change_name" {
		changeName := extractChangeName(resp.Output)
		if changeName != "" {
			resp.Output = map[string]any{
				"change_name": changeName,
			}
			e.logger.Infow("Extracted change_name from agent output", "change_name", changeName)
		} else {
			e.logger.Warnw("Failed to extract change_name from agent output", "output", resp.Output)
		}
	}

	// 6. Update Git info on task (if agent performed git operations)
	// Must run before artifact creation so fetchFileFromGit can read the branch from DB
	if resp.GitMetadata != nil && resp.GitMetadata.Branch != "" {
		if err := e.updateTaskGitInfo(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, resp.GitMetadata, gitRepoURL); err != nil {
			e.logger.Warnw("Failed to update git info", "error", err, "node_id", nodeRun.NodeID)
			// Non-fatal: don't block flow execution
		}
	}

	// 6a. Git repo cache: integrate node commit into flow integration ref
	if useRepoCache {
		// Only modes that produce code changes may need commit integration
		requiresCommit := mode == "execute" || mode == "opsx_plan" || mode == "opsx_apply"

		hasCommit := resp.GitMetadata != nil && resp.GitMetadata.Commit != ""

		if requiresCommit && hasCommit {
			commitSHA := resp.GitMetadata.Commit

			// Update node commit SHA in DB
			if dbErr := e.db.UpdateNodeRunGitState(ctx, nodeRun.ID, baseSHA, commitSHA, worktreePath); dbErr != nil {
				e.logger.Warnw("Failed to update node commit SHA", "error", dbErr)
			}

			// Integrate commit into flow integration ref
			newHeadSHA, intErr := e.repoManager.IntegrateNodeCommit(ctx, projectID, flowRun.ID, nodeRun.ID, commitSHA)
			if intErr != nil {
				return fmt.Errorf("failed to integrate node commit (cherry-pick): %w", intErr)
			}

			// Update flow integration head SHA
			if dbErr := e.db.UpdateFlowRunIntegration(ctx, flowRun.ID, integrationRef, newHeadSHA); dbErr != nil {
				e.logger.Warnw("Failed to update flow integration head", "error", dbErr)
			}

			// Resolve push branch: prefer resp metadata branch, fallback to gitBranch
			pushBranch := gitBranch
			if resp.GitMetadata.Branch != "" {
				pushBranch = resp.GitMetadata.Branch
			}
			if pushBranch == "" {
				return fmt.Errorf("cannot push integration: no branch available (gitBranch and resp.GitMetadata.Branch both empty)")
			}
			if pushErr := e.repoManager.PushIntegration(ctx, projectID, flowRun.ID, gitRepoURL, gitAccessToken, pushBranch); pushErr != nil {
				return fmt.Errorf("failed to push integration to remote: %w", pushErr)
			}
		} else if requiresCommit && !hasCommit {
			// No file changes in a commit-producing mode — skip integration, not an error
			e.logger.Debugw("No commit produced in commit mode, skipping integration (no file changes)",
				"mode", mode, "node_id", nodeRun.NodeID)
		} else {
			e.logger.Debugw("Skipping git integration for non-commit mode", "mode", mode, "node_id", nodeRun.NodeID)
		}

		// Cleanup node worktree (async, non-blocking)
		go func() {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if cleanupErr := e.repoManager.CleanupNodeWorktree(cleanupCtx, projectID, flowRun.ID, nodeRun.ID); cleanupErr != nil {
				e.logger.Warnw("Failed to cleanup node worktree", "error", cleanupErr, "node_run_id", nodeRun.ID)
			}
		}()
	}

	// 6b. Handle artifact creation (if configured)
	if nodeDef.Config != nil && nodeDef.Config.Artifact != nil {
		if err := e.handleArtifact(ctx, flowRun, nodeRun, nodeDef, runtimeCtx, resp.Output); err != nil {
			e.logger.Warnw("Failed to create artifact", "error", err, "node_id", nodeRun.NodeID)
			// Non-fatal: don't block flow execution
		}
	}

	// 6c. Extract markdown artifacts from Git changed files
	if resp.GitMetadata != nil && len(resp.GitMetadata.ChangedFiles) > 0 {
		artifactFiles := extractMarkdownArtifacts(resp.GitMetadata.ChangedFiles)
		if len(artifactFiles) > 0 {
			if err := e.handleArtifactFiles(ctx, flowRun, nodeRun, artifactFiles); err != nil {
				e.logger.Warnw("Failed to create artifacts from changed files", "error", err, "node_id", nodeRun.NodeID)
				// Non-fatal: don't block flow execution
			}
		}
	}

	// 6d. Validate opsx_apply result (detect incomplete implementation)
	if mode == "opsx_apply" {
		if validationErr := e.validateOpsxApplyResult(resp); validationErr != nil {
			e.logger.Warnw("opsx_apply validation failed", "error", validationErr, "node_id", nodeRun.NodeID)
			return fmt.Errorf("opsx_apply validation failed: %w", validationErr)
		}
	}

	// 6e. Handle transient artifacts (if configured)
	if nodeDef.Config != nil && nodeDef.Config.Transient {
		// Extract content from output
		content := ""
		if md, ok := resp.Output["understanding"].(string); ok {
			content = md
		} else if result, ok := resp.Output["result"].(string); ok {
			content = result
		} else if summary, ok := resp.Output["summary"].(string); ok {
			content = summary
		}

		if content != "" {
			transientArtifacts := map[string]any{
				"understanding": map[string]any{
					"type":    "markdown",
					"content": content,
				},
			}
			if err := e.db.UpdateNodeRunTransientArtifacts(ctx, nodeRun.ID, transientArtifacts); err != nil {
				e.logger.Warnw("Failed to save transient artifacts", "error", err)
				// Non-fatal: don't block flow execution
			} else {
				e.logger.Infow("Saved transient artifacts", "node_id", nodeRun.NodeID, "content_len", len(content))
			}
		}
	}

	// 7. Save output and mark completed
	if err := e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, resp.Output); err != nil {
		return fmt.Errorf("save output: %w", err)
	}
	if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	// 8. Publish completion event
	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.completed", map[string]any{
		"output": resp.Output,
	})

	// 9. Record timeline event
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

// ─── Artifact & Git Helpers ───

// handleArtifact creates an artifact record from agent output when the node has artifact config
func (e *FlowExecutor) handleArtifact(ctx context.Context, flowRun *db.FlowRun, nodeRun *db.NodeRun, nodeDef *NodeDef, runtimeCtx map[string]any, output map[string]any) error {
	artifactCfg := nodeDef.Config.Artifact

	// Render title template
	title := artifactCfg.Type // fallback
	if artifactCfg.Title != "" {
		if rendered, err := RenderTemplate(artifactCfg.Title, runtimeCtx); err == nil && rendered != "" {
			title = rendered
		}
	}

	// Extract content from output based on artifact type
	content := extractArtifactContent(artifactCfg.Type, output)
	if content == "" {
		return fmt.Errorf("no content found for artifact type %s", artifactCfg.Type)
	}

	// Create artifact
	artifactID, err := e.db.CreateArtifact(ctx, flowRun.TaskID, artifactCfg.Type, title, "", flowRun.ID, nodeRun.ID)
	if err != nil {
		return fmt.Errorf("create artifact: %w", err)
	}

	// Create initial version
	if err := e.db.CreateArtifactVersion(ctx, artifactID, 1, content, "Initial version", "agent"); err != nil {
		return fmt.Errorf("create artifact version: %w", err)
	}

	// Inject artifact_id into output for downstream nodes
	output["_artifact_id"] = artifactID

	e.logger.Infow("Created artifact",
		"artifact_id", artifactID,
		"type", artifactCfg.Type,
		"title", title,
		"content_len", len(content),
	)

	// Record timeline event
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "artifact_created", map[string]any{
		"artifact_id": artifactID,
		"type":        artifactCfg.Type,
		"title":       title,
		"message":     fmt.Sprintf("创建产物：%s", title),
	})

	return nil
}

// extractArtifactContent extracts the relevant content string from agent output
func extractArtifactContent(artifactType string, output map[string]any) string {
	// Try type-specific fields first
	switch artifactType {
	case "prd", "spec", "plan", "tech_spec":
		if v, ok := output["plan"].(string); ok && v != "" {
			return v
		}
	case "review_report":
		if v, ok := output["report"].(string); ok && v != "" {
			return v
		}
	}

	// Try common fields
	if v, ok := output["summary"].(string); ok && v != "" {
		return v
	}
	if v, ok := output["result"].(string); ok && v != "" {
		return v
	}

	// Fallback: serialize the entire output as JSON
	if b, err := json.Marshal(output); err == nil {
		s := string(b)
		// Don't use raw fallback if it's just {"raw": true, ...}
		if _, isRaw := output["raw"]; !isRaw {
			return s
		}
	}

	return ""
}

// updateTaskGitInfo updates the task's git branch and records git timeline events
func (e *FlowExecutor) updateTaskGitInfo(ctx context.Context, taskID, flowRunID, nodeRunID string, git *agent.GitMetadata, configRepoURL string) error {
	// Update task git_branch
	if err := e.db.UpdateTaskGitBranch(ctx, taskID, git.Branch); err != nil {
		return fmt.Errorf("update task git branch: %w", err)
	}

	e.logger.Infow("Updated task git info",
		"task_id", taskID,
		"branch", git.Branch,
		"commit", git.Commit,
		"pr_url", git.PrUrl,
		"changed_files", len(git.ChangedFiles),
	)

	// Resolve repo URL if not already set (fallback: parse from agent config repo URL)
	if git.RepoURL == "" {
		git.RepoURL = resolveRepoURL(configRepoURL)
	}

	// Build changed_files_detail from ChangedFiles if not already populated
	if len(git.ChangedFilesDetail) == 0 && len(git.ChangedFiles) > 0 {
		// Fallback: mark all files as "modified" when detail is unavailable
		for _, f := range git.ChangedFiles {
			git.ChangedFilesDetail = append(git.ChangedFilesDetail, agent.ChangedFileDetail{
				Path:   f,
				Status: "modified",
			})
		}
	}

	// Record git_pushed timeline event
	timelineContent := map[string]any{
		"branch":         git.Branch,
		"base_branch":    git.BaseBranch,
		"commit":         git.Commit,
		"commit_message": git.CommitMessage,
		"changed_files":  git.ChangedFiles,
		"message":        fmt.Sprintf("代码已推送到分支 %s", git.Branch),
	}
	if git.RepoURL != "" {
		timelineContent["repo_url"] = git.RepoURL
	}
	if len(git.ChangedFilesDetail) > 0 {
		timelineContent["changed_files_detail"] = git.ChangedFilesDetail
	}
	e.recordTimeline(ctx, taskID, flowRunID, nodeRunID, "git_pushed", timelineContent)

	// Record pr_created timeline event (if PR was created)
	if git.PrUrl != "" {
		e.recordTimeline(ctx, taskID, flowRunID, nodeRunID, "pr_created", map[string]any{
			"pr_url":  git.PrUrl,
			"branch":  git.Branch,
			"message": fmt.Sprintf("已创建 PR: %s", git.PrUrl),
		})
	}

	// Update flow_runs PR info (branch_name, pr_url, pr_number)
	if err := e.db.UpdateFlowRunPR(ctx, flowRunID, git.Branch, git.PrUrl, git.PrNumber); err != nil {
		e.logger.Warnw("Failed to update flow run PR info", "error", err)
		// Non-fatal
	}

	return nil
}

// extractMarkdownArtifacts scans git changed files and extracts all markdown files as artifacts.
// Automatically infers artifact type and title from file path.
func extractMarkdownArtifacts(changedFiles []string) []agent.ArtifactFile {
	var artifacts []agent.ArtifactFile

	for _, file := range changedFiles {
		// Only process markdown files
		if !strings.HasSuffix(strings.ToLower(file), ".md") {
			continue
		}

		// Infer type and title from file path
		artifactType, title := inferArtifactTypeAndTitle(file)

		artifacts = append(artifacts, agent.ArtifactFile{
			Path:  file,
			Type:  artifactType,
			Title: title,
		})
	}

	return artifacts
}

// inferArtifactTypeAndTitle infers artifact type and display title from file path.
func inferArtifactTypeAndTitle(filePath string) (artifactType, title string) {
	// Extract filename without extension
	fileName := strings.TrimSuffix(filepath.Base(filePath), ".md")
	fileName = strings.TrimSuffix(fileName, ".MD")

	// Infer type from common patterns
	lowerName := strings.ToLower(fileName)
	switch {
	case lowerName == "proposal":
		return "proposal", "Proposal"
	case lowerName == "design":
		return "design", "Design"
	case lowerName == "tasks":
		return "tasks", "Tasks"
	case lowerName == "readme":
		return "readme", "README"
	case strings.Contains(lowerName, "spec"):
		return "spec", fileName
	case strings.Contains(lowerName, "design"):
		return "design", fileName
	case strings.Contains(lowerName, "plan"):
		return "plan", fileName
	case strings.Contains(lowerName, "review"):
		return "review", fileName
	default:
		return "doc", fileName
	}
}

// handleArtifactFiles creates multiple artifact records from agent output
func (e *FlowExecutor) handleArtifactFiles(ctx context.Context, flowRun *db.FlowRun, nodeRun *db.NodeRun, files []agent.ArtifactFile) error {
	for _, file := range files {
		// 如果 Content 为空，从 Git 读取
		content := file.Content
		if content == "" {
			var err error
			content, err = e.fetchFileFromGit(ctx, flowRun.TaskID, file.Path)
			if err != nil {
				e.logger.Warnw("Failed to fetch file from git", "path", file.Path, "error", err)
				continue
			}
		}

		// Create artifact
		artifactID, err := e.db.CreateArtifact(ctx, flowRun.TaskID, file.Type, file.Title, file.Path, flowRun.ID, nodeRun.ID)
		if err != nil {
			e.logger.Errorw("Failed to create artifact", "error", err, "path", file.Path)
			continue
		}

		// Create initial version
		if err := e.db.CreateArtifactVersion(ctx, artifactID, 1, content, "Initial version from OpenSpec", "agent"); err != nil {
			e.logger.Errorw("Failed to create artifact version", "error", err, "artifact_id", artifactID)
			continue
		}

		e.logger.Infow("Created artifact from file",
			"artifact_id", artifactID,
			"type", file.Type,
			"title", file.Title,
			"path", file.Path,
		)

		// Record timeline event
		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "artifact_created", map[string]any{
			"artifact_id": artifactID,
			"type":        file.Type,
			"title":       file.Title,
			"path":        file.Path,
			"message":     fmt.Sprintf("创建产物：%s", file.Title),
		})
	}

	return nil
}

// fetchFileFromGit reads a file from the task's git repository
func (e *FlowExecutor) fetchFileFromGit(ctx context.Context, taskID, filePath string) (string, error) {
	repoURL, branch, err := e.db.GetTaskGitInfo(ctx, taskID)
	if err != nil {
		return "", fmt.Errorf("get git info: %w", err)
	}
	if repoURL == "" || branch == "" {
		return "", fmt.Errorf("task has no git info")
	}

	// 使用 git show 命令读取文件内容
	tmpDir, err := os.MkdirTemp("", "workgear-git-")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Clone with depth 1
	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--branch", branch, "--no-checkout", repoURL, tmpDir)
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git clone: %w", err)
	}

	// Show file content
	cmd = exec.CommandContext(ctx, "git", "show", fmt.Sprintf("HEAD:%s", filePath))
	cmd.Dir = tmpDir
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git show: %w", err)
	}

	return string(output), nil
}

// extractChangeName extracts a change_name slug from agent output.
// It handles multiple output formats:
// 1. Direct: {"change_name": "xxx"}
// 2. Raw Claude output: {"raw": true, "result": "{...\"result\":\"xxx\"...}"}
// 3. Plain text slug in result field
func extractChangeName(output map[string]any) string {
	// 1. Direct change_name field
	if cn, ok := output["change_name"]; ok {
		if s, ok := cn.(string); ok && s != "" {
			return sanitizeSlug(s)
		}
	}

	// 2. Try to extract from raw Claude CLI output
	if rawResult, ok := output["result"]; ok {
		resultStr, ok := rawResult.(string)
		if !ok {
			return ""
		}

		// Try parsing as Claude CLI JSON (nested {"type":"result","result":"..."})
		var cliOutput struct {
			Result string `json:"result"`
		}
		if err := json.Unmarshal([]byte(resultStr), &cliOutput); err == nil && cliOutput.Result != "" {
			resultStr = cliOutput.Result
		}

		// Try parsing the result as JSON with change_name field
		var parsed map[string]any
		if err := json.Unmarshal([]byte(resultStr), &parsed); err == nil {
			if cn, ok := parsed["change_name"]; ok {
				if s, ok := cn.(string); ok && s != "" {
					return sanitizeSlug(s)
				}
			}
		}

		// Fallback: treat the entire result as a plain text slug
		slug := sanitizeSlug(strings.TrimSpace(resultStr))
		if slug != "" && len(slug) <= 50 && !strings.Contains(slug, " ") {
			return slug
		}
	}

	return ""
}

// sanitizeSlug cleans a string to be a valid branch-name slug
func sanitizeSlug(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, "\"'`")
	s = strings.ToLower(s)
	// Keep only alphanumeric and hyphens
	var result strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		} else if r == ' ' || r == '_' {
			result.WriteRune('-')
		}
	}
	slug := result.String()
	// Clean up consecutive hyphens
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}
	slug = strings.Trim(slug, "-")
	return slug
}

// ─── Git Diff Viewer Link Helpers ───

// resolveRepoURL extracts a clean HTTPS repo URL from a git remote URL.
// Strips credentials, converts SSH format to HTTPS, removes .git suffix.
func resolveRepoURL(remoteURL string) string {
	if remoteURL == "" {
		return ""
	}

	url := remoteURL

	// Convert SSH format: git@github.com:owner/repo.git → https://github.com/owner/repo
	if strings.HasPrefix(url, "git@") {
		url = strings.TrimPrefix(url, "git@")
		url = strings.Replace(url, ":", "/", 1)
		url = "https://" + url
	}

	// Strip credentials from HTTPS URL: https://token@github.com/... → https://github.com/...
	if strings.Contains(url, "@") && strings.HasPrefix(url, "https://") {
		parts := strings.SplitN(url, "@", 2)
		if len(parts) == 2 {
			url = "https://" + parts[1]
		}
	}

	// Remove trailing .git
	url = strings.TrimSuffix(url, ".git")

	return url
}

// parseChangedFilesDetail parses "git diff --name-status" output into ChangedFileDetail slice.
// NOTE: Currently unused — entrypoint.sh parses git diff --name-status inside the container
// and writes the result to git_metadata.json, which adapter.go deserializes directly.
// Retained as a Go-side backup parser in case the shell-based parsing is removed in the future.
func parseChangedFilesDetail(output string) []agent.ChangedFileDetail {
	var details []agent.ChangedFileDetail
	statusMap := map[string]string{
		"A": "added",
		"M": "modified",
		"D": "deleted",
		"R": "renamed",
	}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 2 {
			continue
		}
		statusCode := parts[0]
		filePath := parts[1]
		// For renames (R100), use the destination path
		if strings.HasPrefix(statusCode, "R") && len(parts) == 3 {
			filePath = parts[2]
			statusCode = "R"
		}
		// Map first character for cases like R100, C100
		if len(statusCode) > 1 {
			statusCode = statusCode[:1]
		}
		status := statusMap[statusCode]
		if status == "" {
			status = "modified"
		}
		details = append(details, agent.ChangedFileDetail{
			Path:   filePath,
			Status: status,
		})
	}
	return details
}

// validateOpsxApplyResult validates that opsx_apply mode produced actual code changes
func (e *FlowExecutor) validateOpsxApplyResult(resp *agent.AgentResponse) error {
	// 1. Check if there are any Git changes
	if resp.GitMetadata == nil || len(resp.GitMetadata.ChangedFiles) == 0 {
		return fmt.Errorf("no code changes detected, agent may have terminated prematurely")
	}

	// 2. Check if only package manager files were modified (indicates only dependency installation, no actual implementation)
	codeFileCount := 0
	for _, f := range resp.GitMetadata.ChangedFiles {
		if !strings.Contains(f, "package.json") &&
			!strings.Contains(f, "package-lock.json") &&
			!strings.Contains(f, "pnpm-lock.yaml") &&
			!strings.HasPrefix(f, "node_modules/") {
			codeFileCount++
		}
	}
	if codeFileCount == 0 {
		return fmt.Errorf("only package manager files were modified, no actual code implementation detected")
	}

	return nil
}

// ─── agent_dispatch ───

// AgentPoolItem represents a candidate agent in the dispatch pool
type AgentPoolItem struct {
	Role        string `json:"role"`
	Description string `json:"description"`
}

func (e *FlowExecutor) executeAgentDispatch(ctx context.Context, nodeRun *db.NodeRun) error {
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

	// 3. Parse agent_pool (may be a template expression or literal array)
	agentPoolRaw := nodeDef.Config.AgentPool
	// If it's a string, try rendering as template variable (e.g. "{{params.dispatch_pool}}")
	if poolStr, ok := agentPoolRaw.(string); ok {
		rendered, err := RenderTemplate(poolStr, runtimeCtx)
		if err != nil {
			return fmt.Errorf("render agent_pool template: %w", err)
		}
		// Try parsing rendered string as JSON array
		var parsed interface{}
		if err := json.Unmarshal([]byte(rendered), &parsed); err != nil {
			return fmt.Errorf("agent_pool rendered to non-JSON value: %s", rendered)
		}
		agentPoolRaw = parsed
	}

	agentPool, err := e.parseAgentPool(agentPoolRaw)
	if err != nil {
		return fmt.Errorf("invalid agent_pool: %w", err)
	}
	if len(agentPool) < 2 {
		return fmt.Errorf("agent_pool must contain at least 2 roles, got %d", len(agentPool))
	}

	// 4. Render dispatch_prompt_template
	promptTemplate := nodeDef.Config.DispatchPromptTemplate
	if promptTemplate == "" {
		return fmt.Errorf("dispatch_prompt_template is required for agent_dispatch node")
	}

	// Add agent_pool and task input to template context
	dispatchCtx := make(map[string]any)
	for k, v := range runtimeCtx {
		dispatchCtx[k] = v
	}
	if nodeRun.Input != nil {
		var input map[string]any
		if err := json.Unmarshal([]byte(*nodeRun.Input), &input); err == nil {
			dispatchCtx["task"] = input
		}
	}
	dispatchCtx["agent_pool"] = agentPool

	prompt, err := RenderTemplate(promptTemplate, dispatchCtx)
	if err != nil {
		return fmt.Errorf("render dispatch prompt failed: %w", err)
	}

	// 5. Get dispatcher adapter (from agent.role, same as agent_task)
	role := "general-developer" // fallback
	if nodeDef.Agent != nil && nodeDef.Agent.Role != "" {
		role = nodeDef.Agent.Role
		if rendered, err := RenderTemplate(role, runtimeCtx); err == nil {
			role = rendered
		}
	}

	adapter, registryModel, err := e.registry.GetAdapterForRole(role)
	if err != nil {
		return e.handleDispatchFallback(ctx, nodeRun, flowRun, nodeDef, agentPool,
			fmt.Errorf("dispatcher role %q not found: %w", role, err))
	}

	// 6. Get role config for system prompt
	roleConfig, err := e.db.GetAgentRoleConfig(ctx, role)
	if err != nil {
		e.logger.Warnw("Failed to get dispatcher role config", "role", role, "error", err)
	}
	rolePrompt := ""
	if roleConfig != nil {
		rolePrompt = roleConfig.SystemPrompt
	}

	// 7. Determine model
	model := ""
	if nodeDef.Agent != nil && nodeDef.Agent.Model != "" {
		model = nodeDef.Agent.Model
		if rendered, err := RenderTemplate(model, runtimeCtx); err == nil {
			model = rendered
		}
	}
	if model == "" && registryModel != "" {
		model = registryModel
	}

	// 8. Build agent request
	var inputCtx map[string]any
	if nodeRun.Input != nil {
		_ = json.Unmarshal([]byte(*nodeRun.Input), &inputCtx)
	}
	if inputCtx == nil {
		inputCtx = make(map[string]any)
	}

	// Parse timeout from DSL
	timeout := 60 * time.Second // default short timeout for dispatch
	if nodeDef.Timeout != "" {
		if parsed, err := time.ParseDuration(nodeDef.Timeout); err == nil {
			timeout = parsed
		}
	}

	agentReq := &agent.AgentRequest{
		TaskID:     nodeRun.ID,
		FlowRunID:  nodeRun.FlowRunID,
		NodeID:     nodeRun.NodeID,
		Mode:       "execute",
		Prompt:     prompt,
		Context:    inputCtx,
		RolePrompt: rolePrompt,
		Model:      model,
		Timeout:    timeout,
	}

	// 9. Execute dispatcher
	e.logger.Infow("Executing agent dispatch",
		"node_id", nodeRun.NodeID,
		"dispatcher_role", role,
		"agent_pool_size", len(agentPool),
	)

	resp, err := adapter.Execute(ctx, agentReq)
	if err != nil {
		return e.handleDispatchFallback(ctx, nodeRun, flowRun, nodeDef, agentPool, err)
	}

	// 10. Parse dispatcher output
	var result struct {
		SelectedRole string `json:"selected_role"`
		Reason       string `json:"reason"`
	}
	if err := parseJSONFromAgentOutput(resp, &result); err != nil {
		return e.handleDispatchFallback(ctx, nodeRun, flowRun, nodeDef, agentPool,
			fmt.Errorf("parse dispatch result failed: %w", err))
	}

	// 11. Validate selected_role is in agent_pool
	if !isRoleInPool(result.SelectedRole, agentPool) {
		return e.handleDispatchFallback(ctx, nodeRun, flowRun, nodeDef, agentPool,
			fmt.Errorf("selected role %q not in agent_pool", result.SelectedRole))
	}

	// 12. Save output
	output := map[string]any{
		"selected_role": result.SelectedRole,
		"reason":        result.Reason,
		"agent_pool":    agentPool,
		"fallback":      false,
	}
	if resp.Metrics != nil {
		output["dispatch_metrics"] = map[string]any{
			"duration_ms":  resp.Metrics.DurationMs,
			"token_input":  resp.Metrics.TokenInput,
			"token_output": resp.Metrics.TokenOutput,
		}
	}

	if err := e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, output); err != nil {
		return fmt.Errorf("save output: %w", err)
	}
	if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusCompleted); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	// 13. Publish completion event
	e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.completed", map[string]any{
		"output": output,
	})

	// 14. Record timeline event
	e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "agent_dispatch_completed", map[string]any{
		"node_id":       nodeRun.NodeID,
		"node_name":     ptrStr(nodeRun.NodeName),
		"selected_role": result.SelectedRole,
		"reason":        result.Reason,
	})

	e.logger.Infow("Agent dispatch completed",
		"node_id", nodeRun.NodeID,
		"selected_role", result.SelectedRole,
		"reason", result.Reason,
	)

	return nil
}

// parseAgentPool parses agent_pool from DSL config into typed slice
func (e *FlowExecutor) parseAgentPool(raw interface{}) ([]AgentPoolItem, error) {
	if raw == nil {
		return nil, fmt.Errorf("agent_pool is nil")
	}

	data, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("marshal agent_pool: %w", err)
	}

	var pool []AgentPoolItem
	if err := json.Unmarshal(data, &pool); err != nil {
		return nil, fmt.Errorf("unmarshal agent_pool: %w", err)
	}

	return pool, nil
}

// isRoleInPool checks if a role exists in the agent pool
func isRoleInPool(role string, pool []AgentPoolItem) bool {
	for _, item := range pool {
		if item.Role == role {
			return true
		}
	}
	return false
}

// handleDispatchFallback handles dispatch failure with fallback strategy
func (e *FlowExecutor) handleDispatchFallback(
	ctx context.Context,
	nodeRun *db.NodeRun,
	flowRun *db.FlowRun,
	nodeDef *NodeDef,
	agentPool []AgentPoolItem,
	originalErr error,
) error {
	if nodeDef.Config == nil || nodeDef.Config.Fallback == nil {
		return originalErr
	}

	fallbackCfg := nodeDef.Config.Fallback
	strategy := fallbackCfg.Strategy

	switch strategy {
	case "use_default":
		defaultRole := fallbackCfg.DefaultRole
		if defaultRole == "" {
			return fmt.Errorf("fallback default_role is empty, original error: %w", originalErr)
		}

		output := map[string]any{
			"selected_role": defaultRole,
			"reason":        fmt.Sprintf("调度失败（%v），使用默认角色", originalErr),
			"agent_pool":    agentPool,
			"fallback":      true,
		}

		if err := e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, output); err != nil {
			return fmt.Errorf("save fallback output: %w", err)
		}
		if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusCompleted); err != nil {
			return fmt.Errorf("update status: %w", err)
		}

		e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.completed", map[string]any{
			"output": output,
		})

		e.recordTimeline(ctx, flowRun.TaskID, nodeRun.FlowRunID, nodeRun.ID, "agent_dispatch_completed", map[string]any{
			"node_id":       nodeRun.NodeID,
			"node_name":     ptrStr(nodeRun.NodeName),
			"selected_role": defaultRole,
			"reason":        fmt.Sprintf("调度失败，使用默认角色: %v", originalErr),
			"fallback":      true,
		})

		e.logger.Warnw("Agent dispatch fallback to default",
			"node_id", nodeRun.NodeID,
			"default_role", defaultRole,
			"error", originalErr,
		)
		return nil

	case "human_select":
		output := map[string]any{
			"agent_pool":     agentPool,
			"fallback":       true,
			"original_error": originalErr.Error(),
		}

		if err := e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, output); err != nil {
			return fmt.Errorf("save output: %w", err)
		}
		if err := e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, db.StatusWaitingHuman); err != nil {
			return fmt.Errorf("update status: %w", err)
		}

		e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.waiting_human", map[string]any{
			"agent_pool": agentPool,
			"error":      originalErr.Error(),
		})

		e.logger.Warnw("Agent dispatch fallback to human select",
			"node_id", nodeRun.NodeID,
			"error", originalErr,
		)
		return nil

	case "fail":
		return originalErr

	default:
		return fmt.Errorf("unknown fallback strategy %q, original error: %w", strategy, originalErr)
	}
}

// parseJSONFromAgentOutput extracts JSON from agent response output
func parseJSONFromAgentOutput(resp *agent.AgentResponse, target interface{}) error {
	// Try direct result field first
	if resultStr, ok := resp.Output["result"].(string); ok {
		// Try parsing as nested Claude CLI JSON
		var cliOutput struct {
			Result string `json:"result"`
		}
		if err := json.Unmarshal([]byte(resultStr), &cliOutput); err == nil && cliOutput.Result != "" {
			resultStr = cliOutput.Result
		}

		// Parse the actual result
		if err := json.Unmarshal([]byte(resultStr), target); err == nil {
			return nil
		}
	}

	// Fallback: try parsing entire output
	data, err := json.Marshal(resp.Output)
	if err != nil {
		return fmt.Errorf("marshal output: %w", err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("unmarshal output: %w", err)
	}

	return nil
}

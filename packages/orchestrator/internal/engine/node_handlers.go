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
		RolePrompt:     rolePrompt,
		Feedback:       feedback,
		Model:          model,
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

	// 5a. Inject real-time log streaming callback
	var logEvents []map[string]any
	var logMutex sync.Mutex

	if combinedAdapter, ok := adapter.(*agent.CombinedAdapter); ok {
		if dockerExec, ok := combinedAdapter.Executor().(*agent.DockerExecutor); ok {
			dockerExec.SetLogEventCallback(func(event agent.ClaudeStreamEvent) {
				// Skip system/init events
				if event.Type == "system" {
					return
				}

				// Flatten nested structure into frontend-friendly events
				if event.Message != nil {
					for _, block := range event.Message.Content {
						flatEvent := map[string]any{
							"timestamp": event.Timestamp,
						}
						
						switch block.Type {
						case "text":
							flatEvent["type"] = "assistant"
							flatEvent["content"] = block.Text
						case "tool_use":
							flatEvent["type"] = "tool_use"
							flatEvent["tool_name"] = block.Name
							flatEvent["tool_input"] = block.Input
						case "tool_result":
							flatEvent["type"] = "tool_result"
							flatEvent["content"] = fmt.Sprintf("%v", block.Content)
							flatEvent["tool_use_id"] = block.ToolUseID
						default:
							flatEvent["type"] = block.Type
							flatEvent["content"] = fmt.Sprintf("%v", block)
						}

						// Real-time push via event bus
						e.publishEvent(nodeRun.FlowRunID, nodeRun.ID, nodeRun.NodeID, "node.log_stream", flatEvent)

						// Collect for persistence
						logMutex.Lock()
						logEvents = append(logEvents, flatEvent)
						logMutex.Unlock()
					}
					return
				}

				// Handle result event
				if event.Type == "result" {
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
		}
	}

	resp, err := adapter.Execute(ctx, agentReq)
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

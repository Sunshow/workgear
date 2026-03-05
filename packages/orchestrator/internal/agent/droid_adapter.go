package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"
)

// DroidAdapter is a TypeAdapter for Factory Droid CLI
type DroidAdapter struct {
	promptBuilder *PromptBuilder
	providerID    string
	providerType  string // "anthropic" | "openai" | "generic-chat-completion-api"
	apiKey        string
	baseURL       string
	model         string
	image         string
	config        map[string]any // full provider config for extra BYOK fields
}

// NewDroidAdapter creates a new Droid adapter with provider-level config
func NewDroidAdapter(promptBuilder *PromptBuilder, providerID, providerType, apiKey, baseURL, model string) *DroidAdapter {
	image := os.Getenv("DROID_DOCKER_IMAGE")
	if image == "" {
		image = "workgear/agent-droid:latest"
	}
	return &DroidAdapter{
		promptBuilder: promptBuilder,
		providerID:    providerID,
		providerType:  providerType,
		apiKey:        apiKey,
		baseURL:       baseURL,
		model:         model,
		image:         image,
	}
}

func (a *DroidAdapter) Name() string { return "droid" }

func (a *DroidAdapter) BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error) {
	// Build full prompt
	prompt := a.promptBuilder.Build(req, req.Skills)

	// Write prompt to temp file to avoid ARG_MAX limit
	promptFilePath, err := writePromptToFile(prompt, req.NodeID)
	if err != nil {
		return nil, fmt.Errorf("write prompt file: %w", err)
	}

	// Prepare environment variables (AGENT_PROMPT no longer passed as env var)
	env := map[string]string{
		"AGENT_MODE":   req.Mode,
		"TASK_ID":      req.TaskID,
		"NODE_ID":      req.NodeID,
	}

	// Authentication: ACP 模式只需非空 FACTORY_API_KEY 绕过 CLI 登录检查
	// BYOK 配置通过 settings.json 传递，模型切换通过 ACP session/set_model 完成
	if a.providerType != "" && a.baseURL != "" && a.apiKey != "" {
		env["DROID_PROVIDER_TYPE"] = a.providerType
		env["DROID_BASE_URL"] = a.baseURL
		env["DROID_API_KEY"] = a.apiKey
		env["FACTORY_API_KEY"] = "byok-acp"

		// Optional BYOK fields from provider config
		if modelID, ok := a.config["model_id"].(string); ok && modelID != "" {
			env["DROID_MODEL"] = modelID
		}
		if displayName, ok := a.config["display_name"].(string); ok && displayName != "" {
			env["DROID_MODEL_DISPLAY_NAME"] = displayName
		}
		if maxTokens, ok := a.config["max_output_tokens"].(string); ok && maxTokens != "" {
			env["DROID_MAX_OUTPUT_TOKENS"] = maxTokens
		}
	}

	// Model selection: req.Model (highest priority) > a.model (global default)
	model := req.Model
	if model == "" {
		model = a.model
	}
	if model != "" {
		env["DROID_MODEL"] = model
	}

	// Git configuration
	if req.GitRepoURL != "" {
		env["GIT_REPO_URL"] = req.GitRepoURL
	}

	baseBranch := req.GitBranch
	if baseBranch == "" {
		baseBranch = "main"
	}
	// If GitBranch looks like a feature branch (set by DSL git.branch_pattern),
	// use "main" as the base branch instead
	if baseBranch != "main" && baseBranch != "master" {
		baseBranch = "main"
	}
	env["GIT_BRANCH"] = baseBranch
	env["GIT_BASE_BRANCH"] = baseBranch

	featureBranch := req.GitBranch
	if featureBranch == "" || featureBranch == "main" || featureBranch == "master" {
		if req.OpsxConfig != nil && req.OpsxConfig.ChangeName != "" {
			featureBranch = "agent/" + req.OpsxConfig.ChangeName
		} else {
			featureBranch = generateFeatureBranch(req.TaskTitle, "")
		}
	}
	env["GIT_FEATURE_BRANCH"] = featureBranch

	env["GIT_CREATE_PR"] = "true"
	env["GIT_PR_TITLE"] = req.TaskTitle

	if req.GitAccessToken != "" {
		env["GIT_ACCESS_TOKEN"] = req.GitAccessToken
	}

	// Git provider info
	if req.GitProviderType != "" {
		env["GIT_PROVIDER_TYPE"] = req.GitProviderType
	}
	if req.GitBaseUrl != "" {
		env["GIT_BASE_URL"] = req.GitBaseUrl
	}
	if req.GitUsername != "" {
		env["GIT_USERNAME"] = req.GitUsername
	}
	if req.GitPassword != "" {
		env["GIT_PASSWORD"] = req.GitPassword
	}

	// Skip Git for generate_change_name mode
	if req.Mode == "generate_change_name" {
		env["GIT_REPO_URL"] = ""
		env["GIT_CREATE_PR"] = "false"
	}

	// OpenSpec configuration
	if req.Mode == "opsx_plan" || req.Mode == "opsx_apply" {
		if opsx := req.OpsxConfig; opsx != nil {
			env["OPSX_CHANGE_NAME"] = opsx.ChangeName
			if opsx.Schema != "" {
				env["OPSX_SCHEMA"] = opsx.Schema
			}
			env["OPSX_INIT_IF_MISSING"] = strconv.FormatBool(opsx.InitIfMissing)
			if opsx.Action != "" {
				env["OPSX_ACTION"] = opsx.Action
			}
		}
	}

	timeout := req.Timeout
	if timeout == 0 {
		timeout = 10 * time.Minute
	}

	return &ExecutorRequest{
		Image:          a.image,
		Command:        nil,
		Env:            env,
		WorkDir:        "/workspace",
		Timeout:        timeout,
		WorktreePath:   req.WorktreePath,
		BareRepoPath:   req.BareRepoPath,
		DepsPath:       req.DepsPath,
		PromptFilePath: promptFilePath,
	}, nil
}

func (a *DroidAdapter) ParseResponse(resp *ExecutorResponse) (*AgentResponse, error) {
	if resp.ExitCode != 0 {
		return nil, fmt.Errorf("droid execution failed (exit code %d): %s", resp.ExitCode, resp.Stderr)
	}

	// ACP 模式下 entrypoint.sh 输出统一的 result JSON
	// 格式: {"type":"result","subtype":"success","result":"...","stop_reason":"end_turn","session_id":"..."}
	// 或:   {"error":"..."}
	var raw map[string]any
	if err := json.Unmarshal([]byte(resp.Stdout), &raw); err != nil {
		return &AgentResponse{
			Output: map[string]any{
				"result":  resp.Stdout,
				"raw":     true,
				"summary": "Droid execution completed (non-JSON output)",
			},
			GitMetadata: resp.GitMetadata,
		}, nil
	}

	output := make(map[string]any)

	// Check for error
	if errMsg, ok := raw["error"].(string); ok && errMsg != "" {
		output["error"] = errMsg
		output["summary"] = errMsg
		if resp.Stderr != "" {
			output["stderr"] = resp.Stderr
		}
		if droidStderr, ok := raw["droid_stderr"].(string); ok && droidStderr != "" {
			output["droid_stderr"] = droidStderr
		}
	} else {
		// Extract result text from ACP response
		if result, ok := raw["result"].(string); ok {
			output["result"] = result
			output["summary"] = result
		}
		if stopReason, ok := raw["stop_reason"].(string); ok {
			output["stop_reason"] = stopReason
		}
	}

	return &AgentResponse{
		Output:      output,
		GitMetadata: resp.GitMetadata,
	}, nil
}

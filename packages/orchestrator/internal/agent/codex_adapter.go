package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"
)

// CodexAdapter is a TypeAdapter for OpenAI Codex CLI
type CodexAdapter struct {
	promptBuilder *PromptBuilder
	providerID    string
	apiKey        string
	baseURL       string
	model         string
	image         string
}

// NewCodexAdapter creates a new Codex adapter with provider-level config
func NewCodexAdapter(promptBuilder *PromptBuilder, providerID, apiKey, baseURL, model string) *CodexAdapter {
	image := os.Getenv("CODEX_DOCKER_IMAGE")
	if image == "" {
		image = "workgear/agent-codex:latest"
	}
	return &CodexAdapter{
		promptBuilder: promptBuilder,
		providerID:    providerID,
		apiKey:        apiKey,
		baseURL:       baseURL,
		model:         model,
		image:         image,
	}
}

func (a *CodexAdapter) Name() string { return "codex" }

func (a *CodexAdapter) BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error) {
	// Build full prompt
	prompt := a.promptBuilder.Build(req)

	// Prepare environment variables
	env := map[string]string{
		"AGENT_PROMPT": prompt,
		"AGENT_MODE":   req.Mode,
		"TASK_ID":      req.TaskID,
		"NODE_ID":      req.NodeID,
	}

	// OpenAI API key
	if a.apiKey != "" {
		env["OPENAI_API_KEY"] = a.apiKey
	}
	if env["OPENAI_API_KEY"] == "" {
		if v := os.Getenv("OPENAI_API_KEY"); v != "" {
			env["OPENAI_API_KEY"] = v
		}
	}

	// Model selection: req.Model (highest priority) > a.model (global default)
	model := req.Model
	if model == "" {
		model = a.model
	}
	if model != "" {
		env["CODEX_MODEL"] = model
	}

	// Custom provider config
	if a.baseURL != "" {
		env["CODEX_PROVIDER_BASE_URL"] = a.baseURL
		env["CODEX_MODEL_PROVIDER"] = "custom"
	}

	// Git configuration
	if req.GitRepoURL != "" {
		env["GIT_REPO_URL"] = req.GitRepoURL
	}

	baseBranch := req.GitBranch
	if baseBranch == "" {
		baseBranch = "main"
	}
	env["GIT_BRANCH"] = baseBranch
	env["GIT_BASE_BRANCH"] = baseBranch

	featureBranch := req.GitBranch
	if featureBranch == "" || featureBranch == "main" {
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

	return &ExecutorRequest{
		Image:   a.image,
		Command: nil,
		Env:     env,
		WorkDir: "/workspace",
		Timeout: 10 * time.Minute,
	}, nil
}

func (a *CodexAdapter) ParseResponse(resp *ExecutorResponse) (*AgentResponse, error) {
	if resp.ExitCode != 0 {
		return nil, fmt.Errorf("codex execution failed (exit code %d): %s", resp.ExitCode, resp.Stderr)
	}

	// Try to parse JSON output
	output := make(map[string]any)
	if err := json.Unmarshal([]byte(resp.Stdout), &output); err != nil {
		// Wrap raw output
		output = map[string]any{
			"result":  resp.Stdout,
			"raw":     true,
			"summary": "Codex execution completed",
		}
	}

	return &AgentResponse{
		Output:      output,
		GitMetadata: resp.GitMetadata,
	}, nil
}

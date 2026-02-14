package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	gopinyin "github.com/mozillazg/go-pinyin"
)

// ClaudeCodeAdapter is a TypeAdapter for ClaudeCode CLI
type ClaudeCodeAdapter struct {
	promptBuilder *PromptBuilder
	model         string
	image         string
}

// NewClaudeCodeAdapter creates a new ClaudeCode adapter
func NewClaudeCodeAdapter(promptBuilder *PromptBuilder, model string) *ClaudeCodeAdapter {
	if model == "" {
		model = "claude-sonnet-3.5"
	}
	image := os.Getenv("AGENT_DOCKER_IMAGE")
	if image == "" {
		image = "workgear/agent-claude:latest"
	}
	return &ClaudeCodeAdapter{
		promptBuilder: promptBuilder,
		model:         model,
		image:         image,
	}
}

func (a *ClaudeCodeAdapter) Name() string { return "claude-code" }

func (a *ClaudeCodeAdapter) BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error) {
	// 1. Build full prompt
	prompt := a.promptBuilder.Build(req)

	// 2. Prepare environment variables
	env := map[string]string{
		"AGENT_PROMPT": prompt,
		"AGENT_MODE":   req.Mode,
		"TASK_ID":      req.TaskID,
		"NODE_ID":      req.NodeID,
	}

	// Anthropic credentials (pass non-empty values only)
	if v := os.Getenv("ANTHROPIC_API_KEY"); v != "" {
		env["ANTHROPIC_API_KEY"] = v
	}
	if v := os.Getenv("ANTHROPIC_BASE_URL"); v != "" {
		env["ANTHROPIC_BASE_URL"] = v
	}
	if v := os.Getenv("ANTHROPIC_AUTH_TOKEN"); v != "" {
		env["ANTHROPIC_AUTH_TOKEN"] = v
	}

	// Git configuration
	if req.GitRepoURL != "" {
		env["GIT_REPO_URL"] = req.GitRepoURL
	}
	
	// Base branch (for cloning)
	baseBranch := req.GitBranch
	if baseBranch == "" {
		baseBranch = "main"
	}
	env["GIT_BRANCH"] = baseBranch
	env["GIT_BASE_BRANCH"] = baseBranch

	// Feature branch (for pushing)
	// Priority: 1. OpsxConfig.ChangeName, 2. existing gitBranch (non-main), 3. generate from task title
	featureBranch := req.GitBranch
	if featureBranch == "" || featureBranch == "main" {
		if req.OpsxConfig != nil && req.OpsxConfig.ChangeName != "" {
			featureBranch = "agent/" + req.OpsxConfig.ChangeName
		} else {
			featureBranch = generateFeatureBranch(req.TaskTitle, "")
		}
	}
	env["GIT_FEATURE_BRANCH"] = featureBranch

	// PR configuration
	env["GIT_CREATE_PR"] = "true"
	// PR title: pure task title (no [Agent] prefix, no node name)
	env["GIT_PR_TITLE"] = req.TaskTitle

	// Access token (for GitHub API)
	if req.GitAccessToken != "" {
		env["GIT_ACCESS_TOKEN"] = req.GitAccessToken
	}

	// Model selection
	if a.model != "" {
		env["CLAUDE_MODEL"] = a.model
	}

	// OpenSpec configuration (opsx_plan / opsx_apply modes)
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

	// 3. Build executor request
	return &ExecutorRequest{
		Image:   a.image,
		Command: nil, // Use image's ENTRYPOINT
		Env:     env,
		WorkDir: "/workspace",
		Timeout: 10 * time.Minute,
	}, nil
}

func (a *ClaudeCodeAdapter) ParseResponse(resp *ExecutorResponse) (*AgentResponse, error) {
	if resp.ExitCode != 0 {
		return nil, fmt.Errorf("claude execution failed (exit code %d): %s", resp.ExitCode, resp.Stderr)
	}

	// Parse JSON output from claude --output-format json
	var claudeOutput ClaudeOutput
	if err := json.Unmarshal([]byte(resp.Stdout), &claudeOutput); err != nil {
		// If not valid JSON, wrap the raw output
		return &AgentResponse{
			Output: map[string]any{
				"result":  resp.Stdout,
				"raw":     true,
				"summary": "Agent execution completed (non-JSON output)",
			},
			Metrics: &ExecutionMetrics{
				DurationMs: 0,
			},
			GitMetadata: resp.GitMetadata, // Pass through even on parse failure
		}, nil
	}

	// Convert ClaudeOutput to AgentResponse
	output := make(map[string]any)
	if claudeOutput.Result != nil {
		output = claudeOutput.Result
	}
	if claudeOutput.Summary != "" {
		output["summary"] = claudeOutput.Summary
	}
	if len(claudeOutput.ChangedFiles) > 0 {
		output["changed_files"] = claudeOutput.ChangedFiles
	}
	if claudeOutput.Plan != "" {
		output["plan"] = claudeOutput.Plan
	}
	if claudeOutput.Report != "" {
		output["report"] = claudeOutput.Report
	}
	if claudeOutput.Passed != nil {
		output["passed"] = *claudeOutput.Passed
	}
	if len(claudeOutput.Issues) > 0 {
		output["issues"] = claudeOutput.Issues
	}

	metrics := &ExecutionMetrics{
		TokenInput:  claudeOutput.TokensIn,
		TokenOutput: claudeOutput.TokensOut,
		DurationMs:  claudeOutput.DurationMs,
	}

	return &AgentResponse{
		Output:      output,
		Metrics:     metrics,
		GitMetadata: resp.GitMetadata, // Pass through from executor
	}, nil
}

// ClaudeOutput represents the JSON output from claude CLI
type ClaudeOutput struct {
	Result       map[string]any `json:"result,omitempty"`
	Summary      string         `json:"summary,omitempty"`
	Plan         string         `json:"plan,omitempty"`
	Report       string         `json:"report,omitempty"`
	ChangedFiles []string       `json:"changed_files,omitempty"`
	Passed       *bool          `json:"passed,omitempty"`
	Issues       []any          `json:"issues,omitempty"`
	TokensIn     int            `json:"tokens_in,omitempty"`
	TokensOut    int            `json:"tokens_out,omitempty"`
	DurationMs   int64          `json:"duration_ms,omitempty"`
}

// generateFeatureBranch creates a feature branch name from task title
// Format: agent/{task-title-slug}
// Supports Chinese characters via pinyin conversion
// If gitBranch is already set and not "main", use it as-is
func generateFeatureBranch(taskTitle, gitBranch string) string {
	// If git_branch is already set and not main, use it
	if gitBranch != "" && gitBranch != "main" {
		return gitBranch
	}

	// Convert Chinese characters to pinyin, keep ASCII as-is
	a := gopinyin.NewArgs()
	a.Style = gopinyin.Normal // no tone marks
	pinyinResult := gopinyin.Pinyin(taskTitle, a)

	var parts []string
	pinyinIdx := 0
	for _, r := range taskTitle {
		if r >= 0x4e00 && r <= 0x9fff { // CJK character
			if pinyinIdx < len(pinyinResult) && len(pinyinResult[pinyinIdx]) > 0 {
				parts = append(parts, pinyinResult[pinyinIdx][0])
			}
			pinyinIdx++
		} else if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			parts = append(parts, strings.ToLower(string(r)))
		} else if r == ' ' || r == '-' || r == '_' {
			parts = append(parts, "-")
		}
		// skip other characters
	}

	slug := strings.Join(parts, "-")
	// Clean up consecutive hyphens
	reg := regexp.MustCompile(`-+`)
	slug = reg.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")

	// Limit to 30 characters (excluding agent/ prefix)
	if len(slug) > 30 {
		slug = slug[:30]
	}
	slug = strings.TrimRight(slug, "-")

	if slug == "" {
		slug = "task"
	}

	return "agent/" + slug
}

package agent

import (
	"context"
	"time"
)

// ─── Domain Models ───

// AgentRequest represents a request to an agent
type AgentRequest struct {
	TaskID          string         `json:"task_id"`
	FlowRunID       string         `json:"flow_run_id"`
	NodeID          string         `json:"node_id"`
	Mode            string         `json:"mode"` // spec / execute / review / opsx_plan / opsx_apply
	Prompt          string         `json:"prompt"`
	Context         map[string]any `json:"context"`
	WorkDir         string         `json:"work_dir"`
	GitBranch       string         `json:"git_branch"`
	GitRepoURL      string         `json:"git_repo_url"`
	GitAccessToken  string         `json:"git_access_token"`
	TaskTitle       string         `json:"task_title"`
	NodeName        string         `json:"node_name"`
	RolePrompt      string         `json:"role_prompt"`
	Feedback        string         `json:"feedback"`
	Model           string         `json:"model"` // Request-level model (highest priority)
	OpsxConfig      *OpsxConfig    `json:"opsx,omitempty"`
}

// OpsxConfig holds OpenSpec-specific configuration for opsx_plan / opsx_apply modes
type OpsxConfig struct {
	ChangeName    string `json:"change_name" yaml:"change_name"`
	Schema        string `json:"schema,omitempty" yaml:"schema"`
	InitIfMissing bool   `json:"init_if_missing,omitempty" yaml:"init_if_missing"`
	Action        string `json:"action,omitempty" yaml:"action"` // "", "archive", "sync"
}

// AgentResponse represents the response from an agent
type AgentResponse struct {
	Output        map[string]any    `json:"output"`
	Metrics       *ExecutionMetrics `json:"metrics,omitempty"`
	GitMetadata   *GitMetadata      `json:"git_metadata,omitempty"`
	ArtifactFiles []ArtifactFile    `json:"artifact_files,omitempty"` // 新增：产物文件列表
}

// ArtifactFile represents a single artifact file to be created
type ArtifactFile struct {
	Path    string `json:"path"`    // 相对路径，如 "openspec/changes/xxx/proposal.md"
	Type    string `json:"type"`    // artifact 类型：spec, design, tasks, proposal
	Title   string `json:"title"`   // 显示标题
	Content string `json:"content"` // 文件内容（可选，如果为空则后续从 Git 读取）
}

// ChangedFileDetail represents a file change with its status
type ChangedFileDetail struct {
	Path   string `json:"path"`
	Status string `json:"status"` // "added", "modified", "deleted", "renamed"
}

// GitMetadata holds Git operation results from agent execution
type GitMetadata struct {
	Branch             string              `json:"branch"`
	BaseBranch         string              `json:"base_branch,omitempty"`
	Commit             string              `json:"commit"`
	CommitMessage      string              `json:"commit_message,omitempty"`
	PrUrl              string              `json:"pr_url,omitempty"`
	PrNumber           int                 `json:"pr_number,omitempty"`
	ChangedFiles       []string            `json:"changed_files,omitempty"`        // 保留，向后兼容
	RepoURL            string              `json:"repo_url,omitempty"`             // 新增：仓库 HTTPS URL
	ChangedFilesDetail []ChangedFileDetail `json:"changed_files_detail,omitempty"` // 新增：含变更类型的文件列表
}

// ExecutionMetrics tracks agent execution metrics
type ExecutionMetrics struct {
	TokenInput  int   `json:"token_input"`
	TokenOutput int   `json:"token_output"`
	DurationMs  int64 `json:"duration_ms"`
}

// ─── Adapter Interface (unchanged, backward compatible) ───

// Adapter is the interface all agent adapters must implement
type Adapter interface {
	Name() string
	Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error)
}

// ─── Type Adapter + Executor (two-layer architecture) ───

// TypeAdapter is the semantic layer: builds prompts, parses output
type TypeAdapter interface {
	Name() string
	BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error)
	ParseResponse(execResp *ExecutorResponse) (*AgentResponse, error)
}

// Executor is the runtime layer: actually runs the agent
type Executor interface {
	Kind() string // "docker" / "cli" / "http"
	Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error)
}

// ExecutorRequest is the runtime-layer request
type ExecutorRequest struct {
	Image   string            // Docker image name
	Command []string          // Command to run inside container
	Env     map[string]string // Environment variables
	WorkDir string            // Working directory
	Timeout time.Duration     // Execution timeout
}

// ExecutorResponse is the runtime-layer response
type ExecutorResponse struct {
	ExitCode    int
	Stdout      string
	Stderr      string
	GitMetadata *GitMetadata // Extracted from /output/git_metadata.json in container
}

// CombinedAdapter bridges TypeAdapter + Executor into the Adapter interface
type CombinedAdapter struct {
	typeAdapter TypeAdapter
	executor    Executor
}

// NewCombinedAdapter creates a combined adapter from a type adapter and executor
func NewCombinedAdapter(ta TypeAdapter, exec Executor) *CombinedAdapter {
	return &CombinedAdapter{typeAdapter: ta, executor: exec}
}

func (a *CombinedAdapter) Name() string { return a.typeAdapter.Name() }

// Executor returns the underlying executor (for injecting callbacks)
func (a *CombinedAdapter) Executor() Executor { return a.executor }

func (a *CombinedAdapter) Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error) {
	execReq, err := a.typeAdapter.BuildRequest(ctx, req)
	if err != nil {
		return nil, err
	}
	execResp, err := a.executor.Execute(ctx, execReq)
	if err != nil {
		return nil, err
	}
	return a.typeAdapter.ParseResponse(execResp)
}

// RoleMapping maps a role to a specific provider and model
type RoleMapping struct {
	ProviderID string
	ModelName  string
}

// Registry manages available agent adapters
type Registry struct {
	adapters map[string]Adapter      // provider_id → adapter (new)
	legacy   map[string]Adapter      // name → adapter (backward compat)
	roles    map[string]*RoleMapping // role → mapping
}

// NewRegistry creates a new agent registry
func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[string]Adapter),
		legacy:   make(map[string]Adapter),
		roles:    make(map[string]*RoleMapping),
	}
}

// Register adds an adapter to the registry by name (backward compat)
func (r *Registry) Register(adapter Adapter) {
	r.legacy[adapter.Name()] = adapter
}

// RegisterProvider adds an adapter to the registry by provider ID
func (r *Registry) RegisterProvider(providerID string, adapter Adapter) {
	r.adapters[providerID] = adapter
}

// MapRole maps an agent role to an adapter name (backward compat)
func (r *Registry) MapRole(role, adapterName string) {
	r.roles[role] = &RoleMapping{ProviderID: adapterName}
}

// MapRoleToProvider maps an agent role to a provider ID and model name
func (r *Registry) MapRoleToProvider(role, providerID, modelName string) {
	r.roles[role] = &RoleMapping{
		ProviderID: providerID,
		ModelName:  modelName,
	}
}

// GetAdapter returns the adapter for a given role (backward compat)
func (r *Registry) GetAdapter(role string) (Adapter, error) {
	mapping, ok := r.roles[role]
	if !ok {
		return nil, &NoAdapterError{Role: role}
	}
	// Try provider-based lookup first
	if adapter, ok := r.adapters[mapping.ProviderID]; ok {
		return adapter, nil
	}
	// Fallback to legacy name-based lookup
	if adapter, ok := r.legacy[mapping.ProviderID]; ok {
		return adapter, nil
	}
	return nil, &NoAdapterError{Role: role}
}

// GetAdapterByProvider returns the adapter for a given provider ID (direct lookup)
func (r *Registry) GetAdapterByProvider(providerID string) (Adapter, bool) {
	if adapter, ok := r.adapters[providerID]; ok {
		return adapter, true
	}
	return nil, false
}

// GetAdapterForRole returns the adapter and model name for a given role
func (r *Registry) GetAdapterForRole(role string) (Adapter, string, error) {
	mapping, ok := r.roles[role]
	if !ok {
		return nil, "", &NoAdapterError{Role: role}
	}
	// Try provider-based lookup first
	if adapter, ok := r.adapters[mapping.ProviderID]; ok {
		return adapter, mapping.ModelName, nil
	}
	// Fallback to legacy name-based lookup
	if adapter, ok := r.legacy[mapping.ProviderID]; ok {
		return adapter, mapping.ModelName, nil
	}
	return nil, "", &NoAdapterError{Role: role}
}

// NoAdapterError is returned when no adapter is found for a role
type NoAdapterError struct {
	Role string
}

func (e *NoAdapterError) Error() string {
	return "no agent adapter found for role: " + e.Role
}

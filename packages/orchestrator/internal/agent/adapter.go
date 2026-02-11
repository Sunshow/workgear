package agent

import (
	"context"
	"time"
)

// ─── Domain Models ───

// AgentRequest represents a request to an agent
type AgentRequest struct {
	TaskID     string         `json:"task_id"`
	FlowRunID  string         `json:"flow_run_id"`
	NodeID     string         `json:"node_id"`
	Mode       string         `json:"mode"` // spec / execute / review
	Prompt     string         `json:"prompt"`
	Context    map[string]any `json:"context"`
	WorkDir    string         `json:"work_dir"`
	GitBranch  string         `json:"git_branch"`
	GitRepoURL string         `json:"git_repo_url"`
	RolePrompt string         `json:"role_prompt"`
	Feedback   string         `json:"feedback"`
}

// AgentResponse represents the response from an agent
type AgentResponse struct {
	Output  map[string]any    `json:"output"`
	Metrics *ExecutionMetrics `json:"metrics,omitempty"`
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
	ExitCode int
	Stdout   string
	Stderr   string
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

// Registry manages available agent adapters
type Registry struct {
	adapters map[string]Adapter // name → adapter
	roles    map[string]string  // role → adapter name
}

// NewRegistry creates a new agent registry
func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[string]Adapter),
		roles:    make(map[string]string),
	}
}

// Register adds an adapter to the registry
func (r *Registry) Register(adapter Adapter) {
	r.adapters[adapter.Name()] = adapter
}

// MapRole maps an agent role to an adapter name
func (r *Registry) MapRole(role, adapterName string) {
	r.roles[role] = adapterName
}

// GetAdapter returns the adapter for a given role
func (r *Registry) GetAdapter(role string) (Adapter, error) {
	adapterName, ok := r.roles[role]
	if !ok {
		return nil, &NoAdapterError{Role: role}
	}
	adapter, ok := r.adapters[adapterName]
	if !ok {
		return nil, &NoAdapterError{Role: role}
	}
	return adapter, nil
}

// NoAdapterError is returned when no adapter is found for a role
type NoAdapterError struct {
	Role string
}

func (e *NoAdapterError) Error() string {
	return "no agent adapter found for role: " + e.Role
}

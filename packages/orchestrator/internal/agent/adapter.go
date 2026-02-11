package agent

import "context"

// AgentRequest represents a request to an agent
type AgentRequest struct {
	TaskID    string         `json:"task_id"`
	FlowRunID string        `json:"flow_run_id"`
	NodeID    string         `json:"node_id"`
	Mode      string         `json:"mode"` // spec / execute / review
	Prompt    string         `json:"prompt"`
	Context   map[string]any `json:"context"`
	WorkDir   string         `json:"work_dir"`
	GitBranch string         `json:"git_branch"`
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

// Adapter is the interface all agent adapters must implement
type Adapter interface {
	Name() string
	Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error)
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
		// Default to mock
		adapterName = "mock"
	}
	adapter, ok := r.adapters[adapterName]
	if !ok {
		// Fallback to mock if available
		if mock, exists := r.adapters["mock"]; exists {
			return mock, nil
		}
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

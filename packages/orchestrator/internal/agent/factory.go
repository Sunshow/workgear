package agent

import (
	"fmt"

	"go.uber.org/zap"
)

// AgentFactory creates Adapter instances for a specific agent type.
// Each agent type implements this interface to encapsulate its own
// config field extraction, TypeAdapter creation, and Executor setup.
type AgentFactory interface {
	// AgentType returns the agent type name (e.g. "claude-code", "codex")
	AgentType() string
	// CreateAdapter builds a complete Adapter (TypeAdapter + Executor) from provider config
	CreateAdapter(logger *zap.SugaredLogger, providerID string, config map[string]any, modelName string) (Adapter, error)
}

// AgentFactoryRegistry manages all registered AgentFactory instances
type AgentFactoryRegistry struct {
	factories map[string]AgentFactory // agentType → factory
}

// NewAgentFactoryRegistry creates a new factory registry
func NewAgentFactoryRegistry() *AgentFactoryRegistry {
	return &AgentFactoryRegistry{
		factories: make(map[string]AgentFactory),
	}
}

// Register adds a factory to the registry
func (r *AgentFactoryRegistry) Register(f AgentFactory) {
	r.factories[f.AgentType()] = f
}

// Get returns the factory for a given agent type
func (r *AgentFactoryRegistry) Get(agentType string) (AgentFactory, bool) {
	f, ok := r.factories[agentType]
	return f, ok
}

// CreateAdapter is a convenience method that looks up the factory and creates the adapter
func (r *AgentFactoryRegistry) CreateAdapter(logger *zap.SugaredLogger, agentType, providerID string, config map[string]any, modelName string) (Adapter, error) {
	f, ok := r.factories[agentType]
	if !ok {
		return nil, fmt.Errorf("unsupported agent type: %s", agentType)
	}
	return f.CreateAdapter(logger, providerID, config, modelName)
}

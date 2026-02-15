package agent

import (
	"go.uber.org/zap"
)

// ClaudeCodeFactory creates adapters for claude-code agent type
type ClaudeCodeFactory struct {
	PromptBuilder *PromptBuilder
}

func (f *ClaudeCodeFactory) AgentType() string { return "claude-code" }

func (f *ClaudeCodeFactory) CreateAdapter(logger *zap.SugaredLogger, providerID string, config map[string]any, modelName string) (Adapter, error) {
	// Claude uses auth_token and base_url from provider config
	authToken, _ := config["auth_token"].(string)
	baseURL, _ := config["base_url"].(string)

	dockerExec, err := NewDockerExecutor(logger)
	if err != nil {
		return nil, err
	}

	adapter := NewClaudeCodeAdapter(f.PromptBuilder, providerID, baseURL, authToken, modelName)
	return NewCombinedAdapter(adapter, dockerExec), nil
}

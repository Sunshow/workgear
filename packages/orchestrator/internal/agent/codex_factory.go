package agent

import (
	"go.uber.org/zap"
)

// CodexFactory creates adapters for codex agent type
type CodexFactory struct {
	PromptBuilder *PromptBuilder
}

func (f *CodexFactory) AgentType() string { return "codex" }

func (f *CodexFactory) CreateAdapter(logger *zap.SugaredLogger, providerID string, config map[string]any, modelName string) (Adapter, error) {
	// Codex uses api_key and base_url from provider config
	apiKey, _ := config["api_key"].(string)
	baseURL, _ := config["base_url"].(string)

	dockerExec, err := NewDockerExecutorWithImage(logger, "workgear/agent-codex:latest")
	if err != nil {
		return nil, err
	}

	adapter := NewCodexAdapter(f.PromptBuilder, providerID, apiKey, baseURL, modelName)
	return NewCombinedAdapter(adapter, dockerExec), nil
}

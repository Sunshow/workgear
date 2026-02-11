package agent

import (
	"context"
	"fmt"
	"time"
)

// MockAdapter returns simulated agent responses for testing
type MockAdapter struct{}

func NewMockAdapter() *MockAdapter {
	return &MockAdapter{}
}

func (m *MockAdapter) Name() string {
	return "mock"
}

func (m *MockAdapter) Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error) {
	start := time.Now()

	// Simulate execution delay
	select {
	case <-time.After(2 * time.Second):
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	duration := time.Since(start).Milliseconds()

	var output map[string]any

	switch req.Mode {
	case "spec":
		output = map[string]any{
			"plan":     fmt.Sprintf("[Mock] Implementation plan for node '%s'", req.NodeID),
			"files":    []string{"src/main.ts", "src/utils.ts"},
			"estimate": "2 hours",
			"summary":  "This is a mock spec output. In production, the agent would analyze the codebase and produce a detailed plan.",
		}
	case "execute":
		output = map[string]any{
			"result":        fmt.Sprintf("[Mock] Execution completed for node '%s'", req.NodeID),
			"changed_files": []string{"src/main.ts"},
			"summary":       "This is a mock execution output. In production, the agent would make actual code changes.",
		}
	case "review":
		output = map[string]any{
			"passed":  true,
			"issues":  []any{},
			"report":  fmt.Sprintf("[Mock] Code review passed for node '%s'. No issues found.", req.NodeID),
			"summary": "This is a mock review output.",
		}
	default:
		output = map[string]any{
			"result":  fmt.Sprintf("[Mock] Agent task completed for node '%s' (mode: %s)", req.NodeID, req.Mode),
			"summary": "Default mock output.",
		}
	}

	return &AgentResponse{
		Output: output,
		Metrics: &ExecutionMetrics{
			TokenInput:  1200,
			TokenOutput: 3500,
			DurationMs:  duration,
		},
	}, nil
}

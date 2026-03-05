package agent

import (
	"fmt"
	"os"
	"path/filepath"
)

// writePromptToFile writes the agent prompt to a temporary file and returns the file path.
// This avoids hitting the OS ARG_MAX limit when passing large prompts via environment variables.
// The caller is responsible for cleaning up the file (executor.go handles this in defer).
func writePromptToFile(prompt, nodeID string) (string, error) {
	dir := os.TempDir()
	filename := fmt.Sprintf("agent-prompt-%s.txt", nodeID)
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte(prompt), 0600); err != nil {
		return "", fmt.Errorf("write prompt file: %w", err)
	}
	return path, nil
}

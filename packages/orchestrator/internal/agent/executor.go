package agent

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"go.uber.org/zap"
)

// ClaudeStreamEvent represents a single event from Claude CLI stream-json output
type ClaudeStreamEvent struct {
	Type      string         `json:"type"`                // "system", "assistant", "user", "result"
	Subtype   string         `json:"subtype,omitempty"`   // "init", "success", etc.
	Message   *StreamMessage `json:"message,omitempty"`   // Message content (for assistant/user types)
	Result    any            `json:"result,omitempty"`    // Final result (for result type)
	SessionID string         `json:"session_id,omitempty"`
	Timestamp int64          `json:"timestamp"` // Unix milliseconds (added by us)
}

// StreamMessage represents the message field in assistant/user events
type StreamMessage struct {
	Role    string         `json:"role,omitempty"`
	Content []ContentBlock `json:"content,omitempty"`
}

// ContentBlock represents a single content block within a message
type ContentBlock struct {
	Type      string         `json:"type"`                  // "text", "tool_use", "tool_result"
	Text      string         `json:"text,omitempty"`        // For "text" type
	ID        string         `json:"id,omitempty"`          // For "tool_use" type
	Name      string         `json:"name,omitempty"`        // For "tool_use" type
	Input     map[string]any `json:"input,omitempty"`       // For "tool_use" type
	ToolUseID string         `json:"tool_use_id,omitempty"` // For "tool_result" type
	Content   any            `json:"content,omitempty"`     // For "tool_result" type (string or array)
}

// DockerExecutor runs agent tasks inside Docker containers
type DockerExecutor struct {
	cli          *client.Client
	defaultImage string
	logger       *zap.SugaredLogger
}

// NewDockerExecutor creates a new Docker executor
func NewDockerExecutor(logger *zap.SugaredLogger) (*DockerExecutor, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("create docker client: %w", err)
	}

	return &DockerExecutor{
		cli:          cli,
		defaultImage: "workgear/agent-claude:latest",
		logger:       logger,
	}, nil
}

// NewDockerExecutorWithImage creates a Docker executor with a custom default image
func NewDockerExecutorWithImage(logger *zap.SugaredLogger, defaultImage string) (*DockerExecutor, error) {
	exec, err := NewDockerExecutor(logger)
	if err != nil {
		return nil, err
	}
	if defaultImage != "" {
		exec.defaultImage = defaultImage
	}
	return exec, nil
}

func (e *DockerExecutor) Kind() string { return "docker" }

func (e *DockerExecutor) Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error) {
	imageName := req.Image
	if imageName == "" {
		imageName = e.defaultImage
	}

	// Set worktree env before building envList so it's included in container env
	if req.WorktreePath != "" {
		if req.Env == nil {
			req.Env = make(map[string]string)
		}
		req.Env["USE_WORKTREE"] = "true"
	}

	// Build environment variables list
	envList := make([]string, 0, len(req.Env))
	for k, v := range req.Env {
		envList = append(envList, k+"="+v)
	}

	// Set timeout
	timeout := req.Timeout
	if timeout == 0 {
		timeout = 10 * time.Minute
	}
	e.logger.Infow("DEBUG: container timeout",
		"req.Timeout", req.Timeout.String(),
		"effective_timeout", timeout.String(),
	)
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// 1. Ensure image exists locally
	if err := e.ensureImage(execCtx, imageName); err != nil {
		return nil, fmt.Errorf("ensure image %s: %w", imageName, err)
	}

	// 2. Create container
	containerConfig := &container.Config{
		Image: imageName,
		Cmd:   req.Command, // nil means use image's ENTRYPOINT
		Env:   envList,
	}
	if req.WorkDir != "" {
		containerConfig.WorkingDir = req.WorkDir
	}

	containerName := fmt.Sprintf("workgear-agent-%s-%d", req.Env["TASK_ID"], time.Now().UnixMilli())

	e.logger.Infow("Creating agent container",
		"image", imageName,
		"container", containerName,
		"timeout", timeout,
	)

	// Build volume mounts
	var binds []string

	// Mount prompt file (avoids ARG_MAX limit for large prompts)
	if req.PromptFilePath != "" {
		binds = append(binds, req.PromptFilePath+":/tmp/agent_prompt.txt:ro")
		e.logger.Debugw("Mounting prompt file", "host_path", req.PromptFilePath)
	}

	if req.WorktreePath != "" {
		binds = append(binds, req.WorktreePath+":/workspace:rw")
		e.logger.Debugw("Mounting worktree volume", "host_path", req.WorktreePath)

		// Mount bare repo so git worktree cross-references resolve inside the container.
		// Worktree's .git file contains an absolute host path to bare.git/worktrees/node-xxx;
		// we mount bare repo at /repo.git and rewrite the .git file to use the container path.
		if req.BareRepoPath != "" {
			binds = append(binds, req.BareRepoPath+":/repo.git:rw")
			e.logger.Debugw("Mounting bare repo volume", "host_path", req.BareRepoPath)

			if err := e.rewriteWorktreeGitPaths(req.WorktreePath, req.BareRepoPath, "/repo.git"); err != nil {
				e.logger.Warnw("Failed to rewrite worktree git paths", "error", err)
			}
		}
	}
	if req.DepsPath != "" {
		binds = append(binds, req.DepsPath+":/deps:rw")
		e.logger.Debugw("Mounting deps cache volume", "host_path", req.DepsPath)
	}

	var hostConfig *container.HostConfig
	if len(binds) > 0 {
		hostConfig = &container.HostConfig{Binds: binds}
	}

	createResp, err := e.cli.ContainerCreate(execCtx, containerConfig, hostConfig, nil, nil, containerName)
	if err != nil {
		return nil, fmt.Errorf("create container: %w", err)
	}
	containerID := createResp.ID

	// Ensure cleanup
	defer func() {
		// Clean up prompt temp file
		if req.PromptFilePath != "" {
			if err := os.Remove(req.PromptFilePath); err != nil {
				e.logger.Debugw("Failed to remove prompt temp file", "path", req.PromptFilePath, "error", err)
			}
		}

		// Restore worktree .git paths back to host paths (so host-side git operations still work)
		if req.WorktreePath != "" && req.BareRepoPath != "" {
			if err := e.rewriteWorktreeGitPaths(req.WorktreePath, "/repo.git", req.BareRepoPath); err != nil {
				e.logger.Warnw("Failed to restore worktree git paths", "error", err)
			}
		}

		removeCtx, removeCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer removeCancel()
		if err := e.cli.ContainerRemove(removeCtx, containerID, container.RemoveOptions{Force: true}); err != nil {
			e.logger.Warnw("Failed to remove container", "container_id", containerID, "error", err)
		} else {
			e.logger.Infow("Removed agent container", "container_id", containerID[:12])
		}
	}()

	// 3. Start container
	if err := e.cli.ContainerStart(execCtx, containerID, container.StartOptions{}); err != nil {
		return nil, fmt.Errorf("start container: %w", err)
	}

	e.logger.Infow("Started agent container", "container_id", containerID[:12])

	// 4. Start real-time log streaming (goroutine reads logs as they arrive)
	logStreamDone := make(chan struct{})
	go func() {
		defer close(logStreamDone)
		if err := e.streamLogs(execCtx, containerID, req.OnLogEvent); err != nil {
			e.logger.Debugw("Log stream ended", "error", err)
		}
	}()

	// 5. Wait for completion
	statusCh, errCh := e.cli.ContainerWait(execCtx, containerID, container.WaitConditionNotRunning)

	var exitCode int
	select {
	case err := <-errCh:
		if err != nil {
			return nil, fmt.Errorf("wait container: %w", err)
		}
	case status := <-statusCh:
		exitCode = int(status.StatusCode)
		if status.Error != nil {
			e.logger.Warnw("Container exited with error", "error", status.Error.Message, "exit_code", exitCode)
		}
	case <-execCtx.Done():
		// Timeout — kill the container
		killCtx, killCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer killCancel()
		_ = e.cli.ContainerKill(killCtx, containerID, "SIGKILL")
		return nil, fmt.Errorf("container execution timed out after %s", timeout)
	}

	// 6. Wait for log stream to finish (ensure all logs are processed)
	<-logStreamDone

	// 7. Collect logs (final stdout/stderr for result parsing)
	stdout, stderr, err := e.collectLogs(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("collect logs: %w", err)
	}

	// 8. Extract git metadata from container (before cleanup)
	gitMetadata := e.extractGitMetadata(ctx, containerID)

	e.logger.Infow("Agent container finished",
		"container_id", containerID[:12],
		"exit_code", exitCode,
		"stdout_len", len(stdout),
		"stderr_len", len(stderr),
		"has_git_metadata", gitMetadata != nil,
	)

	return &ExecutorResponse{
		ExitCode:    exitCode,
		Stdout:      stdout,
		Stderr:      stderr,
		GitMetadata: gitMetadata,
	}, nil
}

// streamLogs reads container logs in real-time and parses stream-json events
func (e *DockerExecutor) streamLogs(ctx context.Context, containerID string, onLogEvent LogEventCallback) error {
	logReader, err := e.cli.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true, // Real-time streaming
		Timestamps: false,
	})
	if err != nil {
		return err
	}
	defer logReader.Close()

	// Use io.Pipe to demultiplex Docker's multiplexed stream format
	// entrypoint.sh redirects stream-json output to stderr, so we read from stderrWriter
	stderrReader, stderrWriter := io.Pipe()

	// Demultiplex in a goroutine: stdout goes to discard, stderr goes to pipe
	go func() {
		_, _ = stdcopy.StdCopy(io.Discard, stderrWriter, logReader)
		stderrWriter.Close()
	}()

	// Read stderr line by line (where stream-json events are written)
	scanner := bufio.NewScanner(stderrReader)
	// Increase buffer size for potentially large JSON lines
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()

		// Debug: print raw line (truncate to avoid log flooding)
		if len(line) > 500 {
			e.logger.Debugw("Raw stderr line (truncated)", "line", line[:500]+"...")
		} else {
			e.logger.Debugw("Raw stderr line", "line", line)
		}

		// Try to parse as stream-json event (only if line looks like JSON)
		if len(line) == 0 || line[0] != '{' {
			continue
		}

		var event ClaudeStreamEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			e.logger.Debugw("Failed to parse stream-json event", "error", err.Error())
			continue
		}

		// Skip events without a type
		if event.Type == "" {
			truncated := line
			if len(truncated) > 200 {
				truncated = truncated[:200]
			}
			e.logger.Debugw("Skipping event with empty type", "raw", truncated)
			continue
		}

		// Add timestamp
		event.Timestamp = time.Now().UnixMilli()

		// Log parsed event
		contentBlockCount := 0
		if event.Message != nil {
			contentBlockCount = len(event.Message.Content)
		}
		e.logger.Infow("Parsed stream event",
			"type", event.Type,
			"subtype", event.Subtype,
			"content_blocks", contentBlockCount,
			"has_result", event.Result != nil,
		)

		// Trigger callback
		if onLogEvent != nil {
			onLogEvent(event)
		} else {
			e.logger.Warnw("Log event callback not set, event dropped")
		}
	}

	return scanner.Err()
}

// ensureImage checks if the image exists locally, pulls if not
func (e *DockerExecutor) ensureImage(ctx context.Context, imageName string) error {
	_, _, err := e.cli.ImageInspectWithRaw(ctx, imageName)
	if err == nil {
		return nil // Image exists
	}

	e.logger.Infow("Pulling agent image", "image", imageName)
	reader, err := e.cli.ImagePull(ctx, imageName, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("pull image: %w", err)
	}
	defer reader.Close()
	// Consume the pull output
	_, _ = io.Copy(io.Discard, reader)

	return nil
}

// collectLogs retrieves stdout and stderr from a stopped container
func (e *DockerExecutor) collectLogs(ctx context.Context, containerID string) (string, string, error) {
	logReader, err := e.cli.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
	})
	if err != nil {
		return "", "", err
	}
	defer logReader.Close()

	var stdoutBuf, stderrBuf bytes.Buffer
	if _, err := stdcopy.StdCopy(&stdoutBuf, &stderrBuf, logReader); err != nil {
		return "", "", err
	}

	return stdoutBuf.String(), stderrBuf.String(), nil
}

// extractGitMetadata reads /output/git_metadata.json from a stopped container
func (e *DockerExecutor) extractGitMetadata(ctx context.Context, containerID string) *GitMetadata {
	reader, _, err := e.cli.CopyFromContainer(ctx, containerID, "/output/git_metadata.json")
	if err != nil {
		e.logger.Debugw("No git metadata file in container", "error", err)
		return nil
	}
	defer reader.Close()

	// CopyFromContainer returns a tar archive; extract the file content
	tr := tar.NewReader(reader)
	for {
		header, err := tr.Next()
		if err != nil {
			break
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		data, err := io.ReadAll(tr)
		if err != nil {
			e.logger.Warnw("Failed to read git metadata from tar", "error", err)
			return nil
		}

		var metadata GitMetadata
		if err := json.Unmarshal(data, &metadata); err != nil {
			e.logger.Warnw("Failed to parse git metadata JSON", "error", err, "raw", string(data))
			return nil
		}

		// Skip empty metadata (no git operations happened)
		if metadata.Branch == "" && metadata.Commit == "" {
			return nil
		}

		e.logger.Infow("Extracted git metadata",
			"branch", metadata.Branch,
			"commit", metadata.Commit,
			"pr_url", metadata.PrUrl,
			"changed_files", len(metadata.ChangedFiles),
		)
		return &metadata
	}

	return nil
}

// Close releases the Docker client resources
func (e *DockerExecutor) Close() error {
	return e.cli.Close()
}

// rewriteWorktreeGitPaths rewrites the cross-reference paths between a worktree and its bare repo.
// Git worktree creates two cross-references using absolute paths:
//   1. worktree/.git file → "gitdir: <bare>/worktrees/<name>"
//   2. <bare>/worktrees/<name>/gitdir → "<worktree>/.git"
// When running inside Docker, these host paths don't exist. This function replaces
// oldBarePrefix with newBarePrefix in the worktree's .git file, and updates the
// bare repo's worktree gitdir entry to point to /workspace/.git (the container mount point).
func (e *DockerExecutor) rewriteWorktreeGitPaths(worktreePath, oldBarePrefix, newBarePrefix string) error {
	// 1. Rewrite worktree/.git file: "gitdir: <host-bare>/worktrees/..." → "gitdir: <container-bare>/worktrees/..."
	dotGitPath := filepath.Join(worktreePath, ".git")
	content, err := os.ReadFile(dotGitPath)
	if err != nil {
		return fmt.Errorf("read worktree .git file: %w", err)
	}

	original := string(content)
	rewritten := strings.Replace(original, oldBarePrefix, newBarePrefix, 1)
	if rewritten != original {
		if err := os.WriteFile(dotGitPath, []byte(rewritten), 0644); err != nil {
			return fmt.Errorf("write worktree .git file: %w", err)
		}
		e.logger.Debugw("Rewrote worktree .git file", "old_prefix", oldBarePrefix, "new_prefix", newBarePrefix)
	}

	// 2. Rewrite bare/worktrees/<name>/gitdir: "<host-worktree>/.git" → "/workspace/.git"
	// Extract worktree name from the gitdir path in .git file (e.g., "gitdir: .../worktrees/node-xxx")
	gitdirLine := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(content)), "gitdir:"))
	worktreeName := filepath.Base(gitdirLine)
	bareWorktreeGitdir := filepath.Join(oldBarePrefix, "worktrees", worktreeName, "gitdir")

	gitdirContent, err := os.ReadFile(bareWorktreeGitdir)
	if err != nil {
		return fmt.Errorf("read bare worktree gitdir: %w", err)
	}

	oldWorktreeRef := strings.TrimSpace(string(gitdirContent))
	var newWorktreeRef string
	if newBarePrefix == "/repo.git" {
		// Going host→container: point to /workspace/.git
		newWorktreeRef = "/workspace/.git"
	} else {
		// Going container→host: restore original worktree path
		newWorktreeRef = filepath.Join(worktreePath, ".git")
	}

	if oldWorktreeRef != newWorktreeRef {
		if err := os.WriteFile(bareWorktreeGitdir, []byte(newWorktreeRef+"\n"), 0644); err != nil {
			return fmt.Errorf("write bare worktree gitdir: %w", err)
		}
		e.logger.Debugw("Rewrote bare worktree gitdir", "old", oldWorktreeRef, "new", newWorktreeRef)
	}

	return nil
}

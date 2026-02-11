package agent

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"go.uber.org/zap"
)

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
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// 1. Ensure image exists locally
	if err := e.ensureImage(execCtx, imageName); err != nil {
		return nil, fmt.Errorf("ensure image %s: %w", imageName, err)
	}

	// 2. Create container
	cmd := req.Command
	if len(cmd) == 0 {
		cmd = []string{"/entrypoint.sh"}
	}

	containerConfig := &container.Config{
		Image: imageName,
		Cmd:   cmd,
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

	createResp, err := e.cli.ContainerCreate(execCtx, containerConfig, nil, nil, nil, containerName)
	if err != nil {
		return nil, fmt.Errorf("create container: %w", err)
	}
	containerID := createResp.ID

	// Ensure cleanup
	defer func() {
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

	// 4. Wait for completion
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

	// 5. Collect logs
	stdout, stderr, err := e.collectLogs(ctx, containerID)
	if err != nil {
		return nil, fmt.Errorf("collect logs: %w", err)
	}

	e.logger.Infow("Agent container finished",
		"container_id", containerID[:12],
		"exit_code", exitCode,
		"stdout_len", len(stdout),
		"stderr_len", len(stderr),
	)

	return &ExecutorResponse{
		ExitCode: exitCode,
		Stdout:   stdout,
		Stderr:   stderr,
	}, nil
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

// Close releases the Docker client resources
func (e *DockerExecutor) Close() error {
	return e.cli.Close()
}

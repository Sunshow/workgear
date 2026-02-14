# WorkGear Agent - ClaudeCode Docker Image

This Docker image provides a containerized ClaudeCode agent for WorkGear workflow execution.

## Building the Image

```bash
cd docker/agent-claude
docker build -t workgear/agent-claude:latest .
```

## Environment Variables

The container expects the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes* | Your Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | Custom API base URL (for proxies) |
| `ANTHROPIC_AUTH_TOKEN` | No* | Auth token (alternative to API key) |
| `AGENT_PROMPT` | Yes | The prompt to send to Claude |
| `AGENT_MODE` | Yes | Execution mode: `spec`, `execute`, or `review` |
| `GIT_REPO_URL` | No | Git repository URL to clone |
| `GIT_BRANCH` | No | Base branch to clone from (default: `main`) |
| `GIT_BASE_BRANCH` | No | Base branch for PR target (default: `main`) |
| `GIT_FEATURE_BRANCH` | No | Feature branch to push to (default: same as `GIT_BRANCH`) |
| `GIT_CREATE_PR` | No | Set to `"true"` to create GitHub PR after push |
| `GIT_PR_TITLE` | No | PR title (used when `GIT_CREATE_PR=true`) |
| `GIT_ACCESS_TOKEN` | No | GitHub access token for PR creation |
| `CLAUDE_MODEL` | No | Claude model to use (default: `claude-sonnet-3.5`) |
| `TASK_ID` | No | Task ID for logging |
| `NODE_ID` | No | Node ID for logging |

\* Either `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` must be set.

## Usage

### Manual Run (for testing)

```bash
docker run --rm \
  -e ANTHROPIC_API_KEY="sk-ant-xxx" \
  -e AGENT_PROMPT="Analyze this codebase and suggest improvements" \
  -e AGENT_MODE="spec" \
  -e GIT_REPO_URL="https://github.com/user/repo.git" \
  -e GIT_BRANCH="main" \
  workgear/agent-claude:latest
```

### With PR Workflow

```bash
docker run --rm \
  -e ANTHROPIC_API_KEY="sk-ant-xxx" \
  -e AGENT_PROMPT="Fix the login bug" \
  -e AGENT_MODE="execute" \
  -e GIT_REPO_URL="https://token@github.com/user/repo.git" \
  -e GIT_BASE_BRANCH="main" \
  -e GIT_FEATURE_BRANCH="agent/fix-login-bug" \
  -e GIT_CREATE_PR="true" \
  -e GIT_PR_TITLE="[Agent] Fix login bug" \
  -e GIT_ACCESS_TOKEN="ghp_xxx" \
  workgear/agent-claude:latest
```

### Orchestrator Integration

The Orchestrator automatically manages container lifecycle:
1. Creates container with appropriate environment variables
2. Starts container
3. Waits for completion (with timeout)
4. Collects logs (stdout/stderr)
5. Removes container

## Execution Flow

1. **Clone Repository** (if `GIT_REPO_URL` is set)
   - Clones the specified base branch
   - Configures git user for commits

2. **Run Claude CLI**
   - Executes `claude -p "$AGENT_PROMPT" --output-format json`
   - Captures output to `/output/result.json`

3. **Commit & Push** (if `AGENT_MODE=execute`)
   - Creates and switches to feature branch
   - Stages all changes
   - Commits with auto-generated message
   - Pushes to the feature branch

4. **Create PR** (if `GIT_CREATE_PR=true`)
   - Calls GitHub API to create pull request
   - Feature branch → Base branch
   - Idempotent (ignores 422 if PR already exists)
   - Writes PR URL to `/output/pr_url.txt`

5. **Output Result**
   - Prints JSON result to stdout
   - Orchestrator parses this output

## Output Format

The container outputs JSON to stdout:

```json
{
  "result": { ... },
  "summary": "...",
  "changed_files": ["file1.ts", "file2.ts"],
  "tokens_in": 1200,
  "tokens_out": 3500,
  "duration_ms": 45000
}
```

## Git Authentication

For private repositories, you need to configure git authentication:

### Option 1: SSH Key (Recommended)
Mount your SSH key into the container:
```bash
-v ~/.ssh:/root/.ssh:ro
```

### Option 2: HTTPS with Token
Use a personal access token in the URL:
```bash
GIT_REPO_URL="https://token@github.com/user/repo.git"
```

### Option 3: Separate Token (for PR creation)
Pass token separately for GitHub API:
```bash
GIT_ACCESS_TOKEN="ghp_xxx"
```

## PR Workflow

When `GIT_CREATE_PR=true`:

1. Agent pushes changes to `GIT_FEATURE_BRANCH`
2. Extracts `owner/repo` from `GIT_REPO_URL`
3. Calls GitHub API: `POST /repos/{owner}/{repo}/pulls`
4. Uses `GIT_ACCESS_TOKEN` for authentication
5. If PR already exists (422), silently continues
6. If PR creation fails, logs warning but doesn't fail the job

## Troubleshooting

### Container exits with code 1
- Check `ANTHROPIC_API_KEY` is valid
- Check Claude CLI is installed correctly
- Review stderr logs

### Git clone fails
- Verify repository URL is correct
- Check authentication (SSH key or token)
- Ensure branch exists

### PR creation fails
- Verify `GIT_ACCESS_TOKEN` has `repo` scope
- Check repository URL is a valid GitHub URL
- Review GitHub API error in logs

### No output
- Check `/output/result.json` exists in container
- Review Claude CLI stderr logs at `/tmp/claude_stderr.log`

## Development

To test the entrypoint script locally:
```bash
chmod +x entrypoint.sh
ANTHROPIC_API_KEY=xxx \
AGENT_PROMPT="test" \
AGENT_MODE=spec \
./entrypoint.sh
```

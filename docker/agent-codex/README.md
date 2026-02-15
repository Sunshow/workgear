# WorkGear Agent - Codex Docker Image

This Docker image provides a containerized OpenAI Codex agent for WorkGear workflow execution.

## Building the Image

```bash
cd docker/agent-codex
docker build -t workgear/agent-codex:latest .
```

## Environment Variables

The container expects the following environment variables:

### Required Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key |
| `AGENT_PROMPT` | The prompt to send to Codex |
| `AGENT_MODE` | Execution mode: `spec`, `execute`, `test`, `opsx_plan`, or `opsx_apply` |

### Model Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_MODEL` | `gpt-5.3-codex` | Model to use |
| `CODEX_MODEL_REASONING_EFFORT` | `high` | Reasoning effort level |
| `CODEX_NETWORK_ACCESS` | `enabled` | Network access mode |
| `CODEX_DISABLE_RESPONSE_STORAGE` | `true` | Disable response storage |
| `CODEX_MODEL_VERBOSITY` | `high` | Model verbosity level |

### Custom Provider Configuration

For using third-party OpenAI-compatible API endpoints:

| Variable | Description |
|----------|-------------|
| `CODEX_MODEL_PROVIDER` | Custom provider name (e.g., `sub2api`) |
| `CODEX_PROVIDER_BASE_URL` | Provider base URL (e.g., `https://sub.wududu.com`) |
| `CODEX_PROVIDER_WIRE_API` | Wire API type (default: `responses`) |
| `CODEX_PROVIDER_REQUIRES_AUTH` | Whether provider requires OpenAI auth (default: `true`) |

### Git Workflow Variables

| Variable | Description |
|----------|-------------|
| `GIT_REPO_URL` | Git repository URL to clone |
| `GIT_BRANCH` | Base branch to clone from (default: `main`) |
| `GIT_BASE_BRANCH` | Base branch for PR target (default: `main`) |
| `GIT_FEATURE_BRANCH` | Feature branch to push to (default: same as `GIT_BRANCH`) |
| `GIT_CREATE_PR` | Set to `"true"` to create GitHub PR after push |
| `GIT_PR_TITLE` | PR title (used when `GIT_CREATE_PR=true`) |
| `GIT_ACCESS_TOKEN` | GitHub access token for PR creation |

### OpenSpec Variables

| Variable | Description |
|----------|-------------|
| `OPSX_INIT_IF_MISSING` | Initialize OpenSpec if not present (default: `false`) |
| `OPSX_CHANGE_NAME` | OpenSpec change name for commit messages |
| `OPSX_ACTION` | OpenSpec action (e.g., `archive`) |

### Other Variables

| Variable | Description |
|----------|-------------|
| `CODEX_SANDBOX` | Override sandbox mode: `read-only`, `workspace-write`, `danger-full-access` |
| `TASK_ID` | Task ID for logging |
| `NODE_ID` | Node ID for logging |

## Usage

### Test Mode (Quick Validation)

Test mode runs a simple validation to ensure the setup is working correctly:

```bash
docker run --rm \
  -e OPENAI_API_KEY="sk-..." \
  -e AGENT_MODE="test" \
  workgear/agent-codex:latest
```

Expected output:
```
[agent] Starting Codex agent...
[agent] Mode: test
[agent] Test mode: running simple validation...
[agent] Running Codex CLI...
Codex agent test successful
[agent] Done.
```

### Spec Mode (Read-Only Analysis)

```bash
docker run --rm \
  -e OPENAI_API_KEY="sk-..." \
  -e AGENT_PROMPT="Analyze this codebase and suggest improvements" \
  -e AGENT_MODE="spec" \
  -e GIT_REPO_URL="https://github.com/user/repo.git" \
  -e GIT_BRANCH="main" \
  workgear/agent-codex:latest
```

### Execute Mode (Make Changes)

```bash
docker run --rm \
  -e OPENAI_API_KEY="sk-..." \
  -e AGENT_PROMPT="Fix the login bug" \
  -e AGENT_MODE="execute" \
  -e GIT_REPO_URL="https://token@github.com/user/repo.git" \
  -e GIT_BASE_BRANCH="main" \
  -e GIT_FEATURE_BRANCH="agent/fix-login-bug" \
  -e GIT_CREATE_PR="true" \
  -e GIT_PR_TITLE="[Agent] Fix login bug" \
  -e GIT_ACCESS_TOKEN="ghp_xxx" \
  workgear/agent-codex:latest
```

### Using Custom Provider (Third-Party API)

```bash
docker run --rm \
  -e OPENAI_API_KEY="sk-70c4dfc3..." \
  -e CODEX_MODEL_PROVIDER="sub2api" \
  -e CODEX_PROVIDER_BASE_URL="https://sub.wududu.com" \
  -e CODEX_PROVIDER_WIRE_API="responses" \
  -e CODEX_PROVIDER_REQUIRES_AUTH="true" \
  -e CODEX_MODEL="gpt-5.3-codex" \
  -e AGENT_PROMPT="Analyze this codebase" \
  -e AGENT_MODE="spec" \
  -e GIT_REPO_URL="https://github.com/user/repo.git" \
  workgear/agent-codex:latest
```

This will generate the following configuration files inside the container:

**~/.codex/config.toml:**
```toml
model_provider = "sub2api"
model = "gpt-5.3-codex"
model_reasoning_effort = "high"
network_access = "enabled"
disable_response_storage = true
model_verbosity = "high"

[model_providers.sub2api]
name = "sub2api"
base_url = "https://sub.wududu.com"
wire_api = "responses"
requires_openai_auth = true
```

**~/.codex/auth.json:**
```json
{
  "OPENAI_API_KEY": "sk-70c4dfc3..."
}
```

## Execution Flow

1. **Generate Configuration Files**
   - Creates `~/.codex/config.toml` with model and provider settings
   - Creates `~/.codex/auth.json` with API key

2. **Clone Repository** (if `GIT_REPO_URL` is set)
   - Clones the specified base branch
   - Configures git user for commits

3. **Run Codex CLI**
   - Executes `codex exec` with appropriate flags based on `AGENT_MODE`
   - Captures output to `/output/result.json`

4. **Commit & Push** (if `AGENT_MODE=execute`)
   - Creates and switches to feature branch
   - Stages all changes
   - Commits with auto-generated message
   - Pushes to the feature branch

5. **Create PR** (if `GIT_CREATE_PR=true`)
   - Calls GitHub API to create pull request
   - Feature branch → Base branch
   - Idempotent (ignores 422 if PR already exists)
   - Writes PR URL to `/output/pr_url.txt`

6. **Output Result**
   - Prints JSON result to stdout
   - Orchestrator parses this output

## Agent Modes

| Mode | Sandbox | Approval | Description |
|------|---------|----------|-------------|
| `test` | `read-only` | `never` | Quick validation with simple test prompt |
| `spec` | `read-only` | `never` | Analysis and planning without making changes |
| `execute` | `workspace-write` | `never` (full-auto) | Make changes and commit to git |
| `opsx_plan` | `workspace-write` | `never` (full-auto) | Generate OpenSpec artifacts |
| `opsx_apply` | `workspace-write` | `never` (full-auto) | Implement OpenSpec tasks |

## Output Format

The container outputs JSON to stdout:

```json
{
  "result": "completed",
  "summary": "...",
  "changed_files": ["file1.ts", "file2.ts"],
  "tokens_in": 1200,
  "tokens_out": 3500,
  "duration_ms": 45000
}
```

Git metadata is written to `/output/git_metadata.json`:

```json
{
  "branch": "agent/fix-bug",
  "base_branch": "main",
  "commit": "abc123...",
  "commit_message": "agent: auto-commit from workflow",
  "pr_url": "https://github.com/user/repo/pull/42",
  "pr_number": 42,
  "changed_files": ["src/file1.ts", "src/file2.ts"],
  "repo_url": "https://github.com/user/repo",
  "changed_files_detail": [
    {"path": "src/file1.ts", "status": "modified"},
    {"path": "src/file2.ts", "status": "added"}
  ]
}
```

## Git Authentication

For private repositories, you need to configure git authentication:

### Option 1: HTTPS with Token
Use a personal access token in the URL:
```bash
GIT_REPO_URL="https://token@github.com/user/repo.git"
```

### Option 2: Separate Token (for PR creation)
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

## Orchestrator Integration

The Orchestrator automatically manages container lifecycle:
1. Creates container with appropriate environment variables
2. Starts container
3. Waits for completion (with timeout)
4. Collects logs (stdout/stderr)
5. Parses `/output/result.json` and `/output/git_metadata.json`
6. Removes container

## Troubleshooting

### Container exits with code 1
- Check `OPENAI_API_KEY` is valid
- Check Codex CLI is installed correctly
- Review stderr logs

### Git clone fails
- Verify repository URL is correct
- Check authentication (token)
- Ensure branch exists

### PR creation fails
- Verify `GIT_ACCESS_TOKEN` has `repo` scope
- Check repository URL is a valid GitHub URL
- Review GitHub API error in logs

### No output
- Check `/output/result.json` exists in container
- Review Codex CLI stderr logs at `/tmp/codex_stderr.log`

### Custom provider not working
- Verify `CODEX_PROVIDER_BASE_URL` is correct
- Check API key is valid for the custom provider
- Ensure provider is OpenAI-compatible

## Configuration Reference

For more details on Codex configuration options, see:
- [Codex Config Basics](https://developers.openai.com/codex/config-basic)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference)
- [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive)

## Development

To test the entrypoint script locally:
```bash
chmod +x entrypoint.sh
OPENAI_API_KEY=xxx \
AGENT_PROMPT="test" \
AGENT_MODE=test \
./entrypoint.sh
```

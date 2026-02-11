#!/bin/bash
set -e

# ─── Configuration ───
WORKSPACE="/workspace"
RESULT_FILE="/output/result.json"

echo "[agent] Starting ClaudeCode agent..."
echo "[agent] Mode: ${AGENT_MODE:-execute}"
echo "[agent] Git repo: ${GIT_REPO_URL:-none}"
echo "[agent] Git branch: ${GIT_BRANCH:-main}"

# ─── Step 1: Clone repository (if configured) ───
if [ -n "$GIT_REPO_URL" ]; then
    echo "[agent] Cloning repository..."
    BRANCH="${GIT_BRANCH:-main}"

    # Configure git
    git config --global user.email "agent@workgear.dev"
    git config --global user.name "WorkGear Agent"

    # Clone
    git clone "$GIT_REPO_URL" --branch "$BRANCH" --single-branch --depth 50 "$WORKSPACE" 2>&1 || {
        echo "[agent] Failed to clone branch $BRANCH, trying default branch..."
        git clone "$GIT_REPO_URL" --single-branch --depth 50 "$WORKSPACE" 2>&1
        cd "$WORKSPACE"
        git checkout -b "$BRANCH"
    }
    cd "$WORKSPACE"
    echo "[agent] Repository cloned successfully."
else
    echo "[agent] No GIT_REPO_URL configured, working in empty workspace."
    cd "$WORKSPACE"
fi

# ─── Step 2: Run Claude CLI ───
echo "[agent] Running claude CLI..."

# Build claude command
CLAUDE_CMD="claude"
CLAUDE_ARGS="-p"

# Add model flag if specified
if [ -n "$CLAUDE_MODEL" ]; then
    CLAUDE_ARGS="$CLAUDE_ARGS --model $CLAUDE_MODEL"
fi

# Add output format
CLAUDE_ARGS="$CLAUDE_ARGS --output-format json"

# Execute claude with the prompt
$CLAUDE_CMD $CLAUDE_ARGS "$AGENT_PROMPT" > "$RESULT_FILE" 2>/tmp/claude_stderr.log || {
    EXIT_CODE=$?
    echo "[agent] Claude CLI exited with code $EXIT_CODE" >&2
    cat /tmp/claude_stderr.log >&2
    # Output error as JSON
    echo "{\"error\": \"claude exited with code $EXIT_CODE\", \"stderr\": \"$(cat /tmp/claude_stderr.log | head -c 2000)\"}"
    exit $EXIT_CODE
}

# ─── Step 3: Git commit & push (execute mode only) ───
if [ "$AGENT_MODE" = "execute" ] && [ -n "$GIT_REPO_URL" ]; then
    echo "[agent] Checking for file changes..."
    cd "$WORKSPACE"

    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        echo "[agent] Committing changes..."
        git add -A

        COMMIT_MSG="agent: auto-commit from workflow"
        if [ -n "$NODE_ID" ]; then
            COMMIT_MSG="agent($NODE_ID): auto-commit from workflow"
        fi

        git commit -m "$COMMIT_MSG" 2>&1
        echo "[agent] Pushing to $GIT_BRANCH..."
        git push origin "$GIT_BRANCH" 2>&1
        echo "[agent] Changes pushed successfully."
    else
        echo "[agent] No file changes detected."
    fi
fi

# ─── Step 4: Output result ───
if [ -f "$RESULT_FILE" ]; then
    cat "$RESULT_FILE"
else
    echo '{"result": "completed", "summary": "Agent execution completed but no output file generated."}'
fi

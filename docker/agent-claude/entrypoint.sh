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

# ─── Step 1.5: Initialize OpenSpec (if needed) ───
if [ "$AGENT_MODE" = "opsx_plan" ] || [ "$AGENT_MODE" = "opsx_apply" ]; then
    echo "[agent] OpenSpec mode detected: $AGENT_MODE"
    if [ ! -d "openspec" ] && [ "$OPSX_INIT_IF_MISSING" = "true" ]; then
        echo "[agent] Initializing OpenSpec..."
        openspec init --tools none --force 2>&1 || {
            echo "[agent] Warning: openspec init failed, continuing anyway..."
        }
    fi
fi

# ─── Step 2: Run Claude CLI ───
echo "[agent] Running claude CLI..."

# Build claude command
CLAUDE_CMD="claude"
CLAUDE_ARGS="-p --dangerously-skip-permissions"

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

# ─── Helper: Create GitHub PR ───
create_github_pr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local PR_TITLE="$3"
    local PR_BODY="$4"

    echo "[agent] Creating GitHub PR: $FEATURE_BRANCH -> $BASE_BRANCH"

    # Extract owner/repo from GIT_REPO_URL
    # Support: https://github.com/owner/repo.git or https://token@github.com/owner/repo.git
    local REPO_PATH=$(echo "$GIT_REPO_URL" | sed -E 's|^https?://([^@]*@)?github\.com[/:]||' | sed 's|\.git$||')
    local OWNER=$(echo "$REPO_PATH" | cut -d'/' -f1)
    local REPO=$(echo "$REPO_PATH" | cut -d'/' -f2)

    if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
        echo "[agent] Warning: Could not parse owner/repo from $GIT_REPO_URL, skipping PR creation"
        return 0
    fi

    # Extract token from URL or use GIT_ACCESS_TOKEN
    local TOKEN=""
    if [ -n "$GIT_ACCESS_TOKEN" ]; then
        TOKEN="$GIT_ACCESS_TOKEN"
    else
        TOKEN=$(echo "$GIT_REPO_URL" | sed -nE 's|^https://([^@]+)@.*|\1|p')
    fi

    if [ -z "$TOKEN" ]; then
        echo "[agent] Warning: No access token found, skipping PR creation"
        return 0
    fi

    # Call GitHub API
    local API_URL="https://api.github.com/repos/$OWNER/$REPO/pulls"
    local RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"$PR_TITLE\",\"head\":\"$FEATURE_BRANCH\",\"base\":\"$BASE_BRANCH\",\"body\":\"$PR_BODY\"}")

    local HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    local BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "201" ]; then
        local PR_URL=$(echo "$BODY" | grep -o '"html_url":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "[agent] PR created successfully: $PR_URL"
        echo "$PR_URL" > /output/pr_url.txt
    elif [ "$HTTP_CODE" = "422" ]; then
        echo "[agent] PR already exists (422), continuing..."
    else
        echo "[agent] Warning: Failed to create PR (HTTP $HTTP_CODE), but branch was pushed successfully"
        echo "[agent] Response: $BODY"
    fi
}

# ─── Step 3: Git commit & push (execute / opsx modes) ───
SHOULD_PUSH="false"
if [ "$AGENT_MODE" = "execute" ] || [ "$AGENT_MODE" = "opsx_plan" ] || [ "$AGENT_MODE" = "opsx_apply" ]; then
    SHOULD_PUSH="true"
fi

if [ "$SHOULD_PUSH" = "true" ] && [ -n "$GIT_REPO_URL" ]; then
    echo "[agent] Checking for file changes..."
    cd "$WORKSPACE"

    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        echo "[agent] Committing changes..."
        
        # Determine branches
        FEATURE_BRANCH="${GIT_FEATURE_BRANCH:-${GIT_BRANCH:-main}}"
        BASE_BRANCH="${GIT_BASE_BRANCH:-main}"

        # Build commit message based on mode
        case "$AGENT_MODE" in
            opsx_plan)
                COMMIT_MSG="spec: generate OpenSpec artifacts"
                if [ -n "$OPSX_CHANGE_NAME" ]; then
                    COMMIT_MSG="spec($OPSX_CHANGE_NAME): generate OpenSpec artifacts"
                fi
                if [ "$OPSX_ACTION" = "archive" ]; then
                    COMMIT_MSG="spec($OPSX_CHANGE_NAME): archive OpenSpec change"
                fi
                ;;
            opsx_apply)
                COMMIT_MSG="feat: implement tasks from OpenSpec"
                if [ -n "$OPSX_CHANGE_NAME" ]; then
                    COMMIT_MSG="feat($OPSX_CHANGE_NAME): implement tasks from OpenSpec"
                fi
                ;;
            *)
                COMMIT_MSG="agent: auto-commit from workflow"
                if [ -n "$NODE_ID" ]; then
                    COMMIT_MSG="agent($NODE_ID): auto-commit from workflow"
                fi
                ;;
        esac

        # Create and switch to feature branch
        git checkout -b "$FEATURE_BRANCH" 2>&1 || git checkout "$FEATURE_BRANCH" 2>&1
        git add -A
        git commit -m "$COMMIT_MSG" 2>&1

        # Push to feature branch
        echo "[agent] Pushing to $FEATURE_BRANCH..."
        git push origin "$FEATURE_BRANCH" --force 2>&1
        echo "[agent] Changes pushed successfully to $FEATURE_BRANCH"

        # Create PR if requested
        if [ "$GIT_CREATE_PR" = "true" ]; then
            PR_TITLE="${GIT_PR_TITLE:-$COMMIT_MSG}"
            create_github_pr "$FEATURE_BRANCH" "$BASE_BRANCH" "$PR_TITLE" "$COMMIT_MSG"
        fi
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

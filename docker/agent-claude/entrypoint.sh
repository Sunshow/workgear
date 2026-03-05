#!/bin/bash
set -e

# ─── Output Convention ───
# All log messages go to stderr (for debugging)
# Only the final JSON result goes to stdout (for structured parsing)
# Git metadata is written to /output/git_metadata.json

# Save original stdout (fd 3), then redirect stdout to stderr
# so all echo statements go to stderr by default
exec 3>&1 1>&2

# ─── Configuration ───
WORKSPACE="/workspace"
RESULT_FILE="/output/result.json"
GIT_METADATA_FILE="/output/git_metadata.json"

# Initialize git metadata as empty
echo '{}' > "$GIT_METADATA_FILE"

echo "[agent] Starting ClaudeCode agent..."
echo "[agent] Mode: ${AGENT_MODE:-execute}"
echo "[agent] Git repo: ${GIT_REPO_URL:-none}"
echo "[agent] Git branch: ${GIT_BRANCH:-main}"

# ─── Step 1: Clone repository (if configured) ───
if [ "$USE_WORKTREE" = "true" ]; then
    # Worktree mode: /workspace is pre-mounted by orchestrator (rw bind mount)
    echo "[agent] Worktree mode: using pre-mounted /workspace"
    cd "$WORKSPACE"

    # Configure git user inside worktree
    git config user.email "agent@workgear.dev"
    git config user.name "WorkGear Agent"

    # Auto-detect and restore dependencies
    if [ -d "/deps" ]; then
        if [ -f "$WORKSPACE/pnpm-lock.yaml" ]; then
            echo "[agent] Detected pnpm project, restoring node_modules from cache..."
            if [ -d "/deps/node_modules" ]; then
                cp -al /deps/node_modules "$WORKSPACE/node_modules" 2>/dev/null || \
                    ln -s /deps/node_modules "$WORKSPACE/node_modules" 2>/dev/null || true
            fi
            pnpm install --frozen-lockfile 2>&1 || true
            # Update deps cache
            if [ -d "$WORKSPACE/node_modules" ]; then
                rm -rf /deps/node_modules
                cp -al "$WORKSPACE/node_modules" /deps/node_modules 2>/dev/null || true
            fi
        elif [ -f "$WORKSPACE/package-lock.json" ]; then
            echo "[agent] Detected npm project, restoring node_modules from cache..."
            if [ -d "/deps/node_modules" ]; then
                cp -al /deps/node_modules "$WORKSPACE/node_modules" 2>/dev/null || \
                    ln -s /deps/node_modules "$WORKSPACE/node_modules" 2>/dev/null || true
            fi
            npm ci 2>&1 || true
            if [ -d "$WORKSPACE/node_modules" ]; then
                rm -rf /deps/node_modules
                cp -al "$WORKSPACE/node_modules" /deps/node_modules 2>/dev/null || true
            fi
        elif [ -f "$WORKSPACE/go.mod" ]; then
            echo "[agent] Detected Go project, restoring module cache..."
            export GOPATH="/deps/gopath"
            export GOMODCACHE="/deps/gopath/pkg/mod"
            go mod download 2>&1 || true
        elif [ -f "$WORKSPACE/requirements.txt" ] || [ -f "$WORKSPACE/pyproject.toml" ]; then
            echo "[agent] Detected Python project, restoring pip cache..."
            export PIP_CACHE_DIR="/deps/pip"
            if [ -f "$WORKSPACE/requirements.txt" ]; then
                pip install -r "$WORKSPACE/requirements.txt" 2>&1 || true
            fi
        fi
    fi

    echo "[agent] Worktree ready."
elif [ -n "$GIT_REPO_URL" ]; then
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

# Load prompt from file (preferred) or env var (fallback)
if [ -f /tmp/agent_prompt.txt ]; then
    AGENT_PROMPT=$(cat /tmp/agent_prompt.txt)
    echo "[agent] Loaded prompt from file (/tmp/agent_prompt.txt, $(wc -c < /tmp/agent_prompt.txt) bytes)"
elif [ -n "$AGENT_PROMPT" ]; then
    echo "[agent] Using prompt from environment variable"
else
    echo "[agent] Warning: No prompt found (neither file nor env var)"
fi

# Test mode: use built-in short prompt, skip git operations
if [ "$AGENT_MODE" = "test" ]; then
    echo "[agent] Test mode enabled — using lightweight test prompt"
    if [ -z "$AGENT_PROMPT" ] || [ "$AGENT_PROMPT" = "" ]; then
        AGENT_PROMPT='Echo "Claude agent test successful" and exit immediately'
    fi
fi

# Build claude command
CLAUDE_CMD="claude"
CLAUDE_ARGS="-p --dangerously-skip-permissions"

# Add model flag if specified
if [ -n "$CLAUDE_MODEL" ]; then
    CLAUDE_ARGS="$CLAUDE_ARGS --model $CLAUDE_MODEL"
fi

# Add output format (stream-json for real-time log streaming)
CLAUDE_ARGS="$CLAUDE_ARGS --output-format stream-json --verbose"

# Execute claude with stream-json output
# Each line is a JSON event; we forward to stderr for Docker logs real-time reading
# and extract the final "result" event for structured parsing
$CLAUDE_CMD $CLAUDE_ARGS "$AGENT_PROMPT" 2>/tmp/claude_stderr.log | while IFS= read -r line; do
    # Forward every line to stderr so Docker logs can stream it in real-time
    echo "$line" >&2

    # Parse JSON type field, save the last "result" event
    TYPE=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
    if [ "$TYPE" = "result" ]; then
        echo "$line" > "$RESULT_FILE"
    fi
done

# Check pipeline exit status
PIPE_STATUS=${PIPESTATUS[0]}
if [ "$PIPE_STATUS" != "0" ]; then
    EXIT_CODE=$PIPE_STATUS
    echo "[agent] Claude CLI exited with code $EXIT_CODE"
    cat /tmp/claude_stderr.log 2>/dev/null
    echo "{\"error\": \"claude exited with code $EXIT_CODE\", \"stderr\": \"$(cat /tmp/claude_stderr.log 2>/dev/null | head -c 2000 | sed 's/"/\\"/g')\"}" >&3
    exit $EXIT_CODE
fi

# Verify we got a result
if [ ! -f "$RESULT_FILE" ]; then
    echo "[agent] Warning: No result event received from Claude CLI"
    echo '{"error": "No result event", "summary": "Agent execution completed but no result was produced."}' > "$RESULT_FILE"
fi

echo "[agent] Claude CLI completed successfully."

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
        local PR_URL=$(echo "$BODY" | jq -r '.html_url')
        local PR_NUMBER=$(echo "$BODY" | jq -r '.number')
        echo "[agent] PR created successfully: $PR_URL (#$PR_NUMBER)"
        echo "$PR_URL" > /output/pr_url.txt
        echo "$PR_NUMBER" > /output/pr_number.txt
    elif [ "$HTTP_CODE" = "422" ]; then
        echo "[agent] PR already exists (422), looking up existing PR..."
        # Look up existing PR to extract pr_url and pr_number
        local SEARCH_URL="https://api.github.com/repos/$OWNER/$REPO/pulls?head=$OWNER:$FEATURE_BRANCH&base=$BASE_BRANCH&state=open"
        local SEARCH_RESP=$(curl -s "$SEARCH_URL" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/vnd.github+json" \
            -H "X-GitHub-Api-Version: 2022-11-28")
        local EXISTING_PR_URL=$(echo "$SEARCH_RESP" | jq -r '.[0].html_url // empty')
        local EXISTING_PR_NUMBER=$(echo "$SEARCH_RESP" | jq -r '.[0].number // empty')
        if [ -n "$EXISTING_PR_URL" ]; then
            echo "[agent] Found existing PR: $EXISTING_PR_URL (#$EXISTING_PR_NUMBER)"
            echo "$EXISTING_PR_URL" > /output/pr_url.txt
            echo "$EXISTING_PR_NUMBER" > /output/pr_number.txt
        fi
    else
        echo "[agent] Warning: Failed to create PR (HTTP $HTTP_CODE), but branch was pushed successfully"
        echo "[agent] Response: $BODY"
    fi
}

# ─── Helper: Create GitLab MR ───
create_gitlab_mr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local MR_TITLE="$3"
    local MR_BODY="$4"

    echo "[agent] Creating GitLab MR: $FEATURE_BRANCH -> $BASE_BRANCH"

    # Determine GitLab base URL
    local GITLAB_URL="${GIT_BASE_URL:-https://gitlab.com}"

    # Extract owner/repo from GIT_REPO_URL
    # Support: https://gitlab.com/owner/repo.git or https://token@gitlab.com/owner/repo.git
    local REPO_PATH=$(echo "$GIT_REPO_URL" | sed -E 's|^https?://([^@]*@)?[^/]+/||' | sed 's|\.git$||')

    if [ -z "$REPO_PATH" ]; then
        echo "[agent] Warning: Could not parse project path from $GIT_REPO_URL, skipping MR creation"
        return 0
    fi

    # URL-encode the project path (owner/repo → owner%2Frepo)
    local PROJECT_ID=$(echo "$REPO_PATH" | sed 's|/|%2F|g')

    # Get token
    local TOKEN=""
    if [ -n "$GIT_ACCESS_TOKEN" ]; then
        TOKEN="$GIT_ACCESS_TOKEN"
    fi

    if [ -z "$TOKEN" ]; then
        echo "[agent] Warning: No access token found, skipping MR creation"
        return 0
    fi

    # Call GitLab API
    local API_URL="${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/merge_requests"
    local RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "PRIVATE-TOKEN: $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"source_branch\":\"$FEATURE_BRANCH\",\"target_branch\":\"$BASE_BRANCH\",\"title\":\"$MR_TITLE\",\"description\":\"$MR_BODY\"}")

    local HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    local BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "201" ]; then
        local MR_URL=$(echo "$BODY" | jq -r '.web_url')
        local MR_IID=$(echo "$BODY" | jq -r '.iid')
        echo "[agent] MR created successfully: $MR_URL (!$MR_IID)"
        echo "$MR_URL" > /output/pr_url.txt
        echo "$MR_IID" > /output/pr_number.txt
    elif [ "$HTTP_CODE" = "409" ]; then
        echo "[agent] MR already exists (409), looking up existing MR..."
        local SEARCH_URL="${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/merge_requests?source_branch=${FEATURE_BRANCH}&target_branch=${BASE_BRANCH}&state=opened"
        local SEARCH_RESP=$(curl -s "$SEARCH_URL" \
            -H "PRIVATE-TOKEN: $TOKEN")
        local EXISTING_MR_URL=$(echo "$SEARCH_RESP" | jq -r '.[0].web_url // empty')
        local EXISTING_MR_IID=$(echo "$SEARCH_RESP" | jq -r '.[0].iid // empty')
        if [ -n "$EXISTING_MR_URL" ]; then
            echo "[agent] Found existing MR: $EXISTING_MR_URL (!$EXISTING_MR_IID)"
            echo "$EXISTING_MR_URL" > /output/pr_url.txt
            echo "$EXISTING_MR_IID" > /output/pr_number.txt
        fi
    else
        echo "[agent] Warning: Failed to create MR (HTTP $HTTP_CODE), but branch was pushed successfully"
        echo "[agent] Response: $BODY"
    fi
}

# ─── Helper: Create PR/MR based on provider type ───
create_pr_or_mr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local TITLE="$3"
    local BODY="$4"

    local PROVIDER="${GIT_PROVIDER_TYPE:-github}"

    case "$PROVIDER" in
        github)
            create_github_pr "$FEATURE_BRANCH" "$BASE_BRANCH" "$TITLE" "$BODY"
            ;;
        gitlab)
            create_gitlab_mr "$FEATURE_BRANCH" "$BASE_BRANCH" "$TITLE" "$BODY"
            ;;
        generic)
            echo "[agent] Generic Git provider — PR/MR creation not supported, skipping"
            ;;
        *)
            echo "[agent] Unknown Git provider type: $PROVIDER, trying GitHub API..."
            create_github_pr "$FEATURE_BRANCH" "$BASE_BRANCH" "$TITLE" "$BODY"
            ;;
    esac
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

        # Worktree mode: commit only, orchestrator handles push
        if [ "$USE_WORKTREE" = "true" ]; then
            echo "[agent] Worktree mode: committing changes (orchestrator will handle push)..."
            git add -A
            git commit -m "$COMMIT_MSG" 2>&1 || {
                echo "[agent] ERROR: git commit failed in worktree mode" >&2
                echo '{"error": "git commit failed in worktree mode"}' >&3
                exit 1
            }
            COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
            CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -50 || echo "")
            CHANGED_FILES_DETAIL=$(git diff --name-status HEAD~1 HEAD 2>/dev/null | head -50 || echo "")
        else
            # Legacy clone mode: commit + push + PR
            git checkout -b "$FEATURE_BRANCH" 2>&1 || git checkout "$FEATURE_BRANCH" 2>&1
            git add -A
            git commit -m "$COMMIT_MSG" 2>&1

            # Push to feature branch
            echo "[agent] Pushing to $FEATURE_BRANCH..."
            git push origin "$FEATURE_BRANCH" --force 2>&1
            echo "[agent] Changes pushed successfully to $FEATURE_BRANCH"

            # Create PR/MR if requested
            if [ "$GIT_CREATE_PR" = "true" ]; then
                PR_TITLE="${GIT_PR_TITLE:-$COMMIT_MSG}"
                create_pr_or_mr "$FEATURE_BRANCH" "$BASE_BRANCH" "$PR_TITLE" "$COMMIT_MSG"
            fi

            COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
            CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -50 || echo "")
            CHANGED_FILES_DETAIL=$(git diff --name-status HEAD~1 HEAD 2>/dev/null | head -50 || echo "")
        fi

        # ─── Record Git metadata ───
        PR_URL_VALUE=$(cat /output/pr_url.txt 2>/dev/null || echo "")
        PR_NUMBER_VALUE=$(cat /output/pr_number.txt 2>/dev/null || echo "0")

        # Resolve repo URL (strip credentials, convert SSH to HTTPS, remove .git suffix)
        REPO_URL=""
        REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
        if [ -n "$REMOTE_URL" ]; then
            # Convert SSH format (git@github.com:owner/repo.git) to HTTPS
            if echo "$REMOTE_URL" | grep -q '^git@'; then
                REPO_URL=$(echo "$REMOTE_URL" | sed -E 's|^git@([^:]+):|https://\1/|')
            else
                # HTTPS format — strip credentials (token@)
                REPO_URL=$(echo "$REMOTE_URL" | sed -E 's|^(https?://)([^@]+@)|\1|')
            fi
            # Remove trailing .git
            REPO_URL=$(echo "$REPO_URL" | sed 's|\.git$||')
        fi

        # Build changed_files_detail JSON array from git diff --name-status output
        # Uses jq for safe JSON construction (handles special chars in file paths)
        DETAIL_JSON="[]"
        if [ -n "$CHANGED_FILES_DETAIL" ]; then
            DETAIL_JSON=$(echo "$CHANGED_FILES_DETAIL" | while IFS=$'\t' read -r status path rest; do
                [ -z "$status" ] && continue
                case "$status" in
                    A)  mapped="added" ;;
                    M)  mapped="modified" ;;
                    D)  mapped="deleted" ;;
                    R*) mapped="renamed"; [ -n "$rest" ] && path="$rest" ;;
                    *)  mapped="modified" ;;
                esac
                jq -n --arg p "$path" --arg s "$mapped" '{path:$p,status:$s}'
            done | jq -s '.')
            # Fallback to empty array if jq pipeline failed
            [ -z "$DETAIL_JSON" ] && DETAIL_JSON="[]"
        fi

        jq -n \
            --arg branch "$FEATURE_BRANCH" \
            --arg base_branch "$BASE_BRANCH" \
            --arg commit "$COMMIT_HASH" \
            --arg commit_msg "$COMMIT_MSG" \
            --arg pr_url "$PR_URL_VALUE" \
            --argjson pr_number "${PR_NUMBER_VALUE:-0}" \
            --arg changed_files "$CHANGED_FILES" \
            --arg repo_url "$REPO_URL" \
            --argjson changed_files_detail "$DETAIL_JSON" \
            '{
                branch: $branch,
                base_branch: $base_branch,
                commit: $commit,
                commit_message: $commit_msg,
                pr_url: $pr_url,
                pr_number: $pr_number,
                changed_files: ($changed_files | split("\n") | map(select(. != ""))),
                repo_url: $repo_url,
                changed_files_detail: $changed_files_detail
            }' > "$GIT_METADATA_FILE"

        echo "[agent] Git metadata written to $GIT_METADATA_FILE"
    else
        echo "[agent] No file changes detected."
    fi
fi

# ─── Step 4: Output result (to real stdout via fd 3) ───
if [ -f "$RESULT_FILE" ]; then
    cat "$RESULT_FILE" >&3
else
    echo '{"result": "completed", "summary": "Agent execution completed but no output file generated."}' >&3
fi

echo "[agent] Done."

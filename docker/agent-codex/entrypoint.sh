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
CODEX_CONFIG_DIR="/home/agent/.codex"
CODEX_CONFIG_FILE="$CODEX_CONFIG_DIR/config.toml"
CODEX_AUTH_FILE="$CODEX_CONFIG_DIR/auth.json"

# Initialize git metadata as empty
echo '{}' > "$GIT_METADATA_FILE"

echo "[agent] Starting Codex agent..."
echo "[agent] Mode: ${AGENT_MODE:-execute}"
echo "[agent] Git repo: ${GIT_REPO_URL:-none}"
echo "[agent] Git branch: ${GIT_BRANCH:-main}"

# ─── Step 0: Generate Codex config files ───
echo "[agent] Generating Codex configuration..."

# Generate auth.json
cat > "$CODEX_AUTH_FILE" <<EOF
{
  "OPENAI_API_KEY": "${OPENAI_API_KEY}"
}
EOF

# Generate config.toml
if [ -n "$CODEX_MODEL_PROVIDER" ] && [ "$CODEX_MODEL_PROVIDER" != "openai" ]; then
    # Custom provider configuration
    cat > "$CODEX_CONFIG_FILE" <<EOF
model_provider = "${CODEX_MODEL_PROVIDER}"
model = "${CODEX_MODEL:-gpt-5.3-codex}"
model_reasoning_effort = "${CODEX_MODEL_REASONING_EFFORT:-high}"
network_access = "${CODEX_NETWORK_ACCESS:-enabled}"
disable_response_storage = ${CODEX_DISABLE_RESPONSE_STORAGE:-true}
model_verbosity = "${CODEX_MODEL_VERBOSITY:-high}"

[model_providers.${CODEX_MODEL_PROVIDER}]
name = "${CODEX_MODEL_PROVIDER}"
base_url = "${CODEX_PROVIDER_BASE_URL}"
wire_api = "${CODEX_PROVIDER_WIRE_API:-responses}"
requires_openai_auth = ${CODEX_PROVIDER_REQUIRES_AUTH:-true}
EOF
else
    # Default OpenAI configuration
    cat > "$CODEX_CONFIG_FILE" <<EOF
model = "${CODEX_MODEL:-gpt-5.3-codex}"
model_reasoning_effort = "${CODEX_MODEL_REASONING_EFFORT:-high}"
network_access = "${CODEX_NETWORK_ACCESS:-enabled}"
disable_response_storage = ${CODEX_DISABLE_RESPONSE_STORAGE:-true}
model_verbosity = "${CODEX_MODEL_VERBOSITY:-high}"
EOF
fi

echo "[agent] Configuration files created"

# ─── Git identity (always configure) ───
git config --global user.email "agent@workgear.dev"
git config --global user.name "WorkGear Agent"

# ─── Step 1: Clone repository (if configured) ───
if [ -n "$GIT_REPO_URL" ]; then
    echo "[agent] Cloning repository..."
    BRANCH="${GIT_BRANCH:-main}"

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

# ─── Step 2: Run Codex CLI ───
echo "[agent] Running Codex CLI..."

# Build codex command
CODEX_CMD="codex exec"
CODEX_ARGS="--ephemeral"

# Handle test mode
if [ "$AGENT_MODE" = "test" ]; then
    echo "[agent] Test mode: running simple validation..."
    if [ -z "$AGENT_PROMPT" ] || [ "$AGENT_PROMPT" = "" ]; then
        AGENT_PROMPT="Echo 'Codex agent test successful' and exit immediately"
    fi
    CODEX_ARGS="$CODEX_ARGS --sandbox read-only --skip-git-repo-check"
    # Ensure workspace is a git repo (codex requires it)
    if [ ! -d "$WORKSPACE/.git" ]; then
        cd "$WORKSPACE"
        git init
        git commit --allow-empty -m "init"
    fi
else
    # Sandbox mode based on AGENT_MODE
    case "$AGENT_MODE" in
        spec)
            CODEX_ARGS="$CODEX_ARGS --sandbox read-only --skip-git-repo-check"
            ;;
        execute|opsx_plan|opsx_apply)
            CODEX_ARGS="$CODEX_ARGS --sandbox workspace-write --full-auto"
            ;;
    esac
fi

# Override sandbox if explicitly set
if [ -n "$CODEX_SANDBOX" ]; then
    CODEX_ARGS="$CODEX_ARGS --sandbox $CODEX_SANDBOX"
fi

# Execute codex, tee stderr to both file and console for visibility
$CODEX_CMD $CODEX_ARGS "$AGENT_PROMPT" > "$RESULT_FILE" 2> >(tee /tmp/codex_stderr.log >&2)

# Check exit status
CODEX_EXIT=$?
if [ "$CODEX_EXIT" != "0" ]; then
    echo "[agent] Codex CLI exited with code $CODEX_EXIT"
    echo "[agent] Codex stderr:"
    cat /tmp/codex_stderr.log 2>/dev/null
    echo "{\"error\": \"codex exited with code $CODEX_EXIT\", \"stderr\": \"$(cat /tmp/codex_stderr.log 2>/dev/null | head -c 2000 | sed 's/"/\\"/g')\"}" >&3
    exit $CODEX_EXIT
fi

# Verify we got a result
if [ ! -f "$RESULT_FILE" ] || [ ! -s "$RESULT_FILE" ]; then
    echo "[agent] Warning: No result file or empty result from Codex CLI"
    echo '{"error": "No result", "summary": "Agent execution completed but no result was produced."}' > "$RESULT_FILE"
fi

echo "[agent] Codex CLI completed successfully."

# ─── Helper: Create GitHub PR ───
create_github_pr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local PR_TITLE="$3"
    local PR_BODY="$4"

    echo "[agent] Creating GitHub PR: $FEATURE_BRANCH -> $BASE_BRANCH"

    # Extract owner/repo from GIT_REPO_URL
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

        # ─── Record Git metadata ───
        COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")
        PR_URL_VALUE=$(cat /output/pr_url.txt 2>/dev/null || echo "")
        PR_NUMBER_VALUE=$(cat /output/pr_number.txt 2>/dev/null || echo "0")
        CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -50 || echo "")

        # Collect file change types via git diff --name-status
        CHANGED_FILES_DETAIL=$(git diff --name-status HEAD~1 HEAD 2>/dev/null | head -50 || echo "")

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

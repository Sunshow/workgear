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
FACTORY_CONFIG_DIR="/home/agent/.factory"
FACTORY_SETTINGS_FILE="$FACTORY_CONFIG_DIR/settings.json"

# ─── Stream-JSON Helpers ───
# Emit a stream-json event to stderr (executor.go parses these for real-time log streaming)
# Usage: emit_stream_event <type> <subtype> <text>
#   type: "system" | "assistant" | "result"
#   subtype: "init" | "log" | "success" | "error" | "" (empty for assistant messages)
emit_stream_event() {
    local etype="$1"
    local subtype="$2"
    local text="$3"
    local ts
    ts=$(date +%s%3N)
    # Use jq to safely escape text content
    local escaped_text
    escaped_text=$(printf '%s' "$text" | jq -Rs '.')
    if [ -n "$subtype" ]; then
        printf '{"type":"%s","subtype":"%s","message":{"content":[{"type":"text","text":%s}]},"timestamp":%s}\n' \
            "$etype" "$subtype" "$escaped_text" "$ts" >&2
    else
        printf '{"type":"%s","message":{"role":"assistant","content":[{"type":"text","text":%s}]},"timestamp":%s}\n' \
            "$etype" "$escaped_text" "$ts" >&2
    fi
}

# Convenience: log an informational message as stream-json system event
log_info() {
    local msg="$1"
    echo "[agent] $msg"
    emit_stream_event "system" "log" "[agent] $msg"
}

# Initialize git metadata as empty
echo '{}' > "$GIT_METADATA_FILE"

log_info "Starting Droid agent..."
log_info "Mode: ${AGENT_MODE:-execute}"
log_info "Git repo: ${GIT_REPO_URL:-none}"
log_info "Git branch: ${GIT_BRANCH:-main}"

# ─── Step 0: Generate Factory Droid config files ───
log_info "Generating Droid configuration..."

# Generate settings.json for BYOK (custom model) if provider config is set
if [ -n "$DROID_PROVIDER_TYPE" ] && [ -n "$DROID_BASE_URL" ] && [ -n "$DROID_API_KEY" ]; then
    log_info "BYOK mode: configuring custom model via settings.json"

    # Determine model ID
    BYOK_MODEL="${DROID_MODEL:-custom-model}"
    BYOK_DISPLAY_NAME="${DROID_MODEL_DISPLAY_NAME:-Custom Model (BYOK)}"
    BYOK_MAX_OUTPUT_TOKENS="${DROID_MAX_OUTPUT_TOKENS:-16384}"

    cat > "$FACTORY_SETTINGS_FILE" <<EOF
{
  "customModels": [
    {
      "model": "${BYOK_MODEL}",
      "displayName": "${BYOK_DISPLAY_NAME}",
      "baseUrl": "${DROID_BASE_URL}",
      "apiKey": "${DROID_API_KEY}",
      "provider": "${DROID_PROVIDER_TYPE}",
      "maxOutputTokens": ${BYOK_MAX_OUTPUT_TOKENS}
    }
  ]
}
EOF
    log_info "BYOK settings.json created (provider: ${DROID_PROVIDER_TYPE}, model: ${BYOK_MODEL})"
    # ACP 模式只需非空 FACTORY_API_KEY 绕过 CLI 登录检查
    export FACTORY_API_KEY="byok-acp"
    # 构造 ACP 模型 ID: custom:DisplayName-Index (空格替换为 -)
    ACP_MODEL_ID="custom:$(echo "$BYOK_DISPLAY_NAME" | tr ' ' '-')-0"
    log_info "ACP model ID: $ACP_MODEL_ID"
elif [ -n "$FACTORY_API_KEY" ]; then
    log_info "Factory platform mode: using FACTORY_API_KEY"
else
    log_info "Warning: No FACTORY_API_KEY or BYOK config set"
fi

log_info "Configuration files created"

# ─── Git identity (always configure) ───
git config --global user.email "agent@workgear.dev"
git config --global user.name "WorkGear Agent"

# ─── Step 1: Clone repository (if configured) ───
if [ "$USE_WORKTREE" = "true" ]; then
    # Worktree mode: /workspace is pre-mounted by orchestrator (rw bind mount)
    log_info "Worktree mode: using pre-mounted /workspace"
    cd "$WORKSPACE"

    # Configure git user inside worktree
    git config user.email "agent@workgear.dev"
    git config user.name "WorkGear Agent"

    # Auto-detect and restore dependencies
    if [ -d "/deps" ]; then
        if [ -f "$WORKSPACE/pnpm-lock.yaml" ]; then
            log_info "Detected pnpm project, restoring node_modules from cache..."
            if [ -d "/deps/node_modules" ]; then
                cp -al /deps/node_modules "$WORKSPACE/node_modules" 2>/dev/null || \
                    ln -s /deps/node_modules "$WORKSPACE/node_modules" 2>/dev/null || true
            fi
            pnpm install --frozen-lockfile 2>&1 || true
            if [ -d "$WORKSPACE/node_modules" ]; then
                rm -rf /deps/node_modules
                cp -al "$WORKSPACE/node_modules" /deps/node_modules 2>/dev/null || true
            fi
        elif [ -f "$WORKSPACE/package-lock.json" ]; then
            log_info "Detected npm project, restoring node_modules from cache..."
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
            log_info "Detected Go project, restoring module cache..."
            export GOPATH="/deps/gopath"
            export GOMODCACHE="/deps/gopath/pkg/mod"
            go mod download 2>&1 || true
        elif [ -f "$WORKSPACE/requirements.txt" ] || [ -f "$WORKSPACE/pyproject.toml" ]; then
            log_info "Detected Python project, restoring pip cache..."
            export PIP_CACHE_DIR="/deps/pip"
            if [ -f "$WORKSPACE/requirements.txt" ]; then
                pip install -r "$WORKSPACE/requirements.txt" 2>&1 || true
            fi
        fi
    fi

    log_info "Worktree ready."
elif [ -n "$GIT_REPO_URL" ]; then
    log_info "Cloning repository..."
    BRANCH="${GIT_BRANCH:-main}"

    # Clone
    git clone "$GIT_REPO_URL" --branch "$BRANCH" --single-branch --depth 50 "$WORKSPACE" 2>&1 || {
        log_info "Failed to clone branch $BRANCH, trying default branch..."
        git clone "$GIT_REPO_URL" --single-branch --depth 50 "$WORKSPACE" 2>&1
        cd "$WORKSPACE"
        git checkout -b "$BRANCH"
    }
    cd "$WORKSPACE"
    log_info "Repository cloned successfully."
else
    log_info "No GIT_REPO_URL configured, working in empty workspace."
    cd "$WORKSPACE"
fi

# ─── Step 1.5: Initialize OpenSpec (if needed) ───
if [ "$AGENT_MODE" = "opsx_plan" ] || [ "$AGENT_MODE" = "opsx_apply" ]; then
    log_info "OpenSpec mode detected: $AGENT_MODE"
    if [ ! -d "openspec" ] && [ "$OPSX_INIT_IF_MISSING" = "true" ]; then
        log_info "Initializing OpenSpec..."
        openspec init --tools none --force 2>&1 || {
            log_info "Warning: openspec init failed, continuing anyway..."
        }
    fi
fi

# ─── Step 2: Run Droid CLI via ACP Protocol ───
log_info "Running droid CLI via ACP protocol..."

# Load prompt from file (preferred) or env var (fallback)
if [ -f /tmp/agent_prompt.txt ]; then
    AGENT_PROMPT=$(cat /tmp/agent_prompt.txt)
    log_info "Loaded prompt from file (/tmp/agent_prompt.txt, $(wc -c < /tmp/agent_prompt.txt) bytes)"
elif [ -n "$AGENT_PROMPT" ]; then
    log_info "Using prompt from environment variable"
else
    log_info "Warning: No prompt found (neither file nor env var)"
fi

# Handle test mode defaults
if [ "$AGENT_MODE" = "test" ]; then
    log_info "Test mode: running simple validation..."
    if [ -z "$AGENT_PROMPT" ] || [ "$AGENT_PROMPT" = "" ]; then
        AGENT_PROMPT="Echo 'Droid agent test successful' and exit immediately"
    fi
    # Ensure workspace is a git repo (droid may require it)
    if [ ! -d "$WORKSPACE/.git" ]; then
        cd "$WORKSPACE"
        git init
        git commit --allow-empty -m "init"
    fi
fi

# Map AGENT_MODE to ACP mode ID
case "$AGENT_MODE" in
    review)     ACP_MODE="auto-low" ;;
    test)       ACP_MODE="auto-low" ;;
    *)          ACP_MODE="auto-high" ;;
esac
log_info "ACP mode: $ACP_MODE"

# ─── ACP Communication Setup ───
# Use two FIFOs for bidirectional communication with droid ACP process
ACP_IN="/tmp/acp_in"    # entrypoint writes → droid reads
ACP_OUT="/tmp/acp_out"  # droid writes → entrypoint reads
rm -f "$ACP_IN" "$ACP_OUT"
mkfifo "$ACP_IN" "$ACP_OUT"

# Emit stream-json start event (compatible with executor.go streamLogs parser)
emit_stream_event "assistant" "" "开始执行 Droid Agent（模式: ${AGENT_MODE:-execute}）..."

# Launch droid exec in ACP mode with FIFOs
droid exec --output-format acp --skip-permissions-unsafe < "$ACP_IN" > "$ACP_OUT" 2>/tmp/droid_stderr.log &
DROID_PID=$!

# Open write end of input FIFO (keep it open so droid doesn't get EOF)
exec 4>"$ACP_IN"
# Open read end of output FIFO
exec 5<"$ACP_OUT"

sleep 1

# Verify droid process started
if ! kill -0 $DROID_PID 2>/dev/null; then
    log_info "Failed to start droid ACP process"
    cat /tmp/droid_stderr.log 2>/dev/null
    echo "{\"error\": \"Failed to start droid ACP process\"}" >&3
    exit 1
fi

ACP_MSG_ID=0
ACP_RESPONSE_TEXT=""
ACP_SESSION_ID=""

# Send an ACP message via fd 4
acp_send() {
    local method="$1"
    local params="$2"
    ACP_MSG_ID=$((ACP_MSG_ID + 1))
    log_info "ACP >> $method (id=$ACP_MSG_ID)"
    echo "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"params\":$params,\"id\":\"$ACP_MSG_ID\"}" >&4
}

# Read ACP responses from fd 5 until we get the response for expected_id
# Collects agent_message_chunk text into ACP_RESPONSE_TEXT
# Sets ACP_LAST_RESPONSE to the matched response line
# Returns 0 on success, 1 on timeout, 2 on ACP error
acp_wait_response() {
    local expected_id="$1"
    local timeout_sec="${2:-30}"
    local got_output=false
    local in_tool_call=false
    ACP_LAST_RESPONSE=""

    while true; do
        # Check if droid process is still alive before blocking on read
        if ! kill -0 $DROID_PID 2>/dev/null; then
            log_info "Droid process exited while waiting for response id=$expected_id"
            break
        fi

        # Use a short read timeout so we can periodically check process liveness
        # but respect the overall timeout via SECONDS tracking
        if ! IFS= read -r -t 5 line <&5; then
            # read timed out (5s), check if droid is still alive
            if ! kill -0 $DROID_PID 2>/dev/null; then
                log_info "Droid process exited (detected on read timeout)"
                break
            fi
            # Decrement remaining time
            timeout_sec=$((timeout_sec - 5))
            if [ "$timeout_sec" -le 0 ]; then
                log_info "ACP timeout waiting for response id=$expected_id"
                return 1
            fi
            continue
        fi

        [ -z "$line" ] && continue

        local msg_id=$(echo "$line" | jq -r '.id // empty' 2>/dev/null)
        local msg_method=$(echo "$line" | jq -r '.method // empty' 2>/dev/null)

        # Handle session/update notifications
        if [ "$msg_method" = "session/update" ]; then
            local update_type=$(echo "$line" | jq -r '.params.update.sessionUpdate // empty' 2>/dev/null)
            if [ "$update_type" = "agent_message_chunk" ]; then
                local chunk=$(echo "$line" | jq -r '.params.update.content.text // empty' 2>/dev/null)
                ACP_RESPONSE_TEXT="${ACP_RESPONSE_TEXT}${chunk}"
                got_output=true
                in_tool_call=false
                # Emit as stream-json assistant event for real-time log streaming
                emit_stream_event "assistant" "" "$chunk"
            elif [ "$update_type" = "tool_call" ]; then
                local tool_name=$(echo "$line" | jq -r '.params.update.toolName // empty' 2>/dev/null)
                if [ -n "$tool_name" ]; then
                    emit_stream_event "system" "log" "Tool call: $tool_name"
                fi
                # Capture ExitSpecMode plan content as the main result
                if [ "$tool_name" = "ExitSpecMode" ]; then
                    local plan_content=$(echo "$line" | jq -r '.params.update.input.plan // empty' 2>/dev/null)
                    if [ -n "$plan_content" ]; then
                        ACP_RESPONSE_TEXT="${plan_content}"
                        emit_stream_event "system" "log" "Captured ExitSpecMode plan ($(echo "$plan_content" | wc -c) bytes)"
                    fi
                fi
                got_output=true
                in_tool_call=true
            elif [ "$update_type" = "tool_result" ]; then
                in_tool_call=false
                got_output=true
            fi
            continue
        fi

        # Check if this is the response we're waiting for
        if [ "$msg_id" = "$expected_id" ]; then
            ACP_LAST_RESPONSE="$line"
            local has_error=$(echo "$line" | jq -r 'if .error then "yes" else "" end' 2>/dev/null)
            if [ "$has_error" = "yes" ]; then
                local err_msg=$(echo "$line" | jq -r '.error.message // "unknown error"' 2>/dev/null)
                log_info "ACP error (id=$expected_id): $err_msg"
                return 2
            fi
            return 0
        fi
    done

    # Droid process exited without sending final response
    # If we got some output, treat as success (agent completed but protocol didn't send final ack)
    if [ "$got_output" = "true" ] && [ -n "$ACP_RESPONSE_TEXT" ]; then
        log_info "Droid process exited after producing output (id=$expected_id), treating as complete"
        return 0
    fi

    log_info "ACP failed: droid process exited without response id=$expected_id"
    return 1
}

ACP_FAILED=false

# Step 2a: Initialize
acp_send "initialize" '{"protocolVersion":1}'
if ! acp_wait_response "$ACP_MSG_ID" 10; then
    log_info "ACP initialize failed"
    ACP_FAILED=true
fi

# Step 2b: Authenticate
if [ "$ACP_FAILED" = "false" ]; then
    acp_send "authenticate" '{"methodId":"factory-api-key"}'
    if ! acp_wait_response "$ACP_MSG_ID" 10; then
        log_info "ACP authenticate failed"
        ACP_FAILED=true
    fi
fi

# Step 2c: Create session
if [ "$ACP_FAILED" = "false" ]; then
    acp_send "session/new" "{\"cwd\":\"$WORKSPACE\",\"mcpServers\":[]}"
    if ! acp_wait_response "$ACP_MSG_ID" 15; then
        log_info "ACP session/new failed"
        ACP_FAILED=true
    else
        ACP_SESSION_ID=$(echo "$ACP_LAST_RESPONSE" | jq -r '.result.sessionId // empty' 2>/dev/null)
        log_info "ACP session created: $ACP_SESSION_ID"
    fi
fi

# Step 2d: Set model (BYOK only)
if [ "$ACP_FAILED" = "false" ] && [ -n "$ACP_MODEL_ID" ]; then
    log_info "Setting model to: $ACP_MODEL_ID"
    acp_send "session/set_model" "{\"sessionId\":\"$ACP_SESSION_ID\",\"modelId\":\"$ACP_MODEL_ID\"}"
    if ! acp_wait_response "$ACP_MSG_ID" 10; then
        log_info "ACP session/set_model failed (non-fatal, using default model)"
    fi
fi

# Step 2e: Set mode
if [ "$ACP_FAILED" = "false" ]; then
    log_info "Setting mode to: $ACP_MODE"
    acp_send "session/set_mode" "{\"sessionId\":\"$ACP_SESSION_ID\",\"modeId\":\"$ACP_MODE\"}"
    if ! acp_wait_response "$ACP_MSG_ID" 10; then
        log_info "ACP session/set_mode failed (non-fatal)"
    fi
fi

# Step 2f: Send prompt and collect response
if [ "$ACP_FAILED" = "false" ]; then
    ESCAPED_PROMPT=$(echo "$AGENT_PROMPT" | jq -Rs '.')
    acp_send "session/prompt" "{\"sessionId\":\"$ACP_SESSION_ID\",\"prompt\":[{\"type\":\"text\",\"text\":$ESCAPED_PROMPT}]}"

    PROMPT_TIMEOUT="${DROID_TIMEOUT:-600}"
    if ! acp_wait_response "$ACP_MSG_ID" "$PROMPT_TIMEOUT"; then
        log_info "ACP session/prompt failed or timed out"
        ACP_FAILED=true
    else
        STOP_REASON=$(echo "$ACP_LAST_RESPONSE" | jq -r '.result.stopReason // "unknown"' 2>/dev/null)
        log_info "ACP prompt completed, stopReason: $STOP_REASON"
    fi
fi

# Cleanup: close FDs and kill droid process
exec 4>&- 2>/dev/null
exec 5<&- 2>/dev/null
kill $DROID_PID 2>/dev/null
wait $DROID_PID 2>/dev/null || true
rm -f "$ACP_IN" "$ACP_OUT"

# Build result
if [ "$ACP_FAILED" = "true" ]; then
    emit_stream_event "result" "error" "ACP execution failed"
    ERROR_MSG=$(echo "$ACP_LAST_RESPONSE" | jq -r '.error.message // "ACP execution failed"' 2>/dev/null)
    DROID_STDERR=""
    if [ -f /tmp/droid_stderr.log ] && [ -s /tmp/droid_stderr.log ]; then
        DROID_STDERR=$(tail -c 2000 /tmp/droid_stderr.log)
        log_info "Droid CLI stderr: $DROID_STDERR"
    fi
    jq -n --arg error "$ERROR_MSG" --arg stderr "$DROID_STDERR" \
        '{error: $error, droid_stderr: $stderr}' > "$RESULT_FILE"
else
    emit_stream_event "result" "success" "Droid execution completed"
    jq -n \
        --arg result "$ACP_RESPONSE_TEXT" \
        --arg stop_reason "${STOP_REASON:-end_turn}" \
        --arg session_id "$ACP_SESSION_ID" \
        '{
            type: "result",
            subtype: "success",
            result: $result,
            stop_reason: $stop_reason,
            session_id: $session_id
        }' > "$RESULT_FILE"
fi

# Verify we got a result
if [ ! -f "$RESULT_FILE" ] || [ ! -s "$RESULT_FILE" ]; then
    log_info "Warning: No result file or empty result from Droid CLI"
    echo '{"error": "No result", "summary": "Agent execution completed but no result was produced."}' > "$RESULT_FILE"
fi

log_info "Droid CLI completed successfully."

# ─── Helper: Create GitHub PR ───
create_github_pr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local PR_TITLE="$3"
    local PR_BODY="$4"

    log_info "Creating GitHub PR: $FEATURE_BRANCH -> $BASE_BRANCH"

    # Extract owner/repo from GIT_REPO_URL
    local REPO_PATH=$(echo "$GIT_REPO_URL" | sed -E 's|^https?://([^@]*@)?github\.com[/:]||' | sed 's|\.git$||')
    local OWNER=$(echo "$REPO_PATH" | cut -d'/' -f1)
    local REPO=$(echo "$REPO_PATH" | cut -d'/' -f2)

    if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
        log_info "Warning: Could not parse owner/repo from $GIT_REPO_URL, skipping PR creation"
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
        log_info "Warning: No access token found, skipping PR creation"
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
        log_info "PR created successfully: $PR_URL (#$PR_NUMBER)"
        echo "$PR_URL" > /output/pr_url.txt
        echo "$PR_NUMBER" > /output/pr_number.txt
    elif [ "$HTTP_CODE" = "422" ]; then
        log_info "PR already exists (422), looking up existing PR..."
        local SEARCH_URL="https://api.github.com/repos/$OWNER/$REPO/pulls?head=$OWNER:$FEATURE_BRANCH&base=$BASE_BRANCH&state=open"
        local SEARCH_RESP=$(curl -s "$SEARCH_URL" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/vnd.github+json" \
            -H "X-GitHub-Api-Version: 2022-11-28")
        local EXISTING_PR_URL=$(echo "$SEARCH_RESP" | jq -r '.[0].html_url // empty')
        local EXISTING_PR_NUMBER=$(echo "$SEARCH_RESP" | jq -r '.[0].number // empty')
        if [ -n "$EXISTING_PR_URL" ]; then
            log_info "Found existing PR: $EXISTING_PR_URL (#$EXISTING_PR_NUMBER)"
            echo "$EXISTING_PR_URL" > /output/pr_url.txt
            echo "$EXISTING_PR_NUMBER" > /output/pr_number.txt
        fi
    else
        log_info "Warning: Failed to create PR (HTTP $HTTP_CODE), but branch was pushed successfully"
        log_info "Response: $BODY"
    fi
}

# ─── Helper: Create GitLab MR ───
create_gitlab_mr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local MR_TITLE="$3"
    local MR_BODY="$4"

    log_info "Creating GitLab MR: $FEATURE_BRANCH -> $BASE_BRANCH"

    # Determine GitLab base URL
    local GITLAB_URL="${GIT_BASE_URL:-https://gitlab.com}"

    # Extract owner/repo from GIT_REPO_URL
    local REPO_PATH=$(echo "$GIT_REPO_URL" | sed -E 's|^https?://([^@]*@)?[^/]+/||' | sed 's|\.git$||')

    if [ -z "$REPO_PATH" ]; then
        log_info "Warning: Could not parse project path from $GIT_REPO_URL, skipping MR creation"
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
        log_info "Warning: No access token found, skipping MR creation"
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
        log_info "MR created successfully: $MR_URL (!$MR_IID)"
        echo "$MR_URL" > /output/pr_url.txt
        echo "$MR_IID" > /output/pr_number.txt
    elif [ "$HTTP_CODE" = "409" ]; then
        log_info "MR already exists (409), looking up existing MR..."
        local SEARCH_URL="${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/merge_requests?source_branch=${FEATURE_BRANCH}&target_branch=${BASE_BRANCH}&state=opened"
        local SEARCH_RESP=$(curl -s "$SEARCH_URL" \
            -H "PRIVATE-TOKEN: $TOKEN")
        local EXISTING_MR_URL=$(echo "$SEARCH_RESP" | jq -r '.[0].web_url // empty')
        local EXISTING_MR_IID=$(echo "$SEARCH_RESP" | jq -r '.[0].iid // empty')
        if [ -n "$EXISTING_MR_URL" ]; then
            log_info "Found existing MR: $EXISTING_MR_URL (!$EXISTING_MR_IID)"
            echo "$EXISTING_MR_URL" > /output/pr_url.txt
            echo "$EXISTING_MR_IID" > /output/pr_number.txt
        fi
    else
        log_info "Warning: Failed to create MR (HTTP $HTTP_CODE), but branch was pushed successfully"
        log_info "Response: $BODY"
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
            log_info "Generic Git provider — PR/MR creation not supported, skipping"
            ;;
        *)
            log_info "Unknown Git provider type: $PROVIDER, trying GitHub API..."
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
    log_info "Checking for file changes..."
    cd "$WORKSPACE"

    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        log_info "Committing changes..."

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
            log_info "Worktree mode: committing changes (orchestrator will handle push)..."
            git add -A
            git commit -m "$COMMIT_MSG" 2>&1 || {
                log_info "ERROR: git commit failed in worktree mode"
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
            log_info "Pushing to $FEATURE_BRANCH..."
            git push origin "$FEATURE_BRANCH" --force 2>&1
            log_info "Changes pushed successfully to $FEATURE_BRANCH"

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
            if echo "$REMOTE_URL" | grep -q '^git@'; then
                REPO_URL=$(echo "$REMOTE_URL" | sed -E 's|^git@([^:]+):|https://\1/|')
            else
                REPO_URL=$(echo "$REMOTE_URL" | sed -E 's|^(https?://)([^@]+@)|\1|')
            fi
            REPO_URL=$(echo "$REPO_URL" | sed 's|\.git$||')
        fi

        # Build changed_files_detail JSON array
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

        log_info "Git metadata written to $GIT_METADATA_FILE"
    else
        log_info "No file changes detected."
    fi
fi

# ─── Step 4: Output result (to real stdout via fd 3) ───
if [ -f "$RESULT_FILE" ]; then
    cat "$RESULT_FILE" >&3
else
    echo '{"result": "completed", "summary": "Agent execution completed but no output file generated."}' >&3
fi

log_info "Done."

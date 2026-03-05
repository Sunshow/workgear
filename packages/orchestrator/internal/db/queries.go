package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─── FlowRun Queries ───

// GetFlowRun retrieves a flow run by ID
func (c *Client) GetFlowRun(ctx context.Context, id string) (*FlowRun, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT fr.id, fr.task_id, fr.workflow_id, t.project_id, fr.status, fr.error, fr.dsl_snapshot, fr.variables,
		       fr.started_at, fr.completed_at, fr.created_at,
		       fr.integration_ref, fr.integration_head_sha
		FROM flow_runs fr
		LEFT JOIN tasks t ON fr.task_id = t.id
		WHERE fr.id = $1
	`, id)

	var fr FlowRun
	err := row.Scan(&fr.ID, &fr.TaskID, &fr.WorkflowID, &fr.ProjectID, &fr.Status, &fr.Error,
		&fr.DslSnapshot, &fr.Variables, &fr.StartedAt, &fr.CompletedAt, &fr.CreatedAt,
		&fr.IntegrationRef, &fr.IntegrationHeadSha)
	if err != nil {
		return nil, fmt.Errorf("get flow run: %w", err)
	}
	return &fr, nil
}

// GetTaskGitInfo retrieves git repo URL and branch from a task
func (c *Client) GetTaskGitInfo(ctx context.Context, taskID string) (repoURL string, branch string, err error) {
	row := c.pool.QueryRow(ctx, `
		SELECT p.git_repo_url, t.git_branch, p.git_access_token,
		       p.git_provider_type, p.git_username, p.git_password
		FROM tasks t
		JOIN projects p ON t.project_id = p.id
		WHERE t.id = $1
	`, taskID)

	var repoURLPtr, branchPtr, tokenPtr, providerTypePtr, usernamePtr, passwordPtr *string
	if err := row.Scan(&repoURLPtr, &branchPtr, &tokenPtr, &providerTypePtr, &usernamePtr, &passwordPtr); err != nil {
		return "", "", fmt.Errorf("get task git info: %w", err)
	}

	if repoURLPtr != nil {
		repoURL = *repoURLPtr
	}
	if branchPtr != nil {
		branch = *branchPtr
	}

	// Inject credentials into HTTPS URL
	providerType := "github"
	if providerTypePtr != nil {
		providerType = *providerTypePtr
	}
	if repoURL != "" {
		if providerType == "generic" && usernamePtr != nil && passwordPtr != nil && *usernamePtr != "" && *passwordPtr != "" {
			repoURL = injectUserPassIntoURL(repoURL, *usernamePtr, *passwordPtr)
		} else if tokenPtr != nil && *tokenPtr != "" {
			repoURL = injectTokenIntoURL(repoURL, *tokenPtr, providerType)
		}
	}

	return repoURL, branch, nil
}

// GetTaskGitInfoFull retrieves git repo URL, branch, access token, task title, and provider info
func (c *Client) GetTaskGitInfoFull(ctx context.Context, taskID string) (repoURL, branch, accessToken, taskTitle, providerType, gitBaseUrl, gitUsername, gitPassword string, err error) {
	row := c.pool.QueryRow(ctx, `
		SELECT COALESCE(p.git_repo_url, ''), COALESCE(t.git_branch, ''), COALESCE(p.git_access_token, ''), COALESCE(t.title, ''),
		       COALESCE(p.git_provider_type, 'github'), COALESCE(p.git_base_url, ''),
		       COALESCE(p.git_username, ''), COALESCE(p.git_password, '')
		FROM tasks t
		JOIN projects p ON t.project_id = p.id
		WHERE t.id = $1
	`, taskID)

	if err := row.Scan(&repoURL, &branch, &accessToken, &taskTitle,
		&providerType, &gitBaseUrl, &gitUsername, &gitPassword); err != nil {
		return "", "", "", "", "", "", "", "", fmt.Errorf("get task git info full: %w", err)
	}

	// Inject credentials into HTTPS URL for repoURL
	if repoURL != "" {
		if providerType == "generic" && gitUsername != "" && gitPassword != "" {
			repoURL = injectUserPassIntoURL(repoURL, gitUsername, gitPassword)
		} else if accessToken != "" {
			repoURL = injectTokenIntoURL(repoURL, accessToken, providerType)
		}
	}

	return repoURL, branch, accessToken, taskTitle, providerType, gitBaseUrl, gitUsername, gitPassword, nil
}

// injectTokenIntoURL inserts an access token into an HTTPS git URL.
// For GitHub:  https://github.com/user/repo.git → https://TOKEN@github.com/user/repo.git
// For GitLab:  https://gitlab.com/user/repo.git → https://oauth2:TOKEN@gitlab.com/user/repo.git
func injectTokenIntoURL(rawURL, token, providerType string) string {
	const httpsPrefix = "https://"
	if !strings.HasPrefix(strings.ToLower(rawURL), httpsPrefix) {
		return rawURL // not HTTPS, return as-is (e.g. SSH URL)
	}
	// If URL already contains @ (has credentials), replace them
	rest := rawURL[len(httpsPrefix):]
	if atIdx := indexOf(rest, '@'); atIdx >= 0 {
		rest = rest[atIdx+1:]
	}
	// GitLab requires oauth2:TOKEN@ format for personal access tokens
	if providerType == "gitlab" {
		return httpsPrefix + "oauth2:" + token + "@" + rest
	}
	return httpsPrefix + token + "@" + rest
}

// injectUserPassIntoURL inserts username:password into an HTTPS git URL.
// e.g. https://git.example.com/repo.git → https://user:pass@git.example.com/repo.git
func injectUserPassIntoURL(rawURL, username, password string) string {
	const httpsPrefix = "https://"
	if !strings.HasPrefix(strings.ToLower(rawURL), httpsPrefix) {
		return rawURL // not HTTPS, return as-is
	}
	// If URL already contains @ (has credentials), replace them
	rest := rawURL[len(httpsPrefix):]
	if atIdx := indexOf(rest, '@'); atIdx >= 0 {
		rest = rest[atIdx+1:]
	}
	return httpsPrefix + username + ":" + password + "@" + rest
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
		// Stop at first / to avoid matching @ in path
		if s[i] == '/' {
			return -1
		}
	}
	return -1
}

// UpdateFlowRunStatus updates the status of a flow run
func (c *Client) UpdateFlowRunStatus(ctx context.Context, id, status string) error {
	var completedAt *time.Time
	clearCompletedAt := false
	if status == StatusCompleted || status == StatusFailed || status == StatusCancelled {
		now := time.Now()
		completedAt = &now
	} else if status == StatusRunning {
		clearCompletedAt = true
	}

	var startedAt *time.Time
	if status == StatusRunning {
		now := time.Now()
		startedAt = &now
	}

	if clearCompletedAt {
		_, err := c.pool.Exec(ctx, `
			UPDATE flow_runs
			SET status = $2,
			    started_at = COALESCE($3, started_at),
			    completed_at = NULL
			WHERE id = $1
		`, id, status, startedAt)
		return err
	}

	_, err := c.pool.Exec(ctx, `
		UPDATE flow_runs
		SET status = $2,
		    started_at = COALESCE($3, started_at),
		    completed_at = COALESCE($4, completed_at)
		WHERE id = $1
	`, id, status, startedAt, completedAt)
	return err
}

// UpdateFlowRunError sets the error message on a flow run
func (c *Client) UpdateFlowRunError(ctx context.Context, id, status, errMsg string) error {
	now := time.Now()
	_, err := c.pool.Exec(ctx, `
		UPDATE flow_runs
		SET status = $2, error = $3, completed_at = $4
		WHERE id = $1
	`, id, status, errMsg, now)
	return err
}

// SaveFlowRunDslSnapshot saves the DSL snapshot when starting a flow
func (c *Client) SaveFlowRunDslSnapshot(ctx context.Context, id, dsl string, variables map[string]string) error {
	var varsJSON *string
	if variables != nil {
		b, _ := json.Marshal(variables)
		s := string(b)
		varsJSON = &s
	}
	_, err := c.pool.Exec(ctx, `
		UPDATE flow_runs
		SET dsl_snapshot = $2, variables = $3
		WHERE id = $1
	`, id, dsl, varsJSON)
	return err
}

// ─── NodeRun Queries ───

// CreateNodeRun inserts a new node run
func (c *Client) CreateNodeRun(ctx context.Context, nr *NodeRun) error {
	_, err := c.pool.Exec(ctx, `
		INSERT INTO node_runs (id, flow_run_id, node_id, node_type, node_name, status, attempt, input, config, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, nr.ID, nr.FlowRunID, nr.NodeID, nr.NodeType, nr.NodeName, nr.Status, nr.Attempt, nr.Input, nr.Config, nr.CreatedAt)
	return err
}

// AcquireNextNodeRun atomically picks the next QUEUED node run and locks it
func (c *Client) AcquireNextNodeRun(ctx context.Context, workerID string) (*NodeRun, error) {
	now := time.Now()
	row := c.pool.QueryRow(ctx, `
		UPDATE node_runs
		SET status = $1, locked_by = $2, locked_at = $3, started_at = $3
		WHERE id = (
			SELECT id FROM node_runs
			WHERE status = 'queued'
			ORDER BY created_at ASC
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, flow_run_id, node_id, node_type, node_name, status, attempt,
		          input, output, error, locked_by, locked_at, config, started_at, completed_at, created_at
	`, StatusRunning, workerID, now)

	var nr NodeRun
	err := row.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
		&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
		&nr.LockedBy, &nr.LockedAt, &nr.Config, &nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil // No queued node runs
		}
		return nil, fmt.Errorf("acquire next node run: %w", err)
	}
	return &nr, nil
}

// GetNodeRun retrieves a node run by ID
func (c *Client) GetNodeRun(ctx context.Context, id string) (*NodeRun, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, flow_run_id, node_id, node_type, node_name, status, attempt,
		       input, output, error, locked_by, locked_at,
		       review_action, review_comment, reviewed_at,
		       config, started_at, completed_at, created_at
		FROM node_runs WHERE id = $1
	`, id)

	var nr NodeRun
	err := row.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
		&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
		&nr.LockedBy, &nr.LockedAt, &nr.ReviewAction, &nr.ReviewComment, &nr.ReviewedAt,
		&nr.Config, &nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get node run: %w", err)
	}
	return &nr, nil
}

// GetNodeRunsByFlowRunID retrieves all node runs for a flow run
func (c *Client) GetNodeRunsByFlowRunID(ctx context.Context, flowRunID string) ([]*NodeRun, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, flow_run_id, node_id, node_type, node_name, status, attempt,
		       input, output, error, locked_by, locked_at,
		       review_action, review_comment, reviewed_at,
		       config, started_at, completed_at, created_at
		FROM node_runs WHERE flow_run_id = $1
		ORDER BY created_at ASC
	`, flowRunID)
	if err != nil {
		return nil, fmt.Errorf("get node runs: %w", err)
	}
	defer rows.Close()

	var nodeRuns []*NodeRun
	for rows.Next() {
		var nr NodeRun
		err := rows.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
			&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
			&nr.LockedBy, &nr.LockedAt, &nr.ReviewAction, &nr.ReviewComment, &nr.ReviewedAt,
			&nr.Config, &nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan node run: %w", err)
		}
		nodeRuns = append(nodeRuns, &nr)
	}
	return nodeRuns, nil
}

// UpdateNodeRunStatus updates the status of a node run
func (c *Client) UpdateNodeRunStatus(ctx context.Context, id, status string) error {
	var completedAt *time.Time
	if status == StatusCompleted || status == StatusFailed || status == StatusRejected {
		now := time.Now()
		completedAt = &now
	}

	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs
		SET status = $2, completed_at = COALESCE($3, completed_at)
		WHERE id = $1
	`, id, status, completedAt)
	return err
}

// UpdateNodeRunOutput sets the output of a node run
func (c *Client) UpdateNodeRunOutput(ctx context.Context, id string, output map[string]any) error {
	outputJSON, err := json.Marshal(output)
	if err != nil {
		return fmt.Errorf("marshal output: %w", err)
	}
	_, err = c.pool.Exec(ctx, `
		UPDATE node_runs SET output = $2 WHERE id = $1
	`, id, string(outputJSON))
	return err
}

// UpdateNodeRunTransientArtifacts sets the transient artifacts of a node run
func (c *Client) UpdateNodeRunTransientArtifacts(ctx context.Context, id string, artifacts map[string]any) error {
	artifactsJSON, err := json.Marshal(artifacts)
	if err != nil {
		return fmt.Errorf("marshal transient artifacts: %w", err)
	}
	_, err = c.pool.Exec(ctx, `
		UPDATE node_runs SET transient_artifacts = $2 WHERE id = $1
	`, id, string(artifactsJSON))
	return err
}

// UpdateNodeRunOutputRaw sets the output of a node run from a raw JSON string
func (c *Client) UpdateNodeRunOutputRaw(ctx context.Context, id string, outputJSON string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET output = $2 WHERE id = $1
	`, id, outputJSON)
	return err
}

// GetAllNodeRuns returns all node runs for a flow (latest attempt per node)
func (c *Client) GetAllNodeRuns(ctx context.Context, flowRunID string) ([]*NodeRun, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT nr.id, nr.flow_run_id, nr.node_id, nr.node_type, nr.node_name, nr.status, nr.attempt
		FROM node_runs nr
		INNER JOIN (
			SELECT DISTINCT ON (node_id) id
			FROM node_runs
			WHERE flow_run_id = $1
			ORDER BY node_id, attempt DESC, created_at DESC
		) latest ON nr.id = latest.id
		WHERE nr.flow_run_id = $1
	`, flowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*NodeRun
	for rows.Next() {
		var nr NodeRun
		if err := rows.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName, &nr.Status, &nr.Attempt); err != nil {
			return nil, err
		}
		result = append(result, &nr)
	}
	return result, nil
}
// UpdateNodeRunError sets the error on a node run
func (c *Client) UpdateNodeRunError(ctx context.Context, id, status, errMsg string) error {
	now := time.Now()
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET status = $2, error = $3, completed_at = $4 WHERE id = $1
	`, id, status, errMsg, now)
	return err
}

// UpdateNodeRunReview records a review action on a node run
func (c *Client) UpdateNodeRunReview(ctx context.Context, id, action, comment string) error {
	now := time.Now()
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs
		SET review_action = $2, review_comment = $3, reviewed_at = $4
		WHERE id = $1
	`, id, action, comment, now)
	return err
}

// UpdateNodeRunStatusByFlowAndNode updates status by flow_run_id + node_id combo
func (c *Client) UpdateNodeRunStatusByFlowAndNode(ctx context.Context, flowRunID, nodeID, status string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET status = $3
		WHERE flow_run_id = $1 AND node_id = $2 AND status IN ('pending', 'queued')
	`, flowRunID, nodeID, status)
	return err
}

// GetCompletedNodeIDs returns node IDs whose latest attempt is completed
func (c *Client) GetCompletedNodeIDs(ctx context.Context, flowRunID string) (map[string]bool, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT node_id FROM (
			SELECT DISTINCT ON (node_id) node_id, status
			FROM node_runs
			WHERE flow_run_id = $1
			ORDER BY node_id, attempt DESC, created_at DESC
		) latest
		WHERE status = 'completed'
	`, flowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]bool)
	for rows.Next() {
		var nodeID string
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		result[nodeID] = true
	}
	return result, nil
}

// GetPendingNodeRuns returns pending node runs (only latest attempt per node)
func (c *Client) GetPendingNodeRuns(ctx context.Context, flowRunID string) ([]*NodeRun, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT nr.id, nr.flow_run_id, nr.node_id, nr.node_type, nr.node_name, nr.status, nr.attempt
		FROM node_runs nr
		INNER JOIN (
			SELECT DISTINCT ON (node_id) id
			FROM node_runs
			WHERE flow_run_id = $1
			ORDER BY node_id, attempt DESC, created_at DESC
		) latest ON nr.id = latest.id
		WHERE nr.flow_run_id = $1 AND nr.status = 'pending'
	`, flowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*NodeRun
	for rows.Next() {
		var nr NodeRun
		if err := rows.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName, &nr.Status, &nr.Attempt); err != nil {
			return nil, err
		}
		result = append(result, &nr)
	}
	return result, nil
}

// AllNodesTerminal checks if the latest attempt of every node in a flow is in terminal state
func (c *Client) AllNodesTerminal(ctx context.Context, flowRunID string) (bool, error) {
	var count int
	err := c.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT DISTINCT ON (node_id) status
			FROM node_runs
			WHERE flow_run_id = $1
			ORDER BY node_id, attempt DESC, created_at DESC
		) latest
		WHERE status NOT IN ('completed', 'failed', 'rejected', 'cancelled')
	`, flowRunID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

// AllNodesCompleted checks if the latest attempt of every node in a flow is completed
func (c *Client) AllNodesCompleted(ctx context.Context, flowRunID string) (bool, error) {
	var count int
	err := c.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT DISTINCT ON (node_id) status
			FROM node_runs
			WHERE flow_run_id = $1
			ORDER BY node_id, attempt DESC, created_at DESC
		) latest
		WHERE status != 'completed'
	`, flowRunID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

// CancelPendingNodeRuns cancels all active (non-terminal) node runs for a flow
func (c *Client) CancelPendingNodeRuns(ctx context.Context, flowRunID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET status = 'cancelled', completed_at = COALESCE(completed_at, NOW())
		WHERE flow_run_id = $1 AND status IN ('pending', 'queued', 'waiting_human', 'running')
	`, flowRunID)
	return err
}

// GetActiveNodeRuns returns all non-terminal node runs for a flow (for cancel event publishing)
func (c *Client) GetActiveNodeRuns(ctx context.Context, flowRunID string) ([]*NodeRun, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, flow_run_id, node_id, node_type, node_name, status
		FROM node_runs
		WHERE flow_run_id = $1 AND status IN ('pending', 'queued', 'waiting_human', 'running')
	`, flowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*NodeRun
	for rows.Next() {
		var nr NodeRun
		if err := rows.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName, &nr.Status); err != nil {
			return nil, err
		}
		result = append(result, &nr)
	}
	return result, nil
}

// GetNodeRunByFlowAndNode finds a node run by flow_run_id and node_id
func (c *Client) GetNodeRunByFlowAndNode(ctx context.Context, flowRunID, nodeID string) (*NodeRun, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, flow_run_id, node_id, node_type, node_name, status, attempt,
		       input, output, error, config, started_at, completed_at, created_at
		FROM node_runs
		WHERE flow_run_id = $1 AND node_id = $2
		ORDER BY attempt DESC
		LIMIT 1
	`, flowRunID, nodeID)

	var nr NodeRun
	err := row.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
		&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
		&nr.Config, &nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get node run by flow and node: %w", err)
	}
	return &nr, nil
}

// GetRecoverableFlowRuns returns flow runs that need recovery after restart
func (c *Client) GetRecoverableFlowRuns(ctx context.Context) ([]*FlowRun, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT fr.id, fr.task_id, fr.workflow_id, t.project_id, fr.status, fr.error, fr.dsl_snapshot, fr.variables,
		       fr.started_at, fr.completed_at, fr.created_at,
		       fr.integration_ref, fr.integration_head_sha
		FROM flow_runs fr
		LEFT JOIN tasks t ON fr.task_id = t.id
		WHERE fr.status IN ('running', 'pending')
		ORDER BY fr.created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*FlowRun
	for rows.Next() {
		var fr FlowRun
		if err := rows.Scan(&fr.ID, &fr.TaskID, &fr.WorkflowID, &fr.ProjectID, &fr.Status, &fr.Error,
			&fr.DslSnapshot, &fr.Variables, &fr.StartedAt, &fr.CompletedAt, &fr.CreatedAt,
			&fr.IntegrationRef, &fr.IntegrationHeadSha); err != nil {
			return nil, err
		}
		result = append(result, &fr)
	}
	return result, nil
}

// ResetStaleRunningNodes resets RUNNING nodes that were locked by a dead worker
func (c *Client) ResetStaleRunningNodes(ctx context.Context) (int, error) {
	result, err := c.pool.Exec(ctx, `
		UPDATE node_runs
		SET status = 'queued', locked_by = NULL, locked_at = NULL, started_at = NULL
		WHERE status = 'running' AND locked_by IS NOT NULL
	`)
	if err != nil {
		return 0, err
	}
	return int(result.RowsAffected()), nil
}

// CancelStaleFlowRuns cancels flow_runs stuck in 'running' status with no progress
// for longer than the given threshold. Also cancels their non-terminal node_runs.
func (c *Client) CancelStaleFlowRuns(ctx context.Context, staleThreshold time.Duration) (int, error) {
	cutoff := time.Now().UTC().Add(-staleThreshold)

	// Cancel stale flow_runs
	result, err := c.pool.Exec(ctx, `
		UPDATE flow_runs
		SET status = 'cancelled', error = 'auto-cancelled: stale running flow', completed_at = NOW()
		WHERE status = 'running'
		  AND started_at < $1
		  AND NOT EXISTS (
		    SELECT 1 FROM node_runs
		    WHERE node_runs.flow_run_id = flow_runs.id
		      AND node_runs.status = 'running'
		      AND node_runs.locked_at > $1
		  )
	`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("cancel stale flow_runs: %w", err)
	}
	flowCount := int(result.RowsAffected())

	if flowCount > 0 {
		// Cancel non-terminal node_runs belonging to cancelled flow_runs
		_, err = c.pool.Exec(ctx, `
			UPDATE node_runs
			SET status = 'cancelled', completed_at = NOW(), locked_by = NULL
			WHERE flow_run_id IN (
				SELECT id FROM flow_runs
				WHERE status = 'cancelled' AND error = 'auto-cancelled: stale running flow'
			)
			AND status NOT IN ('completed', 'cancelled', 'failed')
		`)
		if err != nil {
			return flowCount, fmt.Errorf("cancel stale node_runs: %w", err)
		}
	}

	return flowCount, nil
}

// SyncStaleDslSnapshots updates dsl_snapshot of active flow_runs to match their workflow's current DSL.
// This prevents stale DSL snapshots from causing issues after template updates.
func (c *Client) SyncStaleDslSnapshots(ctx context.Context) (int, error) {
	rows, err := c.pool.Query(ctx, `
		UPDATE flow_runs fr
		SET dsl_snapshot = w.dsl
		FROM workflows w
		WHERE fr.workflow_id = w.id
		  AND fr.status IN ('running', 'pending')
		  AND fr.dsl_snapshot IS DISTINCT FROM w.dsl
		RETURNING fr.id
	`)
	if err != nil {
		return 0, fmt.Errorf("sync stale DSL snapshots: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		count++
	}
	return count, rows.Err()
}

// ─── Timeline Queries ───

// UpdateNodeRunInput sets the input of a node run
func (c *Client) UpdateNodeRunInput(ctx context.Context, id string, input *string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET input = $2 WHERE id = $1
	`, id, input)
	return err
}

// UpdateNodeRunLogStream saves log stream events to node_runs.log_stream
func (c *Client) UpdateNodeRunLogStream(ctx context.Context, id string, logEvents []map[string]any) error {
	logJSON, err := json.Marshal(logEvents)
	if err != nil {
		return fmt.Errorf("marshal log events: %w", err)
	}
	_, err = c.pool.Exec(ctx, `
		UPDATE node_runs SET log_stream = $2 WHERE id = $1
	`, id, string(logJSON))
	return err
}

// GetAllNodeRunOutputs returns a map of nodeID → parsed output for all completed nodes in a flow run.
// For nodes with multiple attempts, only the latest completed attempt is returned.
func (c *Client) GetAllNodeRunOutputs(ctx context.Context, flowRunID string) (map[string]map[string]any, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT DISTINCT ON (node_id) node_id, output
		FROM node_runs
		WHERE flow_run_id = $1 AND status = 'completed' AND output IS NOT NULL
		ORDER BY node_id, attempt DESC, created_at DESC
	`, flowRunID)
	if err != nil {
		return nil, fmt.Errorf("get all node run outputs: %w", err)
	}
	defer rows.Close()

	result := make(map[string]map[string]any)
	for rows.Next() {
		var nodeID string
		var outputStr string
		if err := rows.Scan(&nodeID, &outputStr); err != nil {
			return nil, err
		}
		var output map[string]any
		if err := json.Unmarshal([]byte(outputStr), &output); err == nil {
			result[nodeID] = output
		}
	}
	return result, nil
}

// GetTaskBasicInfo retrieves task id and title
func (c *Client) GetTaskBasicInfo(ctx context.Context, taskID string) (id, title string, err error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, COALESCE(title, '') FROM tasks WHERE id = $1
	`, taskID)
	if err := row.Scan(&id, &title); err != nil {
		return "", "", fmt.Errorf("get task basic info: %w", err)
	}
	return id, title, nil
}

// CreateTimelineEvent inserts a timeline event
func (c *Client) CreateTimelineEvent(ctx context.Context, evt *TimelineEvent) error {
	_, err := c.pool.Exec(ctx, `
		INSERT INTO timeline_events (id, task_id, flow_run_id, node_run_id, event_type, content, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, evt.ID, evt.TaskID, evt.FlowRunID, evt.NodeRunID, evt.EventType, evt.Content, evt.CreatedAt)
	return err
}

// ─── Artifact Queries ───

// CreateArtifact creates a new artifact record
func (c *Client) CreateArtifact(ctx context.Context, taskID, artifactType, title, filePath, flowRunID, nodeRunID string) (string, error) {
	var id string
	// Use NULL for empty optional foreign keys
	var flowRunIDParam, nodeRunIDParam any
	if flowRunID != "" {
		flowRunIDParam = flowRunID
	}
	if nodeRunID != "" {
		nodeRunIDParam = nodeRunID
	}
	err := c.pool.QueryRow(ctx, `
		INSERT INTO artifacts (id, task_id, flow_run_id, node_run_id, type, title, file_path, created_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
		RETURNING id
	`, taskID, flowRunIDParam, nodeRunIDParam, artifactType, title, filePath).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("create artifact: %w", err)
	}
	return id, nil
}

// CreateArtifactVersion creates a new version for an artifact
func (c *Client) CreateArtifactVersion(ctx context.Context, artifactID string, version int, content, changeSummary, createdBy string) error {
	_, err := c.pool.Exec(ctx, `
		INSERT INTO artifact_versions (id, artifact_id, version, content, change_summary, created_by, created_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
	`, artifactID, version, content, changeSummary, createdBy)
	if err != nil {
		return fmt.Errorf("create artifact version: %w", err)
	}
	return nil
}

// PreviousNodeOutput holds a completed node's output from a previous flow run
type PreviousNodeOutput struct {
	NodeID string
	Output string
}

// GetPreviousFlowCompletedNodes finds the most recent non-cancelled flow run for the same task
// and returns all completed node outputs (latest attempt per node).
func (c *Client) GetPreviousFlowCompletedNodes(ctx context.Context, taskID, currentFlowRunID string) ([]PreviousNodeOutput, error) {
	rows, err := c.pool.Query(ctx, `
		WITH prev_flow AS (
			SELECT id FROM flow_runs
			WHERE task_id = $1 AND id != $2 AND status != 'pending'
			ORDER BY created_at DESC
			LIMIT 1
		)
		SELECT nr.node_id, nr.output
		FROM node_runs nr
		INNER JOIN (
			SELECT DISTINCT ON (node_id) id
			FROM node_runs
			WHERE flow_run_id = (SELECT id FROM prev_flow)
			ORDER BY node_id, attempt DESC, created_at DESC
		) latest ON nr.id = latest.id
		WHERE nr.status = 'completed' AND nr.output IS NOT NULL
	`, taskID, currentFlowRunID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []PreviousNodeOutput
	for rows.Next() {
		var p PreviousNodeOutput
		if err := rows.Scan(&p.NodeID, &p.Output); err != nil {
			return nil, err
		}
		results = append(results, p)
	}
	return results, nil
}

// HasPreviousFlowOutput checks if a node has completed output from any previous flow of the same task
func (c *Client) HasPreviousFlowOutput(ctx context.Context, flowRunID, nodeID string) (bool, error) {
	var exists bool
	err := c.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM node_runs nr
			INNER JOIN flow_runs fr ON nr.flow_run_id = fr.id
			WHERE fr.task_id = (SELECT task_id FROM flow_runs WHERE id = $1)
			  AND fr.id != $1
			  AND nr.node_id = $2
			  AND nr.status = 'completed'
			  AND nr.output IS NOT NULL
		)
	`, flowRunID, nodeID).Scan(&exists)
	return exists, err
}

// GetRunningFlowRunIDs returns all flow_run IDs in 'running' status.
func (c *Client) GetRunningFlowRunIDs(ctx context.Context) ([]string, error) {
	rows, err := c.pool.Query(ctx, `SELECT id FROM flow_runs WHERE status = 'running'`)
	if err != nil {
		return nil, fmt.Errorf("get running flow runs: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// UpdateTaskColumn moves a task to the specified kanban column by column name.
// Uses a subquery to find the column ID from the task's project kanban.
// Silently does nothing if the column name doesn't exist.
func (c *Client) UpdateTaskColumn(ctx context.Context, taskID, columnName string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE tasks
		SET column_id = (
			SELECT kc.id FROM kanban_columns kc
			JOIN kanbans k ON kc.kanban_id = k.id
			WHERE k.project_id = tasks.project_id AND kc.name = $2
			LIMIT 1
		),
		updated_at = NOW()
		WHERE id = $1
		AND EXISTS (
			SELECT 1 FROM kanban_columns kc
			JOIN kanbans k ON kc.kanban_id = k.id
			WHERE k.project_id = tasks.project_id AND kc.name = $2
		)
	`, taskID, columnName)
	if err != nil {
		return fmt.Errorf("update task column: %w", err)
	}
	return nil
}

// UpdateTaskGitBranch updates the git_branch field of a task
func (c *Client) UpdateTaskGitBranch(ctx context.Context, taskID, branch string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE tasks SET git_branch = $2 WHERE id = $1
	`, taskID, branch)
	if err != nil {
		return fmt.Errorf("update task git branch: %w", err)
	}
	return nil
}

// UpdateFlowRunPR updates PR-related fields on a flow run.
// Uses COALESCE to only write non-empty values, preserving existing data.
func (c *Client) UpdateFlowRunPR(ctx context.Context, flowRunID, branchName, prUrl string, prNumber int) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE flow_runs
		SET branch_name = COALESCE(NULLIF($2, ''), branch_name),
		    pr_url = COALESCE(NULLIF($3, ''), pr_url),
		    pr_number = COALESCE(NULLIF($4, 0), pr_number)
		WHERE id = $1
	`, flowRunID, branchName, prUrl, prNumber)
	if err != nil {
		return fmt.Errorf("update flow run PR: %w", err)
	}
	return nil
}

// ─── Agent Role Queries ───

// GetAgentRoleConfig retrieves agent role configuration by slug
func (c *Client) GetAgentRoleConfig(ctx context.Context, slug string) (*AgentRoleConfig, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, slug, agent_type, provider_id, model_id, system_prompt, skill_ids
		FROM agent_roles
		WHERE slug = $1
	`, slug)

	var config AgentRoleConfig
	var skillIDsJSON []byte
	err := row.Scan(&config.ID, &config.Slug, &config.AgentType, &config.ProviderID, &config.ModelID, &config.SystemPrompt, &skillIDsJSON)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil // Role not found in DB, will use fallback
		}
		return nil, fmt.Errorf("get agent role config: %w", err)
	}

	// Parse skill_ids JSON array
	if len(skillIDsJSON) > 0 {
		if err := json.Unmarshal(skillIDsJSON, &config.SkillIDs); err != nil {
			return nil, fmt.Errorf("unmarshal skill_ids: %w", err)
		}
	}

	return &config, nil
}

// GetAllAgentRoleConfigs retrieves all agent role configurations as a map
func (c *Client) GetAllAgentRoleConfigs(ctx context.Context) (map[string]*AgentRoleConfig, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, slug, agent_type, provider_id, model_id, system_prompt, skill_ids
		FROM agent_roles
		ORDER BY slug
	`)
	if err != nil {
		return nil, fmt.Errorf("get all agent role configs: %w", err)
	}
	defer rows.Close()

	result := make(map[string]*AgentRoleConfig)
	for rows.Next() {
		var config AgentRoleConfig
		var skillIDsJSON []byte
		if err := rows.Scan(&config.ID, &config.Slug, &config.AgentType, &config.ProviderID, &config.ModelID, &config.SystemPrompt, &skillIDsJSON); err != nil {
			return nil, fmt.Errorf("scan agent role config: %w", err)
		}

		// Parse skill_ids JSON array
		if len(skillIDsJSON) > 0 {
			if err := json.Unmarshal(skillIDsJSON, &config.SkillIDs); err != nil {
				return nil, fmt.Errorf("unmarshal skill_ids: %w", err)
			}
		}

		result[config.Slug] = &config
	}
	return result, nil
}

// ─── Agent Provider Queries ───

// GetAllAgentProviders retrieves all agent providers
func (c *Client) GetAllAgentProviders(ctx context.Context) ([]*AgentProvider, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, agent_type, name, config, is_default
		FROM agent_providers
		ORDER BY agent_type, created_at
	`)
	if err != nil {
		return nil, fmt.Errorf("get all agent providers: %w", err)
	}
	defer rows.Close()

	var result []*AgentProvider
	for rows.Next() {
		var p AgentProvider
		var configJSON []byte
		if err := rows.Scan(&p.ID, &p.AgentType, &p.Name, &configJSON, &p.IsDefault); err != nil {
			return nil, fmt.Errorf("scan agent provider: %w", err)
		}
		if err := json.Unmarshal(configJSON, &p.Config); err != nil {
			return nil, fmt.Errorf("unmarshal provider config: %w", err)
		}
		result = append(result, &p)
	}
	return result, nil
}

// GetAgentProvider retrieves a single agent provider by ID
func (c *Client) GetAgentProvider(ctx context.Context, id string) (*AgentProvider, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, agent_type, name, config, is_default
		FROM agent_providers
		WHERE id = $1
	`, id)

	var p AgentProvider
	var configJSON []byte
	err := row.Scan(&p.ID, &p.AgentType, &p.Name, &configJSON, &p.IsDefault)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get agent provider: %w", err)
	}
	if err := json.Unmarshal(configJSON, &p.Config); err != nil {
		return nil, fmt.Errorf("unmarshal provider config: %w", err)
	}
	return &p, nil
}

// GetDefaultProviderForType retrieves the default provider for an agent type
func (c *Client) GetDefaultProviderForType(ctx context.Context, agentType string) (*AgentProvider, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, agent_type, name, config, is_default
		FROM agent_providers
		WHERE agent_type = $1 AND is_default = true
		LIMIT 1
	`, agentType)

	var p AgentProvider
	var configJSON []byte
	err := row.Scan(&p.ID, &p.AgentType, &p.Name, &configJSON, &p.IsDefault)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get default provider: %w", err)
	}
	if err := json.Unmarshal(configJSON, &p.Config); err != nil {
		return nil, fmt.Errorf("unmarshal provider config: %w", err)
	}
	return &p, nil
}

// ─── Agent Model Queries ───

// GetAgentModel retrieves a single agent model by ID
func (c *Client) GetAgentModel(ctx context.Context, id string) (*AgentModel, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, provider_id, model_name, display_name, is_default
		FROM agent_models
		WHERE id = $1
	`, id)

	var m AgentModel
	err := row.Scan(&m.ID, &m.ProviderID, &m.ModelName, &m.DisplayName, &m.IsDefault)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get agent model: %w", err)
	}
	return &m, nil
}

// GetDefaultModelForProvider retrieves the default model for a provider
func (c *Client) GetDefaultModelForProvider(ctx context.Context, providerID string) (*AgentModel, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, provider_id, model_name, display_name, is_default
		FROM agent_models
		WHERE provider_id = $1 AND is_default = true
		LIMIT 1
	`, providerID)

	var m AgentModel
	err := row.Scan(&m.ID, &m.ProviderID, &m.ModelName, &m.DisplayName, &m.IsDefault)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get default model: %w", err)
	}
	return &m, nil
}

// GetModelsForProvider retrieves all models for a provider
func (c *Client) GetModelsForProvider(ctx context.Context, providerID string) ([]*AgentModel, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, provider_id, model_name, display_name, is_default
		FROM agent_models
		WHERE provider_id = $1
		ORDER BY created_at
	`, providerID)
	if err != nil {
		return nil, fmt.Errorf("get models for provider: %w", err)
	}
	defer rows.Close()

	var result []*AgentModel
	for rows.Next() {
		var m AgentModel
		if err := rows.Scan(&m.ID, &m.ProviderID, &m.ModelName, &m.DisplayName, &m.IsDefault); err != nil {
			return nil, fmt.Errorf("scan agent model: %w", err)
		}
		result = append(result, &m)
	}
	return result, nil
}

// ─── Git Repo Cache Queries ───

// UpdateFlowRunIntegration updates the integration ref and head SHA on a flow run.
func (c *Client) UpdateFlowRunIntegration(ctx context.Context, flowRunID, integrationRef, headSHA string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE flow_runs
		SET integration_ref = $1, integration_head_sha = $2
		WHERE id = $3
	`, integrationRef, headSHA, flowRunID)
	if err != nil {
		return fmt.Errorf("update flow run integration: %w", err)
	}
	return nil
}

// UpdateNodeRunGitState updates the git execution state on a node run.
func (c *Client) UpdateNodeRunGitState(ctx context.Context, nodeRunID, baseSHA, commitSHA, worktreePath string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs
		SET base_sha = $1, commit_sha = $2, worktree_path = $3
		WHERE id = $4
	`, nilIfEmpty(baseSHA), nilIfEmpty(commitSHA), nilIfEmpty(worktreePath), nodeRunID)
	if err != nil {
		return fmt.Errorf("update node run git state: %w", err)
	}
	return nil
}

// GetTaskProjectID retrieves the project_id for a task.
func (c *Client) GetTaskProjectID(ctx context.Context, taskID string) (string, error) {
	var projectID string
	err := c.pool.QueryRow(ctx, `
		SELECT project_id FROM tasks WHERE id = $1
	`, taskID).Scan(&projectID)
	if err != nil {
		return "", fmt.Errorf("get task project id: %w", err)
	}
	return projectID, nil
}

// nilIfEmpty returns nil for empty strings, or a pointer to the string.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ─── Skill Queries ───

// GetSkillsByIDs retrieves skills by their IDs
func (c *Client) GetSkillsByIDs(ctx context.Context, skillIDs []string) ([]*Skill, error) {
	if len(skillIDs) == 0 {
		return []*Skill{}, nil
	}

	rows, err := c.pool.Query(ctx, `
		SELECT id, name, description, prompt, source_url
		FROM skills
		WHERE id = ANY($1)
		ORDER BY name
	`, skillIDs)
	if err != nil {
		return nil, fmt.Errorf("get skills by ids: %w", err)
	}
	defer rows.Close()

	var result []*Skill
	for rows.Next() {
		var skill Skill
		if err := rows.Scan(&skill.ID, &skill.Name, &skill.Description, &skill.Prompt, &skill.SourceURL); err != nil {
			return nil, fmt.Errorf("scan skill: %w", err)
		}
		result = append(result, &skill)
	}
	return result, nil
}

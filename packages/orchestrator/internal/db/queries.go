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
		SELECT id, task_id, workflow_id, status, error, dsl_snapshot, variables,
		       started_at, completed_at, created_at
		FROM flow_runs WHERE id = $1
	`, id)

	var fr FlowRun
	err := row.Scan(&fr.ID, &fr.TaskID, &fr.WorkflowID, &fr.Status, &fr.Error,
		&fr.DslSnapshot, &fr.Variables, &fr.StartedAt, &fr.CompletedAt, &fr.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get flow run: %w", err)
	}
	return &fr, nil
}

// GetTaskGitInfo retrieves git repo URL and branch from a task
func (c *Client) GetTaskGitInfo(ctx context.Context, taskID string) (repoURL string, branch string, err error) {
	row := c.pool.QueryRow(ctx, `
		SELECT p.git_repo_url, t.git_branch, p.git_access_token
		FROM tasks t
		JOIN projects p ON t.project_id = p.id
		WHERE t.id = $1
	`, taskID)

	var repoURLPtr, branchPtr, tokenPtr *string
	if err := row.Scan(&repoURLPtr, &branchPtr, &tokenPtr); err != nil {
		return "", "", fmt.Errorf("get task git info: %w", err)
	}

	if repoURLPtr != nil {
		repoURL = *repoURLPtr
	}
	if branchPtr != nil {
		branch = *branchPtr
	}

	// Inject access token into HTTPS URL: https://TOKEN@github.com/...
	if tokenPtr != nil && *tokenPtr != "" && repoURL != "" {
		repoURL = injectTokenIntoURL(repoURL, *tokenPtr)
	}

	return repoURL, branch, nil
}

// GetTaskGitInfoFull retrieves git repo URL, branch, access token, and task title
func (c *Client) GetTaskGitInfoFull(ctx context.Context, taskID string) (repoURL, branch, accessToken, taskTitle string, err error) {
	row := c.pool.QueryRow(ctx, `
		SELECT p.git_repo_url, t.git_branch, p.git_access_token, COALESCE(t.title, '')
		FROM tasks t
		JOIN projects p ON t.project_id = p.id
		WHERE t.id = $1
	`, taskID)

	var repoURLPtr, branchPtr, tokenPtr *string
	if err := row.Scan(&repoURLPtr, &branchPtr, &tokenPtr, &taskTitle); err != nil {
		return "", "", "", "", fmt.Errorf("get task git info full: %w", err)
	}

	if repoURLPtr != nil {
		repoURL = *repoURLPtr
	}
	if branchPtr != nil {
		branch = *branchPtr
	}
	if tokenPtr != nil {
		accessToken = *tokenPtr
	}

	// Inject access token into HTTPS URL for repoURL
	if accessToken != "" && repoURL != "" {
		repoURL = injectTokenIntoURL(repoURL, accessToken)
	}

	return repoURL, branch, accessToken, taskTitle, nil
}

// injectTokenIntoURL inserts an access token into an HTTPS git URL.
// e.g. https://github.com/user/repo.git → https://TOKEN@github.com/user/repo.git
func injectTokenIntoURL(rawURL, token string) string {
	const httpsPrefix = "https://"
	if !strings.HasPrefix(strings.ToLower(rawURL), httpsPrefix) {
		return rawURL // not HTTPS, return as-is (e.g. SSH URL)
	}
	// If URL already contains @ (has credentials), replace them
	rest := rawURL[len(httpsPrefix):]
	if atIdx := indexOf(rest, '@'); atIdx >= 0 {
		rest = rest[atIdx+1:]
	}
	return httpsPrefix + token + "@" + rest
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
	if status == StatusCompleted || status == StatusFailed || status == StatusCancelled {
		now := time.Now()
		completedAt = &now
	}

	var startedAt *time.Time
	if status == StatusRunning {
		now := time.Now()
		startedAt = &now
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
		INSERT INTO node_runs (id, flow_run_id, node_id, node_type, node_name, status, attempt, input, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, nr.ID, nr.FlowRunID, nr.NodeID, nr.NodeType, nr.NodeName, nr.Status, nr.Attempt, nr.Input, nr.CreatedAt)
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
		          input, output, error, locked_by, locked_at, started_at, completed_at, created_at
	`, StatusRunning, workerID, now)

	var nr NodeRun
	err := row.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
		&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
		&nr.LockedBy, &nr.LockedAt, &nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
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
		       started_at, completed_at, created_at
		FROM node_runs WHERE id = $1
	`, id)

	var nr NodeRun
	err := row.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
		&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
		&nr.LockedBy, &nr.LockedAt, &nr.ReviewAction, &nr.ReviewComment, &nr.ReviewedAt,
		&nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
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
		       started_at, completed_at, created_at
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
			&nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
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
			ORDER BY node_id, attempt DESC
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
			ORDER BY node_id, attempt DESC
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

// AllNodesTerminal checks if all node runs for a flow are in terminal state
func (c *Client) AllNodesTerminal(ctx context.Context, flowRunID string) (bool, error) {
	var count int
	err := c.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM node_runs
		WHERE flow_run_id = $1 AND status NOT IN ('completed', 'failed', 'rejected', 'cancelled')
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
			ORDER BY node_id, attempt DESC
		) latest
		WHERE status != 'completed'
	`, flowRunID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

// CancelPendingNodeRuns cancels all pending/queued node runs for a flow
func (c *Client) CancelPendingNodeRuns(ctx context.Context, flowRunID string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET status = 'cancelled'
		WHERE flow_run_id = $1 AND status IN ('pending', 'queued')
	`, flowRunID)
	return err
}

// GetNodeRunByFlowAndNode finds a node run by flow_run_id and node_id
func (c *Client) GetNodeRunByFlowAndNode(ctx context.Context, flowRunID, nodeID string) (*NodeRun, error) {
	row := c.pool.QueryRow(ctx, `
		SELECT id, flow_run_id, node_id, node_type, node_name, status, attempt,
		       input, output, error, started_at, completed_at, created_at
		FROM node_runs
		WHERE flow_run_id = $1 AND node_id = $2
		ORDER BY attempt DESC
		LIMIT 1
	`, flowRunID, nodeID)

	var nr NodeRun
	err := row.Scan(&nr.ID, &nr.FlowRunID, &nr.NodeID, &nr.NodeType, &nr.NodeName,
		&nr.Status, &nr.Attempt, &nr.Input, &nr.Output, &nr.Error,
		&nr.StartedAt, &nr.CompletedAt, &nr.CreatedAt)
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
		SELECT id, task_id, workflow_id, status, error, dsl_snapshot, variables,
		       started_at, completed_at, created_at
		FROM flow_runs
		WHERE status IN ('running', 'pending')
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*FlowRun
	for rows.Next() {
		var fr FlowRun
		if err := rows.Scan(&fr.ID, &fr.TaskID, &fr.WorkflowID, &fr.Status, &fr.Error,
			&fr.DslSnapshot, &fr.Variables, &fr.StartedAt, &fr.CompletedAt, &fr.CreatedAt); err != nil {
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

// ─── Timeline Queries ───

// UpdateNodeRunInput sets the input of a node run
func (c *Client) UpdateNodeRunInput(ctx context.Context, id string, input *string) error {
	_, err := c.pool.Exec(ctx, `
		UPDATE node_runs SET input = $2 WHERE id = $1
	`, id, input)
	return err
}

// GetAllNodeRunOutputs returns a map of nodeID → parsed output for all completed nodes in a flow run.
// For nodes with multiple attempts, only the latest completed attempt is returned.
func (c *Client) GetAllNodeRunOutputs(ctx context.Context, flowRunID string) (map[string]map[string]any, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT DISTINCT ON (node_id) node_id, output
		FROM node_runs
		WHERE flow_run_id = $1 AND status = 'completed' AND output IS NOT NULL
		ORDER BY node_id, attempt DESC
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

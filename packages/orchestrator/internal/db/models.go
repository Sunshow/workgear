package db

import "time"

// FlowRun 流程实例
type FlowRun struct {
	ID          string     `json:"id"`
	TaskID      string     `json:"task_id"`
	WorkflowID  string     `json:"workflow_id"`
	Status      string     `json:"status"` // pending / running / completed / failed / cancelled
	Error       *string    `json:"error"`
	DslSnapshot *string    `json:"dsl_snapshot"`
	Variables   *string    `json:"variables"` // JSON string
	StartedAt   *time.Time `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// NodeRun 节点执行实例
type NodeRun struct {
	ID              string     `json:"id"`
	FlowRunID       string     `json:"flow_run_id"`
	NodeID          string     `json:"node_id"`
	NodeType        *string    `json:"node_type"`
	NodeName        *string    `json:"node_name"`
	Status          string     `json:"status"` // pending / queued / running / completed / failed / rejected / waiting_human
	Attempt         int        `json:"attempt"`
	Input           *string    `json:"input"`  // JSON string
	Output          *string    `json:"output"` // JSON string
	Error           *string    `json:"error"`
	LockedBy        *string    `json:"locked_by"`
	LockedAt        *time.Time `json:"locked_at"`
	ReviewAction    *string    `json:"review_action"`  // approve / reject / edit_and_approve
	ReviewComment   *string    `json:"review_comment"`
	ReviewedAt      *time.Time `json:"reviewed_at"`
	StartedAt       *time.Time `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at"`
	RecoveryCheckpoint *string `json:"recovery_checkpoint"`
	CreatedAt       time.Time  `json:"created_at"`
}

// TimelineEvent 时间线事件
type TimelineEvent struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"task_id"`
	FlowRunID *string   `json:"flow_run_id"`
	NodeRunID *string   `json:"node_run_id"`
	EventType string    `json:"event_type"`
	Content   string    `json:"content"` // JSON string
	CreatedAt time.Time `json:"created_at"`
}

// NodeRun 状态常量
const (
	StatusPending      = "pending"
	StatusQueued       = "queued"
	StatusRunning      = "running"
	StatusCompleted    = "completed"
	StatusFailed       = "failed"
	StatusRejected     = "rejected"
	StatusWaitingHuman = "waiting_human"
	StatusCancelled    = "cancelled"
)

# 9. 关键技术细节

## 9.1 流程引擎执行器实现（Go）

> P1-2 改进：改为"持久化驱动状态机"模型，Worker 无状态可重启。

### 9.1.1 核心架构

```go
// internal/engine/executor.go
package engine

// FlowExecutor 不再持有内存状态，所有状态通过 DB 读写
type FlowExecutor struct {
    db         *DB
    eventBus   *EventBus
    scheduler  *AgentScheduler
    registry   *AgentRegistry
}

// 主循环：Worker 轮询 DB 中待执行的节点
func (e *FlowExecutor) RunWorkerLoop(ctx context.Context, workerID string) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
            // 1. 从 DB 获取一个可执行的 NodeRun（加锁）
            nodeRun, err := e.db.AcquireNextNodeRun(ctx, workerID)
            if err != nil || nodeRun == nil {
                time.Sleep(500 * time.Millisecond)
                continue
            }
            
            // 2. 执行节点
            if err := e.executeNode(ctx, nodeRun); err != nil {
                e.handleNodeError(ctx, nodeRun, err)
            }
            
            // 3. 推进 DAG：检查后续节点是否可执行
            e.advanceDAG(ctx, nodeRun.FlowRunID)
        }
    }
}
```

### 9.1.2 启动流程

```go
func (e *FlowExecutor) StartFlow(ctx context.Context, req *StartFlowRequest) (*FlowRun, error) {
    // 1. 加载 Workflow DSL
    workflow, _ := e.db.GetWorkflow(ctx, req.WorkflowID)
    dag := ParseDAG(workflow.DSL)
    
    // 2. 创建 FlowRun
    flowRun := &FlowRun{
        ID:          uuid.New(),
        WorkflowID:  req.WorkflowID,
        ProjectID:   req.ProjectID,
        TaskID:      req.TaskID,
        Status:      StatusRunning,
        Variables:    req.Variables,
        TriggerType: req.TriggerType,
        ExecutionDomain: req.ExecutionDomain,
        StartedAt:   time.Now(),
    }
    
    // 默认推导（若未指定）
    if flowRun.ExecutionDomain == "" {
        if req.TriggerType == "desktop" {
            flowRun.ExecutionDomain = "local"
        } else {
            flowRun.ExecutionDomain = "cloud"
        }
    }
    
    e.db.CreateFlowRun(ctx, flowRun)
    
    // 3. 为所有入口节点创建 QUEUED 状态的 NodeRun
    entryNodes := dag.GetEntryNodes()
    for _, node := range entryNodes {
        nodeRun := &NodeRun{
            ID:         uuid.New(),
            FlowRunID:  flowRun.ID,
            NodeID:     node.ID,
            NodeName:   node.Name,
            NodeType:   node.Type,
            Status:     StatusQueued,
            ScopeKey:   "",
            IterationKey: "",
            Attempt:    1,
            Input:      e.resolveNodeInput(ctx, flowRun, node, nil),
        }
        e.db.CreateNodeRun(ctx, nodeRun)
    }
    
    // 4. Worker 会自动拾取 QUEUED 的 NodeRun
    return flowRun, nil
}
```

### 9.1.3 节点执行分发

```go
func (e *FlowExecutor) executeNode(ctx context.Context, nodeRun *NodeRun) error {
    // 更新状态为 RUNNING
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusRunning)
    
    node := e.getNodeFromDSL(ctx, nodeRun)
    
    switch node.Type {
    case "agent_task":
        return e.executeAgentTask(ctx, nodeRun, node)
    case "human_review":
        return e.executeHumanReview(ctx, nodeRun, node)
    case "human_input":
        return e.executeHumanInput(ctx, nodeRun, node)
    case "parallel_group":
        return e.executeParallelGroup(ctx, nodeRun, node)
    case "collab_task":
        return e.executeCollabTask(ctx, nodeRun, node)
    case "adjudicate":
        return e.executeAdjudicate(ctx, nodeRun, node)
    case "aggregate":
        return e.executeAggregate(ctx, nodeRun, node)
    case "conditional":
        return e.executeConditional(ctx, nodeRun, node)
    case "integration":
        return e.executeIntegration(ctx, nodeRun, node)
    default:
        return fmt.Errorf("unknown node type: %s", node.Type)
    }
}
```

### 9.1.4 Agent 任务执行

```go
func (e *FlowExecutor) executeAgentTask(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    // 1. 解析 Agent 角色
    role := e.resolveExpression(node.Agent.Role, nodeRun.Input)
    
    // 2. 从 Registry 选择 Agent 实例
    agent, err := e.registry.SelectAgent(ctx, &TaskRequest{
        FlowRunID: nodeRun.FlowRunID,
        AgentRole: role,
        Mode:      node.Config.Mode,
    }, nil)
    if err != nil {
        return err
    }
    
    // 3. 构建 TaskRequest
    req := &TaskRequest{
        TaskID:           nodeRun.ID,
        FlowRunID:        nodeRun.FlowRunID,
        NodeID:           node.ID,
        Mode:             node.Config.Mode,
        Prompt:           e.renderPrompt(node.Config.PromptTemplate, nodeRun.Input),
        Context:          nodeRun.Input,
        WorkDir:          e.getWorkDir(ctx, nodeRun.FlowRunID),
        GitBranch:        e.getGitBranch(ctx, nodeRun),
        IdempotencyKey:   nodeRun.IdempotencyKey,
        PreviousFeedback: nodeRun.Input["_feedback"],
    }
    
    // 4. 流式执行
    stream, err := agent.Stream(ctx, req)
    if err != nil {
        return err
    }
    
    var finalOutput map[string]any
    for event := range stream {
        // 推送到前端
        e.eventBus.Publish(&Event{
            Type:      "node.output_stream",
            FlowRunID: nodeRun.FlowRunID,
            NodeRunID: nodeRun.ID,
            Data:      event,
        })
        if event.Type == "done" {
            finalOutput = event.Data
        }
    }
    
    // 5. 处理产物（如果节点配置了 artifact）
    if node.Config.Artifact != nil {
        e.handleArtifactOutput(ctx, nodeRun, node, finalOutput)
    }
    
    // 6. 完成
    e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, finalOutput)
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusCompleted)
    return nil
}
```

### 9.1.5 人工节点（持久化驱动，不阻塞）

```go
// P1-2 改进：人工节点落库即返回，不阻塞 Worker 协程
func (e *FlowExecutor) executeHumanReview(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    // 1. 设置状态为等待人工（落库）
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusWaitingHuman)
    
    // 2. 发送通知
    e.eventBus.Publish(&Event{
        Type:      "node.waiting_human",
        FlowRunID: nodeRun.FlowRunID,
        NodeRunID: nodeRun.ID,
        Data: map[string]any{
            "review_target": nodeRun.Input,
            "actions":       node.Config.Actions,
            "timeout":       node.Config.Timeout,
        },
    })
    
    // 3. 直接返回 nil —— Worker 释放，不阻塞
    // 人工操作通过 API (SubmitReview) 触发后续流程
    return nil
}

// 当人工通过 API 提交 Review 时调用
func (e *FlowExecutor) HandleReviewSubmission(ctx context.Context, nodeRunID string, review *ReviewAction) error {
    nodeRun, _ := e.db.GetNodeRun(ctx, nodeRunID)
    node := e.getNodeFromDSL(ctx, nodeRun)
    
    // 记录 Review 信息
    e.db.UpdateNodeRunReview(ctx, nodeRunID, review)
    
    switch review.Action {
    case "approve":
        nodeRun.Output = nodeRun.Input
        e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, nodeRun.Output)
        e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusCompleted)
        return e.advanceDAG(ctx, nodeRun.FlowRunID)
        
    case "reject":
        return e.handleReject(ctx, nodeRun, node.OnReject, review)
        
    case "edit_and_approve":
        nodeRun.Output = review.EditedOutput
        e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, nodeRun.Output)
        e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusCompleted)
        return e.advanceDAG(ctx, nodeRun.FlowRunID)
    }
    
    return fmt.Errorf("unknown review action: %s", review.Action)
}
```

### 9.1.6 打回机制（作用域感知）

```go
// P0-2 改进：支持作用域定位
func (e *FlowExecutor) handleReject(ctx context.Context, nodeRun *NodeRun, onReject *OnRejectConfig, review *ReviewAction) error {
    // 1. 检查打回次数
    loopCount := e.db.GetLoopCount(ctx, nodeRun.ID, onReject.Goto.NodeID)
    if loopCount >= onReject.MaxLoops {
        return e.handleMaxLoops(ctx, nodeRun, onReject)
    }
    
    // 2. 标记当前节点为 REJECTED，归档到 history
    e.db.ArchiveAndResetNodeRun(ctx, nodeRun.ID, StatusRejected)
    
    // 3. 根据 scope 确定受影响的节点
    var affectedNodes []string
    switch onReject.Goto.Scope {
    case "current_iteration", "":
        affectedNodes = e.db.GetPathNodesInScope(ctx,
            nodeRun.FlowRunID, onReject.Goto.NodeID, nodeRun.NodeID,
            nodeRun.ScopeKey, nodeRun.IterationKey,
        )
    case "parent_scope":
        affectedNodes = e.db.GetPathNodesInScope(ctx,
            nodeRun.FlowRunID, onReject.Goto.NodeID, nodeRun.NodeID,
            parentScope(nodeRun.ScopeKey), "",
        )
    case "global":
        affectedNodes = e.db.GetGlobalPathNodes(ctx,
            nodeRun.FlowRunID, onReject.Goto.NodeID, nodeRun.NodeID,
        )
    }
    
    // 4. 归档并重置受影响的节点
    for _, nid := range affectedNodes {
        e.db.ArchiveAndResetNodeRun(ctx, nid, StatusRejected)
    }
    
    // 5. 为目标节点创建新的 QUEUED NodeRun（注入反馈）
    targetInput := e.injectFeedback(ctx, nodeRun, onReject.Inject, review)
    e.db.CreateNodeRun(ctx, &NodeRun{
        FlowRunID:    nodeRun.FlowRunID,
        NodeID:       onReject.Goto.NodeID,
        Status:       StatusQueued,
        ScopeKey:     e.resolveTargetScopeKey(nodeRun, onReject),
        IterationKey: e.resolveTargetIterationKey(nodeRun, onReject),
        Attempt:      loopCount + 2,
        Input:        targetInput,
    })
    
    return nil
}
```

### 9.1.7 parallel_group 执行（含 execution_mode）

```go
func (e *FlowExecutor) executeParallelGroup(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    // 1. 解析 foreach 列表
    items := e.resolveExpression(node.Config.Foreach, nodeRun.Input).([]any)
    mode := node.Config.ExecutionMode // parallel | pipeline | serial
    if mode == "" {
        mode = "pipeline" // 默认
    }
    
    // 2. 为每个迭代的每个 child 创建 NodeRun
    for i, item := range items {
        iterKey := deriveIterationKey(item, i)
        
        for j, child := range node.Children {
            status := StatusQueued
            
            switch mode {
            case "parallel":
                // 所有 children 全部 QUEUED（并发执行）
                status = StatusQueued
            case "pipeline":
                // 每个迭代内，只有第一个 child QUEUED，后续 PENDING
                if j == 0 {
                    status = StatusQueued
                } else {
                    status = StatusPending
                }
            case "serial":
                // 只有第一个迭代的第一个 child QUEUED
                if i == 0 && j == 0 {
                    status = StatusQueued
                } else {
                    status = StatusPending
                }
            }
            
            e.db.CreateNodeRun(ctx, &NodeRun{
                FlowRunID:    nodeRun.FlowRunID,
                NodeID:       child.ID,
                NodeName:     child.Name,
                NodeType:     child.Type,
                Status:       status,
                ScopeKey:     joinScope(nodeRun.ScopeKey, node.ID),
                IterationKey: iterKey,
                Attempt:      1,
                Input:        e.resolveChildInput(nodeRun, child, item),
            })
        }
    }
    
    // 3. parallel_group 本身标记为 RUNNING，等所有子节点完成后由 advanceDAG 标记 COMPLETED
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusRunning)
    return nil
}
```

## 9.2 协同节点实现（P0-3 新增）

### 9.2.1 collab_task 执行

```go
func (e *FlowExecutor) executeCollabTask(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    switch node.Config.CollabMode {
    case "parallel_draft", "":
        return e.executeParallelDraft(ctx, nodeRun, node)
    case "lead_review":
        return e.executeLeadReview(ctx, nodeRun, node)
    case "debate":
        return e.executeDebate(ctx, nodeRun, node)
    }
    return fmt.Errorf("unknown collab_mode: %s", node.Config.CollabMode)
}

func (e *FlowExecutor) executeParallelDraft(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    for _, agentCfg := range node.Config.Agents {
        e.db.CreateNodeRun(ctx, &NodeRun{
            FlowRunID:    nodeRun.FlowRunID,
            NodeID:       nodeRun.NodeID + "." + agentCfg.Role,
            NodeType:     "agent_task",
            Status:       StatusQueued,
            ScopeKey:     joinScope(nodeRun.ScopeKey, nodeRun.NodeID),
            IterationKey: agentCfg.Role,
            AgentRole:    agentCfg.Role,
            Input:        nodeRun.Input,
        })
    }
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusRunning)
    return nil
}

// 当所有子 Agent 完成后，由 advanceDAG 调用
func (e *FlowExecutor) finalizeCollabTask(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    childRuns, _ := e.db.GetChildNodeRuns(ctx, nodeRun.FlowRunID, nodeRun.NodeID)
    
    candidates := make([]map[string]any, 0, len(childRuns))
    for _, child := range childRuns {
        e.db.CreateAttribution(ctx, &NodeRunAttribution{
            NodeRunID:  nodeRun.ID,
            AgentRole:  child.AgentRole,
            AgentID:    child.AgentInstanceID,
            OutputHash: hashOutput(child.Output),
            Output:     child.Output,
            Metrics:    child.Metrics(),
        })
        candidates = append(candidates, map[string]any{
            "agent_role": child.AgentRole,
            "agent_id":   child.AgentInstanceID,
            "output":     child.Output,
            "metrics":    child.Metrics(),
        })
    }
    
    output := map[string]any{"candidates": candidates, "count": len(candidates)}
    e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, output)
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusCompleted)
    return nil
}
```

### 9.2.2 adjudicate 执行

```go
func (e *FlowExecutor) executeAdjudicate(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    candidates := nodeRun.Input["candidates"].([]any)
    
    switch node.Config.Policy {
    case "rubric_score", "":
        return e.adjudicateByRubric(ctx, nodeRun, node, candidates)
    case "majority_vote":
        return e.adjudicateByVote(ctx, nodeRun, node, candidates)
    case "reviewer_decides":
        e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusWaitingHuman)
        return nil
    }
    return fmt.Errorf("unknown adjudicate policy: %s", node.Config.Policy)
}

func (e *FlowExecutor) adjudicateByRubric(ctx context.Context, nodeRun *NodeRun, node *Node, candidates []any) error {
    rubric, _ := e.loadRubric(node.Config.Rubric.Ref)
    scorer, _ := e.registry.SelectAgent(ctx, &TaskRequest{
        FlowRunID: nodeRun.FlowRunID,
        AgentRole: node.Config.Rubric.ScorerRole,
        Mode:      "review",
    }, nil)
    
    scores := make([]ScoreEntry, 0, len(candidates))
    var bestIdx, bestScore int
    
    for i, candidate := range candidates {
        scoreReq := &TaskRequest{
            Prompt: fmt.Sprintf("请按以下 Rubric 评分：\n%s\n\n待评内容：\n%s",
                rubric.ToPrompt(), toJSON(candidate)),
        }
        result, _ := scorer.Execute(ctx, scoreReq)
        score := parseScore(result)
        
        scores = append(scores, ScoreEntry{
            AgentRole: candidate.(map[string]any)["agent_role"].(string),
            Score:     score.Total,
            Breakdown: score.Breakdown,
        })
        if score.Total > bestScore {
            bestScore = score.Total
            bestIdx = i
        }
    }
    
    if bestScore < node.Config.Rubric.MinScore {
        return e.adjudicateFallback(ctx, nodeRun, node, candidates, scores)
    }
    
    winner := candidates[bestIdx].(map[string]any)
    output := map[string]any{
        "selected":       winner["output"],
        "selected_score": bestScore,
        "selected_agent": winner["agent_role"],
        "all_scores":     scores,
        "all_candidates": candidates,
    }
    
    if artifactID, ok := nodeRun.Input["_artifact_id"]; ok {
        e.createArtifactVersion(ctx, artifactID.(string), winner["output"], bestScore, scores)
        output["_artifact_id"] = artifactID
    }
    
    e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, output)
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusCompleted)
    return nil
}
```

### 9.2.3 aggregate 执行

```go
func (e *FlowExecutor) executeAggregate(ctx context.Context, nodeRun *NodeRun, node *Node) error {
    input := nodeRun.Input
    
    switch node.Config.Strategy {
    case "concat":
        e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, concatArrays(input))
    case "merge_by_key":
        key := node.Config.MergeByKey.Key
        e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, mergeByKey(input, key, node.Config.MergeByKey.ConflictResolution))
    case "custom":
        agent, _ := e.registry.SelectAgent(ctx, &TaskRequest{
            FlowRunID: nodeRun.FlowRunID,
            AgentRole: node.Config.Custom.AgentRole,
            Mode:      "execute",
        }, nil)
        req := &TaskRequest{Prompt: e.renderPrompt(node.Config.Custom.PromptTemplate, input)}
        result, _ := agent.Execute(ctx, req)
        e.db.UpdateNodeRunOutput(ctx, nodeRun.ID, result)
    }
    
    e.db.UpdateNodeRunStatus(ctx, nodeRun.ID, StatusCompleted)
    return nil
}
```

## 9.3 Outbox Worker（P1-3 新增）

```go
// internal/engine/outbox.go
package engine

type OutboxWorker struct {
    db       *DB
    git      *GitClient
    webhook  *WebhookClient
}

func (w *OutboxWorker) Run(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
            event, err := w.db.AcquireNextOutboxEvent(ctx)
            if err != nil || event == nil {
                time.Sleep(1 * time.Second)
                continue
            }
            if err := w.processEvent(ctx, event); err != nil {
                w.handleError(ctx, event, err)
            }
        }
    }
}

func (w *OutboxWorker) processEvent(ctx context.Context, event *OutboxEvent) error {
    switch event.EventType {
    case "git_create_branch":
        return w.git.CreateBranch(ctx, event.Payload)
    case "git_commit":
        return w.git.Commit(ctx, event.Payload)
    case "git_create_pr":
        return w.git.CreatePR(ctx, event.Payload)
    case "webhook_call":
        return w.webhook.Call(ctx, event.Payload)
    }
    return fmt.Errorf("unknown outbox event type: %s", event.EventType)
}

func (w *OutboxWorker) handleError(ctx context.Context, event *OutboxEvent, err error) {
    event.Attempts++
    event.LastError = err.Error()
    if event.Attempts >= event.MaxAttempts {
        event.Status = "failed"
    } else {
        event.Status = "pending"
        event.LockedAt = nil
    }
    w.db.UpdateOutboxEvent(ctx, event)
}
```

## 9.4 DAG 推进逻辑

> 二次复审改进：依赖判定改为实例级（NodeRunIdentifier 粒度），组内推进独立处理。

### 9.4.0 NodeRunIdentifier

```go
// 实例级标识，用于依赖判定（而非纯 node_id）
type NodeRunIdentifier struct {
    NodeID       string
    ScopeKey     string
    IterationKey string
}

func (nr *NodeRun) Identifier() NodeRunIdentifier {
    return NodeRunIdentifier{
        NodeID:       nr.NodeID,
        ScopeKey:     nr.ScopeKey,
        IterationKey: nr.IterationKey,
    }
}
```

### 9.4.1 全局 DAG 推进

```go
func (e *FlowExecutor) advanceDAG(ctx context.Context, flowRunID string) error {
    flowRun, _ := e.db.GetFlowRun(ctx, flowRunID)
    dag := e.getDAG(ctx, flowRun)
    
    // 1. 构建实例级完成集合（按 NodeRunIdentifier 粒度）
    completedRuns, _ := e.db.GetCompletedNodeRuns(ctx, flowRunID)
    completedSet := make(map[NodeRunIdentifier]bool)
    for _, nr := range completedRuns {
        completedSet[nr.Identifier()] = true
    }
    
    // 2. 组内推进（pipeline/serial 模式下激活后继 child）
    runningGroups, _ := e.db.GetRunningParallelGroups(ctx, flowRunID)
    for _, group := range runningGroups {
        node := e.getNodeFromDSL(ctx, &group)
        e.advanceWithinGroup(ctx, &group, node, completedSet)
    }
    
    // 3. 全局推进：检查非组内的 PENDING 节点
    pendingNodes, _ := e.db.GetPendingNodeRunsOutsideGroups(ctx, flowRunID)
    for _, pending := range pendingNodes {
        deps := dag.GetDependencies(pending.NodeID)
        allDepsCompleted := true
        for _, depNodeID := range deps {
            // 查找同作用域下的依赖实例
            depID := NodeRunIdentifier{
                NodeID:       depNodeID,
                ScopeKey:     pending.ScopeKey,
                IterationKey: pending.IterationKey,
            }
            if !completedSet[depID] {
                allDepsCompleted = false
                break
            }
        }
        if allDepsCompleted {
            e.db.UpdateNodeRunStatus(ctx, pending.ID, StatusQueued)
        }
    }
    
    // 4. 检查组是否全部完成
    for _, group := range runningGroups {
        children, _ := e.db.GetChildNodeRuns(ctx, flowRunID, group.NodeID)
        allDone := true
        for _, child := range children {
            if child.Status != StatusCompleted {
                allDone = false
                break
            }
        }
        if allDone {
            node := e.getNodeFromDSL(ctx, &group)
            if node.Type == "collab_task" {
                e.finalizeCollabTask(ctx, &group, node)
            } else {
                e.db.UpdateNodeRunStatus(ctx, group.ID, StatusCompleted)
            }
        }
    }
    
    // 5. 检查流程是否全部完成
    allNodes, _ := e.db.GetAllNodeRuns(ctx, flowRunID)
    allCompleted := true
    for _, n := range allNodes {
        if n.Status != StatusCompleted && n.Status != StatusSkipped {
            allCompleted = false
            break
        }
    }
    if allCompleted {
        e.db.UpdateFlowRunStatus(ctx, flowRunID, StatusCompleted)
    }
    
    return nil
}
```

### 9.4.2 组内推进器

```go
// advanceWithinGroup 处理 parallel_group 内部的 pipeline/serial 推进
// 与全局 DAG 推进解耦，避免误触发
func (e *FlowExecutor) advanceWithinGroup(ctx context.Context, group *NodeRun, node *Node, completedSet map[NodeRunIdentifier]bool) {
    mode := node.Config.ExecutionMode
    if mode == "" {
        mode = "pipeline"
    }
    
    children, _ := e.db.GetChildNodeRuns(ctx, group.FlowRunID, group.NodeID)
    
    // 按 (iterationKey, childIndex) 分组
    type iterChild struct {
        iterKey    string
        childIndex int
        nodeRun    *NodeRun
    }
    iterMap := make(map[string][]iterChild) // iterKey -> sorted children
    for _, child := range children {
        idx := node.GetChildIndex(child.NodeID)
        iterMap[child.IterationKey] = append(iterMap[child.IterationKey], iterChild{
            iterKey: child.IterationKey, childIndex: idx, nodeRun: child,
        })
    }
    // 每个 iteration 内按 childIndex 排序
    for k := range iterMap {
        sort.Slice(iterMap[k], func(i, j int) bool {
            return iterMap[k][i].childIndex < iterMap[k][j].childIndex
        })
    }
    
    switch mode {
    case "pipeline":
        // 同 iteration 内：child[i] 完成 → 激活 child[i+1]
        for _, children := range iterMap {
            for i := 0; i < len(children)-1; i++ {
                cur := children[i]
                next := children[i+1]
                if cur.nodeRun.Status == StatusCompleted && next.nodeRun.Status == StatusPending {
                    e.db.UpdateNodeRunStatus(ctx, next.nodeRun.ID, StatusQueued)
                }
            }
        }
        
    case "serial":
        // 同 iteration 内：child[i] 完成 → 激活 child[i+1]（同 pipeline）
        // 跨 iteration：当前 iteration 全部完成 → 激活下一 iteration 的 child[0]
        iterKeys := sortedKeys(iterMap)
        for idx, iterKey := range iterKeys {
            children := iterMap[iterKey]
            
            // 组内串行推进
            for i := 0; i < len(children)-1; i++ {
                cur := children[i]
                next := children[i+1]
                if cur.nodeRun.Status == StatusCompleted && next.nodeRun.Status == StatusPending {
                    e.db.UpdateNodeRunStatus(ctx, next.nodeRun.ID, StatusQueued)
                }
            }
            
            // 跨迭代推进
            if idx < len(iterKeys)-1 {
                allDone := true
                for _, c := range children {
                    if c.nodeRun.Status != StatusCompleted {
                        allDone = false
                        break
                    }
                }
                if allDone {
                    nextIterChildren := iterMap[iterKeys[idx+1]]
                    if len(nextIterChildren) > 0 && nextIterChildren[0].nodeRun.Status == StatusPending {
                        e.db.UpdateNodeRunStatus(ctx, nextIterChildren[0].nodeRun.ID, StatusQueued)
                    }
                }
            }
        }
        
    case "parallel":
        // parallel 模式下所有 children 初始即为 QUEUED，无需组内推进
    }
}
```

### 9.4.3 Pipeline 推进时序示意（3 个迭代）

```
execution_mode: pipeline, children: [plan, review], foreach: [task-A, task-B, task-C]

时间 →
─────────────────────────────────────────────────────────────────
iter task-A:  [plan:QUEUED] → [plan:RUNNING] → [plan:COMPLETED]
                                                  ↓ advanceWithinGroup
              [review:PENDING] ─────────────── → [review:QUEUED] → [review:COMPLETED]
                                                                      ↓ advanceDAG: group 检查

iter task-B:  [plan:QUEUED] → [plan:RUNNING] → [plan:COMPLETED]
                                                  ↓ advanceWithinGroup
              [review:PENDING] ─────────────── → [review:QUEUED] → [review:COMPLETED]

iter task-C:  [plan:QUEUED] → [plan:RUNNING] → [plan:COMPLETED]
                                                  ↓ advanceWithinGroup
              [review:PENDING] ─────────────── → [review:QUEUED] → [review:COMPLETED]
                                                                      ↓ 全部完成
                                                              parallel_group → COMPLETED
─────────────────────────────────────────────────────────────────
注：3 个迭代的 plan 可并发执行，但每个迭代内 review 必须等 plan 完成。
    serial 模式下，task-B 的 plan 需等 task-A 的 review 完成后才 QUEUED。
```

## 9.5 WebSocket 网关（Node.js）

```typescript
// packages/api/src/ws/gateway.ts
import { WebSocketServer, WebSocket } from 'ws';

interface WSClient {
  ws: WebSocket;
  userId: string;
  subscriptions: Set<string>;
}

class WSGateway {
  private clients = new Map<string, WSClient>();
  
  handleConnection(ws: WebSocket, userId: string) {
    const client: WSClient = { ws, userId, subscriptions: new Set() };
    this.clients.set(userId, client);
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'subscribe') {
        client.subscriptions.add(msg.channel);
      } else if (msg.type === 'unsubscribe') {
        client.subscriptions.delete(msg.channel);
      }
    });
  }
  
  broadcast(channel: string, event: any) {
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel)) {
        client.ws.send(JSON.stringify(event));
      }
    }
  }
}
```

## 9.6 React 实时订阅 Hook

```typescript
// packages/web/src/hooks/useFlowSubscription.ts
import { useEffect } from 'react';
import { useWebSocket } from './useWebSocket';

export function useFlowSubscription(flowRunId: string, handlers: {
  onNodeStarted?: (data: any) => void;
  onNodeCompleted?: (data: any) => void;
  onNodeStream?: (data: any) => void;
  onFlowCompleted?: (data: any) => void;
  onArtifactCreated?: (data: any) => void;
  onCollabCompleted?: (data: any) => void;
}) {
  const { subscribe, unsubscribe } = useWebSocket();
  
  useEffect(() => {
    const channel = `flow-run:${flowRunId}`;
    subscribe(channel, (event) => {
      switch (event.type) {
        case 'node.started':
          handlers.onNodeStarted?.(event.data);
          break;
        case 'node.completed':
          handlers.onNodeCompleted?.(event.data);
          break;
        case 'node.output_stream':
          handlers.onNodeStream?.(event.data);
          break;
        case 'flow.completed':
          handlers.onFlowCompleted?.(event.data);
          break;
        case 'artifact.created':
        case 'artifact.versioned':
          handlers.onArtifactCreated?.(event.data);
          break;
        case 'collab.adjudicated':
          handlers.onCollabCompleted?.(event.data);
          break;
      }
    });
    
    return () => unsubscribe(channel);
  }, [flowRunId]);
}
```

## 9.7 执行器分层（R3 新增）

Type Adapter（语义层）与 Runtime Executor（通道层）分离，支持灵活组合：

```go
// internal/agent/executor.go

// CLIExecutor — 本地/容器内通过命令行调用 Agent
type CLIExecutor struct {
    command string
    workDir string
    env     map[string]string
}

func (e *CLIExecutor) Kind() string { return "cli" }

func (e *CLIExecutor) Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error) {
    cmd := exec.CommandContext(ctx, req.Command, req.Args...)
    cmd.Dir = e.workDir
    cmd.Stdin = strings.NewReader(req.Stdin)
    cmd.Env = mergeEnv(os.Environ(), req.Env)
    
    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr
    
    err := cmd.Run()
    return &ExecutorResponse{
        ExitCode: cmd.ProcessState.ExitCode(),
        Stdout:   stdout.String(),
        Stderr:   stderr.String(),
    }, err
}

// HTTPExecutor — 通过 HTTP API 调用远程 Agent
type HTTPExecutor struct {
    endpoint string
    client   *http.Client
    apiKey   string
}

func (e *HTTPExecutor) Kind() string { return "http" }

func (e *HTTPExecutor) Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error) {
    httpReq, _ := http.NewRequestWithContext(ctx, "POST", req.URL, bytes.NewReader(req.Body))
    httpReq.Header.Set("Authorization", "Bearer "+e.apiKey)
    httpReq.Header.Set("Content-Type", "application/json")
    
    resp, err := e.client.Do(httpReq)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    
    body, _ := io.ReadAll(resp.Body)
    return &ExecutorResponse{
        ExitCode: resp.StatusCode,
        Body:     body,
    }, nil
}
```

## 9.8 调度域隔离（R3 新增）

```go
// internal/agent/registry.go

// SelectAgent 对外统一入口，内部先做运行域过滤再委托 Scheduler
func (r *AgentRegistry) SelectAgent(ctx context.Context, req *TaskRequest, candidates []*AgentInstance) (*AgentInstance, error) {
    // 1. 获取流程的执行域
    flowRun, _ := r.db.GetFlowRun(ctx, req.FlowRunID)
    
    // 2. 如果未指定候选，从角色池获取
    if candidates == nil {
        candidates = r.instances[req.AgentRole]
    }
    
    // 3. 运行域过滤
    switch flowRun.ExecutionDomain {
    case "cloud":
        // 云端流程只能使用 remote/docker Agent
        candidates = filterByRuntime(candidates, []string{"remote", "docker"})
    case "local":
        // 本地流程可使用所有运行时（优先本地）
        sort.SliceStable(candidates, func(i, j int) bool {
            return candidates[i].Runtime == "local"
        })
    }
    
    if len(candidates) == 0 {
        return nil, fmt.Errorf("no available agent for role=%s in domain=%s", req.AgentRole, flowRun.ExecutionDomain)
    }
    
    // 4. 委托 Scheduler 做最终选择
    return r.scheduler.Select(ctx, req, candidates)
}

func filterByRuntime(candidates []*AgentInstance, allowed []string) []*AgentInstance {
    allowedSet := make(map[string]bool)
    for _, r := range allowed {
        allowedSet[r] = true
    }
    var filtered []*AgentInstance
    for _, c := range candidates {
        if allowedSet[c.Runtime] {
            filtered = append(filtered, c)
        }
    }
    return filtered
}
```

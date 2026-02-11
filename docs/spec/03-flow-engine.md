# 3. 流程编排引擎

## 3.1 流程DSL设计

流程以YAML为核心DSL，可视化编辑器作为展示层双向同步。

### 基础结构

```yaml
# workflow.yaml
name: "full-dev-pipeline"
version: "1.0"
description: "完整开发流水线：需求→拆解→Plan→执行→Review→测试→验收"

# 全局变量，流程实例共享
variables:
  project_id: ""
  requirement_text: ""
  git_repo: ""
  git_base_branch: "main"

# 触发器
triggers:
  - type: manual          # 手动触发
  - type: board_event     # 看板事件触发
    event: task_started
  - type: webhook         # 外部Webhook触发
    path: /api/trigger/full-dev

# 节点定义
nodes:
  # ─── 阶段1：需求提交 ───
  - id: submit_requirement
    name: "提交需求"
    type: human_input
    config:
      form:
        - field: requirement_text
          type: textarea
          label: "需求描述"
          required: true
        - field: priority
          type: select
          options: [P0, P1, P2, P3]
        - field: attachments
          type: file_upload
    outputs:
      requirement_text: "{{form.requirement_text}}"
      priority: "{{form.priority}}"

  # ─── 阶段2：需求分析与分发 ───
  - id: analyze_requirement
    name: "Agent分析需求"
    type: agent_task
    agent:
      role: "requirement-analyst"
      model: "claude-sonnet"
    config:
      prompt_template: |
        你是一个需求分析师。请分析以下需求，理解项目上下文，
        并将需求拆分为可独立执行的子任务。
        
        项目仓库：{{variables.git_repo}}
        需求描述：{{nodes.submit_requirement.outputs.requirement_text}}
        
        请输出：
        1. 需求理解摘要
        2. 涉及的模块/文件
        3. 建议拆分的子任务列表（含优先级和依赖关系）
      output_schema:
        type: object
        properties:
          summary: { type: string }
          modules: { type: array, items: { type: string } }
          sub_tasks:
            type: array
            items:
              type: object
              properties:
                title: { type: string }
                description: { type: string }
                priority: { type: string }
                depends_on: { type: array }
                suggested_agent_role: { type: string }
    timeout: 300s
    retry:
      max_attempts: 2
      backoff: exponential

  # ─── 阶段3：人工确认拆解结果 ───
  - id: confirm_tasks
    name: "确认任务拆解"
    type: human_review
    config:
      review_target: "{{nodes.analyze_requirement.outputs}}"
      actions:
        - approve          # 通过，继续
        - reject           # 打回，重新分析
        - edit_and_approve # 人工编辑后通过
      timeout: 24h
    on_reject:
      goto: analyze_requirement
      inject:
        feedback: "{{review.comment}}"

  # ─── 阶段4：并行Plan/Spec ───
  - id: parallel_planning
    name: "并行制定Plan"
    type: parallel_group
    config:
      # 动态并行：根据上游拆解的子任务数量动态创建并行分支
      foreach: "{{nodes.confirm_tasks.outputs.sub_tasks}}"
      as: "task"
      max_concurrency: 5
      # children 执行模式（P0-1 改进）
      execution_mode: pipeline  # parallel | pipeline | serial
      # parallel: children 全部并发（children 之间无依赖时使用）
      # pipeline: children 按定义顺序串行，foreach 不同迭代之间并发（默认）
      # serial:   children 串行，foreach 不同迭代也串行
    children:
      - id: create_plan
        name: "制定Plan/Spec"
        type: agent_task
        agent:
          role: "{{task.suggested_agent_role}}"
          fallback_role: "general-developer"
        config:
          prompt_template: |
            请为以下任务制定详细的实施计划（Spec）：
            任务：{{task.title}}
            描述：{{task.description}}
            项目上下文：{{variables.git_repo}}
            
            输出：
            1. 实施方案
            2. 涉及文件变更列表
            3. 风险评估
            4. 预估工作量
          mode: spec  # Spec模式：只输出计划，不执行

      - id: review_plan
        name: "Review Plan"
        type: human_review  # 或 agent_task（Agent Review）
        config:
          reviewer: auto  # auto=根据配置自动选择人工或Agent
          review_target: "{{nodes.create_plan.outputs}}"
          actions: [approve, reject, edit_and_approve]
        on_reject:
          goto: create_plan
          max_loops: 3  # 最多打回3次

  # ─── 阶段5：并行执行 ───
  - id: parallel_execution
    name: "并行执行任务"
    type: parallel_group
    config:
      foreach: "{{nodes.parallel_planning.outputs.approved_tasks}}"
      as: "task"
      max_concurrency: 3
      # 尊重任务依赖关系
      respect_dependencies: true
    children:
      - id: execute_task
        name: "执行任务"
        type: agent_task
        agent:
          role: "{{task.suggested_agent_role}}"
        config:
          prompt_template: |
            请按照以下Spec执行任务：
            {{task.approved_spec}}
          mode: execute
          git:
            create_branch: true
            branch_pattern: "feat/task-{{task.id}}-{{task.slug}}"
            auto_commit: true

  # ─── 阶段6：Code Review ───
  - id: code_review
    name: "Code Review"
    type: parallel_group
    config:
      foreach: "{{nodes.parallel_execution.outputs.completed_tasks}}"
      as: "task"
    children:
      - id: agent_review
        name: "Agent Review"
        type: agent_task
        agent:
          role: "code-reviewer"
        config:
          prompt_template: |
            请Review以下代码变更：
            Branch: {{task.branch}}
            变更文件：{{task.changed_files}}
            原始Spec：{{task.spec}}
          output_schema:
            type: object
            properties:
              passed: { type: boolean }
              issues: { type: array }
              report: { type: string }

      - id: human_review_code
        name: "人工Review"
        type: human_review
        config:
          review_target: "{{nodes.agent_review.outputs}}"
          show_diff: true
          actions: [approve, reject, request_changes]
        on_reject:
          goto:
            node_id: execute_task
            scope: current_iteration
          inject:
            review_feedback: "{{review.comment}}"
            review_issues: "{{nodes.agent_review.outputs.issues}}"

  # ─── 阶段7：测试验收 ───
  - id: testing
    name: "测试验收"
    type: agent_task
    agent:
      role: "qa-engineer"
    config:
      prompt_template: |
        请对以下变更进行测试验收：
        {{nodes.code_review.outputs.approved_changes}}
      mode: execute
      git:
        run_tests: true
    on_failure:
      goto:
        node_id: execute_task
        scope: current_iteration
      inject:
        test_report: "{{outputs.test_report}}"

  # ─── 阶段8：最终确认 ───
  - id: final_confirmation
    name: "最终确认"
    type: human_review
    config:
      review_target:
        code_review: "{{nodes.code_review.outputs}}"
        test_report: "{{nodes.testing.outputs}}"
      actions: [approve, reject]
    on_approve:
      next: trigger_ci
    on_reject:
      goto: code_review

  # ─── 阶段9：触发CI ───
  - id: trigger_ci
    name: "触发CI流程"
    type: integration
    config:
      type: github_actions
      action: create_pr
      params:
        base: "{{variables.git_base_branch}}"
        head: "{{collected_branches}}"
        title: "{{variables.requirement_text | truncate(80)}}"
        auto_merge: false

# 边（连接关系）
edges:
  - from: submit_requirement
    to: analyze_requirement
  - from: analyze_requirement
    to: confirm_tasks
  - from: confirm_tasks
    to: parallel_planning
  - from: parallel_planning
    to: parallel_execution
  - from: parallel_execution
    to: code_review
  - from: code_review
    to: testing
  - from: testing
    to: final_confirmation
  - from: final_confirmation
    to: trigger_ci
```

## 3.2 节点类型体系

```
NodeType
├── agent_task          # Agent执行节点
│   ├── mode: spec      # 只输出计划
│   ├── mode: execute   # 执行代码变更
│   └── mode: review    # Review模式
├── human_input         # 人工输入节点（表单）
├── human_review        # 人工审核节点（approve/reject/edit）
├── parallel_group      # 并行组（静态或动态foreach）
│   ├── execution_mode: parallel   # children 全部并发
│   ├── execution_mode: pipeline   # children 按序串行，迭代间并发（默认）
│   └── execution_mode: serial     # 全部串行
├── collab_task         # 多Agent协同任务（新增）
│   ├── collab_mode: parallel_draft  # 多Agent独立产出，后续仲裁（默认）
│   ├── collab_mode: lead_review     # 主Agent产出，其他Agent审稿改进
│   └── collab_mode: debate          # Agent之间互评辩论
├── aggregate           # 聚合节点：收敛多个输出（新增）
│   ├── strategy: concat             # 简单拼接
│   ├── strategy: merge_by_key       # 按key去重合并
│   └── strategy: custom             # 自定义合并Agent
├── adjudicate          # 仲裁节点：按策略选择/合并（新增）
│   ├── policy: rubric_score         # Rubric评分选择（默认）
│   ├── policy: majority_vote        # 多数投票
│   ├── policy: weighted_vote        # 加权投票
│   └── policy: reviewer_decides     # 降级到人工裁决
├── conditional         # 条件分支
│   ├── if/else
│   └── switch/case
├── loop                # 循环节点（打回重试）
├── integration         # 外部集成
│   ├── github_actions
│   ├── gitlab_ci
│   ├── webhook
│   └── notification
├── transform           # 数据转换节点
│   ├── merge           # 合并多个输入
│   ├── filter          # 过滤
│   └── map             # 映射转换
└── sub_workflow        # 子流程引用
```

## 3.3 状态机

每个流程实例（FlowRun）和节点实例（NodeRun）都有独立的状态机：

```
FlowRun 状态:
  PENDING → RUNNING → COMPLETED
                   → FAILED
                   → CANCELLED
                   → PAUSED (等待人工)

NodeRun 状态:
  PENDING → QUEUED → RUNNING → COMPLETED
                            → FAILED
                            → REJECTED (被打回)
                            → WAITING_HUMAN (等待人工)
                            → SKIPPED (条件跳过)
```

## 3.4 打回机制

打回是流程引擎的核心能力之一：

```yaml
# 打回配置
on_reject:
  # 目标节点（增强为对象，支持作用域定位）
  goto:
    node_id: <node_id>
    # 作用域定位（P0-2 改进）
    scope: current_iteration   # current_iteration | parent_scope | global
    # current_iteration: 回到同一 foreach 迭代内的目标节点（默认）
    # parent_scope:      回到父级 parallel_group 外的节点
    # global:            回到全局节点（跳出所有 parallel_group）
  
  # 注入上下文：将Review反馈传递给目标节点
  inject:
    feedback: "{{review.comment}}"
    previous_output: "{{current_node.input}}"
  
  # 最大打回次数（防止死循环）
  max_loops: 3
  
  # 超过最大次数后的行为
  on_max_loops:
    action: escalate_to_human  # 或 fail / skip
    notify: ["project_owner"]
```

> **向后兼容与默认推导规则**：
> 
> `goto` 也可以是简单字符串（如 `goto: "node_id"`），引擎会根据上下文自动推导 `scope`：
> 
> | 上下文 | 字符串 goto | 等价对象形式 |
> |--------|------------|-------------|
> | foreach 内部节点 | `goto: "target"` | `{node_id: "target", scope: current_iteration}` |
> | foreach 外部节点 | `goto: "target"` | `{node_id: "target", scope: global}` |
> | 嵌套 foreach 内部 | `goto: "target"` | `{node_id: "target", scope: current_iteration}` |
> 
> **强约束**：跨作用域回退（目标节点不在当前 scope）必须使用对象形式显式指定 `scope`，否则校验失败。

### 3.4.1 回退示例

**示例 1：foreach 内部回退（同一迭代）**

```yaml
- id: parallel_planning
  type: parallel_group
  config:
    foreach: "{{nodes.confirm_tasks.outputs.sub_tasks}}"
    execution_mode: pipeline
  children:
    - id: create_plan
      type: agent_task
      # ...
    - id: review_plan
      type: human_review
      on_reject:
        goto: create_plan  # 字符串形式，自动推导为 current_iteration
        # 等价于 goto: {node_id: create_plan, scope: current_iteration}
```

**示例 2：从全局节点回退到 foreach 外节点**

```yaml
- id: decompose_tasks
  type: agent_task
  # ...

- id: parallel_planning
  type: parallel_group
  config:
    foreach: "{{nodes.decompose_tasks.outputs.sub_tasks}}"
  children:
    - id: create_plan
      # ...

- id: final_review
  type: human_review
  on_reject:
    goto: decompose_tasks  # 字符串形式，自动推导为 global
    # 等价于 goto: {node_id: decompose_tasks, scope: global}
```

**示例 3：从 foreach 内回退到父作用域节点（显式指定）**

```yaml
- id: outer_group
  type: parallel_group
  config:
    foreach: "{{features}}"
  children:
    - id: design_feature
      type: agent_task
      # ...
    - id: inner_group
      type: parallel_group
      config:
        foreach: "{{nodes.design_feature.outputs.components}}"
      children:
        - id: implement_component
          type: agent_task
          # ...
        - id: test_component
          type: agent_task
          on_failure:
            # 跨作用域回退，必须显式指定 scope
            goto:
              node_id: design_feature
              scope: parent_scope
```

### 3.4.1 Scope 模型

每个 NodeRun 实例携带完整的作用域标识：

```
NodeRunIdentifier:
  node_id        # DSL 中的 node id
  scope_key      # 所属 parallel_group 的 node_id（嵌套时用 . 分隔）
  iteration_key  # 迭代标识（从 foreach item 派生，如 task.id）
  attempt        # 第几次执行（打回后递增）

示例：parallel_planning 下第 3 个 task 的 create_plan 第 2 次执行
  node_id:       "create_plan"
  scope_key:     "parallel_planning"
  iteration_key: "task-003"
  attempt:       2
```

打回时引擎行为：
1. 当前节点标记为 REJECTED，归档到 node_run_history
2. 根据 `scope` 确定受影响的节点范围：
   - `current_iteration`：只重置同一迭代内，从目标节点到当前节点的路径
   - `parent_scope`：重置父级作用域中的目标节点及后续
   - `global`：重置全局路径上的所有节点
3. 注入反馈上下文到目标节点的输入
4. 从目标节点重新开始执行（继承 FlowRun 根 ctx，严禁 context.Background()）
5. 保留所有历史执行记录（可追溯）

## 3.5 变量与表达式系统

```
表达式语法: {{expression}}

支持的引用:
  {{variables.xxx}}                    # 全局变量
  {{nodes.<node_id>.outputs.xxx}}      # 节点输出
  {{nodes.<node_id>.status}}           # 节点状态
  {{trigger.xxx}}                      # 触发器参数
  {{env.xxx}}                          # 环境变量
  {{review.comment}}                   # Review评论
  {{review.action}}                    # Review动作
  {{task.xxx}}                         # foreach循环变量

内置函数:
  {{value | truncate(n)}}              # 截断
  {{value | default("fallback")}}      # 默认值
  {{array | length}}                   # 数组长度
  {{value | json}}                     # JSON序列化
  {{timestamp | format("YYYY-MM-DD")}} # 时间格式化
```

## 3.6 多 Agent 协同节点（P0-3 新增）

### 3.6.1 collab_task（协同任务）

同一输入分发给多个 Agent，各自独立或协作产出。

```yaml
- id: draft_prd
  name: "协同起草PRD"
  type: collab_task
  config:
    # 参与的 Agent 角色列表
    agents:
      - role: requirement-analyst
        weight: 1.0           # 仲裁时的权重
      - role: product-designer
        weight: 0.8
      - role: tech-lead
        weight: 0.6
    
    # 协同模式
    collab_mode: parallel_draft  # parallel_draft | lead_review | debate
    # parallel_draft: 多 Agent 独立产出，后续仲裁（默认）
    # lead_review:    主 Agent 产出，其他 Agent 审稿改进
    # debate:         Agent 之间互评辩论
    
    # 共享上下文策略
    shared_context:
      readable: ["requirement", "project_context"]  # 所有 Agent 可读
      writable: []                                   # 各自独立写，不共享中间结果
    
    prompt_template: |
      请基于以下需求起草PRD：
      {{nodes.normalize_requirement.outputs}}
    
    output_schema_ref: "schemas/prd.v1.json"
    
    # 产物配置（自动创建 Artifact）
    artifact:
      type: prd
      title: "{{variables.requirement_text | truncate(100)}} - PRD"
      derived_from: "{{nodes.collect_requirement.outputs._artifact_id}}"
    
    # lead_review 模式专用配置
    lead_review:
      lead_role: requirement-analyst
      max_review_rounds: 2
    
    # debate 模式专用配置
    debate:
      max_rounds: 3
      judge_role: tech-lead
```

输出格式：

```json
{
  "candidates": [
    {
      "agent_role": "requirement-analyst",
      "agent_id": "agent-001",
      "weight": 1.0,
      "output": { ... },
      "metrics": { "token_input": 1200, "token_output": 3500, "duration_ms": 45000 }
    },
    { ... }
  ],
  "count": 3
}
```

### 3.6.2 adjudicate（仲裁节点）

从多个候选输出中按策略选择最佳版本。

```yaml
- id: adjudicate_prd
  name: "仲裁PRD"
  type: adjudicate
  config:
    # 输入：上游 collab_task 的多个输出
    input: "{{nodes.draft_prd.outputs.candidates}}"
    
    # 仲裁策略
    policy: rubric_score    # rubric_score | majority_vote | weighted_vote | reviewer_decides
    
    # rubric_score 配置
    rubric:
      ref: "rubrics/prd-quality.v1.yaml"  # Rubric 定义文件
      min_score: 80                        # 最低通过分
      scorer_role: quality-assessor        # 评分 Agent 角色
    
    # majority_vote 配置
    vote:
      min_agreement: 0.6    # 最低一致率
    
    # 仲裁失败时的降级策略（按顺序尝试）
    fallback:
      - policy: reviewer_decides     # 降级到人工裁决
        timeout: 4h
      - policy: highest_weight       # 再降级到最高权重 Agent 的输出
```

输出格式：

```json
{
  "selected": { ... },
  "selected_score": 87,
  "selected_agent": "requirement-analyst",
  "all_scores": [ { "agent_role": "...", "score": 87, "breakdown": { ... } } ],
  "report": "仲裁报告：requirement-analyst 的版本以 87 分胜出...",
  "all_candidates": [ ... ],
  "_artifact_id": "uuid",
  "_artifact_version": 1
}
```

### 3.6.3 aggregate（聚合节点）

收敛多个输出为一个统一结果。

```yaml
- id: merge_stories
  name: "合并User Stories"
  type: aggregate
  config:
    input: "{{nodes.decompose_stories.outputs}}"
    
    strategy: merge_by_key   # concat | merge_by_key | custom
    # concat:       简单拼接数组
    # merge_by_key: 按指定 key 去重合并
    # custom:       自定义合并 Agent
    
    merge_by_key:
      key: "story_id"
      conflict_resolution: latest  # latest | highest_priority | manual
    
    custom:
      agent_role: story-merger
      prompt_template: |
        请合并以下 User Stories，去除重复，解决冲突：
        {{input}}
```

### 3.6.4 Rubric 定义

Rubric 是结构化的质量评估标准，供 adjudicate 节点使用：

```yaml
# rubrics/prd-quality.v1.yaml
name: "PRD质量评估标准"
version: "1.0"
dimensions:
  - name: completeness
    weight: 0.25
    criteria:
      - "包含背景和目标"
      - "包含功能范围和非目标"
      - "包含验收标准"
      - "包含风险评估"
    scoring: [0, 25, 50, 75, 100]
    
  - name: clarity
    weight: 0.25
    criteria:
      - "需求描述无歧义"
      - "术语定义清晰"
      - "用例场景具体"
    scoring: [0, 33, 66, 100]
    
  - name: feasibility
    weight: 0.25
    criteria:
      - "技术方案可行"
      - "工作量评估合理"
      - "依赖关系明确"
    scoring: [0, 33, 66, 100]
    
  - name: testability
    weight: 0.25
    criteria:
      - "验收标准可量化"
      - "测试场景可枚举"
    scoring: [0, 50, 100]

pass_threshold: 80
```

## 3.7 DSL 校验规则

流程 DSL 在保存和执行前必须通过以下校验：

```
通用规则：
  ✓ 所有 node.id 全局唯一
  ✓ edges 中引用的 node_id 必须存在
  ✓ DAG 无环检测（on_reject 的 goto 除外，通过 max_loops 防止死循环）
  ✓ 所有表达式引用的节点/变量在上游可达
  ✓ output_schema_ref 引用的 schema 文件存在

parallel_group 规则：
  ✓ execution_mode: parallel 时，children 之间不得引用兄弟节点输出
  ✓ execution_mode: pipeline 时，children 只能引用前序兄弟节点输出
  ✓ children 中 on_reject.goto 指向兄弟节点时，必须是 pipeline 模式
  ✓ foreach 表达式必须解析为数组类型
  ✓ max_concurrency >= 1

collab_task 规则：
  ✓ agents 列表至少 2 个角色
  ✓ lead_review 模式必须指定 lead_role
  ✓ debate 模式必须指定 judge_role
  ✓ weight 值在 0.0 ~ 1.0 之间

adjudicate 规则：
  ✓ input 必须引用 collab_task 或 parallel_group 的输出
  ✓ rubric_score 策略必须指定 rubric.ref 和 scorer_role
  ✓ fallback 策略列表不为空
  ✓ min_score 在 0 ~ 100 之间

on_reject 规则：
  ✓ goto.node_id 必须是当前节点的上游可达节点
  ✓ 字符串 goto 在 foreach 内自动推导 scope 为 current_iteration
  ✓ 字符串 goto 在 foreach 外自动推导 scope 为 global
  ✓ 显式指定 current_iteration 在 foreach 外为校验错误
  ✓ 跨作用域回退（目标节点不在当前 scope）必须使用对象形式显式指定 scope
  ✓ max_loops >= 1
  ✓ on_max_loops.action 必须是 escalate_to_human / fail / skip 之一
```

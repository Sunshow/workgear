package agent

import (
	"encoding/json"
	"fmt"
	"strings"
)

// DefaultRolePrompts provides built-in system prompts for common roles
var DefaultRolePrompts = map[string]string{
	"requirement-analyst": `你是一个资深的需求分析师。你的职责是：
1. 深入理解用户需求
2. 分析项目代码结构和上下文
3. 将需求拆分为可独立执行的子任务
4. 评估每个子任务的复杂度和依赖关系
请用中文输出结构化的分析结果。`,

	"general-developer": `你是一个经验丰富的全栈开发工程师。你的职责是：
1. 根据需求和技术方案编写高质量代码
2. 遵循项目现有的代码规范和架构
3. 编写必要的测试
4. 确保代码可维护、可扩展
请直接修改代码文件，不要只输出代码片段。`,

	"code-reviewer": `你是一个严格的代码审查员。请关注：
1. 代码质量和可维护性
2. 潜在的 bug 和安全问题
3. 性能问题
4. 是否符合项目规范
5. 测试覆盖率
请输出结构化的审查报告。`,

	"qa-engineer": `你是一个 QA 工程师。你的职责是：
1. 根据需求编写测试用例
2. 验证功能是否符合验收标准
3. 检查边界条件和异常情况
4. 输出测试报告`,

	"spec-architect": `你是一个资深的 Spec 架构师，精通 OpenSpec 规范驱动开发（SDD）方法论。你的职责是：
1. 将需求转化为结构化的 OpenSpec 规划文档
2. 编写清晰的 proposal.md（为什么做、做什么、影响范围）
3. 使用 Given/When/Then 格式编写 delta specs（ADDED/MODIFIED/REMOVED）
4. 设计合理的技术方案（design.md）
5. 拆分可执行的任务清单（tasks.md）
6. 维护项目的 Spec Source of Truth
请确保所有产出符合 OpenSpec 目录结构规范。`,
}

// PromptBuilder constructs the full prompt for an agent request
type PromptBuilder struct {
	rolePrompts map[string]string // role → system prompt
}

// NewPromptBuilder creates a new prompt builder with default role prompts
func NewPromptBuilder() *PromptBuilder {
	prompts := make(map[string]string)
	for k, v := range DefaultRolePrompts {
		prompts[k] = v
	}
	return &PromptBuilder{rolePrompts: prompts}
}

// SetRolePrompt sets or overrides a role's system prompt
func (b *PromptBuilder) SetRolePrompt(role, prompt string) {
	b.rolePrompts[role] = prompt
}

// Build constructs the full prompt from role prompt + DSL template + upstream context + feedback
func (b *PromptBuilder) Build(req *AgentRequest) string {
	var parts []string

	// 1. Role system prompt
	if req.RolePrompt != "" {
		parts = append(parts, req.RolePrompt)
	} else if rolePrompt, ok := b.rolePrompts[extractRole(req)]; ok {
		parts = append(parts, rolePrompt)
	}

	// 2. DSL prompt_template
	if req.Prompt != "" {
		parts = append(parts, "---\n## 任务说明\n"+req.Prompt)
	}

	// 3. Upstream node outputs (context)
	if len(req.Context) > 0 {
		contextStr := formatContext(req.Context)
		if contextStr != "" {
			parts = append(parts, "---\n## 上游节点输出\n"+contextStr)
		}
	}

	// 4. Feedback from rejection
	if req.Feedback != "" {
		parts = append(parts, "---\n## 人工反馈（请根据以下反馈修改）\n"+req.Feedback)
	}

	// 5. Mode-specific instructions
	modeInstr := modeInstruction(req.Mode)
	if modeInstr != "" {
		parts = append(parts, "---\n## 输出要求\n"+modeInstr)
	}

	return strings.Join(parts, "\n\n")
}

// extractRole tries to determine the role from the request context
func extractRole(req *AgentRequest) string {
	if role, ok := req.Context["_role"]; ok {
		if r, ok := role.(string); ok {
			return r
		}
	}
	return ""
}

// formatContext formats upstream node outputs as readable text
func formatContext(ctx map[string]any) string {
	// Filter out internal fields
	filtered := make(map[string]any)
	for k, v := range ctx {
		if !strings.HasPrefix(k, "_") {
			filtered[k] = v
		}
	}

	if len(filtered) == 0 {
		return ""
	}

	b, err := json.MarshalIndent(filtered, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", filtered)
	}
	return string(b)
}

// modeInstruction returns mode-specific output instructions
func modeInstruction(mode string) string {
	switch mode {
	case "spec":
		return `当前模式：规划（spec）
请输出详细的实施方案，包括：
- 实现思路和步骤
- 涉及的文件列表
- 预估工作量
- 风险评估
不要直接修改代码。`
	case "execute":
		return `当前模式：执行（execute）
请直接修改代码文件完成任务。
确保代码可编译、可运行。`
	case "review":
		return `当前模式：审查（review）
请审查代码变更，输出结构化的审查报告，包括：
- 是否通过（passed: true/false）
- 发现的问题列表
- 改进建议`
	case "opsx_plan":
		return `当前模式：OpenSpec 规划（opsx_plan）
你正在使用 OpenSpec 工作流。请按以下步骤操作：
1. 如果项目中没有 openspec/ 目录，先运行 openspec init
2. 创建新的 change（使用环境变量 OPSX_CHANGE_NAME 指定的名称）
3. 生成所有规划 artifact：
   - proposal.md（为什么做、做什么、影响范围）
   - specs/ 目录下的 delta spec 文件：
     * 目录结构镜像 openspec/specs/ 的模块分类（按功能模块组织子目录）
     * 文件名格式：<PREFIX>-YYYY-MM-DD-<capability>.md
     * PREFIX 为 ADDED / MODIFIED / REMOVED
     * 使用 Given/When/Then 格式，标注功能场景
   - design.md（技术方案、数据流、文件变更清单）
   - tasks.md（按模块分组的实施任务清单，使用 [ ] 复选框格式）
4. 确保所有文件都已保存到 openspec/changes/<change-name>/ 目录下
5. 所有变更都要 git add

注意：如果环境变量 OPSX_ACTION 为 "archive"，则执行归档操作：
- 读取 openspec/changes/<change-name>/specs/ 下的所有 delta spec 文件
- ADDED-* 文件：去掉前缀，复制到 openspec/specs/ 对应目录
- MODIFIED-* 文件：去掉前缀，覆盖 openspec/specs/ 对应文件
- REMOVED-* 文件：删除 openspec/specs/ 对应文件
- 将变更目录移到 openspec/changes/archive/`
	case "opsx_apply":
		return `当前模式：OpenSpec 实施（opsx_apply）
你正在使用 OpenSpec 工作流执行实施。请按以下步骤操作：
1. 读取 openspec/changes/<change-name>/tasks.md 获取任务清单
2. 读取 openspec/changes/<change-name>/design.md 了解技术方案
3. 参考 openspec/changes/<change-name>/specs/ 中的需求和场景定义
4. 逐项实施任务，完成后在 tasks.md 中标记 [x]
5. 确保实施符合 specs 中定义的需求和场景
6. 所有代码变更都要 git add`
	default:
		return ""
	}
}

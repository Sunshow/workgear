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
	default:
		return ""
	}
}

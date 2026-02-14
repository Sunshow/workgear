package engine

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// ─── DSL Data Structures ───

// WorkflowDSL represents the parsed YAML workflow definition
type WorkflowDSL struct {
	Name        string            `yaml:"name"`
	Version     string            `yaml:"version"`
	Description string            `yaml:"description"`
	Variables   map[string]string `yaml:"variables"`
	Nodes       []NodeDef         `yaml:"nodes"`
	Edges       []EdgeDef         `yaml:"edges"`
}

// NodeDef represents a node definition in the DSL
type NodeDef struct {
	ID       string          `yaml:"id"`
	Name     string          `yaml:"name"`
	Type     string          `yaml:"type"` // agent_task / human_review / human_input
	Agent    *AgentDef       `yaml:"agent"`
	Config   *NodeConfigDef  `yaml:"config"`
	OnReject *OnRejectDef    `yaml:"on_reject"`
	Timeout  string          `yaml:"timeout"`
	Retry    *RetryDef       `yaml:"retry"`
}

// AgentDef defines which agent to use
type AgentDef struct {
	Role         string `yaml:"role"`
	FallbackRole string `yaml:"fallback_role"`
	Model        string `yaml:"model"`
}

// NodeConfigDef holds node-specific configuration
type NodeConfigDef struct {
	Mode           string            `yaml:"mode"` // spec / execute / review / opsx_plan / opsx_apply
	PromptTemplate string            `yaml:"prompt_template"`
	ReviewTarget   string            `yaml:"review_target"`
	Actions        []string          `yaml:"actions"`
	Form           []FormFieldDef    `yaml:"form"`
	Timeout        string            `yaml:"timeout"`
	Opsx           *OpsxConfigDef    `yaml:"opsx"`
	Artifact       *ArtifactConfigDef `yaml:"artifact"`
	ShowArtifacts  bool              `yaml:"show_artifacts"`
	ArtifactPaths  []string          `yaml:"artifact_paths"`
}

// ArtifactConfigDef defines artifact creation for a node
type ArtifactConfigDef struct {
	Type        string `yaml:"type"`         // prd / spec / plan / code / review_report / etc.
	Title       string `yaml:"title"`        // Template expression for artifact title
	DerivedFrom string `yaml:"derived_from"` // Template expression for parent artifact ID
}

// OpsxConfigDef holds OpenSpec configuration in DSL
type OpsxConfigDef struct {
	ChangeName    string `yaml:"change_name"`
	Schema        string `yaml:"schema"`
	InitIfMissing bool   `yaml:"init_if_missing"`
	Action        string `yaml:"action"` // "", "archive", "sync"
}

// FormFieldDef defines a form field for human_input nodes
type FormFieldDef struct {
	Field    string   `yaml:"field"`
	Type     string   `yaml:"type"`
	Label    string   `yaml:"label"`
	Required bool     `yaml:"required"`
	Options  []string `yaml:"options"`
}

// OnRejectDef defines reject behavior
type OnRejectDef struct {
	Goto     string                 `yaml:"goto"`
	MaxLoops interface{}            `yaml:"max_loops"` // can be int or string template
	Inject   map[string]string      `yaml:"inject"`
}

// GetMaxLoops returns max_loops as int, defaulting to 3 if not parseable
func (o *OnRejectDef) GetMaxLoops() int {
	if o.MaxLoops == nil {
		return 3
	}
	switch v := o.MaxLoops.(type) {
	case int:
		return v
	case float64: // YAML numbers are float64
		return int(v)
	default:
		// Template variable or unparseable, use default
		return 3
	}
}

// RetryDef defines retry behavior
type RetryDef struct {
	MaxAttempts interface{} `yaml:"max_attempts"` // can be int or string template
	Backoff     string      `yaml:"backoff"`
}

// GetMaxAttempts returns max_attempts as int, defaulting to 3 if not parseable
func (r *RetryDef) GetMaxAttempts() int {
	if r.MaxAttempts == nil {
		return 3
	}
	switch v := r.MaxAttempts.(type) {
	case int:
		return v
	case float64:
		return int(v)
	default:
		return 3
	}
}

// EdgeDef represents a connection between nodes
type EdgeDef struct {
	From string `yaml:"from"`
	To   string `yaml:"to"`
}

// ─── DAG Structure ───

// DAG represents the directed acyclic graph of a workflow
type DAG struct {
	Nodes      map[string]*NodeDef   // nodeID → NodeDef
	NodeOrder  []string              // ordered node IDs
	Edges      []EdgeDef
	Deps       map[string][]string   // nodeID → upstream dependencies
	Successors map[string][]string   // nodeID → downstream nodes
}

// ParseDSL parses a YAML DSL string into a DAG
func ParseDSL(dslYAML string) (*WorkflowDSL, *DAG, error) {
	var wf WorkflowDSL
	if err := yaml.Unmarshal([]byte(dslYAML), &wf); err != nil {
		return nil, nil, fmt.Errorf("parse YAML: %w", err)
	}

	if len(wf.Nodes) == 0 {
		return nil, nil, fmt.Errorf("workflow has no nodes")
	}

	dag := &DAG{
		Nodes:      make(map[string]*NodeDef),
		NodeOrder:  make([]string, 0, len(wf.Nodes)),
		Edges:      wf.Edges,
		Deps:       make(map[string][]string),
		Successors: make(map[string][]string),
	}

	// Index nodes
	for i := range wf.Nodes {
		node := &wf.Nodes[i]
		if node.ID == "" {
			return nil, nil, fmt.Errorf("node at index %d has no id", i)
		}
		if _, exists := dag.Nodes[node.ID]; exists {
			return nil, nil, fmt.Errorf("duplicate node id: %s", node.ID)
		}
		dag.Nodes[node.ID] = node
		dag.NodeOrder = append(dag.NodeOrder, node.ID)
	}

	// Build dependency graph from edges
	if len(wf.Edges) > 0 {
		for _, edge := range wf.Edges {
			if _, ok := dag.Nodes[edge.From]; !ok {
				return nil, nil, fmt.Errorf("edge references unknown node: %s", edge.From)
			}
			if _, ok := dag.Nodes[edge.To]; !ok {
				return nil, nil, fmt.Errorf("edge references unknown node: %s", edge.To)
			}
			dag.Deps[edge.To] = append(dag.Deps[edge.To], edge.From)
			dag.Successors[edge.From] = append(dag.Successors[edge.From], edge.To)
		}
	} else {
		// No explicit edges: infer linear chain from node order
		for i := 1; i < len(dag.NodeOrder); i++ {
			prev := dag.NodeOrder[i-1]
			curr := dag.NodeOrder[i]
			dag.Deps[curr] = append(dag.Deps[curr], prev)
			dag.Successors[prev] = append(dag.Successors[prev], curr)
			dag.Edges = append(dag.Edges, EdgeDef{From: prev, To: curr})
		}
	}

	return &wf, dag, nil
}

// GetEntryNodes returns nodes with no dependencies (DAG roots)
func (d *DAG) GetEntryNodes() []*NodeDef {
	var entries []*NodeDef
	for _, nodeID := range d.NodeOrder {
		if len(d.Deps[nodeID]) == 0 {
			entries = append(entries, d.Nodes[nodeID])
		}
	}
	return entries
}

// GetDependencies returns the upstream node IDs for a given node
func (d *DAG) GetDependencies(nodeID string) []string {
	return d.Deps[nodeID]
}

// GetSuccessors returns the downstream node IDs for a given node
func (d *DAG) GetSuccessors(nodeID string) []string {
	return d.Successors[nodeID]
}

// GetNode returns the node definition by ID
func (d *DAG) GetNode(nodeID string) *NodeDef {
	return d.Nodes[nodeID]
}

// GetPreviousNode returns the immediate predecessor for linear flows
// For nodes with multiple deps, returns the first one
func (d *DAG) GetPreviousNode(nodeID string) *NodeDef {
	deps := d.Deps[nodeID]
	if len(deps) == 0 {
		return nil
	}
	return d.Nodes[deps[0]]
}

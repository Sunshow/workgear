package engine

import (
	"regexp"
	"strings"

	"github.com/flosch/pongo2/v6"
)

func init() {
	// Register "truncate" as alias for "truncatechars"
	pongo2.RegisterFilter("truncate", func(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
		s := in.String()
		n := param.Integer()
		if n <= 0 || n >= len(s) {
			return in, nil
		}
		return pongo2.AsValue(s[:n]), nil
	})
}

// paramsPattern matches {{params.xxx}} and {{ params.xxx }} with optional spaces
var paramsPattern = regexp.MustCompile(`\{\{\s*params\.(\w+)\s*\}\}`)

// RenderParams replaces {{params.xxx}} placeholders in DSL with actual values.
// Only params variables are replaced; other template variables (nodes, review, task) are preserved.
func RenderParams(dsl string, variables map[string]string) string {
	return paramsPattern.ReplaceAllStringFunc(dsl, func(match string) string {
		sub := paramsPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		key := sub[1]
		if val, ok := variables[key]; ok {
			return val
		}
		return match // keep unresolved params as-is
	})
}

// RenderTemplate renders a template string using pongo2 with the given context.
// Used at runtime to resolve nodes.xxx.outputs, review.comment, task.id, etc.
func RenderTemplate(tmpl string, ctx map[string]any) (string, error) {
	// Quick check: if no template syntax, return as-is
	if !strings.Contains(tmpl, "{{") {
		return tmpl, nil
	}

	tpl, err := pongo2.FromString(tmpl)
	if err != nil {
		return tmpl, err
	}

	result, err := tpl.Execute(pongo2.Context(ctx))
	if err != nil {
		return tmpl, err
	}

	return result, nil
}

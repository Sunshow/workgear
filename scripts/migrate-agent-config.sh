#!/bin/bash
# 数据迁移脚本：从环境变量导入 Agent 配置到数据库

set -e

echo "=== Agent 配置数据迁移 ==="

# 检查环境变量
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$ANTHROPIC_AUTH_TOKEN" ]; then
  echo "警告: 未设置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN"
  echo "跳过迁移，请手动在前端界面配置 Provider"
  exit 0
fi

# 准备配置值
BASE_URL="${ANTHROPIC_BASE_URL:-https://api.anthropic.com}"
AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-$ANTHROPIC_API_KEY}"
MODEL="${CLAUDE_MODEL:-claude-sonnet-4}"

echo "检测到配置:"
echo "  Base URL: $BASE_URL"
echo "  Auth Token: ${AUTH_TOKEN:0:10}***"
echo "  Model: $MODEL"

# 执行 SQL 迁移
docker exec -i workgear-postgres psql -U workgear -d workgear_dev <<EOF
-- 插入默认 Provider
INSERT INTO agent_providers (agent_type, name, config, is_default)
VALUES (
  'claude-code',
  'Default Provider (from env)',
  jsonb_build_object(
    'base_url', '$BASE_URL',
    'auth_token', '$AUTH_TOKEN'
  ),
  true
)
ON CONFLICT DO NOTHING
RETURNING id;

-- 获取刚插入的 provider_id
DO \$\$
DECLARE
  provider_id uuid;
BEGIN
  SELECT id INTO provider_id
  FROM agent_providers
  WHERE agent_type = 'claude-code' AND is_default = true
  LIMIT 1;

  -- 插入默认 Model
  INSERT INTO agent_models (provider_id, model_name, is_default)
  VALUES (provider_id, '$MODEL', true)
  ON CONFLICT DO NOTHING;

  -- 更新现有 Role 映射
  UPDATE agent_roles
  SET provider_id = provider_id,
      model_id = (SELECT id FROM agent_models WHERE provider_id = provider_id AND is_default = true LIMIT 1)
  WHERE provider_id IS NULL;

  RAISE NOTICE 'Migration completed: provider_id = %', provider_id;
END \$\$;

-- 验证结果
SELECT 'Providers:' as info, count(*) as count FROM agent_providers;
SELECT 'Models:' as info, count(*) as count FROM agent_models;
SELECT 'Roles with provider:' as info, count(*) as count FROM agent_roles WHERE provider_id IS NOT NULL;
EOF

echo ""
echo "✓ 迁移完成"
echo ""
echo "下一步:"
echo "  1. 访问前端 /settings/agents 查看配置"
echo "  2. 可以添加更多 Provider 和 Model"
echo "  3. 在 /settings/agent-roles 调整角色映射"

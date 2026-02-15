-- 创建 agent_providers 表
CREATE TABLE "agent_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_type" varchar(50) NOT NULL,
  "name" varchar(100) NOT NULL,
  "config" jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_providers_type_name" UNIQUE("agent_type", "name")
);
--> statement-breakpoint

-- 创建 agent_models 表
CREATE TABLE "agent_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_id" uuid NOT NULL,
  "model_name" varchar(100) NOT NULL,
  "display_name" varchar(200),
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_models_provider_model" UNIQUE("provider_id", "model_name")
);
--> statement-breakpoint

-- 创建索引
CREATE INDEX "idx_agent_providers_type" ON "agent_providers" ("agent_type");
--> statement-breakpoint
CREATE INDEX "idx_agent_models_provider" ON "agent_models" ("provider_id");
--> statement-breakpoint

-- 添加外键
ALTER TABLE "agent_models" ADD CONSTRAINT "agent_models_provider_id_agent_providers_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "agent_providers"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- 删除旧的 agent_configs 表
DROP TABLE IF EXISTS "agent_configs";
--> statement-breakpoint

-- 修改 agent_roles 表：删除 default_model 列，添加 provider_id 和 model_id 列
ALTER TABLE "agent_roles" DROP COLUMN IF EXISTS "default_model";
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "provider_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "model_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_provider_id_agent_providers_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "agent_providers"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_model_id_agent_models_id_fkey" FOREIGN KEY ("model_id") REFERENCES "agent_models"("id") ON DELETE SET NULL;

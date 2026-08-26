CREATE TABLE "story_role_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID,
  "project_id" UUID NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "occupation" VARCHAR(200) NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "desire" TEXT NOT NULL DEFAULT '',
  "mainline_relation" TEXT NOT NULL DEFAULT '',
  "narrative_order" VARCHAR(16) NOT NULL DEFAULT '未设定',
  "gender" VARCHAR(16) NOT NULL DEFAULT '未设定',
  "camp" VARCHAR(32) NOT NULL DEFAULT '中立',
  "prominence" VARCHAR(16) NOT NULL DEFAULT '背景',
  "functions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(3),

  CONSTRAINT "story_role_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_role_assets_category_check" CHECK (
    "category" IN ('protagonists', 'core', 'supporting', 'background')
  ),
  CONSTRAINT "story_role_assets_name_check" CHECK (
    CHAR_LENGTH("name") BETWEEN 1 AND 100
    AND "name" = BTRIM("name")
  ),
  CONSTRAINT "story_role_assets_occupation_check" CHECK (
    CHAR_LENGTH("occupation") <= 200
    AND "occupation" = BTRIM("occupation")
  ),
  CONSTRAINT "story_role_assets_summary_check" CHECK (
    CHAR_LENGTH("summary") <= 5000
    AND "summary" = BTRIM("summary")
  ),
  CONSTRAINT "story_role_assets_desire_check" CHECK (
    CHAR_LENGTH("desire") <= 5000
    AND "desire" = BTRIM("desire")
  ),
  CONSTRAINT "story_role_assets_mainline_relation_check" CHECK (
    CHAR_LENGTH("mainline_relation") <= 5000
    AND "mainline_relation" = BTRIM("mainline_relation")
  ),
  CONSTRAINT "story_role_assets_narrative_order_check" CHECK (
    "narrative_order" IN ('一号', '二号', '三号', '未设定')
  ),
  CONSTRAINT "story_role_assets_gender_check" CHECK (
    "gender" IN ('男', '女', '未设定')
  ),
  CONSTRAINT "story_role_assets_camp_check" CHECK (
    "camp" IN ('主角方', '对立方', '中立', '立场变化')
  ),
  CONSTRAINT "story_role_assets_prominence_check" CHECK (
    "prominence" IN ('核心', '高频', '低频', '背景')
  ),
  CONSTRAINT "story_role_assets_functions_check" CHECK (
    CARDINALITY("functions") <= 32
  ),
  CONSTRAINT "story_role_assets_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "story_role_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_role_assets_project_fkey" FOREIGN KEY ("tenant_id", "project_id")
    REFERENCES "story_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_role_assets_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "story_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_role_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_role_assets_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_role_assets_created_by_membership_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "story_role_assets_updated_by_membership_fkey" FOREIGN KEY ("tenant_id", "updated_by_user_id")
    REFERENCES "team_memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "story_role_assets_project_archived_category_created_id_idx"
  ON "story_role_assets"("project_id", "archived_at", "category", "created_at", "id");

CREATE INDEX "story_role_assets_tenant_project_id_idx"
  ON "story_role_assets"("tenant_id", "project_id", "id");
